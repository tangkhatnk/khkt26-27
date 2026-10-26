import test from "node:test";
import assert from "node:assert/strict";
import { emptySaved, historySessions, isCurrentOwnerWorkspace, readSaved, reconcileOwnerSnapshot, suppressRemovedSessions, writeSaved } from "../src/adventure/storage.ts";
import * as storage from "../src/adventure/storage.ts";

const rows = new Map();
globalThis.localStorage = {
  getItem(key) { return rows.get(key) ?? null; },
  setItem(key, value) { rows.set(key, value); },
  removeItem(key) { rows.delete(key); },
};

function session(id = "session-a", quiz) {
  return {
    id,
    userId: "owner-a",
    groupId: null,
    goal: "Review cell division",
    topic: "biology",
    started: 1000,
    ended: 61000,
    target: 60,
    segments: [{ start: 1000, end: 61000, kind: "focus" }],
    seconds: 60,
    contribution: 0,
    rules: "train-v1",
    ...(quiz === undefined ? {} : { quiz }),
  };
}

const feedback = [
  {
    questionId: "123e4567-e89b-42d3-a456-426614174000",
    question: "Which answer is correct?",
    options: ["A", "B", "C", "D"],
    selected: 1,
    correctIndex: 1,
    correct: true,
    explanation: "B is correct.",
    knowledgePoint: "Cell division",
  },
  {
    questionId: "123e4567-e89b-42d3-a456-426614174001",
    question: "Which answer is incorrect?",
    options: ["A", "B"],
    selected: 0,
    correctIndex: 1,
    correct: false,
    explanation: "The second answer is correct.",
    knowledgePoint: "Cell division",
  },
];

test("graded quiz and per-session answers survive an owner-scoped storage reload", () => {
  rows.clear();
  const saved = emptySaved();
  const graded = session("session-a", { score: 1, total: 2, feedback });
  saved.pending = [graded];
  saved.quizDrafts = {
    "session-a": {
      count: 2,
      requestedCount: 5,
      questions: [
        {
          id: feedback[0].questionId,
          question: feedback[0].question,
          options: feedback[0].options,
          correctAnswerIndex: 1,
          explanation: feedback[0].explanation,
          knowledgePoint: feedback[0].knowledgePoint,
        },
        {
          id: feedback[1].questionId,
          question: feedback[1].question,
          options: ["A", "B", "C", "D"],
          correctAnswerIndex: 1,
          explanation: feedback[1].explanation,
          knowledgePoint: feedback[1].knowledgePoint,
        },
      ],
      answers: {
        [feedback[0].questionId]: 1,
        [feedback[1].questionId]: 0,
      },
    },
  };
  saved.summarySessionId = "session-a";
  writeSaved("owner-a", saved);

  const reloaded = readSaved("owner-a");
  assert.equal(reloaded.pending[0].quiz?.score, 1);
  assert.equal(reloaded.pending[0].quiz?.feedback?.[1].correct, false);
  assert.equal(reloaded.quizDrafts?.["session-a"].answers[feedback[1].questionId], 0);
  assert.equal(reloaded.quizDrafts?.["session-a"].requestedCount, 5);
  assert.equal(reloaded.summarySessionId, "session-a");
});

test("old saved data without quiz fields and score-only quiz records remain readable", () => {
  rows.clear();
  const legacy = emptySaved();
  delete legacy.quizDrafts;
  delete legacy.summarySessionId;
  legacy.pending = [session("legacy", { score: 0, total: 2 })];
  rows.set("train-adventure:v1:owner-a", JSON.stringify(legacy));
  const read = readSaved("owner-a");
  assert.equal(read.quizDrafts, undefined);
  assert.equal(read.pending[0].quiz?.feedback, undefined);
});

