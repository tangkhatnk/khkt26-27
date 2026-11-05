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

function extractStudyWorkspace(source) {
  const normalizedSource = normalizeLineEndings(source);
  const start = normalizedSource.indexOf("<StudyPlanWorkspace");
  const end = normalizedSource.indexOf("</StudyPlanWorkspace>", start);
  return start >= 0 && end > start ? normalizedSource.slice(start, end + "</StudyPlanWorkspace>".length) : "";
}

function extractWorkspaceSettings(source) {
  const normalizedSource = normalizeLineEndings(source);
  const start = normalizedSource.indexOf("<StudyWorkspaceSettings");
  const end = normalizedSource.indexOf("/>", start);
  return start >= 0 && end > start ? normalizedSource.slice(start, end + 2) : "";
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

test("goal-first workspace wiring slices accept both LF and CRLF checkouts", () => {
  const crlfAdventureApp = normalizeLineEndings(adventureApp).replace(/\n/gu, "\r\n");

  assert.equal(extractStudyWorkspace(crlfAdventureApp), extractStudyWorkspace(adventureApp));
  assert.equal(extractWorkspaceSettings(crlfAdventureApp), extractWorkspaceSettings(adventureApp));
});

test("the primary station renders the goal-first workspace and keeps journey detail optional", async () => {
  const workspace = extractStudyWorkspace(adventureApp);
  const settings = extractWorkspaceSettings(adventureApp);
  const workspaceComponent = await readFile(new URL("../src/adventure/StudyPlanWorkspace.tsx", import.meta.url), "utf8");

  assert.match(workspace, /<StudyPlanWorkspace\s+goal=\{goal\}/u);
  assert.match(workspace, /legacyDetails=\{<BoardingTicket/u);
  assert.match(settings, /legacyDisclosure=\{view === "ticket"\}/u);
  assert.match(settings, /onGoalChange=\{\(value\) => persistQuickTripStudyDraft/u);
  assert.match(settings, /onDurationChange=\{\(value\) => persistQuickTripStudyDraft/u);
  assert.match(workspaceComponent, /<summary>Chi tiết hành trình cũ<\/summary>/u);
  assert.match(adventureApp, /ticket: "Chuẩn bị"/u);
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

test("the owner-scoped journal uses a private grade projection without mutating sessions", () => {
  const projectionStart = adventureApp.indexOf("const studyJournalEntries = useMemo(");
  const projectionEnd = adventureApp.indexOf("const selectedLearningCourse", projectionStart);
  const projection = projectionStart >= 0 && projectionEnd > projectionStart
    ? adventureApp.slice(projectionStart, projectionEnd)
    : "";
  const journalStart = adventureApp.indexOf('view === "journal"');
  const historyStart = adventureApp.indexOf('view === "experiments"', journalStart);
  const journal = journalStart >= 0 && historyStart > journalStart
    ? adventureApp.slice(journalStart, historyStart)
    : "";

  assert.match(projection, /buildStudyJournalSources\(\{[\s\S]*ownerId: owner,[\s\S]*sessions,[\s\S]*learningPath: learningPathProgress,[\s\S]*quizDrafts: saved\.quizDrafts/u);
  assert.match(journal, /<StudyJournal[\s\S]*entries=\{studyJournalEntries\}/u);
  assert.match(journal, /sessions\.find\(\(item\) => item\.id === id && item\.userId === owner\)/u);
  assert.doesNotMatch(projection, /session\.quiz\s*=/u);
});
