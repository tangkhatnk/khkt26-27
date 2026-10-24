import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { config } from "./config.js";
import { ApiError } from "./errors.js";
import {
  breakElapsedSeconds,
  isValidBreakPlan,
  studyElapsedSeconds,
  type BreakPlan,
} from "./adventure/domain.js";

const ADMIN_REPORT_SESSION_LIMIT = 20_000;
const ADMIN_PAGE_LIMIT = 50;
const ADMIN_MAX_OFFSET = 10_000;
const dayMilliseconds = 86_400_000;
const periodSchema = z.enum(["7", "30", "90"]).transform((value) => Number(value) as 7 | 30 | 90);
const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(ADMIN_PAGE_LIMIT).default(25),
  offset: z.coerce.number().int().min(0).max(ADMIN_MAX_OFFSET).default(0),
});
const sessionFilterSchema = pageSchema.extend({
  days: periodSchema.default(30),
  accountId: z.uuid().optional(),
  groupId: z.uuid().optional(),
});
const auditQuerySchema = pageSchema.extend({ targetId: z.uuid().optional() });
const roleMutationSchema = z.object({
  isAdmin: z.boolean(),
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(500),
}).strict();
const suspensionMutationSchema = z.object({
  suspended: z.boolean(),
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(500),
}).strict();
const profileMutationSchema = z.object({
  name: z.string().trim().min(1).max(100),
  expectedName: z.string().max(100),
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(500),
}).strict();
const deletionMutationSchema = z.object({
  deleted: z.boolean(),
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(500),
}).strict();

const breakPlanSchema = z.object({
  count: z.number().int().min(0).max(10),
  seconds: z.number().int().min(60).max(1800),
});
const segmentSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  kind: z.enum(["focus", "material", "break", "distraction"]),
});
const storedSessionSchema = z.object({
  id: z.string().min(1).max(100),
  userId: z.string().min(1).max(100),
  groupId: z.uuid().nullable().optional().default(null),
  topic: z.string().trim().min(1).max(100),
  started: z.number().int().nonnegative().max(8.64e15),
  ended: z.number().int().nonnegative().max(8.64e15),
  target: z.number().int().min(60).max(14_400),
  seconds: z.number().finite().nonnegative().optional(),
  distractions: z.number().int().min(0).max(10_000).optional(),
  breakPlan: breakPlanSchema.optional(),
  segments: z.array(segmentSchema).max(2_000).default([]),
  quiz: z.object({
    score: z.number().int().min(0).max(1000),
    total: z.number().int().min(1).max(1000),
  }).optional(),
}).strip().refine((session) => session.ended >= session.started, "Invalid session time");

type StoredSession = z.infer<typeof storedSessionSchema>;
type AdminPeriod = 7 | 30 | 90;
type MetricTotals = {
  sessionCount: number;
  plannedStudySeconds: number;
  actualStudySeconds: number;
  focusedSeconds: number;
  plannedBreakSeconds: number;
  actualBreakSeconds: number;
  distractions: number;
  completedSessions: number;
  completionPercent: number;
  gradedQuizSessions: number;
  quizCoveragePercent: number;
  quizScore: number;
  quizTotal: number;
  quizScorePercent: number | null;
};

export type AdminSessionDto = {
  id: string;
  accountId: string;
  groupId: string | null;
  topic: string;
  startedAt: string;
  endedAt: string;
  plannedStudySeconds: number;
  actualStudySeconds: number;
  focusedSeconds: number;
  plannedBreakSeconds: number;
  actualBreakSeconds: number;
  distractions: number;
  completed: boolean;
  quizScore: number | null;
  quizTotal: number | null;
};

export type AdminReport = {
  days: AdminPeriod;
  timezone: "UTC";
  analysisLimit: number;
  fromUtc: string;
  asOfUtc: string;
  matchingSessionCount: number;
  recordsAnalyzed: number;
  truncated: boolean;
  totals: MetricTotals;
  daily: (MetricTotals & { dateUtc: string })[];
  topics: (MetricTotals & { topic: string })[];
};

function parseSession(value: unknown): StoredSession | null {
  const result = storedSessionSchema.safeParse(value);
  return result.success ? result.data : null;
}

function finiteSeconds(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value * 10) / 10) : 0;
}

