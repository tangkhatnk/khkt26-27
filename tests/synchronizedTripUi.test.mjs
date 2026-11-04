import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canMarkSynchronizedTripReady,
  shouldOfferSynchronizedTripReprepare,
  synchronizedTripControls,
  synchronizedTripDraftForSession,
  tripDraftLocks,
  synchronizedTripQuizPreferences,
  shouldAutoResumeSynchronizedTrip,
} from '../src/adventure/synchronizedTripUi.ts';

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
  const localDraft = { groupId: 'group', goal: 'Review cell structure', topic: 'biology' };
  const readyMember = {
    mode: 'synchronized', tripStatus: 'waiting', ownStatus: 'ready',
    groupId: 'group', ownSessionId: 'member-session', localDraftReady: true,
    clockSupported: true, foreground: true,
  };
  const departed = { ...readyMember, tripStatus: 'departed', ownStatus: 'bound' };

  assert.equal(shouldAutoResumeSynchronizedTrip(readyMember), false);
  assert.equal(shouldAutoResumeSynchronizedTrip({ ...departed, foreground: false }), false);
  assert.equal(shouldAutoResumeSynchronizedTrip({ ...departed, clockSupported: false }), false);
  assert.equal(shouldAutoResumeSynchronizedTrip({ ...departed, activeSessionId: 'other-session' }), false);
  assert.equal(shouldAutoResumeSynchronizedTrip({ ...departed, pendingSessionIds: ['member-session'] }), false);
  assert.equal(shouldAutoResumeSynchronizedTrip(departed), true);
  assert.equal(shouldAutoResumeSynchronizedTrip({ ...departed, localDraftReady: false }), false);
  assert.equal(synchronizedTripDraftForSession({ 'member-session': localDraft }, 'member-session', 'group'), localDraft);
  assert.equal(synchronizedTripDraftForSession({}, 'member-session', 'group'), undefined);
  assert.equal(synchronizedTripDraftForSession({ 'solo-session': localDraft }, 'member-session', 'group'), undefined);
  assert.equal(synchronizedTripDraftForSession({ 'member-session': { ...localDraft, groupId: 'other' } }, 'member-session', 'group'), undefined);
});

test('readiness requires a valid enabled quiz count and no pending exercise generation', () => {
  const base = {
    goal: 'Review cell structure',
    quizCount: '3',
    skipQuizReview: false,
    studyGuideNeedsConfirmation: false,
    materialRequestPending: false,
    exerciseGenerationPending: false,
    loaded: true,
    exclusive: true,
    hasActiveSession: false,
  };
  assert.equal(canMarkSynchronizedTripReady(base), true);
  assert.equal(canMarkSynchronizedTripReady({ ...base, quizCount: '31' }), false);
  assert.equal(canMarkSynchronizedTripReady({ ...base, quizCount: '31', skipQuizReview: true }), true);
  assert.equal(canMarkSynchronizedTripReady({ ...base, exerciseGenerationPending: true }), false);
  assert.equal(canMarkSynchronizedTripReady({ ...base, loaded: false }), false);
  assert.equal(canMarkSynchronizedTripReady({ ...base, exclusive: false }), false);
  assert.equal(canMarkSynchronizedTripReady({ ...base, hasActiveSession: true }), false);
  assert.equal(canMarkSynchronizedTripReady({ ...base, materialRequestPending: true }), false);
  assert.equal(canMarkSynchronizedTripReady({ ...base, studyGuideNeedsConfirmation: true }), false);
  assert.deepEqual(synchronizedTripQuizPreferences({ quizCount: '31', skipQuizReview: true }), {
    quizCount: '3',
    skipQuizReview: true,
  });
});

test('private plan editing requires an explicit unready action', () => {
  assert.equal(synchronizedTripControls(group([['owner', 'not-ready']]), 'owner').privateDraftLocked, false);
  assert.equal(synchronizedTripControls(group([['owner', 'ready'], ['member', 'not-ready']]), 'owner').privateDraftLocked, true);
  assert.equal(synchronizedTripControls(group([['owner', 'bound'], ['member', 'bound']], 'owner', 'departed'), 'owner').privateDraftLocked, true);
});

test('legacy planned trips keep shared plan fields locked while private inputs remain editable', () => {
  assert.deepEqual(tripDraftLocks({ status: 'waiting', target: 600, goal: 'Group goal', topic: 'biology' }, true), {
    privateInputsLocked: false,
    sharedPlanLocked: true,
  });
  assert.deepEqual(tripDraftLocks({ mode: 'synchronized', status: 'waiting', target: 600 }, false), {
    privateInputsLocked: false,
    sharedPlanLocked: false,
  });
  assert.deepEqual(tripDraftLocks({ mode: 'synchronized', status: 'waiting', target: 600 }, true), {
    privateInputsLocked: true,
    sharedPlanLocked: true,
  });
});

test('a ready member with a missing local draft can replace it while the trip is waiting only', () => {
  assert.equal(shouldOfferSynchronizedTripReprepare({ tripStatus: 'waiting', ownStatus: 'ready', localDraftReady: false }), true);
  assert.equal(shouldOfferSynchronizedTripReprepare({ tripStatus: 'waiting', ownStatus: 'ready', localDraftReady: true }), false);
  assert.equal(shouldOfferSynchronizedTripReprepare({ tripStatus: 'departed', ownStatus: 'bound', localDraftReady: false }), false);
});

test('a ready member can unready; a bound member can resume only their own session', () => {
  const ready = synchronizedTripControls(group([['owner', 'ready'], ['member', 'ready']]), 'member');
  assert.equal(ready.canUnready, true);
  assert.equal(ready.canResume, false);
  const departed = synchronizedTripControls(group([['owner', 'bound'], ['member', 'bound']], 'owner', 'departed'), 'member');
  assert.equal(departed.canUnready, false);
  assert.equal(departed.canResume, true);
});
