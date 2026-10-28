import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { ApiError } from "../src/errors.js";
import { studyExerciseRoutes } from "../src/studyExercises.js";
import {
  generateStudyExerciseQuestions,
  generateStudyExerciseSolutions,
} from "../src/studyExerciseProvider.js";
import type { World } from "../src/adventure/domain.js";

vi.mock("../src/studyExerciseProvider.js", () => ({
  generateStudyExerciseQuestions: vi.fn(),
  generateStudyExerciseSolutions: vi.fn(),
}));

type ExerciseSetRow = {
  id: string;
  user_id: string;
  planned_session_id: string;
  mode: string;
  requested_count: number | null;
  status: string;
  source_text: string;
  source_fingerprint: string;
  exercises: unknown;
  evidence: unknown;
  solution: unknown;
  generation_token: string | null;
  generation_lease_expires_at: Date | null;
  solution_generation_token: string | null;
  solution_lease_expires_at: Date | null;
  bound_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function matches(row: ExerciseSetRow, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key as keyof ExerciseSetRow];
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      const condition = expected as Record<string, unknown>;
      if ("in" in condition) return (condition.in as unknown[]).includes(actual);
      if ("lte" in condition) return actual instanceof Date && actual <= condition.lte as Date;
      return false;
    }
    return actual === expected;
  });
}

function fakeDatabase(ownerId: string, world: World) {
  const rows = new Map<string, ExerciseSetRow>();
  const invalidations = new Map<string, { user_id: string; planned_session_id: string; request_id: string; expires_at: Date }>();
  const activeUsers = new Map([[ownerId, { id: ownerId, suspended_at: null, deleted_at: null }]]);
  const lockOrder: string[] = [];
  const tx = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      if (sql.includes("FROM adventure_state")) {
        lockOrder.push("world");
        return [{ state: world }];
      }
      if (sql.includes("FROM users")) {
        const user = activeUsers.get(String(values[0]));
        return user ? [user] : [];
      }
      if (sql.includes("FROM study_exercise_sets")) {
        lockOrder.push("exercise");
        const row = rows.get(String(values[0]));
        return row && row.user_id === String(values[1]) ? [{ id: row.id }] : [];
      }
      throw new Error(`Unexpected SQL in study exercise test: ${sql}`);
    }),
    studyExerciseSet: {
      create: vi.fn(async ({ data }: { data: Partial<ExerciseSetRow> }) => {
        const now = new Date();
        const row = {
          created_at: now,
          updated_at: now,
          solution: null,
          requested_count: null,
          generation_token: null,
          generation_lease_expires_at: null,
          solution_generation_token: null,
          solution_lease_expires_at: null,
          bound_at: null,
          expires_at: null,
          ...data,
        } as ExerciseSetRow;
        rows.set(row.id, row);
        return row;
      }),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        [...rows.values()].find(row => matches(row, where)) ?? null),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        [...rows.values()].filter(row => matches(row, where))),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<ExerciseSetRow> }) => {
        const row = rows.get(where.id);
        if (!row) throw new Error("Exercise set not found");
        Object.assign(row, data, { updated_at: new Date() });
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<ExerciseSetRow> }) => {
        let count = 0;
        for (const row of rows.values()) {
          if (!matches(row, where)) continue;
          Object.assign(row, data, { updated_at: new Date() });
          count++;
        }
        return { count };
      }),
      deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        let count = 0;
        for (const [id, row] of rows) {
          if (!matches(row, where)) continue;
          rows.delete(id);
          count++;
        }
        return { count };
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = rows.get(where.id);
        if (!row) throw new Error("Exercise set not found");
        rows.delete(where.id);
        return row;
      }),
    },
    studyExerciseInvalidation: {
      findUnique: vi.fn(async ({ where }: { where: { user_id_planned_session_id_request_id: { user_id: string; planned_session_id: string; request_id: string } } }) => {
        const key = where.user_id_planned_session_id_request_id;
        return invalidations.get(`${key.user_id}:${key.planned_session_id}:${key.request_id}`) ?? null;
      }),
      upsert: vi.fn(async ({ where, create, update }: {
        where: { user_id_planned_session_id_request_id: { user_id: string; planned_session_id: string; request_id: string } };
        create: { user_id: string; planned_session_id: string; request_id: string; expires_at: Date };
        update: { expires_at: Date };
      }) => {
        const key = where.user_id_planned_session_id_request_id;
        const mapKey = `${key.user_id}:${key.planned_session_id}:${key.request_id}`;
        const current = invalidations.get(mapKey);
        const row = current ? { ...current, ...update } : create;
        invalidations.set(mapKey, row);
        return row;
      }),
      deleteMany: vi.fn(async ({ where }: { where: { expires_at: { lte: Date } } }) => {
        let count = 0;
        for (const [key, row] of invalidations) {
          if (row.expires_at > where.expires_at.lte) continue;
          invalidations.delete(key);
          count++;
        }
        return { count };
      }),
    },
  };
  let transactionTail = Promise.resolve();
  const db = {
    $transaction: vi.fn(async <T>(run: (client: typeof tx) => Promise<T>) => {
      let release!: () => void;
      const previous = transactionTail;
      transactionTail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      try {
        return await run(tx);
      } finally {
        release();
      }
    }),
  };
  return { db: db as unknown as PrismaClient, rows, invalidations, world, activeUsers, lockOrder };
}

