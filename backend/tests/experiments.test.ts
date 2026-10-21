import { describe, expect, it } from "vitest";
import { experimentRecord, publicExperiment, experimentCsv } from "../src/experiments.js";
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
  it("only exposes explicitly selected public columns even if database row has private extras", () => {
    const row = { id: "public-id", tester_code: "T-1234567890", topic: "biology", target_seconds: 60,
      elapsed_seconds: 60, focused_seconds: 40, distractions: 1, completion_percent: 75,
      completed: true, quiz_score: 2, quiz_total: 3, recorded_at: new Date(61000),
      published_at: new Date(71000), user_id: "secret-user", session_id: "secret-session", email: "secret@example.com" };
    const dto = publicExperiment(row);
    expect(dto).toMatchObject({ id: "public-id", focusedSeconds: 40, quizScore: 2 });
    for (const secret of ["secret-user", "secret-session", "secret@example.com"]) expect(JSON.stringify(dto)).not.toContain(secret);
    const csv = experimentCsv([dto]);
    expect(csv).toContain("tester_code");
    expect(csv).toContain("T-1234567890");
    expect(csv).not.toContain("secret");
    for (const topic of ["=1+1", "\t=1+1", "\r\n@SUM(1)", "  +SUM(1)"]) {
      const injected = experimentCsv([{ ...dto, topic }]);
      expect(injected).toContain('"\'');
    }
  });
});
