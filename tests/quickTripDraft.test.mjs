import test from "node:test";
import assert from "node:assert/strict";
import { updateQuickTripDraft } from "../src/adventure/quickTripDraft.ts";

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
