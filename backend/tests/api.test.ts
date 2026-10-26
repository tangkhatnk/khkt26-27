import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import RedisMock from "ioredis-mock";
import type { Redis } from "ioredis";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { issueTokens, hashToken } from "../src/auth.js";
import { config } from "../src/config.js";
import { tripIdentity } from "../src/experiments.js";
import { registerWebAssets } from "../src/webAssets.js";
import type { World } from "../src/adventure/domain.js";
import { acceptTokens as acceptFrontendTokens, clearTokens as clearFrontendTokens, request as frontendRequest } from "../../src/services/api";
import { publishPublicMaterialSummary, readPublicMaterialSummary, withdrawPublicMaterialSummary } from "../../src/services/publicMaterialSummary";
vi.mock("../src/storage.js", () => ({
  uploadFile: vi.fn().mockResolvedValue({}),
  deleteFile: vi.fn().mockResolvedValue({}),
  storageHealth: vi.fn().mockResolvedValue({}),
  matchesMime: (buffer: Buffer, mime: string) =>
    mime === "text/plain" && !buffer.includes(0),
  documentDto: async (d: { id: string; name: string }) => ({
    ...d,
    url: `https://storage.example/${d.id}`,
    thumbnail_url: null,
  }),
  readFile: vi.fn().mockResolvedValue(Buffer.from("study material")),
}));
vi.mock("../src/ai.js", () => ({
  generateQuestions: vi.fn().mockResolvedValue([
    {
      question: "AI question",
      options: ["A", "B", "C", "D"],
      correct_index: 1,
      explanation: "Explanation",
    },
  ]),
}));
vi.mock("../src/gemini.js", () => ({
  generateGeminiQuiz: vi.fn().mockResolvedValue([{
    id: "provider-label", question: "Gemini question", options: ["A", "B", "C", "D"],
    correctAnswerIndex: 1, explanation: "Gemini explanation", knowledgePoint: "Cell structure",
  }]),
}));
import { generateGeminiQuiz } from "../src/gemini.js";
vi.mock("../src/materialReading.js", () => ({
  readMaterialDocument: vi.fn().mockResolvedValue({text: "[Trang 1]\nCater for: phục vụ, đáp ứng"}),
}));
import { readMaterialDocument } from "../src/materialReading.js";
const pg = new PGlite();
const server = new PGLiteSocketServer({
  db: pg,
  host: "127.0.0.1",
  port: 15432,
  maxConnections: 1,
});
const db = new PrismaClient();
const redis = new RedisMock();
let app: Awaited<ReturnType<typeof buildApp>>;
let headers: Record<string, string>;
let stranger: Record<string, string>;
let adminHeaders: Record<string, string>;
let userId: string;
let otherUserId: string;
let adminId: string;
let questionId: string;
let sessionId: string;
const session = () => ({
  client_id: randomUUID(),
  goal_text: "Study biology",
  topic_id: "biology",
  target_duration_seconds: 60,
  actual_duration_seconds: 60,
  distraction_attempts: 2,
  quiz_score: 0,
  total_quiz_questions: 0,
  is_completed: true,
  apps_blocked: ["com.example.app"],
  documents: [],
});
beforeAll(async () => {
  await pg.exec(
    readFileSync(
      new URL(
        "../prisma/migrations/20261004000000_initial/migration.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await pg.exec(readFileSync(new URL("../prisma/migrations/20261007000000_adventure/migration.sql", import.meta.url), "utf8"));
  await pg.exec(readFileSync(new URL("../prisma/migrations/20261009000000_tester_runs/migration.sql", import.meta.url), "utf8"));
  await pg.exec(readFileSync(new URL("../prisma/migrations/20261009100000_quiz_knowledge_point/migration.sql", import.meta.url), "utf8"));
  await pg.exec(readFileSync(new URL("../prisma/migrations/20261010120000_remove_static_quiz_bank/migration.sql", import.meta.url), "utf8"));
  await pg.exec(readFileSync(new URL("../prisma/migrations/20261024120000_admin_account_management/migration.sql", import.meta.url), "utf8"));
  await pg.exec(readFileSync(new URL("../prisma/migrations/20261024130000_admin_account_recovery/migration.sql", import.meta.url), "utf8"));
  await pg.exec(readFileSync(new URL("../prisma/migrations/20261025120000_admin_session_corrections/migration.sql", import.meta.url), "utf8"));
  await pg.exec(readFileSync(new URL("../prisma/migrations/20261026100000_public_material_summary_shares/migration.sql", import.meta.url), "utf8"));
  await server.start();
  app = await buildApp({ db, redis: redis as unknown as Redis, logger: false });
  await app.ready();
  await db.topic.create({
    data: { id: "biology", name: "Sinh học", icon: "🧬" },
  });
  const user = await db.user.create({
    data: { email: "owner@example.com", name: "Owner" },
  });
  userId = user.id;
  const other = await db.user.create({
    data: { email: "other@example.com", name: "Other" },
  });
  otherUserId = other.id;
  headers = {
    authorization: `Bearer ${(await issueTokens(db, user)).access_token}`,
  };
  stranger = {
    authorization: `Bearer ${(await issueTokens(db, other)).access_token}`,
  };
  const admin = await db.user.create({ data: { email: "admin@example.com", name: "Admin" } });
  adminId = admin.id;
  await db.adminGrant.create({ data: { user_id: adminId, is_active: true } });
  adminHeaders = {
    authorization: `Bearer ${(await issueTokens(db, admin)).access_token}`,
  };
  questionId = (
    await db.quizQuestion.create({
      data: {
        topic_id: "biology",
        owner_id: userId,
        question: "Question",
        options: ["A", "B", "C", "D"],
        correct_index: 1,
        explanation: "Explanation",
        source: "gemini_generated",
      },
    })
  ).id;
});
beforeEach(async () => {
  await redis.flushall();
  await db.$executeRaw`DELETE FROM public_material_summary_shares`;
  await db.$executeRaw`DELETE FROM tester_runs`;
  await db.$executeRaw`UPDATE adventure_state SET state = '{"people":{},"groups":{},"sessions":{},"invites":{}}'::jsonb WHERE id = 1`;
});

it("previews the exact public trip code without saving or exposing another account's identity", async () => {
  const id = randomUUID();
  const before = await app.inject({ method: "GET", url: "/api/v1/experiments" });
  const preview = await app.inject({ method: "POST", url: "/api/v1/adventure/trip-code", headers, payload: { id } });
  expect(preview.statusCode).toBe(200);
  expect(preview.json()).toEqual({ tripCode: expect.stringMatching(/^V-[A-F0-9]{12}$/) });
  const other = await app.inject({ method: "POST", url: "/api/v1/adventure/trip-code", headers: stranger, payload: { id } });
  expect(other.json().tripCode).not.toBe(preview.json().tripCode);
  const after = await app.inject({ method: "GET", url: "/api/v1/experiments" });
  expect(after.json().total).toBe(before.json().total);
  const ended = Date.now() - 1000;
  const payload = { id, groupId: null, goal: "Review the cell structure", topic: "biology", target: 60,
    started: ended - 60000, ended, segments: [{ start: ended - 60000, end: ended, kind: "focus" }] };
  expect((await app.inject({ method: "POST", url: "/api/v1/adventure/sessions", headers, payload })).statusCode).toBe(200);
  const history = await app.inject({ method: "GET", url: "/api/v1/experiments" });
  expect(history.json().total).toBe(1);
  expect(history.json().runs[0]).toMatchObject({ tripCode: preview.json().tripCode, goalSummary: "Review the cell structure" });

  const guestId = randomUUID();
  const guest = await app.inject({ method: "POST", url: "/api/v1/adventure/trip-code", payload: { id: guestId } });
  expect(guest.statusCode).toBe(200);
  const guestSave = await app.inject({ method: "POST", url: "/api/v1/adventure/guest-sessions", payload: { ...payload, id: guestId } });
  expect(guestSave.json().tripCode).toBe(guest.json().tripCode);
  const guestHistory = await app.inject({ url: "/api/v1/experiments" });
  expect(guestHistory.json().total).toBe(2);
  expect(guestHistory.json().runs.some((row: { tripCode: string }) => row.tripCode === guest.json().tripCode)).toBe(true);
  expect((await app.inject({ method: "POST", url: "/api/v1/adventure/trip-code", payload: { id, userId } })).statusCode).toBe(400);
  expect((await app.inject({ method: "POST", url: "/api/v1/adventure/trip-code", payload: { id: "not-a-uuid" } })).statusCode).toBe(400);
  expect((await app.inject({ method: "POST", url: "/api/v1/adventure/trip-code", headers: { authorization: "Bearer invalid" }, payload: { id } })).statusCode).toBe(401);
});

it("authenticates AI file reading, validates the upload and forwards caller cancellation", async () => {
  const payload = {mimeType: "application/pdf", data: Buffer.from("%PDF-1.7\nfixture").toString("base64")};
  vi.mocked(readMaterialDocument).mockClear();
  expect((await app.inject({method: "POST", url: "/api/v1/materials/read", payload})).statusCode).toBe(401);
  expect((await app.inject({method: "POST", url: "/api/v1/materials/read", headers, payload: {...payload,data: Buffer.from("unreadable").toString("base64")}})).statusCode).toBe(400);
  expect(readMaterialDocument).not.toHaveBeenCalled();
  const response = await app.inject({method: "POST", url: "/api/v1/materials/read", headers, payload});
  expect(response.statusCode).toBe(200);
  expect(response.json().text).toContain("Cater for");
  expect(readMaterialDocument).toHaveBeenCalledWith(payload, expect.any(AbortSignal));
});

it("lists saved sessions regardless of legacy withdrawal state and omits private payloads", async () => {
  const now = Date.now();
  const existingId = randomUUID();
  const existingStarted = now - 360000;
  const existingEnded = now - 300000;
  const existingSession = {
    id: existingId, userId, groupId: null, goal: "Historical saved trip", topic: "biology",
    started: existingStarted, ended: existingEnded, target: 60,
    segments: [{ start: existingStarted, end: existingEnded, kind: "focus" }],
    seconds: 60, contribution: 60, rules: "train-v1", distractions: 0,
    materials: ["private-material-name.pdf"],
    quiz: { score: 1, total: 2, feedback: [{ question: "Raw private question", answer: "Raw private answer" }] },
  };
  await db.$executeRaw`UPDATE adventure_state SET state = jsonb_set(state, '{sessions}',
    (state->'sessions') || ${JSON.stringify({ [existingId]: existingSession })}::jsonb) WHERE id = 1`;
  await db.$executeRaw`INSERT INTO tester_runs (session_id, user_id, tester_code, topic, target_seconds,
    elapsed_seconds, focused_seconds, distractions, completed, recorded_at, withdrawn_at)
    VALUES (${existingId}::uuid, ${userId}::uuid, 'T-1234567890', 'biology', 60, 60, 60, 0, true,
      ${new Date(existingEnded)}, NOW())`;

  const id = randomUUID();
  const ended = now - 60000;
  const started = ended - 30000;
  const rawGoal = `=HYPERLINK("https://example.invalid","open")${" private goal text".repeat(20)}`;
  const save = await app.inject({ method: "POST", url: "/api/v1/adventure/sessions", headers,
    payload: { id, groupId: null, goal: rawGoal, topic: "biology", target: 60,
      started, ended, distractions: 1, segments: [{ start: started, end: started + 20000, kind: "focus" },
        { start: started + 20000, end: ended, kind: "distraction" }] } });
  expect(save.statusCode).toBe(200);

  const firstPage = await app.inject({ url: "/api/v1/experiments?limit=1&offset=0" });
  expect(firstPage.statusCode).toBe(200);
  expect(firstPage.json()).toMatchObject({ total: 2, limit: 1, offset: 0,
    runs: [{ topic: "biology", goalSummary: expect.any(String), completed: false }] });
  const olderPage = await app.inject({ url: "/api/v1/experiments?limit=1&offset=1" });
  expect(olderPage.json()).toMatchObject({ total: 2, limit: 1, offset: 1,
    runs: [{ topic: "biology", goalSummary: "Historical saved trip", quizScore: 1, quizTotal: 2 }] });
  const firstRun = firstPage.json().runs[0];
  expect(Array.from(firstRun.goalSummary).length).toBeLessThanOrEqual(200);
  expect(firstRun.goalSummary).not.toBe(rawGoal);
  expect(firstRun.goalSummary).toContain("=HYPERLINK");
  for (const privateValue of ["owner@example.com", userId, existingId, id, rawGoal,
    "private-material-name.pdf", "Raw private question", "Raw private answer"]) {
    expect(firstPage.body).not.toContain(privateValue);
    expect(olderPage.body).not.toContain(privateValue);
  }

  expect((await app.inject({ method: "POST", url: "/api/v1/experiments", headers,
    payload: { sessionId: id } })).statusCode).toBe(404);
  expect((await app.inject({ url: "/api/v1/experiments/mine", headers })).statusCode).toBe(404);

  const grade = await app.inject({ method: "POST", url: "/api/v1/adventure/quiz", headers,
    payload: { sessionId: id, answers: [{ id: questionId, selected: 1 }] } });
  expect(grade.statusCode).toBe(200);
  const refreshed = await app.inject({ url: "/api/v1/experiments?limit=1" });
  expect(refreshed.json()).toMatchObject({ total: 2, runs: [{
    topic: "biology", quizScore: 1, quizTotal: 1, completed: false,
  }] });
  expect(refreshed.json().runs[0].goalSummary).toBe(firstRun.goalSummary);

  const csv = await app.inject({ url: "/api/v1/experiments/export.csv" });
  expect(csv.headers["content-type"]).toContain("text/csv");
  expect(csv.body).toContain("trip_code");
  expect(csv.body).toContain("goal_summary");
  expect(csv.body).toContain("'=HYPERLINK");
  expect(csv.body).toContain("started_at");
  expect(csv.body).toContain("ended_at");
  expect(csv.body).not.toContain(userId);
  expect(csv.body).not.toContain(id);
  expect(csv.body).not.toContain(rawGoal);
  expect(csv.body).not.toContain("private-material-name.pdf");
  expect(csv.body).not.toContain("Raw private answer");
});

it("accepts validated guest trips once, strips spoofed data, and rejects owner UUID collisions", async () => {
  const id = randomUUID();
  const ended = Date.now();
  const started = ended - 30000;
  const payload = {
    id, groupId: randomUUID(), goal: "Guest first goal", topic: "biology", target: 60,
    started, ended, segments: [
      { start: started, end: started + 20000, kind: "focus" },
      { start: started + 20000, end: ended, kind: "distraction" },
    ],
    deviceCategory: "tablet",
    userAgent: "RAW-UA-SHOULD-NOT-BE-STORED",
    userId, seconds: 9999, quiz: { score: 999, total: 999 }, materials: ["https://private.example/file"],
  };
  const first = await app.inject({ method: "POST", url: "/api/v1/adventure/guest-sessions", payload });
  expect(first.statusCode).toBe(200);
  expect(first.json()).toMatchObject({ tripCode: /^V-[A-F0-9]{12}$/ });
  expect(Object.keys(first.json())).toEqual(["tripCode"]);
  expect(first.body).not.toContain(id);
  const originalTripCode = first.json().tripCode;

  const retry = await app.inject({ method: "POST", url: "/api/v1/adventure/guest-sessions",
    payload: { ...payload, goal: "Changed replay goal", seconds: 0, deviceCategory: "ios" } });
  expect(retry.statusCode).toBe(200);
  expect(retry.json()).toEqual({ tripCode: originalTripCode });

  const automaticHistory = await app.inject({ url: "/api/v1/experiments" });
  expect(automaticHistory.json().total).toBe(1);
  expect(automaticHistory.json().runs[0]).toMatchObject({ tripCode: originalTripCode,
    goalSummary: "Guest first goal", deviceCategory: "tablet", quizScore: null, quizTotal: null });
  expect(automaticHistory.body).not.toContain(id);
  expect(automaticHistory.body).not.toContain(userId);
  expect(automaticHistory.body).not.toContain("private.example");
  const state = await db.$queryRaw<{ state: { sessions: Record<string, { userId: string; groupId: string | null; seconds: number; deviceCategory?: string; quiz?: unknown }> } }[]>`
    SELECT state FROM adventure_state WHERE id = 1`;
  expect(state[0].state.sessions[id]).toMatchObject({ userId: `guest:${id}`, groupId: null, seconds: 20 });
  expect(state[0].state.sessions[id].deviceCategory).toBe("tablet");
  expect(JSON.stringify(state[0].state.sessions[id])).not.toContain("RAW-UA-SHOULD-NOT-BE-STORED");
  expect(state[0].state.sessions[id].quiz).toBeUndefined();

  const invalidDeviceId = randomUUID();
  const invalidDevice = await app.inject({ method: "POST", url: "/api/v1/adventure/guest-sessions",
    payload: { ...payload, id: invalidDeviceId, deviceCategory: "MacIntel; touch=5" } });
  expect(invalidDevice.statusCode).toBe(400);

  const invalidId = randomUUID();
  const invalid = await app.inject({ method: "POST", url: "/api/v1/adventure/guest-sessions",
    payload: { ...payload, id: invalidId, segments: [{ start: started, end: started, kind: "focus" }] } });
  expect(invalid.statusCode).toBe(400);
  expect((await app.inject({ url: "/api/v1/experiments" })).json().total).toBe(1);

  const collisionId = randomUUID();
  const accountTrip = await app.inject({ method: "POST", url: "/api/v1/adventure/sessions", headers,
    payload: { ...payload, id: collisionId, groupId: null, userId: undefined, seconds: undefined,
      quiz: undefined, materials: undefined } });
  expect(accountTrip.statusCode).toBe(200);
  const accountState = await db.$queryRaw<{ state: { sessions: Record<string, { deviceCategory?: string }> } }[]>`
    SELECT state FROM adventure_state WHERE id = 1`;
  expect(accountState[0].state.sessions[collisionId].deviceCategory).toBe("tablet");
  const collision = await app.inject({ method: "POST", url: "/api/v1/adventure/guest-sessions",
    payload: { ...payload, id: collisionId } });
  expect(collision.statusCode).toBe(409);
  expect((await app.inject({ url: "/api/v1/experiments" })).json().total).toBe(2);
});

it("projects an audited correction consistently while preserving raw settlement, quiz, and progress", async () => {
  await db.topic.upsert({
    where: { id: "history" },
    create: { id: "history", name: "History", icon: "📜" },
    update: {},
  });
  const id = randomUUID();
  const ended = Date.now() - 1000;
  const started = ended - 30000;
  const payload = { id, groupId: null, goal: "Study cells", topic: "biology", target: 60, started, ended,
    distractions: 1, segments: [{ start: started, end: started + 20000, kind: "focus" },
      { start: started + 20000, end: ended, kind: "distraction" }] };
  expect((await app.inject({ method: "POST", url: "/api/v1/adventure/sessions", headers, payload })).statusCode).toBe(200);
  const before = await db.$queryRaw<{ state: { people: Record<string, { journey: { seconds: number } }> } }[]>`
    SELECT state FROM adventure_state WHERE id = 1`;
  const progressBefore = before[0].state.people[userId].journey.seconds;
  const grade = await app.inject({ method: "POST", url: "/api/v1/adventure/quiz", headers,
    payload: { sessionId: id, answers: [{ id: questionId, selected: 1 }] } });
  expect(grade.statusCode).toBe(200);
  const quizFacts = grade.json().sessions.find((session: { id: string }) => session.id === id).quiz;

  const emptyQuizCorrection = await app.inject({ method: "PATCH", url: `/api/v1/admin/sessions/${id}`, headers: adminHeaders,
    payload: { expectedVersion: 0, reason: "Reject an empty quiz grade", changes: { quizResult: { score: 0, total: 0 } } } });
  expect(emptyQuizCorrection.statusCode).toBe(400);

  const changed = await app.inject({ method: "PATCH", url: `/api/v1/admin/sessions/${id}`, headers: adminHeaders,
    payload: { expectedVersion: 0, reason: "Correct reviewed session metrics", changes: {
      goal: "Review the cell structure", elapsedSeconds: 40, actualStudySeconds: 35,
      focusedSeconds: 30, actualBreakSeconds: 5, distractions: 2, quizResult: { score: 0, total: 1 },
    } } });
  expect(changed.statusCode, changed.body).toBe(200);
  expect(changed.json()).toMatchObject({ id, ownerId: userId, accountId: userId, correctionVersion: 1,
    goal: "Review the cell structure", metrics: { elapsedSeconds: 40, actualStudySeconds: 35,
      focusedSeconds: 30, actualBreakSeconds: 5, distractions: 2, quizScore: 0, quizTotal: 1 },
    metricSources: { goal: "corrected", elapsedSeconds: "corrected", actualStudySeconds: "corrected" } });
  const detail = await app.inject({ url: `/api/v1/admin/sessions/${id}`, headers: adminHeaders });
  expect(detail.json()).toMatchObject({ goal: "Review the cell structure", topic: "biology",
    measuredContent: { goal: "Study cells", topic: "biology" }, correctionVersion: 1 });
  const audit = await app.inject({ url: `/api/v1/admin/sessions/${id}/audit?limit=10`, headers: adminHeaders });
  expect(audit.json()).toMatchObject({ total: 1, actions: [{ actorId: adminId, targetOwnerId: userId,
    sessionId: id, action: "correction", beforeVersion: 0, afterVersion: 1, reason: "Correct reviewed session metrics" }] });
  expect((await app.inject({ url: `/api/v1/admin/sessions/${id}/audit`, headers })).statusCode).toBe(403);
  expect((await app.inject({ url: `/api/v1/admin/sessions/${id}/audit?limit=101`, headers: adminHeaders })).statusCode).toBe(400);
  expect(changed.json().measuredMetrics).toMatchObject({ elapsedSeconds: 30, actualStudySeconds: 30,
    focusedSeconds: 20, distractions: 1, quizScore: 1, quizTotal: 1 });

  const history = await app.inject({ url: "/api/v1/adventure", headers });
  expect(history.json()).toMatchObject({ removedSessionIds: [], sessions: [{ id, goal: "Review the cell structure",
    topic: "biology", correctionVersion: 1, effectiveMetrics: { elapsedSeconds: 40, actualStudySeconds: 35,
      focusedSeconds: 30, quizScore: 0, quizTotal: 1 } }] });
  expect(history.json().sessions[0].quiz).toEqual(quizFacts);
  const listed = await app.inject({ url: `/api/v1/admin/sessions?days=7&accountId=${userId}`, headers: adminHeaders });
  expect(listed.statusCode).toBe(200);
  expect(listed.json().sessions[0]).toMatchObject({ correctionVersion: 1, metrics: { actualStudySeconds: 35 },
    measuredMetrics: { actualStudySeconds: 30 } });
  expect(listed.json().sessions[0]).not.toHaveProperty("measuredContent");
  expect(listed.body).not.toContain("Review the cell structure");
  expect(listed.body).not.toContain("Study cells");
  const report = await app.inject({ url: `/api/v1/admin/report?days=7&accountId=${userId}`, headers: adminHeaders });
  expect(report.json().totals).toMatchObject({ sessionCount: 1, actualStudySeconds: 35, focusedSeconds: 30,
    distractions: 2, quizScore: 0, quizTotal: 1 });
  expect(report.body).not.toContain("Study cells");

  const publicHistory = await app.inject({ url: "/api/v1/experiments" });
  expect(publicHistory.json()).toMatchObject({ total: 1, runs: [{ topic: "biology", targetSeconds: 60,
    elapsedSeconds: 40, studyElapsedSeconds: 35, focusedSeconds: 30, breakSeconds: 5,
    goalSummary: "Review the cell structure", distractions: 2, quizScore: 0, quizTotal: 1,
    correctionFlags: { goal: true, elapsedSeconds: true, actualStudySeconds: true, quizResult: true } }] });
  for (const privateValue of ["Study cells", userId, adminId, "Correct reviewed session metrics"])
    expect(publicHistory.body).not.toContain(privateValue);
  const reportCsv = await app.inject({ url: `/api/v1/admin/report/export.csv?days=7&accountId=${userId}`, headers: adminHeaders });
  expect(reportCsv.statusCode).toBe(200);
  expect(reportCsv.body).toContain('"60","35","30"');
  expect(reportCsv.body).not.toContain("Study cells");
  expect(reportCsv.body).not.toContain("Correct reviewed session metrics");
  const publicCsv = await app.inject({ url: "/api/v1/experiments/export.csv" });
  expect(publicCsv.body).toContain('"biology"');
  expect(publicCsv.body).toContain('"40","35","5","0","30","2"');
  expect(publicCsv.body).toContain('"true","false","false","true","true","true","true","true","true"');
  expect(publicCsv.body).toContain('"Review the cell structure"');
  expect(publicCsv.body).not.toContain("Study cells");
  expect(publicCsv.body).not.toContain("Correct reviewed session metrics");

  const raw = await db.$queryRaw<{ state: { sessions: Record<string, Record<string, unknown>>;
    people: Record<string, { journey: { seconds: number } }>; sessionOverrides: Record<string, unknown> } }[]>`
    SELECT state FROM adventure_state WHERE id = 1`;
  expect(raw[0].state.sessions[id]).toMatchObject({ goal: "Study cells", topic: "biology", target: 60,
    seconds: 20, quiz: quizFacts });
  expect(raw[0].state.sessionOverrides[id]).toMatchObject({ version: 1, goal: "Review the cell structure",
    actualStudySeconds: 35, quizResult: { score: 0, total: 1 } });
  expect(raw[0].state.people[userId].journey.seconds).toBe(progressBefore);
  expect(await db.adminSessionActionAudit.count({ where: { session_id: id } })).toBe(1);

  const followupCorrection = await app.inject({ method: "PATCH", url: `/api/v1/admin/sessions/${id}`, headers: adminHeaders,
    payload: { expectedVersion: 1, reason: "Correct follow-up distraction count", changes: { distractions: 3 } } });
  expect(followupCorrection.statusCode).toBe(200);
  expect((await app.inject({ url: "/api/v1/experiments" })).json()).toMatchObject({
    total: 1, runs: [{ distractions: 3, goalSummary: "Review the cell structure" }],
  });

  const unknownTopicChange = await app.inject({ method: "PATCH", url: `/api/v1/admin/sessions/${id}`, headers: adminHeaders,
    payload: { expectedVersion: 2, reason: "Reject an unregistered topic", changes: { topic: "unregistered-topic" } } });
  expect(unknownTopicChange.statusCode).toBe(422);
  expect(unknownTopicChange.json().detail).toBe("Chủ đề đã chọn không tồn tại trong danh mục.");
  expect(await db.adminSessionActionAudit.count({ where: { session_id: id } })).toBe(2);
  expect((await app.inject({ url: `/api/v1/admin/sessions/${id}`, headers: adminHeaders })).json())
    .toMatchObject({ correctionVersion: 2, topic: "biology" });

  const correctedGradedTopic = await app.inject({ method: "PATCH", url: `/api/v1/admin/sessions/${id}`, headers: adminHeaders,
    payload: { expectedVersion: 2, reason: "Correct the graded session topic", changes: { topic: "history" } } });
  expect(correctedGradedTopic.statusCode, correctedGradedTopic.body).toBe(200);
  expect(correctedGradedTopic.json()).toMatchObject({ correctionVersion: 3, topic: "history" });
  const duplicateGrade = await app.inject({ method: "POST", url: "/api/v1/adventure/quiz", headers,
    payload: { sessionId: id, answers: [{ id: questionId, selected: 0 }] } });
  expect(duplicateGrade.statusCode, duplicateGrade.body).toBe(200);
  expect(duplicateGrade.json().sessions.find((item: { id: string }) => item.id === id).quiz).toEqual(quizFacts);
  expect(await db.adminSessionActionAudit.count({ where: { session_id: id } })).toBe(3);
  const rawAfterTopicCorrection = await db.$queryRaw<{ state: { sessions: Record<string, Record<string, unknown>>;
    sessionOverrides: Record<string, unknown> } }[]>`SELECT state FROM adventure_state WHERE id = 1`;
  expect(rawAfterTopicCorrection[0].state.sessions[id]).toMatchObject({ topic: "biology", quiz: quizFacts });
  expect(rawAfterTopicCorrection[0].state.sessionOverrides[id]).toMatchObject({ version: 3, topic: "history" });
  const stale = await app.inject({ method: "PATCH", url: `/api/v1/admin/sessions/${id}`, headers: adminHeaders,
    payload: { expectedVersion: 1, reason: "Stale correction", changes: { distractions: 3 } } });
  expect(stale.statusCode).toBe(409);
  expect(stale.json()).toMatchObject({ title: "Dữ liệu đã thay đổi.",
    type: "https://api.pomodoro-focus.com/errors/conflict",
    detail: "Dữ liệu đã thay đổi hoặc tồn tại. Hãy tải lại rồi thử lại." });
  expect((await app.inject({ method: "PATCH", url: `/api/v1/admin/sessions/${id}`, headers,
    payload: { expectedVersion: 2, reason: "Not an admin", changes: { distractions: 3 } } })).statusCode).toBe(403);
});

it("rejects incoherent partial corrections, audits atomically, and tombstones suppress automatic history", async () => {
  const id = randomUUID();
  const ended = Date.now() - 1000;
  const started = ended - 30000;
  const payload = { id, groupId: null, goal: "Study cells", topic: "biology", target: 60, started, ended,
    segments: [{ start: started, end: ended, kind: "focus" }] };
  expect((await app.inject({ method: "POST", url: "/api/v1/adventure/sessions", headers, payload })).statusCode).toBe(200);

  const invalid = await app.inject({ method: "PATCH", url: `/api/v1/admin/sessions/${id}`, headers: adminHeaders,
    payload: { expectedVersion: 0, reason: "Invalid metric relationship", changes: { focusedSeconds: 31 } } });
  expect(invalid.statusCode).toBe(422);
  const emptyChanges = await app.inject({ method: "PATCH", url: `/api/v1/admin/sessions/${id}`, headers: adminHeaders,
    payload: { expectedVersion: 0, reason: "No fields selected", changes: {} } });
  expect(emptyChanges.statusCode).toBe(400);
  expect(emptyChanges.json().title).toBe("Dữ liệu không hợp lệ.");
  expect(emptyChanges.json().errors).toContainEqual(expect.objectContaining({
    message: "Hãy chọn ít nhất một mục cần chỉnh sửa.",
  }));
  const strict = await app.inject({ method: "PATCH", url: `/api/v1/admin/sessions/${id}`, headers: adminHeaders,
    payload: { expectedVersion: 0, reason: "Unknown field", changes: { score: 1 } } });
  expect(strict.statusCode).toBe(400);

  await db.$executeRaw`ALTER TABLE admin_session_action_audits
    ADD CONSTRAINT admin_session_action_audits_test_reject CHECK (reason <> 'force audit failure')`;
  const auditFailure = await app.inject({ method: "PATCH", url: `/api/v1/admin/sessions/${id}`, headers: adminHeaders,
    payload: { expectedVersion: 0, reason: "force audit failure", changes: { distractions: 2 } } });
  await db.$executeRaw`ALTER TABLE admin_session_action_audits DROP CONSTRAINT admin_session_action_audits_test_reject`;
  expect(auditFailure.statusCode).toBe(500);
  let state = await db.$queryRaw<{ state: { sessionOverrides?: Record<string, unknown> } }[]>`
    SELECT state FROM adventure_state WHERE id = 1`;
  expect(state[0].state.sessionOverrides?.[id]).toBeUndefined();
  expect(await db.adminSessionActionAudit.count({ where: { session_id: id } })).toBe(0);

  const coherent = await app.inject({ method: "PATCH", url: `/api/v1/admin/sessions/${id}`, headers: adminHeaders,
    payload: { expectedVersion: 0, reason: "Adjust break accounting", changes: { actualStudySeconds: 20,
      focusedSeconds: 20, actualBreakSeconds: 10 } } });
  expect(coherent.statusCode).toBe(200);
  const incoherentReset = await app.inject({ method: "PATCH", url: `/api/v1/admin/sessions/${id}`, headers: adminHeaders,
    payload: { expectedVersion: 1, reason: "Reset study measurement", changes: { actualStudySeconds: null } } });
  expect(incoherentReset.statusCode).toBe(422);
  expect(incoherentReset.json().detail).toBe("Thời lượng đã trôi qua phải bao gồm thời gian học và thời gian nghỉ.");
  expect((await app.inject({ url: `/api/v1/admin/sessions/${id}`, headers: adminHeaders })).json())
    .toMatchObject({ correctionVersion: 1, metrics: { actualStudySeconds: 20, actualBreakSeconds: 10 } });

  expect((await app.inject({ url: "/api/v1/experiments" })).json()).toMatchObject({
    total: 1, runs: [{ goalSummary: "Study cells", studyElapsedSeconds: 20, breakSeconds: 10 }],
  });
  const removed = await app.inject({ method: "DELETE", url: `/api/v1/admin/sessions/${id}`, headers: adminHeaders,
    payload: { expectedVersion: 1, reason: "Remove diagnosed test trip" } });
  expect(removed.statusCode, removed.body).toBe(200);
  expect(removed.json()).toMatchObject({ id, ownerId: userId, status: "removed", correctionVersion: 2 });
  const history = await app.inject({ url: "/api/v1/adventure", headers });
  expect(history.json()).toMatchObject({ sessions: [], removedSessionIds: [id] });
  const resync = await app.inject({ method: "POST", url: "/api/v1/adventure/sessions", headers, payload });
  expect(resync.statusCode).toBe(410);
  expect(resync.json()).toMatchObject({ title: "Phiên học đã bị gỡ.",
    type: "https://api.pomodoro-focus.com/errors/session-removed",
    detail: "Phiên học này đã được quản trị viên gỡ khỏi lịch sử." });
  expect((await app.inject({ method: "POST", url: "/api/v1/adventure/sessions", headers: stranger, payload })).statusCode).toBe(409);
  expect((await app.inject({ method: "POST", url: "/api/v1/adventure/guest-sessions", payload })).statusCode).toBe(409);
  const grade = await app.inject({ method: "POST", url: "/api/v1/adventure/quiz", headers,
    payload: { sessionId: id, answers: [{ id: questionId, selected: 1 }] } });
  expect(grade.statusCode).toBe(410);
  expect((await app.inject({ url: "/api/v1/experiments" })).json().total).toBe(0);
  const historyCsv = await app.inject({ url: "/api/v1/experiments/export.csv" });
  expect(historyCsv.body).not.toContain(tripIdentity(userId, id, config.JWT_SECRET).tripCode);
  expect((await app.inject({ url: `/api/v1/admin/sessions?days=7&accountId=${userId}`, headers: adminHeaders })).json().total).toBe(0);
  expect(await db.adminSessionActionAudit.count({ where: { session_id: id } })).toBe(2);
  const removedAudit = await app.inject({ url: `/api/v1/admin/sessions/${id}/audit?limit=10`, headers: adminHeaders });
  expect(removedAudit.statusCode).toBe(200);
  expect(removedAudit.json()).toMatchObject({ total: 2, actions: expect.arrayContaining([
    expect.objectContaining({ action: "removal", beforeVersion: 1, afterVersion: 2,
      reason: "Remove diagnosed test trip", actorId: adminId }),
  ]) });

  const guestId = randomUUID();
  const guestPayload = { ...payload, id: guestId };
  expect((await app.inject({ method: "POST", url: "/api/v1/adventure/guest-sessions", payload: guestPayload })).statusCode).toBe(200);
  const guestCorrection = await app.inject({ method: "PATCH", url: `/api/v1/admin/sessions/${guestId}`, headers: adminHeaders,
    payload: { expectedVersion: 0, reason: "Correct guest trip count", changes: { distractions: 2 } } });
  expect(guestCorrection.statusCode).toBe(200);
  expect(guestCorrection.json()).toMatchObject({ ownerId: `guest:${guestId}`, accountId: null,
    metrics: { distractions: 2 }, correctionVersion: 1 });
  const guestAudit = await app.inject({ url: `/api/v1/admin/sessions/${guestId}/audit`, headers: adminHeaders });
  expect(guestAudit.json()).toMatchObject({ total: 1, actions: [{ targetOwnerId: `guest:${guestId}`, actorId: adminId }] });
  const guestListed = await app.inject({ url: "/api/v1/admin/sessions?days=7", headers: adminHeaders });
  expect(guestListed.json().sessions).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: guestId, ownerId: `guest:${guestId}`, accountId: null }),
  ]));
  const guestDelete = await app.inject({ method: "DELETE", url: `/api/v1/admin/sessions/${guestId}`, headers: adminHeaders,
    payload: { expectedVersion: 1, reason: "Remove diagnosed guest test trip" } });
  expect(guestDelete.statusCode).toBe(200);
  expect(guestDelete.json()).toMatchObject({ ownerId: `guest:${guestId}`, accountId: null, status: "removed" });
  const guestReplay = await app.inject({ method: "POST", url: "/api/v1/adventure/guest-sessions", payload: guestPayload });
  expect(guestReplay.statusCode).toBe(410);
  expect(guestReplay.body).toContain("session-removed");
  expect(await db.adminSessionActionAudit.count({ where: { session_id: guestId } })).toBe(2);
});