test("owner-local material summary cache is backward-compatible, source-bound, and bounded", () => {
  rows.clear();
  const oldSaved = emptySaved();
  delete oldSaved.materialSummaries;
  rows.set("train-adventure:v1:owner-a", JSON.stringify(oldSaved));
  assert.equal(readSaved("owner-a").materialSummaries, undefined);

  assert.equal(typeof storage.cacheMaterialSummary, "function",
    "the owner-local cache needs a bounded insertion helper");
  if (typeof storage.cacheMaterialSummary !== "function") return;

  let saved = emptySaved();
  for (let index = 0; index < 20; index++) {
    saved = storage.cacheMaterialSummary(saved, `session-${index}`, `source-${index}`, {
      sourceFingerprint: String(index).padStart(64, "0"),
      summary: `Summary ${index}`,
      generatedAt: index + 1,
    });
  }
  const savedBeforeEviction = saved;
  const beforeEviction = structuredClone(savedBeforeEviction);
  saved = storage.cacheMaterialSummary(savedBeforeEviction, "session-20", "source-20", {
    sourceFingerprint: "20".padStart(64, "0"),
    summary: "Summary 20",
    generatedAt: 21,
  });
  assert.deepEqual(savedBeforeEviction, beforeEviction);
  const entries = Object.entries(saved.materialSummaries ?? {}).flatMap(([sessionId, sources]) =>
    Object.entries(sources).map(([sourceId, entry]) => ({ sessionId, sourceId, ...entry })));
  assert.equal(entries.length, 20);
  assert.equal(entries.some(({ sessionId }) => sessionId === "session-0"), false);
  assert.equal(entries.some(({ sessionId }) => sessionId === "session-20"), true);

  const tombstoned = suppressRemovedSessions(saved, ["session-20"]);
  assert.equal(tombstoned.materialSummaries?.["session-20"], undefined);

  assert.equal(typeof storage.removeMaterialSummaryCacheEntry, "function",
    "edited or re-reviewed sources need their cached summary invalidated");
  if (typeof storage.removeMaterialSummaryCacheEntry === "function") {
    const withoutSummary = storage.removeMaterialSummaryCacheEntry(saved, "session-20", "source-20");
    assert.equal(withoutSummary.materialSummaries?.["session-20"], undefined);
  }
});

test("invalid material summary cache data is rejected without overwriting the saved backup", () => {
  rows.clear();
  const saved = emptySaved();
  saved.materialSummaries = {
    "session-a": {
      "source-a": { sourceFingerprint: "not-a-sha256", summary: "Summary", generatedAt: 1 },
    },
  };
  rows.set("train-adventure:v1:owner-a", JSON.stringify(saved));
  assert.throws(() => readSaved("owner-a"), /Dữ liệu đã lưu không hợp lệ/u);
  assert.ok(rows.has("train-adventure:v1:owner-a"));

  const unexpectedSourceCopy = emptySaved();
  unexpectedSourceCopy.materialSummaries = {
    "session-a": {
      "source-a": {
        sourceFingerprint: "a".repeat(64), summary: "Summary", generatedAt: 1,
        sourceText: "The original document must never enter the cache record.",
      },
    },
  };
  rows.set("train-adventure:v1:owner-a", JSON.stringify(unexpectedSourceCopy));
  assert.throws(() => readSaved("owner-a"), /Dữ liệu đã lưu không hợp lệ/u);
  assert.ok(rows.has("train-adventure:v1:owner-a"));
});


test("malformed persisted feedback fails validation while preserving the backup", () => {
  rows.clear();
  const saved = emptySaved();
  saved.pending = [session("bad", { score: 1, total: 2, feedback: null })];
  rows.set("train-adventure:v1:owner-a", JSON.stringify(saved));
  assert.throws(() => readSaved("owner-a"), /Dữ liệu đã lưu không hợp lệ/);
  assert.ok(rows.has("train-adventure:v1:owner-a"));

  const invalidOptions = structuredClone(saved);
  invalidOptions.pending = [session("bad-options", {
    score: 1,
    total: 2,
    feedback: [
      ...feedback.slice(0, 1),
      { ...feedback[1], options: ["A", 2] },
    ],
  })];
  rows.set("train-adventure:v1:owner-a", JSON.stringify(invalidOptions));
  assert.throws(() => readSaved("owner-a"), /Dữ liệu đã lưu không hợp lệ/);

  const contradictoryScore = emptySaved();
  contradictoryScore.pending = [session("bad-score", { score: 2, total: 2, feedback })];
  rows.set("train-adventure:v1:owner-a", JSON.stringify(contradictoryScore));
  assert.throws(() => readSaved("owner-a"), /Dữ liệu đã lưu không hợp lệ/);

  const duplicateQuestionIds = emptySaved();
  duplicateQuestionIds.pending = [session("bad-ids", {
    score: 1,
    total: 2,
    feedback: [feedback[0], { ...feedback[1], questionId: feedback[0].questionId }],
  })];
  rows.set("train-adventure:v1:owner-a", JSON.stringify(duplicateQuestionIds));
  assert.throws(() => readSaved("owner-a"), /Dữ liệu đã lưu không hợp lệ/);
});

test("saved drafts are isolated by the existing account storage key", () => {
  rows.clear();
  const account = emptySaved();
  account.quizDrafts = { "account-trip": { count: 3, questions: [], answers: {} } };
  const guest = emptySaved();
  guest.quizDrafts = { "guest-trip": { count: 1, questions: [], answers: {} } };
  writeSaved("account-a", account);
  writeSaved("guest", guest);
  assert.deepEqual(Object.keys(readSaved("account-a").quizDrafts ?? {}), ["account-trip"]);
  assert.deepEqual(Object.keys(readSaved("guest").quizDrafts ?? {}), ["guest-trip"]);
});

