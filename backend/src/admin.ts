import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { config } from "./config.js";
import { ApiError } from "./errors.js";
import {
  isSessionRemoved,
  projectSessionMetrics,
  type Session,
  type SessionCorrectionFlags,
  type SessionMetrics,
  type SessionOverride,
  type World,
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
  days: z.enum(["7", "30", "90", "all"]).default("all"),
  accountId: z.uuid().optional(),
  groupId: z.uuid().optional(),
  durationBasis: z.enum(["planned", "actual"]).optional(),
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
const sessionCorrectionBodySchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(500),
  changes: z.object({
    goal: z.string().trim().min(3).max(500).nullable().optional(),
    topic: z.string().trim().min(1).max(100).nullable().optional(),
    targetSeconds: z.number().int().min(60).max(14_400).nullable().optional(),
    elapsedSeconds: z.number().finite().min(0).max(32_400).nullable().optional(),
    actualStudySeconds: z.number().finite().min(0).max(14_400).nullable().optional(),
    focusedSeconds: z.number().finite().min(0).max(14_400).nullable().optional(),
    actualBreakSeconds: z.number().finite().min(0).max(32_400).nullable().optional(),
    distractions: z.number().int().min(0).max(10_000).nullable().optional(),
    quizResult: z.object({
      score: z.number().int().min(0).max(1000),
      total: z.number().int().min(1, "Tổng số câu phải lớn hơn 0.").max(1000),
    }).strict().refine((result) => result.score <= result.total, "Điểm không được vượt quá tổng số câu.").nullable().optional(),
  }).strict().refine((changes) => Object.keys(changes).length > 0, "Hãy chọn ít nhất một mục cần chỉnh sửa."),
}).strict();
const sessionRemovalBodySchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(500),
}).strict();
const sessionAuditQuerySchema = pageSchema;

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
  goal: z.string().trim().max(500).optional().default(""),
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
const storedSessionOverrideSchema = z.object({
  version: z.number().int().nonnegative(),
  removedAt: z.number().int().nonnegative().optional(),
  goal: z.string().trim().min(3).max(500).optional(),
  topic: z.string().trim().min(1).max(100).optional(),
  targetSeconds: z.number().int().min(60).max(14_400).optional(),
  elapsedSeconds: z.number().finite().min(0).max(32_400).optional(),
  actualStudySeconds: z.number().finite().min(0).max(14_400).optional(),
  focusedSeconds: z.number().finite().min(0).max(14_400).optional(),
  actualBreakSeconds: z.number().finite().min(0).max(32_400).optional(),
  distractions: z.number().int().min(0).max(10_000).optional(),
  quizResult: z.object({
    score: z.number().int().min(0).max(1000),
    total: z.number().int().min(1).max(1000),
  }).strict().refine((result) => result.score <= result.total).optional(),
}).strict();

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
  ownerId: string;
  accountId: string | null;
  groupId: string | null;
  status: "active";
  correctionVersion: number;
  goal?: string;
  measuredContent?: { goal: string; topic: string };
  topic: string;
  startedAt: string;
  endedAt: string;
  timestampsAreSettlementFacts: true;
  metrics: SessionMetrics;
  measuredMetrics: SessionMetrics;
  metricSources: Record<keyof SessionCorrectionFlags, "measured" | "corrected">;
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

type SessionProjectionRow = { session: unknown; override?: unknown };

function parseSessionProjection(value: unknown): { session: StoredSession; override?: SessionOverride } | null {
  const wrapped = typeof value === "object" && value !== null && "session" in value
    ? value as SessionProjectionRow
    : { session: value };
  const session = parseSession(wrapped.session);
  if (!session) return null;
  if (wrapped.override === undefined || wrapped.override === null) return { session };
  const parsedOverride = storedSessionOverrideSchema.safeParse(wrapped.override);
  return parsedOverride.success ? { session, override: parsedOverride.data } : null;
}

function metricSources(flags: SessionCorrectionFlags): AdminSessionDto["metricSources"] {
  return Object.fromEntries(Object.entries(flags).map(([key, corrected]) =>
    [key, corrected ? "corrected" : "measured"])) as AdminSessionDto["metricSources"];
}

function toMetrics(metrics: SessionMetrics) {
  return {
    ...metrics,
    plannedStudySeconds: metrics.targetSeconds,
  };
}

