import assert from "node:assert/strict";
import test from "node:test";
import {
  beginLessonRun,
  completeLessonRun,
  createLearningPathProgress,
  isValidLearningPathProgress,
  lessonStates,
  normalizeLearningPathProgress,
  nextAvailableLesson,
  setLessonRunPhase,
} from "../src/adventure/learningPath.ts";
import { CURATED_COURSES } from "../src/adventure/curatedCurriculum.ts";

test("released lessons contain offline recall questions with answer explanations across grades and subjects", () => {
  const grades = new Set(CURATED_COURSES.map((course) => course.grade));
  const subjects = new Set(CURATED_COURSES.map((course) => course.subjectId));

  assert.ok(grades.size >= 2);
  assert.ok(subjects.size >= 2);
  assert.ok(CURATED_COURSES.every((course) => course.lessons.length > 0));
  for (const course of CURATED_COURSES) {
    assert.ok(course.conceptId.length > 0);
    const answerPositions = new Set();
    for (const lesson of course.lessons) {
      assert.ok(lesson.content.trim().length >= 40);
      assert.ok(lesson.questions.length >= 2);
      for (const question of lesson.questions) {
        assert.ok(question.options.length >= 2);
        assert.ok(question.correctIndex >= 0 && question.correctIndex < question.options.length);
        assert.ok(question.explanation.trim().length >= 12);
        answerPositions.add(question.correctIndex);
      }
    }
    assert.ok(answerPositions.size > 1, `${course.id} should not reward repeating one answer position`);
  }
});

test("a learner can only start the next unlocked lesson and progress uses actual course length", () => {
  const course = CURATED_COURSES.find((item) => item.id === "math-7-ratios");
  assert.ok(course);
  const progress = createLearningPathProgress(course.id);

  assert.equal(nextAvailableLesson(course, progress)?.id, "math-7-ratios-meaning");
  assert.deepEqual(lessonStates(course, progress).map((item) => item.status), ["available", "locked", "locked"]);

  const started = beginLessonRun(progress, course, course.lessons[0].id, "draft-session-1");
  assert.equal(started.activeRun?.phase, "lesson");
  assert.equal(lessonStates(course, started)[0].status, "current");
  assert.equal(lessonStates(course, started)[1].status, "locked");
  assert.equal(beginLessonRun(started, course, course.lessons[2].id, "draft-session-2"), null);
});

test("an unfinished focus is not counted as a lesson until its offline evaluation is submitted", () => {
  const course = CURATED_COURSES.find((item) => item.id === "math-7-ratios");
  assert.ok(course);
  let progress = createLearningPathProgress(course.id);
  progress = beginLessonRun(progress, course, course.lessons[0].id, "lesson-session-1");
  progress = setLessonRunPhase(progress, "lesson-session-1", "ticket");
  progress = setLessonRunPhase(progress, "lesson-session-1", "focus");

  assert.equal(lessonStates(course, progress)[0].status, "current");
  assert.equal(progress.completed.length, 0);
  assert.throws(() => completeLessonRun(progress, "lesson-session-1", 1, 2, 1_800_000_000_000), /review/u);

  progress = setLessonRunPhase(progress, "lesson-session-1", "review");
  progress = completeLessonRun(progress, "lesson-session-1", 1, 2, 1_800_000_000_000, [
    { questionId: "q1", conceptId: "ratios-proportions", correct: true },
    { questionId: "q2", conceptId: "ratios-proportions", correct: false },
  ]);

  assert.equal(progress.activeRun, undefined);
  assert.deepEqual(progress.completed[0], {
    lessonId: "math-7-ratios-meaning",
    lessonVersion: 1,
    sessionId: "lesson-session-1",
    score: 1,
    total: 2,
    completedAt: 1_800_000_000_000,
    assessedAnswers: [
      { questionId: "q1", conceptId: "ratios-proportions", correct: true },
      { questionId: "q2", conceptId: "ratios-proportions", correct: false },
    ],
  });
  assert.deepEqual(lessonStates(course, progress).map((item) => item.status), ["completed", "available", "locked"]);

  const replay = beginLessonRun(progress, course, course.lessons[0].id, "lesson-session-replay", true);
  assert.ok(replay);
  assert.equal(lessonStates(course, replay)[0].status, "current");
  assert.equal(normalizeLearningPathProgress(replay).activeRun?.sessionId, "lesson-session-replay");
});

test("persisted path progress validates known lessons and stable session ownership", () => {
  const course = CURATED_COURSES.find((item) => item.id === "math-7-ratios");
  assert.ok(course);
  const progress = beginLessonRun(
    createLearningPathProgress(course.id), course, course.lessons[0].id, "lesson-session-1",
  );

  assert.equal(isValidLearningPathProgress(progress), true);
  assert.equal(isValidLearningPathProgress({ ...progress, activeRun: { ...progress.activeRun, sessionId: "" } }), false);
});

test("catalog updates preserve older completed lessons while clearing only a stale active lesson", () => {
  const legacy = {
    schemaVersion: 1,
    selectedCourseId: "removed-course",
    completed: [
      { lessonId: "retired-lesson", lessonVersion: 1, sessionId: "old-session", score: 1, total: 2, completedAt: 1 },
      { lessonId: "math-7-ratios-meaning", lessonVersion: 7, sessionId: "math-session", score: 2, total: 2, completedAt: 2 },
    ],
    activeRun: {
      courseId: "math-7-ratios", lessonId: "math-7-ratios-property", lessonVersion: 0,
      sessionId: "stale-session", phase: "focus",
    },
  };
  const migrated = normalizeLearningPathProgress(legacy);

  assert.equal(migrated.selectedCourseId, "math-7-ratios");
  assert.deepEqual(migrated.completed, legacy.completed.map((item) => ({ ...item, assessedAnswers: [] })));
  assert.equal(migrated.activeRun, undefined);
});

test("path progress keeps completion history when the catalog grows beyond the old fixed limit", () => {
  const course = CURATED_COURSES.find((item) => item.id === "math-7-ratios");
  assert.ok(course);
  const progress = createLearningPathProgress(course.id);
  progress.completed = Array.from({ length: 240 }, (_, index) => ({
    lessonId: `retired-${index}`,
    lessonVersion: 1,
    sessionId: `session-${index}`,
    score: 1,
    total: 2,
    completedAt: index + 1,
  }));

  assert.equal(normalizeLearningPathProgress(progress).completed.length, 240);
});
