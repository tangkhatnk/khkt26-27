import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adventureApp = await readFile(new URL("../src/adventure/AdventureApp.tsx", import.meta.url), "utf8");

function normalizeLineEndings(source) {
  return source.replace(/\r\n?/gu, "\n");
}

function extractFinish(source) {
  const normalizedSource = normalizeLineEndings(source);
  const finishStart = normalizedSource.indexOf("function finish() {");
  const finishEnd = normalizedSource.indexOf("\n  useEffect(() => {\n    finishRef.current", finishStart);
  return finishStart >= 0 && finishEnd > finishStart
    ? normalizedSource.slice(finishStart, finishEnd)
    : "";
}

function extractTicketView(source) {
  const normalizedSource = normalizeLineEndings(source);
  const start = normalizedSource.indexOf('{view === "ticket" && (');
  const end = normalizedSource.indexOf('{view === "focus" &&', start);
  return start >= 0 && end > start ? normalizedSource.slice(start, end) : "";
}

function extractTicketEditor(source) {
  const normalizedSource = normalizeLineEndings(source);
  const start = normalizedSource.indexOf("function TicketEditor(");
  const end = normalizedSource.indexOf("\n}\n\nfunction Heading", start);
  return start >= 0 && end > start ? normalizedSource.slice(start, end) : "";
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

test("ticket wiring slices accept both LF and CRLF checkouts", () => {
  const crlfAdventureApp = normalizeLineEndings(adventureApp).replace(/\n/gu, "\r\n");

  assert.equal(extractTicketView(crlfAdventureApp), extractTicketView(adventureApp));
  assert.equal(extractTicketEditor(crlfAdventureApp), extractTicketEditor(adventureApp));
});

test("the ticket flow uses the shared preparation summary and neutral personal start copy", () => {
  const ticket = extractTicketView(adventureApp);

  assert.match(ticket, /<StudyPreparationSummary\b/u);
  assert.ok(ticket.indexOf("<StudyPreparationSummary") < ticket.indexOf("<BoardingTicket"));
  assert.match(ticket, /kicker="CHUẨN BỊ BUỔI HỌC"/u);
  assert.doesNotMatch(ticket, /text="[^"]*lên tàu/u);
  assert.doesNotMatch(ticket, /departure-intro[^>]*>[^<]*lên tàu/u);
  assert.match(ticket, /: "Bắt đầu buổi học · "/u);
  assert.doesNotMatch(ticket, /: "Bắt đầu chuyến · "/u);
  assert.match(ticket, /Khởi hành cùng lúc · /u);
  assert.match(ticket, /Bắt đầu phiên cho chuyến chung · /u);
  assert.match(adventureApp, /ticket: "Chuẩn bị"/u);
  const editor = extractTicketEditor(adventureApp);
  assert.match(editor, /Chỉnh mục tiêu và thời gian/u);
  assert.doesNotMatch(editor, /Sửa vé chuyến học/u);
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
  assert.match(journal, /Điểm Quiz AI riêng: \$\{privateGuestGrade\.score\}\/\$\{privateGuestGrade\.total\}/u);
  assert.match(journal, /`Điểm quiz: \$\{s\.quiz\.score\}\/\$\{s\.quiz\.total\}`/u);
  assert.match(journal, /Chưa có kết quả quiz/u);
  assert.match(journal, /privateGuestGrade\s*\?\s*"Xem đáp án trong tổng kết"\s*:\s*s\.quiz\?\.feedback/u);
  assert.doesNotMatch(journal, /s\.quiz\s*=/u);
});
