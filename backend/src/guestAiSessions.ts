import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { z } from "zod";
import { ApiError, missing } from "./errors.js";
import { commitGuestAiSessionStart, GUEST_AI_PRIVATE_TTL_SECONDS } from "./guestAiGate.js";
import {
  isValidBreakPlan,
  projectSessionMetrics,
  totalDurationSeconds,
  type BreakPlan,
  type Session,
  type SessionOverride,
} from "./adventure/domain.js";

const guestAiSessionStartSchema = z.object({
  id: z.uuid(),
  target: z.number().int().min(60).max(14400),
  breakPlan: z.object({
    count: z.number().int().min(0).max(10),
    seconds: z.number().int().min(60).max(1800),
  }).strict().optional(),
}).strict().superRefine((value, context) => {
  if (value.breakPlan && !isValidBreakPlan(value.breakPlan, value.target))
    context.addIssue({ code: "custom", path: ["breakPlan"], message: "Break plan is not valid for this target." });
});

const guestAiSessionStartRecordSchema = z.object({
  principalId: z.uuid(),
  sessionId: z.uuid(),
  startedAt: z.number().int().positive(),
  target: z.number().int().min(60).max(14400),
  breakPlan: z.object({ count: z.number().int(), seconds: z.number().int() }).strict().optional(),
  expiresAt: z.number().int().positive(),
}).strict();

export type GuestAiSessionStartInput = z.infer<typeof guestAiSessionStartSchema>;
export type GuestAiSessionStartRecord = z.infer<typeof guestAiSessionStartRecordSchema>;

function sessionKey(sessionId: string) {
  return `guest-ai:session:${sessionId}`;
}

function sameBreakPlan(left: BreakPlan | undefined, right: BreakPlan | undefined) {
  return (left?.count ?? null) === (right?.count ?? null) &&
    (left?.seconds ?? null) === (right?.seconds ?? null);
}

type GuestAiSessionDatabase = Pick<PrismaClient, "$queryRaw">;

async function loadSessionProjection(db: GuestAiSessionDatabase, sessionId: string, lock = false) {
  const rows = lock
    ? await db.$queryRaw<Array<{
        session: Session | null;
        sessionOverride: SessionOverride | null;
      }>>`
        SELECT
          jsonb_extract_path(state, 'sessions', ${sessionId}) AS session,
          jsonb_extract_path(state, 'sessionOverrides', ${sessionId}) AS "sessionOverride"
        FROM adventure_state WHERE id = 1 FOR UPDATE`
    : await db.$queryRaw<Array<{
        session: Session | null;
        sessionOverride: SessionOverride | null;
      }>>`
        SELECT
          jsonb_extract_path(state, 'sessions', ${sessionId}) AS session,
          jsonb_extract_path(state, 'sessionOverrides', ${sessionId}) AS "sessionOverride"
        FROM adventure_state WHERE id = 1`;
  if (!rows[0])
    throw new ApiError(503, "service-unavailable", "Adventure state is unavailable");
  return rows[0];
}

/** Rejects tombstoned sessions and rejects saved rows unless they are this guest's own projection. */
export async function assertGuestAiSessionAvailable(db: PrismaClient, sessionId: string) {
  const projection = await loadSessionProjection(db, sessionId);
  if (projection.sessionOverride?.removedAt !== undefined)
    throw new ApiError(410, "session-removed", "Phiên học này đã được quản trị viên gỡ khỏi lịch sử.");
  if (projection.session &&
      (projection.session.userId !== `guest:${sessionId}` || projection.session.groupId !== null))
    missing("Không tìm thấy phiên AI khách.");
  return projection.session;
}

/** Keeps private preparation off sessions that have already been published. */
export async function assertGuestAiSessionPending(db: PrismaClient, sessionId: string) {
  const session = await assertGuestAiSessionAvailable(db, sessionId);
  if (session)
    throw new ApiError(409, "conflict", "Phiên học đã được lưu trước khi bật AI khách.");
}

function parseStartRecord(value: string | null): GuestAiSessionStartRecord | null {
  if (!value) return null;
  try {
    return guestAiSessionStartRecordSchema.parse(JSON.parse(value));
  } catch {
    throw new ApiError(503, "service-unavailable", "Guest AI session state is unavailable");
  }
}