it("allows metric corrections for an unregistered legacy topic and rejects a new unknown topic without an audit", async () => {
  const id = randomUUID();
  const ended = Date.now() - 1000;
  const started = ended - 30000;
  const payload = { id, groupId: null, goal: "Legacy topic fixture", topic: "legacy-unregistered-topic", target: 60,
    started, ended, segments: [{ start: started, end: ended, kind: "focus" }] };
  expect((await app.inject({ method: "POST", url: "/api/v1/adventure/sessions", headers, payload })).statusCode).toBe(200);

  const metricsOnly = await app.inject({ method: "PATCH", url: `/api/v1/admin/sessions/${id}`, headers: adminHeaders,
    payload: { expectedVersion: 0, reason: "Correct legacy trip metrics", changes: { distractions: 1 } } });
  expect(metricsOnly.statusCode, metricsOnly.body).toBe(200);
  expect(metricsOnly.json()).toMatchObject({ correctionVersion: 1, topic: "legacy-unregistered-topic", metrics: { distractions: 1 } });

  const unknownTopic = await app.inject({ method: "PATCH", url: `/api/v1/admin/sessions/${id}`, headers: adminHeaders,
    payload: { expectedVersion: 1, reason: "Reject an unknown replacement topic", changes: { topic: "new-unknown-topic" } } });
  expect(unknownTopic.statusCode).toBe(422);
  expect(unknownTopic.json().detail).toBe("Chủ đề đã chọn không tồn tại trong danh mục.");
  expect((await app.inject({ url: `/api/v1/admin/sessions/${id}`, headers: adminHeaders })).json())
    .toMatchObject({ correctionVersion: 1, topic: "legacy-unregistered-topic", metrics: { distractions: 1 } });
  expect(await db.adminSessionActionAudit.count({ where: { session_id: id } })).toBe(1);
});

