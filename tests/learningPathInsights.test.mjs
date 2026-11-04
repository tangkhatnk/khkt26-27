import assert from "node:assert/strict";
import test from "node:test";
import { CURATED_COURSES } from "../src/adventure/curatedCurriculum.ts";
import { chooseDuration, dailyStudySummary, difficultySuggestion, durationSuggestion, workedReviewLesson } from "../src/adventure/learningPathInsights.ts";
import { createLearningPathProgress } from "../src/adventure/learningPath.ts";

const course = CURATED_COURSES.find((item) => item.id === "math-7-ratios");
assert.ok(course);

function assessment(sessionId, conceptId, correctCount, total = 4, lessonId = "math-7-ratios-meaning") {
  return {
    lessonId,
    lessonVersion: 1,
    sessionId,
    score: correctCount,
    total,
    completedAt: Number(sessionId.replace(/\D/gu, "")) || 1,
    assessedAnswers: Array.from({ length: total }, (_, index) => ({
      questionId: `${sessionId}-q${index + 1}`,
      conceptId,
      correct: index < correctCount,
    })),
  };
}

function learningProgress(records) {
  return { ...createLearningPathProgress(course.id), completed: records };
}

function recordedSession({ id, topic = "mathematics", minutes, ended, completed = true }) {
  const focusedSeconds = minutes * 60;
  return {
    id,
    userId: "guest",
    groupId: null,
    topic,
    goal: "Review the selected lesson",
    started: ended - focusedSeconds * 1000,
    ended,
    target: focusedSeconds,
    segments: [{ start: ended - focusedSeconds * 1000, end: ended, kind: "focus" }],
    seconds: focusedSeconds,
    contribution: focusedSeconds,
    rules: "train-v1",
    effectiveMetrics: {
      targetSeconds: focusedSeconds,
      elapsedSeconds: focusedSeconds,
      actualStudySeconds: focusedSeconds,
      focusedSeconds,
      plannedBreakSeconds: 0,
      actualBreakSeconds: 0,
      distractions: 0,
      completed,
      quizScore: null,
      quizTotal: null,
    },
  };
}

test("daily progress keeps curated evaluation results separate from AI quiz metrics", () => {
  const now = new Date(2026, 10, 4, 16).getTime();
  const started = new Date(2026, 10, 4, 14).getTime();
  const today = {
    ...recordedSession({ id: "today", minutes: 40, ended: started + 60 * 60 * 1000 }),
    started,
    target: 40 * 60,
    breakPlan: { count: 2, seconds: 5 * 60 },
    seconds: 30 * 60,
    effectiveMetrics: {
      targetSeconds: 40 * 60,
      elapsedSeconds: 60 * 60,
      actualStudySeconds: 50 * 60,
      focusedSeconds: 30 * 60,
      plannedBreakSeconds: 10 * 60,
      actualBreakSeconds: 8 * 60,
      distractions: 2,
      completed: true,
      quizScore: 3,
      quizTotal: 4,
    },
    quiz: { score: 2, total: 4 },
  };
  const yesterday = recordedSession({ id: "yesterday", minutes: 25, ended: new Date(2026, 10, 3, 16).getTime() });
  const curatedEvaluations = [
    { lessonId: "math-7-ratios-meaning", lessonVersion: 1, sessionId: "curated-today", score: 3, total: 4, completedAt: new Date(2026, 10, 4, 15).getTime(), assessedAnswers: [] },
    { lessonId: "math-7-ratios-property", lessonVersion: 1, sessionId: "curated-yesterday", score: 2, total: 4, completedAt: new Date(2026, 10, 3, 15).getTime(), assessedAnswers: [] },
  ];

  assert.deepEqual(dailyStudySummary([today, yesterday], now, curatedEvaluations), {
    sessionCount: 1,
    focusedSeconds: 30 * 60,
    plannedBreakSeconds: 10 * 60,
    actualBreakSeconds: 8 * 60,
    awaySeconds: 20 * 60,
    distractions: 2,
    quizCount: 1,
    latestQuiz: { score: 3, total: 4, percent: 75 },
    curatedEvaluationCount: 1,
    latestCuratedEvaluation: {
      lessonId: "math-7-ratios-meaning",
      score: 3,
      total: 4,
      percent: 75,
    },
  });
});

test("daily progress is empty when no recorded session ended today", () => {
  const today = new Date(2026, 10, 4, 16).getTime();
  const yesterday = recordedSession({ id: "yesterday", minutes: 25, ended: new Date(2026, 10, 3, 16).getTime() });

  assert.deepEqual(dailyStudySummary([yesterday], today), {
    sessionCount: 0,
    focusedSeconds: 0,
    plannedBreakSeconds: 0,
    actualBreakSeconds: 0,
    awaySeconds: 0,
    distractions: 0,
    quizCount: 0,
    latestQuiz: null,
    curatedEvaluationCount: 0,
    latestCuratedEvaluation: null,
  });
});

