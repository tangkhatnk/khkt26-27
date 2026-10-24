import test from "node:test";
import assert from "node:assert/strict";
import { emptySaved, readSaved, writeSaved } from "../src/adventure/storage.ts";

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
