import assert from "node:assert/strict";
import test from "node:test";
import {
  canShowStudyOnboarding,
  completeStudyOnboardingRetrievalChoice,
  createStudyOnboardingProgress,
  isValidStudyOnboardingProgress,
  reopenStudyOnboardingFromDraft,
  reduceStudyOnboardingProgress,
  syncStudySurveyWithCurrentDraft,
} from "../src/adventure/studyOnboardingModel.ts";

test("a first-use survey starts with editable manual-study defaults and optional level/confidence", () => {
  const progress = createStudyOnboardingProgress();

  assert.equal(progress.version, 1);
  assert.equal(progress.phase, "survey");
  assert.equal(progress.surveyStep, 0);
  assert.deepEqual(progress.survey, {
    goal: "",
    topicId: "biology",
    topicLabel: "Sinh học",
    preferredMinutes: 25,
    level: "",
    confidence: null,
  });
});

test("survey cannot advance past missing required goal/topic/time but optional questions can stay blank", () => {
  let progress = createStudyOnboardingProgress();
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  assert.equal(progress.surveyStep, 0);

  progress = reduceStudyOnboardingProgress(progress, {
    type: "survey/change",
    changes: { goal: "Ôn phản ứng hóa học", topicId: "chemistry", topicLabel: "Hóa học" },
  });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  assert.equal(progress.surveyStep, 1);

  progress = reduceStudyOnboardingProgress(progress, {
    type: "survey/change",
    changes: { preferredMinutes: 240, level: "Tự học", confidence: null },
  });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  assert.equal(progress.phase, "tutorial");
  assert.equal(progress.survey.preferredMinutes, 240);
  assert.equal(progress.survey.level, "Tự học");
  assert.equal(progress.survey.confidence, null);
});

test("invalid duration stays visible without resetting survey answers or current step", () => {
  let progress = createStudyOnboardingProgress({
    goal: "Ôn phản ứng hóa học",
    topicId: "chemistry",
    topicLabel: "Hóa học",
  });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  assert.equal(progress.surveyStep, 1);

  progress = reduceStudyOnboardingProgress(progress, {
    type: "survey/change",
    changes: { preferredMinutes: null },
  });
  assert.equal(progress.survey.preferredMinutes, null);
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  assert.equal(progress.phase, "survey");
  assert.equal(progress.surveyStep, 1);
  assert.equal(progress.survey.goal, "Ôn phản ứng hóa học");
  assert.equal(progress.survey.topicId, "chemistry");

  progress = reduceStudyOnboardingProgress(progress, {
    type: "survey/change",
    changes: { preferredMinutes: 45 },
  });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  assert.equal(progress.phase, "tutorial");
  assert.equal(progress.survey.goal, "Ôn phản ứng hóa học");
});

test("persisted onboarding rejects coerced phase and step types", () => {
  const progress = createStudyOnboardingProgress();

  assert.equal(isValidStudyOnboardingProgress({ ...progress, phase: 1 }), false);
  assert.equal(isValidStudyOnboardingProgress({ ...progress, tutorialStep: "0" }), false);
  assert.equal(isValidStudyOnboardingProgress({ ...progress, surveyStep: "0" }), false);
});

test("tutorial advances only after using its matching real control and records an explicit no-material choice", () => {
  let progress = createStudyOnboardingProgress({
    goal: "Ôn phản ứng hóa học",
    topicId: "chemistry",
    topicLabel: "Hóa học",
  });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  assert.equal(progress.phase, "tutorial");

  progress = reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "source", choice: "none" });
  assert.equal(progress.tutorialStep, 0, "future tutorial controls cannot skip the current action");
  progress = reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "goal" });
  assert.equal(progress.tutorialStep, 1);
  progress = reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "source", choice: "none" });
  assert.equal(progress.tutorialStep, 2);
  assert.equal(progress.tutorial.sourceChoice, "none");
  progress = reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "duration" });
  assert.equal(progress.tutorialStep, 3);
  progress = reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "retrieval" });
  assert.equal(progress.phase, "complete");
});

test("changing a local retrieval preference completes only the active retrieval tutorial step", () => {
  let progress = createStudyOnboardingProgress({ goal: "Ôn tế bào" });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  progress = reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "goal" });
  progress = reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "source", choice: "none" });
  progress = reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "duration" });

  const completed = completeStudyOnboardingRetrievalChoice(progress);
  assert.equal(completed.phase, "complete");
  const wrongStep = { ...progress, tutorialStep: 2 };
  assert.equal(completeStudyOnboardingRetrievalChoice(wrongStep), wrongStep);
});

