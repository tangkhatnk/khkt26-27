import test from "node:test";
import assert from "node:assert/strict";
import { QuizPrefetchCoordinator, quizPrefetchScopeKey } from "../src/adventure/quizPrefetch.ts";
import { buildQuizGenerationPayload, quizGenerationSourceKey } from "../src/adventure/quizGeneration.ts";
import { isCurrentQuizPrefetchRequest, quizPrefetchNotice } from "../src/adventure/quizPrefetchPresentation.ts";

const scope = (overrides = {}) => ({
  ownerId: "owner-a",
  sessionId: "trip-a",
  correctionVersion: 0,
  sourceKey: "biology|photosynthesis",
  count: 3,
  ...overrides,
});

function pending(signal) {
  return new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
}

test("focus and summary share one in-flight request for the same owner, trip, source and count", async () => {
  const coordinator = new QuizPrefetchCoordinator();
  const currentScope = scope();
  const questions = [{ id: "q1" }];
  let calls = 0;
  const start = (signal) => {
    calls++;
    return pending(signal).catch((error) => {
      if (error.name === "AbortError") return questions;
      throw error;
    });
  };

  const duringFocus = coordinator.getOrStart(currentScope, start);
  const onSummaryMount = coordinator.getOrStart(currentScope, start);

  assert.strictEqual(onSummaryMount, duringFocus);
  assert.equal(calls, 1);
  coordinator.dispose();
  await assert.rejects(duringFocus, { name: "AbortError" });
});

test("periodic focus checkpoints keep one delayed generation alive until its result arrives", async () => {
  const coordinator = new QuizPrefetchCoordinator();
  const initialScope = scope();
  const requestKey = quizPrefetchScopeKey(initialScope);
  let calls = 0;
  let resolveGeneration;
  const start = () => {
    calls++;
    return new Promise((resolve) => { resolveGeneration = resolve; });
  };
  const original = coordinator.getOrStart(initialScope, start);
  let checkpointAt = 0;
  for (let checkpoint = 1; checkpoint <= 3; checkpoint++) {
    checkpointAt += 5000;
    const checkpointScope = { ...initialScope, checkpointAt };
    assert.equal(quizPrefetchScopeKey(checkpointScope), requestKey);
    assert.strictEqual(coordinator.getOrStart(checkpointScope, start), original);
  }

  const expected = [{ id: "question-a" }, { id: "question-b" }, { id: "question-c" }];
  resolveGeneration(expected);
  assert.deepEqual(await original, expected);
  assert.equal(calls, 1);
  assert.equal(coordinator.status(initialScope)?.status, "ready");
  coordinator.cancel();
});

test("a changed source or count aborts the prior request and rejects its late result", async () => {
  const coordinator = new QuizPrefetchCoordinator();
  let oldSignal;
  const old = coordinator.getOrStart(scope(), (signal) => {
    oldSignal = signal;
    return pending(signal);
  });
  const replacement = coordinator.getOrStart(scope({ count: 5, sourceKey: "updated content" }), async () => ["new"]);

  assert.equal(oldSignal.aborted, true);
  await assert.rejects(old, { name: "AbortError" });
  assert.deepEqual(await replacement, ["new"]);
  coordinator.dispose();
});

test("a corrected session version gets a distinct prefetch scope even when source and count are unchanged", () => {
  const beforeCorrection = scope({ correctionVersion: 2 });
  const afterCorrection = scope({ correctionVersion: 3 });

  assert.notEqual(quizPrefetchScopeKey(beforeCorrection), quizPrefetchScopeKey(afterCorrection));
  assert.notEqual(quizPrefetchScopeKey(beforeCorrection), quizPrefetchScopeKey(scope({ correctionVersion: 2, count: 5 })));
});

test("explicit retry starts a fresh request after a failed prefetch but joins one already in flight", async () => {
  const coordinator = new QuizPrefetchCoordinator();
  const currentScope = scope();
  await assert.rejects(coordinator.getOrStart(currentScope, async () => { throw new Error("offline"); }), /offline/u);

  let calls = 0;
  let resolveRequest;
  const start = () => {
    calls++;
    return new Promise((resolve) => { resolveRequest = resolve; });
  };
  const retry = coordinator.retry(currentScope, start);
  assert.deepEqual(coordinator.status(currentScope), { status: "pending" });
  const sameRetry = coordinator.retry(currentScope, start);
  assert.strictEqual(sameRetry, retry);
  assert.equal(calls, 1);
  resolveRequest(["ready"]);
  assert.deepEqual(await retry, ["ready"]);
  coordinator.dispose();
});