it("grades against a corrected topic while rejecting quiz questions from the stale topic", async () => {
  await db.topic.upsert({
    where: { id: "history" },
    create: { id: "history", name: "History", icon: "📜" },
    update: {},
  });
  const historyQuestion = await db.quizQuestion.create({
    data: {
      topic_id: "history",
      owner_id: userId,
      question: "History question",
      options: ["A", "B", "C", "D"],
      correct_index: 1,
      explanation: "History explanation",
      source: "gemini_generated",
    },
  });
  const id = randomUUID();
  const ended = Date.now() - 1000;
  const started = ended - 30000;
  const payload = { id, groupId: null, goal: "Study cells", topic: "biology", target: 60, started, ended,
    segments: [{ start: started, end: ended, kind: "focus" }] };
  expect((await app.inject({ method: "POST", url: "/api/v1/adventure/sessions", headers, payload })).statusCode).toBe(200);

  const corrected = await app.inject({ method: "PATCH", url: `/api/v1/admin/sessions/${id}`, headers: adminHeaders,
    payload: { expectedVersion: 0, reason: "Correct session topic before grading", changes: { topic: "history",
      actualBreakSeconds: 0 } } });
  expect(corrected.statusCode).toBe(200);
  const staleQuiz = await app.inject({ method: "POST", url: "/api/v1/adventure/quiz", headers,
    payload: { sessionId: id, answers: [{ id: questionId, selected: 1 }] } });
  expect(staleQuiz.statusCode).toBe(409);
  const correctQuiz = await app.inject({ method: "POST", url: "/api/v1/adventure/quiz", headers,
    payload: { sessionId: id, answers: [{ id: historyQuestion.id, selected: 1 }] } });
  expect(correctQuiz.statusCode).toBe(200);
  expect(correctQuiz.json().sessions[0]).toMatchObject({ topic: "history", quiz: { score: 1, total: 1 } });
  const automaticHistory = await app.inject({ url: "/api/v1/experiments" });
  expect(automaticHistory.json()).toMatchObject({ total: 1, runs: [{ topic: "history", breakSeconds: 0,
    quizScore: 1, quizTotal: 1, correctionFlags: { topic: true, actualBreakSeconds: true } }] });
  const publicCsv = await app.inject({ url: "/api/v1/experiments/export.csv" });
  const [publicHeaders, publicRow] = publicCsv.body.replace(/^\uFEFF/, "").split("\r\n");
  const headerCells = publicHeaders.split(",");
  const publicCells = publicRow.split(",");
  expect(headerCells).toContain("topic_corrected");
  expect(headerCells).toContain("break_seconds_corrected");
  expect(publicCells[headerCells.indexOf("break_seconds")]).toBe('"0"');
  expect(publicCells[headerCells.indexOf("break_seconds_corrected")]).toBe('"true"');
  expect(headerCells).toContain("goal_summary");
  expect(publicCsv.body).not.toContain(id);

  const raw = await db.$queryRaw<{ state: { sessions: Record<string, { topic: string; quiz: unknown }> } }[]>`
    SELECT state FROM adventure_state WHERE id = 1`;
  expect(raw[0].state.sessions[id]).toMatchObject({ topic: "biology", quiz: { score: 1, total: 1 } });
  const resetTopic = await app.inject({ method: "PATCH", url: `/api/v1/admin/sessions/${id}`, headers: adminHeaders,
    payload: { expectedVersion: 1, reason: "Reset graded topic", changes: { topic: null } } });
  expect(resetTopic.statusCode, resetTopic.body).toBe(200);
  expect(resetTopic.json()).toMatchObject({ correctionVersion: 2, topic: "biology" });
  const duplicateAfterReset = await app.inject({ method: "POST", url: "/api/v1/adventure/quiz", headers,
    payload: { sessionId: id, answers: [{ id: historyQuestion.id, selected: 0 }] } });
  expect(duplicateAfterReset.statusCode, duplicateAfterReset.body).toBe(200);
  expect(duplicateAfterReset.json().sessions.find((session: { id: string }) => session.id === id).quiz)
    .toMatchObject({ score: 1, total: 1 });
  const rawAfterReset = await db.$queryRaw<{ state: { sessions: Record<string, { topic: string; quiz: unknown }> } }[]>`
    SELECT state FROM adventure_state WHERE id = 1`;
  expect(rawAfterReset[0].state.sessions[id]).toMatchObject({ topic: "biology", quiz: { score: 1, total: 1 } });
});

