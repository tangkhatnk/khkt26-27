import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { adminRoutes } from "../src/admin.js";
import { ApiError } from "../src/errors.js";

const adminId = "1fd25496-aed3-481c-8b3f-2468aa69e2c4";
const userId = "55a01d18-8ec0-43f4-8ddc-475a2bb13027";
const groupId = "10f86082-c8de-4d40-b181-fca17806fcf3";
const sessionId = "957b3476-2742-46a4-b8b2-fc78928dd99e";
const now = Date.now();
const savedSession = {
  id: sessionId,
  userId,
  groupId,
  goal: "Private personal goal",
  topic: "biology",
  started: now - 60_000,
  ended: now - 30_000,
  target: 60,
  seconds: 20,
  distractions: 1,
  contribution: 20,
  rules: "train-v1",
  segments: [
    { start: now - 60_000, end: now - 40_000, kind: "focus" },
    { start: now - 40_000, end: now - 30_000, kind: "distraction" },
  ],
  quiz: {
    score: 1,
    total: 2,
    feedback: [{ question: "Private learning material", explanation: "Private explanation" }],
  },
};
const dbCalls = { raw: [] as unknown[][], users: [] as unknown[] };
const fakeDb = {
  user: {
    findUnique: async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      email: where.id === adminId ? "admin@example.test" : "learner@example.test",
      name: where.id === adminId ? "Admin" : "Learner",
      created_at: new Date("2026-01-02T03:04:05.000Z"),
      suspended_at: null,
      deleted_at: null,
      admin_state_version: 0,
      adminGrant: null,
    }),
    findMany: async (query: unknown) => {
      dbCalls.users.push(query);
      return [{
        id: userId,
        email: "learner@example.test",
        name: "Learner",
        created_at: new Date("2026-01-02T03:04:05.000Z"),
        suspended_at: null,
        deleted_at: null,
        admin_state_version: 0,
        adminGrant: null,
        password_hash: "must-not-leak",
      }];
    },
    count: async () => 1,
  },
  $queryRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const sql = parts.join(" ");
    dbCalls.raw.push([sql, ...values]);
    if (sql.includes("'sessions'")) {
      return sql.includes("COUNT(*)") ? [{ total: 1 }] : [{ session: savedSession }];
    }
    if (sql.includes("'groups'")) {
      return sql.includes("COUNT(*)")
        ? [{ total: 1 }]
        : [{ group: {
          id: groupId,
          name: "Study group",
          owner: userId,
          members: [userId, adminId],
          timezone: "Asia/Ho_Chi_Minh",
          archived: false,
          journey: { seconds: 1200, station: 1, remaining: 300, threshold: 3600, journal: ["Private"] },
        } }];
    }
    return [];
  },
} as unknown as PrismaClient;

const app = Fastify({ logger: false });
app.decorateRequest("userId", "");
app.setErrorHandler((error, _request, reply) => {
  if (error instanceof ApiError) return reply.code(error.status).send({ detail: error.message });
  if (error instanceof ZodError) return reply.code(400).send({ detail: "validation error" });
  return reply.code(500).send({ detail: "internal error" });
});
const authenticate = async (request: FastifyRequest) => {
  const authorization = request.headers.authorization;
  if (authorization === "Bearer allowed-test-token") {
    request.userId = adminId;
    return;
  }
  if (authorization === "Bearer user-test-token") {
    request.userId = userId;
    return;
  }
  throw new ApiError(401, "authentication-error", "Authentication required");
};

beforeAll(async () => {
  adminRoutes(app, fakeDb, authenticate, [adminId]);
  await app.ready();
});
afterAll(async () => app.close());