test('verified document sources survive reload independently of erased notes',()=>{
 rows.clear();const saved=emptySaved();saved.notes['source-session']='';
 saved.materials={'source-session':[{name:'Vocabulary.pdf',size:21278187,type:'application/pdf',status:'extracted',message:'Đã kiểm tra'}]};
 saved.sources={'source-session':[{id:'source-a',name:'Vocabulary.pdf',text:'cater: phục vụ\nprinciple: nguyên lý',source:'ai-vision',requiresReview:true,reviewed:true}]};
 writeSaved('owner-a',saved);const reloaded=readSaved('owner-a');
 assert.equal(reloaded.notes['source-session'],'');assert.match(reloaded.sources['source-session'][0].text,/principle/);
 assert.equal(readSaved('owner-b').sources?.['source-session'],undefined);
});

test("owner snapshots replace pending duplicates and persist tombstones without deleting private recovery data", () => {
  const saved = emptySaved();
  saved.pending = [
    session("duplicate"),
    session("pending-only"),
    session("removed"),
  ];
  saved.local.sessions = {
    duplicate: session("duplicate"),
    pendingOnly: session("pending-only"),
    removed: session("removed"),
  };
  saved.notes.removed = "recoverable note";
  saved.sources = { removed: [{
    id: "source-removed", name: "Private chapter", text: "recoverable source",
    source: "embedded-text", requiresReview: true, reviewed: true,
  }] };
  saved.materials = { removed: [{ name: "Chapter.pdf", size: 120, type: "application/pdf", status: "saved", message: "Local" }] };
  saved.quizDrafts = { removed: { count: 1, questions: [], answers: {} } };
  saved.summarySessionId = "removed";
  const canonical = {
    ...session("duplicate"), goal: "Server-corrected goal", topic: "history", target: 90,
    correctionVersion: 2,
    effectiveMetrics: { targetSeconds: 90, elapsedSeconds: 80, actualStudySeconds: 70, focusedSeconds: 60,
      plannedBreakSeconds: 0, actualBreakSeconds: 10, distractions: 3, completed: false, quizScore: 1, quizTotal: 2 },
    correctionFlags: { goal: true, topic: true, targetSeconds: true, elapsedSeconds: false,
      actualStudySeconds: false, focusedSeconds: false, actualBreakSeconds: false, distractions: false, quizResult: false },
  };
  const serverSnapshot = {
    revision: 8,
    person: {},
    group: null,
    sessions: [canonical],
    removedSessionIds: ["removed"],
    rules: "train-v1",
  };

  const reconciled = reconcileOwnerSnapshot(saved, serverSnapshot);

  assert.deepEqual(reconciled.removedSessionIds, ["removed"]);
  assert.deepEqual(reconciled.snapshot.sessions, [canonical]);
  assert.deepEqual(reconciled.pending.map(({ id }) => id), ["pending-only"]);
  assert.deepEqual(historySessions(reconciled, "owner-a").map(({ id }) => id), ["duplicate", "pending-only"]);
  assert.equal(historySessions(reconciled, "owner-a")[0].goal, "Server-corrected goal");
  assert.equal(historySessions(reconciled, "owner-a")[0].effectiveMetrics.focusedSeconds, 60);
  assert.equal(reconciled.local.sessions.removed, undefined);
  assert.equal(reconciled.notes.removed, "recoverable note");
  assert.equal(reconciled.sources.removed[0].text, "recoverable source");
  assert.equal(reconciled.materials.removed[0].name, "Chapter.pdf");
  assert.equal(reconciled.quizDrafts.removed, undefined);
  assert.equal(reconciled.summarySessionId, undefined);
});

test("a held history POST cannot persist or queue another request after its workspace retires", async () => {
  const syncOwnerHistory = storage.syncOwnerHistory;
  assert.equal(typeof syncOwnerHistory, "function", "the app must expose its guarded history sync runner");
  if (typeof syncOwnerHistory !== "function") return;

  let activeOwner = "account-a";
  let authenticatedOwner = "account-a";
  let workspaceLive = true;
  let lockHeld = true;
  const pending = [session("first"), session("second")];
  const posted = [];
  let persisted = 0;
  let snapshotRequests = 0;
  let resolvePost;
  const postResponse = new Promise(resolve => { resolvePost = resolve; });
  const sync = syncOwnerHistory({
    isCurrent: () => lockHeld && isCurrentOwnerWorkspace("account-a", activeOwner, workspaceLive, authenticatedOwner),
    pending: () => pending,
    send: async pendingSession => {
      posted.push(pendingSession.id);
      return postResponse;
    },
    commitPending: () => { persisted++; pending.shift(); return true; },
    handleSendError: () => undefined,
    fetchSnapshot: async () => { snapshotRequests++; return { sessions: [] }; },
    commitSnapshot: () => { persisted++; return true; },
  });

  assert.deepEqual(posted, ["first"]);
  workspaceLive = false;
  lockHeld = false;
  resolvePost({ sessions: [] });
  await sync;

  assert.equal(persisted, 0);
  assert.deepEqual(posted, ["first"]);
  assert.equal(snapshotRequests, 0);
  assert.deepEqual(pending.map(({ id }) => id), ["first", "second"]);
});