it("filters all-history admin sessions by effective planned and elapsed seconds", async () => {
  async function saveSession(options: {
    ageDays: number;
    target: number;
    wallMs: number;
    segments: { startOffset: number; endOffset: number; kind: "focus" | "break" }[];
    breakPlan?: { count: number; seconds: number };
  }) {
    const id = randomUUID();
    const started = Date.now() - options.ageDays * 86_400_000 - 3_600_000;
    const ended = started + options.wallMs;
    const response = await app.inject({ method: "POST", url: "/api/v1/adventure/sessions", headers,
      payload: { id, groupId: null, goal: "Short trip filter fixture", topic: "biology", target: options.target,
        started, ended, breakPlan: options.breakPlan,
        segments: options.segments.map(({ startOffset, endOffset, kind }) => ({
          start: started + startOffset, end: started + endOffset, kind,
        })) } });
    expect(response.statusCode, response.body).toBe(200);
    return id;
  }

  const legacyBreak = await saveSession({ ageDays: 29, target: 60, wallMs: 70_000,
    segments: [{ startOffset: 0, endOffset: 60_000, kind: "focus" },
      { startOffset: 60_000, endOffset: 70_000, kind: "break" }] });
  const dayThirtyOnly = await saveSession({ ageDays: 10, target: 60, wallMs: 30_000,
    segments: [{ startOffset: 0, endOffset: 30_000, kind: "focus" }] });
  const cappedWall = await saveSession({ ageDays: 2, target: 60, wallMs: 100_000,
    segments: [{ startOffset: 0, endOffset: 60_000, kind: "focus" }] });
  const partialPlannedBreak = await saveSession({ ageDays: 3, target: 120, wallMs: 90_000,
    breakPlan: { count: 1, seconds: 60 },
    segments: [{ startOffset: 0, endOffset: 60_000, kind: "focus" },
      { startOffset: 60_000, endOffset: 90_000, kind: "break" }] });
  const corrected = await saveSession({ ageDays: 4, target: 120, wallMs: 90_000,
    segments: [{ startOffset: 0, endOffset: 90_000, kind: "focus" }] });
  const fractionalCutoff = await saveSession({ ageDays: 5, target: 60, wallMs: 60_001,
    segments: [{ startOffset: 0, endOffset: 60_000, kind: "focus" }] });

  // The sync API correctly limits new submissions to 30 days. Shift this synthetic saved
  // fixture beyond that boundary to exercise the separate all-history admin window.
  const worldRows = await db.$queryRaw<{ state: World }[]>`SELECT state FROM adventure_state WHERE id = 1`;
  const world = worldRows[0].state;
  const oldSession = world.sessions[legacyBreak];
  const oldStarted = Date.now() - 45 * 86_400_000 - 3_600_000;
  const timestampShift = oldStarted - oldSession.started;
  oldSession.started = oldStarted;
  oldSession.ended += timestampShift;
  oldSession.segments = oldSession.segments.map((segment) => ({
    ...segment, start: segment.start + timestampShift, end: segment.end + timestampShift,
  }));
  const malformedId = randomUUID();
  (world.sessions as Record<string, unknown>)[malformedId] = {
    id: malformedId, userId, started: "not-a-number", ended: "also-invalid", target: "bad-target",
    segments: [{ kind: "break", start: "not-a-timestamp", end: "still-not-a-timestamp" }],
  };
  const oversizedTimestampId = randomUUID();
  (world.sessions as Record<string, unknown>)[oversizedTimestampId] = {
    id: oversizedTimestampId, userId, groupId: null, goal: "Malformed timestamp fixture", topic: "biology",
    started: "9".repeat(100), ended: "9".repeat(100), target: 60, segments: [],
  };
  await db.$executeRaw`UPDATE adventure_state SET state = ${JSON.stringify(world)}::jsonb WHERE id = 1`;

  const applyCorrection = (id: string, changes: Record<string, number>) => app.inject({ method: "PATCH",
    url: `/api/v1/admin/sessions/${id}`, headers: adminHeaders,
    payload: { expectedVersion: 0, reason: "Verify effective short-trip filter", changes } });
  expect((await applyCorrection(corrected, { targetSeconds: 60, elapsedSeconds: 50,
    actualStudySeconds: 40, focusedSeconds: 40, actualBreakSeconds: 0 })).statusCode).toBe(200);
  expect((await applyCorrection(fractionalCutoff, { elapsedSeconds: 60.001 })).statusCode).toBe(200);

  const all = await app.inject({ url: "/api/v1/admin/sessions?limit=50", headers: adminHeaders });
  const thirtyDays = await app.inject({ url: "/api/v1/admin/sessions?days=30&limit=50", headers: adminHeaders });
  const sevenDays = await app.inject({ url: "/api/v1/admin/sessions?days=7&limit=50", headers: adminHeaders });
  const ninetyDays = await app.inject({ url: "/api/v1/admin/sessions?days=90&limit=50", headers: adminHeaders });
  const planned = await app.inject({ url: "/api/v1/admin/sessions?durationBasis=planned&limit=50", headers: adminHeaders });
  const actual = await app.inject({ url: "/api/v1/admin/sessions?durationBasis=actual&limit=50", headers: adminHeaders });
  const reportWithMalformedTimestamp = await app.inject({
    url: `/api/v1/admin/report?days=7&accountId=${userId}`, headers: adminHeaders,
  });

  expect(all.statusCode, all.body).toBe(200);
  expect(all.json()).toMatchObject({ days: "all", window: "all", total: 6, truncated: false });
  expect(all.json().sessions).toHaveLength(6);
  expect(thirtyDays.json()).toMatchObject({ days: 30, window: "30d", total: 5 });
  expect(sevenDays.json()).toMatchObject({ days: 7, window: "7d", total: 4 });
  expect(ninetyDays.json()).toMatchObject({ days: 90, window: "90d", total: 6 });
  expect(ninetyDays.json().sessions.map((row: { id: string }) => row.id)).toContain(legacyBreak);
  expect(reportWithMalformedTimestamp.statusCode, reportWithMalformedTimestamp.body).toBe(200);
  expect(planned.json()).toMatchObject({ durationBasis: "planned", durationThresholdSeconds: 60, total: 5 });
  expect(planned.json().sessions.map((row: { id: string }) => row.id)).toEqual(expect.arrayContaining([
    legacyBreak, dayThirtyOnly, cappedWall, corrected, fractionalCutoff,
  ]));
  expect(actual.json()).toMatchObject({ durationBasis: "actual", durationThresholdSeconds: 60, total: 3 });
  expect(actual.json().sessions.map((row: { id: string }) => row.id)).toEqual(expect.arrayContaining([
    dayThirtyOnly, cappedWall, corrected,
  ]));
  expect(actual.json().sessions.map((row: { id: string }) => row.id)).not.toEqual(expect.arrayContaining([
    legacyBreak, partialPlannedBreak, fractionalCutoff,
  ]));
  expect(actual.json().sessions.find((row: { id: string }) => row.id === legacyBreak)).toBeUndefined();
  expect(actual.json().sessions.find((row: { id: string }) => row.id === partialPlannedBreak)).toBeUndefined();
  expect(actual.json().sessions.find((row: { id: string }) => row.id === fractionalCutoff)).toBeUndefined();
  expect(actual.json().sessions.find((row: { id: string }) => row.id === malformedId)).toBeUndefined();
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
  await server.stop();
  // pglite-socket schedules socket detach on setImmediate; drain it before closing WASM.
  await new Promise<void>((resolve) => setImmediate(resolve));
  await pg.close();
  redis.disconnect();
});
it.each(["http://localhost:8081", "http://192.168.1.182:8081"])(
  "allows credentialed preflight and error responses from %s in development",
  async (origin) => {
    const previous = config.NODE_ENV;
    let devApp: Awaited<ReturnType<typeof buildApp>> | undefined;
    try {
      config.NODE_ENV = "development";
      devApp = await buildApp({ db, redis: redis as unknown as Redis, logger: false });
      const preflight = await devApp.inject({
        method: "OPTIONS",
        url: "/api/v1/users/me",
        headers: {
          origin,
          "access-control-request-method": "PUT",
          "access-control-request-headers": "content-type,authorization,idempotency-key,x-request-id",
        },
      });
      const loginPreflight = await devApp.inject({
        method: "OPTIONS",
        url: "/api/v1/auth/login",
        headers: {
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type,authorization,x-requested-with,accept",
        },
      });
      expect(loginPreflight.statusCode).toBe(204);
      expect(loginPreflight.body).toBe("");
      expect(loginPreflight.headers["access-control-allow-origin"]).toBe(origin);
      expect(loginPreflight.headers["access-control-allow-credentials"]).toBe("true");
      const allowedHeaders = String(loginPreflight.headers["access-control-allow-headers"])
        .toLowerCase().split(",").map((header) => header.trim());
      expect(allowedHeaders).toEqual(expect.arrayContaining([
        "content-type", "authorization", "x-requested-with", "accept",
      ]));
      // strictPreflight=false also accepts OPTIONS without the usual preflight headers.
      for (const requestHeaders of [{ origin }, {}]) {
        const relaxedPreflight = await devApp.inject({
          method: "OPTIONS", url: "/api/v1/auth/login", headers: requestHeaders,
        });
        expect(relaxedPreflight.statusCode).toBe(204);
        expect(relaxedPreflight.body).toBe("");
      }
      const patchPreflight = await devApp.inject({
        method: "OPTIONS", url: "/api/v1/users/me",
        headers: { origin, "access-control-request-method": "PATCH" },
      });
      expect(patchPreflight.statusCode).toBe(204);
      expect(patchPreflight.headers["access-control-allow-methods"]).toContain("PATCH");
      expect(preflight.statusCode).toBe(204);
      expect(preflight.headers["access-control-allow-origin"]).toBe(origin);
      expect(preflight.headers["access-control-allow-credentials"]).toBe("true");
      expect(preflight.headers["access-control-allow-methods"]).toBe("GET, POST, PUT, DELETE, OPTIONS, PATCH");
      expect(String(preflight.headers["access-control-allow-headers"]).toLowerCase()).toContain("authorization");
      const response = await devApp.inject({
        method: "GET", url: "/api/v1/users/me", headers: { origin },
      });
      expect(response.statusCode).toBe(401);
      expect(response.headers["access-control-allow-origin"]).toBe(origin);
      expect(response.headers["access-control-allow-credentials"]).toBe("true");
    } finally {
      config.NODE_ENV = previous;
      await devApp?.close();
    }
  },
);
it("reflects origins in production with the explicitly requested permissive CORS configuration", async () => {
  const previous = config.NODE_ENV;
  const origins = config.CORS_ORIGIN;
  let productionApp: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    config.NODE_ENV = "production";
    config.CORS_ORIGIN = "https://app.example.com, https://admin.example.com";
    productionApp = await buildApp({ db, redis: redis as unknown as Redis, logger: false });
    for (const origin of ["https://app.example.com", "https://admin.example.com", "http://192.168.1.182:8081"]) {
      const response = await productionApp.inject({
        method: "OPTIONS", url: "/api/v1/users/me",
        headers: { origin, "access-control-request-method": "GET" },
      });
      expect(response.headers["access-control-allow-origin"]).toBe(
        origin,
      );
    }
  } finally {
    config.NODE_ENV = previous;
    config.CORS_ORIGIN = origins;
    await productionApp?.close();
  }
});
it("registers, logs in, rotates refresh tokens, rejects replay and revokes on logout", async () => {
  const payload = {
    email: "new@example.com",
    name: "Nguyễn Văn A",
    password: "Secure@123",
  };
  const registered = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload,
  });
  expect(registered.statusCode).toBe(201);
  const body = registered.json();
  expect(body.user.password_hash).toBeUndefined();
  expect(
    await db.refreshToken.findUnique({
      where: { token_hash: hashToken(body.tokens.refresh_token) },
    }),
  ).toBeTruthy();
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload,
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: payload.email, password: payload.password },
      })
    ).statusCode,
  ).toBe(200);
  const refreshed = await app.inject({
    method: "POST",
    url: "/api/v1/auth/refresh",
    payload: { refresh_token: body.tokens.refresh_token },
  });
  expect(refreshed.statusCode).toBe(200);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        payload: { refresh_token: body.tokens.refresh_token },
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/logout",
        headers: { authorization: `Bearer ${refreshed.json().access_token}` },
      })
    ).statusCode,
  ).toBe(204);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        payload: { refresh_token: refreshed.json().refresh_token },
      })
    ).statusCode,
  ).toBe(401);
});

