import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { PGlite } from "@electric-sql/pglite";
import type { PrismaClient } from "@prisma/client";
import { ZodError } from "zod";
import { buildPublicReport, publicReportCsv, publicReportRoutes } from "../src/publicReport.js";

const privateGoal = "PRIVATE GOAL: review a confidential document";
const privateOwner = "PRIVATE OWNER: learner@example.test";
const privateSession = "PRIVATE SESSION: 909e6e03-1206-4323-a4ce-8d0242673a21";
const privateMaterial = "PRIVATE MATERIAL: exam answer key";
const freeformTopic = "FREEFORM TOPIC: classmate name and notes";

const requestTime = Date.now();
const rows = [
  {
    session: {
      id: privateSession,
      userId: privateOwner,
      groupId: "PRIVATE GROUP: 809e6e03-1206-4323-a4ce-8d0242673a21",
      goal: privateGoal,
      privateMaterial,
      topic: "biology",
      started: requestTime - 120_000,
      ended: requestTime - 60_000,
      target: 60,
      seconds: 45,
      distractions: 1,
      segments: [{ start: requestTime - 120_000, end: requestTime - 75_000, kind: "focus" }],
      quiz: { score: 2, total: 3, feedback: [{ question: privateMaterial }] },
    },
    override: null,
  },
  {
    session: {
      id: "another-private-session-id",
      userId: privateOwner,
      goal: privateGoal,
      topic: freeformTopic,
      started: requestTime - 60_000,
      ended: requestTime,
      target: 60,
      seconds: 30,
      segments: [{ start: requestTime - 60_000, end: requestTime - 30_000, kind: "focus" }],
    },
    override: { version: 1, topic: `${freeformTopic} corrected`, goal: privateGoal },
  },
];

const rawQueries: { sql: string; values: unknown[] }[] = [];
const fakeDb = {
  $queryRaw: async (query: unknown, ...values: unknown[]) => {
    const queryObject = typeof query === "object" && query !== null ? query as { sql?: string; strings?: readonly string[]; values?: readonly unknown[] } : {};
    const sql = queryObject.sql ?? queryObject.strings?.join("?") ?? String(query);
    const parameters = queryObject.values ? [...queryObject.values] : values;
    rawQueries.push({ sql, values: parameters });
    if (/COUNT\(\*\)::int AS total/iu.test(sql)) return [{ total: rows.length }];
    return rows;
  },
} as unknown as PrismaClient;

const app = Fastify({ logger: false });
app.setErrorHandler((error, _request, reply) => {
  if (error instanceof ZodError) return reply.code(400).send({ detail: "validation error" });
  return reply.code(500).send({ detail: "internal error" });
});

beforeAll(async () => {
  await app.register(rateLimit, { global: false, max: 100, timeWindow: "1 minute" });
  publicReportRoutes(app, fakeDb);
  await app.ready();
});
afterAll(async () => app.close());

