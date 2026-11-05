import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adventureApp = await readFile(new URL("../src/adventure/AdventureApp.tsx", import.meta.url), "utf8");

function extractFinish(source) {
  const normalizedSource = source.replace(/\r\n?/gu, "\n");
  const finishStart = normalizedSource.indexOf("function finish() {");
  const finishEnd = normalizedSource.indexOf("\n  useEffect(() => {\n    finishRef.current", finishStart);
  return finishStart >= 0 && finishEnd > finishStart
    ? normalizedSource.slice(finishStart, finishEnd)
    : "";
}

const finish = extractFinish(adventureApp);

test("finish wiring extraction accepts CRLF source checkouts", () => {
  const lfAdventureApp = adventureApp.replace(/\r\n?/gu, "\n");
  const crlfAdventureApp = adventureApp.replace(/\r?\n/gu, "\r\n");
  const expectedFinish = "const s: Session = {";
  const lfFinish = extractFinish(lfAdventureApp);
  const crlfFinish = extractFinish(crlfAdventureApp);

  assert.ok(lfFinish.includes(expectedFinish));
  assert.ok(crlfFinish.includes(expectedFinish));
});

test("the real focus finish path applies scheduled-duration eligibility before lesson review", () => {
  assert.ok(finish.includes("const s: Session = {"));
  assert.ok(finish.indexOf("started: next.started,") < finish.indexOf("ended: sessionEndAt(trip, at),"));
  assert.ok(finish.indexOf("ended: sessionEndAt(trip, at),") < finish.indexOf("target: next.target,"));
  assert.ok(finish.includes("breakPlan: next.breakPlan,"));
  assert.ok(finish.includes("value.learningPath = finishLessonFocus(value.learningPath, s);"));
});

test("interrupted lesson retry is resolved by persisted session identity rather than the editable goal", () => {
  const summaryStart = adventureApp.indexOf("const summaryInterruptedLesson =");
  const summaryEnd = adventureApp.indexOf("const summaryLearningRun =", summaryStart);
  const summary = summaryStart >= 0 && summaryEnd > summaryStart
    ? adventureApp.slice(summaryStart, summaryEnd)
    : "";

  assert.match(summary, /interruptedLessonForSession\(learningPathProgress, summarySession\.id\)/u);
  assert.doesNotMatch(summary, /summarySession\.goal/u);
});

test("local daily quiz metrics receive guest grades as a private projection", () => {
  assert.match(adventureApp, /guestQuizResultsForDailySummary\(owner, sessions, saved\.quizDrafts\)/u);
});

test("the private guest journal row reads its grade without writing it into session history", () => {
  const journalStart = adventureApp.indexOf('view === "journal"');
  const historyStart = adventureApp.indexOf('view === "experiments"', journalStart);
  const journal = journalStart >= 0 && historyStart > journalStart
    ? adventureApp.slice(journalStart, historyStart)
    : "";

  assert.match(journal, /owner === "guest" \? guestQuizGradesBySession\.get\(s\.id\) : undefined/u);
  assert.match(journal, /Điểm quiz riêng: \$\{privateGuestGrade\.score\}\/\$\{privateGuestGrade\.total\}/u);
  assert.match(journal, /privateGuestGrade\s*\?\s*"Xem đáp án trong tổng kết"\s*:\s*s\.quiz\?\.feedback/u);
  assert.doesNotMatch(journal, /s\.quiz\s*=/u);
});
