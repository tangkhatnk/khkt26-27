import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/adventure/AdventureApp.tsx", import.meta.url), "utf8");
const focusSource = readFileSync(new URL("../src/adventure/focus.ts", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../src/services/guestAiApi.ts", import.meta.url), "utf8");
const storageSource = readFileSync(new URL("../src/adventure/storage.ts", import.meta.url), "utf8");

test("guest exercise start binds its prepared set before saving the immutable server anchor", () => {
  const bindIndex = appSource.indexOf("await bindStudyExercises(sessionId, undefined, true, exerciseId)");
  const startIndex = appSource.indexOf("await startGuestAiSession({", bindIndex);
  assert.ok(bindIndex >= 0 && startIndex > bindIndex);
  assert.match(appSource, /studyExercisePreparation\?\.plannedSessionId === sessionId[\s\S]*?studyExercisePreparation\.id/u);
  assert.match(appSource, /started\.startedAt[\s\S]*?started\.serverNow[\s\S]*?started\.target/u);
  assert.match(appSource, /estimateServerClockOffset\(started\.serverNow, clientReceivedAt\)/u);
  assert.match(appSource, /serverObservedAt: started\.serverNow/u);
  assert.match(appSource, /started: started\.startedAt/u);
  assert.match(appSource, /startGuestAnchoredSession\(trip, input\.serverObservedAt \?\? input\.started/u);
});

test("the guest clock anchor is stored separately from synchronized group clock state", () => {
  assert.match(apiSource, /startedAt: number;\s*serverNow: number;/u);
  assert.match(focusSource, /serverAnchorOffsetMs\?: number/u);
  assert.match(focusSource, /s\.syncClock \? s\.clockOffsetMs : s\.serverAnchorOffsetMs/u);
  assert.match(storageSource, /a\.serverAnchorOffsetMs !== undefined[\s\S]*?24 \* 60 \* 60 \* 1000/u);
});
