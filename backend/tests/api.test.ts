import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import RedisMock from "ioredis-mock";
import type { Redis } from "ioredis";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { issueTokens, hashToken } from "../src/auth.js";
import { config } from "../src/config.js";
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
    correctAnswerIndex: 1, explanation: "Gemini explanation",
  }]),
}));
import { generateGeminiQuiz } from "../src/gemini.js";
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
        question: "Question",
        options: ["A", "B", "C", "D"],
        correct_index: 1,
        explanation: "Explanation",
      },
    })
  ).id;
});
beforeEach(async () => {
  await redis.flushall();
  await db.$executeRaw`DELETE FROM tester_runs`;
  await db.$executeRaw`UPDATE adventure_state SET state = '{"people":{},"groups":{},"sessions":{},"invites":{}}'::jsonb WHERE id = 1`;
});

it("publishes only confirmed own tester metrics, keeps private fields hidden, and refreshes quiz scores", async () => {
  const id = randomUUID(), ended = Date.now(), started = ended - 60000;
  const save = await app.inject({ method: "POST", url: "/api/v1/adventure/sessions", headers,
    payload: { id, groupId: null, goal: "Private learning goal", topic: "biology", target: 60,
      started, ended, distractions: 2, segments: [{ start: started, end: ended - 20000, kind: "focus" },
        { start: ended - 20000, end: ended, kind: "distraction" }] } });
  expect(save.statusCode).toBe(200);
  expect((await app.inject({ url: "/api/v1/experiments" })).json().total).toBe(0);
  expect((await app.inject({ method: "POST", url: "/api/v1/experiments", payload: { sessionId: id } })).statusCode).toBe(401);
  expect((await app.inject({ method: "POST", url: "/api/v1/experiments", headers: stranger, payload: { sessionId: id } })).statusCode).toBe(404);
  const publish = await app.inject({ method: "POST", url: "/api/v1/experiments", headers,
    payload: { sessionId: id, completionPercent: 75, focusedSeconds: 9999, quizScore: 999 } });
  expect(publish.statusCode).toBe(200);
  const publicList = await app.inject({ url: "/api/v1/experiments" });
  expect(publicList.json()).toMatchObject({ total: 1, runs: [{ focusedSeconds: 40, elapsedSeconds: 60,
    distractions: 2, completionPercent: 75, quizScore: null }] });
  for (const privateValue of ["owner@example.com", userId, "Private learning goal", id]) expect(publicList.body).not.toContain(privateValue);
  const grade = await app.inject({ method: "POST", url: "/api/v1/adventure/quiz", headers,
    payload: { sessionId: id, answers: [{ id: questionId, selected: 1 }] } });
  expect(grade.statusCode).toBe(200);
  expect((await app.inject({ url: "/api/v1/experiments" })).json().runs[0]).toMatchObject({ quizScore: 1, quizTotal: 1 });
  const csv = await app.inject({ url: "/api/v1/experiments/export.csv" });
  expect(csv.headers["content-type"]).toContain("text/csv");
  expect(csv.body).toContain("self_reported_completion_percent");
  expect(csv.body).not.toContain(userId);
  await app.inject({ method: "DELETE", url: `/api/v1/experiments/${id}`, headers: stranger });
  expect((await app.inject({ url: "/api/v1/experiments" })).json().total).toBe(1);
  await app.inject({ method: "DELETE", url: `/api/v1/experiments/${id}`, headers });
  expect((await app.inject({ url: "/api/v1/experiments" })).json().total).toBe(0);
  expect((await app.inject({ url: "/api/v1/experiments/mine", headers })).json()).toEqual([]);
  for (let i = 0; i < 2; i++) await app.inject({ method: "POST", url: "/api/v1/experiments", headers, payload: { sessionId: id } });
  expect((await app.inject({ url: "/api/v1/experiments" })).json().total).toBe(1);
  expect((await app.inject({ url: "/api/v1/experiments/mine", headers })).json()).toEqual([{ sessionId: id }]);
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
  ).toHaveLength(1);
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
  const saved = await app.inject({ method: "POST", url: "/api/v1/sessions", headers, payload: session() });
  const answer = { session_id: saved.json().id, question_id: row.id, selected_index: 1 };
  expect((await app.inject({ method: "POST", url: "/api/v1/quizzes/answer", headers, payload: answer })).json().is_correct).toBe(true);
  const foreign = await app.inject({ method: "POST", url: "/api/v1/quizzes/answer", headers: stranger, payload: answer });
  expect(foreign.statusCode).toBe(404);
});
it("rejects invalid Gemini requests before calling the provider", async () => {
  vi.mocked(generateGeminiQuiz).mockClear();
  for (const payload of [{ topic: "biology", count: 0 }, { topic: "biology", count: "3" }, { topic: "biology", questionCount: 3 }]) {
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
it("grades adventure quiz once and protects another learner's session", async () => {
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
    payload: { sessionId: id, answers: [{ id: questionId, selected: 1 }] },
  });
  expect(result.json().sessions[0].quiz).toEqual({ score: 1, total: 1 });
  const retry = await app.inject({
    method: "POST",
    url: "/api/v1/adventure/quiz",
    headers,
    payload: { sessionId: id, answers: [{ id: questionId, selected: 0 }] },
  });
  expect(retry.json().sessions[0].quiz).toEqual({ score: 1, total: 1 });
  expect(retry.json().person.seconds).toBe(60);
  const other = await app.inject({
    method: "POST",
    url: "/api/v1/adventure/quiz",
    headers: stranger,
    payload: { sessionId: id, answers: [{ id: questionId, selected: 1 }] },
  });
  expect(other.statusCode).toBe(404);
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
    "SELECT COUNT(*)::int AS count FROM quiz_bank WHERE owner_id=$1", [userId],
  );
  expect(rows.rows[0].count).toBe(before);
});
