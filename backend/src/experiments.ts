import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { config } from "./config.js";
import { isValidBreakPlan, projectSessionMetrics, type Session, type SessionOverride } from "./adventure/domain.js";

export function goalSummary(goal: string): string {
  const text = goal.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/gu, " ").trim();
  const characters = Array.from(text);
  return characters.length > 200 ? characters.slice(0, 199).join("") + "…" : text;
}

export function tripIdentity(userId: string, sessionId: string, secret: string) {
  const id = createHmac("sha256", secret).update(`trip:${userId}:${sessionId}`).digest("hex");
  return { id, tripCode: `V-${id.slice(0, 12).toUpperCase()}` };
}

export function experimentRecord(session: Session, secret: string, override?: SessionOverride, documentSummary?: string) {
  const projected = projectSessionMetrics(session, override);
  const metrics = projected.effectiveMetrics;
  const identity = tripIdentity(session.userId, session.id, secret);
  const testerHash = createHmac("sha256", secret).update(`tester:${session.userId}`).digest("hex");
  const hasBreakPlan = session.breakPlan != null;
  const validBreakPlan = hasBreakPlan && isValidBreakPlan(session.breakPlan, session.target)
    ? session.breakPlan
    : undefined;

  return {
    ...identity,
    testerCode: `T-${testerHash.slice(0, 10).toUpperCase()}`,
    goalSummary: goalSummary(projected.goal),
    topic: projected.topic,
    targetSeconds: metrics.targetSeconds,
    elapsedSeconds: metrics.elapsedSeconds,
    studyElapsedSeconds: metrics.actualStudySeconds,
    breakSeconds: metrics.actualBreakSeconds,
    plannedBreakSeconds: validBreakPlan ? validBreakPlan.count * validBreakPlan.seconds : 0,
    plannedBreakCount: hasBreakPlan ? validBreakPlan?.count ?? null : 0,
    focusedSeconds: metrics.focusedSeconds,
    distractions: metrics.distractions,
    deviceCategory: session.deviceCategory ?? null,
    completed: metrics.completed,
    quizScore: metrics.quizScore,
    quizTotal: metrics.quizTotal,
    correctionFlags: {
      goal: projected.correctionFlags.goal,
      topic: projected.correctionFlags.topic,
      targetSeconds: projected.correctionFlags.targetSeconds,
      elapsedSeconds: projected.correctionFlags.elapsedSeconds,
      actualStudySeconds: projected.correctionFlags.actualStudySeconds,
      focusedSeconds: projected.correctionFlags.focusedSeconds,
      actualBreakSeconds: projected.correctionFlags.actualBreakSeconds,
      distractions: projected.correctionFlags.distractions,
      quizResult: projected.correctionFlags.quizResult,
    },
    startedAt: new Date(session.started).toISOString(),
    endedAt: new Date(session.ended).toISOString(),
    recordedAt: new Date(session.ended).toISOString(),
    ...(documentSummary === undefined ? {} : { documentSummary }),
  };
}

type PublicExperiment = ReturnType<typeof experimentRecord>;

export function experimentCsv(rows: readonly PublicExperiment[]) {
  const headers = ["trip_code", "tester_code", "goal_summary", "topic", "started_at", "ended_at",
    "target_seconds", "elapsed_seconds", "study_elapsed_seconds", "break_seconds", "planned_break_seconds",
    "focused_seconds", "distractions", "device_category", "timer_completed", "quiz_score", "quiz_total",
    "goal_corrected", "topic_corrected", "target_seconds_corrected", "elapsed_seconds_corrected", "study_seconds_corrected",
    "focus_seconds_corrected", "break_seconds_corrected", "distractions_corrected", "quiz_result_corrected"];
  const cell = (value: unknown) => `"${String(value ?? "").replace(/^\s*[=+@-]/, "'$&").replaceAll('"', '""')}"`;
  return "\uFEFF" + [headers.join(","), ...rows.map(row => [row.tripCode, row.testerCode, row.goalSummary,
    row.topic, row.startedAt, row.endedAt, row.targetSeconds, row.elapsedSeconds, row.studyElapsedSeconds,
    row.breakSeconds, row.plannedBreakSeconds, row.focusedSeconds, row.distractions, row.deviceCategory,
    row.completed, row.quizScore, row.quizTotal, row.correctionFlags.goal, row.correctionFlags.topic, row.correctionFlags.targetSeconds,
    row.correctionFlags.elapsedSeconds, row.correctionFlags.actualStudySeconds, row.correctionFlags.focusedSeconds,
    row.correctionFlags.actualBreakSeconds, row.correctionFlags.distractions, row.correctionFlags.quizResult]
    .map(cell).join(","))].join("\r\n");
}

export function experimentRoutes(app: FastifyInstance, db: PrismaClient) {
  const readRows = (limit: number, offset: number) => db.$queryRaw<{
    session: Session;
    override: SessionOverride | null;
  }[]>`
    SELECT entry.value AS session, a.state->'sessionOverrides'->entry.key AS override
    FROM adventure_state a CROSS JOIN LATERAL jsonb_each(a.state->'sessions') entry
    WHERE a.id = 1 AND NOT COALESCE((a.state->'sessionOverrides'->entry.key) ? 'removedAt', false)
    ORDER BY CASE WHEN entry.value->>'ended' ~ '^[0-9]{1,16}$'
      THEN (entry.value->>'ended')::bigint ELSE 0 END DESC, entry.key DESC
    LIMIT ${limit} OFFSET ${offset}`;

  app.get("/api/v1/experiments", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const { limit, offset } = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).max(100000).default(0),
    }).parse(req.query);
    const rows = await readRows(limit, offset);
    const pairs = rows.flatMap(({ session }) =>
      typeof session?.id === "string" && typeof session?.userId === "string"
        ? [Prisma.sql`(share.user_id::text = ${session.userId} AND share.session_id = ${session.id})`]
        : [],
    );
    const shares = pairs.length
      ? await db.$queryRaw<{ user_id: string; session_id: string; summary: string }[]>`
        SELECT share.user_id::text AS user_id, share.session_id, share.summary
        FROM public_material_summary_shares share
        JOIN users owner ON owner.id = share.user_id
        WHERE owner.deleted_at IS NULL AND share.summary IS NOT NULL
          AND (${Prisma.join(pairs, " OR ")})`
      : [];
    const summaryByOwnerSession = new Map(shares.map((share) =>
      [JSON.stringify([share.user_id, share.session_id]), share.summary] as const,
    ));
    const count = await db.$queryRaw<{ total: number }[]>`
      SELECT COUNT(*)::int AS total FROM adventure_state a
      CROSS JOIN LATERAL jsonb_each(a.state->'sessions') entry
      WHERE a.id = 1 AND NOT COALESCE((a.state->'sessionOverrides'->entry.key) ? 'removedAt', false)`;
    return {
      runs: rows.map(({ session, override }) => experimentRecord(
        session,
        config.JWT_SECRET,
        override ?? undefined,
        summaryByOwnerSession.get(JSON.stringify([session.userId, session.id])),
      )),
      total: count[0]?.total ?? 0,
      limit,
      offset,
    };
  });

  app.get("/api/v1/experiments/export.csv", async (_req, reply) => {
    const rows = await readRows(10000, 0);
    return reply.header("Content-Disposition", 'attachment; filename="viendu-trip-history.csv"')
      .type("text/csv; charset=utf-8")
      .send(experimentCsv(rows.map(({ session, override }) => experimentRecord(session, config.JWT_SECRET, override ?? undefined))));
  });
}