function metricsFor(session: StoredSession) {
  const validPlan: BreakPlan | undefined = session.breakPlan &&
    isValidBreakPlan(session.breakPlan, session.target)
    ? session.breakPlan
    : undefined;
  const wallSeconds = Math.max(0, (session.ended - session.started) / 1000);
  const plannedBreakSeconds = validPlan ? validPlan.count * validPlan.seconds : 0;
  const actualBreakSeconds = validPlan
    ? breakElapsedSeconds(session.started, session.target, validPlan, session.ended)
    : session.segments.reduce((sum, segment) => {
      if (segment.kind !== "break") return sum;
      const start = Math.max(session.started, segment.start);
      const end = Math.min(session.ended, segment.end);
      return sum + Math.max(0, end - start) / 1000;
    }, 0);
  const actualStudySeconds = validPlan
    ? studyElapsedSeconds(session.started, session.target, validPlan, session.ended)
    : Math.min(session.target, Math.max(0, wallSeconds - actualBreakSeconds));
  const segmentFocusSeconds = session.segments.reduce((sum, segment) =>
    segment.kind === "focus" || segment.kind === "material"
      ? sum + Math.max(0, segment.end - segment.start) / 1000
      : sum, 0);
  const focusedSeconds = Math.min(session.target, session.seconds ?? segmentFocusSeconds);
  const quiz = session.quiz && session.quiz.score <= session.quiz.total ? session.quiz : undefined;

  return {
    plannedStudySeconds: session.target,
    actualStudySeconds: finiteSeconds(actualStudySeconds),
    focusedSeconds: finiteSeconds(focusedSeconds),
    plannedBreakSeconds,
    actualBreakSeconds: finiteSeconds(Math.min(wallSeconds, actualBreakSeconds)),
    distractions: session.distractions ?? session.segments.filter((segment) => segment.kind === "distraction").length,
    completed: actualStudySeconds >= session.target,
    quizScore: quiz?.score ?? null,
    quizTotal: quiz?.total ?? null,
  };
}

export function adminSessionDto(value: unknown): AdminSessionDto | null {
  const session = parseSession(value);
  if (!session) return null;
  const metrics = metricsFor(session);
  return {
    id: session.id,
    accountId: session.userId,
    groupId: session.groupId ?? null,
    topic: session.topic,
    startedAt: new Date(session.started).toISOString(),
    endedAt: new Date(session.ended).toISOString(),
    ...metrics,
  };
}

function emptyTotals(): MetricTotals {
  return {
    sessionCount: 0,
    plannedStudySeconds: 0,
    actualStudySeconds: 0,
    focusedSeconds: 0,
    plannedBreakSeconds: 0,
    actualBreakSeconds: 0,
    distractions: 0,
    completedSessions: 0,
    completionPercent: 0,
    gradedQuizSessions: 0,
    quizCoveragePercent: 0,
    quizScore: 0,
    quizTotal: 0,
    quizScorePercent: null,
  };
}

function addSession(totals: MetricTotals, session: StoredSession) {
  const metrics = metricsFor(session);
  totals.sessionCount += 1;
  totals.plannedStudySeconds += metrics.plannedStudySeconds;
  totals.actualStudySeconds += metrics.actualStudySeconds;
  totals.focusedSeconds += metrics.focusedSeconds;
  totals.plannedBreakSeconds += metrics.plannedBreakSeconds;
  totals.actualBreakSeconds += metrics.actualBreakSeconds;
  totals.distractions += metrics.distractions;
  totals.completedSessions += Number(metrics.completed);
  if (metrics.quizScore !== null && metrics.quizTotal !== null) {
    totals.gradedQuizSessions += 1;
    totals.quizScore += metrics.quizScore;
    totals.quizTotal += metrics.quizTotal;
  }
}

function finishTotals(totals: MetricTotals): MetricTotals {
  const roundPercent = (value: number) => Math.round(value * 10) / 10;
  return {
    ...totals,
    plannedStudySeconds: finiteSeconds(totals.plannedStudySeconds),
    actualStudySeconds: finiteSeconds(totals.actualStudySeconds),
    focusedSeconds: finiteSeconds(totals.focusedSeconds),
    actualBreakSeconds: finiteSeconds(totals.actualBreakSeconds),
    completionPercent: totals.sessionCount
      ? roundPercent((totals.completedSessions / totals.sessionCount) * 100)
      : 0,
    quizCoveragePercent: totals.sessionCount
      ? roundPercent((totals.gradedQuizSessions / totals.sessionCount) * 100)
      : 0,
    quizScorePercent: totals.quizTotal
      ? roundPercent((totals.quizScore / totals.quizTotal) * 100)
      : null,
  };
}