describe("admin read-only routes", () => {
  it("requires verified authentication and ignores a forged client admin role", async () => {
    const missing = await app.inject({ url: "/api/v1/admin/access" });
    const forged = await app.inject({
      url: "/api/v1/admin/report?days=7",
      headers: { authorization: "Bearer user-test-token", "x-user-role": "admin" },
    });
    const access = await app.inject({
      url: "/api/v1/admin/access",
      headers: { authorization: "Bearer user-test-token", "x-user-role": "admin" },
    });

    expect(missing.statusCode).toBe(401);
    expect(missing.headers["cache-control"]).toBe("private, no-store");
    expect(forged.statusCode).toBe(403);
    expect(access.statusCode).toBe(200);
    expect(access.json()).toEqual({ allowed: false });
    expect(access.headers["cache-control"]).toBe("private, no-store");
  });

  it("returns bounded report, account, group, and session projections to an allowlisted account", async () => {
    const headers = { authorization: "Bearer allowed-test-token" };
    const access = await app.inject({ url: "/api/v1/admin/access", headers });
    const report = await app.inject({ url: "/api/v1/admin/report?days=7", headers });
    const accounts = await app.inject({ url: "/api/v1/admin/accounts?q=learner&limit=10&offset=5", headers });
    const groups = await app.inject({ url: "/api/v1/admin/groups?q=Study&limit=10&offset=0", headers });
    const sessions = await app.inject({
      url: `/api/v1/admin/sessions?days=30&accountId=${userId}&groupId=${groupId}&limit=10&offset=0`,
      headers,
    });

    expect(access.json()).toEqual({ allowed: true });
    expect(report.statusCode).toBe(200);
    expect(report.headers["cache-control"]).toBe("private, no-store");
    expect(report.json()).toMatchObject({
      timezone: "UTC",
      totals: { sessionCount: 1, actualStudySeconds: 30, focusedSeconds: 20, distractions: 1,
        gradedQuizSessions: 1, quizScore: 1, quizTotal: 2 },
    });
    expect(accounts.json()).toMatchObject({
      total: 1,
      limit: 10,
      offset: 5,
      users: [{ id: userId, email: "learner@example.test", name: "Learner" }],
    });
    expect(accounts.body).not.toContain("password_hash");
    expect(accounts.body).not.toContain("must-not-leak");
    expect(dbCalls.users.at(-1)).toMatchObject({ take: 10, skip: 5 });
    expect(groups.json()).toMatchObject({ groups: [{ id: groupId, name: "Study group", memberCount: 2,
      archived: false, progress: { journeySeconds: 1200, station: 1 } }], total: 1 });
    expect(groups.body).not.toContain("Private");
    expect(sessions.json()).toMatchObject({
      total: 1,
      timezone: "UTC",
      sessions: [{ id: sessionId, accountId: userId, groupId, plannedStudySeconds: 60,
        actualStudySeconds: 30, focusedSeconds: 20, completed: false, quizScore: 1, quizTotal: 2 }],
    });
    for (const privateValue of ["Private personal goal", "Private learning material", "Private explanation", '"segments"', '"feedback"'])
      expect(sessions.body).not.toContain(privateValue);
    const filteredRawCall = dbCalls.raw.filter(([sql]) => String(sql).includes("'sessions'") && !String(sql).includes("COUNT(*)")).at(-1);
    expect(filteredRawCall).toContain(userId);
    expect(filteredRawCall).toContain(groupId);
  });

  it("filters aggregate reports by one account or group and rejects ambiguous scopes", async () => {
    const headers = { authorization: "Bearer allowed-test-token" };
    const account = await app.inject({
      url: "/api/v1/admin/report?days=30&accountId=" + userId,
      headers,
    });
    const group = await app.inject({
      url: "/api/v1/admin/report?days=30&groupId=" + groupId,
      headers,
    });
    const ambiguous = await app.inject({
      url: "/api/v1/admin/report?days=30&accountId=" + userId + "&groupId=" + groupId,
      headers,
    });

    expect(account.statusCode).toBe(200);
    expect(group.statusCode).toBe(200);
    expect(ambiguous.statusCode).toBe(400);
    expect(account.json().totals).toMatchObject({ sessionCount: 1, gradedQuizSessions: 1 });
    expect(group.json().totals).toMatchObject({ sessionCount: 1, gradedQuizSessions: 1 });
    const scopedQueries = dbCalls.raw.filter(([sql]) => String(sql).includes("'sessions'") && !String(sql).includes("COUNT(*)"));
    expect(scopedQueries.some((call) => String(call[0]).includes("entry.value->>'userId'") && call.includes(userId))).toBe(true);
    expect(scopedQueries.some((call) => String(call[0]).includes("entry.value->>'groupId'") && call.includes(groupId))).toBe(true);
  });

  it("rejects unsupported report periods and oversized pages", async () => {
    const headers = { authorization: "Bearer allowed-test-token" };
    const invalidPeriod = await app.inject({ url: "/api/v1/admin/report?days=365", headers });
    const oversizedPage = await app.inject({ url: "/api/v1/admin/accounts?limit=999", headers });

    expect(invalidPeriod.statusCode).toBe(400);
    expect(oversizedPage.statusCode).toBe(400);
  });

  it("exports a filtered report as formula-safe CSV with an accurate UTC filename", async () => {
    const response = await app.inject({
      url: "/api/v1/admin/report/export.csv?days=30",
      headers: { authorization: "Bearer allowed-test-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.headers["content-disposition"]).toMatch(/^attachment; filename="viendu-admin-report-30d-UTC-/);
    expect(response.body).toContain("from_utc");
    expect(response.body).toContain("as_of_utc");
    expect(response.body).not.toContain("Private personal goal");
    expect(response.body).not.toContain(userId);

    const scoped = await app.inject({
      url: "/api/v1/admin/report/export.csv?days=30&groupId=" + groupId,
      headers: { authorization: "Bearer allowed-test-token" },
    });
    expect(scoped.statusCode).toBe(200);
    expect(scoped.headers["content-disposition"]).toMatch(/-group-/);
    expect(scoped.body).toContain("scope=group");
    expect(scoped.body).not.toContain("Private personal goal");
  });
});
