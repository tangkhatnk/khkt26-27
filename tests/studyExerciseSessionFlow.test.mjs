import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptStudyExercisePreparationResult,
  isStudyExerciseSetSourceCurrent,
  isStudyExercisePreparationSourceCurrent,
  loadStudyExercisePreparationWithCurrentSources,
  loadStudyExerciseSolutionsAfterSync,
  matchStudyExercisePreparationSource,
  studyExerciseSourcesForSession,
  startStudyExerciseFocusIfAllowed,
  shouldInvalidateStudyExerciseForSourceChange,
} from "../src/adventure/studyExerciseSessionFlow.ts";

test("rehydrated generated sets match reviewed local source hashes and tolerate unavailable local source", async () => {
  const preparation = { mode: "generated", sourceFingerprint: "hash-original" };
  const fingerprint = async (text) => text === "original" ? "hash-original" : "hash-edited";
  assert.deepEqual(await matchStudyExercisePreparationSource({
    ...preparation, sources: [{ id: "source-a", text: "original", reviewed: true }], fingerprint,
  }), { status: "matched", sourceId: "source-a", textFingerprint: "hash-original" });
  assert.deepEqual(await matchStudyExercisePreparationSource({
    ...preparation, sources: [], fingerprint,
  }), { status: "no-local-source" });
  assert.deepEqual(await matchStudyExercisePreparationSource({
    ...preparation, sources: [{ id: "unrelated-source", text: "edited", reviewed: true }], fingerprint,
  }), { status: "no-local-source" });
  assert.deepEqual(await matchStudyExercisePreparationSource({
    ...preparation, sources: [{ id: "source-a", text: "original", reviewed: false }], fingerprint,
  }), { status: "no-local-source" });
  assert.deepEqual(await matchStudyExercisePreparationSource({
    mode: "provided", sources: [{ id: "source-a", text: "edited", reviewed: false }], fingerprint,
  }), { status: "not-needed" });
});

test("a delayed bound-set lookup survives a rerender with no local materials", async () => {
  const sourcesBySession = undefined;
  let localSources = studyExerciseSourcesForSession(sourcesBySession, "session-a");
  const firstSourceList = localSources;
  const controller = new AbortController();
  let resolveLookup;
  const lookup = new Promise(resolve => { resolveLookup = resolve; });
  const pending = loadStudyExercisePreparationWithCurrentSources({
    load: () => lookup,
    isCurrent: () => !controller.signal.aborted,
    getSources: () => localSources,
    match: (value, sources) => matchStudyExercisePreparationSource({
      mode: value.mode,
      sourceFingerprint: value.sourceFingerprint,
      sources,
      fingerprint: async text => `hash:${text}`,
    }),
  });

  // A rerender with no saved material gets the same immutable empty list, so
  // the lookup effect does not clean up and abort its in-flight request.
  localSources = studyExerciseSourcesForSession(sourcesBySession, "session-a");
  assert.strictEqual(localSources, firstSourceList);
  assert.equal(controller.signal.aborted, false);
  resolveLookup({ mode: "generated", sourceFingerprint: "server-snapshot-hash" });

  const loaded = await pending;
  assert.deepEqual(loaded?.sourceMatch, { status: "no-local-source" });
  assert.equal(controller.signal.aborted, false);
});

test("generated preparation stays scoped to the same reviewed source revision while provided text ignores source edits", () => {
  const generated = {
    mode: "generated",
    sourceScope: { sourceId: "source-a", textFingerprint: "fingerprint-a" },
    selectedSource: { id: "source-a", reviewed: true },
    sourceRevision: 2,
    preparationSourceRevision: 2,
  };
  assert.equal(isStudyExercisePreparationSourceCurrent(generated), true);
  assert.equal(isStudyExercisePreparationSourceCurrent({ ...generated, sourceRevision: 3 }), false);
  assert.equal(isStudyExercisePreparationSourceCurrent({ ...generated, selectedSource: { id: "source-a", reviewed: false } }), false);
  assert.equal(isStudyExercisePreparationSourceCurrent({ ...generated, selectedSource: { id: "source-b", reviewed: true } }), false);
  assert.equal(isStudyExercisePreparationSourceCurrent({
    mode: "provided", sourceScope: null, selectedSource: null, sourceRevision: 99, preparationSourceRevision: null,
  }), true);
});

test("a bound generated snapshot stays current across local source edits or missing material", () => {
  const original = {
    bound: true,
    mode: "generated",
    sourceFingerprint: "fingerprint-a",
    sourceScope: { sourceId: "source-a", textFingerprint: "fingerprint-a" },
    selectedSource: { id: "source-a", reviewed: true },
    sourceRevision: 3,
    preparationSourceRevision: 2,
  };
  assert.equal(isStudyExerciseSetSourceCurrent(original), true);
  assert.equal(isStudyExerciseSetSourceCurrent({
    ...original,
    selectedSource: { id: "source-a", reviewed: false },
  }), true);
  assert.equal(isStudyExerciseSetSourceCurrent({ ...original, selectedSource: null }), true);
  assert.equal(isStudyExerciseSetSourceCurrent({
    ...original,
    selectedSource: { id: "unrelated-source", reviewed: true },
  }), true);
  assert.equal(isStudyExerciseSetSourceCurrent({
    ...original,
    sourceFingerprint: "server-original-fingerprint",
    sourceScope: { sourceId: "source-a", textFingerprint: "local-stale-fingerprint" },
    selectedSource: { id: "source-a", reviewed: false },
  }), true);
  assert.equal(isStudyExerciseSetSourceCurrent({ ...original, bound: false }), false);
  assert.equal(isStudyExerciseSetSourceCurrent({
    ...original,
    bound: false,
    sourceFingerprint: "server-fingerprint",
    sourceScope: { sourceId: "source-a", textFingerprint: "local-stale-fingerprint" },
  }), false);
  assert.equal(isStudyExerciseSetSourceCurrent({
    ...original,
    bound: false,
    sourceScope: null,
    selectedSource: null,
  }), true);
});