function utcDate(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

export function adminReportWindow(days: AdminPeriod, asOf = new Date()) {
  const asOfMs = asOf.getTime();
  if (!Number.isFinite(asOfMs)) throw new Error("Invalid report time");
  const utcToday = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  const from = new Date(utcToday - (days - 1) * dayMilliseconds);
  return { fromUtc: from.toISOString(), asOfUtc: new Date(asOfMs).toISOString(), fromMs: from.getTime(), asOfMs };
}

export function buildAdminReport(
  values: readonly unknown[],
  days: AdminPeriod,
  asOf = new Date(),
  matchingSessionCount = values.length,
): AdminReport {
  const window = adminReportWindow(days, asOf);
  const sessions = values
    .map(parseSession)
    .filter((session): session is StoredSession => Boolean(session) &&
      session!.started >= window.fromMs && session!.started <= window.asOfMs);
  const daily = new Map<string, MetricTotals>();
  const topics = new Map<string, MetricTotals>();
  for (let offset = 0; offset < days; offset += 1) {
    const dateUtc = utcDate(window.fromMs + offset * dayMilliseconds);
    daily.set(dateUtc, emptyTotals());
  }
  const totals = emptyTotals();
  for (const session of sessions) {
    addSession(totals, session);
    const day = daily.get(utcDate(session.started));
    if (day) addSession(day, session);
    const topic = topics.get(session.topic) ?? emptyTotals();
    addSession(topic, session);
    topics.set(session.topic, topic);
  }
  return {
    days,
    timezone: "UTC",
    analysisLimit: ADMIN_REPORT_SESSION_LIMIT,
    fromUtc: window.fromUtc,
    asOfUtc: window.asOfUtc,
    matchingSessionCount,
    recordsAnalyzed: sessions.length,
    truncated: matchingSessionCount > sessions.length,
    totals: finishTotals(totals),
    daily: [...daily].map(([dateUtc, valuesForDay]) => ({ dateUtc, ...finishTotals(valuesForDay) })),
    topics: [...topics].map(([topic, valuesForTopic]) => ({ topic, ...finishTotals(valuesForTopic) }))
      .sort((a, b) => b.focusedSeconds - a.focusedSeconds || a.topic.localeCompare(b.topic)),
  };
}

function csvCell(value: unknown): string {
  const text = String(value ?? "").replace(/^\s*[=+@-]/, "'$&");
  return `"${text.replaceAll('"', '""')}"`;
}

export function adminReportCsv(
  report: AdminReport,
  scope: "all" | "account" | "group" = "all",
  scopeId?: string,
): string {
  const headers = ["section", "from_utc", "as_of_utc", "timezone", "date_utc", "topic", "session_count",
    "planned_study_seconds", "actual_study_seconds", "focused_seconds", "planned_break_seconds",
    "actual_break_seconds", "distractions", "completed_sessions", "completion_percent", "graded_quiz_sessions",
    "quiz_coverage_percent", "quiz_score", "quiz_total", "quiz_score_percent"];
  const toRow = (section: string, dateUtc: string, topic: string, totals: MetricTotals) => [
    section, report.fromUtc, report.asOfUtc, report.timezone, dateUtc, topic, totals.sessionCount,
    totals.plannedStudySeconds, totals.actualStudySeconds, totals.focusedSeconds, totals.plannedBreakSeconds,
    totals.actualBreakSeconds, totals.distractions, totals.completedSessions, totals.completionPercent,
    totals.gradedQuizSessions, totals.quizCoveragePercent, totals.quizScore, totals.quizTotal, totals.quizScorePercent,
  ].map(csvCell).join(",");
  const rows = [headers.map(csvCell).join(","),
    toRow(`summary:${report.days}d;scope=${scope};scope_id=${scopeId ?? ""};limit=${report.analysisLimit};analyzed=${report.recordsAnalyzed};matching=${report.matchingSessionCount};truncated=${report.truncated}`, "", "", report.totals),
    ...report.daily.map((row) => toRow("daily", row.dateUtc, "", row)),
    ...report.topics.map((row) => toRow("topic", "", row.topic, row)),
  ];
  return `\uFEFF${rows.join("\r\n")}`;
}

function noStore(_request: FastifyRequest, reply: FastifyReply) {
  reply.header("Cache-Control", "private, no-store").header("Pragma", "no-cache");
}

function reportQuery(query: unknown) {
  return z.object({
    days: periodSchema.default(7),
    accountId: z.uuid().optional(),
    groupId: z.uuid().optional(),
  }).refine((value) => !(value.accountId && value.groupId), "Choose either an account or group")
    .parse(query);
}

function accountQuery(query: unknown) {
  return z.object({
    q: z.string().trim().max(100).default(""),
    ...pageSchema.shape,
  }).parse(query);
}

function groupQuery(query: unknown) {
  return z.object({
    q: z.string().trim().max(100).default(""),
    ...pageSchema.shape,
  }).parse(query);
}

function sessionQuery(query: unknown) {
  return sessionFilterSchema.parse(query);
}

type AdminSessionFilters = { accountId?: string; groupId?: string };

function readWindowSessions(
  db: PrismaClient,
  fromMs: number,
  asOfMs: number,
  limit: number,
  filters: AdminSessionFilters = {},
) {
  return db.$queryRaw<{ session: unknown }[]>`
    SELECT entry.value AS session
    FROM adventure_state a
    CROSS JOIN LATERAL jsonb_each(
      CASE WHEN jsonb_typeof(a.state->'sessions') = 'object'
        THEN a.state->'sessions' ELSE '{}'::jsonb END
    ) AS entry(key, value)
    WHERE a.id = 1
      AND CASE WHEN entry.value->>'started' ~ '^[0-9]+$'
        THEN (entry.value->>'started')::bigint >= ${fromMs}
          AND (entry.value->>'started')::bigint <= ${asOfMs}
        ELSE false END
      AND (${filters.accountId ?? null}::text IS NULL OR entry.value->>'userId' = ${filters.accountId ?? null})
      AND (${filters.groupId ?? null}::text IS NULL OR entry.value->>'groupId' = ${filters.groupId ?? null})
    ORDER BY CASE WHEN entry.value->>'started' ~ '^[0-9]+$'
      THEN (entry.value->>'started')::bigint ELSE 0 END DESC, entry.key DESC
    LIMIT ${limit}`;
}

function countWindowSessions(db: PrismaClient, fromMs: number, asOfMs: number, filters: AdminSessionFilters = {}) {
  return db.$queryRaw<{ total: number }[]>`
    SELECT COUNT(*)::int AS total
    FROM adventure_state a
    CROSS JOIN LATERAL jsonb_each(
      CASE WHEN jsonb_typeof(a.state->'sessions') = 'object'
        THEN a.state->'sessions' ELSE '{}'::jsonb END
    ) AS entry(key, value)
    WHERE a.id = 1
      AND CASE WHEN entry.value->>'started' ~ '^[0-9]+$'
        THEN (entry.value->>'started')::bigint >= ${fromMs}
          AND (entry.value->>'started')::bigint <= ${asOfMs}
        ELSE false END
      AND (${filters.accountId ?? null}::text IS NULL OR entry.value->>'userId' = ${filters.accountId ?? null})
      AND (${filters.groupId ?? null}::text IS NULL OR entry.value->>'groupId' = ${filters.groupId ?? null})`;
}

async function reportData(db: PrismaClient, days: AdminPeriod, asOf: Date, filters: AdminSessionFilters = {}) {
  const window = adminReportWindow(days, asOf);
  const [rows, counts] = await Promise.all([
    readWindowSessions(db, window.fromMs, window.asOfMs, ADMIN_REPORT_SESSION_LIMIT + 1, filters),
    countWindowSessions(db, window.fromMs, window.asOfMs, filters),
  ]);
  const values = rows.slice(0, ADMIN_REPORT_SESSION_LIMIT).map((row) => row.session);
  return buildAdminReport(values, days, asOf, counts[0]?.total ?? 0);
}

function groupRecord(value: unknown) {
  return z.object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(100),
    members: z.array(z.unknown()).max(1_000).default([]),
    timezone: z.string().trim().max(100).default("UTC"),
    archived: z.boolean().default(false),
    journey: z.object({
      seconds: z.number().finite().nonnegative().default(0),
      station: z.number().int().min(0).max(4).default(0),
      remaining: z.number().finite().nonnegative().default(0),
      threshold: z.number().finite().nonnegative().default(0),
    }).partial().default({}),
  }).strip().safeParse(value);
}

