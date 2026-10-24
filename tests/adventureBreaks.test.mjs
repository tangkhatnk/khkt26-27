import assert from 'node:assert/strict';
import test from 'node:test';
import {
  breakWindows,
  isValidBreakPlan,
  totalDurationSeconds,
} from '../backend/src/adventure/domain.ts';
import * as focus from '../src/adventure/focus.ts';

const trip = (overrides = {}) => ({
  id: 'break-trip', owner: 'guest', goal: 'Read biology', topic: 'biology', document: '',
  target: 600, breakPlan: { count: 1, seconds: 60 }, groupId: null,
  started: 1000, lastAt: 1000, segments: [], state: 'focus', reconnect: 0, distractions: 0,
  ...overrides,
});

test('break plans obey the count and duration bounds and preserve zero-break trips', () => {
  assert.equal(isValidBreakPlan({ count: 0, seconds: 300 }, 600), true);
  assert.equal(isValidBreakPlan({ count: 10, seconds: 60 }, 600), false);
  assert.equal(isValidBreakPlan({ count: 1, seconds: 59 }, 600), false);
  assert.equal(isValidBreakPlan({ count: 1, seconds: 1801 }, 600), false);
  assert.equal(totalDurationSeconds(600, { count: 0, seconds: 300 }), 600);
  assert.equal(totalDurationSeconds(600, { count: 2, seconds: 90 }), 780);
});

test('break windows are evenly spaced in study walltime and include prior rest duration', () => {
  assert.deepEqual(breakWindows(1000, 600, { count: 2, seconds: 60 }), [
    { index: 1, start: 201000, end: 261000 },
    { index: 2, start: 461000, end: 521000 },
  ]);
});

test('countdown excludes a scheduled break while focus XP excludes both break and away time', () => {
  const firstSlot = trip();
  const beforeBreak = focus.tick(firstSlot, 301000);
  assert.equal(focus.elapsedSeconds(beforeBreak, 301000), 300);
  assert.equal(focus.focused(beforeBreak), 300);

  const duringBreak = focus.tick(beforeBreak, 331000);
  assert.equal(focus.elapsedSeconds(duringBreak, 331000), 300);
  assert.equal(focus.focused(duringBreak), 300);
  assert.equal(focus.breakStatus(duringBreak, 331000)?.remainingSeconds, 30);
  assert.deepEqual(duringBreak.segments.at(-1), { start: 301000, end: 331000, kind: 'break' });

  const afterBreak = focus.tick(duringBreak, 371000);
  assert.equal(focus.elapsedSeconds(afterBreak, 371000), 310);
  assert.equal(focus.focused(afterBreak), 310);
  assert.equal(focus.sessionEndAt(afterBreak, 999999), 661000);
});

test('away time keeps consuming study budget but scheduled rest is not a distraction', () => {
  const away = focus.depart(trip(), 291000);
  assert.equal(away.distractions, 1);
  const overBreak = focus.tick(away, 381000);

  assert.deepEqual(overBreak.segments.map(({ kind, start, end }) => [kind, start, end]), [
    ['focus', 1000, 291000],
    ['distraction', 291000, 301000],
    ['break', 301000, 361000],
    ['distraction', 361000, 381000],
  ]);
  assert.equal(focus.elapsedSeconds(overBreak, 381000), 320);
  assert.equal(focus.focused(overBreak), 290);
  assert.equal(overBreak.distractions, 1);
});

test('leaving and returning inside a scheduled break does not count a distraction', () => {
  const duringBreak = focus.depart(trip(), 311000);
  assert.equal(duringBreak.state, 'away');
  assert.equal(duringBreak.distractions, 0);
  const returned = focus.returnFromBackground(duringBreak, 351000);

  assert.equal(returned.state, 'focus');
  assert.equal(returned.distractions, 0);
  assert.equal(focus.elapsedSeconds(returned, 351000), 300);
  assert.deepEqual(returned.segments.at(-1), { start: 301000, end: 351000, kind: 'break' });
});

test('a departure begun during a break is counted once if absence extends into study time after reload', () => {
  const departedDuringBreak = focus.depart(trip(), 311000);
  const persisted = focus.tick(departedDuringBreak, 351000);
  const restored = focus.restore(persisted, 371000);

  assert.equal(restored.distractions, 1);
  assert.equal(restored.state, 'away');
  assert.equal(focus.focused(restored), 300);
  assert.deepEqual(restored.segments.at(-1), { start: 361000, end: 371000, kind: 'distraction' });
});

test('finishing early during a scheduled break records only the elapsed rest', () => {
  const duringBreak = focus.tick(trip(), 331000);
  const earlyEnd = focus.sessionEndAt(duringBreak, 331000);

  assert.equal(earlyEnd, 331000);
  assert.equal(focus.elapsedSeconds(duringBreak, 331000), 300);
});
