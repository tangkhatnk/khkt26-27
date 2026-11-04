import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import RedisMock from "ioredis-mock";
import type { Redis } from "ioredis";
import { ApiError } from "../src/errors.js";
import { adventureRoutes } from "../src/adventure/routes.js";
import { guestAiRoutes } from "../src/guestAi.js";
import type { GuestAiWorkflowProviders } from "../src/guestAiWorkflows.js";
import type { StudyExerciseQuestion } from "../src/studyExerciseSchemas.js";

const migrationDirectory = new URL("../prisma/migrations/", import.meta.url);
let pg: PGlite;
let socket: PGLiteSocketServer;
let db: PrismaClient;
let app: ReturnType<typeof Fastify>;
let redis: RedisMock;
let now: number;

async function migrateAll() {
  const migrations = (await readdir(migrationDirectory, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && /^\d+_/u.test(entry.name))
    .map(entry => entry.name)
    .sort();
  for (const name of migrations)
    await pg.exec(await readFile(new URL(`${name}/migration.sql`, migrationDirectory), "utf8"));
}

beforeAll(async () => {
  pg = new PGlite();
  await migrateAll();
  socket = new PGLiteSocketServer({ db: pg, host: "127.0.0.1", port: 0, maxConnections: 10 });
  await socket.start();
  db = new PrismaClient({ datasources: { db: { url: `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?connection_limit=5&sslmode=disable` } } });
  redis = new RedisMock();
  const sourceText = "A stack follows last-in, first-out order.";
  const services: GuestAiWorkflowProviders = {
    readMaterialDocument: async () => ({ text: sourceText }),
    summarizeMaterialText: async () => ({ summary: "Private summary." }),
    generateStudyGuide: async () => ({ title: "Guide", text: "Private guide." }),
    generateGeminiQuiz: async () => [{
      id: "provider", question: "Which rule describes a stack?", options: ["LIFO", "FIFO", "Random", "Sorted"],
      correctAnswerIndex: 0, explanation: "A stack follows last-in, first-out order.",
    }],
    generateStudyExerciseQuestions: async () => [{ prompt: "Explain the stack rule.", evidenceExcerpt: sourceText }],
    generateStudyExerciseSolutions: async (_text: string, exercises: readonly StudyExerciseQuestion[]) =>
      exercises.map(exercise => ({ id: exercise.id, solution: "Apply LIFO.", explanation: "Use the stated ordering rule." })),
  };

  app = Fastify({ logger: false });
  app.decorateRequest("userId", "");
  app.setErrorHandler((error, _request, reply) => {
    const status = error instanceof ApiError ? error.status : error.name === "ZodError" ? 400 : 500;
    return reply.code(status).send({ status, detail: error.message });
  });
  adventureRoutes(app, db, async request => { request.userId = "00000000-0000-4000-8000-000000000099"; });
  guestAiRoutes(app, db, redis as unknown as Redis, services);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.$disconnect();
  redis?.disconnect();
  await socket?.stop();
  await pg?.close();
});

afterEach(() => { vi.restoreAllMocks(); });

describe("guest AI completion over PGlite", () => {
  it("publishes a guest session, then grades and releases solutions from owner-scoped Redis state", async () => {
    const baseNow = Date.now();
    now = baseNow;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const credential = await app.inject({ method: "POST", url: "/api/v1/ai/guest/credential", payload: {} });
    const token = (credential.json() as { token: string }).token;
    const sessionId = randomUUID();
    const requestId = randomUUID();

    const prepared = await app.inject({
      method: "POST", url: "/api/v1/ai/guest/study-exercises",
      headers: { authorization: `GuestAI ${token}` },
      payload: { requestId, plannedSessionId: sessionId, mode: "provided", text: "Solve a stack ordering exercise." },
    });
    expect(prepared.statusCode).toBe(201);
    const exerciseId = (prepared.json() as { id: string }).id;
    const bound = await app.inject({
      method: "POST", url: `/api/v1/ai/guest/study-exercises/session/${sessionId}/bind`,
      headers: { authorization: `GuestAI ${token}` }, payload: { exerciseId },
    });
    expect(bound.statusCode).toBe(200);
    expect(bound.json()).toEqual({ ok: true, exerciseId });
    const started = await app.inject({
      method: "POST", url: "/api/v1/ai/guest/sessions/start",
      headers: { authorization: `GuestAI ${token}` }, payload: { id: sessionId, target: 60 },
    });
    expect(started.statusCode).toBe(200);
    const startedAt = (started.json() as { startedAt: number }).startedAt;

    const quiz = await app.inject({
      method: "POST", url: "/api/v1/ai/guest/quizzes/generate",
      headers: { authorization: `GuestAI ${token}` },
      payload: { plannedSessionId: sessionId, topic: "biology", documentText: "A stack follows last-in, first-out order.", documentAttached: true, count: 1 },
    });
    expect(quiz.statusCode).toBe(201);
    const deck = quiz.json() as { id: string; questions: Array<{ id: string }> };

    const beforeCompletion = await app.inject({
      method: "POST", url: `/api/v1/ai/guest/study-exercises/${exerciseId}/solution`,
      headers: { authorization: `GuestAI ${token}` }, payload: {},
    });
    expect(beforeCompletion.statusCode).toBe(409);

    now = startedAt + 60_000;
    const published = await app.inject({
      method: "POST", url: "/api/v1/adventure/guest-sessions",
      headers: { authorization: `GuestAI ${token}` },
      payload: {
        id: sessionId, groupId: null, goal: "Review stack operations", topic: "biology",
        started: startedAt, ended: now, target: 60, segments: [{ start: startedAt, end: now, kind: "focus" }],
      },
    });
    expect(published.statusCode).toBe(200);

    const bindReplayAfterPublication = await app.inject({
      method: "POST", url: `/api/v1/ai/guest/study-exercises/session/${sessionId}/bind`,
      headers: { authorization: `GuestAI ${token}` }, payload: { exerciseId },
    });
    expect(bindReplayAfterPublication.statusCode).toBe(200);
    expect(bindReplayAfterPublication.json()).toEqual({ ok: true, exerciseId });

    const grade = await app.inject({
      method: "POST", url: `/api/v1/ai/guest/quizzes/${deck.id}/grade`,
      headers: { authorization: `GuestAI ${token}` },
      payload: { answers: [{ id: deck.questions[0]!.id, selected: 0 }] },
    });
    expect(grade.statusCode).toBe(200);
    expect(grade.json()).toMatchObject({ score: 1, total: 1 });

    const released = await app.inject({
      method: "POST", url: `/api/v1/ai/guest/study-exercises/${exerciseId}/solution`,
      headers: { authorization: `GuestAI ${token}` }, payload: {},
    });
    expect(released.statusCode).toBe(200);
    expect(released.json()).toMatchObject({ exercises: [{ id: expect.any(String), solution: "Apply LIFO." }] });

    const state = await db.adventureState.findUnique({ where: { id: 1 } });
    const serialized = JSON.stringify(state?.state);
    expect(serialized).toContain(`guest:${sessionId}`);
    expect(serialized).not.toContain("Apply LIFO.");
    expect(serialized).not.toContain("explanation");
  });
});