test("a held history GET cannot persist after auth identity changes before workspace cleanup", async () => {
  const syncOwnerHistory = storage.syncOwnerHistory;
  assert.equal(typeof syncOwnerHistory, "function", "the app must expose its guarded history sync runner");
  if (typeof syncOwnerHistory !== "function") return;

  rows.clear();
  let storageWrites = 0;
  const originalSetItem = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = function (key, value) {
    storageWrites++;
    originalSetItem.call(this, key, value);
  };
  let activeOwner = "account-a";
  let authenticatedOwner = "account-a";
  let workspaceLive = true;
  let lockHeld = true;
  let snapshotRequests = 0;
  let saved = emptySaved();
  let resolveSnapshot;
  const snapshotResponse = new Promise(resolve => { resolveSnapshot = resolve; });
  const sync = syncOwnerHistory({
    isCurrent: () => lockHeld && isCurrentOwnerWorkspace("account-a", activeOwner, workspaceLive, authenticatedOwner),
    pending: () => saved.pending,
    send: async () => { throw new Error("no pending session should be posted"); },
    commitPending: () => { throw new Error("no pending session should be committed"); },
    handleSendError: () => undefined,
    fetchSnapshot: async () => {
      snapshotRequests++;
      saved.pending = [session("added-during-get")];
      writeSaved("account-a", saved);
      return snapshotResponse;
    },
    commitSnapshot: response => {
      saved = reconcileOwnerSnapshot(saved, response);
      writeSaved("account-a", saved);
      return true;
    },
  });

  try {
    const requestsBeforeResponse = snapshotRequests;
    const writesBeforeResponse = storageWrites;
    authenticatedOwner = "account-b";
    resolveSnapshot({
      revision: 2,
      person: {},
      group: null,
      sessions: [],
      removedSessionIds: ["added-during-get"],
      rules: "train-v1",
    });
    await sync;

    assert.equal(activeOwner, "account-a", "React ownerRef remains on the previous account until cleanup");
    assert.equal(workspaceLive, true, "the old workspace is still marked live until cleanup");
    assert.equal(lockHeld, true, "the old lock callback has not completed cleanup yet");
    assert.equal(requestsBeforeResponse, 1);
    assert.equal(writesBeforeResponse, 1, "the local pending row is saved before the account transition");
    assert.equal(storageWrites, writesBeforeResponse, "the foreign tombstone cannot trigger a persisted reconciliation");
    assert.equal(snapshotRequests, requestsBeforeResponse);
    assert.deepEqual(saved.pending.map(({ id }) => id), ["added-during-get"]);
    assert.deepEqual(readSaved("account-a").pending.map(({ id }) => id), ["added-during-get"]);
  } finally {
    globalThis.localStorage.setItem = originalSetItem;
  }
});

test("a 410 tombstone suppresses queued rows locally and keeps its ID across an older snapshot", () => {
  let saved = emptySaved();
  saved.pending = [session("removed"), session("keep")];
  saved.local.sessions = { removed: session("removed"), keep: session("keep") };
  saved.notes.removed = "private note remains";

  saved = suppressRemovedSessions(saved, ["removed"]);
  const oldSnapshot = { revision: 1, person: {}, group: null, sessions: [session("removed"), session("keep")], removedSessionIds: [], rules: "train-v1" };
  saved = reconcileOwnerSnapshot(saved, oldSnapshot);

  assert.deepEqual(saved.removedSessionIds, ["removed"]);
  assert.deepEqual(saved.pending, []);
  assert.deepEqual(historySessions(saved, "owner-a").map(({ id }) => id), ["keep"]);
  assert.equal(saved.local.sessions.removed, undefined);
  assert.equal(saved.notes.removed, "private note remains");
});

test("owner history never returns a pending row belonging to another owner", () => {
  const saved = emptySaved();
  saved.snapshot = { revision: 1, person: {}, group: null, sessions: [session("owned")], rules: "train-v1" };
  saved.pending = [{ ...session("foreign"), userId: "owner-b" }];

  assert.deepEqual(historySessions(saved, "owner-a").map(({ id }) => id), ["owned"]);
});
