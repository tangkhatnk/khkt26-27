import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { PGlite } from "@electric-sql/pglite";
import type { PrismaClient } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { adminRoutes } from "../src/admin.js";
import { ApiError } from "../src/errors.js";

const adminId = "1fd25496-aed3-481c-8b3f-2468aa69e2c4";
const accountId = "55a01d18-8ec0-43f4-8ddc-475a2bb13027";
const groupId = "10f86082-c8de-4d40-b181-fca17806fcf3";
const firstSessionId = "957b3476-2742-46a4-b8b2-fc78928dd99e";
const secondSessionId = "a1a89d9e-0652-4b75-abf6-6f62f3ed4c53";
const guestSessionId = "31887391-e508-481f-8435-0e9b5303c2ac";
const oldSessionId = "4ed529a1-d70b-41f8-8a0c-9a7e6748b01c";

const pg = new PGlite();
const app = Fastify({ logger: false });
const baseTime = Date.now();
const session = (value: {
  id: string;
  userId: string;
  groupId: string | null;
  started: number;
  ended: number;
  target: number;
  seconds: number;
  topic: string;
  quiz?: { score: number; total: number; feedback: { question: string }[] };
}) => ({
  ...value,
  goal: "Private goal: must never leave storage",
  contribution: value.seconds,
  rules: "train-v1",
  distractions: 0,
  segments: [{ start: value.started, end: value.ended, kind: "focus" }],
});

const registeredFirst = session({
  id: firstSessionId,
  userId: accountId,
  groupId,
  started: baseTime - 60_000,
  ended: baseTime - 30_000,
  target: 120,
  seconds: 25,
  topic: "biology",
  quiz: { score: 1, total: 2, feedback: [{ question: "Private material" }] },
});
const registeredSecond = session({
  id: secondSessionId,
  userId: accountId,
  groupId,
  started: baseTime - 3 * 86_400_000,
  ended: baseTime - 3 * 86_400_000 + 120_000,
  target: 120,
  seconds: 110,
  topic: "history",
});
const guest = session({
  id: guestSessionId,
  userId: `guest:${guestSessionId}`,
  groupId: null,
  started: baseTime - 180_000,
  ended: baseTime - 90_000,
  target: 120,
  seconds: 80,
  topic: "biology",
});
const outsideWindow = session({
  id: oldSessionId,
  userId: accountId,
  groupId: null,
  started: baseTime - 100 * 86_400_000,
  ended: baseTime - 100 * 86_400_000 + 120_000,
  target: 120,
  seconds: 120,
  topic: "history",
});

function postgresQueryRaw(parts: TemplateStringsArray, ...values: unknown[]) {
  const parameters: unknown[] = [];
  let sql = "";
  const appendValue = (value: unknown) => {
    if (typeof value === "object" && value !== null && "strings" in value && "values" in value &&
      Array.isArray(value.strings) && Array.isArray(value.values)) {
      sql += value.strings[0] ?? "";
      value.values.forEach((nestedValue, index) => {
        appendValue(nestedValue);
        sql += value.strings[index + 1] ?? "";
      });
      return;
    }
    parameters.push(value);
    sql += `$${parameters.length}`;
  };
  // Match Prisma's nested-fragment flattening before handing SQL to PGlite.
  parts.forEach((part, index) => {
    sql += part;
    if (index < values.length) appendValue(values[index]);
  });
  return pg.query(sql, parameters).then((result) => result.rows);
}

const fakeDb = {
  $queryRaw: postgresQueryRaw,
  user: {
    findUnique: async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      email: "admin@example.test",
      name: "Admin fixture",
      created_at: new Date("2026-01-02T03:04:05.000Z"),
      suspended_at: null,
      deleted_at: null,
      admin_state_version: 0,
      adminGrant: null,
    }),
    findMany: async () => [],
    count: async () => 0,
  },
} as unknown as PrismaClient;

const authenticate = async (request: FastifyRequest) => {
  if (request.headers.authorization !== "Bearer db-test-admin")
    throw new ApiError(401, "authentication-error", "Authentication required");
  request.userId = adminId;
};

beforeAll(async () => {
  app.decorateRequest("userId", "");
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) return reply.code(error.status).send({ detail: error.message });
    if (error instanceof ZodError) return reply.code(400).send({ detail: "validation error" });
    return reply.code(500).send({ detail: error.message });
  });
  await pg.exec("CREATE TABLE adventure_state (id integer PRIMARY KEY, state jsonb NOT NULL)");
  await pg.query("INSERT INTO adventure_state (id, state) VALUES ($1, $2::jsonb)", [1, JSON.stringify({
    people: {},
    groups: {
      [groupId]: {
        id: groupId,
        name: "Alpha study group",
        owner: accountId,
        members: [accountId],
        timezone: "Asia/Ho_Chi_Minh",
        archived: false,
        journey: {
          seconds: 900,
          station: 1,
          remaining: 300,
          threshold: 1800,
          journal: [{ at: baseTime, text: "Private journal entry" }],
        },
      },
    },
    sessions: {
      [firstSessionId]: registeredFirst,
      [secondSessionId]: registeredSecond,
      [guestSessionId]: guest,
      [oldSessionId]: outsideWindow,
    },
    invites: {},
  })]);
  adminRoutes(app, fakeDb, authenticate, [adminId]);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pg.close();
});

