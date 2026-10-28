import type { FastifyInstance } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { projectSessionMetrics, type SessionOverride, type SessionProjectionSource } from "./adventure/domain.js";
import { studyTopics } from "./adventure/topics.js";

const PUBLIC_OTHER_TOPIC = "Khác";
const PUBLIC_REPORT_ANALYSIS_LIMIT = 5_000;
const dayMilliseconds = 86_400_000;
export type PublicReportPeriod = 7 | 30 | 90;
const periodSchema = z.enum(["7", "30", "90"]).default("7")
  .transform((value) => Number(value) as PublicReportPeriod);
const metricKeys = [
  "sessionCount",
  "plannedStudySeconds",
  "actualStudySeconds",
  "focusedSeconds",
  "plannedBreakSeconds",
  "actualBreakSeconds",
  "distractions",
  "completedSessions",
  "completionPercent",
  "gradedQuizSessions",
  "quizCoveragePercent",
  "quizScore",
  "quizTotal",
  "quizScorePercent",
] as const;

export type PublicReportTotals = {
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

export type PublicReport = {
  days: PublicReportPeriod;
  analysisLimit: number;
  matchingSessionCount: number;
  recordsAnalyzed: number;
  truncated: boolean;
  totals: PublicReportTotals;
  daily: (PublicReportTotals & { dateUtc: string })[];
  topics: (PublicReportTotals & { topic: string })[];
};

const segmentSchema = z.object({
  start: z.number().int().nonnegative().max(8.64e15),
  end: z.number().int().nonnegative().max(8.64e15),
  kind: z.enum(["focus", "material", "break", "distraction"]),
}).strip();
const breakPlanSchema = z.object({
  count: z.number().int().min(0).max(10),
  seconds: z.number().int().min(60).max(1800),
}).strip();
const quizSchema = z.object({
  score: z.number().int().min(0).max(1000),
  total: z.number().int().min(1).max(1000),
}).strip().refine((result) => result.score <= result.total);
const storedSessionProjectionSchema = z.object({
  topic: z.string().trim().min(1).max(100),
  started: z.number().int().nonnegative().max(8.64e15),
  ended: z.number().int().nonnegative().max(8.64e15),
  target: z.number().int().min(60).max(14_400),
  seconds: z.number().finite().nonnegative().optional(),
  distractions: z.number().int().min(0).max(10_000).optional(),
  breakPlan: breakPlanSchema.optional(),
  segments: z.array(segmentSchema).max(2_000).default([]),
  quiz: quizSchema.optional(),
}).strip().refine((session) => session.ended >= session.started);
const storedOverrideSchema = z.object({
  version: z.number().int().nonnegative(),
  topic: z.string().trim().min(1).max(100).optional(),
  targetSeconds: z.number().int().min(60).max(14_400).optional(),
  elapsedSeconds: z.number().finite().min(0).max(32_400).optional(),
  actualStudySeconds: z.number().finite().min(0).max(14_400).optional(),
  focusedSeconds: z.number().finite().min(0).max(14_400).optional(),
  actualBreakSeconds: z.number().finite().min(0).max(32_400).optional(),
  distractions: z.number().int().min(0).max(10_000).optional(),
  quizResult: quizSchema.optional(),
}).strip();
const projectionRowSchema = z.object({
  session: storedSessionProjectionSchema,
  override: storedOverrideSchema.nullable().optional(),
}).strip();

type MutableTotals = Omit<PublicReportTotals, "completionPercent" | "quizCoveragePercent" | "quizScorePercent">;

function emptyTotals(): MutableTotals {
  return {
    sessionCount: 0,
    plannedStudySeconds: 0,
    actualStudySeconds: 0,
    focusedSeconds: 0,
    plannedBreakSeconds: 0,
    actualBreakSeconds: 0,
    distractions: 0,
    completedSessions: 0,
    gradedQuizSessions: 0,
    quizScore: 0,
    quizTotal: 0,
  };
}

function addMetrics(totals: MutableTotals, row: SessionProjectionSource, override?: SessionOverride) {
  const metrics = projectSessionMetrics(row, override).effectiveMetrics;
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

function finishTotals(totals: MutableTotals): PublicReportTotals {
  const roundedSeconds = (value: number) => Math.round(value * 10) / 10;
  const roundedPercent = (value: number) => Math.round(value * 1000) / 10;
  return {
    ...totals,
    plannedStudySeconds: roundedSeconds(totals.plannedStudySeconds),
    actualStudySeconds: roundedSeconds(totals.actualStudySeconds),
    focusedSeconds: roundedSeconds(totals.focusedSeconds),
    plannedBreakSeconds: roundedSeconds(totals.plannedBreakSeconds),
    actualBreakSeconds: roundedSeconds(totals.actualBreakSeconds),
    completionPercent: totals.sessionCount
      ? roundedPercent(totals.completedSessions / totals.sessionCount)
      : 0,
    quizCoveragePercent: totals.sessionCount
      ? roundedPercent(totals.gradedQuizSessions / totals.sessionCount)
      : 0,
    quizScorePercent: totals.quizTotal
      ? roundedPercent(totals.quizScore / totals.quizTotal)
      : null,
  };
}

function registeredTopicLabel(topic: string): string {
  return studyTopics.find((registered) => registered.id === topic)?.name ?? PUBLIC_OTHER_TOPIC;
}

function utcDate(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function reportWindow(days: PublicReportPeriod, asOf: Date) {
  const asOfMs = asOf.getTime();
  if (!Number.isFinite(asOfMs)) throw new Error("Invalid report time");
  const utcToday = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  return { fromMs: utcToday - (days - 1) * dayMilliseconds, asOfMs };
}

export function buildPublicReport(
  values: readonly unknown[],
  days: PublicReportPeriod = 7,
  asOf = new Date(),
  matchingSessionCount = values.length,
): PublicReport {
  if (![7, 30, 90].includes(days)) throw new Error("Invalid report period");
  const window = reportWindow(days, asOf);
  const totals = emptyTotals();
  let recordsAnalyzed = 0;
  const dailyTotals = new Map<string, MutableTotals>();
  for (let offset = 0; offset < days; offset += 1) {
    dailyTotals.set(utcDate(window.fromMs + offset * dayMilliseconds), emptyTotals());
  }
  const topicTotals = new Map<string, MutableTotals>([
    ...studyTopics.map(({ name }) => [name, emptyTotals()] as const),
    [PUBLIC_OTHER_TOPIC, emptyTotals()],
  ]);

  for (const value of values.slice(0, PUBLIC_REPORT_ANALYSIS_LIMIT)) {
    const parsed = projectionRowSchema.safeParse(value);
    if (!parsed.success) continue;
    const { session, override } = parsed.data;
    if (session.started < window.fromMs || session.started > window.asOfMs) continue;
    recordsAnalyzed += 1;
    const effectiveTopic = override?.topic ?? session.topic;
    addMetrics(totals, session, override ?? undefined);
    const day = dailyTotals.get(utcDate(session.started));
    if (day) addMetrics(day, session, override ?? undefined);
    addMetrics(topicTotals.get(registeredTopicLabel(effectiveTopic))!, session, override ?? undefined);
  }

  return {
    days,
    analysisLimit: PUBLIC_REPORT_ANALYSIS_LIMIT,
    matchingSessionCount,
    recordsAnalyzed,
    truncated: matchingSessionCount > PUBLIC_REPORT_ANALYSIS_LIMIT,
    totals: finishTotals(totals),
    daily: [...dailyTotals].map(([dateUtc, valuesForDay]) => ({ dateUtc, ...finishTotals(valuesForDay) })),
    topics: [...topicTotals].map(([topic, topicValues]) => ({ topic, ...finishTotals(topicValues) })),
  };
}

function csvCell(value: string | number | boolean | null): string {
  const safe = String(value ?? "").replace(/^\s*[=+@-]/u, "'$&").replaceAll('"', '""');
  return `"${safe}"`;
}

export function publicReportCsv(report: PublicReport): string {
  const headers = [
    "section", "dateUtc", "topic", "analysisLimit", "matchingSessionCount", "recordsAnalyzed", "truncated", ...metricKeys,
  ];
  const row = (section: string, dateUtc: string, topic: string, totals: PublicReportTotals) => [
    section,
    dateUtc,
    topic,
    report.analysisLimit,
    report.matchingSessionCount,
    report.recordsAnalyzed,
    report.truncated,
    ...metricKeys.map((key) => totals[key]),
  ].map(csvCell).join(",");
  return "\uFEFF" + [
    headers.join(","),
    row(`Tổng quan ${report.days} ngày`, "", "", report.totals),
    ...report.daily.map((day) => row("Ngày", day.dateUtc, "", day)),
    ...report.topics.map((topic) => row("Chủ đề", "", topic.topic, topic)),
  ].join("\r\n");
}

const publicReportQuerySchema = z.object({ days: periodSchema }).strict();

const publicReportSessionEntries = Prisma.sql`
  FROM adventure_state a
  CROSS JOIN LATERAL jsonb_each(
    CASE WHEN jsonb_typeof(a.state->'sessions') = 'object'
      THEN a.state->'sessions' ELSE '{}'::jsonb END
  ) AS entry(key, value)`;

function publicReportWindowFilter(fromMs: number, asOfMs: number) {
  return Prisma.sql`
    WHERE a.id = 1
      AND CASE WHEN entry.value->>'started' ~ '^[0-9]{1,16}$'
        THEN (entry.value->>'started')::bigint >= ${fromMs}
          AND (entry.value->>'started')::bigint <= ${asOfMs}
        ELSE false END
      AND NOT COALESCE((a.state->'sessionOverrides'->entry.key) ? 'removedAt', false)`;
}

export function publicReportRoutes(app: FastifyInstance, db: PrismaClient) {
  const readReport = async (days: PublicReportPeriod) => {
    const asOf = new Date();
    const { fromMs, asOfMs } = reportWindow(days, asOf);
    const [rows, counts] = await Promise.all([
      db.$queryRaw<{ session: unknown; override: unknown }[]>(Prisma.sql`
      SELECT jsonb_strip_nulls(jsonb_build_object(
        'topic', entry.value->'topic',
        'started', entry.value->'started',
        'ended', entry.value->'ended',
        'target', entry.value->'target',
        'seconds', entry.value->'seconds',
        'distractions', entry.value->'distractions',
        'segments', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'start', segment.value->'start',
            'end', segment.value->'end',
            'kind', segment.value->'kind'
          )), '[]'::jsonb)
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(entry.value->'segments') = 'array'
            THEN entry.value->'segments' ELSE '[]'::jsonb END) AS segment(value)
        ),
        'breakPlan', CASE WHEN jsonb_typeof(entry.value->'breakPlan') = 'object'
          THEN jsonb_build_object(
            'count', entry.value->'breakPlan'->'count',
            'seconds', entry.value->'breakPlan'->'seconds'
          ) END,
        'quiz', CASE WHEN jsonb_typeof(entry.value->'quiz') = 'object'
          THEN jsonb_strip_nulls(jsonb_build_object(
            'score', entry.value->'quiz'->'score',
            'total', entry.value->'quiz'->'total'
          )) END
      )) AS session,
      CASE WHEN jsonb_typeof(a.state->'sessionOverrides'->entry.key) = 'object'
        THEN jsonb_strip_nulls(jsonb_build_object(
          'version', a.state->'sessionOverrides'->entry.key->'version',
          'topic', a.state->'sessionOverrides'->entry.key->'topic',
          'targetSeconds', a.state->'sessionOverrides'->entry.key->'targetSeconds',
          'elapsedSeconds', a.state->'sessionOverrides'->entry.key->'elapsedSeconds',
          'actualStudySeconds', a.state->'sessionOverrides'->entry.key->'actualStudySeconds',
          'focusedSeconds', a.state->'sessionOverrides'->entry.key->'focusedSeconds',
          'actualBreakSeconds', a.state->'sessionOverrides'->entry.key->'actualBreakSeconds',
          'distractions', a.state->'sessionOverrides'->entry.key->'distractions',
          'quizResult', CASE WHEN jsonb_typeof(a.state->'sessionOverrides'->entry.key->'quizResult') = 'object'
            THEN jsonb_strip_nulls(jsonb_build_object(
              'score', a.state->'sessionOverrides'->entry.key->'quizResult'->'score',
              'total', a.state->'sessionOverrides'->entry.key->'quizResult'->'total'
            )) END
        )) END AS override
      ${publicReportSessionEntries}
      ${publicReportWindowFilter(fromMs, asOfMs)}
      ORDER BY CASE WHEN entry.value->>'started' ~ '^[0-9]{1,16}$'
        THEN (entry.value->>'started')::bigint ELSE 0 END DESC, entry.key DESC
      LIMIT ${PUBLIC_REPORT_ANALYSIS_LIMIT}`),
      db.$queryRaw<{ total: number }[]>(Prisma.sql`
        SELECT COUNT(*)::int AS total
        ${publicReportSessionEntries}
        ${publicReportWindowFilter(fromMs, asOfMs)}`),
    ]);
    return buildPublicReport(rows, days, asOf, Number(counts[0]?.total ?? 0));
  };

  const routeOptions = {
    config: { rateLimit: { max: 20, timeWindow: "1 minute", hook: "preHandler" as const } },
    preHandler: async (_request: unknown, reply: { header: (name: string, value: string) => unknown }) => {
      reply.header("Cache-Control", "no-store");
    },
  };
  app.get("/api/v1/public/report", routeOptions, async (request, reply) => {
    const { days } = publicReportQuerySchema.parse(request.query);
    return readReport(days);
  });

  app.get("/api/v1/public/report/export.csv", routeOptions, async (request, reply) => {
    const { days } = publicReportQuerySchema.parse(request.query);
    return reply
      .header("Content-Disposition", 'attachment; filename="viendu-public-report.csv"')
      .type("text/csv; charset=utf-8")
      .send(publicReportCsv(await readReport(days)));
  });
}