test("difficulty stays at the curated default until three evaluations and ten concept-scoped answers exist", () => {
  const progress = learningProgress([
    assessment("eval-1", course.conceptId, 4),
    assessment("eval-2", course.conceptId, 4),
    assessment("other-1", "unrelated-concept", 4),
  ]);

  assert.deepEqual(difficultySuggestion(progress, course.conceptId), {
    kind: "curated-default",
    completedEvaluations: 2,
    scoredAnswers: 8,
    correctAnswers: 8,
    correctRate: 1,
  });
});

test("difficulty suggests one step up only after enough strong concept-scoped answers", () => {
  const progress = learningProgress([
    assessment("eval-1", course.conceptId, 4),
    assessment("eval-2", course.conceptId, 3),
    assessment("eval-3", course.conceptId, 4),
    assessment("other-1", "unrelated-concept", 0),
    { ...assessment("stale-eval", course.conceptId, 0), lessonVersion: 7 },
  ]);

  assert.deepEqual(difficultySuggestion(progress, course.conceptId), {
    kind: "step-up",
    completedEvaluations: 3,
    scoredAnswers: 12,
    correctAnswers: 11,
    correctRate: 11 / 12,
  });
});

test("difficulty recommends worked review at or below fifty percent and staying put in the middle", () => {
  const weak = learningProgress([
    assessment("eval-1", course.conceptId, 1, 4, course.lessons[0].id),
    assessment("eval-2", course.conceptId, 2, 4, course.lessons[1].id),
    assessment("eval-3", course.conceptId, 2, 4, course.lessons[2].id),
  ]);
  const steady = learningProgress([
    assessment("eval-1", course.conceptId, 3),
    assessment("eval-2", course.conceptId, 2),
    assessment("eval-3", course.conceptId, 3),
  ]);

  assert.equal(difficultySuggestion(weak, course.conceptId).kind, "worked-review");
  assert.equal(workedReviewLesson(weak, course.conceptId)?.id, course.lessons[0].id);
  assert.equal(difficultySuggestion(steady, course.conceptId).kind, "stay");
});

test("duration uses a same-subject median of the latest three completed valid focus sessions", () => {
  const earlyEnded = {
    ...recordedSession({ id: "legacy-early", minutes: 24, ended: 7 }),
    started: -24 * 60 * 1000,
    ended: 7,
    target: 25 * 60,
  };
  delete earlyEnded.effectiveMetrics;
  const invalidBreakPlan = {
    ...recordedSession({ id: "legacy-invalid-break", minutes: 24, ended: 8 }),
    started: -30 * 60 * 1000,
    ended: 8,
    target: 25 * 60,
    breakPlan: { count: 1, seconds: 30 },
  };
  delete invalidBreakPlan.effectiveMetrics;
  const sessions = [
    recordedSession({ id: "old", minutes: 5, ended: 1 }),
    recordedSession({ id: "latest", minutes: 17, ended: 4 }),
    recordedSession({ id: "middle", minutes: 13, ended: 3 }),
    recordedSession({ id: "wrong-subject", topic: "biology", minutes: 25, ended: 5 }),
    recordedSession({ id: "earlier", minutes: 6, ended: 2 }),
    recordedSession({ id: "not-complete", minutes: 25, ended: 6, completed: false }),
    earlyEnded,
    invalidBreakPlan,
  ];

  assert.deepEqual(durationSuggestion(sessions, "mathematics", 6), {
    minutes: 15,
    source: "recent-sessions",
    sampleCount: 3,
    medianFocusedMinutes: 13,
  });
});

test("duration uses the curated estimate before the history threshold and stays within five to twenty-five minutes", () => {
  const short = [
    recordedSession({ id: "one", minutes: 2, ended: 2 }),
    recordedSession({ id: "two", minutes: 3, ended: 3 }),
  ];
  const long = [
    recordedSession({ id: "one", minutes: 28, ended: 1 }),
    recordedSession({ id: "two", minutes: 32, ended: 2 }),
    recordedSession({ id: "three", minutes: 35, ended: 3 }),
  ];

  assert.deepEqual(durationSuggestion(short, "mathematics", 7), {
    minutes: 7,
    source: "curated-estimate",
    sampleCount: 2,
    medianFocusedMinutes: null,
  });
  assert.equal(durationSuggestion(short, "mathematics", 1).minutes, 5);
  assert.equal(durationSuggestion(long, "mathematics", 7).minutes, 25);
});

test("learners can override a suggested duration while the saved suggestion remains bounded", () => {
  const suggestion = durationSuggestion([], "mathematics", 20);

  assert.equal(chooseDuration(suggestion, 15), 15);
  assert.equal(chooseDuration(suggestion, 27), 25);
  assert.equal(chooseDuration(suggestion, undefined), 20);
});