function completedSession(id: string, userId: string, seconds = 60, started = 1_000_000) {
  return {
    id,
    userId,
    groupId: null,
    goal: "Ôn tập",
    topic: "math",
    started,
    ended: started + seconds * 1000,
    target: seconds,
    seconds,
    distractions: 0,
    segments: [{ start: started, end: started + seconds * 1000, kind: "focus" as const }],
  };
}

function emptyWorld(): World {
  return { people: {}, groups: {}, sessions: {}, invites: {}, sessionOverrides: {} } as World;
}

let app: ReturnType<typeof Fastify>;
let ownerId: string;
let otherId: string;
let database: ReturnType<typeof fakeDatabase>;
let authorization: string;
let strangerAuthorization: string;

beforeEach(async () => {
  ownerId = randomUUID();
  otherId = randomUUID();
  authorization = "Bearer owner";
  strangerAuthorization = "Bearer other";
  const world = emptyWorld();
  database = fakeDatabase(ownerId, world);
  database.activeUsers.set(otherId, { id: otherId, suspended_at: null, deleted_at: null });
  app = Fastify({ logger: false });
  app.decorateRequest("userId", "");
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) return reply.code(error.status).send({ detail: error.message });
    if (error.name === "ZodError") return reply.code(400).send({ detail: error.message });
    return reply.code(500).send({ detail: error.message });
  });
  const authenticate = async (request: FastifyRequest) => {
    const token = request.headers.authorization;
    if (token === authorization) request.userId = ownerId;
    else if (token === strangerAuthorization) request.userId = otherId;
    else throw new ApiError(401, "authentication-error", "Authentication required");
  };
  studyExerciseRoutes(app, database.db, authenticate);
  await app.ready();
  vi.mocked(generateStudyExerciseQuestions).mockReset();
  vi.mocked(generateStudyExerciseSolutions).mockReset();
  vi.mocked(generateStudyExerciseQuestions).mockImplementation(async (_source, count) =>
    Array.from({ length: count }, (_, index) => ({
      prompt: `Explain photosynthesis step ${index + 1}.`,
      evidenceExcerpt: "Photosynthesis converts light energy into chemical energy.",
    })));
  vi.mocked(generateStudyExerciseSolutions).mockImplementation(async (_source, exercises) =>
    exercises.map(exercise => ({
      id: exercise.id,
      solution: "Use the stated relationship.",
      explanation: "The source explains the relevant relationship.",
    })));
});

afterEach(async () => {
  await app.close();
  vi.useRealTimers();
});

const request = (method: "GET" | "POST" | "DELETE", url: string, token = authorization, payload?: unknown) =>
  app.inject({ method, url, headers: token ? { authorization: token } : {}, ...(payload === undefined ? {} : { payload }) });

