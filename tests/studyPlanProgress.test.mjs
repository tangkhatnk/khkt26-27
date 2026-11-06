import assert from "node:assert/strict";
import test from "node:test";
import { qualifiesStudyPlanStepCompletion } from "../src/adventure/studyPlanProgress.ts";

const binding = { sessionId: "session-one", planId: "plan-one", stepId: "step-one" };
const evidence = {
  binding,
  sessionId: "session-one",
  activeSessionId: "session-one",
  tripOwner: "student-one",
  currentOwner: "student-one",
  sessionOwner: "student-one",
  groupId: null,
  started: 1_000,
  ended: 301_000,
  target: 300,
  focusedSeconds: 180,
};

test("a study step receipt requires its exact owner-bound solo session, schedule, and positive credit", () => {
  assert.equal(qualifiesStudyPlanStepCompletion(evidence), true);
  assert.equal(qualifiesStudyPlanStepCompletion({ ...evidence, focusedSeconds: 59.7 }), true);
  assert.equal(qualifiesStudyPlanStepCompletion({ ...evidence, sessionId: "other-session" }), false);
  assert.equal(qualifiesStudyPlanStepCompletion({ ...evidence, activeSessionId: "other-session" }), false);
  assert.equal(qualifiesStudyPlanStepCompletion({ ...evidence, tripOwner: "other-owner" }), false);
  assert.equal(qualifiesStudyPlanStepCompletion({ ...evidence, sessionOwner: "other-owner" }), false);
  assert.equal(qualifiesStudyPlanStepCompletion({ ...evidence, groupId: "group-one" }), false);
  assert.equal(qualifiesStudyPlanStepCompletion({ ...evidence, ended: 300_999 }), false);
  assert.equal(qualifiesStudyPlanStepCompletion({ ...evidence, focusedSeconds: 0 }), false);
  assert.equal(qualifiesStudyPlanStepCompletion({ ...evidence, focusedSeconds: -1 }), false);
  assert.equal(qualifiesStudyPlanStepCompletion({ ...evidence, focusedSeconds: Number.POSITIVE_INFINITY }), false);
  assert.equal(qualifiesStudyPlanStepCompletion({ ...evidence, focusedSeconds: Number.NaN }), false);
  assert.equal(qualifiesStudyPlanStepCompletion({ ...evidence, breakPlan: { count: -1, seconds: 300 } }), false);
  assert.equal(qualifiesStudyPlanStepCompletion({ ...evidence, binding: null }), false);
});
