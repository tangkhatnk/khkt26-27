import { describe, expect, it } from "vitest";
import {
  adminReportCsv,
  adminSessionDto,
  buildAdminReport,
} from "../src/admin.js";
import { adminUserIdsSchema } from "../src/config.js";

const start = Date.parse("2026-10-21T00:00:00.000Z");
const base = {
  userId: "75f718a2-6115-4ceb-8ae5-6acb8d8ca851",
  groupId: null,
  goal: "Private study goal",
  contribution: 1,
  rules: "train-v1",
  segments: [{ start, end: start + 1000, kind: "focus" as const }],
};

describe("admin study reporting", () => {
  it("normalizes a comma-separated UUID allowlist and rejects invalid account identifiers", () => {
    expect(adminUserIdsSchema.parse(" 1FD25496-AED3-481C-8B3F-2468AA69E2C4,1fd25496-aed3-481c-8b3f-2468aa69e2c4 "))
      .toEqual(["1fd25496-aed3-481c-8b3f-2468aa69e2c4"]);
    expect(adminUserIdsSchema.parse("")).toEqual([]);
    expect(() => adminUserIdsSchema.parse("admin@example.test")).toThrow(/UUIDs/);
  });

  it("aggregates planned, actual, focused, distraction and graded-quiz measures without exposing private session data", () => {
    const sessions = [
      {
        ...base,
        id: "a5f601ce-5955-4653-b4b9-0c4e0de28e31",
        topic: "biology",
        started: start,
        ended: start + 720_000,
        target: 600,
        seconds: 500,
        distractions: 0,
        breakPlan: { count: 2, seconds: 60 },
        quiz: { score: 2, total: 4, feedback: [{ question: "Private quiz question" }] },
      },
      {
        ...base,
        id: "923806bd-2425-4c83-92d0-49c86892a657",
        topic: "=1+2",
        started: start + 1,
        ended: start + 500_001,
        target: 600,
        seconds: 300,
        distractions: 0,
        breakPlan: { count: 2, seconds: 60 },
      },
      {
        ...base,
        id: "7bac50c8-17db-4d93-9b9d-dd7cb043da4f",
        topic: "biology",
        started: start + 2,
        ended: start + 300_002,
        target: 300,
        seconds: 100,
        distractions: 2,
      },
    ];
    const asOf = new Date(start + 800_000);
    const report = buildAdminReport(sessions, 7, asOf);

    expect(report).toMatchObject({
      days: 7,
      timezone: "UTC",
      analysisLimit: 20_000,
      totals: {
        sessionCount: 3,
        plannedStudySeconds: 1500,
        actualStudySeconds: 1300,
        focusedSeconds: 900,
        plannedBreakSeconds: 240,
        actualBreakSeconds: 220,
        distractions: 2,
        completedSessions: 2,
        gradedQuizSessions: 1,
        quizCoveragePercent: 33.3,
        quizScore: 2,
        quizTotal: 4,
        quizScorePercent: 50,
      },
    });
    expect(report.daily).toHaveLength(7);
    expect(report.daily.at(-1)).toMatchObject({ dateUtc: "2026-10-21", sessionCount: 3 });

    const early = adminSessionDto(sessions[1]);
    expect(early).toMatchObject({
      topic: "=1+2",
      actualStudySeconds: 400,
      focusedSeconds: 300,
      actualBreakSeconds: 100,
      plannedBreakSeconds: 120,
      distractions: 0,
      completed: false,
      quizScore: null,
      quizTotal: null,
    });
    const serialized = JSON.stringify({ early, report });
    for (const privateValue of ["Private study goal", "Private quiz question", "feedback", '"segments"'])
      expect(serialized).not.toContain(privateValue);
  });

  it("returns explicit zero totals and marks a capped sample instead of implying full coverage", () => {
    const asOf = new Date(start + 40_000);
    const empty = buildAdminReport([], 30, asOf);
    const sampled = buildAdminReport([{
      ...base,
      id: "b9c9e146-b253-4d7b-a3f8-360f60de434c",
      topic: "biology",
      started: start,
      ended: start + 30_000,
      target: 60,
      seconds: 0,
      distractions: 0,
    }], 7, asOf, 21);

    expect(empty).toMatchObject({
      recordsAnalyzed: 0,
      matchingSessionCount: 0,
      truncated: false,
      totals: { sessionCount: 0, completionPercent: 0, quizCoveragePercent: 0, quizScorePercent: null },
      topics: [],
    });
    expect(empty.daily).toHaveLength(30);
    expect(sampled).toMatchObject({ recordsAnalyzed: 1, matchingSessionCount: 21, truncated: true });
  });

  it("exports aggregated UTC rows and protects topic cells from spreadsheet formulas", () => {
    const report = buildAdminReport([
      {
        ...base,
        id: "b74dd779-a4b3-45d2-a0bb-940ba2dc4004",
        topic: "  =HYPERLINK(\"https://example.invalid\")",
        started: start,
        ended: start + 30_000,
        target: 60,
        seconds: 20,
        distractions: 1,
      },
    ], 7, new Date(start + 50_000));
    const csv = adminReportCsv(report);

    expect(csv).toContain("from_utc");
    expect(csv).toContain("as_of_utc");
    expect(csv).toContain("timezone");
    expect(csv).toContain("2026-10-21");
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toContain(',"  =HYPERLINK');
    expect(csv).not.toContain("Private study goal");
  });

  it("includes scope and analyzed-versus-matching counts in scoped exports", () => {
    const report = buildAdminReport([{
      ...base,
      id: "b74dd779-a4b3-45d2-a0bb-940ba2dc4004",
      topic: "biology",
      started: start,
      ended: start + 30_000,
      target: 60,
      seconds: 20,
      distractions: 1,
    }], 7, new Date(start + 50_000), 21);

    const csv = adminReportCsv(report, "account", base.userId);

    expect(csv).toContain("scope=account");
    expect(csv).toContain("scope_id=" + base.userId);
    expect(csv).toContain("limit=20000");
    expect(csv).toContain("analyzed=1;matching=21;truncated=true");
    expect(csv).not.toContain("Private study goal");
  });
});
