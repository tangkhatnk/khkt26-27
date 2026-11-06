import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createStudyPlanStorage, updateStudyPlanDraftFromQuickTrip } from "../src/adventure/studyPlanStorage.ts";
import { createQuickTripDraft, updateQuickTripDraft } from "../src/adventure/quickTripDraft.ts";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function normalizedApp(source) {
  return source.replace(/\r\n?/gu, "\n");
}

test("planner generation and step selection update the synchronous draft before unrelated edits", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const generateStart = app.indexOf("const planId = crypto.randomUUID()");
  const generateEnd = app.indexOf('setStudyPlanStatus("ready")', generateStart);
  const generation = app.slice(generateStart, generateEnd);
  const selectStart = app.indexOf("function selectStudyPlanStep(");
  const persistStart = app.indexOf("function persistQuickTripStudyDraft", selectStart);
  const selection = app.slice(selectStart, persistStart);

  assert.notEqual(generateStart, -1);
  assert.notEqual(generateEnd, -1);
  assert.match(generation, /updateQuickTripDraft\(quickTripDraft,[\s\S]*?selectedPlanId: planId,[\s\S]*?selectedStepId: steps\[0\]\.id/u);
  assert.match(generation, /saveStudyWorkspaceDraft\(nextStorage,[\s\S]*?notes: documentText,[\s\S]*?sources,[\s\S]*?materials/u);
  assert.match(selection, /updateQuickTripDraft\(quickTripDraft,[\s\S]*?selectedPlanId: plan\.id,[\s\S]*?selectedStepId: stepId/u);
  assert.match(selection, /setDraftTripId\(plannedSessionId\)/u);
  assert.match(selection, /draftSessionIdsRef\.current\.solo = plannedSessionId/u);
  assert.doesNotMatch(selection, /setMinutes\(/u);

  const quick = { current: createQuickTripDraft({
    goal: "Mục tiêu cũ", selectedPlanId: "plan-old", selectedStepId: "step-old",
  }) };
  updateQuickTripDraft(quick, { selectedPlanId: "plan-new", selectedStepId: "step-one" });
  updateQuickTripDraft(quick, { selectedPlanId: "plan-new", selectedStepId: "step-two" });
  updateQuickTripDraft(quick, { minutes: 90 });
  const persisted = updateStudyPlanDraftFromQuickTrip(
    createStudyPlanStorage({ legacyActivity: true }).draft,
    quick.current,
    "Sinh học",
  );
  assert.equal(persisted.selectedPlanId, "plan-new");
  assert.equal(persisted.selectedStepId, "step-two");
  assert.equal(persisted.preferredMinutes, 90);
});

test("unstarted notes and extracted sources are saved and restored for the exact workspace candidate", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const loadStart = app.indexOf("const value = readSaved(owner)");
  const legacyStart = app.indexOf("if (pathRun && (pathRun.phase", loadStart);
  const load = app.slice(loadStart, legacyStart);
  const saveStart = app.indexOf("function persistStudyWorkspaceDraft(");
  const saveEnd = app.indexOf("function updateQuizPrefetchPreference", saveStart);
  const save = app.slice(saveStart, saveEnd);
  const switchStart = app.indexOf("function selectStudyPlanStep(");
  const switchEnd = app.indexOf("function persistQuickTripStudyDraft", switchStart);
  const switchStep = app.slice(switchStart, switchEnd);

  assert.notEqual(loadStart, -1);
  assert.notEqual(legacyStart, -1);
  assert.match(load, /selectedStudyWorkspaceIdentity\(/u);
  assert.match(load, /findStudyWorkspaceDraft\(/u);
  assert.match(load, /setDraftTripId\(workspaceIdentity\.sessionId\)/u);
  assert.match(load, /setDocumentText\(workspaceDraft\?\.notes \?\? ""\)/u);
  assert.match(load, /setSources\(structuredClone\(workspaceDraft\?\.sources \?\? \[\]\)\)/u);
  assert.match(load, /setMaterials\(structuredClone\(workspaceDraft\?\.materials \?\? \[\]\)\)/u);
  assert.match(save, /saveStudyWorkspaceDraft\(/u);
  assert.match(save, /notes: changes\.notes \?\? documentText/u);
  assert.match(save, /sources: changes\.sources \?\? sources/u);
  assert.match(save, /materials: changes\.materials \?\? materials/u);
  assert.match(save, /if \(!saved\) return false/u);
  assert.match(save, /catch \(error\)[\s\S]*?setError\(error instanceof Error[\s\S]*?return false;/u);
  assert.match(switchStep, /saveStudyWorkspaceDraft\(/u);
  assert.match(switchStep, /findStudyWorkspaceDraft\(/u);
  assert.match(switchStep, /setDocumentText\(targetDraft\?\.notes \?\? ""\)/u);
  assert.match(switchStep, /setSources\(structuredClone\(targetDraft\?\.sources \?\? \[\]\)\)/u);
  assert.match(switchStep, /setMaterials\(structuredClone\(targetDraft\?\.materials \?\? \[\]\)\)/u);
  const acceptStart = app.indexOf("function acceptStudyGuide(");
  const acceptEnd = app.indexOf("function discardStudyGuideDraft", acceptStart);
  const accept = app.slice(acceptStart, acceptEnd);
  assert.match(accept, /if \(!persistStudyWorkspaceDraft\(\{ notes: nextNotes, sources: nextSources, materials: nextMaterials \}\)\) return;/u);
  assert.ok(accept.indexOf("persistStudyWorkspaceDraft") < accept.indexOf("setSources(nextSources)"));
  assert.match(accept, /if \(mode === "replace"\)[\s\S]*?setDocumentText\(nextNotes\)/u);
});

test("inactive legacy review runs hydrate the current draft and ticket recovery binds private content to its candidate", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const loadStart = app.indexOf("const value = readSaved(owner)");
  const recoveryStart = app.indexOf("if (pathRun && (pathRun.phase", loadStart);
  const migrationStart = app.indexOf("const runCourse = CURATED_COURSES.find", recoveryStart);
  const migrationEnd = app.indexOf("if (value.active)", migrationStart);
  const hydration = app.slice(loadStart, recoveryStart);
  const migration = app.slice(migrationStart, migrationEnd);

  assert.match(hydration, /if \(!value\.active && \(!pathRun \|\| pathRun\.phase === "review"\)\)/u);
  assert.match(migration, /candidateSessionId: pathRun\.sessionId/u);
  assert.match(migration, /saveStudyWorkspaceDraft\(/u);
  assert.match(migration, /planId: null,[\s\S]*?stepId: null,[\s\S]*?notes: recoveredText,[\s\S]*?sources: recoveredSources,[\s\S]*?materials: recoveredMaterials/u);
});

test("step editor save returns the actual owner-local commit result", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const saveStart = app.indexOf("function saveStudyPlanStep(");
  const saveEnd = app.indexOf("function persistStudyWorkspaceDraft", saveStart);
  const save = app.slice(saveStart, saveEnd);

  assert.notEqual(saveStart, -1);
  assert.match(save, /applyStudyPlanStepPatch\(/u);
  assert.match(save, /commit\(\{ \.\.\.value, studyPlanStorage: nextStorage \}\)/u);
  assert.match(save, /if \(!commit\([\s\S]*?\)\) return false/u);
  assert.match(save, /return true;/u);
  assert.match(app, /onSaveStep=\{saveStudyPlanStep\}/u);
});

test("selected-step source controls keep private summaries inside the workspace request scope", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const sourceStart = app.indexOf("{sources.map((source) =>");
  const sourceEnd = app.indexOf("{!!materials.length", sourceStart);
  const workspaceSources = app.slice(sourceStart, sourceEnd);
  const requestStart = app.indexOf("async function generateMaterialSummary(");
  const requestEnd = app.indexOf("const resolveCurrentQuizSession", requestStart);
  const request = app.slice(requestStart, requestEnd);
  const responseStart = request.indexOf("const isCurrent = () => {");
  const responseEnd = request.indexOf("setMaterialSummaryUi({", responseStart);
  const responseGuard = request.slice(responseStart, responseEnd);

  assert.notEqual(sourceStart, -1);
  assert.notEqual(sourceEnd, -1);
  assert.match(workspaceSources, /<MaterialSummaryControl/u);
  assert.match(workspaceSources, /generateMaterialSummary\(draftTripId, source\.id, targetView\)/u);
  assert.doesNotMatch(workspaceSources, /PublicMaterialSummaryControl/u);
  assert.match(request, /targetView: MaterialSummaryScope\["view"\]/u);
  assert.match(request, /context\.draftTripId === sessionId/u);
  assert.match(request, /selectedPlanId === active\.planId/u);
  assert.match(request, /selectedStepId === active\.stepId/u);
  assert.match(request, /canRequestMaterialSummary\(/u);
  assert.match(request, /onboarding\.phase === "complete"/u);
  assert.match(responseGuard, /canApplyMaterialSummaryResponse\(/u);
  assert.doesNotMatch(responseGuard, /hasEligibleAccess\(/u);
});

test("legacy group bookmarks resolve to the revision library and automatic corrections replace history", async () => {
  const navigation = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/navigation.ts"), "utf8"));
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));

  assert.match(navigation, /export function canonicalStudyView\(/u);
  assert.match(navigation, /requestedView === "group" \? "library"/u);
  assert.match(navigation, /export function replaceBrowserView\(/u);
  assert.match(app, /canonicalStudyView\(requestedView/u);
  assert.match(app, /replaceBrowserView\(view\)/u);
  assert.match(app, /id: "library"[\s\S]*?label: "Thư viện ôn tập"/u);
  assert.doesNotMatch(app, /id: "group"[\s\S]*?label: "Học cùng bạn"/u);
});

test("revision library wiring maps only owner history and private workspace metadata", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const libraryStart = app.indexOf("<RevisionMaterialsLibrary");
  const libraryEnd = app.indexOf("/>", libraryStart);
  const library = app.slice(libraryStart, libraryEnd);

  assert.notEqual(libraryStart, -1);
  assert.match(app, /import \{ RevisionMaterialsLibrary \}/u);
  assert.match(app, /buildRevisionMaterialEntries\(/u);
  assert.match(app, /sessions\.filter\(\(session\) => session\.userId === owner\)/u);
  assert.match(library, /entries=\{revisionMaterialEntries\}/u);
  assert.match(library, /onPreview=\{previewRevisionMaterial\}/u);
  assert.match(library, /onUseInPlan=\{useRevisionMaterialInPlan\}/u);
  assert.match(library, /onAddNotes=/u);
  assert.match(library, /onAddFiles=/u);
  assert.match(library, /onComposeWithAI=/u);
});

test("opening a saved plan source switches to its exact step while retaining manual duration", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const selectStart = app.indexOf("function selectStudyPlanStep(");
  const selectEnd = app.indexOf("function persistQuickTripStudyDraft", selectStart);
  const selection = app.slice(selectStart, selectEnd);

  assert.match(selection, /targetPlanId\?: string/u);
  assert.match(selection, /currentStorage\.plans\.find\(\(entry\) => entry\.id === \(targetPlanId \?\? currentStorage\.draft\.selectedPlanId\)\)/u);
  assert.match(selection, /findStudyWorkspaceDraft\(nextStorage, targetIdentity\)/u);
  assert.match(selection, /setSources\(structuredClone\(targetDraft\?\.sources \?\? \[\]\)\)/u);
  assert.doesNotMatch(selection, /setMinutes\(/u);
  assert.doesNotMatch(selection, /^\s*minutes:/mu);
});

test("legacy ticket bookmarks use the same single workspace and plan editor", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const workspaceStart = app.indexOf("(view === \"station\" || view === \"ticket\") && (");
  const workspaceEnd = app.indexOf("view === \"focus\"", workspaceStart);
  const workspace = app.slice(workspaceStart, workspaceEnd);

  assert.notEqual(workspaceStart, -1);
  assert.notEqual(workspaceEnd, -1);
  assert.equal((workspace.match(/<StudyPlanWorkspace\b/gu) ?? []).length, 1);
  assert.equal((workspace.match(/<BoardingTicket\b/gu) ?? []).length, 1);
});

test("revision library aggregates notes through one tombstone-filtered owner boundary", async () => {
  const helper = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/revisionMaterialEntries.ts"), "utf8"));
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const collectionStart = app.indexOf("const revisionMaterialRecords = useMemo(() => collectRevisionMaterialRecords(");
  const collectionEnd = app.indexOf("const revisionMaterialEntries =", collectionStart);
  const collection = app.slice(collectionStart, collectionEnd);

  assert.match(helper, /export function collectRevisionMaterialRecords\(/u);
  assert.match(app, /collectRevisionMaterialRecords\(/u);
  assert.match(collection, /removedSessionIds/u);
  assert.match(collection, /documentText/u);
  assert.match(collection, /saved\.studyPlanStorage\?\.workspaceDrafts/u);
  assert.match(collection, /sessions\.filter\(\(session\) => session\.userId === owner\)/u);
  assert.match(collection, /removedSessionIds\)/u);
  assert.match(app, /data-revision-note-id=\{JSON\.stringify\(\[draftTripId, "notes"\]\)\}/u);
  assert.match(app, /material-source__notes/u);
});

test("step changes within one plan retain edited goal and subject, and failed previews do not navigate", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const selectStart = app.indexOf("function selectStudyPlanStep(");
  const selectEnd = app.indexOf("function selectManualWorkspaceCandidate", selectStart);
  const selection = app.slice(selectStart, selectEnd);
  const previewStart = app.indexOf("function previewRevisionMaterial(");
  const previewEnd = app.indexOf("function useRevisionMaterialInPlan", previewStart);
  const preview = app.slice(previewStart, previewEnd);

  assert.match(selection, /const samePlan =[^;]+;/u);
  assert.match(selection, /goal: nextGoal/u);
  assert.match(selection, /topicId: nextTopicId/u);
  assert.match(selection, /const nextGoal = samePlan \? storage\.draft\.goal : plan\.goal/u);
  assert.match(selection, /const nextTopicId = samePlan \? storage\.draft\.topicId : plan\.topicId/u);
  assert.match(selection, /updateQuickTripDraft\(quickTripDraft,[\s\S]*?goal: nextGoal,[\s\S]*?topic: nextTopicId/u);
  assert.doesNotMatch(selection, /setMinutes\(/u);
  assert.match(preview, /const restored = record\.planId && record\.stepId[\s\S]*?if \(!restored\) return;[\s\S]*?go\("station"\)/u);
  assert.match(selection, /if \(!commit\([\s\S]*?\)\) return false;/u);
});

test("reusing a library source persists consent revocation in the same owner-local commit", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const persistStart = app.indexOf("function persistStudyWorkspaceDraft(");
  const persistEnd = app.indexOf("function selectStudyPlanStep(", persistStart);
  const persist = app.slice(persistStart, persistEnd);
  const useStart = app.indexOf("function useRevisionMaterialInPlan(");
  const useEnd = app.indexOf("function openWorkspaceSourceMode", useStart);
  const use = app.slice(useStart, useEnd);

  assert.match(persist, /options: \{ revokeSourceConsent\?: boolean \} = \{\}/u);
  assert.match(persist, /sourceConsent: false/u);
  assert.match(persist, /commit\(\{ \.\.\.value, studyPlanStorage: nextStorage \}\)/u);
  assert.match(use, /persistStudyWorkspaceDraft\(\{ sources: nextSources, materials: nextMaterials \}, \{ revokeSourceConsent: true \}\)/u);
  assert.doesNotMatch(use, /revokeQuizPrefetchSourceConsent\(/u);
  assert.match(persist, /notes: changes\.notes \?\? documentText/u);
  assert.match(use, /record\.kind === "note" && draftTripId === record\.sessionId/u);
});