test("manual quiz retry replaces stale prefetch failure with one live status and one accessible error", () => {
  const retrying = quizPrefetchNotice("failed", "offline", true, false, 0);
  const retryFailed = quizPrefetchNotice("failed", "offline", false, true, 0);
  const retrySucceeded = quizPrefetchNotice("failed", "offline", false, false, 3);

  assert.deepEqual(retrying, { role: "status", message: "Đang chuẩn bị câu hỏi…" });
  assert.equal(retryFailed, null);
  assert.equal(retrySucceeded, null);
});

test("late quiz request status cannot replace a newer request for the same trip and count", () => {
  const oldRequest = {
    ownerId: "owner-a",
    sessionId: "trip-a",
    correctionVersion: 2,
    count: 3,
    sourceKey: "source-old",
    requestGeneration: 1,
  };
  const newRequest = {
    ...oldRequest,
    correctionVersion: 3,
    sourceKey: "source-new",
    requestGeneration: 2,
  };

  assert.equal(isCurrentQuizPrefetchRequest(oldRequest, newRequest), false);
  assert.equal(isCurrentQuizPrefetchRequest({ ...newRequest, requestGeneration: 1 }, newRequest), false);
  assert.equal(isCurrentQuizPrefetchRequest(newRequest, newRequest), true);
});

test("account and workspace disposal abort a pending request", async () => {
  const coordinator = new QuizPrefetchCoordinator();
  let signal;
  const request = coordinator.getOrStart(scope(), (nextSignal) => {
    signal = nextSignal;
    return pending(nextSignal);
  });

  coordinator.dispose();

  assert.equal(signal.aborted, true);
  await assert.rejects(request, { name: "AbortError" });
});

test("quiz prefetch builds the same canonical reviewed-source payload as manual generation", () => {
  const payload = buildQuizGenerationPayload({
    topic: "biology",
    goal: "Understand photosynthesis",
    notes: "Personal note that is replaced by the reviewed syllabus.",
    sources: [{
      id: "source-1",
      name: "Chapter 2",
      text: "Photosynthesis converts light energy into chemical energy.",
      source: "embedded-text",
      requiresReview: true,
      reviewed: true,
    }],
    materials: [{ name: "Chapter 2", sourceId: "source-1" }],
  }, 3);

  assert.deepEqual(payload, {
    topic: "biology",
    goal: "Understand photosynthesis",
    count: 3,
    documentAttached: true,
    documentText: "--- Chapter 2 ---\nPhotosynthesis converts light energy into chemical energy.",
  });
  assert.throws(() => buildQuizGenerationPayload({
    topic: "biology",
    goal: "Learn it",
    notes: "",
    sources: [{
      id: "source-1",
      name: "Chapter 2",
      text: "Unchecked content that should never reach AI.",
      source: "embedded-text",
      requiresReview: true,
      reviewed: false,
    }],
    materials: [{ name: "Chapter 2", sourceId: "source-1" }],
  }, 3), /kiểm tra/u);
});

test("quiz generation source identity changes with canonical input but leaves count to its own scope key", () => {
  const session = { topic: "biology", goal: "Study cells", notes: "A cell has a membrane.", sources: [], materials: [] };
  const countThree = buildQuizGenerationPayload(session, 3);
  const countFive = buildQuizGenerationPayload(session, 5);
  const changedSource = buildQuizGenerationPayload({ ...session, notes: "A cell contains organelles." }, 3);

  assert.equal(quizGenerationSourceKey(countThree), quizGenerationSourceKey(countFive));
  assert.notEqual(quizGenerationSourceKey(countThree), quizGenerationSourceKey(changedSource));
});

test("a pending generated guide blocks quiz fallback to only the topic and goal", () => {
  assert.throws(() => buildQuizGenerationPayload({
    topic: "biology",
    goal: "Study cells",
    notes: "",
    sources: [],
    materials: [],
    pendingStudyGuide: true,
  }, 3), /xác nhận hoặc bỏ bản ôn tập/u);
});
