import test from 'node:test';
import assert from 'node:assert/strict';
import * as focus from '../src/adventure/focus.ts';
import { isDeviceClockBehind } from '../src/adventure/focus.ts';
import { estimateServerClockOffset, MAX_SERVER_CLOCK_OFFSET_MS, serverTimeFromClientTime } from '../src/adventure/serverClock.ts';

const { tick, depart, returnFromBackground, leaveFocusView, restore, focused, elapsedSeconds, sessionEndAt } = focus;
const trip = (target = 600) => ({
  id: 'test', owner: 'guest', goal: 'Read biology', topic: 'biology', document: '',
  target, groupId: null, started: 1000, lastAt: 1000, segments: [], state: 'focus',
  reconnect: 0, distractions: 0,
});

test('scene timing exposes study distance and fixed rest anchors while retaining wall duration', () => {
  const scheduled = { ...trip(120), breakPlan: { count: 1, seconds: 60 } };
  const start = focus.tripSceneTiming(scheduled, 1000);
  const breakStart = focus.tripSceneTiming(scheduled, 61000);
  const breakMiddle = focus.tripSceneTiming(scheduled, 91000);
  const afterBreak = focus.tripSceneTiming(scheduled, 121000);
  const end = focus.tripSceneTiming(scheduled, 181000);

  assert.equal(start.elapsedSeconds, 0);
  assert.equal(start.remainingSeconds, 180);
  assert.equal(start.elapsedStudySeconds, 0);
  assert.equal(start.targetStudySeconds, 120);
  assert.deepEqual(start.restAnchors, [{ index: 1, count: 1, elapsedStudySeconds: 60 }]);

  assert.equal(breakStart.elapsedSeconds, 60);
  assert.equal(breakStart.remainingSeconds, 120);
  assert.equal(breakStart.elapsedStudySeconds, 60);
  assert.equal(breakMiddle.elapsedStudySeconds, 60);
  assert.equal(afterBreak.elapsedStudySeconds, 60);
  assert.equal(end.elapsedStudySeconds, 120);
  assert.equal(end.remainingSeconds, 0);

  const beforeTrip = focus.tripSceneTiming(scheduled, 0);
  assert.equal(beforeTrip.elapsedStudySeconds, 0);
  assert.equal(beforeTrip.remainingSeconds, 180);
});