const adminAccountSelect = {
  id: true,
  email: true,
  name: true,
  created_at: true,
  suspended_at: true,
  deleted_at: true,
  admin_state_version: true,
  adminGrant: { select: { is_active: true } },
} as const;

type AdminAccountRecord = Prisma.UserGetPayload<{ select: typeof adminAccountSelect }>;
type AdminDatabase = PrismaClient | Prisma.TransactionClient;
type AdminAction = "role" | "suspension" | "profile" | "deletion";
type AdminMutation =
  | { action: "role"; value: boolean }
  | { action: "suspension"; value: boolean }
  | { action: "profile"; name: string; expectedName: string }
  | { action: "deletion"; deleted: boolean };

function accountAdminState(user: AdminAccountRecord, admins: ReadonlySet<string>) {
  const bootstrap = admins.has(user.id.toLowerCase());
  const persistent = user.adminGrant?.is_active ?? false;
  const deleted = Boolean(user.deleted_at);
  const adminSource = deleted ? null : bootstrap ? "bootstrap" : persistent ? "persistent" : null;
  const suspended = user.suspended_at !== null;
  return {
    isAdmin: adminSource !== null,
    adminSource,
    status: deleted ? "deleted" as const : suspended ? "suspended" as const : "active" as const,
    suspendedAt: user.suspended_at?.toISOString() ?? null,
    deletedAt: user.deleted_at?.toISOString() ?? null,
    adminStateVersion: user.admin_state_version,
    suspended,
    deleted,
  };
}

