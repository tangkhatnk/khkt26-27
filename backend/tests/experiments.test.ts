import { describe, expect, it } from "vitest";
import { experimentRecord, experimentCsv } from "../src/experiments.js";
import type { Session } from "../src/adventure/domain.js";

const session: Session = {
  id: "e9527db1-0c86-424c-976f-b213cb86bd90", userId: "private-owner", groupId: null,
  goal: "Private personal learning goal", topic: "biology", started: 1000, ended: 61000,
  target: 60, segments: [{ start: 1000, end: 11000, kind: "focus" },
    { start: 11000, end: 31000, kind: "distraction" },
    { start: 31000, end: 61000, kind: "focus" }],
  seconds: 40, contribution: 40, rules: "train-v1", quiz: { score: 2, total: 3 },
};
describe("public experiment projections", () => {
  it("publishes measured metrics without private goals or account ids", () => {
    const record = experimentRecord(session, "private-owner", "server-secret", 75);
    expect(record).toMatchObject({ elapsedSeconds: 60, focusedSeconds: 40, distractions: 1,
      completionPercent: 75, completed: true, quizScore: 2, quizTotal: 3 });
    expect(record.testerCode).toMatch(/^T-[A-F0-9]{10}$/);
    expect(JSON.stringify(record)).not.toContain(session.goal);
    expect(JSON.stringify(record)).not.toContain(session.userId);
    expect(record.testerCode).toBe(experimentRecord(session, "private-owner", "server-secret", null).testerCode);
    expect(record.testerCode).not.toBe(experimentRecord({ ...session, userId: "different-owner" }, "different-owner", "server-secret", null).testerCode);
  });
  it("rejects another learner's session and labels completion estimates as self reported", () => {
    expect(() => experimentRecord(session, "other-owner", "secret", 50)).toThrow();
    expect(experimentRecord({ ...session, ended: 31000 }, session.userId, "secret", null))
      .toMatchObject({ completed: false, elapsedSeconds: 30, completionPercent: null });
  });
  it("keeps private goals out of the public CSV and escapes formula-leading topics", () => {
    const record = experimentRecord({ ...session, topic: "=1+1" }, session.userId, "server-secret", null);
    const csv = experimentCsv([{ ...record, publishedAt: record.recordedAt }]);
    expect(csv).toContain("tester_code");
    expect(csv).toContain("T-");
    expect(csv).not.toContain(session.goal);
    expect(csv).not.toContain("goal_summary");
    expect(csv).toContain("'=");
  });
});

describe("public trip history projections", () => {
  it("derives stable tester and unique per-trip pseudonyms without exposing source IDs", () => {
    const record = experimentRecord(session, session.userId, "server-secret", null);
    const otherTrip = experimentRecord({ ...session, id: "c0d3e52c-08e6-4f36-a33e-004c26c90b47" }, session.userId, "server-secret", null);

    expect(record).toMatchObject({
      topic: "biology", targetSeconds: 60, elapsedSeconds: 60, focusedSeconds: 40,
      distractions: 1, completed: true, quizScore: 2, quizTotal: 3,
      startedAt: "1970-01-01T00:00:01.000Z", endedAt: "1970-01-01T00:01:01.000Z",
      recordedAt: "1970-01-01T00:01:01.000Z",
    });
    expect(record.id).toMatch(/^[a-f0-9]{64}$/);
    expect(record.tripCode).toBe(`V-${record.id.slice(0, 12).toUpperCase()}`);
    expect(record.tripCode).toMatch(/^V-[A-F0-9]{12}$/);
    expect(record.testerCode).toMatch(/^T-[A-F0-9]{10}$/);
    expect(otherTrip.id).not.toBe(record.id);
    expect(otherTrip.tripCode).not.toBe(record.tripCode);
    expect(otherTrip.testerCode).toBe(record.testerCode);
    for (const privateValue of [session.id, session.userId, "owner@example.com"])
      expect(JSON.stringify(record)).not.toContain(privateValue);
    expect(JSON.stringify(record)).not.toContain(session.goal);
    expect(record).not.toHaveProperty("goalSummary");
  });

  it("keeps early-ended timer results incomplete and guards CSV formula cells", () => {
    const record = experimentRecord({
      ...session,
      goal: "=HYPERLINK(\"https://example.invalid\",\"open\")",
      ended: 31000,
      quiz: undefined,
    }, session.userId, "server-secret", null);
    expect(record).toMatchObject({ elapsedSeconds: 30, completed: false, quizScore: null, quizTotal: null });

    const csv = experimentCsv([{ ...record, publishedAt: record.recordedAt }]);
    expect(csv).toContain("trip_code");
    expect(csv).not.toContain("goal_summary");
    expect(csv).toContain("started_at");
    expect(csv).toContain("ended_at");
    expect(csv).toContain("target_seconds");
    expect(csv).toContain(record.tripCode);
    expect(csv).not.toContain("HYPERLINK");
    expect(csv).not.toContain(session.id);
    expect(csv).not.toContain(session.userId);
  });

  it("records planned rest separately and completes against study wallbudget", () => {
    const completed = experimentRecord({
      ...session,
      started: 1000,
      ended: 661000,
      target: 600,
      breakPlan: { count: 1, seconds: 60 },
      segments: [
        { start: 1000, end: 301000, kind: "focus" },
        { start: 301000, end: 361000, kind: "break" },
        { start: 361000, end: 661000, kind: "focus" },
      ],
      seconds: 600,
    }, session.userId, "server-secret", null);
    const early = experimentRecord({
      ...session,
      started: 1000,
      ended: 331000,
      target: 600,
      breakPlan: { count: 1, seconds: 60 },
      segments: [
        { start: 1000, end: 301000, kind: "focus" },
        { start: 301000, end: 331000, kind: "break" },
      ],
      seconds: 300,
    }, session.userId, "server-secret", null);

    expect(completed).toMatchObject({
      elapsedSeconds: 660,
      studyElapsedSeconds: 600,
      breakSeconds: 60,
      plannedBreakSeconds: 60,
      completed: true,
    });
    expect(early).toMatchObject({
      elapsedSeconds: 330,
      studyElapsedSeconds: 300,
      breakSeconds: 30,
      plannedBreakSeconds: 60,
      completed: false,
    });
    const csv = experimentCsv([{ ...completed, publishedAt: completed.recordedAt }]);
    expect(csv).toContain("study_elapsed_seconds");
    expect(csv).toContain("planned_break_seconds");
    expect(csv).toContain("break_seconds");
  });

  it("publishes only the coarse device category and labels legacy records as missing", () => {
    const current = experimentRecord({ ...session, deviceCategory: "tablet" }, session.userId, "server-secret", null);
    const legacy = experimentRecord(session, session.userId, "server-secret", null);

    expect(current.deviceCategory).toBe("tablet");
    expect(legacy.deviceCategory).toBeNull();
    expect(JSON.stringify(current)).not.toContain("userAgent");
    const csv = experimentCsv([{ ...current, publishedAt: current.recordedAt }]);
    expect(csv).toContain("device_category");
    expect(csv).toContain('"tablet"');
  });
});
