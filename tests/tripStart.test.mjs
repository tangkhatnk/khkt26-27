import assert from "node:assert/strict";
import test from "node:test";
import {
  groupDraftSessionId,
  isTripStartCurrent,
  recoverBoundTripSessionId,
  rotateDraftSessionId,
  startAfterTripReservation,
} from "../src/adventure/tripStart.ts";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("starts the local focus clock only after the reservation response arrives", async () => {
  const reservation = deferred();
  const events = [];
  let clientNow = 1_000;
  const started = startAfterTripReservation({
    sessionId: "stable-session-id",
    reserve: async (sessionId) => {
      events.push(["reserve", sessionId]);
      return reservation.promise;
    },
    isCurrent: () => true,
    now: () => clientNow,
    start: (value, at) => events.push(["focus", value, at]),
  });

  clientNow = 121_000;
  reservation.resolve({ tripId: "trip-a" });
  assert.equal(await started, true);
  assert.deepEqual(events, [
    ["reserve", "stable-session-id"],
    ["focus", { tripId: "trip-a" }, 121_000],
  ]);
});

test("does not install a bound trip over an active session acquired while binding waits", async () => {
  const reservation = deferred();
  const events = [];
  const liveness = {
    expectedOwnerId: "owner-a",
    ownerId: "owner-a",
    workspaceLive: true,
    exclusiveLease: true,
    activeSessionId: null,
    expectedSessionId: "stable-session-id",
    draftSessionId: "stable-session-id",
    expectedAuthGeneration: 4,
    authGeneration: 4,
    authenticatedUserId: "owner-a",
    needsLogin: false,
    currentView: "ticket",
  };
  const started = startAfterTripReservation({
    sessionId: liveness.expectedSessionId,
    reserve: async (sessionId) => {
      events.push(["reserve", sessionId]);
      return reservation.promise;
    },
    isCurrent: () => isTripStartCurrent(liveness),
    start: (value, at) => events.push(["focus", value, at]),
    now: () => 121_000,
  });

  liveness.activeSessionId = "other-session";
  reservation.resolve({ tripId: "trip-a" });
  assert.equal(await started, false);
  assert.deepEqual(events, [["reserve", "stable-session-id"]]);
});

test("does not install a reservation after losing the workspace lease, account, or draft ID", async () => {
  for (const invalidate of [
    (state) => { state.exclusiveLease = false; },
    (state) => { state.ownerId = "owner-b"; state.authenticatedUserId = "owner-b"; },
    (state) => { state.authGeneration += 1; },
    (state) => { state.draftSessionId = "rotated-session-id"; },
    (state) => { state.currentView = "group"; },
  ]) {
    const reservation = deferred();
    const events = [];
    const liveness = {
      expectedOwnerId: "owner-a",
      ownerId: "owner-a",
      workspaceLive: true,
      exclusiveLease: true,
      activeSessionId: null,
      expectedSessionId: "stable-session-id",
      draftSessionId: "stable-session-id",
      expectedAuthGeneration: 4,
      authGeneration: 4,
      authenticatedUserId: "owner-a",
      needsLogin: false,
      currentView: "ticket",
    };
    const started = startAfterTripReservation({
      sessionId: liveness.expectedSessionId,
      reserve: async () => reservation.promise,
      isCurrent: () => isTripStartCurrent(liveness),
      start: (value, at) => events.push(["focus", value, at]),
      now: () => 121_000,
    });

    invalidate(liveness);
    reservation.resolve({ tripId: "trip-a" });
    assert.equal(await started, false);
    assert.deepEqual(events, []);
  }
});

test("recovers the same reserved session ID after reload so preparation stays linked", () => {
  assert.equal(recoverBoundTripSessionId({
    ownSessionId: "stable-session-id",
    activeSessionId: null,
    pendingSessionIds: [],
    savedSessionIds: [],
  }), "stable-session-id");
});

test("does not recover a reservation over active, pending, or completed local work", () => {
  const base = {
    ownSessionId: "stable-session-id",
    pendingSessionIds: [],
    savedSessionIds: [],
  };
  assert.equal(recoverBoundTripSessionId({ ...base, activeSessionId: "other-session" }), null);
  assert.equal(recoverBoundTripSessionId({
    ...base, activeSessionId: null, pendingSessionIds: ["stable-session-id"],
  }), null);
  assert.equal(recoverBoundTripSessionId({
    ...base, activeSessionId: null, savedSessionIds: ["stable-session-id"],
  }), null);
});

test("keeps solo and group draft IDs separate while preserving a shared-trip reservation", () => {
  const sessions = { solo: "solo-session-a", groups: new Map() };
  const plannedGroupSession = groupDraftSessionId(
    sessions,
    "trip-a",
    undefined,
    () => "group-session-a",
  );
  assert.equal(plannedGroupSession, "group-session-a");
  assert.equal(sessions.solo, "solo-session-a");

  const recoveredGroupSession = groupDraftSessionId(sessions, "trip-a", "bound-session-a");
  assert.equal(recoveredGroupSession, "bound-session-a");
  assert.equal(sessions.solo, "solo-session-a");
  assert.equal(groupDraftSessionId(sessions, "trip-a"), "bound-session-a");

  const nextGroupSession = rotateDraftSessionId(sessions, "group", "trip-a", () => "group-session-b");
  assert.equal(nextGroupSession, "group-session-b");
  assert.equal(sessions.solo, "solo-session-a");

  const nextSoloSession = rotateDraftSessionId(sessions, "solo", null, () => "solo-session-b");
  assert.equal(nextSoloSession, "solo-session-b");
  assert.equal(sessions.solo, "solo-session-b");
  assert.equal(groupDraftSessionId(sessions, "trip-a"), "group-session-b");
});
