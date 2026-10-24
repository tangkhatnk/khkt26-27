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
import { registerWebAssets } from "../src/webAssets.js";
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
let userId: string;
let otherUserId: string;
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
  expect(history.json().total).toBe(0);
  expect(history.json().runs.some((row: { tripCode: string }) => row.tripCode === preview.json().tripCode)).toBe(false);

  const guestId = randomUUID();
  const guest = await app.inject({ method: "POST", url: "/api/v1/adventure/trip-code", payload: { id: guestId } });
  expect(guest.statusCode).toBe(200);
  const published = await app.inject({ method: "POST", url: "/api/v1/adventure/guest-sessions", payload: { ...payload, id: guestId } });
  expect(published.json().tripCode).toBe(guest.json().tripCode);
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

it("publishes only opted-in sessions and derives public metrics from saved server state", async () => {
  const now = Date.now();
  const existingId = randomUUID();
  const existingStarted = now - 360000;
  const existingEnded = now - 300000;
  const existingSession = {
    id: existingId, userId, groupId: null, goal: "Historical saved trip", topic: "biology",
    started: existingStarted, ended: existingEnded, target: 60,
    segments: [{ start: existingStarted, end: existingEnded, kind: "focus" }],
    seconds: 60, contribution: 60, rules: "train-v1", distractions: 0,
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
  const save = await app.inject({ method: "POST", url: "/api/v1/adventure/sessions", headers,
    payload: { id, groupId: null, goal: "=HYPERLINK(\"https://example.invalid\",\"open\")", topic: "biology", target: 60,
      started, ended, distractions: 1, segments: [{ start: started, end: started + 20000, kind: "focus" },
        { start: started + 20000, end: ended, kind: "distraction" }] } });
  expect(save.statusCode).toBe(200);

  const firstPage = await app.inject({ url: "/api/v1/experiments?limit=1&offset=0" });
  expect(firstPage.statusCode).toBe(200);
  expect(firstPage.json()).toMatchObject({ total: 0, limit: 1, offset: 0, runs: [] });
  const olderPage = await app.inject({ url: "/api/v1/experiments?limit=1&offset=1" });
  expect(olderPage.json().runs).toEqual([]);
  for (const privateValue of ["owner@example.com", userId, existingId, id]) {
    expect(firstPage.body).not.toContain(privateValue);
    expect(olderPage.body).not.toContain(privateValue);
  }

  const grade = await app.inject({ method: "POST", url: "/api/v1/adventure/quiz", headers,
    payload: { sessionId: id, answers: [{ id: questionId, selected: 1 }] } });
  expect(grade.statusCode).toBe(200);
  expect((await app.inject({ url: "/api/v1/experiments" })).json().total).toBe(0);
  const publish = await app.inject({ method: "POST", url: "/api/v1/experiments", headers,
    payload: { sessionId: id, completionPercent: 75 } });
  expect(publish.statusCode).toBe(200);
  const refreshed = await app.inject({ url: "/api/v1/experiments?limit=1" });
  expect(refreshed.json()).toMatchObject({ total: 1, runs: [{
    topic: "biology", quizScore: 1, quizTotal: 1, completionPercent: 75, completed: false,
  }] });
  expect(refreshed.body).not.toContain("goalSummary");
  expect(refreshed.body).not.toContain("=HYPERLINK");

  const csv = await app.inject({ url: "/api/v1/experiments/export.csv" });
  expect(csv.headers["content-type"]).toContain("text/csv");
  expect(csv.body).toContain("trip_code");
  expect(csv.body).not.toContain("goal_summary");
  expect(csv.body).toContain("started_at");
  expect(csv.body).toContain("ended_at");
  expect(csv.body).not.toContain(userId);
  expect(csv.body).not.toContain(id);

  await app.inject({ method: "DELETE", url: "/api/v1/experiments/" + id, headers: stranger });
  expect((await app.inject({ url: "/api/v1/experiments" })).json().total).toBe(1);
  await app.inject({ method: "DELETE", url: "/api/v1/experiments/" + id, headers });
  expect((await app.inject({ url: "/api/v1/experiments" })).json().total).toBe(0);
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

  const published = await app.inject({ url: "/api/v1/experiments" });
  expect(published.json().total).toBe(0);
  expect(published.body).not.toContain(originalTripCode);
  expect(published.body).not.toContain(id);
  expect(published.body).not.toContain(userId);
  expect(published.body).not.toContain("private.example");
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
  expect((await app.inject({ url: "/api/v1/experiments" })).json().total).toBe(0);

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
  expect((await app.inject({ url: "/api/v1/experiments" })).json().total).toBe(0);
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
  const publish = await app.inject({ method: "POST", url: "/api/v1/experiments", headers,
    payload: { sessionId: id } });
  expect(publish.statusCode).toBe(200);
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
  expect(mismatch.statusCode).toBe(400);
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
