import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("AdventureApp gates pending exercise starts and keeps the focus viewer question-only", async () => {
  const adventure = await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8");
  const flow = await readFile(resolve(projectRoot, "src/adventure/useStudyExerciseFlow.ts"), "utf8");

  assert.match(adventure, /startStudyExerciseFocusIfAllowed\(/u);
  assert.match(adventure, /startResult === "needs-skip-choice"/u);
  assert.match(adventure, /Hủy và chờ đề/u);
  assert.match(adventure, /Bỏ qua bài tập và bắt đầu phiên học/u);
  assert.match(adventure, /onStudyExerciseFocusStarted\(trip\.id\)/u);
  assert.match(flow, /bindStudyExercises\(sessionId, controller\.signal\)/u);
  assert.match(adventure, /StudyExerciseQuestionViewer preparation=\{studyExercisePreparation\} phase="focus"/u);
  assert.match(adventure, /StudyExerciseQuestionViewer preparation=\{studyExercisePreparation\} phase="focus"\s*\/>/u);
});

test("summary solution loading awaits sync and rechecks persisted completion and live scope", async () => {
  const adventure = await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8");
  const flow = await readFile(resolve(projectRoot, "src/adventure/useStudyExerciseFlow.ts"), "utf8");

  assert.match(adventure, /effectiveMetrics\?\.completed === true/u);
  assert.match(flow, /loadStudyExerciseSolutionsAfterSync\(\{/u);
  assert.match(flow, /sync: \(\) => syncRef\.current\(\)/u);
  assert.match(flow, /latest\.isRouteScopeCurrent\(ownerId, sessionId, "summary"\)/u);
  assert.match(flow, /requestStudyExerciseSolutions\(stored\.id, controller\.signal\)/u);
  assert.match(flow, /onRejected: clearLoading/u);
  assert.match(adventure, /phase="summary"/u);
});

test("summary hydration does not restart its lookup when local sources are absent", async () => {
  const adventure = await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8");
  const flow = await readFile(resolve(projectRoot, "src/adventure/useStudyExerciseFlow.ts"), "utf8");

  assert.match(adventure, /summarySources:\s*studyExerciseSourcesForSession\(saved\.sources, summarySession\?\.id\)/u);
  assert.match(flow, /getSources:\s*\(\) => input\.targetView === "summary" \? summarySourcesRef\.current : input\.sources/u);
  assert.doesNotMatch(flow, /options\.exclusive, summarySessionId, options\.summarySources, hydrate/u);
});
