import { createHmac } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "./errors.js";
import { config } from "./config.js";
import {
  isSessionRemoved,
  isValidBreakPlan,
  projectSessionMetrics,
  type Session,
  type SessionOverride,
  type World,
} from "./adventure/domain.js";

export function tripIdentity(userId: string, sessionId: string, secret: string) {
  const id = createHmac("sha256", secret).update(`trip:${userId}:${sessionId}`).digest("hex");
  return { id, tripCode: `V-${id.slice(0, 12).toUpperCase()}` };
}

export function experimentRecord(
  session: Session,
  owner: string,
  secret: string,
  completionPercent: number | null,
  override?: SessionOverride,
) {
  if (session.userId !== owner)
    throw new ApiError(404, "not-found", "Không tìm thấy phiên học của bạn.");

  const identity = tripIdentity(owner, session.id, secret);
  const projected = projectSessionMetrics(session, override);
  const metrics = projected.effectiveMetrics;
  const breakPlan = session.breakPlan;
  const validBreakPlan = breakPlan !== undefined && isValidBreakPlan(breakPlan, session.target)
    ? breakPlan
    : undefined;
  const plannedBreakSeconds = validBreakPlan
    ? validBreakPlan.count * validBreakPlan.seconds
    : null;
  const breakSeconds = validBreakPlan || projected.correctionFlags.actualBreakSeconds
    ? metrics.actualBreakSeconds
    : metrics.actualBreakSeconds || null;
  const correctionFlags = {
    topic: projected.correctionFlags.topic,
    targetSeconds: projected.correctionFlags.targetSeconds,
    elapsedSeconds: projected.correctionFlags.elapsedSeconds,
    actualStudySeconds: projected.correctionFlags.actualStudySeconds,
    focusedSeconds: projected.correctionFlags.focusedSeconds,
    actualBreakSeconds: projected.correctionFlags.actualBreakSeconds,
    distractions: projected.correctionFlags.distractions,
    quizResult: projected.correctionFlags.quizResult,
  };

  return {
    ...identity,
    testerCode: `T-${createHmac("sha256", secret).update(`tester:${owner}`).digest("hex").slice(0, 10).toUpperCase()}`,
    topic: projected.topic,
    targetSeconds: metrics.targetSeconds,
    elapsedSeconds: metrics.elapsedSeconds,
    studyElapsedSeconds: metrics.actualStudySeconds,
    breakSeconds,
    plannedBreakSeconds,
    focusedSeconds: metrics.focusedSeconds,
    distractions: metrics.distractions,
    deviceCategory: session.deviceCategory ?? null,
    completionPercent,
    completed: metrics.completed,
    quizScore: metrics.quizScore,
    quizTotal: metrics.quizTotal,
    correctionFlags,
    startedAt: new Date(session.started).toISOString(),
    endedAt: new Date(session.ended).toISOString(),
    recordedAt: new Date(session.ended).toISOString(),
  };
}

type PublicExperiment = ReturnType<typeof experimentRecord> & { publishedAt: string };

export function experimentCsv(rows: readonly PublicExperiment[]) {
  const headers = ["trip_code", "tester_code", "topic", "started_at", "ended_at", "target_seconds",
    "elapsed_seconds", "study_elapsed_seconds", "break_seconds", "planned_break_seconds", "focused_seconds",
    "distractions", "device_category", "timer_completed", "self_reported_completion_percent", "quiz_score",
    "quiz_total", "topic_corrected", "target_seconds_corrected", "elapsed_seconds_corrected",
    "study_seconds_corrected", "focus_seconds_corrected", "break_seconds_corrected", "distractions_corrected",
    "quiz_result_corrected", "published_at"];
  const cell = (value: unknown) => `"${String(value ?? "").replace(/^\s*[=+@-]/, "'$&").replaceAll('"', '""')}"`;
  return "\uFEFF" + [headers.join(","), ...rows.map(row => [row.tripCode, row.testerCode, row.topic,
    row.startedAt, row.endedAt, row.targetSeconds, row.elapsedSeconds, row.studyElapsedSeconds, row.breakSeconds,
    row.plannedBreakSeconds, row.focusedSeconds, row.distractions, row.deviceCategory, row.completed,
    row.completionPercent, row.quizScore, row.quizTotal, row.correctionFlags.topic,
    row.correctionFlags.targetSeconds, row.correctionFlags.elapsedSeconds,
    row.correctionFlags.actualStudySeconds, row.correctionFlags.focusedSeconds,
    row.correctionFlags.actualBreakSeconds, row.correctionFlags.distractions,
    row.correctionFlags.quizResult, row.publishedAt].map(cell).join(","))].join("\r\n");
}