test("source edits invalidate only known unbound generated sets", () => {
  assert.equal(shouldInvalidateStudyExerciseForSourceChange({
    bound: true, sourceId: "source-a", changedSourceId: "source-a",
  }), false);
  assert.equal(shouldInvalidateStudyExerciseForSourceChange({
    bound: true, sourceId: null, changedSourceId: "source-a",
  }), false);
  assert.equal(shouldInvalidateStudyExerciseForSourceChange({
    bound: false, sourceId: "source-a", changedSourceId: "source-a",
  }), true);
  assert.equal(shouldInvalidateStudyExerciseForSourceChange({
    bound: false, sourceId: null, changedSourceId: "source-a",
  }), true);
  assert.equal(shouldInvalidateStudyExerciseForSourceChange({
    bound: false, sourceId: "source-b", changedSourceId: "source-a",
  }), false);
});

test("a pending exercise generation blocks focus until the learner explicitly skips it", () => {
  const events = [];
  const pending = {
    hasReadyPreparation: false,
    generationPending: true,
    skipConfirmed: false,
    cancelPending: () => events.push("invalidate"),
    startFocus: (withExercises) => events.push(withExercises ? "focus-with-exercises" : "focus-without-exercises"),
  };

  assert.equal(startStudyExerciseFocusIfAllowed(pending), "needs-skip-choice");
  assert.deepEqual(events, []);

  assert.equal(startStudyExerciseFocusIfAllowed({ ...pending, skipConfirmed: true }), "started-without-exercises");
  assert.deepEqual(events, ["invalidate", "focus-without-exercises"]);
});

test("a ready question set starts with exercises and does not invalidate its request", () => {
  const events = [];
  const result = startStudyExerciseFocusIfAllowed({
    hasReadyPreparation: true,
    generationPending: false,
    skipConfirmed: false,
    cancelPending: () => events.push("invalidate"),
    startFocus: (withExercises) => events.push(withExercises ? "focus-with-exercises" : "focus-without-exercises"),
  });

  assert.equal(result, "started-with-exercises");
  assert.deepEqual(events, ["focus-with-exercises"]);
});

test("completion sync gates solutions and scope is checked again after the provider response", async () => {
  let current = true;
  let completed = false;
  let syncCalls = 0;
  let solutionCalls = 0;
  let loading = true;
  let releaseSolution;
  let releaseSync;
  let signalLoadStarted;
  const syncBarrier = new Promise((resolve) => { releaseSync = resolve; });
  const loadStarted = new Promise((resolve) => { signalLoadStarted = resolve; });
  const pendingSolution = new Promise((resolve) => { releaseSolution = resolve; });

  const request = loadStudyExerciseSolutionsAfterSync({
    isScopeCurrent: () => current,
    isPersistedCompleted: () => completed,
    sync: async () => { syncCalls++; await syncBarrier; completed = true; },
    load: async () => { solutionCalls++; signalLoadStarted(); return pendingSolution; },
    onRejected: () => { loading = false; },
  });

  assert.equal(syncCalls, 1);
  releaseSync();
  await loadStarted;
  assert.equal(solutionCalls, 1);
  current = false;
  releaseSolution({ exercises: [{ solution: "private" }] });
  assert.equal(await request, null);
  assert.equal(loading, false);
});

test("an incomplete persisted session never requests a solution", async () => {
  let solutionCalls = 0;
  const result = await loadStudyExerciseSolutionsAfterSync({
    isScopeCurrent: () => true,
    isPersistedCompleted: () => false,
    sync: async () => {},
    load: async () => { solutionCalls++; return "secret"; },
  });

  assert.equal(result, null);
  assert.equal(solutionCalls, 0);
});

test("a rejected solution load clears its loading state", async () => {
  let loading = true;
  let requests = 0;
  const result = await loadStudyExerciseSolutionsAfterSync({
    sync: async () => {},
    isScopeCurrent: () => true,
    isPersistedCompleted: () => false,
    load: async () => { requests++; return "solution"; },
    onRejected: () => { loading = false; },
  });
  assert.equal(result, null);
  assert.equal(requests, 0);
  assert.equal(loading, false);
});

test("a stale scope before sync clears loading without requesting solutions", async () => {
  let loading = true;
  let syncCalls = 0;
  let solutionCalls = 0;
  const result = await loadStudyExerciseSolutionsAfterSync({
    sync: async () => { syncCalls++; },
    isScopeCurrent: () => false,
    isPersistedCompleted: () => true,
    load: async () => { solutionCalls++; return "solution"; },
    onRejected: () => { loading = false; },
  });
  assert.equal(result, null);
  assert.equal(loading, false);
  assert.equal(syncCalls, 0);
  assert.equal(solutionCalls, 0);
});

test("a stale or aborted preparation is invalidated and never resolves to the editor", async () => {
  for (const signalAborted of [false, true]) {
    const controller = new AbortController();
    if (signalAborted) controller.abort();
    let invalidations = 0;
    let editorUpdates = 0;
    await assert.rejects(async () => {
      const result = await acceptStudyExercisePreparationResult({
        result: { id: "private-request-a", exercises: [{ prompt: "stale" }] },
        signal: controller.signal,
        isCurrent: () => false,
        invalidate: async () => { invalidations++; },
      });
      editorUpdates++;
      return result;
    }, { name: "AbortError" });
    assert.equal(invalidations, 1);
    assert.equal(editorUpdates, 0);
  }
});
