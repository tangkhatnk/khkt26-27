import { describe, expect, it } from "vitest";
import { projectSessionMetrics, type Session } from "../src/adventure/domain.js";

const session: Session = {
  id: "1b3e7476-973c-4f34-9df2-7a9637b16722",
  userId: "owner",
  groupId: null,
  goal: "Study cells",
  topic: "biology",
  started: 1_000_000,
  ended: 1_055_000,
  target: 60,
  segments: [
    { start: 1_000_000, end: 1_020_000, kind: "focus" },
    { start: 1_020_000, end: 1_030_000, kind: "break" },
    { start: 1_030_000, end: 1_055_000, kind: "focus" },
  ],
  seconds: 44.05,
  contribution: 45,
  rules: "train-v1",
  distractions: 0,
};

describe("projectSessionMetrics", () => {
  it("uses recorded break segments for legacy sessions without a break plan", () => {
    expect(projectSessionMetrics(session).effectiveMetrics).toMatchObject({
      targetSeconds: 60,
      elapsedSeconds: 55,
      actualStudySeconds: 45,
      focusedSeconds: 44.05,
      plannedBreakSeconds: 0,
      actualBreakSeconds: 10,
      distractions: 0,
      completed: false,
      quizScore: null,
      quizTotal: null,
    });
  });

  it("applies corrected metrics as a projection without changing settlement or quiz facts", () => {
    const graded: Session = {
      ...session,
      quiz: {
        score: 1,
        total: 2,
        feedback: [{
          questionId: "question-1",
          question: "Private question",
          options: ["A", "B", "C", "D"],
          selected: 0,
          correctIndex: 1,
          correct: false,
          explanation: "Private explanation",
          knowledgePoint: "Private material",
        }],
      },
    };
    const result = projectSessionMetrics(graded, {
      version: 2,
      goal: "Review cell structure",
      targetSeconds: 70,
      elapsedSeconds: 60,
      actualStudySeconds: 50,
      focusedSeconds: 40,
      actualBreakSeconds: 10,
      distractions: 1,
      quizResult: { score: 2, total: 2 },
    });

    expect(result).toMatchObject({
      goal: "Review cell structure",
      target: 70,
      correctionVersion: 2,
      effectiveMetrics: {
        targetSeconds: 70,
        elapsedSeconds: 60,
        actualStudySeconds: 50,
        focusedSeconds: 40,
        actualBreakSeconds: 10,
        distractions: 1,
        quizScore: 2,
        quizTotal: 2,
      },
    });
    expect(result.quiz).toEqual(graded.quiz);
    expect(graded).toMatchObject({ target: 60, seconds: 44.05, goal: "Study cells", quiz: { score: 1, total: 2 } });
  });

  it("keeps untouched measured metrics tied to raw target and preserves invalid explicit values for boundary validation", () => {
    const projected = projectSessionMetrics(session, { version: 1, targetSeconds: 70, focusedSeconds: 60 });

    expect(projected.effectiveMetrics).toMatchObject({ targetSeconds: 70, actualStudySeconds: 45, focusedSeconds: 60 });
    expect(projected.correctionFlags).toMatchObject({ targetSeconds: true, actualStudySeconds: false, focusedSeconds: true });
  });

  it("keeps elapsed at least as long as a legacy trip's study plus recorded break", () => {
    const longTrip: Session = {
      ...session,
      ended: session.started + 70_000,
      seconds: 60,
      segments: [
        { start: session.started, end: session.started + 60_000, kind: "focus" },
        { start: session.started + 60_000, end: session.started + 70_000, kind: "break" },
      ],
    };

    expect(projectSessionMetrics(longTrip).effectiveMetrics).toMatchObject({
      targetSeconds: 60,
      elapsedSeconds: 70,
      actualStudySeconds: 60,
      actualBreakSeconds: 10,
    });
  });
});
