import test from "node:test";
import assert from "node:assert/strict";
import { studyStageStatus } from "../src/adventure/focus.ts";
import { breakWindows, totalDurationSeconds } from "../backend/src/adventure/domain.ts";

const started = 1_800_000_000_000;

test("a 15-minute study with one 5-minute break has two study stages", () => {
  const trip = { started, target: 15 * 60, breakPlan: { count: 1, seconds: 5 * 60 } };
  const [rest] = breakWindows(trip.started, trip.target, trip.breakPlan);
  const deadline = started + totalDurationSeconds(trip.target, trip.breakPlan) * 1000;

  assert.deepEqual(studyStageStatus(trip, started), {
    index: 0,
    count: 2,
    startedAt: started,
    endsAt: rest.start,
    remainingSeconds: 450,
  });
  assert.equal(studyStageStatus(trip, rest.start - 1000).index, 0);
  assert.equal(studyStageStatus(trip, rest.start), null);
  assert.equal(studyStageStatus(trip, rest.start + 1000), null);
  assert.deepEqual(studyStageStatus(trip, rest.end), {
    index: 1,
    count: 2,
    startedAt: rest.end,
    endsAt: deadline,
    remainingSeconds: 450,
  });
  assert.deepEqual(studyStageStatus(trip, deadline), {
    index: 1,
    count: 2,
    startedAt: rest.end,
    endsAt: deadline,
    remainingSeconds: 0,
  });
});

test("multiple rests split study stages and exact boundaries skip break time", () => {
  const trip = { started, target: 50 * 60, breakPlan: { count: 2, seconds: 5 * 60 } };
  const rests = breakWindows(trip.started, trip.target, trip.breakPlan);
  const deadline = started + totalDurationSeconds(trip.target, trip.breakPlan) * 1000;

  assert.equal(studyStageStatus(trip, started).count, 3);
  assert.equal(studyStageStatus(trip, rests[0].start), null);
  assert.equal(studyStageStatus(trip, rests[0].end).index, 1);
  assert.equal(studyStageStatus(trip, rests[1].start), null);
  assert.equal(studyStageStatus(trip, rests[1].end).index, 2);
  assert.equal(studyStageStatus(trip, deadline).remainingSeconds, 0);
});

test("legacy trips and an explicit zero-break plan have one stage", () => {
  for (const trip of [
    { started, target: 900 },
    { started, target: 900, breakPlan: { count: 0, seconds: 300 } },
  ]) {
    const status = studyStageStatus(trip, started + 10_000);
    assert.deepEqual(status, {
      index: 0,
      count: 1,
      startedAt: started,
      endsAt: started + 900_000,
      remainingSeconds: 890,
    });
  }
});

test("stage status recomputes after reload-style time jumps and clamps the deadline", () => {
  const trip = { started, target: 900, breakPlan: { count: 1, seconds: 300 } };
  const [rest] = breakWindows(trip.started, trip.target, trip.breakPlan);
  const deadline = started + totalDurationSeconds(trip.target, trip.breakPlan) * 1000;

  assert.equal(studyStageStatus(trip, rest.end + 60_000).index, 1);
  assert.equal(studyStageStatus(trip, deadline + 3_600_000).remainingSeconds, 0);
  assert.deepEqual(studyStageStatus(trip, started - 60_000), {
    index: 0,
    count: 2,
    startedAt: started,
    endsAt: rest.start,
    remainingSeconds: 450,
  });
});