it("blocks suspended accounts at HTTP, password/OAuth login, refresh, and existing WebSocket frames", async () => {
  const providerId = randomUUID();
  const email = `suspended-${randomUUID()}@example.com`;
  const password = "Temporary!123";
  const identity = { id: providerId, email, name: "Suspended fixture" };
  const account = await db.user.create({
    data: {
      email,
      name: identity.name,
      auth_provider: "google",
      auth_provider_id: providerId,
      password_hash: await bcrypt.hash(password, 4),
    },
  });
  const oauthApp = await buildApp({
    db,
    redis: redis as unknown as Redis,
    logger: false,
    verifyOAuth: async () => identity,
  });
  let ws: Awaited<ReturnType<typeof app.injectWS>> | undefined;
  try {
    await oauthApp.ready();
    const oauthBefore = await oauthApp.inject({
      method: "POST",
      url: "/api/v1/auth/oauth/google",
      payload: { id_token: "synthetic-provider-token" },
    });
    expect(oauthBefore.statusCode).toBe(200);
    const tokens = await issueTokens(db, account);
    ws = await app.injectWS(`/ws/v1?token=${tokens.access_token}`);

    await db.user.update({ where: { id: account.id }, data: {
      suspended_at: new Date(), admin_state_version: { increment: 1 },
    } });
    const authenticated = await app.inject({
      url: "/api/v1/users/me",
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    const passwordLogin = await app.inject({
      method: "POST", url: "/api/v1/auth/login", payload: { email, password },
    });
    const oauthAfter = await oauthApp.inject({
      method: "POST", url: "/api/v1/auth/oauth/google", payload: { id_token: "synthetic-provider-token" },
    });
    const refresh = await app.inject({
      method: "POST", url: "/api/v1/auth/refresh", payload: { refresh_token: tokens.refresh_token },
    });
    await expect(app.injectWS(`/ws/v1?token=${tokens.access_token}`)).rejects.toThrow();
    expect(authenticated.statusCode).toBe(401);
    expect(passwordLogin.statusCode).toBe(401);
    expect(oauthAfter.statusCode).toBe(401);
    expect(refresh.statusCode).toBe(401);

    const closeCode = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Suspended WebSocket was not closed")), 3000);
      ws!.once("close", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
      ws!.send(JSON.stringify({
        event: "session:start",
        payload: { session_id: randomUUID(), topic_id: "biology", target_duration: 60 },
      }));
    });
    expect(closeCode).toBe(1008);

    await db.user.update({ where: { id: account.id }, data: {
      suspended_at: null, admin_state_version: { increment: 1 },
    } });
    const restoredWithOldAccess = await app.inject({
      url: "/api/v1/users/me",
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    expect(restoredWithOldAccess.statusCode).toBe(401);
  } finally {
    ws?.terminate();
    await db.user.update({ where: { id: account.id }, data: { suspended_at: null } });
    await oauthApp.close();
  }
});

it("blocks deleted accounts across HTTP, login, OAuth, refresh, and existing WebSocket frames, including after restore", async () => {
  const providerId = randomUUID();
  const email = `deleted-${randomUUID()}@example.com`;
  const password = "Temporary!123";
  const account = await db.user.create({
    data: {
      email,
      name: "Deleted fixture",
      auth_provider: "google",
      auth_provider_id: providerId,
      password_hash: await bcrypt.hash(password, 4),
    },
  });
  const oauthApp = await buildApp({
    db,
    redis: redis as unknown as Redis,
    logger: false,
    verifyOAuth: async () => ({ id: providerId, email, name: "Deleted fixture" }),
  });
  let ws: Awaited<ReturnType<typeof app.injectWS>> | undefined;
  try {
    await oauthApp.ready();
    const tokens = await issueTokens(db, account);
    ws = await app.injectWS(`/ws/v1?token=${tokens.access_token}`);
    await db.refreshToken.deleteMany({ where: { user_id: account.id } });
    await db.user.update({ where: { id: account.id }, data: {
      deleted_at: new Date(), admin_state_version: { increment: 1 },
    } });

    const authenticated = await app.inject({
      url: "/api/v1/users/me",
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    const passwordLogin = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
    const oauthLogin = await oauthApp.inject({
      method: "POST", url: "/api/v1/auth/oauth/google", payload: { id_token: "synthetic-provider-token" },
    });
    const refresh = await app.inject({ method: "POST", url: "/api/v1/auth/refresh", payload: { refresh_token: tokens.refresh_token } });
    await expect(app.injectWS(`/ws/v1?token=${tokens.access_token}`)).rejects.toThrow();
    expect([authenticated.statusCode, passwordLogin.statusCode, oauthLogin.statusCode, refresh.statusCode]).toEqual([401, 401, 401, 401]);

    const closeCode = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Deleted WebSocket was not closed")), 3000);
      ws!.once("close", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
      ws!.send(JSON.stringify({
        event: "session:start",
        payload: { session_id: randomUUID(), topic_id: "biology", target_duration: 60 },
      }));
    });
    expect(closeCode).toBe(1008);

    await db.user.update({ where: { id: account.id }, data: {
      deleted_at: null, admin_state_version: { increment: 1 },
    } });
    const oldAccessAfterRestore = await app.inject({
      url: "/api/v1/users/me", headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    const oldRefreshAfterRestore = await app.inject({
      method: "POST", url: "/api/v1/auth/refresh", payload: { refresh_token: tokens.refresh_token },
    });
    expect(oldAccessAfterRestore.statusCode).toBe(401);
    expect(oldRefreshAfterRestore.statusCode).toBe(401);
    const freshLogin = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
    expect(freshLogin.statusCode, freshLogin.body).toBe(200);
    const freshAccess = await app.inject({
      url: "/api/v1/users/me",
      headers: { authorization: `Bearer ${freshLogin.json().tokens.access_token}` },
    });
    expect(freshAccess.statusCode).toBe(200);
  } finally {
    ws?.terminate();
    await db.user.update({ where: { id: account.id }, data: { deleted_at: null, suspended_at: null } });
    await oauthApp.close();
  }
});

it("closes an existing WebSocket when a persistent admin role is revoked", async () => {
  const account = await db.user.create({
    data: {
      email: `revoked-admin-${randomUUID()}@example.com`,
      name: "Revoked admin fixture",
      admin_state_version: 1,
      adminGrant: { create: { is_active: true } },
    },
  });
  const tokens = await issueTokens(db, account);
  const ws = await app.injectWS(`/ws/v1?token=${tokens.access_token}`);
  try {
    await db.$transaction(async (tx) => {
      await tx.adminGrant.update({ where: { user_id: account.id }, data: { is_active: false } });
      await tx.user.update({ where: { id: account.id }, data: { admin_state_version: { increment: 1 } } });
    });
    await expect(app.injectWS(`/ws/v1?token=${tokens.access_token}`)).rejects.toThrow();
    const closeCode = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Revoked-admin WebSocket was not closed")), 3000);
      ws.once("close", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
      ws.send(JSON.stringify({ event: "session:start", payload: {} }));
    });
    expect(closeCode).toBe(1008);
    const freshTokens = await issueTokens(db, await db.user.findUniqueOrThrow({ where: { id: account.id } }));
    expect((await app.inject({ url: "/api/v1/users/me", headers: { authorization: `Bearer ${freshTokens.access_token}` } })).statusCode).toBe(200);
  } finally {
    ws.terminate();
    await db.user.update({ where: { id: account.id }, data: { admin_state_version: 0 } });
    await db.adminGrant.delete({ where: { user_id: account.id } });
  }
});

it("returns problem details for invalid input, unauthenticated and invalid credentials", async () => {
  const invalid = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email: "bad" },
  });
  expect(invalid.statusCode).toBe(400);
  expect(invalid.json().errors.length).toBeGreaterThan(0);
  const denied = await app.inject("/api/v1/users/me");
  expect(denied.statusCode).toBe(401);
  expect(denied.headers["content-type"]).toContain("application/problem+json");
  expect(denied.headers["x-frame-options"]).toBe("DENY");
  expect(denied.headers["x-request-id"]).toBeTruthy();
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "missing@example.com", password: "Wrong@123" },
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/oauth/google",
        payload: { id_token: "invalid" },
      })
    ).statusCode,
  ).toBe(503);
});
it("limits auth requests to ten per minute", async () => {
  for (let i = 0; i < 10; i++)
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/auth/register",
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: {},
  });
  expect(response.statusCode).toBe(429);
  expect(response.json().status).toBe(429);
});
it("reads and updates profile, lists topics", async () => {
  expect(
    (await app.inject({ url: "/api/v1/users/me", headers })).json().id,
  ).toBe(userId);
  expect(
    (
      await app.inject({
        method: "PUT",
        url: "/api/v1/users/me",
        headers,
        payload: { name: "Tên mới" },
      })
    ).json().name,
  ).toBe("Tên mới");
  expect(
    (await app.inject({ url: "/api/v1/topics", headers })).json().topics[0]
      .question_count,
  ).toBe(1);
});
it("rejects an admin profile edit when the account name changed after its list snapshot", async () => {
  const actor = await db.user.create({
    data: { email: `admin-${randomUUID()}@example.test`, name: "Synthetic profile admin" },
  });
  const target = await db.user.create({
    data: { email: `target-${randomUUID()}@example.test`, name: "Listed account name" },
  });
  const actorTokens = await issueTokens(db, actor);
  const targetTokens = await issueTokens(db, target);
  const previousAdminIds = config.ADMIN_USER_IDS;
  config.ADMIN_USER_IDS = [actor.id];
  const adminApp = await buildApp({ db, redis: redis as unknown as Redis, logger: false });
  config.ADMIN_USER_IDS = previousAdminIds;

  try {
    await adminApp.ready();
    const listed = await adminApp.inject({
      url: `/api/v1/admin/accounts?q=${target.id}`,
      headers: { authorization: `Bearer ${actorTokens.access_token}` },
    });
    expect(listed.statusCode, listed.body).toBe(200);
    const snapshot = listed.json().users[0];
    expect(snapshot).toMatchObject({ id: target.id, name: "Listed account name", adminStateVersion: 0 });

    const ordinaryProfileUpdate = await app.inject({
      method: "PUT",
      url: "/api/v1/users/me",
      headers: { authorization: `Bearer ${targetTokens.access_token}` },
      payload: { name: "Learner changed this name" },
    });
    expect(ordinaryProfileUpdate.statusCode, ordinaryProfileUpdate.body).toBe(200);

    const staleAdminEdit = await adminApp.inject({
      method: "PUT",
      url: `/api/v1/admin/accounts/${target.id}/profile`,
      headers: { authorization: `Bearer ${actorTokens.access_token}` },
      payload: {
        name: "Admin overwrite must not win",
        expectedName: snapshot.name,
        expectedVersion: snapshot.adminStateVersion,
        reason: "Reject stale profile snapshot",
      },
    });
    expect(staleAdminEdit.statusCode, staleAdminEdit.body).toBe(409);
    expect(await db.user.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({
      name: "Learner changed this name",
      admin_state_version: 0,
    });
    expect(await db.adminActionAudit.count({ where: { target_user_id: target.id } })).toBe(0);
  } finally {
    await adminApp.close();
  }
});
it("saves idempotently, lists pages, hides other users sessions", async () => {
  const payload = session();
  const first = await app.inject({
    method: "POST",
    url: "/api/v1/sessions",
    headers,
    payload,
  });
  expect(first.statusCode).toBe(201);
  sessionId = first.json().id;
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/sessions",
        headers,
        payload,
      })
    ).json().id,
  ).toBe(sessionId);
  expect(
    await db.studySession.count({ where: { client_id: payload.client_id } }),
  ).toBe(1);
  expect(
    (
      await app.inject({
        url: `/api/v1/sessions/${sessionId}`,
        headers: stranger,
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (await app.inject({ url: "/api/v1/sessions", headers: stranger })).json()
      .data,
  ).toEqual([]);
  expect(
    (
      await app.inject({
        url: "/api/v1/sessions?is_completed=true&limit=1",
        headers,
      })
    ).json().pagination.total,
  ).toBeGreaterThan(0);
  expect(
    (await app.inject({ url: "/api/v1/sessions?page=0", headers })).statusCode,
  ).toBe(400);
  const stats = await app.inject({
    url: "/api/v1/sessions/stats?period=all",
    headers,
  });
  expect(stats.statusCode).toBe(200);
  expect(stats.json().total_focus_time_seconds).toBeGreaterThan(0);
});
it("rejects documents absent from the owner account", async () => {
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/sessions",
        headers,
        payload: {
          ...session(),
          documents: [
            { id: randomUUID(), name: "doc", url: "https://example.com/doc" },
          ],
        },
      })
    ).statusCode,
  ).toBe(404);
});
it("scores on server and retries answers without duplication", async () => {
  expect(
    (
      await app.inject({ url: "/api/v1/quizzes?topic_id=biology", headers })
    ).json().questions[0].id,
  ).toBe(questionId);
  const payload = {
    session_id: sessionId,
    question_id: questionId,
    selected_index: 1,
  };
  const answer = await app.inject({
    method: "POST",
    url: "/api/v1/quizzes/answer",
    headers,
    payload,
  });
  expect(answer.statusCode).toBe(201);
  expect(answer.json().is_correct).toBe(true);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/quizzes/answer",
        headers,
        payload: { ...payload, selected_index: 0 },
      })
    ).json().id,
  ).toBe(answer.json().id);
  const row = await db.studySession.findUniqueOrThrow({
    where: { id: sessionId },
  });
  expect(row.quiz_score).toBe(1);
  expect(row.total_quiz_questions).toBe(1);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/quizzes/answer",
        headers: stranger,
        payload,
      })
    ).statusCode,
  ).toBe(404);
});
it("lists and grades only owned AI questions in the legacy quiz routes", async () => {
  const makeQuestion = (ownerId: string | null, source: string, question: string) =>
    db.quizQuestion.create({
      data: {
        topic_id: "biology", owner_id: ownerId, question,
        options: ["A", "B", "C", "D"], correct_index: 1,
        explanation: "Fixture explanation", source,
      },
    });
  const ownedAi = await makeQuestion(userId, "ai_generated", "Owned AI fixture");
  const ownedGemini = await makeQuestion(userId, "gemini_generated", "Owned Gemini fixture");
  const ownedStatic = await makeQuestion(userId, "static", "Owned static fixture");
  const sharedAi = await makeQuestion(null, "gemini_generated", "Shared AI fixture");
  const otherAi = await makeQuestion(otherUserId, "gemini_generated", "Other AI fixture");

  const listing = await app.inject({ url: "/api/v1/quizzes?topic_id=biology", headers });
  expect(listing.statusCode).toBe(200);
  const listedIds = listing.json().questions.map((question: { id: string }) => question.id);
  expect(listedIds).toContain(ownedAi.id);
  expect(listedIds).toContain(ownedGemini.id);
  for (const excluded of [ownedStatic, sharedAi, otherAi]) expect(listedIds).not.toContain(excluded.id);

  const saved = await app.inject({ method: "POST", url: "/api/v1/sessions", headers, payload: session() });
  expect(saved.statusCode).toBe(201);
  const answer = (questionId: string) => app.inject({
    method: "POST", url: "/api/v1/quizzes/answer", headers,
    payload: { session_id: saved.json().id, question_id: questionId, selected_index: 1 },
  });
  expect((await answer(ownedAi.id)).statusCode).toBe(201);
  expect((await answer(ownedGemini.id)).statusCode).toBe(201);
  for (const excluded of [ownedStatic, sharedAi, otherAi])
    expect((await answer(excluded.id)).statusCode).toBe(404);
  for (const excluded of [ownedStatic, sharedAi, otherAi]) {
    const assessment = await app.inject({
      method: "POST", url: "/api/v1/adventure/quiz", headers,
      payload: { sessionId: randomUUID(), answers: [{ id: excluded.id, selected: 1 }] },
    });
    expect(assessment.statusCode).toBe(403);
  }
  // Keep this ownership fixture isolated from subsequent listing tests.
  await db.studySession.delete({ where: { id: saved.json().id } });
  await db.quizQuestion.deleteMany({
    where: { id: { in: [ownedAi, ownedGemini, ownedStatic, sharedAi, otherAi].map(row => row.id) } },
  });
});
it("uploads multipart text, generates private questions, enforces ownership and deletes", async () => {
  const boundary = "test-boundary";
  const payload = `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nStudy notes\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="notes.txt"\r\nContent-Type: text/plain\r\n\r\nStudy material\r\n--${boundary}--\r\n`;
  const uploaded = await app.inject({
    method: "POST",
    url: "/api/v1/documents/upload",
    headers: {
      ...headers,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  });
  expect(uploaded.statusCode).toBe(201);
  const doc = uploaded.json();
  expect(doc.name).toBe("Study notes");
  const body = {
    topic_id: "biology",
    document_ids: [doc.id],
    question_count: 1,
    difficulty: "medium",
  };
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/quizzes/generate",
        headers: stranger,
        payload: body,
      })
    ).statusCode,
  ).toBe(404);
  const generated = await app.inject({
    method: "POST",
    url: "/api/v1/quizzes/generate",
    headers,
    payload: body,
  });
  expect(generated.statusCode).toBe(200);
  expect(generated.json().generated_questions).toHaveLength(1);
  expect(
    (
      await app.inject({
        url: "/api/v1/quizzes?topic_id=biology",
        headers: stranger,
      })
    ).json().questions,
  ).toHaveLength(0);
  expect(
    (
      await app.inject({
        method: "DELETE",
        url: `/api/v1/documents/${doc.id}`,
        headers: stranger,
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        method: "DELETE",
        url: `/api/v1/documents/${doc.id}`,
        headers,
      })
    ).statusCode,
  ).toBe(204);
});
it("checks dependency readiness", async () => {
  const response = await app.inject("/health");
  expect(response.statusCode).toBe(200);
  expect(response.json().services).toEqual({
    database: "up",
    redis: "up",
    s3: "up",
  });
});

