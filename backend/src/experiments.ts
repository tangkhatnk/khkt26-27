import { createHmac } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "./errors.js";
import { config } from "./config.js";
import type { Session, World } from "./adventure/domain.js";

export function experimentRecord(session: Session, owner: string, secret: string, completionPercent: number | null) {
  if (session.userId !== owner) throw new ApiError(404, "not-found", "Không tìm thấy phiên học của bạn.");
  const elapsedSeconds = Math.min(session.target, Math.max(0, (session.ended - session.started) / 1000));
  return {
    testerCode: `T-${createHmac("sha256", secret).update(`tester:${owner}`).digest("hex").slice(0, 10).toUpperCase()}`,
    topic: session.topic, targetSeconds: session.target, elapsedSeconds,
    focusedSeconds: session.seconds,
    distractions: (session as Session & { distractions?: number }).distractions ?? session.segments.filter(s => s.kind === "distraction").length,
    completionPercent, completed: elapsedSeconds >= session.target,
    quizScore: session.quiz?.score ?? null, quizTotal: session.quiz?.total ?? null,
    recordedAt: new Date(session.ended).toISOString(),
  };
}
type PublicRow = {
  id: string; tester_code: string; topic: string; target_seconds: number; elapsed_seconds: number;
  focused_seconds: number; distractions: number; completion_percent: number | null; completed: boolean;
  quiz_score: number | null; quiz_total: number | null; recorded_at: Date; published_at: Date;
};
export function publicExperiment(row: PublicRow) {
  return { id: row.id, testerCode: row.tester_code, topic: row.topic, targetSeconds: row.target_seconds,
    elapsedSeconds: row.elapsed_seconds, focusedSeconds: row.focused_seconds, distractions: row.distractions,
    completionPercent: row.completion_percent, completed: row.completed, quizScore: row.quiz_score,
    quizTotal: row.quiz_total, recordedAt: new Date(row.recorded_at).toISOString(), publishedAt: new Date(row.published_at).toISOString() };
}
export function experimentCsv(rows: ReturnType<typeof publicExperiment>[]) {
  const headers = ["tester_code", "topic", "target_seconds", "elapsed_seconds", "focused_seconds", "distractions",
    "self_reported_completion_percent", "timer_completed", "quiz_score", "quiz_total", "recorded_at", "published_at"];
  const cell = (value: unknown) => `"${String(value ?? "").replace(/^\s*[=+@-]/, "'$&").replaceAll('"', '""')}"`;
  return '\uFEFF' + [headers.join(","), ...rows.map(r => [r.testerCode, r.topic, r.targetSeconds, r.elapsedSeconds,
    r.focusedSeconds, r.distractions, r.completionPercent, r.completed, r.quizScore, r.quizTotal, r.recordedAt, r.publishedAt].map(cell).join(","))].join("\r\n");
}
export function experimentRoutes(app: FastifyInstance, db: PrismaClient, authenticate: (r: FastifyRequest) => Promise<void>) {
  const opts = { preHandler: authenticate };
  // Only explicit opt-ins live in this table. Existing private sessions are never published implicitly.
  app.post("/api/v1/experiments", opts, async req => {
    const body = z.object({ sessionId: z.uuid(), completionPercent: z.number().int().min(0).max(100).nullable().default(null) }).parse(req.body);
    return db.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ state: World }[]>`SELECT state FROM adventure_state WHERE id = 1 FOR UPDATE`;
      const session = rows[0]?.state.sessions[body.sessionId];
      if (!session) throw new ApiError(404, "not-found", "Hãy đồng bộ phiên học trước khi công khai kết quả.");
      const r = experimentRecord(session, req.userId, config.JWT_SECRET, body.completionPercent);
      const result = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO tester_runs (session_id, user_id, tester_code, topic, target_seconds, elapsed_seconds,
          focused_seconds, distractions, completion_percent, completed, recorded_at)
        VALUES (${body.sessionId}::uuid, ${req.userId}::uuid, ${r.testerCode}, ${r.topic}, ${r.targetSeconds},
          ${r.elapsedSeconds}, ${r.focusedSeconds}, ${r.distractions}, ${r.completionPercent}, ${r.completed}, ${new Date(r.recordedAt)})
        ON CONFLICT (user_id, session_id) DO UPDATE SET completion_percent = EXCLUDED.completion_percent,
          withdrawn_at = NULL, published_at = NOW()
        RETURNING id`;
      return { id: result[0].id, ...r };
    });
  });
  app.get("/api/v1/experiments/mine", opts, async req => {
    return db.$queryRaw<{ sessionId: string }[]>`SELECT session_id::text AS "sessionId" FROM tester_runs WHERE user_id = ${req.userId}::uuid AND withdrawn_at IS NULL`;
  });
  app.delete("/api/v1/experiments/:sessionId", opts, async req => {
    const { sessionId } = z.object({ sessionId: z.uuid() }).parse(req.params);
    await db.$executeRaw`UPDATE tester_runs SET withdrawn_at = NOW() WHERE session_id = ${sessionId}::uuid AND user_id = ${req.userId}::uuid AND withdrawn_at IS NULL`;
    return { ok: true };
  });
  const readRows = (limit: number, offset: number) => db.$queryRaw<PublicRow[]>`
    SELECT r.id::text, r.tester_code, r.topic, r.target_seconds, r.elapsed_seconds, r.focused_seconds,
      r.distractions, r.completion_percent, r.completed, r.recorded_at, r.published_at,
      (a.state->'sessions'->r.session_id::text->'quiz'->>'score')::int AS quiz_score,
      (a.state->'sessions'->r.session_id::text->'quiz'->>'total')::int AS quiz_total
    FROM tester_runs r CROSS JOIN adventure_state a
    WHERE r.withdrawn_at IS NULL AND a.id = 1
    ORDER BY r.recorded_at DESC, r.id DESC LIMIT ${limit} OFFSET ${offset}`;
  app.get("/api/v1/experiments", async req => {
    const { limit, offset } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).max(100000).default(0) }).parse(req.query);
    const rows = await readRows(limit, offset);
    const count = await db.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS total FROM tester_runs WHERE withdrawn_at IS NULL`;
    return { runs: rows.map(publicExperiment), total: count[0].total, limit, offset };
  });
  app.get("/api/v1/experiments/export.csv", async (_req, reply) => {
    const rows = await readRows(10000, 0);
    return reply.header("Content-Disposition", 'attachment; filename="viendu-tester-runs.csv"')
      .type("text/csv; charset=utf-8").send(experimentCsv(rows.map(publicExperiment)));
  });
}