const providedPayload = (plannedSessionId: string, text = "  1. Solve x + 2 = 5.\n2. Explain your steps.  ") => ({
  requestId: randomUUID(),
  plannedSessionId,
  mode: "provided",
  text,
});

async function prepareProvided(plannedSessionId: string, text?: string, requestId = randomUUID()) {
  return request("POST", "/api/v1/study-exercises", authorization, {
    ...providedPayload(plannedSessionId, text),
    requestId,
  });
}

describe("study exercise preparation", () => {
  it("requires authentication and returns only the exact question DTO for provided problems", async () => {
    const plannedSessionId = randomUUID();
    const payload = providedPayload(plannedSessionId);
    const unauthenticated = await request("POST", "/api/v1/study-exercises", "", payload);
    expect(unauthenticated.statusCode).toBe(401);

    const response = await prepareProvided(plannedSessionId, payload.text);
    expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
    const dto = response.json();
    expect(dto).toEqual({
      id: expect.any(String),
      plannedSessionId,
      mode: "provided",
      exercises: [{ id: expect.any(String), prompt: payload.text }],
    });
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(JSON.stringify(dto)).not.toMatch(/source_text|evidence|solution|explanation|answer|key/u);
    const row = database.rows.get(dto.id)!;
    expect(row.source_text).toBe(payload.text);
    expect(row.status).toBe("ready");
    expect(row.evidence).toEqual([]);

    const read = await request("GET", `/api/v1/study-exercises/${dto.id}`);
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(dto);
  });

  it("does not replay a ready draft after its seven-day expiry", async () => {
    const plannedSessionId = randomUUID();
    const payload = providedPayload(plannedSessionId);
    const created = await request("POST", "/api/v1/study-exercises", authorization, payload);
    const row = database.rows.get(payload.requestId)!;
    row.expires_at = new Date(Date.now() - 1);

    const replay = await request("POST", "/api/v1/study-exercises", authorization, payload);
    const secondReplay = await request("POST", "/api/v1/study-exercises", authorization, payload);

    expect(created.statusCode).toBe(200);
    expect(replay.statusCode).toBe(404);
    expect(database.rows.has(payload.requestId)).toBe(false);
    expect([...database.invalidations.values()].some(item => item.request_id === payload.requestId)).toBe(true);
    expect(secondReplay.statusCode).toBe(409);
  });

  it("generates the default three questions and invalidates an older set for the same planned session", async () => {
    const plannedSessionId = randomUUID();
    const older = await prepareProvided(plannedSessionId, "Solve the first problem exactly.");
    const source = "Photosynthesis converts light energy into chemical energy.";
    const generated = await request("POST", "/api/v1/study-exercises", authorization, {
      requestId: randomUUID(),
      plannedSessionId,
      mode: "generated",
      text: source,
    });

    expect(generated.statusCode).toBe(200);
    expect(vi.mocked(generateStudyExerciseQuestions)).toHaveBeenCalledWith(source, 3, expect.any(AbortSignal));
    expect(generated.json().exercises).toHaveLength(3);
    expect(generated.json().sourceFingerprint).toBe(createHash("sha256").update(source, "utf8").digest("hex"));
    expect(JSON.stringify(generated.json())).not.toContain("evidenceExcerpt");
    expect(database.rows.has(older.json().id)).toBe(false);
    expect([...database.invalidations.values()].some(item => item.request_id === older.json().id)).toBe(true);
    const oldRead = await request("GET", `/api/v1/study-exercises/${older.json().id}`);
    expect(oldRead.statusCode).toBe(404);
  });

  it("rejects an unknown owner and does not reveal a set to another account", async () => {
    const plannedSessionId = randomUUID();
    const created = await prepareProvided(plannedSessionId);
    const strangerRead = await request("GET", `/api/v1/study-exercises/${created.json().id}`, strangerAuthorization);
    const strangerSolution = await request("POST", `/api/v1/study-exercises/${created.json().id}/solution`, strangerAuthorization);
    const unknown = await request("GET", `/api/v1/study-exercises/${randomUUID()}`);

    expect(strangerRead.statusCode).toBe(404);
    expect(strangerSolution.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    expect(generateStudyExerciseSolutions).not.toHaveBeenCalled();
  });

  it("rehydrates an owner-scoped question-only set by planned session ID", async () => {
    const plannedSessionId = randomUUID();
    const created = await prepareProvided(plannedSessionId);
    const ownerRead = await request("GET", `/api/v1/study-exercises/session/${plannedSessionId}`);
    const strangerRead = await request("GET", `/api/v1/study-exercises/session/${plannedSessionId}`, strangerAuthorization);

    expect(ownerRead.statusCode).toBe(200);
    expect(ownerRead.json()).toEqual(created.json());
    expect(strangerRead.statusCode).toBe(404);
    expect(JSON.stringify(ownerRead.json())).not.toMatch(/source_text|evidence|solution|explanation|answer|key/u);
  });

  it("lets a learner cancel a set and removes its private snapshot", async () => {
    const plannedSessionId = randomUUID();
    const created = await prepareProvided(plannedSessionId);
    const removed = await request("DELETE", `/api/v1/study-exercises/session/${plannedSessionId}/requests/${created.json().id}`);
    const read = await request("GET", `/api/v1/study-exercises/${created.json().id}`);

    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ ok: true });
    expect(read.statusCode).toBe(404);
    expect(database.rows.has(created.json().id)).toBe(false);
    expect([...database.invalidations.values()].some(item => item.request_id === created.json().id)).toBe(true);
  });

  it("does not let a delayed delete for set A remove replacement set B", async () => {
    const plannedSessionId = randomUUID();
    const setA = await prepareProvided(plannedSessionId, "Problem A.");
    const setB = await prepareProvided(plannedSessionId, "Problem B.");

    const delayedDelete = await request("DELETE", `/api/v1/study-exercises/session/${plannedSessionId}/requests/${setA.json().id}`);
    const current = await request("GET", `/api/v1/study-exercises/session/${plannedSessionId}`);

    expect(delayedDelete.statusCode).toBe(200);
    expect(current.statusCode).toBe(200);
    expect(current.json()).toEqual(setB.json());
    expect(database.rows.has(setB.json().id)).toBe(true);
  });

  it("stores a content-free tombstone when delete A arrives before A is inserted", async () => {
    const plannedSessionId = randomUUID();
    const requestId = randomUUID();
    const cancelled = await request("DELETE", `/api/v1/study-exercises/session/${plannedSessionId}/requests/${requestId}`);
    const delayedPost = await request("POST", "/api/v1/study-exercises", authorization, {
      requestId,
      plannedSessionId,
      mode: "generated",
      text: "Photosynthesis converts light energy into chemical energy.",
      count: 1,
    });

    expect(cancelled.statusCode).toBe(200);
    expect(delayedPost.statusCode).toBe(409);
    expect(generateStudyExerciseQuestions).not.toHaveBeenCalled();
    expect(database.rows.size).toBe(0);
    expect([...database.invalidations.values()]).toEqual([expect.objectContaining({
      request_id: requestId,
    })]);
    expect(JSON.stringify([...database.invalidations.values()])).not.toMatch(/source|text|prompt|evidence/u);
  });

  it("does not cache a generated set after its request ID is invalidated during provider work", async () => {
    const plannedSessionId = randomUUID();
    const requestId = randomUUID();
    const source = "Photosynthesis converts light energy into chemical energy.";
    let release!: (value: Array<{ prompt: string; evidenceExcerpt: string }>) => void;
    vi.mocked(generateStudyExerciseQuestions).mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const pending = request("POST", "/api/v1/study-exercises", authorization, {
      requestId,
      plannedSessionId,
      mode: "generated",
      text: source,
      count: 1,
    });
    await vi.waitFor(() => expect(generateStudyExerciseQuestions).toHaveBeenCalledTimes(1));
    const cancelled = await request("DELETE", `/api/v1/study-exercises/session/${plannedSessionId}/requests/${requestId}`);
    release([{
      prompt: "Explain how photosynthesis stores light energy as chemical energy.",
      evidenceExcerpt: source,
    }]);
    const response = await pending;

    expect(cancelled.statusCode).toBe(200);
    expect(response.statusCode).toBe(409);
    expect(database.rows.has(requestId)).toBe(false);
    expect([...database.invalidations.values()].some(row => row.request_id === requestId)).toBe(true);
  });

  it("returns the same ready DTO for a matching request ID and conflicts if its body changes", async () => {
    const plannedSessionId = randomUUID();
    const requestId = randomUUID();
    const payload = { ...providedPayload(plannedSessionId), requestId };
    const first = await request("POST", "/api/v1/study-exercises", authorization, payload);
    const retry = await request("POST", "/api/v1/study-exercises", authorization, payload);
    const changed = await request("POST", "/api/v1/study-exercises", authorization, {
      ...payload,
      text: "A different problem with the same request ID.",
    });

    expect(first.statusCode).toBe(200);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(first.json());
    expect(changed.statusCode).toBe(409);
    expect(database.rows.size).toBe(1);
  });

  it("does not let a saved session owned by another account claim a preparation", async () => {
    const plannedSessionId = randomUUID();
    database.world.sessions[plannedSessionId] = completedSession(plannedSessionId, otherId);
    const response = await prepareProvided(plannedSessionId);
    expect(response.statusCode).toBe(404);
    expect(database.rows.size).toBe(0);
  });

  it("blocks a tombstoned planned session even if its session snapshot is absent", async () => {
    const plannedSessionId = randomUUID();
    const created = await prepareProvided(plannedSessionId);
    database.world.sessionOverrides![plannedSessionId] = { removedAt: Date.now() } as never;

    const byId = await request("GET", `/api/v1/study-exercises/${created.json().id}`);
    const bySession = await request("GET", `/api/v1/study-exercises/session/${plannedSessionId}`);

    expect(byId.statusCode).toBe(410);
    expect(bySession.statusCode).toBe(410);
    expect(database.rows.has(created.json().id)).toBe(true);
  });
});

