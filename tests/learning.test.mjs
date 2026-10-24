import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeSession,
  distractionCount,
  knowledgeGaps,
  reviewPlan,
} from '../src/adventure/learning.ts';

const session = (overrides = {}) => ({
  id: 'trip-1', userId: 'guest', groupId: null,
  goal: 'Read photosynthesis', topic: 'biology',
  started: 1000, ended: 61000, target: 600,
  segments: [
    { start: 1000, end: 11000, kind: 'focus' },
    { start: 11000, end: 21000, kind: 'distraction' },
    { start: 21000, end: 31000, kind: 'focus' },
    { start: 31000, end: 61000, kind: 'distraction' },
  ],
  seconds: 20, contribution: 20, rules: 'train-v1',
  ...overrides,
});

test('an explicit zero distraction count takes precedence over distraction segments', () => {
  assert.equal(distractionCount(session({ distractions: 0 })), 0);
});

test('legacy sessions count distinct distraction segments when no explicit count exists', () => {
  assert.equal(distractionCount(session()), 2);
});

test('a zero-duration session has no confident focus assessment', () => {
  const result = analyzeSession(session({ started: 5000, ended: 5000, seconds: 30, segments: [], distractions: 0 }));

  assert.equal(result.elapsedSeconds, 0);
  assert.equal(result.focusedSeconds, 0);
  assert.equal(result.focusPercent, null);
  assert.equal(result.focusLabel, 'Chưa đủ dữ liệu');
  assert.match(result.focusExplanation, /chưa đủ thời gian/i);
  assert.match(result.focusExplanation, /0 giây/i);
  assert.match(result.focusExplanation, /0 lần/i);
});

test('session analysis uses actual elapsed time and caps focus to that elapsed time', () => {
  const long = analyzeSession(session({
    ended: 1000 + 90 * 60 * 1000,
    target: 600,
    seconds: 6000,
  }));
  const short = analyzeSession(session({
    ended: 1000 + 30 * 1000,
    target: 3600,
    seconds: 45,
  }));

  assert.equal(long.elapsedSeconds, 5400);
  assert.equal(long.focusedSeconds, 5400);
  assert.equal(long.focusPercent, 100);
  assert.equal(short.elapsedSeconds, 30);
  assert.equal(short.focusedSeconds, 30);
  assert.equal(short.focusPercent, 100);
});

test('planned breaks are reported as rest and excluded from focus quality time', () => {
  const result = analyzeSession(session({
    started: 1000,
    ended: 421000,
    target: 600,
    breakPlan: { count: 1, seconds: 120 },
    segments: [
      { start: 1000, end: 301000, kind: 'focus' },
      { start: 301000, end: 421000, kind: 'break' },
    ],
    seconds: 300,
    distractions: 0,
  }));

  assert.equal(result.elapsedSeconds, 420);
  assert.equal(result.breakSeconds, 120);
  assert.equal(result.studyElapsedSeconds, 300);
  assert.equal(result.focusedSeconds, 300);
  assert.equal(result.focusPercent, 100);
});

test('focus labels use the stated 80 and 50 percent thresholds', () => {
  const at80 = analyzeSession(session({ ended: 101000, seconds: 80 }));
  const at50 = analyzeSession(session({ ended: 101000, seconds: 50 }));
  const below50 = analyzeSession(session({ ended: 101000, seconds: 49 }));

  assert.deepEqual(
    [at80.focusLabel, at50.focusLabel, below50.focusLabel],
    ['Tập trung tốt', 'Có gián đoạn', 'Cần cải thiện'],
  );
  assert.match(at80.focusExplanation, /80%/);
  assert.match(at50.focusExplanation, /50%/);
  assert.match(below50.focusExplanation, /50%/);
});

test('focus explanation adds duration and interruption context without changing the focus percentage', () => {
  const uninterrupted = analyzeSession(session({ ended: 101000, seconds: 80, distractions: 0 }));
  const interrupted = analyzeSession(session({ ended: 101000, seconds: 80, distractions: 3 }));

  assert.equal(uninterrupted.focusPercent, interrupted.focusPercent);
  assert.equal(uninterrupted.focusLabel, interrupted.focusLabel);
  assert.match(interrupted.focusExplanation, /1 phút 40 giây/);
  assert.match(uninterrupted.focusExplanation, /0 lần rời phiên/);
  assert.match(interrupted.focusExplanation, /3 lần rời phiên/);
  assert.match(interrupted.focusExplanation, /80%/);
  assert.match(interrupted.focusExplanation, /tắt thông báo/i);
});

test('no quiz gives no quiz percentage or knowledge claim', () => {
  const result = analyzeSession(session());

  assert.equal(result.quizPercent, null);
  assert.equal(result.knowledgeLabel, 'Chưa có dữ liệu quiz');
});

test('score-only legacy quizzes retain the percentage but make no topic claim', () => {
  const oldQuiz = { score: 3, total: 4 };
  const result = analyzeSession(session({ quiz: oldQuiz }));

  assert.equal(result.quizPercent, 75);
  assert.equal(result.knowledgeLabel, 'Có điểm quiz nhưng thiếu dữ liệu theo từng câu');
  assert.deepEqual(knowledgeGaps(oldQuiz), []);
});