export function adminSessionDto(value: unknown, includeGoal = false): AdminSessionDto | null {
  const parsed = parseSessionProjection(value);
  if (!parsed) return null;
  const { session, override } = parsed;
  const measured = projectSessionMetrics(session).effectiveMetrics;
  const projected = projectSessionMetrics(session, override);
  const metrics = toMetrics(projected.effectiveMetrics);
  const measuredMetrics = toMetrics(measured);
  const accountId = z.uuid().safeParse(session.userId).success ? session.userId : null;
  return {
    id: session.id,
    ownerId: session.userId,
    accountId,
    groupId: session.groupId ?? null,
    status: "active",
    correctionVersion: projected.correctionVersion,
    ...(includeGoal ? { goal: projected.goal, measuredContent: { goal: session.goal, topic: session.topic } } : {}),
    topic: projected.topic,
    startedAt: new Date(session.started).toISOString(),
    endedAt: new Date(session.ended).toISOString(),
    timestampsAreSettlementFacts: true,
    metrics,
    measuredMetrics,
    metricSources: metricSources(projected.correctionFlags),
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

function addSession(totals: MetricTotals, session: StoredSession, override?: SessionOverride) {
  const metrics = projectSessionMetrics(session, override).effectiveMetrics;
  totals.sessionCount += 1;
  totals.plannedStudySeconds += metrics.targetSeconds;
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
  const projections = values
    .map(parseSessionProjection)
    .filter((projection): projection is { session: StoredSession; override?: SessionOverride } =>
      Boolean(projection) && projection!.override?.removedAt === undefined &&
      projection!.session.started >= window.fromMs && projection!.session.started <= window.asOfMs);
  const daily = new Map<string, MetricTotals>();
  const topics = new Map<string, MetricTotals>();
  for (let offset = 0; offset < days; offset += 1) {
    const dateUtc = utcDate(window.fromMs + offset * dayMilliseconds);
    daily.set(dateUtc, emptyTotals());
  }
  const totals = emptyTotals();
  for (const { session, override } of projections) {
    const projected = projectSessionMetrics(session, override);
    addSession(totals, session, override);
    const day = daily.get(utcDate(session.started));
    if (day) addSession(day, session, override);
    const topic = topics.get(projected.topic) ?? emptyTotals();
    addSession(topic, session, override);
    topics.set(projected.topic, topic);
  }
  return {
    days,
    timezone: "UTC",
    analysisLimit: ADMIN_REPORT_SESSION_LIMIT,
    fromUtc: window.fromUtc,
    asOfUtc: window.asOfUtc,
    matchingSessionCount,
    recordsAnalyzed: projections.length,
    truncated: matchingSessionCount > projections.length,
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
  return db.$queryRaw<{ session: unknown; override: unknown }[]>`
    SELECT entry.value AS session, a.state->'sessionOverrides'->entry.key AS override
    FROM adventure_state a
    CROSS JOIN LATERAL jsonb_each(
      CASE WHEN jsonb_typeof(a.state->'sessions') = 'object'
        THEN a.state->'sessions' ELSE '{}'::jsonb END
    ) AS entry(key, value)
    WHERE a.id = 1
      AND CASE WHEN entry.value->>'started' ~ '^[0-9]{1,16}$'
        THEN (entry.value->>'started')::bigint >= ${fromMs}
          AND (entry.value->>'started')::bigint <= ${asOfMs}
        ELSE false END
      AND (${filters.accountId ?? null}::text IS NULL OR entry.value->>'userId' = ${filters.accountId ?? null})
      AND (${filters.groupId ?? null}::text IS NULL OR entry.value->>'groupId' = ${filters.groupId ?? null})
      AND NOT COALESCE((a.state->'sessionOverrides'->entry.key) ? 'removedAt', false)
    ORDER BY CASE WHEN entry.value->>'started' ~ '^[0-9]{1,16}$'
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
      AND CASE WHEN entry.value->>'started' ~ '^[0-9]{1,16}$'
        THEN (entry.value->>'started')::bigint >= ${fromMs}
          AND (entry.value->>'started')::bigint <= ${asOfMs}
        ELSE false END
      AND (${filters.accountId ?? null}::text IS NULL OR entry.value->>'userId' = ${filters.accountId ?? null})
      AND (${filters.groupId ?? null}::text IS NULL OR entry.value->>'groupId' = ${filters.groupId ?? null})
      AND NOT COALESCE((a.state->'sessionOverrides'->entry.key) ? 'removedAt', false)`;
}

type SessionDurationBasis = "planned" | "actual" | undefined;

function sessionElapsedProjectionSql() {
  return Prisma.sql`
    CROSS JOIN LATERAL (
      SELECT
        CASE WHEN entry.value->>'started' ~ '^[0-9]{1,16}$'
          THEN (entry.value->>'started')::double precision ELSE 0 END AS started_ms,
        CASE WHEN entry.value->>'ended' ~ '^[0-9]{1,16}$'
          THEN (entry.value->>'ended')::double precision ELSE 0 END AS ended_ms,
        CASE WHEN entry.value->>'target' ~ '^[0-9]{1,5}$'
          THEN (entry.value->>'target')::double precision ELSE 0 END AS target_seconds
    ) AS trip_time
    CROSS JOIN LATERAL (
      SELECT
        CASE WHEN entry.value->'breakPlan'->>'count' ~ '^[0-9]{1,2}$'
          THEN (entry.value->'breakPlan'->>'count')::integer ELSE -1 END AS break_count,
        CASE WHEN entry.value->'breakPlan'->>'seconds' ~ '^[0-9]{1,4}$'
          THEN (entry.value->'breakPlan'->>'seconds')::integer ELSE -1 END AS break_seconds
    ) AS plan_values
    CROSS JOIN LATERAL (
      SELECT jsonb_typeof(entry.value->'breakPlan') = 'object'
        AND plan_values.break_count BETWEEN 0 AND 10
        AND plan_values.break_seconds BETWEEN 60 AND 1800
        AND plan_values.break_count < FLOOR(trip_time.target_seconds / 60) AS is_valid
    ) AS break_plan
    CROSS JOIN LATERAL (
      SELECT GREATEST(0, (trip_time.ended_ms - trip_time.started_ms) / 1000.0) AS wall_seconds
    ) AS trip_duration
    CROSS JOIN LATERAL (
      SELECT CASE WHEN break_plan.is_valid THEN
        COALESCE((
          SELECT SUM(GREATEST(0, LEAST(trip_time.ended_ms, windows.window_start_ms + plan_values.break_seconds * 1000.0)
            - windows.window_start_ms) / 1000.0)
          FROM generate_series(1, plan_values.break_count) AS break_window(window_index)
          CROSS JOIN LATERAL (
            SELECT trip_time.started_ms
              + ROUND((break_window.window_index * trip_time.target_seconds * 1000.0)
                / (plan_values.break_count + 1))
              + (break_window.window_index - 1) * plan_values.break_seconds * 1000.0 AS window_start_ms
          ) AS windows
        ), 0)
      ELSE LEAST(trip_duration.wall_seconds, COALESCE((
        SELECT SUM(GREATEST(0,
          LEAST(trip_time.ended_ms, CASE WHEN segment.value->>'end' ~ '^[0-9]{1,16}$'
            THEN (segment.value->>'end')::double precision ELSE 0 END)
          - GREATEST(trip_time.started_ms, CASE WHEN segment.value->>'start' ~ '^[0-9]{1,16}$'
            THEN (segment.value->>'start')::double precision ELSE 0 END)) / 1000.0)
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(entry.value->'segments') = 'array'
          THEN entry.value->'segments' ELSE '[]'::jsonb END) AS segment(value)
        WHERE segment.value->>'kind' = 'break'
      ), 0)) END AS actual_break_seconds
    ) AS break_duration
    CROSS JOIN LATERAL (
      SELECT LEAST(trip_time.target_seconds,
        GREATEST(0, trip_duration.wall_seconds - break_duration.actual_break_seconds)) AS actual_study_seconds
    ) AS study_duration
    CROSS JOIN LATERAL (
      SELECT GREATEST(
        LEAST(trip_time.target_seconds + CASE WHEN break_plan.is_valid
          THEN plan_values.break_count * plan_values.break_seconds ELSE 0 END, trip_duration.wall_seconds),
        study_duration.actual_study_seconds + break_duration.actual_break_seconds
      ) AS base_elapsed_seconds
    ) AS base_duration
    CROSS JOIN LATERAL (
      SELECT CASE WHEN jsonb_typeof(a.state->'sessionOverrides'->entry.key->'elapsedSeconds') = 'number'
        THEN (a.state->'sessionOverrides'->entry.key->>'elapsedSeconds')::double precision
        ELSE base_duration.base_elapsed_seconds END AS elapsed_seconds
    ) AS effective_duration`;
}

function sessionDurationFilterSql(basis: SessionDurationBasis) {
  if (basis === "planned") {
    return Prisma.sql`AND COALESCE(
      CASE WHEN jsonb_typeof(a.state->'sessionOverrides'->entry.key->'targetSeconds') = 'number'
        THEN (a.state->'sessionOverrides'->entry.key->>'targetSeconds')::double precision END,
      CASE WHEN entry.value->>'target' ~ '^[0-9]{1,5}$'
        THEN (entry.value->>'target')::double precision END
    ) <= 60`;
  }
  if (basis === "actual") return Prisma.sql`AND effective_duration.elapsed_seconds <= 60`;
  return Prisma.empty;
}

function sessionManagementBaseWhere(fromMs: number, asOfMs: number, accountId?: string, groupId?: string) {
  return Prisma.sql`
    WHERE a.id = 1
      AND CASE WHEN entry.value->>'started' ~ '^[0-9]{1,16}$'
        THEN (entry.value->>'started')::numeric BETWEEN ${fromMs} AND ${asOfMs}
        ELSE false END
      AND CASE WHEN entry.value->>'ended' ~ '^[0-9]{1,16}$'
        THEN (entry.value->>'ended')::numeric <= 8640000000000000
        ELSE false END
      AND CASE WHEN entry.value->>'target' ~ '^[0-9]{1,5}$'
        THEN (entry.value->>'target')::numeric BETWEEN 60 AND 14400
        ELSE false END
      AND CASE WHEN entry.value->>'started' ~ '^[0-9]{1,16}$'
        AND entry.value->>'ended' ~ '^[0-9]{1,16}$'
        THEN (entry.value->>'started')::numeric <= (entry.value->>'ended')::numeric
        ELSE false END
      AND (${accountId ?? null}::text IS NULL OR entry.value->>'userId' = ${accountId ?? null})
      AND (${groupId ?? null}::text IS NULL OR entry.value->>'groupId' = ${groupId ?? null})
      AND NOT COALESCE((a.state->'sessionOverrides'->entry.key) ? 'removedAt', false)`;
}

async function reportData(db: PrismaClient, days: AdminPeriod, asOf: Date, filters: AdminSessionFilters = {}) {
  const window = adminReportWindow(days, asOf);
  const [rows, counts] = await Promise.all([
    readWindowSessions(db, window.fromMs, window.asOfMs, ADMIN_REPORT_SESSION_LIMIT + 1, filters),
    countWindowSessions(db, window.fromMs, window.asOfMs, filters),
  ]);
  const values = rows.slice(0, ADMIN_REPORT_SESSION_LIMIT);
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
    if (mutation.action === "deletion" && mutation.deleted)
      await tx.publicMaterialSummaryShare.updateMany({
        where: { user_id: target.id, summary: { not: null } },
        data: { summary: null, approved_at: null, version: { increment: 1 } },
      });

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

type SessionCorrectionChanges = z.infer<typeof sessionCorrectionBodySchema>["changes"];

function mergeSessionOverride(
  current: SessionOverride | undefined,
  changes: SessionCorrectionChanges,
  version: number,
): SessionOverride {
  const next: SessionOverride = { ...(current ?? {}), version };
  if (changes.goal !== undefined) {
    if (changes.goal === null) delete next.goal;
    else next.goal = changes.goal;
  }
  if (changes.topic !== undefined) {
    if (changes.topic === null) delete next.topic;
    else next.topic = changes.topic;
  }
  if (changes.targetSeconds !== undefined) {
    if (changes.targetSeconds === null) delete next.targetSeconds;
    else next.targetSeconds = changes.targetSeconds;
  }
  if (changes.elapsedSeconds !== undefined) {
    if (changes.elapsedSeconds === null) delete next.elapsedSeconds;
    else next.elapsedSeconds = changes.elapsedSeconds;
  }
  if (changes.actualStudySeconds !== undefined) {
    if (changes.actualStudySeconds === null) delete next.actualStudySeconds;
    else next.actualStudySeconds = changes.actualStudySeconds;
  }
  if (changes.focusedSeconds !== undefined) {
    if (changes.focusedSeconds === null) delete next.focusedSeconds;
    else next.focusedSeconds = changes.focusedSeconds;
  }
  if (changes.actualBreakSeconds !== undefined) {
    if (changes.actualBreakSeconds === null) delete next.actualBreakSeconds;
    else next.actualBreakSeconds = changes.actualBreakSeconds;
  }
  if (changes.distractions !== undefined) {
    if (changes.distractions === null) delete next.distractions;
    else next.distractions = changes.distractions;
  }
  if (changes.quizResult !== undefined) {
    if (changes.quizResult === null) delete next.quizResult;
    else next.quizResult = changes.quizResult;
  }
  return next;
}

function sessionAuditState(session: StoredSession, override: SessionOverride | undefined) {
  const projected = projectSessionMetrics(session, override);
  return {
    status: "active" as const,
    correctionVersion: projected.correctionVersion,
    goal: projected.goal,
    topic: projected.topic,
    metrics: projected.effectiveMetrics,
  };
}

function validateEffectiveCorrection(session: StoredSession, override: SessionOverride) {
  const metrics = projectSessionMetrics(session, override).effectiveMetrics;
  if (!Number.isFinite(metrics.elapsedSeconds) || !Number.isFinite(metrics.actualStudySeconds) ||
    !Number.isFinite(metrics.focusedSeconds) || !Number.isFinite(metrics.actualBreakSeconds) ||
    !Number.isFinite(metrics.targetSeconds) || !Number.isFinite(metrics.distractions))
    throw new ApiError(422, "validation-error", "Các chỉ số đã chỉnh sửa phải là số hữu hạn.");
  if (metrics.actualStudySeconds < 0 || metrics.actualStudySeconds > metrics.targetSeconds)
    throw new ApiError(422, "validation-error", "Thời gian học phải nằm trong khoảng từ 0 đến thời lượng mục tiêu đã chỉnh.");
  if (metrics.focusedSeconds < 0 || metrics.focusedSeconds > metrics.actualStudySeconds)
    throw new ApiError(422, "validation-error", "Thời gian tập trung không thể lớn hơn thời gian học.");
  if (metrics.actualBreakSeconds < 0 || metrics.elapsedSeconds < metrics.actualStudySeconds + metrics.actualBreakSeconds)
    throw new ApiError(422, "validation-error", "Thời lượng đã trôi qua phải bao gồm thời gian học và thời gian nghỉ.");
  if (metrics.distractions < 0)
    throw new ApiError(422, "validation-error", "Số lần rời phiên không thể nhỏ hơn 0.");
  if ((metrics.quizScore === null) !== (metrics.quizTotal === null) ||
    (metrics.quizScore !== null && metrics.quizTotal !== null && metrics.quizScore > metrics.quizTotal))
    throw new ApiError(422, "validation-error", "Điểm quiz và tổng số câu không hợp lệ.");
  return metrics;
}

async function mutateAdminSession(
  db: PrismaClient,
  actorId: string,
  sessionId: string,
  expectedVersion: number,
  reason: string,
  action: "correction" | "removal",
  changes: SessionCorrectionChanges | undefined,
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

    const stateRows = await tx.$queryRaw<{ state: World }[]>`
      SELECT state FROM adventure_state WHERE id = 1 FOR UPDATE`;
    if (!stateRows[0])
      throw new ApiError(503, "service-unavailable", "Adventure state is unavailable");
    const world = stateRows[0].state;
    const rawSession = world.sessions?.[sessionId];
    if (!rawSession)
      throw new ApiError(404, "not-found", "Không tìm thấy phiên học.");
    const parsedSession = storedSessionSchema.safeParse(rawSession);
    if (!parsedSession.success || parsedSession.data.id !== sessionId)
      throw new ApiError(500, "internal-error", "Dữ liệu phiên học không hợp lệ.");
    const session = parsedSession.data;
    const storedOverride = world.sessionOverrides?.[sessionId];
    const parsedOverride = storedOverride === undefined
      ? undefined
      : storedSessionOverrideSchema.safeParse(storedOverride);
    if (parsedOverride && !parsedOverride.success)
      throw new ApiError(500, "internal-error", "Dữ liệu chỉnh sửa phiên học không hợp lệ.");
    const current = parsedOverride?.data;
    if (current?.removedAt !== undefined)
      throw new ApiError(410, "session-removed", "Phiên học này đã được quản trị viên gỡ khỏi lịch sử.");
    const beforeVersion = current?.version ?? 0;
    if (beforeVersion !== expectedVersion)
      throw new ApiError(409, "conflict", "Phiên học đã được chỉnh sửa. Hãy tải lại rồi thử lại.");

    const beforeState = sessionAuditState(session, current);
    let nextOverride: SessionOverride;
    let afterState: ReturnType<typeof sessionAuditState> | { status: "removed"; correctionVersion: number };
    if (action === "correction") {
      if (!changes)
        throw new ApiError(400, "validation-error", "Hãy chọn ít nhất một mục cần chỉnh sửa.");
      nextOverride = mergeSessionOverride(current, changes, beforeVersion + 1);
      const projected = projectSessionMetrics(session, nextOverride);
      const currentTopic = projectSessionMetrics(session, current).topic;
      if (projected.topic !== currentTopic && changes.topic !== null && changes.topic !== undefined) {
        const registeredTopic = await tx.topic.findUnique({
          where: { id: projected.topic },
          select: { id: true },
        });
        if (!registeredTopic)
          throw new ApiError(422, "validation-error", "Chủ đề đã chọn không tồn tại trong danh mục.");
      }
      validateEffectiveCorrection(session, nextOverride);
      afterState = sessionAuditState(session, nextOverride);
    } else {
      nextOverride = { ...(current ?? {}), version: beforeVersion + 1, removedAt: Date.now() };
      afterState = { status: "removed", correctionVersion: nextOverride.version };
    }

    world.sessionOverrides ??= {};
    world.sessionOverrides[sessionId] = nextOverride;
    world.revision = (world.revision ?? 0) + 1;
    await tx.$executeRaw`UPDATE adventure_state SET state = ${JSON.stringify(world)}::jsonb WHERE id = 1`;
    if (action === "removal") {
      const owner = z.uuid().safeParse(session.userId);
      if (owner.success)
        await tx.publicMaterialSummaryShare.updateMany({
          where: { user_id: owner.data, session_id: sessionId, summary: { not: null } },
          data: { summary: null, approved_at: null, version: { increment: 1 } },
        });
    }
    await tx.adminSessionActionAudit.create({
      data: {
        actor_user_id: actor.id,
        target_owner_id: session.userId,
        session_id: sessionId,
        action,
        before_version: beforeVersion,
        after_version: nextOverride.version,
        before_state: beforeState,
        after_state: afterState,
        reason,
      },
    });

    const accountOwner = z.uuid().safeParse(session.userId);
    return action === "removal"
      ? { id: sessionId, ownerId: session.userId, accountId: accountOwner.success ? session.userId : null,
          status: "removed" as const, correctionVersion: nextOverride.version }
      : adminSessionDto({ session, override: nextOverride }, true);
  }, { timeout: 15000 });
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

  app.get("/api/v1/admin/sessions/:sessionId", adminOptions, async (request) => {
    const { sessionId } = z.object({ sessionId: z.uuid() }).parse(request.params);
    const rows = await db.$queryRaw<{ session: unknown; override: unknown }[]>`
      SELECT state->'sessions'->${sessionId} AS session,
        state->'sessionOverrides'->${sessionId} AS override
      FROM adventure_state WHERE id = 1`;
    const row = rows[0];
    if (!row || row.session === null)
      throw new ApiError(404, "not-found", "Không tìm thấy phiên học.");
    const parsed = parseSessionProjection(row);
    if (!parsed)
      throw new ApiError(500, "internal-error", "Dữ liệu phiên học không hợp lệ.");
    if (parsed.override?.removedAt !== undefined)
      throw new ApiError(410, "session-removed", "Phiên học này đã được quản trị viên gỡ khỏi lịch sử.");
    const result = adminSessionDto(row, true);
    if (!result)
      throw new ApiError(500, "internal-error", "Dữ liệu phiên học không hợp lệ.");
    return result;
  });

  app.get("/api/v1/admin/sessions/:sessionId/audit", adminOptions, async (request) => {
    const { sessionId } = z.object({ sessionId: z.uuid() }).parse(request.params);
    const { limit, offset } = sessionAuditQuerySchema.parse(request.query);
    const where = { session_id: sessionId };
    const [rows, total] = await Promise.all([
      db.adminSessionActionAudit.findMany({
        where,
        select: {
          actor_user_id: true,
          target_owner_id: true,
          session_id: true,
          action: true,
          before_version: true,
          after_version: true,
          before_state: true,
          after_state: true,
          reason: true,
          created_at: true,
        },
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        take: limit,
        skip: offset,
      }),
      db.adminSessionActionAudit.count({ where }),
    ]);
    return {
      actions: rows.map((row) => ({
        actorId: row.actor_user_id,
        targetOwnerId: row.target_owner_id,
        sessionId: row.session_id,
        action: row.action,
        beforeVersion: row.before_version,
        afterVersion: row.after_version,
        before: row.before_state,
        after: row.after_state,
        reason: row.reason,
        createdAt: row.created_at.toISOString(),
      })),
      total,
      limit,
      offset,
    };
  });

  app.patch("/api/v1/admin/sessions/:sessionId", adminOptions, async (request) => {
    const { sessionId } = z.object({ sessionId: z.uuid() }).parse(request.params);
    const body = sessionCorrectionBodySchema.parse(request.body);
    return mutateAdminSession(db, request.userId, sessionId, body.expectedVersion,
      body.reason, "correction", body.changes, admins);
  });

  app.delete("/api/v1/admin/sessions/:sessionId", adminOptions, async (request) => {
    const { sessionId } = z.object({ sessionId: z.uuid() }).parse(request.params);
    const body = sessionRemovalBodySchema.parse(request.body);
    return mutateAdminSession(db, request.userId, sessionId, body.expectedVersion,
      body.reason, "removal", undefined, admins);
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
    const { days, accountId, groupId, durationBasis, limit, offset } = sessionQuery(request.query);
    const asOfMs = Date.now();
    const fromMs = days === "all" ? 0 : asOfMs - Number(days) * dayMilliseconds;
    const fromSessions = Prisma.sql`FROM adventure_state a
      CROSS JOIN LATERAL jsonb_each(
        CASE WHEN jsonb_typeof(a.state->'sessions') = 'object'
          THEN a.state->'sessions' ELSE '{}'::jsonb END
      ) AS entry(key, value)`;
    const metricProjection = durationBasis === "actual" ? sessionElapsedProjectionSql() : Prisma.empty;
    const where = sessionManagementBaseWhere(fromMs, asOfMs, accountId, groupId);
    const durationFilter = sessionDurationFilterSql(durationBasis);
    const [rows, counts] = await Promise.all([
      db.$queryRaw<{ session: unknown; override: unknown }[]>`
        SELECT entry.value AS session, a.state->'sessionOverrides'->entry.key AS override
        ${fromSessions}
        ${metricProjection}
        ${where}
        ${durationFilter}
        ORDER BY CASE WHEN entry.value->>'started' ~ '^[0-9]{1,16}$'
          THEN (entry.value->>'started')::numeric ELSE 0 END DESC, entry.key DESC
        LIMIT ${limit} OFFSET ${offset}`,
      db.$queryRaw<{ total: number }[]>`
        SELECT COUNT(*)::int AS total
        ${fromSessions}
        ${metricProjection}
        ${where}
        ${durationFilter}`,
    ]);
    const total = counts[0]?.total ?? 0;
    return {
      sessions: rows.map((row) => adminSessionDto(row)).filter((session): session is AdminSessionDto => Boolean(session)),
      total,
      limit,
      offset,
      days: days === "all" ? "all" as const : Number(days) as 7 | 30 | 90,
      window: days === "all" ? "all" as const : `${days}d`,
      fromUtc: new Date(fromMs).toISOString(),
      asOfUtc: new Date(asOfMs).toISOString(),
      durationBasis: durationBasis ?? null,
      durationThresholdSeconds: durationBasis ? 60 : null,
      truncated: total > ADMIN_MAX_OFFSET + limit,
      timezone: "UTC" as const,
    };
  });
}