test("tutorial progress pauses, resumes, and can be reopened without losing survey answers", () => {
  let progress = createStudyOnboardingProgress({
    goal: "Ôn phản ứng hóa học",
    topicId: "chemistry",
    topicLabel: "Hóa học",
  });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  progress = reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "goal" });
  progress = reduceStudyOnboardingProgress(progress, { type: "onboarding/pause" });
  assert.equal(progress.phase, "paused");
  progress = reduceStudyOnboardingProgress(progress, { type: "onboarding/resume" });
  assert.equal(progress.phase, "tutorial");
  assert.equal(progress.tutorialStep, 1);

  progress = reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "source", choice: "notes" });
  progress = reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "duration" });
  progress = reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "retrieval" });
  progress = reduceStudyOnboardingProgress(progress, { type: "onboarding/reopen" });
  assert.equal(progress.phase, "tutorial");
  assert.equal(progress.tutorialStep, 0);
  assert.equal(progress.survey.goal, "Ôn phản ứng hóa học");
});

test("reopening guidance starts from the latest editable draft instead of stale survey values", () => {
  let progress = createStudyOnboardingProgress({
    goal: "Mục tiêu khảo sát cũ",
    topicId: "biology",
    topicLabel: "Sinh học",
    preferredMinutes: 25,
  });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  progress = reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "goal" });
  progress = reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "source", choice: "none" });
  progress = reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "duration" });
  progress = reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "retrieval" });
  assert.equal(progress.phase, "complete");

  const reopened = reopenStudyOnboardingFromDraft(progress, {
    goal: "Mục tiêu mới trong buổi học",
    topicId: "chemistry",
    topicLabel: "Hóa học",
    preferredMinutes: 90,
    level: "Lớp 10",
    confidence: 3,
  });

  assert.equal(reopened.phase, "tutorial");
  assert.equal(reopened.tutorialStep, 0);
  assert.equal(reopened.survey.goal, "Mục tiêu mới trong buổi học");
  assert.equal(reopened.survey.topicId, "chemistry");
  assert.equal(reopened.survey.preferredMinutes, 90);
  assert.equal(reopened.survey.level, "Lớp 10");
  assert.equal(reopened.survey.confidence, 3);
});

test("tutorial acknowledgements save the current goal and duration instead of stale survey answers", () => {
  let progress = createStudyOnboardingProgress({
    goal: "A",
    topicId: "biology",
    topicLabel: "Sinh học",
    preferredMinutes: 25,
  });
  progress = reduceStudyOnboardingProgress(progress, {
    type: "survey/change",
    changes: { goal: "Ôn tế bào A", topicId: "biology", topicLabel: "Sinh học" },
  });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/change", changes: { preferredMinutes: 25 } });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });

  const currentDraft = {
    goal: "Ôn tế bào B",
    topicId: "chemistry",
    topicLabel: "Hóa học",
    preferredMinutes: 90,
    level: "Lớp 9",
    confidence: 3,
  };
  const live = { ...progress, survey: syncStudySurveyWithCurrentDraft(progress.survey, currentDraft, 90) };
  const advanced = reduceStudyOnboardingProgress(live, { type: "tutorial/used", control: "goal" });
  const restored = JSON.parse(JSON.stringify(advanced));

  assert.equal(restored.survey.goal, "Ôn tế bào B");
  assert.equal(restored.survey.topicId, "chemistry");
  assert.equal(restored.survey.preferredMinutes, 90);
  assert.equal(restored.survey.level, "Lớp 9");
  assert.equal(isValidStudyOnboardingProgress(restored), true);
});

test("a stale tutorial cannot acknowledge a duration after the current input becomes invalid", () => {
  let progress = createStudyOnboardingProgress({
    goal: "Ôn tế bào",
    preferredMinutes: 25,
  });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/change", changes: { preferredMinutes: 25 } });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  progress = reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "goal" });
  progress = reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "source", choice: "none" });

  const currentDraft = { ...progress.survey, preferredMinutes: 25 };
  const live = { ...progress, survey: syncStudySurveyWithCurrentDraft(progress.survey, currentDraft, NaN) };
  const unchanged = reduceStudyOnboardingProgress(live, { type: "tutorial/used", control: "duration" });

  assert.equal(unchanged.tutorialStep, 2);
  assert.equal(unchanged.survey.preferredMinutes, null);
});

test("an active session has priority over first-use onboarding", () => {
  const progress = createStudyOnboardingProgress();

  assert.equal(canShowStudyOnboarding(false, null, progress), false);
  assert.equal(canShowStudyOnboarding(true, { id: "active-session" }, progress), false);
  assert.equal(canShowStudyOnboarding(true, null, progress), true);
  assert.equal(canShowStudyOnboarding(true, null, { ...progress, phase: "complete" }), false);
});