test('perfect detailed quizzes distinguish quiz evidence from a mastery claim', () => {
  const quiz = {
    score: 2, total: 2,
    feedback: [
      { questionId: 'q1', question: 'Question 1', options: ['A', 'B'], selected: 1, correctIndex: 1, correct: true, explanation: 'Right', knowledgePoint: 'Cells' },
      { questionId: 'q2', question: 'Question 2', options: ['A', 'B'], selected: 0, correctIndex: 0, correct: true, explanation: 'Right', knowledgePoint: 'Genetics' },
    ],
  };
  const result = analyzeSession(session({ quiz }));

  assert.equal(result.quizPercent, 100);
  assert.equal(result.knowledgeLabel, 'Không ghi nhận câu sai trong quiz này');
  assert.deepEqual(knowledgeGaps(quiz), []);
});

test('knowledge gaps group normalized labels, count all answers, and retain wrong feedback', () => {
  const first = { questionId: 'q1', question: 'Q1', options: ['A', 'B'], selected: 0, correctIndex: 1, correct: false, explanation: 'Review this', knowledgePoint: '  Quang Hợp ' };
  const second = { questionId: 'q2', question: 'Q2', options: ['A', 'B'], selected: 1, correctIndex: 1, correct: true, explanation: 'Correct', knowledgePoint: 'QUANG HỢP' };
  const thirdSamePoint = { questionId: 'q3', question: 'Q3', options: ['A', 'B'], selected: 1, correctIndex: 1, correct: true, explanation: 'Correct', knowledgePoint: '　ＱＵＡＮＧ ＨỢＰ　' };
  const fourth = { questionId: 'q4', question: 'Q4', options: ['A', 'B'], selected: 0, correctIndex: 1, correct: false, explanation: 'Review this too', knowledgePoint: 'Tế bào' };
  const fifth = { questionId: 'q5', question: 'Q5', options: ['A', 'B'], selected: 0, correctIndex: 1, correct: false, explanation: 'Review DNA', knowledgePoint: ' DNA ' };
  const sixth = { questionId: 'q6', question: 'Q6', options: ['A', 'B'], selected: 1, correctIndex: 1, correct: true, explanation: 'Correct', knowledgePoint: 'dna' };
  const quiz = { score: 3, total: 6, feedback: [first, second, thirdSamePoint, fourth, fifth, sixth] };

  assert.deepEqual(knowledgeGaps(quiz), [
    { knowledgePoint: 'Quang Hợp', wrong: 1, total: 3, feedback: [first] },
    { knowledgePoint: 'Tế bào', wrong: 1, total: 1, feedback: [fourth] },
    { knowledgePoint: 'DNA', wrong: 1, total: 2, feedback: [fifth] },
  ]);
  assert.equal(analyzeSession(session({ quiz })).knowledgeLabel, 'Có nội dung cần ôn lại');
});

test('review plan uses quiz gaps, clamps duration, preserves private material, and does not mutate input', () => {
  const quiz = {
    score: 1, total: 2,
    feedback: [
      { questionId: 'q1', question: 'Q1', options: ['A', 'B'], selected: 0, correctIndex: 1, correct: false, explanation: 'Review', knowledgePoint: 'Cell division' },
      { questionId: 'q2', question: 'Q2', options: ['A', 'B'], selected: 1, correctIndex: 1, correct: true, explanation: 'Correct', knowledgePoint: 'Cell division' },
    ],
  };
  const original = session({ target: 3601, quiz });
  const originalCopy = structuredClone(original);
  const materials = [{ name: 'Notes.pdf', size: 1200, type: 'application/pdf', status: 'extracted', message: 'Ready' }];
  const plan = reviewPlan(original, 'private notes stay local', materials);

  assert.deepEqual(plan, {
    goal: 'Ôn lại: Cell division', topic: 'biology', minutes: 61,
    documentText: 'private notes stay local', materials,
  });
  assert.notStrictEqual(plan.materials, materials);
  assert.notStrictEqual(plan.materials[0], materials[0]);
  assert.deepEqual(original, originalCopy);
  plan.materials[0].name = 'changed';
  assert.equal(materials[0].name, 'Notes.pdf');
});

test('review plan prefixes the old goal when evidence has no gaps and bounds goal length', () => {
  const plan = reviewPlan(session({ goal: '學習'.repeat(250), target: 0 }), '');

  assert.equal(plan.goal.length, 500);
  assert.ok(plan.goal.startsWith('Ôn lại: '));
  assert.equal(plan.topic, 'biology');
  assert.equal(plan.minutes, 1);
  assert.equal(plan.documentText, '');
  assert.deepEqual(plan.materials, []);
});

test('review goal stays within 500 UTF-16 units without splitting an emoji', () => {
  const plan = reviewPlan(session({ goal: '📚'.repeat(250) }), '');
  const unpairedSurrogate = /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u;

  assert.ok(plan.goal.length <= 500);
  assert.ok(plan.goal.startsWith('Ôn lại: '));
  assert.ok(plan.goal.endsWith('…'));
  assert.doesNotMatch(plan.goal, unpairedSurrogate);
});

test('review duration never exceeds the maximum supported 240 minutes', () => {
  assert.equal(reviewPlan(session({ target: 20000 }), '').minutes, 240);
});