function adminAccountDto(user: AdminAccountRecord, admins: ReadonlySet<string>) {
  const state = accountAdminState(user, admins);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.created_at.toISOString(),
    isAdmin: state.isAdmin,
    adminSource: state.adminSource,
    status: state.status,
    suspendedAt: state.suspendedAt,
    deletedAt: state.deletedAt,
    adminStateVersion: state.adminStateVersion,
  };
}

function isActiveAdmin(user: AdminAccountRecord, admins: ReadonlySet<string>) {
  const state = accountAdminState(user, admins);
  return state.isAdmin && !state.suspended && !state.deleted;
}

async function findAdminAccount(db: AdminDatabase, id: string) {
  return db.user.findUnique({ where: { id }, select: adminAccountSelect });
}

async function countActiveAdmins(db: AdminDatabase, admins: ReadonlySet<string>) {
  const bootstrapIds = [...admins];
  const bootstrapClause = bootstrapIds.length
    ? Prisma.sql`OR u.id::text IN (${Prisma.join(bootstrapIds)})`
    : Prisma.empty;
  const rows = await db.$queryRaw<{ total: number }[]>`
    SELECT COUNT(*)::int AS total
    FROM users u
    LEFT JOIN admin_grants g ON g.user_id = u.id
    WHERE u.suspended_at IS NULL
      AND u.deleted_at IS NULL
      AND (g.is_active = true ${bootstrapClause})`;
  return rows[0]?.total ?? 0;
}

