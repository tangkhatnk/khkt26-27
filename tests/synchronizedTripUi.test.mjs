import assert from 'node:assert/strict';
import test from 'node:test';
import { synchronizedTripControls, shouldAutoResumeSynchronizedTrip } from '../src/adventure/synchronizedTripUi.ts';

const group = (statuses, owner = 'owner', tripStatus = 'waiting') => ({
  id: 'group', owner,
  members: statuses.map(([id, tripStatus]) => ({ id, name: id, color: '#398575', decor: 'plant', tripStatus })),
  trip: { mode: 'synchronized', status: tripStatus, target: 600 },
});

test('only the owner can launch a two-to-six-person lobby after every joined member is ready', () => {
  assert.equal(synchronizedTripControls(group([['owner', 'ready']]), 'owner').canLaunch, false);
  assert.equal(synchronizedTripControls(group([['owner', 'ready'], ['member', 'not-ready']]), 'owner').canLaunch, false);
  assert.equal(synchronizedTripControls(group([['owner', 'ready'], ['member', 'ready']]), 'member').canLaunch, false);
  assert.equal(synchronizedTripControls(group([['owner', 'ready'], ['member', 'ready']]), 'owner').canLaunch, true);
  const sixReady = [['owner', 'ready'], ...Array.from({ length: 5 }, (_, i) => [`m${i}`, 'ready'])];
  assert.equal(synchronizedTripControls(group(sixReady), 'owner').canLaunch, true);
  const sevenReady = [...sixReady, ['m6', 'ready']];
  assert.equal(synchronizedTripControls(group(sevenReady), 'owner').canLaunch, false);
});

test('synchronized launch and recovery wait for a supported server clock sample', () => {
  const waiting = group([['owner', 'ready'], ['member', 'ready']]);
  const departed = group([['owner', 'bound'], ['member', 'bound']], 'owner', 'departed');
  assert.equal(synchronizedTripControls(waiting, 'owner', false).canLaunch, false);
  assert.equal(synchronizedTripControls(waiting, 'owner', true).canLaunch, true);
  assert.equal(synchronizedTripControls(departed, 'member', false).canResume, false);
  assert.equal(synchronizedTripControls(departed, 'member', true).canResume, true);
});

test('a ready member auto-resumes only after a foreground poll observes the bound departure', () => {
  const readyMember = {
    mode: 'synchronized', tripStatus: 'waiting', ownStatus: 'ready',
    ownSessionId: 'member-session', clockSupported: true, foreground: true,
  };
  const departed = { ...readyMember, tripStatus: 'departed', ownStatus: 'bound' };

  assert.equal(shouldAutoResumeSynchronizedTrip(readyMember), false);
  assert.equal(shouldAutoResumeSynchronizedTrip({ ...departed, foreground: false }), false);
  assert.equal(shouldAutoResumeSynchronizedTrip({ ...departed, clockSupported: false }), false);
  assert.equal(shouldAutoResumeSynchronizedTrip({ ...departed, activeSessionId: 'other-session' }), false);
  assert.equal(shouldAutoResumeSynchronizedTrip({ ...departed, pendingSessionIds: ['member-session'] }), false);
  assert.equal(shouldAutoResumeSynchronizedTrip(departed), true);
});

test('private plan editing requires an explicit unready action', () => {
  assert.equal(synchronizedTripControls(group([['owner', 'not-ready']]), 'owner').privateDraftLocked, false);
  assert.equal(synchronizedTripControls(group([['owner', 'ready'], ['member', 'not-ready']]), 'owner').privateDraftLocked, true);
  assert.equal(synchronizedTripControls(group([['owner', 'bound'], ['member', 'bound']], 'owner', 'departed'), 'owner').privateDraftLocked, true);
});

test('a ready member can unready; a bound member can resume only their own session', () => {
  const ready = synchronizedTripControls(group([['owner', 'ready'], ['member', 'ready']]), 'member');
  assert.equal(ready.canUnready, true);
  assert.equal(ready.canResume, false);
  const departed = synchronizedTripControls(group([['owner', 'bound'], ['member', 'bound']], 'owner', 'departed'), 'member');
  assert.equal(departed.canUnready, false);
  assert.equal(departed.canResume, true);
});
