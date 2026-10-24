import assert from 'node:assert/strict';
import test from 'node:test';
import { elapsedSeconds, focused, tick } from '../src/adventure/focus.ts';

test('planned break time is excluded from the study countdown without pausing away time', () => {
  const trip = {
    id: 'break-trip', owner: 'guest', goal: 'Read biology', topic: 'biology', document: '',
    target: 600, breakPlan: { count: 1, seconds: 60 }, groupId: null,
    started: 1000, lastAt: 1000, segments: [], state: 'focus', reconnect: 0, distractions: 0,
  };
  const duringBreak = tick(trip, 331000);

  assert.equal(elapsedSeconds(duringBreak, 331000), 300);
  assert.equal(focused(duringBreak), 300);
});
