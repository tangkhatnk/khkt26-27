import test from "node:test";
import assert from "node:assert/strict";
import {
  createQuickTripDraft,
  isValidPersonalStudyStartDuration,
  updateQuickTripDraft,
  updateQuickTripDuration,
} from "../src/adventure/quickTripDraft.ts";

test("home input writes each raw value immediately to the latest navigation draft", () => {
  const ref = { current: {
    goal: "",
    topic: "biology",
    minutes: 25,
    breakCount: 0,
    breakMinutes: 5,
  } };

  updateQuickTripDraft(ref, { goal: "  Sinh học tế bào" });
  updateQuickTripDraft(ref, { goal: "  Sinh học tế bào\nMàng và nhân" });
  updateQuickTripDraft(ref, { topic: "chemistry", minutes: 45 });

  assert.deepEqual(ref.current, {
    goal: "  Sinh học tế bào\nMàng và nhân",
    topic: "chemistry",
    minutes: 45,
    breakCount: 0,
    breakMinutes: 5,
  });
});

test("owner-local survey values hydrate the shared editable quick-session draft", () => {
  const ref = { current: createQuickTripDraft({
    goal: "Ôn phản ứng hóa học",
    topic: "chemistry",
    topicLabel: "Hóa học",
    minutes: 45,
    level: "Lớp 9",
    confidence: 2,
  }) };

  updateQuickTripDraft(ref, { goal: "Ôn lại phản ứng hóa học" });

  assert.deepEqual(ref.current, {
    goal: "Ôn lại phản ứng hóa học",
    topic: "chemistry",
    topicLabel: "Hóa học",
    minutes: 45,
    breakCount: 0,
    breakMinutes: 5,
    level: "Lớp 9",
    confidence: 2,
  });
});

test("duration edits keep raw invalid input visible while marking it ineligible to start", () => {
  for (const minutes of [NaN, 0, 1.5, 241]) {
    const ref = { current: createQuickTripDraft({ minutes: 45 }) };
    const result = updateQuickTripDuration(ref, minutes);

    assert.equal(Object.is(result.draft.minutes, minutes), true);
    assert.equal(result.canStart, false);
  }

  const ref = { current: createQuickTripDraft({ minutes: 45 }) };
  const result = updateQuickTripDuration(ref, 90);
  assert.equal(result.draft.minutes, 90);
  assert.equal(result.canStart, true);
});

test("fractional manual durations cannot start through an exercise skip prompt but legacy targets remain exact", () => {
  assert.equal(isValidPersonalStudyStartDuration(1.5, 90), false);
  assert.equal(isValidPersonalStudyStartDuration(241, 14_460), false);
  assert.equal(isValidPersonalStudyStartDuration(90 / 60, 90, 90), true);
  assert.equal(isValidPersonalStudyStartDuration(25, 1_500), true);
});
