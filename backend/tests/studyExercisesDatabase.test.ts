import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import Fastify, { type FastifyRequest } from "fastify";
import { PrismaClient, type Prisma, type User } from "@prisma/client";
import { ApiError } from "../src/errors.js";
import { issueTokens, verifyActiveAccess } from "../src/auth.js";
import { adventureRoutes } from "../src/adventure/routes.js";
import type { World } from "../src/adventure/domain.js";
import {
  studyExerciseRoutes,
  type StudyExerciseProviders,
} from "../src/studyExercises.js";
import type {
  StudyExerciseQuestion,
  StudyExerciseSolution,
} from "../src/studyExerciseSchemas.js";

const migrationDirectory = new URL("../prisma/migrations/", import.meta.url);
let pg: PGlite;
let socket: PGLiteSocketServer;
let db: PrismaClient;
let app: ReturnType<typeof Fastify>;
let ownerId: string;
let strangerId: string;
let ownerToken: string;
let strangerToken: string;
let owner: User;
const generateQuestions = vi.fn<StudyExerciseProviders["generateQuestions"]>();
const generateSolutions = vi.fn<StudyExerciseProviders["generateSolutions"]>();

const providers: StudyExerciseProviders = { generateQuestions, generateSolutions };

async function migrateAll() {
  const migrations = (await readdir(migrationDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d+_/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const name of migrations)
    await pg.exec(await readFile(new URL(`${name}/migration.sql`, migrationDirectory), "utf8"));
}

function inputSession(id: string, started: number) {
  return {
    id,
    groupId: null,
    goal: "Ôn tập đại số",
    topic: "math",
    started,
    ended: started + 60_000,
    target: 60,
    segments: [{ start: started, end: started + 60_000, kind: "focus" }],
  };
}

async function saveSession(id: string, started: number, token = ownerToken) {
  return app.inject({
    method: "POST",
    url: "/api/v1/adventure/sessions",
    headers: { authorization: `Bearer ${token}` },
    payload: inputSession(id, started),
  });
}

function request(method: "GET" | "POST" | "DELETE", url: string, token = ownerToken, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload === undefined ? {} : { payload }),
  });
}

async function issueOwnerToken() {
  ownerToken = (await issueTokens(db, owner)).access_token;
  return ownerToken;
}

async function markSessionRemoved(sessionId: string) {
  const record = await db.adventureState.findUnique({ where: { id: 1 } });
  if (!record) throw new Error("Adventure state fixture missing");
  const world = structuredClone(record.state) as unknown as World;
  world.sessionOverrides ??= {};
  world.sessionOverrides[sessionId] = { version: 1, removedAt: Date.now() };
  await db.adventureState.update({
    where: { id: 1 },
    data: { state: world as unknown as Prisma.InputJsonValue },
  });
}

beforeAll(async () => {
  pg = new PGlite();
  await migrateAll();
  socket = new PGLiteSocketServer({ db: pg, host: "127.0.0.1", port: 0, maxConnections: 10 });
  await socket.start();
  db = new PrismaClient({
    datasources: {
      db: {
        url: `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?connection_limit=5&sslmode=disable`,
      },
    },
  });

  app = Fastify({ logger: false });
  app.decorateRequest("userId", "");
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) return reply.code(error.status).send({ detail: error.message });
    if (error.name === "ZodError") return reply.code(400).send({ detail: error.message });
    return reply.code(500).send({ detail: error.message });
  });
  const authenticate = async (request: FastifyRequest) => {
    const token = request.headers.authorization?.startsWith("Bearer ")
      ? request.headers.authorization.slice(7)
      : undefined;
    request.userId = await verifyActiveAccess(db, token);
  };
  adventureRoutes(app, db, authenticate);
  studyExerciseRoutes(app, db, authenticate, providers);
  await app.ready();
});

beforeEach(async () => {
  ownerId = randomUUID();
  strangerId = randomUUID();
  owner = await db.user.create({
    data: { id: ownerId, email: `${ownerId}@example.test`, name: "Synthetic owner" },
  });
  const stranger = await db.user.create({
    data: { id: strangerId, email: `${strangerId}@example.test`, name: "Synthetic stranger" },
  });
  ownerToken = (await issueTokens(db, owner)).access_token;
  strangerToken = (await issueTokens(db, stranger)).access_token;
  generateQuestions.mockReset().mockImplementation(async (source, count) => Array.from({ length: count }, () => ({
    prompt: "Explain how photosynthesis uses light energy to produce sugars.",
    evidenceExcerpt: source,
  })));
  generateSolutions.mockReset().mockImplementation(async (_source, questions) => questions.map((question) => ({
    id: question.id,
    solution: "Tách dữ kiện rồi thay vào biểu thức.",
    explanation: "Mỗi bước dùng đúng dữ kiện đã xác nhận.",
  })));
});

