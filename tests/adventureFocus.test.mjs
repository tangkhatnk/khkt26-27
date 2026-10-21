import test from 'node:test';
import assert from 'node:assert/strict';
import * as focus from '../src/adventure/focus.ts';

const { tick, depart, returnFromBackground, leaveFocusView, restore, focused, elapsedSeconds, sessionEndAt } = focus;
const trip = (target = 600) => ({
  id: 'test', owner: 'guest', goal: 'Read biology', topic: 'biology', document: '',
  target, groupId: null, started: 1000, lastAt: 1000, segments: [], state: 'focus',
  reconnect: 0, distractions: 0,
});

test('blur, visibility, pagehide, and route departure record one distraction', () => {
  const first = depart(trip(), 11000);
  const duplicate = leaveFocusView(depart(first, 12000), 13000);

  assert.equal(duplicate.state, 'away');
  assert.equal(duplicate.distractions, 1);
  assert.equal(focused(duplicate), 10);

  const returned = returnFromBackground(duplicate, 31000);
  assert.equal(returned.state, 'focus');
  assert.equal(returned.distractions, 1);
  assert.equal(focused(returned), 10);
  assert.deepEqual(returned.segments.map(({ kind, start, end }) => [kind, start, end]), [
    ['focus', 1000, 11000],
    ['distraction', 11000, 31000],
  ]);
});

test('the wall clock continues while away while focused time remains separate', () => {
  const away = depart(trip(), 11000);
  const elapsed = tick(away, 61000);

  assert.equal(elapsedSeconds(elapsed, 61000), 60);
  assert.equal(elapsed.target - elapsedSeconds(elapsed, 61000), 540);
  assert.equal(focused(elapsed), 10);
  assert.equal(elapsed.state, 'away');

  const returned = returnFromBackground(elapsed, 61000);
  assert.equal(returned.state, 'focus');
  assert.equal(returned.reconnect, 0);
  assert.equal(focused(tick(returned, 71000)), 20);
});

test('a zero-duration departure at the deadline is counted without inventing a segment', () => {
  const atDeadline = depart(trip(20), 21000);
  const returned = returnFromBackground(atDeadline, 21000);

  assert.equal(returned.distractions, 1);
  assert.equal(returned.state, 'focus');
  assert.equal(focused(returned), 20);
  assert.deepEqual(returned.segments.map(({ kind, start, end }) => [kind, start, end]), [
    ['focus', 1000, 21000],
  ]);
});

test('return resumes immediately after a long absence without a recovery delay', () => {
  const away = depart(trip(), 11000);
  const returned = returnFromBackground(away, 151000);

  assert.equal(returned.state, 'focus');
  assert.equal(returned.reconnect, 0);
  assert.equal(focused(returned), 10);
  assert.equal(returned.distractions, 1);
  assert.equal(focused(tick(returned, 161000)), 20);
});

test('reload catches up an existing departure and resumes the timer', () => {
  const away = depart(trip(), 11000);
  const restored = returnFromBackground(restore(tick(away, 21000), 61000), 61000);

  assert.equal(restored.state, 'focus');
  assert.equal(restored.distractions, 1);
  assert.equal(elapsedSeconds(restored, 61000), 60);
  assert.equal(focused(restored), 10);
  assert.equal(focused(tick(restored, 71000)), 20);
});

test('reload after a missed pagehide treats the persisted gap as one departure', () => {
  const restored = restore(trip(), 61000);

  assert.equal(restored.state, 'away');
  assert.equal(restored.distractions, 1);
  assert.equal(focused(restored), 0);
  assert.deepEqual(restored.segments.map(({ kind, start, end }) => [kind, start, end]), [
    ['distraction', 1000, 61000],
  ]);
});

test('legacy pending and paused states migrate to running without crediting away time', () => {
  const pending = { ...trip(), state: 'pending', lastAt: 11000, observedAt: 11000,
    segments: [{ start: 1000, end: 11000, kind: 'focus' }] };
  const paused = { ...trip(), state: 'paused', lastAt: 11000,
    segments: [{ start: 1000, end: 11000, kind: 'focus' }] };

  for (const oldState of [pending, paused]) {
    const restored = returnFromBackground(restore(oldState, 61000), 61000);
    assert.equal(restored.state, 'focus');
    assert.equal(restored.distractions, 1);
    assert.equal(focused(restored), 10);
    assert.equal(restored.lastAt, 61000);
  }
});

test('restoring on another route keeps the same departure and does not credit background time', () => {
  const saved = tick(depart(trip(), 11000), 21000);
  const restored = restore(saved, 61000);
  assert.equal(restored.state, 'away');
  const stillAway = tick(leaveFocusView(restored, 61000), 71000);
  assert.equal(stillAway.distractions, 1);
  assert.equal(focused(stillAway), 10);
  assert.equal(elapsedSeconds(stillAway, 71000), 70);
  const visibleFocus = returnFromBackground(stillAway, 71000);
  assert.equal(visibleFocus.state, 'focus');
  assert.equal(focused(tick(visibleFocus, 81000)), 20);
});

test('timer deadline advances during absence and caps credited focus at the deadline', () => {
  const away = depart(trip(20), 11000);
  const deadline = tick(away, 41000);

  assert.equal(elapsedSeconds(deadline, 41000), 20);
  assert.equal(focused(deadline), 10);
  assert.equal(deadline.segments.at(-1).kind, 'distraction');
  assert.equal(deadline.segments.at(-1).end, 21000);
  assert.equal(sessionEndAt(deadline, 41000), 21000);
});

test('clock rollback does not create negative time or clear an active departure', () => {
  const away = depart(trip(), 11000);
  const back = tick(away, 5000);

  assert.equal(back.state, 'away');
  assert.equal(back.lastAt, 11000);
  assert.equal(back.distractions, 1);
  assert.equal(focused(back), 10);
  assert.equal(elapsedSeconds(back, 5000), 10);
});