function matchingStart(
  record: GuestAiSessionStartRecord,
  principalId: string,
  input: GuestAiSessionStartInput,
  now: number,
) {
  if (record.expiresAt <= now) missing("Không tìm thấy phiên AI khách.");
  if (record.principalId !== principalId || record.sessionId !== input.id)
    missing("Không tìm thấy phiên AI khách.");
  if (record.target !== input.target || !sameBreakPlan(record.breakPlan, input.breakPlan))
    throw new ApiError(409, "conflict", "Thời lượng hoặc kế hoạch nghỉ đã thay đổi sau khi bắt đầu phiên.");
  return record;
}

/** Reserves one server-timed session anchor. A client cannot choose or reset startedAt. */
export async function reserveGuestAiSessionStart(
  redis: Redis,
  db: PrismaClient,
  principalId: string,
  rawInput: GuestAiSessionStartInput,
  now = Date.now(),
) {
  const input = guestAiSessionStartSchema.parse(rawInput);
  const key = sessionKey(input.id);
  let existing: GuestAiSessionStartRecord | null;
  try {
    existing = parseStartRecord(await redis.get(key));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "service-unavailable", "Guest AI session storage is unavailable");
  }
  if (existing) return matchingStart(existing, principalId, input, now);

  const record: GuestAiSessionStartRecord = {
    principalId,
    sessionId: input.id,
    startedAt: now,
    target: input.target,
    ...(input.breakPlan ? { breakPlan: input.breakPlan } : {}),
    expiresAt: now + GUEST_AI_PRIVATE_TTL_SECONDS * 1000,
  };
  let created: number;
  try {
    created = await db.$transaction(async tx => {
      const projection = await loadSessionProjection(tx, input.id, true);
      if (projection.sessionOverride?.removedAt !== undefined)
        throw new ApiError(410, "session-removed", "Phiên học này đã được quản trị viên gỡ khỏi lịch sử.");
      if (projection.session)
        throw new ApiError(409, "conflict", "Phiên học đã được lưu trước khi bật AI khách.");
      return commitGuestAiSessionStart(redis, principalId, input.id, JSON.stringify(record));
    }, { timeout: 5000 });
    if (created === 0) return record;
    existing = parseStartRecord(await redis.get(key));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "service-unavailable", "Guest AI session storage is unavailable");
  }
  if (!existing)
    throw new ApiError(503, "service-unavailable", "Guest AI session reservation is unavailable");
  return matchingStart(existing, principalId, input, now);
}

/** Requires an owner-bound, persisted guest session that reached its server-anchored goal. */
export async function requireCompletedGuestAiSession(
  redis: Redis,
  db: PrismaClient,
  principalId: string,
  sessionId: string,
  now = Date.now(),
) {
  let record: GuestAiSessionStartRecord | null;
  try {
    record = parseStartRecord(await redis.get(sessionKey(sessionId)));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "service-unavailable", "Guest AI session storage is unavailable");
  }
  if (!record || record.expiresAt <= now || record.principalId !== principalId)
    missing("Không tìm thấy phiên AI khách.");

  const projection = await loadSessionProjection(db, sessionId);
  if (projection.sessionOverride?.removedAt !== undefined)
    throw new ApiError(410, "session-removed", "Phiên học này đã được quản trị viên gỡ khỏi lịch sử.");
  const session = projection.session;
  if (!session)
    throw new ApiError(409, "conflict", "Lời giải chỉ mở sau khi phiên học đạt đủ mục tiêu và được lưu.");
  if (session.userId !== `guest:${sessionId}` || session.groupId !== null)
    missing("Không tìm thấy phiên AI khách đã hoàn tất.");

  const deadline = record.startedAt + totalDurationSeconds(record.target, record.breakPlan) * 1000;
  if (session.started !== record.startedAt || session.target !== record.target ||
      !sameBreakPlan(session.breakPlan, record.breakPlan) || session.ended < deadline ||
      session.ended > now + 5_000 || now < deadline)
    throw new ApiError(409, "conflict", "Phiên học chưa đạt đủ thời lượng đã xác nhận.");

  const metrics = projectSessionMetrics(session, projection.sessionOverride ?? undefined).effectiveMetrics;
  if (metrics.targetSeconds !== record.target || !metrics.completed)
    throw new ApiError(409, "conflict", "Phiên học chưa đạt đủ mục tiêu.");

  return { session, start: record, metrics };
}
