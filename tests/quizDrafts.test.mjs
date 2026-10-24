import test from "node:test";
import assert from "node:assert/strict";
import { QuizRequestGuard, isQuizCount, isValidQuizDraft, isValidQuizDraftMap, quizPanelDraftState, updateQuizDrafts } from "../src/adventure/quizDrafts.ts";

const question = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  question: "What is 2 + 2?",
  options: ["3", "4", "5", "6"],
  correctAnswerIndex: 1,
  explanation: "Addition combines the two values.",
  knowledgePoint: "Addition",
};

test("quiz count accepts only whole numbers from 1 through 30", () => {
  for (const count of [1, 3, 30]) assert.equal(isQuizCount(count), true);
  for (const count of [0, 31, 1.5, "3", Number.NaN]) assert.equal(isQuizCount(count), false);
});

test("valid quiz drafts survive the same JSON round trip used by local storage", () => {
  const draft = { count: 1, questions: [question], answers: { [question.id]: 1 } };
  assert.equal(isValidQuizDraft(JSON.parse(JSON.stringify(draft))), true);
  assert.equal(isValidQuizDraft({ count: 3, questions: [], answers: {} }), true);
  assert.equal(isValidQuizDraftMap(JSON.parse(JSON.stringify({ sessionA: draft }))), true);
});

test("quiz panel adopts the current saved draft and selected count without retaining edited-source questions", () => {
  const prefetched = {
    count: 3,
    requestedCount: 5,
    questions: [question, { ...question, id: "123e4567-e89b-42d3-a456-426614174001" }, { ...question, id: "123e4567-e89b-42d3-a456-426614174002" }],
    answers: {},
  };
  const adopted = quizPanelDraftState(prefetched);
  assert.equal(adopted.countInput, "5");
  assert.deepEqual(adopted.draft, prefetched);
  assert.notStrictEqual(adopted.draft, prefetched);
  assert.notStrictEqual(adopted.draft.questions, prefetched.questions);

  const sourceEdited = quizPanelDraftState({ count: 5, requestedCount: 5, questions: [], answers: {} });
  assert.equal(sourceEdited.countInput, "5");
  assert.deepEqual(sourceEdited.draft.questions, []);
  assert.deepEqual(sourceEdited.draft.answers, {});

  assert.deepEqual(quizPanelDraftState(undefined), {
    draft: { count: 3, questions: [], answers: {} },
    countInput: "3",
  });
});

test("draft updates preserve other sessions and keep the previous saved value immutable", () => {
  const first = { count: 1, requestedCount: 5, questions: [question], answers: { [question.id]: 1 } };
  const second = { count: 2, questions: [], answers: {} };
  const original = { oldSession: second };
  const next = updateQuizDrafts(original, "session-a", first);
  assert.deepEqual(original, { oldSession: second });
  assert.deepEqual(next, { oldSession: second, "session-a": first });
  const removed = updateQuizDrafts(next, "session-a", null);
  assert.deepEqual(removed, { oldSession: second });
  assert.equal(isValidQuizDraft(JSON.parse(JSON.stringify(removed.oldSession))), true);
});

test("malformed or inconsistent quiz drafts are rejected without discarding other saved data", () => {
  const invalid = [
    { count: 0, questions: [], answers: {} },
    { count: 31, questions: [], answers: {} },
    { count: 1, questions: [question, { ...question, id: "123e4567-e89b-42d3-a456-426614174001" }], answers: {} },
    { count: 3, questions: [question], answers: { missing: 0 } },
    { count: 1, questions: [question], answers: { [question.id]: 4 } },
    { count: 1, questions: [{ ...question, correctAnswerIndex: 4 }], answers: {} },
    { count: 1, questions: [{ ...question, options: ["a", "b", "c", "d", "e"] }], answers: {} },
    { count: 1, questions: [{ ...question, options: ["same", "same", "c", "d"] }], answers: {} },
    { count: 2, questions: [question], answers: {} },
    { count: 1, questions: [{ ...question, id: "q1" }], answers: {} },
  ];
  for (const draft of invalid) assert.equal(isValidQuizDraft(draft), false);
  assert.equal(isValidQuizDraftMap({ sessionA: invalid[0] }), false);
  const savedBackup = { active: null, quizDrafts: { sessionA: invalid[0] }, notes: { sessionA: "private" } };
  assert.equal(savedBackup.notes.sessionA, "private");
  assert.equal(isValidQuizDraft(savedBackup.quizDrafts.sessionA), false);
});

test("new quiz requests invalidate older results and owner/session changes", () => {
  const guard = new QuizRequestGuard();
  const first = guard.begin("owner-a", "session-a");
  const second = guard.begin("owner-a", "session-a");
  assert.equal(guard.isCurrent(first, "owner-a", "session-a"), false);
  assert.equal(guard.isCurrent(second, "owner-a", "session-a"), true);
  assert.equal(guard.isCurrent(second, "owner-b", "session-a"), false);
  assert.equal(guard.isCurrent(second, "owner-a", "session-b"), false);
  guard.invalidate();
  assert.equal(guard.isCurrent(second, "owner-a", "session-a"), false);
});
