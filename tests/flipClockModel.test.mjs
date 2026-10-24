import assert from "node:assert/strict";
import test from "node:test";
import * as flipClockModel from "../src/adventure/flipClockModel.ts";

const { advanceFlipDigit, finishFlipDigit, splitClockTime } = flipClockModel;

test("clock parts preserve long minute values and keep seconds in two digits", () => {
  assert.deepEqual(splitClockTime(255 * 60 + 5), {
    minuteDigits: ["2", "5", "5"],
    secondDigits: ["0", "5"],
    minutes: 255,
    seconds: 5,
    duration: "PT15305S",
    spoken: "255 phút 5 giây",
  });
});

test("clock parts clamp invalid and negative values to zero", () => {
  for (const seconds of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(splitClockTime(seconds), {
      minuteDigits: ["0", "0"],
      secondDigits: ["0", "0"],
      minutes: 0,
      seconds: 0,
      duration: "PT0S",
      spoken: "0 phút 0 giây",
    });
  }
});

test("a mechanical flip shows the next upper face, prior lower face, then sequential flaps", () => {
  const initial = { current: "8", previous: null, phase: "idle", transitionId: 0 };
  const next = advanceFlipDigit(initial, "7", true);
  assert.equal(typeof flipClockModel.flipDigitFaces, "function");
  assert.deepEqual(flipClockModel.flipDigitFaces(next), {
    upper: "7", lower: "8", topFlap: "8", bottomFlap: null,
  });

  const bottom = flipClockModel.finishFlipTop(next, next.transitionId);
  assert.deepEqual(flipClockModel.flipDigitFaces(bottom), {
    upper: "7", lower: "8", topFlap: null, bottomFlap: "7",
  });

  const settled = finishFlipDigit(bottom, bottom.transitionId);
  assert.deepEqual(flipClockModel.flipDigitFaces(settled), {
    upper: "7", lower: "7", topFlap: null, bottomFlap: null,
  });
});

test("fast changes that cycle back to a prior digit ignore stale flap finishes", () => {
  const first = advanceFlipDigit({ current: "8", previous: null, phase: "idle", transitionId: 0 }, "7", true);
  const firstBottom = flipClockModel.finishFlipTop(first, first.transitionId);
  const newer = advanceFlipDigit(firstBottom, "8", true);

  assert.equal(newer.transitionId, first.transitionId + 1);
  assert.deepEqual(flipClockModel.finishFlipTop(newer, first.transitionId), newer);
  assert.deepEqual(finishFlipDigit(newer, first.transitionId), newer);
  assert.deepEqual(flipClockModel.flipDigitFaces(newer), {
    upper: "8", lower: "7", topFlap: "7", bottomFlap: null,
  });
});

test("turning motion off settles both faces and invalidates pending animation events", () => {
  const transitioning = advanceFlipDigit({ current: "4", previous: null, phase: "idle", transitionId: 0 }, "5", true);
  const settled = advanceFlipDigit(transitioning, "5", false);

  assert.equal(settled.previous, null);
  assert.equal(settled.phase, "idle");
  assert.equal(settled.transitionId, transitioning.transitionId + 1);
  assert.deepEqual(finishFlipDigit(settled, transitioning.transitionId), settled);
  assert.deepEqual(flipClockModel.flipDigitFaces(settled), {
    upper: "5", lower: "5", topFlap: null, bottomFlap: null,
  });
});

test("steady digits keep the same settled face state without restarting a flip", () => {
  const stable = { current: "3", previous: null, phase: "idle", transitionId: 9 };
  const next = advanceFlipDigit(stable, "3", true);

  assert.strictEqual(next, stable);
  assert.deepEqual(flipClockModel.flipDigitFaces(next), {
    upper: "3", lower: "3", topFlap: null, bottomFlap: null,
  });
});