afterAll(async () => {
  await app?.close();
  await db?.$disconnect();
  await socket?.stop();
  await pg?.close();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("study exercise routes on PGlite", () => {
  it("persists, hydrates, binds, saves, solves, caches, and scopes provided and generated sets", async () => {
    const providedSessionId = randomUUID();
    const providedRequestId = randomUUID();
    const exactPrompt = "  Solve x + 2 = 5.\nExplain each step.  ";
    const preparedProvided = await request("POST", "/api/v1/study-exercises", ownerToken, {
      requestId: providedRequestId,
      plannedSessionId: providedSessionId,
      mode: "provided",
      text: exactPrompt,
    });
    expect(preparedProvided.statusCode, preparedProvided.body).toBe(200);
    expect(preparedProvided.json().exercises[0].prompt).toBe(exactPrompt);
    const providedRow = await db.studyExerciseSet.findUnique({ where: { id: providedRequestId } });
    expect(providedRow?.source_text).toBe(exactPrompt);

    const questionHydration = await request("GET", `/api/v1/study-exercises/session/${providedSessionId}`);
    const strangerHydration = await request("GET", `/api/v1/study-exercises/session/${providedSessionId}`, strangerToken);
    expect(questionHydration.statusCode).toBe(200);
    expect(questionHydration.json()).toEqual(preparedProvided.json());
    expect(strangerHydration.statusCode).toBe(404);
    expect(JSON.stringify(questionHydration.json())).not.toMatch(/source_text|evidence|solution|explanation/u);

    const bound = await request("POST", `/api/v1/study-exercises/session/${providedSessionId}/bind`, ownerToken, {});
    expect(bound.statusCode).toBe(200);
    const boundRow = await db.studyExerciseSet.findUnique({ where: { id: providedRequestId } });
    expect(boundRow?.bound_at).toBeInstanceOf(Date);
    expect(boundRow?.expires_at).toBeNull();

    const earlySolution = await request("POST", `/api/v1/study-exercises/${providedRequestId}/solution`, ownerToken, {});
    expect(earlySolution.statusCode).toBe(409);
    expect(generateSolutions).not.toHaveBeenCalled();

    const firstStarted = Date.now() - 4 * 60_000;
    expect((await saveSession(providedSessionId, firstStarted)).statusCode).toBe(200);
    const solution = await request("POST", `/api/v1/study-exercises/${providedRequestId}/solution`, ownerToken, {});
    const cachedSolution = await request("POST", `/api/v1/study-exercises/${providedRequestId}/solution`, ownerToken, {});
    expect(solution.statusCode).toBe(200);
    expect(cachedSolution.json()).toEqual(solution.json());
    expect(generateSolutions).toHaveBeenCalledTimes(1);

    const invalidated = await request(
      "DELETE",
      `/api/v1/study-exercises/session/${providedSessionId}/requests/${providedRequestId}`,
      ownerToken,
      {},
    );
    expect(invalidated.statusCode).toBe(200);
    expect(await db.studyExerciseSet.findUnique({ where: { id: providedRequestId } })).toBeNull();

    const generatedSessionId = randomUUID();
    const generatedRequestId = randomUUID();
    const source = "Photosynthesis converts light energy into chemical energy.";
    const generated = await request("POST", "/api/v1/study-exercises", ownerToken, {
      requestId: generatedRequestId,
      plannedSessionId: generatedSessionId,
      mode: "generated",
      text: source,
      count: 1,
    });
    expect(generated.statusCode, generated.body).toBe(200);
    expect(generated.json().exercises).toHaveLength(1);
    expect(generated.json().sourceFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(generateQuestions).toHaveBeenCalledWith(source, 1, expect.any(AbortSignal));
    expect(JSON.stringify(generated.json())).not.toMatch(/solution|explanation|evidenceExcerpt/u);

    const generatedHydration = await request("GET", `/api/v1/study-exercises/session/${generatedSessionId}`);
    expect(generatedHydration.statusCode).toBe(200);
    const secondStarted = firstStarted - 120_000;
    expect((await saveSession(generatedSessionId, secondStarted)).statusCode).toBe(200);
    const generatedSolutions = await request("POST", `/api/v1/study-exercises/${generatedRequestId}/solution`, ownerToken, {});
    expect(generatedSolutions.statusCode).toBe(200);
    expect(generateSolutions).toHaveBeenCalledTimes(2);

    await expect(pg.query(`
      INSERT INTO study_exercise_sets
        (id, user_id, planned_session_id, mode, status, source_text, source_fingerprint, exercises, evidence)
      VALUES ($1, $2, $3, 'provided', 'ready', 'Synthetic orphan', $4, '[]'::jsonb, '[]'::jsonb)`, [
      randomUUID(), randomUUID(), randomUUID(), "a".repeat(64),
    ])).rejects.toThrow();
  });

  it("binds on session save when the saved start preceded expiry, even if completion follows it", async () => {
    const plannedSessionId = randomUUID();
    const requestId = randomUUID();
    const createdAt = Date.now();
    const created = await request("POST", "/api/v1/study-exercises", ownerToken, {
      requestId,
      plannedSessionId,
      mode: "provided",
      text: "A synthetic question to keep for this session.",
    });
    expect(created.statusCode).toBe(200);

    const expiresAt = createdAt + 60_000;
    const started = createdAt + 30_000;
    await db.studyExerciseSet.update({ where: { id: requestId }, data: { expires_at: new Date(expiresAt) } });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(started + 8 * 24 * 60 * 60 * 1000);
    ownerToken = await issueOwnerToken();

    const saved = await saveSession(plannedSessionId, started);
    const row = await db.studyExerciseSet.findUnique({ where: { id: requestId } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(row?.bound_at).toEqual(new Date(started + 8 * 24 * 60 * 60 * 1000));
    expect(row?.expires_at).toBeNull();
    const hydrated = await request("GET", `/api/v1/study-exercises/session/${plannedSessionId}`);
    expect(hydrated.statusCode).toBe(200);
  });

  it("does not bind an expired draft when the saved session started after expiry", async () => {
    const plannedSessionId = randomUUID();
    const requestId = randomUUID();
    const createdAt = Date.now();
    const created = await request("POST", "/api/v1/study-exercises", ownerToken, {
      requestId,
      plannedSessionId,
      mode: "provided",
      text: "A synthetic question with a later start.",
    });
    expect(created.statusCode).toBe(200);

    const expiresAt = createdAt + 30_000;
    const started = expiresAt + 30_000;
    await db.studyExerciseSet.update({ where: { id: requestId }, data: { expires_at: new Date(expiresAt) } });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(started + 8 * 24 * 60 * 60 * 1000);
    ownerToken = await issueOwnerToken();

    const saved = await saveSession(plannedSessionId, started);
    const row = await db.studyExerciseSet.findUnique({ where: { id: requestId } });
    const hydrated = await request("GET", `/api/v1/study-exercises/session/${plannedSessionId}`);
    expect(saved.statusCode).toBe(200);
    expect(row?.bound_at).toBeNull();
    expect(hydrated.statusCode).toBe(404);
    expect(await db.studyExerciseSet.findUnique({ where: { id: requestId } })).toBeNull();
  });

  it("rolls back session and set changes when persisted session validation fails", async () => {
    const plannedSessionId = randomUUID();
    const requestId = randomUUID();
    const created = await request("POST", "/api/v1/study-exercises", ownerToken, {
      requestId,
      plannedSessionId,
      mode: "provided",
      text: "A synthetic prompt that must remain unbound on rollback.",
    });
    expect(created.statusCode).toBe(200);
    const before = await db.adventureState.findUnique({ where: { id: 1 } });
    const started = Date.now() - 120_000;
    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/adventure/sessions",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        ...inputSession(plannedSessionId, started),
        segments: [{ start: started, end: started, kind: "focus" }],
      },
    });
    const after = await db.adventureState.findUnique({ where: { id: 1 } });
    const row = await db.studyExerciseSet.findUnique({ where: { id: requestId } });

    expect(invalid.statusCode).toBe(400);
    expect(after?.state).toEqual(before?.state);
    expect(row?.bound_at).toBeNull();
    expect(row?.expires_at).not.toBeNull();
  });

  it("does not cache a solution when its session is removed while the provider is pending", async () => {
    const plannedSessionId = randomUUID();
    const requestId = randomUUID();
    const started = Date.now() - 3 * 60_000;
    const prepared = await request("POST", "/api/v1/study-exercises", ownerToken, {
      requestId,
      plannedSessionId,
      mode: "provided",
      text: "Solve x + 2 = 5 and explain the check.",
    });
    expect(prepared.statusCode).toBe(200);
    expect((await saveSession(plannedSessionId, started)).statusCode).toBe(200);

    let markProviderStarted!: () => void;
    const providerStarted = new Promise<void>((resolve) => { markProviderStarted = resolve; });
    let releaseProvider!: (solutions: StudyExerciseSolution[]) => void;
    generateSolutions.mockImplementationOnce(async (_source, questions: StudyExerciseQuestion[]) => {
      markProviderStarted();
      return new Promise((resolve) => { releaseProvider = resolve; });
    });
    const pending = request("POST", `/api/v1/study-exercises/${requestId}/solution`);
    await providerStarted;

    // This separate commit succeeds while Gemini is pending, proving the provider call
    // does not retain either the adventure-state or exercise-row transaction locks.
    await markSessionRemoved(plannedSessionId);
    releaseProvider([{
      id: prepared.json().exercises[0].id,
      solution: "Stale solution",
      explanation: "Must not be stored after removal.",
    }]);

    const result = await pending;
    const row = await db.studyExerciseSet.findUnique({ where: { id: requestId } });
    expect(result.statusCode).toBe(410);
    expect(row?.solution).toBeNull();
    expect(row?.solution_generation_token).toBeNull();
  });
});
