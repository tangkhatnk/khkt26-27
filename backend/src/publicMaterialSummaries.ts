import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient, Prisma } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "./errors.js";
import { isSessionRemoved, type World } from "./adventure/domain.js";

const sessionIdSchema = z.string().min(1).max(100);
const expectedVersionSchema = z.number().int().min(0).max(2_147_483_646);
const summarySchema = z.string()
  .refine((value) => value.length <= 500, "Tóm tắt không được vượt quá 500 ký tự.")
  .refine((value) => !value.includes("\u0000"), "Tóm tắt chứa ký tự không được hỗ trợ.")
  .refine((value) => value.trim().length > 0, "Tóm tắt không được để trống.");
const statusQuerySchema = z.object({ sessionId: sessionIdSchema }).strict();
const publishSchema = z.object({
  sessionId: sessionIdSchema,
  summary: summarySchema,
  expectedVersion: expectedVersionSchema,
  confirmShare: z.literal(true),
}).strict();
const replaceSchema = z.object({
  sessionId: sessionIdSchema,
  summary: summarySchema,
  expectedVersion: expectedVersionSchema,
  confirmReplacement: z.literal(true),
}).strict();
const withdrawSchema = z.object({
  sessionId: sessionIdSchema,
  expectedVersion: expectedVersionSchema,
}).strict();

type ShareRow = {
  summary: string | null;
  version: number;
  approved_at: Date | null;
};

function shareDto(row?: ShareRow | null) {
  return {
    summary: row?.summary ?? null,
    version: row?.version ?? 0,
    approvedAt: row?.approved_at?.toISOString() ?? null,
  };
}

async function lockShareContext(
  tx: Prisma.TransactionClient,
  userId: string,
  sessionId: string,
  requireOwnedSession: boolean,
  requireLiveSession: boolean,
) {
  const users = await tx.$queryRaw<{ id: string; suspended_at: Date | null; deleted_at: Date | null }[]>`
    SELECT id, suspended_at, deleted_at FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
  if (!users[0] || users[0].suspended_at || users[0].deleted_at)
    throw new ApiError(401, "authentication-error", "Account is unavailable");

  const states = await tx.$queryRaw<{ state: World }[]>`
    SELECT state FROM adventure_state WHERE id = 1 FOR UPDATE`;
  if (!states[0])
    throw new ApiError(503, "service-unavailable", "Adventure state is unavailable");
  const world = states[0].state;
  const rawSession = world.sessions?.[sessionId];
  const ownedSession = rawSession && rawSession.id === sessionId && rawSession.userId === userId;
  if (requireOwnedSession && !ownedSession)
    throw new ApiError(404, "not-found", "Không tìm thấy phiên học.");
  if (requireLiveSession && ownedSession && isSessionRemoved(world, sessionId))
    throw new ApiError(410, "session-removed", "Phiên học này đã được quản trị viên gỡ khỏi lịch sử.");
}

function conflict(message: string): never {
  throw new ApiError(409, "conflict", message);
}

export function publicMaterialSummaryRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  authenticate: (request: FastifyRequest) => Promise<void>,
) {
  const authenticated = { preHandler: authenticate };
  app.get("/api/v1/material-summaries/mine", {
    ...authenticated,
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const { sessionId } = statusQuerySchema.parse(request.query);
    return db.$transaction(async (tx) => {
      await lockShareContext(tx, request.userId, sessionId, true, false);
      const row = await tx.publicMaterialSummaryShare.findUnique({
        where: { user_id_session_id: { user_id: request.userId, session_id: sessionId } },
      });
      return shareDto(row);
    }, { timeout: 15000 });
  });

  app.post("/api/v1/material-summaries/share", {
    ...authenticated,
    bodyLimit: 8192,
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
  }, async (request) => {
    const body = publishSchema.parse(request.body);
    return db.$transaction(async (tx) => {
      await lockShareContext(tx, request.userId, body.sessionId, true, true);
      const key = { user_id_session_id: { user_id: request.userId, session_id: body.sessionId } };
      const current = await tx.publicMaterialSummaryShare.findUnique({ where: key });
      const version = current?.version ?? 0;
      if (version !== body.expectedVersion) conflict("Dữ liệu chia sẻ đã thay đổi. Hãy tải lại.");
      if (current && current.summary !== null)
        conflict("Tóm tắt đã được chia sẻ. Hãy xác nhận thay thế riêng.");
      const row = current
        ? await tx.publicMaterialSummaryShare.update({
          where: key,
          data: { summary: body.summary, version: version + 1, approved_at: new Date() },
        })
        : await tx.publicMaterialSummaryShare.create({
          data: { user_id: request.userId, session_id: body.sessionId, summary: body.summary, version: 1, approved_at: new Date() },
        });
      return shareDto(row);
    }, { timeout: 15000 });
  });

  app.put("/api/v1/material-summaries/share", {
    ...authenticated,
    bodyLimit: 8192,
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
  }, async (request) => {
    const body = replaceSchema.parse(request.body);
    return db.$transaction(async (tx) => {
      await lockShareContext(tx, request.userId, body.sessionId, true, true);
      const key = { user_id_session_id: { user_id: request.userId, session_id: body.sessionId } };
      const current = await tx.publicMaterialSummaryShare.findUnique({ where: key });
      if (!current?.summary || current.version !== body.expectedVersion)
        conflict("Tóm tắt đã thay đổi hoặc không còn được chia sẻ. Hãy tải lại.");
      const row = await tx.publicMaterialSummaryShare.update({
        where: key,
        data: {
          summary: body.summary,
          version: current.version + 1,
          approved_at: new Date(),
        },
      });
      return shareDto(row);
    }, { timeout: 15000 });
  });

  app.post("/api/v1/material-summaries/share/withdraw", {
    ...authenticated,
    bodyLimit: 1024,
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  }, async (request) => {
    const body = withdrawSchema.parse(request.body);
    return db.$transaction(async (tx) => {
      // Withdrawal remains available after an admin tombstone and is scoped by the composite owner key.
      await lockShareContext(tx, request.userId, body.sessionId, false, false);
      const key = { user_id_session_id: { user_id: request.userId, session_id: body.sessionId } };
      const current = await tx.publicMaterialSummaryShare.findUnique({ where: key });
      if (!current?.summary) return shareDto(current);
      if (current.version !== body.expectedVersion)
        conflict("Tóm tắt đã được thay thế. Hãy tải lại trước khi thu hồi.");
      const row = await tx.publicMaterialSummaryShare.update({
        where: key,
        data: { summary: null, approved_at: null, version: current.version + 1 },
      });
      return shareDto(row);
    }, { timeout: 15000 });
  });
}