async function performAdminMutation(
  db: PrismaClient,
  actorId: string,
  targetId: string,
  expectedVersion: number,
  reason: string,
  mutation: AdminMutation,
  admins: ReadonlySet<string>,
) {
  return db.$transaction(async (tx) => {
    const control = await tx.$queryRaw<{ id: number }[]>`
      SELECT id FROM admin_control WHERE id = 1 FOR UPDATE`;
    if (control.length !== 1)
      throw new ApiError(503, "service-unavailable", "Admin controls are unavailable");

    const actor = await findAdminAccount(tx, actorId);
    if (!actor || !isActiveAdmin(actor, admins))
      throw new ApiError(403, "authorization-error", "Admin access required");

    if (actorId.toLowerCase() === targetId.toLowerCase())
      throw new ApiError(409, "conflict", "Admins cannot change their own account");

    const targetLocks = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM users WHERE id = ${targetId}::uuid FOR UPDATE`;
    if (targetLocks.length !== 1)
      throw new ApiError(404, "not-found", "Account not found");
    const target = await findAdminAccount(tx, targetId);
    if (!target) throw new ApiError(404, "not-found", "Account not found");

    if (admins.has(target.id.toLowerCase()))
      throw new ApiError(409, "conflict", "Bootstrap administrators cannot be changed here");

    const before = accountAdminState(target, admins);
    if (before.adminStateVersion !== expectedVersion)
      throw new ApiError(409, "conflict", "Account admin state changed; reload and try again");
    if (mutation.action === "profile" && mutation.expectedName !== target.name)
      throw new ApiError(409, "conflict", "Account name changed; reload and try again");

    if (before.deleted && !(mutation.action === "deletion" && !mutation.deleted))
      throw new ApiError(409, "conflict", "Deleted accounts must be restored before other changes");

    const nextIsAdmin = mutation.action === "role" ? mutation.value : before.isAdmin;
    const nextSuspended = mutation.action === "suspension" ? mutation.value : before.suspended;
    const nextDeleted = mutation.action === "deletion" ? mutation.deleted : before.deleted;
    const nextName = mutation.action === "profile" ? mutation.name : target.name;
    if (nextIsAdmin === before.isAdmin && nextSuspended === before.suspended &&
      nextDeleted === before.deleted && nextName === target.name)
      throw new ApiError(409, "conflict", "Account already has that state");

    const wasActiveAdmin = before.isAdmin && !before.suspended && !before.deleted;
    const willBeActiveAdmin = nextIsAdmin && !nextSuspended && !nextDeleted;
    if (wasActiveAdmin && !willBeActiveAdmin && await countActiveAdmins(tx, admins) <= 1)
      throw new ApiError(409, "conflict", "At least one active administrator must remain");

    if (mutation.action === "role") {
      if (mutation.value) {
        await tx.adminGrant.upsert({
          where: { user_id: target.id },
          create: { user_id: target.id, is_active: true },
          update: { is_active: true },
        });
      } else if (target.adminGrant?.is_active) {
        await tx.adminGrant.update({
          where: { user_id: target.id },
          data: { is_active: false },
        });
      }
    }

    if (mutation.action === "deletion") {
      await tx.adminGrant.upsert({
        where: { user_id: target.id },
        create: { user_id: target.id, is_active: false },
        update: { is_active: false },
      });
    }

    const suspendedAt = mutation.action === "suspension"
      ? (mutation.value ? new Date() : null)
      : target.suspended_at;
    const deletedAt = mutation.action === "deletion"
      ? (mutation.deleted ? new Date() : null)
      : target.deleted_at;
    const updated = await tx.user.update({
      where: { id: target.id },
      data: {
        ...(mutation.action === "profile" ? { name: mutation.name } : {}),
        suspended_at: suspendedAt,
        deleted_at: deletedAt,
        admin_state_version: { increment: 1 },
      },
      select: adminAccountSelect,
    });
    if ((mutation.action === "suspension" && mutation.value) ||
      (mutation.action === "deletion" && mutation.deleted))
      await tx.refreshToken.deleteMany({ where: { user_id: target.id } });

    const after = accountAdminState(updated, admins);
    const action: AdminAction = mutation.action;
    await tx.adminActionAudit.create({
      data: {
        actor_user_id: actor.id,
        target_user_id: target.id,
        action,
        before_is_admin: before.isAdmin,
        after_is_admin: after.isAdmin,
        before_suspended: before.suspended,
        after_suspended: after.suspended,
        before_deleted: before.deleted,
        after_deleted: after.deleted,
        before_name: mutation.action === "profile" ? target.name : null,
        after_name: mutation.action === "profile" ? mutation.name : null,
        before_version: before.adminStateVersion,
        after_version: after.adminStateVersion,
        reason,
      },
    });
    return adminAccountDto(updated, admins);
  });
}

export function adminRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  authenticate: (request: FastifyRequest) => Promise<void>,
  adminUserIds: readonly string[] = config.ADMIN_USER_IDS,
) {
  const admins = new Set(adminUserIds.map((id) => id.toLowerCase()));
  const authenticatedOptions = {
    preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
      noStore(request, reply);
      await authenticate(request);
    },
  };
  const adminOptions = {
    preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
      noStore(request, reply);
      await authenticate(request);
      const actor = await findAdminAccount(db, request.userId);
      if (!actor || !isActiveAdmin(actor, admins))
        throw new ApiError(403, "authorization-error", "Admin access required");
    },
  };

  app.get("/api/v1/admin/access", authenticatedOptions, async (request) => {
    const actor = await findAdminAccount(db, request.userId);
    return { allowed: Boolean(actor && isActiveAdmin(actor, admins)) };
  });

  app.get("/api/v1/admin/report", adminOptions, async (request) => {
    const { days, accountId, groupId } = reportQuery(request.query);
    return reportData(db, days, new Date(), { accountId, groupId });
  });

  app.get("/api/v1/admin/report/export.csv", adminOptions, async (request, reply) => {
    const { days, accountId, groupId } = reportQuery(request.query);
    const scope = accountId ? "account" : groupId ? "group" : "all";
    const report = await reportData(db, days, new Date(), { accountId, groupId });
    const stamp = report.asOfUtc.replace(/[:.]/g, "-");
    return reply
      .header("Content-Disposition", `attachment; filename="viendu-admin-report-${days}d-UTC-${scope}-${stamp}.csv"`)
      .type("text/csv; charset=utf-8")
      .send(adminReportCsv(report, scope, accountId ?? groupId));
  });

  app.put("/api/v1/admin/accounts/:id/role", adminOptions, async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = roleMutationSchema.parse(request.body);
    return performAdminMutation(
      db,
      request.userId,
      id,
      body.expectedVersion,
      body.reason,
      { action: "role", value: body.isAdmin },
      admins,
    );
  });

  app.put("/api/v1/admin/accounts/:id/suspension", adminOptions, async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = suspensionMutationSchema.parse(request.body);
    return performAdminMutation(
      db,
      request.userId,
      id,
      body.expectedVersion,
      body.reason,
      { action: "suspension", value: body.suspended },
      admins,
    );
  });

  app.put("/api/v1/admin/accounts/:id/profile", adminOptions, async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = profileMutationSchema.parse(request.body);
    return performAdminMutation(
      db,
      request.userId,
      id,
      body.expectedVersion,
      body.reason,
      { action: "profile", name: body.name, expectedName: body.expectedName },
      admins,
    );
  });

  app.put("/api/v1/admin/accounts/:id/deletion", adminOptions, async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = deletionMutationSchema.parse(request.body);
    return performAdminMutation(
      db,
      request.userId,
      id,
      body.expectedVersion,
      body.reason,
      { action: "deletion", deleted: body.deleted },
      admins,
    );
  });

  app.get("/api/v1/admin/audit", adminOptions, async (request) => {
    const { targetId, limit, offset } = auditQuerySchema.parse(request.query);
    const where = targetId ? { target_user_id: targetId } : {};
    const [rows, total] = await Promise.all([
      db.adminActionAudit.findMany({
        where,
        select: {
          actor_user_id: true,
          target_user_id: true,
          action: true,
          before_is_admin: true,
          after_is_admin: true,
          before_suspended: true,
          after_suspended: true,
          before_deleted: true,
          after_deleted: true,
          before_name: true,
          after_name: true,
          before_version: true,
          after_version: true,
          reason: true,
          created_at: true,
        },
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        take: limit,
        skip: offset,
      }),
      db.adminActionAudit.count({ where }),
    ]);
    return {
      actions: rows.map((row) => {
        const common = {
          actorId: row.actor_user_id,
          targetId: row.target_user_id,
          action: row.action,
          reason: row.reason,
          createdAt: row.created_at.toISOString(),
        };
        const before = {
          isAdmin: row.before_is_admin,
          suspended: row.before_suspended,
          deleted: row.before_deleted,
          version: row.before_version,
        };
        const after = {
          isAdmin: row.after_is_admin,
          suspended: row.after_suspended,
          deleted: row.after_deleted,
          version: row.after_version,
        };
        return row.action === "profile"
          ? { ...common, action: "profile", before: { ...before, name: row.before_name! }, after: { ...after, name: row.after_name! } }
          : { ...common, before, after };
      }),
      total,
      limit,
      offset,
    };
  });

  app.get("/api/v1/admin/accounts", adminOptions, async (request) => {
    const { q, limit, offset } = accountQuery(request.query);
    const exactId = z.uuid().safeParse(q);
    const where: Prisma.UserWhereInput = q ? {
      OR: [
        ...(exactId.success ? [{ id: exactId.data }] : []),
        { email: { contains: q, mode: "insensitive" as const } },
        { name: { contains: q, mode: "insensitive" as const } },
      ],
    } : {};
    const [users, total] = await Promise.all([
      db.user.findMany({
        where,
        select: adminAccountSelect,
        orderBy: [{ created_at: "desc" }, { id: "asc" }],
        take: limit,
        skip: offset,
      }),
      db.user.count({ where }),
    ]);
    return {
      users: users.map((user) => adminAccountDto(user, admins)),
      total,
      limit,
      offset,
    };
  });

  app.get("/api/v1/admin/groups", adminOptions, async (request) => {
    const { q, limit, offset } = groupQuery(request.query);
    const [rows, counts] = await Promise.all([
      db.$queryRaw<{ group: unknown }[]>`
        SELECT entry.value AS "group"
        FROM adventure_state a
        CROSS JOIN LATERAL jsonb_each(
          CASE WHEN jsonb_typeof(a.state->'groups') = 'object'
            THEN a.state->'groups' ELSE '{}'::jsonb END
        ) AS entry(key, value)
        WHERE a.id = 1
          AND (${q} = '' OR entry.value->>'name' ILIKE '%' || ${q} || '%' OR entry.key = ${q})
        ORDER BY lower(COALESCE(entry.value->>'name', '')), entry.key
        LIMIT ${limit} OFFSET ${offset}`,
      db.$queryRaw<{ total: number }[]>`
        SELECT COUNT(*)::int AS total
        FROM adventure_state a
        CROSS JOIN LATERAL jsonb_each(
          CASE WHEN jsonb_typeof(a.state->'groups') = 'object'
            THEN a.state->'groups' ELSE '{}'::jsonb END
        ) AS entry(key, value)
        WHERE a.id = 1
          AND (${q} = '' OR entry.value->>'name' ILIKE '%' || ${q} || '%' OR entry.key = ${q})`,
    ]);
    const groups = rows.flatMap(({ group }) => {
      const result = groupRecord(group);
      if (!result.success) return [];
      const journey = result.data.journey ?? {};
      return [{
        id: result.data.id,
        name: result.data.name,
        timezone: result.data.timezone,
        archived: result.data.archived,
        memberCount: result.data.members.length,
        progress: {
          journeySeconds: finiteSeconds(journey.seconds ?? 0),
          station: journey.station ?? 0,
          remainingSeconds: finiteSeconds(journey.remaining ?? 0),
          thresholdSeconds: finiteSeconds(journey.threshold ?? 0),
        },
      }];
    });
    return { groups, total: counts[0]?.total ?? 0, limit, offset };
  });

  app.get("/api/v1/admin/sessions", adminOptions, async (request) => {
    const { days, accountId, groupId, limit, offset } = sessionQuery(request.query);
    const window = adminReportWindow(days, new Date());
    const [rows, counts] = await Promise.all([
      db.$queryRaw<{ session: unknown }[]>`
        SELECT entry.value AS session
        FROM adventure_state a
        CROSS JOIN LATERAL jsonb_each(
          CASE WHEN jsonb_typeof(a.state->'sessions') = 'object'
            THEN a.state->'sessions' ELSE '{}'::jsonb END
        ) AS entry(key, value)
        WHERE a.id = 1
          AND CASE WHEN entry.value->>'started' ~ '^[0-9]+$'
            THEN (entry.value->>'started')::bigint >= ${window.fromMs}
              AND (entry.value->>'started')::bigint <= ${window.asOfMs}
            ELSE false END
          AND (${accountId ?? null}::text IS NULL OR entry.value->>'userId' = ${accountId ?? null})
          AND (${groupId ?? null}::text IS NULL OR entry.value->>'groupId' = ${groupId ?? null})
        ORDER BY CASE WHEN entry.value->>'started' ~ '^[0-9]+$'
          THEN (entry.value->>'started')::bigint ELSE 0 END DESC, entry.key DESC
        LIMIT ${limit} OFFSET ${offset}`,
      db.$queryRaw<{ total: number }[]>`
        SELECT COUNT(*)::int AS total
        FROM adventure_state a
        CROSS JOIN LATERAL jsonb_each(
          CASE WHEN jsonb_typeof(a.state->'sessions') = 'object'
            THEN a.state->'sessions' ELSE '{}'::jsonb END
        ) AS entry(key, value)
        WHERE a.id = 1
          AND CASE WHEN entry.value->>'started' ~ '^[0-9]+$'
            THEN (entry.value->>'started')::bigint >= ${window.fromMs}
              AND (entry.value->>'started')::bigint <= ${window.asOfMs}
            ELSE false END
          AND (${accountId ?? null}::text IS NULL OR entry.value->>'userId' = ${accountId ?? null})
          AND (${groupId ?? null}::text IS NULL OR entry.value->>'groupId' = ${groupId ?? null})`,
    ]);
    return {
      sessions: rows.map(({ session }) => adminSessionDto(session)).filter((session): session is AdminSessionDto => Boolean(session)),
      total: counts[0]?.total ?? 0,
      limit,
      offset,
      days,
      timezone: "UTC" as const,
      fromUtc: window.fromUtc,
      asOfUtc: window.asOfUtc,
    };
  });
}