describe("session-gated study exercise solutions", () => {
  it("rehydrates a bound generated set and solves from its original private snapshot", async () => {
    const plannedSessionId = randomUUID();
    const source = "Photosynthesis converts light energy into chemical energy.";
    const generated = await request("POST", "/api/v1/study-exercises", authorization, {
      requestId: randomUUID(), plannedSessionId, mode: "generated", text: source, count: 1,
    });
    expect(generated.statusCode).toBe(200);
    expect(generated.json().sourceFingerprint).toBe(createHash("sha256").update(source, "utf8").digest("hex"));

    expect((await request("POST", `/api/v1/study-exercises/session/${plannedSessionId}/bind`)).statusCode).toBe(200);
    database.world.sessions[plannedSessionId] = completedSession(plannedSessionId, ownerId);

    // A new page has no in-memory origin source ID; the owner-scoped DTO still
    // carries only the hash needed to match the local reviewed material.
    const afterReload = await request("GET", `/api/v1/study-exercises/session/${plannedSessionId}`);
    expect(afterReload.statusCode).toBe(200);
    expect(afterReload.json()).toMatchObject({
      id: generated.json().id,
      mode: "generated",
      sourceFingerprint: generated.json().sourceFingerprint,
    });
    expect(JSON.stringify(afterReload.json())).not.toMatch(/source_text|evidence|solution|explanation|answer|key/u);

    const solution = await request("POST", `/api/v1/study-exercises/${afterReload.json().id}/solution`);
    expect(solution.statusCode, solution.body).toBe(200);
    expect(generateStudyExerciseSolutions).toHaveBeenCalledWith(source, generated.json().exercises, expect.any(AbortSignal));
  });

  it("keeps solutions locked until a persisted session reaches effective completion", async () => {
    const plannedSessionId = randomUUID();
    const created = await prepareProvided(plannedSessionId);
    const earlySession = completedSession(plannedSessionId, ownerId, 30);
    earlySession.target = 60;
    database.world.sessions[plannedSessionId] = earlySession;

    const early = await request("POST", `/api/v1/study-exercises/${created.json().id}/solution`);
    expect(early.statusCode).toBe(409);
    expect(generateStudyExerciseSolutions).not.toHaveBeenCalled();

    database.world.sessions[plannedSessionId] = completedSession(plannedSessionId, ownerId);
    database.world.sessionOverrides![plannedSessionId] = { removedAt: Date.now() } as never;
    const removed = await request("POST", `/api/v1/study-exercises/${created.json().id}/solution`);
    expect(removed.statusCode).toBe(410);
    expect(generateStudyExerciseSolutions).not.toHaveBeenCalled();
  });

  it("binds at focus start so a session finishing after seven days keeps its question set", async () => {
    const plannedSessionId = randomUUID();
    const created = await prepareProvided(plannedSessionId);
    const row = database.rows.get(created.json().id)!;
    const startTime = Date.now();
    row.expires_at = new Date(startTime + 60_000);
    const bound = await request("POST", `/api/v1/study-exercises/session/${plannedSessionId}/bind`);

    expect(bound.statusCode).toBe(200);
    expect(row.bound_at).toBeInstanceOf(Date);
    expect(row.expires_at).toBeNull();

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(startTime + 8 * 24 * 60 * 60 * 1000);
    database.world.sessions[plannedSessionId] = completedSession(plannedSessionId, ownerId);
    const questionRead = await request("GET", `/api/v1/study-exercises/session/${plannedSessionId}`);
    const solutionRead = await request("POST", `/api/v1/study-exercises/${created.json().id}/solution`);

    expect(questionRead.statusCode).toBe(200);
    expect(solutionRead.statusCode).toBe(200);
    expect(database.rows.has(created.json().id)).toBe(true);
  });

  it("deletes an unstarted draft after its seven-day expiry", async () => {
    const plannedSessionId = randomUUID();
    const created = await prepareProvided(plannedSessionId);
    const row = database.rows.get(created.json().id)!;
    row.expires_at = new Date(Date.now() - 1);

    const expired = await request("GET", `/api/v1/study-exercises/session/${plannedSessionId}`);

    expect(expired.statusCode).toBe(404);
    expect(database.rows.has(created.json().id)).toBe(false);
  });

  it("does not revive an expired unbound draft when the session was already saved", async () => {
    const plannedSessionId = randomUUID();
    const created = await prepareProvided(plannedSessionId);
    const row = database.rows.get(created.json().id)!;
    const expiredAt = Date.now() - 1;
    row.expires_at = new Date(expiredAt);
    database.world.sessions[plannedSessionId] = completedSession(plannedSessionId, ownerId, 60, expiredAt + 1);

    const questionRead = await request("GET", `/api/v1/study-exercises/session/${plannedSessionId}`);
    const solutionRead = await request("POST", `/api/v1/study-exercises/${created.json().id}/solution`);

    expect(questionRead.statusCode).toBe(404);
    expect(solutionRead.statusCode).toBe(404);
    expect(database.rows.has(created.json().id)).toBe(false);
    expect(generateStudyExerciseSolutions).not.toHaveBeenCalled();
  });

  it("recovers a missed focus bind after expiry when the saved session started in time", async () => {
    const plannedSessionId = randomUUID();
    const created = await prepareProvided(plannedSessionId);
    const row = database.rows.get(created.json().id)!;
    const startTime = Date.now();
    const expiresAt = startTime + 60_000;
    row.expires_at = new Date(expiresAt);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(startTime + 8 * 24 * 60 * 60 * 1000);
    database.world.sessions[plannedSessionId] = completedSession(plannedSessionId, ownerId, 60, startTime + 30_000);

    const questionRead = await request("GET", `/api/v1/study-exercises/session/${plannedSessionId}`);
    const solutionRead = await request("POST", `/api/v1/study-exercises/${created.json().id}/solution`);

    expect(questionRead.statusCode).toBe(200);
    expect(solutionRead.statusCode).toBe(200);
    expect(row.bound_at).toEqual(new Date(startTime + 8 * 24 * 60 * 60 * 1000));
    expect(row.expires_at).toBeNull();
  });

  it("uses the stored snapshot and caches structured answers after completion", async () => {
    const plannedSessionId = randomUUID();
    const source = "Solve x + 2 = 5 and explain each algebraic step.";
    const created = await prepareProvided(plannedSessionId, source);
    database.world.sessions[plannedSessionId] = completedSession(plannedSessionId, ownerId);

    const response = await request("POST", `/api/v1/study-exercises/${created.json().id}/solution`);
    expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
    expect(response.json().exercises).toEqual([{
      id: created.json().exercises[0].id,
      solution: "Use the stated relationship.",
      explanation: "The source explains the relevant relationship.",
    }]);
    expect(generateStudyExerciseSolutions).toHaveBeenCalledWith(source, created.json().exercises, expect.any(AbortSignal));
    expect(database.rows.get(created.json().id)?.solution).toEqual(response.json());
    const generationCalls = vi.mocked(generateStudyExerciseSolutions).mock.calls.length;

    const cached = await request("POST", `/api/v1/study-exercises/${created.json().id}/solution`);
    expect(cached.statusCode).toBe(200);
    expect(cached.json()).toEqual(response.json());
    expect(generateStudyExerciseSolutions).toHaveBeenCalledTimes(generationCalls);
  });

  it("returns no solution or cache when the session is removed during provider work", async () => {
    const plannedSessionId = randomUUID();
    const created = await prepareProvided(plannedSessionId);
    database.world.sessions[plannedSessionId] = completedSession(plannedSessionId, ownerId);
    let release!: (value: Array<{ id: string; solution: string; explanation: string }>) => void;
    vi.mocked(generateStudyExerciseSolutions).mockReturnValueOnce(new Promise(resolve => { release = resolve; }));

    const pending = request("POST", `/api/v1/study-exercises/${created.json().id}/solution`);
    await vi.waitFor(() => expect(generateStudyExerciseSolutions).toHaveBeenCalledTimes(1));
    database.world.sessionOverrides![plannedSessionId] = { removedAt: Date.now() } as never;
    release([{ id: created.json().exercises[0].id, solution: "stale", explanation: "stale" }]);

    const response = await pending;
    expect(response.statusCode).toBe(410);
    expect(database.rows.get(created.json().id)?.solution).toBeNull();
  });

  it("allows only one in-flight solver while a provider request is pending", async () => {
    const plannedSessionId = randomUUID();
    const created = await prepareProvided(plannedSessionId);
    database.world.sessions[plannedSessionId] = completedSession(plannedSessionId, ownerId);
    let release!: (value: Array<{ id: string; solution: string; explanation: string }>) => void;
    vi.mocked(generateStudyExerciseSolutions).mockReturnValueOnce(new Promise(resolve => { release = resolve; }));

    const pending = request("POST", `/api/v1/study-exercises/${created.json().id}/solution`);
    await vi.waitFor(() => expect(generateStudyExerciseSolutions).toHaveBeenCalledTimes(1));
    const duplicate = await request("POST", `/api/v1/study-exercises/${created.json().id}/solution`);
    expect(duplicate.statusCode).toBe(409);
    expect(generateStudyExerciseSolutions).toHaveBeenCalledTimes(1);
    release([{ id: created.json().exercises[0].id, solution: "answer", explanation: "steps" }]);
    expect((await pending).statusCode).toBe(200);
  });

  it("uses the shared lock order when a solution request is finalized", async () => {
    const plannedSessionId = randomUUID();
    const created = await prepareProvided(plannedSessionId);
    database.world.sessions[plannedSessionId] = completedSession(plannedSessionId, ownerId);
    const response = await request("POST", `/api/v1/study-exercises/${created.json().id}/solution`);

    expect(response.statusCode).toBe(200);
    const finalWorldLock = database.lockOrder.lastIndexOf("world");
    const finalExerciseLock = database.lockOrder.lastIndexOf("exercise");
    expect(finalWorldLock).toBeGreaterThanOrEqual(0);
    expect(finalExerciseLock).toBeGreaterThan(finalWorldLock);
  });
});
