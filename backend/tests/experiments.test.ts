import { describe, expect, it } from "vitest";
import { experimentRecord, experimentCsv } from "../src/experiments.js";
import type { Session, SessionOverride } from "../src/adventure/domain.js";

const session: Session = {
  id: "e9527db1-0c86-424c-976f-b213cb86bd90", userId: "private-owner", groupId: null,
  goal: "Private personal learning goal", topic: "biology", started: 1000, ended: 61000,
  target: 60, segments: [{ start: 1000, end: 11000, kind: "focus" },
    { start: 11000, end: 31000, kind: "distraction" },
    { start: 31000, end: 61000, kind: "focus" }],
  seconds: 40, contribution: 40, rules: "train-v1", quiz: { score: 2, total: 3 },
};

describe("automatic trip history projections", () => {
  it("projects saved session metrics and HMAC identities without publication metadata", () => {
    const record = experimentRecord(session, "server-secret");
    const otherTrip = experimentRecord({ ...session, id: "c0d3e52c-08e6-4f36-a33e-004c26c90b47" }, "server-secret");
    expect(record).toMatchObject({ elapsedSeconds: 60, focusedSeconds: 40, distractions: 1,
      completed: true, quizScore: 2, quizTotal: 3, goalSummary: session.goal });
    expect(record.testerCode).toMatch(/^T-[A-F0-9]{10}$/);
    expect(record.tripCode).toMatch(/^V-[A-F0-9]{12}$/);
    expect(JSON.stringify(record)).not.toContain(session.userId);
    expect(JSON.stringify(record)).not.toContain(session.id);
    expect(record).not.toHaveProperty("publishedAt");
    expect(record).not.toHaveProperty("completionPercent");
    expect(record.testerCode).toBe(experimentRecord(session, "server-secret").testerCode);
    expect(record.testerCode).not.toBe(experimentRecord({ ...session, userId: "different-owner" }, "server-secret").testerCode);
    expect(otherTrip.id).not.toBe(record.id);
    expect(otherTrip.tripCode).not.toBe(record.tripCode);
    expect(otherTrip.testerCode).toBe(record.testerCode);
  });

  it("uses the corrected effective projection and sanitizes the current goal summary", () => {
    const goal = `${"A".repeat(199)}\u0000🙂`;
    const correction: SessionOverride = {
      version: 1,
      goal: `${goal}\n and private material notes`,
      topic: "history",
      targetSeconds: 120,
      elapsedSeconds: 90,
      actualStudySeconds: 70,
      focusedSeconds: 60,
      actualBreakSeconds: 20,
      distractions: 2,
      quizResult: { score: 1, total: 2 },
    };
    const record = experimentRecord({ ...session, goal: "Old private goal" }, "server-secret", correction);

    expect(record).toMatchObject({ topic: "history", goalSummary: `${"A".repeat(199)}…`, targetSeconds: 120,
      elapsedSeconds: 90, studyElapsedSeconds: 70, breakSeconds: 20, focusedSeconds: 60,
      distractions: 2, completed: false, quizScore: 1, quizTotal: 2,
      correctionFlags: { goal: true, topic: true, elapsedSeconds: true, quizResult: true } });
    expect(Array.from(record.goalSummary)).toHaveLength(200);
    for (const privateValue of ["Old private goal", "private-owner", session.id, "private@example.com",
      "material notes", "answer text", "materials.pdf"])
      expect(JSON.stringify(record)).not.toContain(privateValue);
  });

  it("sanitizes and truncates goal summaries to 200 Unicode code points", () => {
    const record = experimentRecord({ ...session, goal: `${"B".repeat(200)}🙂` }, "server-secret");
    expect(Array.from(record.goalSummary)).toHaveLength(200);
    expect(record.goalSummary).toBe(`${"B".repeat(199)}…`);
    expect(experimentRecord({ ...session, goal: "  read\u0000\u200B this  " }, "server-secret").goalSummary)
      .toBe("read this");
  });

  it("marks a goal-only correction while exposing only its sanitized summary", () => {
    const correctedGoal = "Review a short passage";
    const record = experimentRecord(session, "server-secret", { version: 1, goal: correctedGoal });

    expect(record.goalSummary).toBe(correctedGoal);
    expect(record.correctionFlags).toMatchObject({ goal: true, topic: false, quizResult: false });
    expect(record).not.toHaveProperty("goal");
  });

  it("records scheduled rest separately from study completion and early-ending", () => {
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
    }, "server-secret");
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
    }, "server-secret");

    expect(completed).toMatchObject({ elapsedSeconds: 660, studyElapsedSeconds: 600,
      breakSeconds: 60, plannedBreakSeconds: 60, completed: true });
    expect(early).toMatchObject({ elapsedSeconds: 330, studyElapsedSeconds: 300,
      breakSeconds: 30, plannedBreakSeconds: 60, completed: false });
    const csv = experimentCsv([completed]);
    expect(csv).toContain("study_elapsed_seconds");
    expect(csv).toContain("planned_break_seconds");
    expect(csv).toContain("break_seconds");
  });

  it("defaults absent plans to zero and exposes counts only from valid saved plans", () => {
    const planned = experimentRecord({ ...session, target: 180,
      breakPlan: { count: 2, seconds: 60 } }, "server-secret");
    const noBreaks = experimentRecord({ ...session, target: 120,
      breakPlan: { count: 0, seconds: 60 } }, "server-secret");
    const nullPlan = experimentRecord({ ...session, breakPlan: null as unknown as Session["breakPlan"] }, "server-secret");
    const legacyBreakSegments = experimentRecord({ ...session, target: 120,
      segments: [{ start: 1000, end: 21000, kind: "focus" },
        { start: 21000, end: 31000, kind: "break" },
        { start: 31000, end: 61000, kind: "focus" }] }, "server-secret");
    const invalidPlan = experimentRecord({ ...session, target: 60,
      breakPlan: { count: 1, seconds: 60 } }, "server-secret");

    expect(planned.plannedBreakCount).toBe(2);
    expect(noBreaks.plannedBreakCount).toBe(0);
    expect(experimentRecord(session, "server-secret").plannedBreakCount).toBe(0);
    expect(nullPlan.plannedBreakCount).toBe(0);
    expect(legacyBreakSegments.plannedBreakCount).toBe(0);
    expect(invalidPlan.plannedBreakCount).toBeNull();
    expect(experimentCsv([planned])).not.toContain("planned_break_count");
  });

  it("keeps only coarse device categories and treats legacy missing values explicitly", () => {
    const current = experimentRecord({ ...session, deviceCategory: "tablet" }, "server-secret");
    const legacy = experimentRecord(session, "server-secret");

    expect(current.deviceCategory).toBe("tablet");
    expect(legacy.deviceCategory).toBeNull();
    expect(JSON.stringify(current)).not.toContain("userAgent");
    const csv = experimentCsv([current]);
    expect(csv).toContain("device_category");
    expect(csv).toContain('"tablet"');
  });

  it("includes sanitized goals in CSV and escapes formula-leading values", () => {
    const record = experimentRecord({ ...session, goal: "=HYPERLINK(\"https://example.invalid\",\"open\")", topic: "=1+1" }, "server-secret");
    const csv = experimentCsv([record]);
    expect(csv).toContain("goal_summary");
    expect(csv).toContain("goal_corrected");
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'=");
    expect(csv).toContain(record.tripCode);
    expect(csv).not.toContain(session.id);
    expect(csv).not.toContain(session.userId);
  });
});