describe("admin SQL against in-memory Postgres", () => {
  const headers = { authorization: "Bearer db-test-admin" };

  it("executes report, group search, account/group pagination filters, and empty World queries", async () => {
    const report = await app.inject({ url: "/api/v1/admin/report?days=7", headers });
    expect(report.statusCode, report.body).toBe(200);
    expect(report.json()).toMatchObject({
      matchingSessionCount: 3,
      recordsAnalyzed: 3,
      truncated: false,
      timezone: "UTC",
      totals: {
        sessionCount: 3,
        plannedStudySeconds: 360,
        actualStudySeconds: 240,
        focusedSeconds: 215,
        completedSessions: 1,
        gradedQuizSessions: 1,
        quizCoveragePercent: 33.3,
        quizScore: 1,
        quizTotal: 2,
        quizScorePercent: 50,
      },
    });
    expect(report.body).not.toContain("Private goal");
    expect(report.body).not.toContain("Private material");
    expect(report.body).not.toContain("Private journal entry");

    for (const filter of [`accountId=${accountId}`, `groupId=${groupId}`]) {
      const scoped = await app.inject({ url: `/api/v1/admin/report?days=7&${filter}`, headers });
      expect(scoped.statusCode, scoped.body).toBe(200);
      expect(scoped.json()).toMatchObject({
        analysisLimit: 20_000,
        matchingSessionCount: 2,
        recordsAnalyzed: 2,
        totals: { sessionCount: 2, focusedSeconds: 135 },
      });
      const csv = await app.inject({ url: `/api/v1/admin/report/export.csv?days=7&${filter}`, headers });
      expect(csv.statusCode, csv.body).toBe(200);
      expect(csv.headers["content-type"]).toContain("text/csv");
      expect(csv.body).toContain("analyzed=2;matching=2;truncated=false");
      expect(csv.body).not.toContain("Private");
    }
    const missingAccount = await app.inject({
      url: `/api/v1/admin/report?days=7&accountId=${adminId}`, headers,
    });
    expect(missingAccount.statusCode, missingAccount.body).toBe(200);
    expect(missingAccount.json()).toMatchObject({ matchingSessionCount: 0, totals: { sessionCount: 0 } });

    const groups = await app.inject({
      url: "/api/v1/admin/groups?q=AlPhA&limit=1&offset=0",
      headers,
    });
    expect(groups.statusCode, groups.body).toBe(200);
    expect(groups.json()).toMatchObject({
      total: 1,
      limit: 1,
      groups: [{
        id: groupId,
        name: "Alpha study group",
        memberCount: 1,
        progress: { journeySeconds: 900, station: 1 },
      }],
    });
    expect(groups.body).not.toContain("Private journal entry");

    const accountPage = await app.inject({
      url: `/api/v1/admin/sessions?days=7&accountId=${accountId}&limit=1&offset=1`,
      headers,
    });
    expect(accountPage.statusCode, accountPage.body).toBe(200);
    expect(accountPage.json()).toMatchObject({
      total: 2,
      limit: 1,
      offset: 1,
      sessions: [{ id: secondSessionId, accountId, groupId }],
    });

    const groupPage = await app.inject({
      url: `/api/v1/admin/sessions?days=7&groupId=${groupId}&limit=1&offset=1`,
      headers,
    });
    expect(groupPage.statusCode, groupPage.body).toBe(200);
    expect(groupPage.json()).toMatchObject({
      total: 2,
      limit: 1,
      offset: 1,
      sessions: [{ id: secondSessionId, groupId }],
    });

    await pg.query("UPDATE adventure_state SET state = $1::jsonb WHERE id = $2", [JSON.stringify({
      people: {}, groups: {}, sessions: {}, invites: {},
    }), 1]);
    const emptyReport = await app.inject({ url: "/api/v1/admin/report?days=7", headers });
    const emptyGroups = await app.inject({ url: "/api/v1/admin/groups?q=anything", headers });
    const emptySessions = await app.inject({ url: `/api/v1/admin/sessions?days=7&groupId=${groupId}`, headers });

    expect(emptyReport.statusCode, emptyReport.body).toBe(200);
    expect(emptyReport.json()).toMatchObject({ matchingSessionCount: 0, totals: { sessionCount: 0 } });
    expect(emptyGroups.statusCode, emptyGroups.body).toBe(200);
    expect(emptyGroups.json()).toMatchObject({ groups: [], total: 0 });
    expect(emptySessions.statusCode, emptySessions.body).toBe(200);
    expect(emptySessions.json()).toMatchObject({ sessions: [], total: 0 });
  });
});