export function experimentRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  authenticate: (request: FastifyRequest) => Promise<void>,
) {
  const opts = { preHandler: authenticate };

  // Only sessions explicitly published by their signed-in owner are visible here.
  app.post("/api/v1/experiments", opts, async req => {
    const body = z.object({
      sessionId: z.uuid(),
      completionPercent: z.number().int().min(0).max(100).nullable().default(null),
    }).strict().parse(req.body);

    return db.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ state: World }[]>`SELECT state FROM adventure_state WHERE id = 1 FOR UPDATE`;
      const session = rows[0]?.state.sessions[body.sessionId];
      if (!session)
        throw new ApiError(404, "not-found", "Hãy đồng bộ phiên học trước khi công khai kết quả.");
      const world = rows[0].state;
      if (session.userId !== req.userId)
        throw new ApiError(404, "not-found", "Hãy đồng bộ phiên học trước khi công khai kết quả.");
      if (isSessionRemoved(world, body.sessionId))
        throw new ApiError(410, "session-removed", "Phiên học này đã được quản trị viên gỡ khỏi lịch sử.");

      const override = world.sessionOverrides?.[body.sessionId];
      const record = experimentRecord(session, req.userId, config.JWT_SECRET, body.completionPercent, override);
      // This legacy column is target-capped. Public wall/study durations are re-derived from
      // the server-held session so scheduled rest remains separately observable.
      const storedElapsed = Math.min(record.targetSeconds, Math.max(0, record.elapsedSeconds));
      const result = await tx.$queryRaw<{ id: string; published_at: Date }[]>`
        INSERT INTO tester_runs (session_id, user_id, tester_code, topic, target_seconds, elapsed_seconds,
          focused_seconds, distractions, completion_percent, completed, recorded_at)
        VALUES (${body.sessionId}::uuid, ${req.userId}::uuid, ${record.testerCode}, ${record.topic},
          ${record.targetSeconds}, ${storedElapsed}, ${record.focusedSeconds}, ${record.distractions},
          ${record.completionPercent}, ${record.completed}, ${new Date(record.recordedAt)})
        ON CONFLICT (user_id, session_id) DO UPDATE SET tester_code = EXCLUDED.tester_code,
          topic = EXCLUDED.topic, target_seconds = EXCLUDED.target_seconds, elapsed_seconds = EXCLUDED.elapsed_seconds,
          focused_seconds = EXCLUDED.focused_seconds, distractions = EXCLUDED.distractions,
          completion_percent = EXCLUDED.completion_percent, completed = EXCLUDED.completed,
          recorded_at = EXCLUDED.recorded_at, withdrawn_at = NULL, published_at = NOW()
        RETURNING id::text, published_at`;
      return { ...record, publishedAt: new Date(result[0].published_at).toISOString() };
    });
  });

  app.get("/api/v1/experiments/mine", opts, async req => {
    return db.$queryRaw<{ sessionId: string }[]>`
      SELECT r.session_id::text AS "sessionId" FROM tester_runs r
      WHERE r.user_id = ${req.userId}::uuid AND r.withdrawn_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM adventure_state a WHERE a.id = 1
          AND COALESCE((a.state->'sessionOverrides'->r.session_id::text) ? 'removedAt', false))`;
  });

  app.delete("/api/v1/experiments/:sessionId", opts, async req => {
    const { sessionId } = z.object({ sessionId: z.uuid() }).parse(req.params);
    await db.$executeRaw`UPDATE tester_runs SET withdrawn_at = NOW()
      WHERE session_id = ${sessionId}::uuid AND user_id = ${req.userId}::uuid AND withdrawn_at IS NULL`;
    return { ok: true };
  });

  const readRows = (limit: number, offset: number) => db.$queryRaw<{
    session: Session;
    override: SessionOverride | null;
    user_id: string;
    completion_percent: number | null;
    published_at: Date;
  }[]>`
    SELECT entry.value AS session, a.state->'sessionOverrides'->entry.key AS override,
      r.user_id::text AS user_id, r.completion_percent, r.published_at
    FROM tester_runs r CROSS JOIN adventure_state a
    CROSS JOIN LATERAL jsonb_each(a.state->'sessions') entry
    WHERE r.withdrawn_at IS NULL AND a.id = 1 AND entry.key = r.session_id::text
      AND entry.value->>'userId' = r.user_id::text
      AND NOT COALESCE((a.state->'sessionOverrides'->entry.key) ? 'removedAt', false)
    ORDER BY CASE WHEN entry.value->>'ended' ~ '^[0-9]{1,16}$'
      THEN (entry.value->>'ended')::bigint ELSE 0 END DESC, entry.key DESC
    LIMIT ${limit} OFFSET ${offset}`;

  app.get("/api/v1/experiments", async req => {
    const { limit, offset } = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).max(100000).default(0),
    }).parse(req.query);
    const rows = await readRows(limit, offset);
    const count = await db.$queryRaw<{ total: number }[]>`
      SELECT COUNT(*)::int AS total FROM tester_runs r CROSS JOIN adventure_state a
      CROSS JOIN LATERAL jsonb_each(a.state->'sessions') entry
      WHERE r.withdrawn_at IS NULL AND a.id = 1 AND entry.key = r.session_id::text
        AND entry.value->>'userId' = r.user_id::text
        AND NOT COALESCE((a.state->'sessionOverrides'->entry.key) ? 'removedAt', false)`;
    const runs = rows.map(({ session, override, user_id, completion_percent, published_at }) => ({
      ...experimentRecord(session, user_id, config.JWT_SECRET, completion_percent, override ?? undefined),
      publishedAt: new Date(published_at).toISOString(),
    }));
    return { runs, total: count[0]?.total ?? 0, limit, offset };
  });

  app.get("/api/v1/experiments/export.csv", async (_req, reply) => {
    const rows = await readRows(10000, 0);
    const runs = rows.map(({ session, override, user_id, completion_percent, published_at }) => ({
      ...experimentRecord(session, user_id, config.JWT_SECRET, completion_percent, override ?? undefined),
      publishedAt: new Date(published_at).toISOString(),
    }));
    return reply.header("Content-Disposition", 'attachment; filename="viendu-tester-runs.csv"')
      .type("text/csv; charset=utf-8").send(experimentCsv(runs));
  });
}