test('a synchronized no-break plan does not reuse a stale device-local break plan', () => {
  const staleLocalPlan = { count: 1, seconds: 60 };
  assert.equal(focus.resolveTripBreakPlan({ synchronized: true, sharedPlan: undefined, localPlan: staleLocalPlan }), undefined);
  assert.deepEqual(focus.resolveTripBreakPlan({ synchronized: true, sharedPlan: staleLocalPlan, localPlan: undefined }), staleLocalPlan);
  assert.deepEqual(focus.resolveTripBreakPlan({ synchronized: false, sharedPlan: undefined, localPlan: staleLocalPlan }), staleLocalPlan);
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

test('captured device category survives focus ticks, departure, and reload restoration', () => {
  const captured = { ...trip(), deviceCategory: 'ios' };
  const saved = tick(depart(captured, 11000), 21000);
  const restored = restore(saved, 61000);

  assert.equal(saved.deviceCategory, 'ios');
  assert.equal(restored.deviceCategory, 'ios');
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

test('a current clock sample clears the stale warning after a normal checkpoint', () => {
  const checkpointed = tick(trip(), 5005);
  const staleRenderSample = 5000;
  const clockSamples = [5006, 5004, 5006];
  let clockReads = 0;
  const readClock = () => clockSamples[clockReads++];

  assert.equal(staleRenderSample < checkpointed.lastAt, true);
  assert.equal(isDeviceClockBehind(checkpointed.lastAt, readClock), false);
  assert.equal(clockReads, 1);
  assert.equal(isDeviceClockBehind(checkpointed.lastAt, readClock), true);
  assert.equal(clockReads, 2);
  assert.equal(isDeviceClockBehind(checkpointed.lastAt, readClock), false);
  assert.equal(clockReads, 3);
});

test('normal focus return timestamps are not mistaken for a clock rollback', () => {
  const away = depart(trip(), 5000);
  const returned = returnFromBackground(away, 10005);

  assert.equal(returned.lastAt, 10005);
  assert.equal(isDeviceClockBehind(returned.lastAt, () => 10006), false);
});

test('late synchronized snapshots convert fast and slow device clocks and retain the shared break schedule', () => {
  const started = 1_000_000;
  const serverNow = started + 315_000;
  for (const skew of [300_000, -240_000]) {
    const clientNow = serverNow + skew;
    const offset = estimateServerClockOffset(serverNow, clientNow);
    const scheduled = {
      ...trip(600),
      started,
      lastAt: serverNow,
      syncClock: true,
      clockOffsetMs: offset,
      breakPlan: { count: 1, seconds: 60 },
      segments: focus.scheduledBreakSegmentsThrough(started, 600, { count: 1, seconds: 60 }, serverNow),
    };
    const resumedAt = serverTimeFromClientTime(clientNow + 50_000, offset);
    const resumed = tick(scheduled, resumedAt);
    assert.equal(offset, -skew);
    assert.equal(resumed.lastAt, serverNow + 50_000);
    assert.equal(focused(resumed), 5);
    assert.deepEqual(resumed.segments.map(({ kind, start, end }) => [kind, start, end]), [
      ['break', started + 300_000, started + 360_000],
      ['focus', started + 360_000, started + 365_000],
    ]);
    assert.equal(isDeviceClockBehind(resumed.lastAt, () => serverTimeFromClientTime(clientNow + 51_000, offset)), false);
  }
});

test('guest exercise timer follows its server start across positive and negative device skew', () => {
  const started = 1_500_000;
  const plan = { count: 1, seconds: 60 };
  for (const deviceSkew of [240_000, -180_000]) {
    const clientStart = started + deviceSkew;
    const serverAnchorOffsetMs = estimateServerClockOffset(started, clientStart);
    const anchored = {
      ...trip(120),
      started,
      lastAt: started,
      serverAnchorOffsetMs,
      breakPlan: plan,
    };
    const serverAt = (elapsedMs) => serverTimeFromClientTime(clientStart + elapsedMs, serverAnchorOffsetMs);

    assert.equal(serverAnchorOffsetMs, -deviceSkew);
    assert.equal(focus.tripClockNow(anchored, clientStart + 10_000), started + 10_000);
    const completed = tick(anchored, serverAt(200_000));
    assert.equal(focused(completed), 120);
    assert.equal(sessionEndAt(completed, serverAt(200_000)), started + 180_000);
    assert.equal(elapsedSeconds(completed, serverAt(200_000)), 120);
    assert.deepEqual(completed.segments.map(({ kind, start, end }) => [kind, start, end]), [
      ['focus', started, started + 60_000],
      ['break', started + 60_000, started + 120_000],
      ['focus', started + 120_000, started + 180_000],
    ]);
  }
});

test('a delayed guest start replay keeps the earlier interval uncredited and the original deadline', () => {
  const started = 2_500_000;
  const serverNow = started + 75_000;
  const clientReceive = serverNow + 240_000;
  const offset = estimateServerClockOffset(serverNow, clientReceive);
  const plan = { count: 1, seconds: 60 };
  const replayed = focus.startGuestAnchoredSession({
    ...trip(120),
    started,
    lastAt: started,
    serverAnchorOffsetMs: offset,
    breakPlan: plan,
  }, serverNow, true);

  assert.equal(offset, -240_000);
  assert.equal(focused(replayed), 0);
  assert.deepEqual(replayed.segments, [{ start: started + 60_000, end: serverNow, kind: 'break' }]);
  assert.equal(focus.breakRemainingSeconds(replayed, serverNow), 45);
  assert.equal(focus.tripClockNow(replayed, clientReceive + 10_000), serverNow + 10_000);

  const finishedAtDeadline = tick(replayed, focus.tripClockNow(replayed, clientReceive + 105_000));
  assert.equal(focused(finishedAtDeadline), 60);
  assert.equal(sessionEndAt(finishedAtDeadline, focus.tripClockNow(replayed, clientReceive + 105_000)), started + 180_000);
  assert.equal(elapsedSeconds(finishedAtDeadline, focus.tripClockNow(replayed, clientReceive + 105_000)), 120);
});

test('synchronized reconnect does not invent focus before observation and early end uses server time', () => {
  const started = 2_000_000;
  const observedAt = started + 30_000;
  const clientNow = observedAt - 420_000;
  const offset = estimateServerClockOffset(observedAt, clientNow);
  const waiting = {
    ...trip(120),
    started,
    lastAt: observedAt,
    syncClock: true,
    clockOffsetMs: offset,
    breakPlan: { count: 1, seconds: 60 },
    segments: focus.scheduledBreakSegmentsThrough(started, 120, { count: 1, seconds: 60 }, observedAt),
  };
  const afterOneSecond = tick(waiting, serverTimeFromClientTime(clientNow + 1_000, offset));
  assert.equal(focused(afterOneSecond), 1);
  assert.deepEqual(afterOneSecond.segments, [
    { start: observedAt, end: observedAt + 1_000, kind: 'focus' },
  ]);
  assert.equal(afterOneSecond.distractions ?? 0, 0);
  assert.equal(sessionEndAt(afterOneSecond, serverTimeFromClientTime(clientNow + 20_000, offset)), observedAt + 20_000);
  assert.equal(sessionEndAt(afterOneSecond, serverTimeFromClientTime(clientNow + 200_000, offset)), started + 180_000);
});

test('a late observer receives scheduled breaks without focus or a fabricated distraction before observation', () => {
  const started = 3_000_000;
  const observedAt = started + 150_000;
  const plan = { count: 1, seconds: 60 };
  const prefix = focus.scheduledBreakSegmentsThrough(started, 120, plan, observedAt);
  const waiting = {
    ...trip(120), started, lastAt: observedAt, syncClock: true,
    clockOffsetMs: 0, breakPlan: plan, segments: prefix,
  };

  assert.deepEqual(prefix, [{ start: started + 60_000, end: started + 120_000, kind: 'break' }]);
  assert.equal(focused(waiting), 0);
  assert.equal(waiting.distractions ?? 0, 0);
  const oneSecondFocused = tick(waiting, observedAt + 1_000);
  assert.equal(focused(oneSecondFocused), 1);
  assert.equal(oneSecondFocused.distractions ?? 0, 0);
});

test('a hidden ready member waits for foreground before focused time starts after the host launches', () => {
  const started = 4_000_000;
  const observedAt = started + 150_000;
  const plan = { count: 1, seconds: 60 };
  const hidden = focus.startSynchronizedSession({
    ...trip(120), started, lastAt: started, syncClock: true, clockOffsetMs: 0,
    breakPlan: plan, segments: [],
  }, observedAt, false);

  assert.equal(hidden.state, 'away');
  assert.equal(hidden.lastAt, observedAt);
  assert.equal(focused(hidden), 0);
  assert.equal(hidden.distractions ?? 0, 0);
  assert.deepEqual(hidden.segments, [{ start: started + 60_000, end: started + 120_000, kind: 'break' }]);

  const foreground = returnFromBackground(hidden, observedAt + 1_000);
  assert.equal(foreground.state, 'focus');
  assert.equal(focused(foreground), 0);
  assert.equal(foreground.distractions ?? 0, 0);
  assert.equal(focused(tick(foreground, observedAt + 2_000)), 1);
  assert.equal(focused(tick(foreground, observedAt + 2_000)), 1);
});

test('server clock rejects skew beyond the supported range instead of clamping it', () => {
  assert.equal(estimateServerClockOffset(200_000_000, 0), null);
  assert.equal(estimateServerClockOffset(0, 200_000_000), null);
  assert.equal(estimateServerClockOffset(200_000_000, 200_000_000 - MAX_SERVER_CLOCK_OFFSET_MS), MAX_SERVER_CLOCK_OFFSET_MS);
  assert.equal(estimateServerClockOffset(200_000_000, 200_000_000 - MAX_SERVER_CLOCK_OFFSET_MS - 1), null);
  assert.ok(Number.isNaN(serverTimeFromClientTime(200_000_000, MAX_SERVER_CLOCK_OFFSET_MS + 1)));
});
