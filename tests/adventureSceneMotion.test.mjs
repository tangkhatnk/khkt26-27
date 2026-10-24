import assert from "node:assert/strict";
import test from "node:test";
import {
  sceneMotionCanInterpolate,
  sceneMotionDistanceGapCanInterpolate,
  sceneMotionForStudyElapsed,
  sceneMotionInterpolationOffsets,
  sceneMotionInterpolationDurationMs,
  sceneWorldLayerOffsetPercent,
  sceneStationScreenX,
  sceneStationWorldX,
  sceneTrainLayout,
  sceneTrainScale,
  sceneViewBoxForZoom,
  sceneWorldSpeedForSchedule,
} from "../src/adventure/sceneMotion.ts";

test("the engine remains centered while the train fits every supported zoom", () => {
  assert.equal(sceneViewBoxForZoom(1.5), "150 70 600 280");

  for (let count = 1; count <= 6; count += 1) {
    const engineX = 450;
    const train = sceneTrainLayout(engineX);
    assert.equal(train.travelX, engineX);
    assert.equal(train.travelShift, 0);
    assert.equal(train.restShift, 0);
    assert.equal(train.arrivalShift, 0);

    for (const zoom of [1, 1.25, 1.5]) {
      const [left, , width] = sceneViewBoxForZoom(zoom).split(" ").map(Number);
      const scale = sceneTrainScale(count, engineX, left);
      const right = left + width;
      const leftExtent = count * 64 + 34;
      assert.equal((left + right) / 2, 450);
      assert.ok(engineX - leftExtent * scale >= left - 0.001);
      assert.ok(engineX + 49 <= right);
    }
  }
});

test("schedule chooses one shared world speed that keeps adjacent footprints apart", () => {
  assert.equal(sceneWorldSpeedForSchedule(120, [60]), 50 / 3);
  assert.equal(sceneWorldSpeedForSchedule(11, [5.5]), 40);
  assert.equal(sceneWorldSpeedForSchedule(11, [5.5, 5.5]), 40);
  assert.equal(sceneWorldSpeedForSchedule(0, []), 50 / 3);
});

test("start, rest, and terminal footprints share terrain displacement", () => {
  const speed = 50 / 3;
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.0001);

  assert.equal(sceneStationWorldX(0, speed), 450);
  near(sceneStationScreenX(0, 2, speed), 416.6666666667);

  // Thirty-six study seconds before the rest anchor, its station is 600 units ahead.
  assert.equal(sceneStationScreenX(60, 24, speed), 1050);
  near(sceneStationScreenX(60, 60, speed), 450);
  near(sceneStationScreenX(60, 61, speed), 433.3333333333);

  // The terminal uses the same world anchor and remains centered at the target.
  assert.equal(sceneStationScreenX(120, 84, speed), 1050);
  near(sceneStationScreenX(120, 120, speed), 450);
});

test("periodic terrain reindexes without reversing its shared camera movement", () => {
  const speed = 50 / 3;
  const beforeWrap = sceneMotionForStudyElapsed(53.99, speed);
  const afterWrap = sceneMotionForStudyElapsed(54.01, speed);

  assert.ok(Math.abs(beforeWrap.distance - 899.8333333333334) < 0.0001);
  assert.equal(beforeWrap.cameraOffset, -beforeWrap.distance);
  assert.equal(beforeWrap.periodicOrigin, 0);
  assert.ok(Math.abs(afterWrap.distance - 900.1666666666667) < 0.0001);
  assert.equal(afterWrap.cameraOffset, -afterWrap.distance);
  assert.equal(afterWrap.periodicOrigin, 900);

  const wrappedDelta = ((afterWrap.periodicOffset - beforeWrap.periodicOffset + 450) % 900 + 900) % 900 - 450;
  assert.ok(Math.abs(wrappedDelta + 0.3333333333333) < 0.0001);
});

test("periodic wrap interpolation uses both endpoints in the current tile frame", () => {
  const speed = 50 / 3;
  const beforeWrap = sceneMotionForStudyElapsed(53.99, speed);
  const afterWrap = sceneMotionForStudyElapsed(54.01, speed);
  const offsets = sceneMotionInterpolationOffsets(
    beforeWrap.distance,
    afterWrap.distance,
    afterWrap.periodicOrigin,
  );

  assert.ok(Math.abs(offsets.fromOffset - 0.1666666666666) < 0.0001);
  assert.ok(Math.abs(offsets.toOffset + 0.1666666666666) < 0.0001);
  assert.ok(Math.abs((offsets.toOffset - offsets.fromOffset) + (afterWrap.distance - beforeWrap.distance)) < 0.0001);
  const stationWorldX = 1200;
  const beforeScreenX = stationWorldX - beforeWrap.distance;
  const rebasedStartScreenX = stationWorldX - afterWrap.periodicOrigin + offsets.fromOffset;
  const rebasedEndScreenX = stationWorldX - afterWrap.periodicOrigin + offsets.toOffset;
  assert.ok(Math.abs(rebasedStartScreenX - beforeScreenX) < 0.0001);
  assert.ok(Math.abs(rebasedEndScreenX - (stationWorldX - afterWrap.distance)) < 0.0001);
  assert.ok(Math.abs(sceneMotionInterpolationDurationMs(54.01, 53.99) - 20) < 1e-9);
  assert.equal(sceneMotionDistanceGapCanInterpolate(beforeWrap.distance, afterWrap.distance), true);
  assert.equal(sceneMotionDistanceGapCanInterpolate(0, 900), false);
  assert.equal(sceneMotionDistanceGapCanInterpolate(901, 900), false);
});

test("compositor world offsets preserve world-unit travel at each zoom", () => {
  assert.equal(sceneWorldLayerOffsetPercent(-900, 900), -100);
  assert.equal(sceneWorldLayerOffsetPercent(-900, 600), -150);
  assert.equal(sceneWorldLayerOffsetPercent(0, 900), 0);
  assert.equal(sceneWorldLayerOffsetPercent(-900, 0), 0);
});

test("world interpolation is suppressed on mount and after motion resumes", () => {
  assert.equal(sceneMotionCanInterpolate(true, false, 1, 0), false);
  assert.equal(sceneMotionCanInterpolate(false, true, 1, 0), false);
  assert.equal(sceneMotionCanInterpolate(true, true, 1, 0), true);
});

test("world interpolation snaps across clock jumps and backward samples", () => {
  assert.equal(sceneMotionCanInterpolate(true, true, 42, 40), true);
  assert.equal(sceneMotionCanInterpolate(true, true, 42.01, 40), false);
  assert.equal(sceneMotionCanInterpolate(true, true, 39, 40), false);
  assert.equal(sceneMotionCanInterpolate(true, true, 60, 60), true);
  assert.equal(sceneMotionInterpolationDurationMs(42, 40), 2000);
  assert.equal(sceneMotionInterpolationDurationMs(60, 60), 0);
  assert.equal(sceneMotionInterpolationDurationMs(39, 40), 0);
});