it("serves web and account creation together in production without requiring document storage", async () => {
  const previous = { mode: config.NODE_ENV, storage: config.STORAGE_DRIVER };
  const directory = await mkdtemp(join(tmpdir(), "viendu-production-test-"));
  const storageProbe = vi.fn().mockRejectedValue(new Error("S3 is not configured"));
  let productionApp: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    config.NODE_ENV = "production";
    config.STORAGE_DRIVER = "disabled";
    await writeFile(join(directory, "index.html"), "<html>Viễn Du</html>");
    productionApp = await buildApp({ db, redis: redis as unknown as Redis, storageHealth: storageProbe, logger: false });
    await registerWebAssets(productionApp, directory);
    const web = await productionApp.inject("/");
    expect(web.statusCode).toBe(200);
    expect(web.headers["content-security-policy"]).toContain("script-src 'self'");
    const health = await productionApp.inject("/health");
    expect(health.statusCode).toBe(200);
    expect(health.json().services).toEqual({ database: "up", redis: "up", document_storage: "disabled" });
    expect(storageProbe).not.toHaveBeenCalled();
    const account = { email: `railway-${randomUUID()}@example.com`, name: "Railway test", password: "TestOnly!123" };
    const registration = await productionApp.inject({ method: "POST", url: "/api/v1/auth/register", payload: account });
    expect(registration.statusCode).toBe(201);
    expect(registration.headers["content-type"]).toContain("application/json");
    const login = await productionApp.inject({ method: "POST", url: "/api/v1/auth/login", payload: account });
    expect(login.statusCode).toBe(200);
    const me = await productionApp.inject({ url: "/api/v1/users/me", headers: { authorization: `Bearer ${login.json().tokens.access_token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe(account.email);
  } finally {
    config.NODE_ENV = previous.mode;
    config.STORAGE_DRIVER = previous.storage;
    await productionApp?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it("authenticates websocket events and tracks the focus lifecycle", async () => {
  await expect(app.injectWS("/ws/v1?token=invalid")).rejects.toThrow();
  const ws = await app.injectWS(
    `/ws/v1?token=${headers.authorization.slice(7)}`,
  );
  const id = randomUUID();
  const exchange = (event: string, payload: unknown) =>
    new Promise<{ event: string; payload: Record<string, unknown> }>(
      (resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("WebSocket response timeout")),
          3000,
        );
        ws.once("message", (data) => {
          clearTimeout(timer);
          resolve(JSON.parse(data.toString()));
        });
        ws.send(JSON.stringify({ event, payload }));
      },
    );
  try {
    const start = await exchange("session:start", {
      session_id: id,
      topic_id: "biology",
      target_duration: 60,
    });
    expect(start.event).toBe("session:tick");
    expect(start.payload.remaining_seconds).toBe(60);
    const warning = await exchange("distraction:attempt", {
      session_id: id,
      app_id: "unknown",
      timestamp: new Date().toISOString(),
    });
    expect(warning.event).toBe("distraction:warning");
    const state = JSON.parse((await redis.get(`focus:${userId}`))!);
    expect(state.attempts).toBe(1);
    expect(state.deadline).toBeGreaterThan(Date.now());
    const mismatch = await exchange("session:end", {
      session_id: randomUUID(),
      actual_duration: 1,
      is_completed: false,
    });
    expect(mismatch.event).toBe("error");
  } finally {
    ws.terminate();
  }
});

it("generates private Gemini questions with database UUIDs and grades them", async () => {
  const generated = await app.inject({ method: "POST", url: "/api/v1/quiz/generate", headers,
    payload: { topic: "biology", count: 1 } });
  expect(generated.statusCode).toBe(201);
  const questions = generated.json();
  expect(Array.isArray(questions)).toBe(true);
  expect(questions[0].id).not.toBe("provider-label");
  expect(questions[0].correctAnswerIndex).toBe(1);
  const row = await db.quizQuestion.findUniqueOrThrow({ where: { id: questions[0].id } });
  expect(row.owner_id).toBe(userId);
  expect(row.source).toBe("gemini_generated");
  expect(row.knowledge_point).toBe("Cell structure");
  expect(questions[0].knowledgePoint).toBe("Cell structure");
  const saved = await app.inject({ method: "POST", url: "/api/v1/sessions", headers, payload: session() });
  const answer = { session_id: saved.json().id, question_id: row.id, selected_index: 1 };
  expect((await app.inject({ method: "POST", url: "/api/v1/quizzes/answer", headers, payload: answer })).json().is_correct).toBe(true);
  const foreign = await app.inject({ method: "POST", url: "/api/v1/quizzes/answer", headers: stranger, payload: answer });
  expect(foreign.statusCode).toBe(404);
});
it("stores the generated question as the knowledge point when the provider omits it", async () => {
  vi.mocked(generateGeminiQuiz).mockResolvedValueOnce([{
    id: "provider-label", question: "A bounded question?", options: ["A", "B", "C", "D"],
    correctAnswerIndex: 1, explanation: "Provider explanation",
  }]);
  const generated = await app.inject({ method: "POST", url: "/api/v1/quiz/generate", headers,
    payload: { topic: "biology", goal: "Review cells", count: 1 } });
  expect(generated.statusCode).toBe(201);
  expect(generated.json()[0].knowledgePoint).toBe("A bounded question?");
  const row = await db.quizQuestion.findUniqueOrThrow({ where: { id: generated.json()[0].id } });
  expect(row.knowledge_point).toBe("A bounded question?");
});
it("rejects invalid Gemini requests before calling the provider", async () => {
  vi.mocked(generateGeminiQuiz).mockClear();
  for (const payload of [
    { topic: "biology", count: 31 }, { topic: "biology", goal: "x".repeat(501) },
  ]) {
    expect((await app.inject({ method: "POST", url: "/api/v1/quiz/generate", headers, payload })).statusCode).toBe(400);
  }
  expect((await app.inject({ method: "POST", url: "/api/v1/quiz/generate", headers, payload: { topic: "absent", count: 1 } })).statusCode).toBe(404);
  expect((await app.inject({ method: "POST", url: "/api/v1/quiz/generate", payload: { topic: "biology" } })).statusCode).toBe(401);
  expect(generateGeminiQuiz).not.toHaveBeenCalled();
});
it("adventure requires auth, prevents duplicate credit, hides private sessions, and keeps invitations revocable", async () => {
  expect(
    (await app.inject({ method: "GET", url: "/api/v1/adventure" })).statusCode,
  ).toBe(401);
  const make = await app.inject({
    method: "POST",
    url: "/api/v1/adventure/groups",
    headers,
    payload: { name: "Morning train", timezone: "Asia/Ho_Chi_Minh" },
  });
  expect(make.statusCode).toBe(200);
  const groupId = make.json().group.id;
  const invite = await app.inject({
    method: "POST",
    url: "/api/v1/adventure/invite",
    headers,
  });
  const joined = await app.inject({
    method: "POST",
    url: "/api/v1/adventure/join",
    headers: stranger,
    payload: { token: invite.json().token },
  });
  expect(joined.json().group.members).toHaveLength(2);
  const at = Date.now(),
    payload = {
      id: randomUUID(),
      groupId: null,
      goal: "Private lesson",
      topic: "biology",
      started: at - 60000,
      ended: at,
      target: 60,
      segments: [{ start: at - 60000, end: at, kind: "focus" }],
    };
  const first = await app.inject({
    method: "POST",
    url: "/api/v1/adventure/sessions",
    headers,
    payload,
  });
  expect(first.statusCode).toBe(200);
  const retry = await app.inject({
    method: "POST",
    url: "/api/v1/adventure/sessions",
    headers,
    payload,
  });
  expect(retry.json().person.seconds).toBe(60);
  const other = await app.inject({
    method: "GET",
    url: "/api/v1/adventure",
    headers: stranger,
  });
  expect(other.json().sessions).toHaveLength(0);
  expect(JSON.stringify(other.json())).not.toContain("Private lesson");
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/adventure/invite",
        headers: stranger,
      })
    ).statusCode,
  ).toBe(403);
  const left = await app.inject({
    method: "POST",
    url: "/api/v1/adventure/leave",
    headers,
  });
  expect(left.json().person.seconds).toBe(60);
  const state = await app.inject({
    method: "GET",
    url: "/api/v1/adventure",
    headers: stranger,
  });
  expect(state.json().group.id).toBe(groupId);
  expect(state.json().group.owner).not.toBe(userId);
  const revoked = await app.inject({
    method: "POST",
    url: "/api/v1/adventure/join",
    headers,
    payload: { token: invite.json().token },
  });
  expect(revoked.statusCode).toBe(400);
});

it("serializes concurrent invitations without exceeding six members", async () => {
  await app.inject({
    method: "POST",
    url: "/api/v1/adventure/groups",
    headers,
    payload: { name: "Capacity test", timezone: "UTC" },
  });
  const invite = await app.inject({
    method: "POST",
    url: "/api/v1/adventure/invite",
    headers,
  });
  const candidates = [];
  for (let i = 0; i < 6; i++) {
    const candidate = await db.user.create({
      data: {
        email: `capacity-${randomUUID()}@example.com`,
        name: "Candidate",
      },
    });
    candidates.push({
      authorization: `Bearer ${(await issueTokens(db, candidate)).access_token}`,
    });
  }
  const results = await Promise.all(
    candidates.map((h) =>
      app.inject({
        method: "POST",
        url: "/api/v1/adventure/join",
        headers: h,
        payload: { token: invite.json().token },
      }),
    ),
  );
  expect(results.filter((r) => r.statusCode === 200)).toHaveLength(5);
  expect(results.filter((r) => r.statusCode === 400)).toHaveLength(1);
  const state = await app.inject({
    method: "GET",
    url: "/api/v1/adventure",
    headers,
  });
  expect(state.json().group.members).toHaveLength(6);
});
it("grades thirty answers from trusted question data, freezes the first assessment, and protects owners", async () => {
  const questionRows = await Promise.all(Array.from({ length: 30 }, (_, index) =>
    db.quizQuestion.create({ data: {
      topic_id: "biology", owner_id: userId, question: `Trusted question ${index}`,
      options: ["A", "B", "C", "D"], correct_index: index % 4,
      explanation: `Trusted explanation ${index}`,
      knowledge_point: index === 0 ? null : `Trusted concept ${index}`,
    } }),
  ));
  const at = Date.now(),
    id = randomUUID();
  const payload = {
    id,
    groupId: null,
    goal: "Quiz study",
    topic: "biology",
    started: at - 60000,
    ended: at,
    target: 60,
    segments: [{ start: at - 60000, end: at, kind: "focus" }],
  };
  const saves = await Promise.all(
    [1, 2].map(() =>
      app.inject({
        method: "POST",
        url: "/api/v1/adventure/sessions",
        headers,
        payload,
      }),
    ),
  );
  expect(saves.every((r) => r.statusCode === 200)).toBe(true);
  const result = await app.inject({
    method: "POST",
    url: "/api/v1/adventure/quiz",
    headers,
    payload: { sessionId: id, answers: questionRows.map((question, index) => ({
      id: question.id, selected: index % 2 === 0 ? (index + 1) % 4 : index % 4,
      correctIndex: 3, correct: true, explanation: "Client spoof", knowledgePoint: "Client spoof",
    })) },
  });
  expect(result.statusCode).toBe(200);
  const assessment = result.json().sessions[0].quiz;
  expect(assessment).toMatchObject({ score: 15, total: 30 });
  expect(assessment.feedback).toHaveLength(30);
  const reopened = await app.inject({ url: "/api/v1/adventure", headers });
  expect(reopened.json().sessions[0].quiz).toEqual(assessment);
  const publicHistory = await app.inject({ url: "/api/v1/experiments" });
  expect(publicHistory.json().runs[0]).toMatchObject({ quizScore: 15, quizTotal: 30 });
  const publicCsv = await app.inject({ url: "/api/v1/experiments/export.csv" });
  for (const response of [publicHistory, publicCsv]) {
    for (const privateText of ["Trusted question", "Trusted explanation", "Trusted concept", questionRows[0].id])
      expect(response.body).not.toContain(privateText);
  }
  expect(assessment.feedback[0]).toEqual({
    questionId: questionRows[0].id, question: "Trusted question 0", options: ["A", "B", "C", "D"],
    selected: 1, correctIndex: 0, correct: false, explanation: "Trusted explanation 0",
    knowledgePoint: "Trusted question 0",
  });
  expect(assessment.feedback[1]).toMatchObject({
    questionId: questionRows[1].id, selected: 1, correctIndex: 1, correct: true,
    explanation: "Trusted explanation 1", knowledgePoint: "Trusted concept 1",
  });
  const retry = await app.inject({
    method: "POST",
    url: "/api/v1/adventure/quiz",
    headers,
    payload: { sessionId: id, answers: questionRows.map((question) => ({ id: question.id, selected: 0 })) },
  });
  expect(retry.json().sessions[0].quiz).toEqual(assessment);
  expect(retry.json().person.seconds).toBe(60);
  const tooMany = await app.inject({
    method: "POST", url: "/api/v1/adventure/quiz", headers,
    payload: { sessionId: id, answers: [...questionRows, { id: randomUUID(), selected: 0 }].map((question) => ({ id: question.id, selected: 0 })) },
  });
  expect(tooMany.statusCode).toBe(400);
  await db.topic.upsert({ where: { id: "mathematics" },
    create: { id: "mathematics", name: "Mathematics", icon: "📐" },
    update: {} });
  const wrongTopic = await db.quizQuestion.create({ data: {
    topic_id: "mathematics", owner_id: userId, question: "Other topic question",
    options: ["A", "B", "C", "D"], correct_index: 1, explanation: "Other topic explanation",
  } });
  const mismatch = await app.inject({ method: "POST", url: "/api/v1/adventure/quiz", headers,
    payload: { sessionId: id, answers: [{ id: wrongTopic.id, selected: 1 }] } });
  expect(mismatch.statusCode).toBe(200);
  expect(mismatch.json().sessions[0].quiz).toEqual(assessment);
  const otherQuestion = await db.quizQuestion.create({ data: {
    topic_id: "biology", owner_id: otherUserId, question: "Other owner AI question",
    options: ["A", "B", "C", "D"], correct_index: 1, explanation: "Other owner explanation",
    source: "gemini_generated",
  } });
  const other = await app.inject({
    method: "POST",
    url: "/api/v1/adventure/quiz",
    headers: stranger,
    payload: { sessionId: id, answers: [{ id: otherQuestion.id, selected: 1 }] },
  });
  expect(other.statusCode).toBe(404);
});
it("continues to read saved score-only assessments without detailed feedback", async () => {
  const at = Date.now();
  const id = randomUUID();
  const saved = await app.inject({ method: "POST", url: "/api/v1/adventure/sessions", headers,
    payload: { id, groupId: null, goal: "Older quiz", topic: "biology", started: at - 60000,
      ended: at, target: 60, segments: [{ start: at - 60000, end: at, kind: "focus" }] } });
  expect(saved.statusCode).toBe(200);
  const rows = await db.$queryRaw<{ state: { sessions: Record<string, Record<string, unknown>> } }[]>`
    SELECT state FROM adventure_state WHERE id = 1`;
  rows[0].state.sessions[id].quiz = { score: 2, total: 3 };
  await db.$executeRaw`UPDATE adventure_state SET state = ${JSON.stringify(rows[0].state)}::jsonb WHERE id = 1`;

  const result = await app.inject({ url: "/api/v1/adventure", headers });
  expect(result.statusCode).toBe(200);
  expect(result.json().sessions[0].quiz).toEqual({ score: 2, total: 3 });
});
it("requires an authenticated owner to inspect a public summary share", async () => {
  const id = randomUUID();
  const ended = Date.now() - 1000;
  const saved = await app.inject({
    method: "POST",
    url: "/api/v1/adventure/sessions",
    headers,
    payload: { id, groupId: null, goal: "Review a synthetic lesson", topic: "biology", target: 60,
      started: ended - 60000, ended,
      segments: [{ start: ended - 60000, end: ended, kind: "focus" }] },
  });
  expect(saved.statusCode).toBe(200);

  const status = await app.inject({ url: `/api/v1/material-summaries/mine?sessionId=${id}` });
  expect(status.statusCode).toBe(401);
  const foreignStatus = await app.inject({ url: `/api/v1/material-summaries/mine?sessionId=${id}`, headers: stranger });
  expect(foreignStatus.statusCode).toBe(404);
  const ownerStatus = await app.inject({ url: `/api/v1/material-summaries/mine?sessionId=${id}`, headers });
  expect(ownerStatus.statusCode).toBe(200);
  expect(ownerStatus.headers["cache-control"]).toBe("no-store");
  expect(ownerStatus.json()).toEqual({ summary: null, version: 0, approvedAt: null });
});

it("publishes only the exact confirmed copy in public GET and never in CSV", async () => {
  const id = randomUUID();
  const ended = Date.now() - 1000;
  const saved = await app.inject({ method: "POST", url: "/api/v1/adventure/sessions", headers,
    payload: { id, groupId: null, goal: "Review a synthetic lesson", topic: "biology", target: 60,
      started: ended - 60000, ended, segments: [{ start: ended - 60000, end: ended, kind: "focus" }] } });
  expect(saved.statusCode).toBe(200);

  const missingConsent = await app.inject({ method: "POST", url: "/api/v1/material-summaries/share", headers,
    payload: { sessionId: id, summary: "Exact approved copy", expectedVersion: 0 } });
  expect(missingConsent.statusCode).toBe(400);
  const overLimit = await app.inject({ method: "POST", url: "/api/v1/material-summaries/share", headers,
    payload: { sessionId: id, summary: "x".repeat(501), expectedVersion: 0, confirmShare: true } });
  expect(overLimit.statusCode).toBe(400);
  const foreignPublish = await app.inject({ method: "POST", url: "/api/v1/material-summaries/share", headers: stranger,
    payload: { sessionId: id, summary: "Should not be visible", expectedVersion: 0, confirmShare: true } });
  expect(foreignPublish.statusCode).toBe(404);
  const extraPrivateField = await app.inject({ method: "POST", url: "/api/v1/material-summaries/share", headers,
    payload: { sessionId: id, summary: "Exact approved copy", expectedVersion: 0, confirmShare: true,
      sourceIds: ["private-source-id"] } });
  expect(extraPrivateField.statusCode).toBe(400);
  const summary = "  Exact reviewed copy.\nLine two.  ";
  const published = await app.inject({ method: "POST", url: "/api/v1/material-summaries/share", headers,
    payload: { sessionId: id, summary, expectedVersion: 0, confirmShare: true } });
  expect(published.statusCode).toBe(200);
  expect(published.json()).toMatchObject({ summary, version: 1, approvedAt: expect.any(String) });

  const history = await app.inject({ url: "/api/v1/experiments" });
  expect(history.headers["cache-control"]).toBe("no-store");
  const run = history.json().runs.find((row: { id: string }) => row.id === tripIdentity(userId, id, config.JWT_SECRET).id);
  expect(run.documentSummary).toBe(summary);
  for (const privateField of ["sourceId", "sourceText", "sourceName", "ownerId", "sessionId"])
    expect(run).not.toHaveProperty(privateField);
  const csv = await app.inject({ url: "/api/v1/experiments/export.csv" });
  expect(csv.body).not.toContain(summary.trim());
  expect(csv.body).not.toContain("document_summary");
  const status = await app.inject({ url: `/api/v1/material-summaries/mine?sessionId=${id}`, headers });
  expect(status.json()).toMatchObject({ summary, version: 1 });

  const withdrawn = await app.inject({ method: "POST", url: "/api/v1/material-summaries/share/withdraw", headers,
    payload: { sessionId: id, expectedVersion: 1 } });
  expect(withdrawn.statusCode).toBe(200);
  const historyAfterWithdrawal = await app.inject({ url: "/api/v1/experiments" });
  const withdrawnRun = historyAfterWithdrawal.json().runs.find((row: { id: string }) => row.id === tripIdentity(userId, id, config.JWT_SECRET).id);
  expect(withdrawnRun.documentSummary).toBeUndefined();
});

it("runs the frontend summary client through the actual Fastify routes from share to withdrawal", async () => {
  const id = randomUUID();
  const ended = Date.now() - 1000;
  const saved = await app.inject({ method: "POST", url: "/api/v1/adventure/sessions", headers,
    payload: { id, groupId: null, goal: "Synthetic source review", topic: "biology", target: 60,
      started: ended - 60000, ended, segments: [{ start: ended - 60000, end: ended, kind: "focus" }] } });
  expect(saved.statusCode).toBe(200);

  const originalWindow = globalThis.window;
  const originalStorage = globalThis.sessionStorage;
  const originalFetch = globalThis.fetch;
  const storageValues = new Map<string, string>();
  globalThis.window = {} as Window & typeof globalThis;
  globalThis.sessionStorage = {
    getItem: (key: string) => storageValues.get(key) ?? null,
    setItem: (key: string, value: string) => { storageValues.set(key, value); },
    removeItem: (key: string) => { storageValues.delete(key); },
    clear: () => storageValues.clear(),
    key: (index: number) => [...storageValues.keys()][index] ?? null,
    get length() { return storageValues.size; },
  } as Storage;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const response = await app.inject({
      method: init?.method ?? "GET",
      url: `${url.pathname}${url.search}`,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      payload: typeof init?.body === "string" ? init.body : undefined,
    });
    return new Response(response.body, {
      status: response.statusCode,
      headers: { "Content-Type": String(response.headers["content-type"] ?? "application/json") },
    });
  };
  try {
    const owner = await db.user.findUniqueOrThrow({ where: { id: userId } });
    await acceptFrontendTokens(await issueTokens(db, owner));
    expect(await readPublicMaterialSummary(id)).toEqual({ summary: null, version: 0, approvedAt: null });

    const exactSyntheticSummary = "Synthetic reviewed-source summary for the public goal cell.";
    const published = await publishPublicMaterialSummary(id, exactSyntheticSummary, 0);
    expect(published).toMatchObject({ summary: exactSyntheticSummary, version: 1 });
    const history = await frontendRequest<{ runs: Array<{ id: string; documentSummary?: string }> }>("/experiments", {}, false);
    const run = history.runs.find((row) => row.id === tripIdentity(userId, id, config.JWT_SECRET).id);
    expect(run?.documentSummary).toBe(exactSyntheticSummary);

    const withdrawn = await withdrawPublicMaterialSummary(id, 1);
    expect(withdrawn).toMatchObject({ summary: null, version: 2, approvedAt: null });
    const historyAfterWithdrawal = await frontendRequest<{ runs: Array<{ id: string; documentSummary?: string }> }>("/experiments", {}, false);
    const withdrawnRun = historyAfterWithdrawal.runs.find((row) => row.id === tripIdentity(userId, id, config.JWT_SECRET).id);
    expect(withdrawnRun?.documentSummary).toBeUndefined();
  } finally {
    await clearFrontendTokens();
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    globalThis.sessionStorage = originalStorage;
  }
});

it("versions replacement and withdrawal, rejects stale writes, and keeps the version after republish", async () => {
  const id = randomUUID();
  const ended = Date.now() - 1000;
  expect((await app.inject({ method: "POST", url: "/api/v1/adventure/sessions", headers,
    payload: { id, groupId: null, goal: "Versioned synthetic lesson", topic: "biology", target: 60,
      started: ended - 60000, ended, segments: [{ start: ended - 60000, end: ended, kind: "focus" }] } })).statusCode).toBe(200);
  const publish = await app.inject({ method: "POST", url: "/api/v1/material-summaries/share", headers,
    payload: { sessionId: id, summary: "Initial copy", expectedVersion: 0, confirmShare: true } });
  expect(publish.statusCode).toBe(200);

  const replacements = await Promise.all(["Replacement A", "Replacement B"].map((summary) => app.inject({
    method: "PUT", url: "/api/v1/material-summaries/share", headers,
    payload: { sessionId: id, summary, expectedVersion: 1, confirmReplacement: true },
  })));
  expect(replacements.map((response) => response.statusCode).sort()).toEqual([200, 409]);
  const winner = replacements.find((response) => response.statusCode === 200)!.json();
  expect(winner.version).toBe(2);
  const staleWithdrawal = await app.inject({ method: "POST", url: "/api/v1/material-summaries/share/withdraw", headers,
    payload: { sessionId: id, expectedVersion: 1 } });
  expect(staleWithdrawal.statusCode).toBe(409);
  expect((await app.inject({ url: `/api/v1/material-summaries/mine?sessionId=${id}`, headers })).json())
    .toMatchObject({ summary: winner.summary, version: 2 });
  expect((await app.inject({ method: "POST", url: "/api/v1/material-summaries/share/withdraw", headers,
    payload: { sessionId: id } })).statusCode).toBe(400);

  const withdrawn = await app.inject({ method: "POST", url: "/api/v1/material-summaries/share/withdraw", headers,
    payload: { sessionId: id, expectedVersion: 2 } });
  expect(withdrawn.statusCode).toBe(200);
  expect(withdrawn.json()).toMatchObject({ summary: null, version: 3, approvedAt: null });
  const repeated = await app.inject({ method: "POST", url: "/api/v1/material-summaries/share/withdraw", headers,
    payload: { sessionId: id, expectedVersion: 2 } });
  expect(repeated.statusCode).toBe(200);
  expect(repeated.json()).toMatchObject({ summary: null, version: 3 });
  const republished = await app.inject({ method: "POST", url: "/api/v1/material-summaries/share", headers,
    payload: { sessionId: id, summary: "Republished copy", expectedVersion: 3, confirmShare: true } });
  expect(republished.statusCode).toBe(200);
  expect(republished.json()).toMatchObject({ summary: "Republished copy", version: 4 });
});

it("counts astral characters as UTF-16 units and clears shares on tombstone and account deletion", async () => {
  const id = randomUUID();
  const ended = Date.now() - 1000;
  expect((await app.inject({ method: "POST", url: "/api/v1/adventure/sessions", headers,
    payload: { id, groupId: null, goal: "Bounded synthetic lesson", topic: "biology", target: 60,
      started: ended - 60000, ended, segments: [{ start: ended - 60000, end: ended, kind: "focus" }] } })).statusCode).toBe(200);
  expect((await app.inject({ method: "POST", url: "/api/v1/material-summaries/share", headers,
    payload: { sessionId: id, summary: "😀".repeat(251), expectedVersion: 0, confirmShare: true } })).statusCode).toBe(400);
  expect((await app.inject({ method: "POST", url: "/api/v1/material-summaries/share", headers,
    payload: { sessionId: id, summary: "Invalid\u0000summary", expectedVersion: 0, confirmShare: true } })).statusCode).toBe(400);
  const publish = await app.inject({ method: "POST", url: "/api/v1/material-summaries/share", headers,
    payload: { sessionId: id, summary: "😀".repeat(250), expectedVersion: 0, confirmShare: true } });
  expect(publish.statusCode).toBe(200);
  expect(publish.json().summary).toBe("😀".repeat(250));

  const removed = await app.inject({ method: "DELETE", url: `/api/v1/admin/sessions/${id}`, headers: adminHeaders,
    payload: { expectedVersion: 0, reason: "Remove synthetic public-summary trip" } });
  expect(removed.statusCode).toBe(200);
  const afterTombstone = await app.inject({ url: `/api/v1/material-summaries/mine?sessionId=${id}`, headers });
  expect(afterTombstone.json()).toMatchObject({ summary: null, version: 2, approvedAt: null });
  expect((await app.inject({ url: "/api/v1/experiments" })).json().total).toBe(0);

  const owner = await db.user.create({ data: { email: `share-delete-${randomUUID()}@example.com`, name: "Summary owner" } });
  const ownerHeaders = { authorization: `Bearer ${(await issueTokens(db, owner)).access_token}` };
  const accountSessionId = randomUUID();
  const accountEnded = Date.now() - 1000;
  expect((await app.inject({ method: "POST", url: "/api/v1/adventure/sessions", headers: ownerHeaders,
    payload: { id: accountSessionId, groupId: null, goal: "Account deletion fixture", topic: "biology", target: 60,
      started: accountEnded - 60000, ended: accountEnded,
      segments: [{ start: accountEnded - 60000, end: accountEnded, kind: "focus" }] } })).statusCode).toBe(200);
  expect((await app.inject({ method: "POST", url: "/api/v1/material-summaries/share", headers: ownerHeaders,
    payload: { sessionId: accountSessionId, summary: "Account deletion summary", expectedVersion: 0, confirmShare: true } })).statusCode).toBe(200);
  const deleted = await app.inject({ method: "PUT", url: `/api/v1/admin/accounts/${owner.id}/deletion`, headers: adminHeaders,
    payload: { expectedVersion: 0, reason: "Remove synthetic summary owner", deleted: true } });
  expect(deleted.statusCode).toBe(200);
  const rows = await db.$queryRaw<{ summary: string | null; version: number }[]>`
    SELECT summary, version FROM public_material_summary_shares WHERE user_id = ${owner.id}::uuid AND session_id = ${accountSessionId}`;
  expect(rows).toEqual([{ summary: null, version: 2 }]);
  const publicHistory = await app.inject({ url: "/api/v1/experiments" });
  expect(JSON.stringify(publicHistory.json())).not.toContain("Account deletion summary");
});

it("rolls back the entire Gemini quiz if a database insert fails", async () => {
  const before = await db.quizQuestion.count({ where: { owner_id: userId } });
  const valid = { id: "first", question: "Valid", options: ["A", "B", "C", "D"], correctAnswerIndex: 1, explanation: "Valid" };
  // Fault injection bypasses the provider adapter to exercise the database constraint/transaction.
  vi.mocked(generateGeminiQuiz).mockResolvedValueOnce([valid, { ...valid, id: "second", correctAnswerIndex: 9 }]);
  const response = await app.inject({ method: "POST", url: "/api/v1/quiz/generate", headers,
    payload: { topic: "biology", count: 2 } });
  expect(response.statusCode).toBe(500);
  // Socket detach rolls back asynchronously; wait for it before reading the shared PGlite DB.
  await expect.poll(() => pg.isInTransaction(), { timeout: 5000 }).toBe(false);
  const rows = await pg.query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM ai_questions WHERE owner_id=$1", [userId],
  );
  expect(rows.rows[0].count).toBe(before);
});
