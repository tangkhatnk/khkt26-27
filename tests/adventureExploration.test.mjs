import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudScaleAtProgress, explorationProgress, journeyExplorationFraction, revealedStationIndex, sceneryShouldMove } from '../src/adventure/exploration.ts';
import { mapGeometry, stopIndices } from '../src/adventure/mapGeometry.ts';

const journey = (values = {}) => ({ station: 0, remaining: 0, threshold: 100, ...values });

test('map exploration adds only valid focused draft seconds to durable journey progress', () => {
  assert.deepEqual(explorationProgress(journey(), 25, 60), {
    station: 0, fraction: 0.25, remainingSeconds: 25, thresholdSeconds: 100,
  });
  assert.equal(revealedStationIndex(journey({ remaining: 95 }), 10, 60), 1);
});

test('a single valid draft can reveal multiple stops and the whole route', () => {
  const progress = explorationProgress(journey({ station: 2, remaining: 50, threshold: 60 }), 80, 120);
  assert.deepEqual(progress, { station: 4, fraction: 1, remainingSeconds: 10, thresholdSeconds: 60 });
  assert.equal(revealedStationIndex(journey({ station: 4, remaining: 500 }), 999, 60), 4);
});

test('group thresholds use the journey threshold and draft time is capped by its target', () => {
  assert.deepEqual(explorationProgress(journey({ threshold: 5400, remaining: 0 }), 1800, 2400), {
    station: 0, fraction: 1 / 3, remainingSeconds: 1800, thresholdSeconds: 5400,
  });
  assert.deepEqual(explorationProgress(journey({ threshold: 100 }), 900, 25), {
    station: 0, fraction: 0.25, remainingSeconds: 25, thresholdSeconds: 100,
  });
});

test('the revealed train position follows the selected mountain or coast route', () => {
  const progress = explorationProgress(journey({ station: 2, remaining: 40, threshold: 100 }));
  const positionFor = (branch) => {
    const geometry = mapGeometry(branch);
    const distance = geometry.distances[stopIndices[progress.station]] +
      progress.fraction * (geometry.distances[stopIndices[progress.station + 1]] - geometry.distances[stopIndices[progress.station]]);
    const { x, y } = geometry.position(distance);
    return [x, y];
  };
  assert.notDeepEqual(positionFor('mountain'), positionFor('coast'));
  assert.deepEqual(mapGeometry('mountain').position(mapGeometry('mountain').total), { x: 965, y: 320, angle: 0 });
  assert.deepEqual(mapGeometry('coast').position(mapGeometry('coast').total), { x: 965, y: 320, angle: 0 });
});

test('invalid progress fields and away/non-finite drafts do not unlock unexplored map', () => {
  assert.deepEqual(explorationProgress(journey({ station: -5, remaining: Infinity, threshold: 0 }), Infinity, 0), {
    station: 0, fraction: 0, remainingSeconds: 0, thresholdSeconds: 1800,
  });
  assert.deepEqual(explorationProgress(journey({ station: 1, remaining: NaN, threshold: 60 }), -10, 60), {
    station: 1, fraction: 0, remainingSeconds: 0, thresholdSeconds: 60,
  });
});

test('focus exploration fraction includes durable journey progress and valid draft time', () => {
  assert.equal(journeyExplorationFraction(journey({ station: 1, remaining: 25 }), 25, 60), 0.375);
  assert.equal(journeyExplorationFraction(journey({ station: 2, remaining: 50, threshold: 60 }), 80, 120), 1);
  assert.equal(journeyExplorationFraction(journey(), -5, 60), 0);
});

test('clouds stay opaque until approach, shrink at the frontier, and never reappear', () => {
  assert.equal(cloudScaleAtProgress(0.2, 0.5, 0.2), 1);
  assert.ok(Math.abs(cloudScaleAtProgress(0.4, 0.5, 0.2) - 0.5) < 1e-12);
  assert.equal(cloudScaleAtProgress(0.5, 0.5, 0.2), 0);
  assert.equal(cloudScaleAtProgress(0.9, 0.5, 0.2), 0);
  assert.equal(cloudScaleAtProgress(Number.NaN, 0.5, 0.2), 1);
});

test('scheduled breaks keep the train scene still while focus and reconnect animate', () => {
  assert.equal(sceneryShouldMove(undefined), true);
  assert.equal(sceneryShouldMove('focus'), true);
  assert.equal(sceneryShouldMove('reconnecting'), true);
  assert.equal(sceneryShouldMove('break'), false);
  assert.equal(sceneryShouldMove('away'), false);
  assert.equal(sceneryShouldMove('paused'), false);
});