describe("anonymous aggregate report", () => {
  it("keeps 7, 30, and 90 day UTC windows and daily aggregates without exposing session times", () => {
    const asOf = new Date("2026-10-28T12:00:00.000Z");
    const projection = (topic: string, started: string) => ({
      session: {
        topic,
        started: Date.parse(started),
        ended: Date.parse(started) + 60_000,
        target: 60,
        segments: [{ start: Date.parse(started), end: Date.parse(started) + 45_000, kind: "focus" }],
      },
      override: null,
    });
    const source = [
      projection("biology", "2026-10-28T09:00:00.000Z"),
      projection("history", "2026-10-22T00:00:00.000Z"),
      projection("FREEFORM TOPIC: hidden", "2026-10-21T23:59:59.000Z"),
      projection("geography", "2026-08-01T09:00:00.000Z"),
      projection("biology", "2026-10-28T13:00:00.000Z"),
    ];

    const week = buildPublicReport(source, 7, asOf);
    const month = buildPublicReport(source, 30, asOf);
    const quarter = buildPublicReport(source, 90, asOf);
    expect(week.days).toBe(7);
    expect(week.totals.sessionCount).toBe(2);
    expect(week.daily).toHaveLength(7);
    expect(week.daily[0]).toMatchObject({ dateUtc: "2026-10-22", sessionCount: 1 });
    expect(week.daily.at(-1)).toMatchObject({ dateUtc: "2026-10-28", sessionCount: 1, focusedSeconds: 45 });
    expect(month.days).toBe(30);
    expect(month.totals.sessionCount).toBe(3);
    expect(month.daily.find((row) => row.dateUtc === "2026-10-21")?.sessionCount).toBe(1);
    expect(quarter.days).toBe(90);
    expect(quarter.totals.sessionCount).toBe(4);
    expect(quarter.daily.find((row) => row.dateUtc === "2026-08-01")?.sessionCount).toBe(1);
    expect(week.topics.find((row) => row.topic === "Khác")?.sessionCount).toBe(0);
    expect(month.topics.find((row) => row.topic === "Khác")?.sessionCount).toBe(1);
    expect(JSON.stringify(week)).not.toMatch(/started|ended|asOfUtc|fromUtc|FREEFORM TOPIC/u);
    expect(publicReportCsv(week)).toContain('"Ngày","2026-10-28",""');
    expect(publicReportCsv(week)).not.toMatch(/T\d{2}:\d{2}|started|ended|asOfUtc|fromUtc/u);
  });

  it("returns only aggregate allowlist fields and groups unknown topics as Khác", async () => {
    const response = await app.inject({ url: "/api/v1/public/report" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const report = response.json();
    expect(Object.keys(report).sort()).toEqual([
      "analysisLimit", "daily", "days", "matchingSessionCount", "recordsAnalyzed", "topics", "totals", "truncated",
    ]);
    expect(report.days).toBe(7);
    expect(report.analysisLimit).toBe(5000);
    expect(report.matchingSessionCount).toBe(2);
    expect(report.recordsAnalyzed).toBe(2);
    expect(report.truncated).toBe(false);
    expect(report.daily).toHaveLength(7);
    expect(Object.keys(report.totals).sort()).toEqual([
      "actualBreakSeconds", "actualStudySeconds", "completedSessions", "completionPercent",
      "distractions", "focusedSeconds", "gradedQuizSessions", "plannedBreakSeconds",
      "plannedStudySeconds", "quizCoveragePercent", "quizScore", "quizScorePercent", "quizTotal",
      "sessionCount",
    ]);
    expect(report.totals).toMatchObject({ sessionCount: 2, focusedSeconds: 75, quizScore: 2, quizTotal: 3 });
    expect(report.topics.find((topic: { topic: string }) => topic.topic === "Khác")).toMatchObject({
      sessionCount: 1,
      focusedSeconds: 30,
    });
    expect(report.topics.find((topic: { topic: string }) => topic.topic === "Sinh học")).toMatchObject({
      sessionCount: 1,
      focusedSeconds: 45,
    });
    expect(JSON.stringify(report)).not.toContain(privateGoal);
    expect(JSON.stringify(report)).not.toContain(privateOwner);
    expect(JSON.stringify(report)).not.toContain(privateSession);
    expect(JSON.stringify(report)).not.toContain(privateMaterial);
    expect(JSON.stringify(report)).not.toContain(freeformTopic);
    expect(rawQueries.map(({ sql }) => sql).join("\n")).not.toMatch(/goal|userId|groupId|email|privateMaterial/iu);
  });

  it("rejects account and group filters instead of accepting an alternate scope", async () => {
    expect((await app.inject({ url: "/api/v1/public/report?accountId=private" })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/v1/public/report?groupId=private" })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/v1/public/report?days=365" })).statusCode).toBe(400);
  });

  it("applies the selected period to both JSON and CSV responses", async () => {
    const jsonResponse = await app.inject({ url: "/api/v1/public/report?days=30" });
    expect(jsonResponse.statusCode).toBe(200);
    expect(jsonResponse.json()).toMatchObject({ days: 30, daily: expect.any(Array) });
    expect(jsonResponse.json().daily).toHaveLength(30);

    const csvResponse = await app.inject({ url: "/api/v1/public/report/export.csv?days=90" });
    expect(csvResponse.statusCode).toBe(200);
    expect(csvResponse.body).toContain('"Tổng quan 90 ngày"');
    expect(csvResponse.body.split('"Ngày"').length).toBeGreaterThan(1);
  });

  it("filters database work to the UTC window and reports the capped aggregate sample honestly", async () => {
    const cappedRows = Array.from({ length: 5000 }, (_, index) => ({
      session: {
        id: privateSession,
        userId: privateOwner,
        groupId: "PRIVATE GROUP",
        goal: privateGoal,
        topic: index === 0 ? freeformTopic : "biology",
        started: requestTime - 120_000,
        ended: requestTime - 60_000,
        target: 60,
        seconds: 45,
        segments: [{ start: requestTime - 120_000, end: requestTime - 75_000, kind: "focus" }],
      },
      override: null,
    }));
    const queries: { sql: string; values: unknown[] }[] = [];
    const cappedDb = {
      $queryRaw: async (query: unknown) => {
        const queryObject = query as { sql?: string; strings?: readonly string[]; values?: readonly unknown[] };
        const sql = queryObject.sql ?? queryObject.strings?.join("?") ?? String(query);
        queries.push({ sql, values: [...(queryObject.values ?? [])] });
        if (/COUNT\(\*\)::int AS total/iu.test(sql)) return [{ total: 6200 }];
        return cappedRows;
      },
    } as unknown as PrismaClient;
    const cappedApp = Fastify({ logger: false });
    await cappedApp.register(rateLimit, { global: false, max: 100, timeWindow: "1 minute" });
    publicReportRoutes(cappedApp, cappedDb);
    await cappedApp.ready();

    const queryStartedAt = Date.now();
    const response = await cappedApp.inject({ url: "/api/v1/public/report?days=7" });
    const queryFinishedAt = Date.now();
    expect(response.statusCode).toBe(200);
    const report = response.json();
    expect(report).toMatchObject({
      days: 7,
      analysisLimit: 5000,
      matchingSessionCount: 6200,
      recordsAnalyzed: 5000,
      truncated: true,
      totals: { sessionCount: 5000 },
    });
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE|learner@example\.test|FREEFORM TOPIC|groupId|userId|goal|started|ended/u);

    const rowsQuery = queries.find(({ sql }) => /jsonb_strip_nulls\(jsonb_build_object/u.test(sql));
    const countQuery = queries.find(({ sql }) => /COUNT\(\*\)::int AS total/u.test(sql));
    expect(rowsQuery?.sql).toMatch(/entry\.value->>'started'[\s\S]*?ORDER BY[\s\S]*?LIMIT/u);
    expect(rowsQuery?.sql).toMatch(/removedAt/u);
    expect(rowsQuery?.values).toContain(5000);
    const utcToday = Date.UTC(new Date(queryStartedAt).getUTCFullYear(), new Date(queryStartedAt).getUTCMonth(), new Date(queryStartedAt).getUTCDate());
    expect(rowsQuery?.values[0]).toBe(utcToday - 6 * 86_400_000);
    expect(countQuery?.values[0]).toBe(rowsQuery?.values[0]);
    expect(typeof rowsQuery?.values[1]).toBe("number");
    expect(rowsQuery?.values[1]).toBeGreaterThanOrEqual(queryStartedAt);
    expect(rowsQuery?.values[1]).toBeLessThanOrEqual(queryFinishedAt);
    expect(countQuery?.values[1]).toBe(rowsQuery?.values[1]);
    expect(rowsQuery?.sql).not.toMatch(/goal|userId|groupId|email/iu);
    expect(countQuery?.sql).toMatch(/entry\.value->>'started'/u);
    expect(countQuery?.sql).toMatch(/removedAt/u);
    expect(countQuery?.sql).not.toMatch(/goal|userId|groupId|email/iu);

    const csvResponse = await cappedApp.inject({ url: "/api/v1/public/report/export.csv?days=7" });
    expect(csvResponse.statusCode).toBe(200);
    expect(csvResponse.body).toContain("analysisLimit,matchingSessionCount,recordsAnalyzed,truncated");
    expect(csvResponse.body).toContain('"Tổng quan 7 ngày","","","5000","6200","5000","true","5000"');
    expect(csvResponse.body).not.toMatch(/PRIVATE|learner@example\.test|FREEFORM TOPIC|groupId|userId|goal|started|ended/u);
    await cappedApp.close();
  });

  it("runs the bounded public query against PostgreSQL and excludes sessions outside its UTC window", async () => {
    const pg = new PGlite();
    const pgApp = Fastify({ logger: false });
    const baseTime = Date.now();
    const utcToday = Date.UTC(new Date(baseTime).getUTCFullYear(), new Date(baseTime).getUTCMonth(), new Date(baseTime).getUTCDate());
    const fromMs = utcToday - 6 * 86_400_000;
    const makeSession = (id: string, started: number, topic: string) => ({
      id,
      userId: privateOwner,
      groupId: "PRIVATE GROUP",
      goal: privateGoal,
      topic,
      started,
      ended: started + 60_000,
      target: 60,
      seconds: 45,
      segments: [{ start: started, end: started + 45_000, kind: "focus" }],
    });
    const removedId = "REMOVED SESSION ID";
    const todayId = "PRIVATE TODAY ID";
    const boundaryId = "PRIVATE BOUNDARY ID";
    const outsideId = "PRIVATE OUTSIDE ID";
    const futureId = "PRIVATE FUTURE ID";
    const sessions = {
      [todayId]: makeSession(todayId, baseTime - 120_000, "biology"),
      [boundaryId]: makeSession(boundaryId, fromMs, "FREEFORM TOPIC"),
      [outsideId]: makeSession(outsideId, fromMs - 1, "history"),
      [removedId]: makeSession(removedId, baseTime - 180_000, "biology"),
      [futureId]: makeSession(futureId, baseTime + 60_000, "biology"),
    };
    const state = {
      sessions: Object.fromEntries(Object.entries(sessions).map(([key, session]) => [key, session])),
      sessionOverrides: { [removedId]: { version: 1, removedAt: baseTime } },
    };
    await pg.exec("CREATE TABLE adventure_state (id integer PRIMARY KEY, state jsonb NOT NULL)");
    await pg.query("INSERT INTO adventure_state (id, state) VALUES (1, $1::jsonb)", [JSON.stringify(state)]);

    const appendFragment = (strings: readonly string[], values: readonly unknown[], parameters: unknown[]) => {
      let sql = strings[0] ?? "";
      values.forEach((value, index) => {
        if (typeof value === "object" && value !== null && "strings" in value && "values" in value &&
          Array.isArray(value.strings) && Array.isArray(value.values)) {
          sql += appendFragment(value.strings, value.values, parameters);
        } else {
          parameters.push(value);
          sql += `$${parameters.length}`;
        }
        sql += strings[index + 1] ?? "";
      });
      return sql;
    };
    const postgresQueryRaw = async (query: unknown, ...values: unknown[]) => {
      const parameters: unknown[] = [];
      if (Array.isArray(query)) return pg.query(appendFragment(query, values, parameters), parameters).then((result) => result.rows);
      const sql = query as { strings?: readonly string[]; values?: readonly unknown[] };
      if (!sql.strings || !sql.values) throw new Error("Expected a parameterized Prisma SQL query.");
      return pg.query(appendFragment(sql.strings, sql.values, parameters), parameters).then((result) => result.rows);
    };
    const pgDb = { $queryRaw: postgresQueryRaw } as unknown as PrismaClient;

    try {
      await pgApp.register(rateLimit, { global: false, max: 100, timeWindow: "1 minute" });
      pgApp.setErrorHandler((error, _request, reply) => {
        if (error instanceof ZodError) return reply.code(400).send({ detail: "validation error" });
        return reply.code(500).send({ detail: error.message });
      });
      publicReportRoutes(pgApp, pgDb);
      await pgApp.ready();
      const response = await pgApp.inject({ url: "/api/v1/public/report?days=7" });
      expect(response.statusCode, response.body).toBe(200);
      const report = response.json();
      expect(report).toMatchObject({
        analysisLimit: 5000,
        matchingSessionCount: 2,
        recordsAnalyzed: 2,
        truncated: false,
        totals: { sessionCount: 2 },
      });
      expect(report.daily.find((day: { dateUtc: string }) => day.dateUtc === new Date(fromMs).toISOString().slice(0, 10)))
        .toMatchObject({ sessionCount: 1 });
      expect(response.body).not.toMatch(/PRIVATE|learner@example\.test|FREEFORM TOPIC|groupId|userId|goal|started|ended/u);
    } finally {
      await pgApp.close();
      await pg.close();
    }
  });

  it("serves the public CSV from the same projection with no-store headers", async () => {
    const response = await app.inject({ url: "/api/v1/public/report/export.csv" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.headers["content-disposition"]).toContain("viendu-public-report.csv");
    expect(response.body).toContain('"Tổng quan 7 ngày"');
    expect(response.body).toContain('"Ngày"');
    expect(response.body).toContain('"Khác"');
    expect(response.body).not.toContain(privateGoal);
    expect(response.body).not.toContain(privateOwner);
    expect(response.body).not.toContain(privateSession);
    expect(response.body).not.toContain(privateMaterial);
    expect(response.body).not.toContain(freeformTopic);
  });

  it("exports a CSV generated from the same allowlisted aggregate DTO", () => {
    const report = {
      days: 7 as const,
      analysisLimit: 5000,
      matchingSessionCount: 1,
      recordsAnalyzed: 1,
      truncated: false,
      totals: {
        sessionCount: 1, plannedStudySeconds: 60, actualStudySeconds: 60, focusedSeconds: 50,
        plannedBreakSeconds: 0, actualBreakSeconds: 0, distractions: 0, completedSessions: 1,
        completionPercent: 100, gradedQuizSessions: 0, quizCoveragePercent: 0,
        quizScore: 0, quizTotal: 0, quizScorePercent: null,
      },
      daily: [{
        dateUtc: "2026-10-28", sessionCount: 1, plannedStudySeconds: 60, actualStudySeconds: 60,
        focusedSeconds: 50, plannedBreakSeconds: 0, actualBreakSeconds: 0, distractions: 0,
        completedSessions: 1, completionPercent: 100, gradedQuizSessions: 0, quizCoveragePercent: 0,
        quizScore: 0, quizTotal: 0, quizScorePercent: null,
      }],
      topics: [{
        topic: "Khác", sessionCount: 1, plannedStudySeconds: 60, actualStudySeconds: 60,
        focusedSeconds: 50, plannedBreakSeconds: 0, actualBreakSeconds: 0, distractions: 0,
        completedSessions: 1, completionPercent: 100, gradedQuizSessions: 0,
        quizCoveragePercent: 0, quizScore: 0, quizTotal: 0, quizScorePercent: null,
      }],
    };
    const csv = publicReportCsv(report);
    expect(csv).toContain("section,dateUtc,topic,analysisLimit,matchingSessionCount,recordsAnalyzed,truncated,sessionCount");
    expect(csv).toContain('"Tổng quan 7 ngày","","","5000","1","1","false","1"');
    expect(csv).toContain('"Ngày","2026-10-28","","5000","1","1","false","1"');
    expect(csv).toContain('"Chủ đề","","Khác","5000","1","1","false","1"');
    expect(csv).not.toMatch(/goal|user|group|email|PRIVATE|FREEFORM|started|ended/iu);
  });

  it("rate limits anonymous report requests", async () => {
    const limitedApp = Fastify({ logger: false });
    await limitedApp.register(rateLimit, { global: false, max: 100, timeWindow: "1 minute" });
    publicReportRoutes(limitedApp, fakeDb);
    await limitedApp.ready();
    let lastResponse;
    for (let count = 0; count < 21; count += 1)
      lastResponse = await limitedApp.inject({ url: "/api/v1/public/report" });
    expect(lastResponse?.statusCode).toBe(429);
    expect(lastResponse?.headers["cache-control"]).toBe("no-store");
    await limitedApp.close();
  });
});
