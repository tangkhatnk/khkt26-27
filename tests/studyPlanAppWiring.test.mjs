import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createStudyPlanStorage, updateStudyPlanDraftFromQuickTrip } from "../src/adventure/studyPlanStorage.ts";
import { createQuickTripDraft, isValidPersonalStudyStartDuration, updateQuickTripDraft } from "../src/adventure/quickTripDraft.ts";
import { createStudyOnboardingProgress, reduceStudyOnboardingProgress } from "../src/adventure/studyOnboardingModel.ts";

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
  assert.match(accept, /if \(!persistStudyWorkspaceDraft\(\{ notes: nextNotes, sources: nextSources, materials: nextMaterials \}, \{ revokeSourceConsent: true \}\)\) return;/u);
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

  assert.match(hydration, /if \(\(!value\.active \|\| value\.active\.groupId === null\) && \(!pathRun \|\| pathRun\.phase === "review"\)\)/u);
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
  assert.doesNotMatch(request, /canOpenStudyWorkspace|onboarding|tutorial/u);
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

test("step changes retain edited goal and subject while library preview stays read only", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const selectStart = app.indexOf("function selectStudyPlanStep(");
  const selectEnd = app.indexOf("function focusRevisionSource", selectStart);
  const selection = app.slice(selectStart, selectEnd);
  const previewStart = app.indexOf("function previewRevisionMaterial(");
  const previewEnd = app.indexOf("function useRevisionMaterialInPlan", previewStart);
  const preview = app.slice(previewStart, previewEnd);
  const closeStart = app.indexOf("function closeRevisionMaterialPreview(");
  const closeEnd = app.indexOf("function useRevisionMaterialInPlan", closeStart);
  const closePreview = app.slice(closeStart, closeEnd);

  assert.match(selection, /const samePlan =[^;]+;/u);
  assert.match(selection, /goal: nextGoal/u);
  assert.match(selection, /topicId: nextTopicId/u);
  assert.match(selection, /const nextGoal = samePlan \? storage\.draft\.goal : plan\.goal/u);
  assert.match(selection, /const nextTopicId = samePlan \? storage\.draft\.topicId : plan\.topicId/u);
  assert.match(selection, /updateQuickTripDraft\(quickTripDraft,[\s\S]*?goal: nextGoal,[\s\S]*?topic: nextTopicId/u);
  assert.doesNotMatch(selection, /setMinutes\(/u);
  assert.match(preview, /const record = revisionMaterialRecords\.find\(/u);
  assert.match(preview, /trigger\?: HTMLButtonElement/u);
  assert.match(preview, /setRevisionPreviewId\(entryId\)/u);
  assert.match(preview, /revisionPreviewReturnFocus\.current = trigger/u);
  assert.match(preview, /scrollIntoView\(\{ behavior: "auto", block: "start" \}\)/u);
  assert.match(preview, /revision-material-preview-title/u);
  assert.doesNotMatch(preview, /\b(?:selectStudyPlanStep|selectManualWorkspaceCandidate|go|setStudyInput|commit)\s*\(/u);
  assert.doesNotMatch(app, /function selectManualWorkspaceCandidate\(/u);
  assert.match(closePreview, /trigger\?\.isConnected\)[\s\S]*?trigger\.focus/u);
  assert.doesNotMatch(closePreview, /trigger\.focus\(\{ preventScroll: true \}\)/u);
  assert.match(closePreview, /revision-materials-library-title/u);
  assert.match(app, /<h2 id="revision-material-preview-title" tabIndex=\{-1\}/u);
  assert.match(app, /selectedRevisionMaterial && <section className="revision-material-preview"/u);
  assert.match(app, /<MaterialSourceReader\s+title=\{selectedRevisionMaterial\.source\.name\}\s+text=\{selectedRevisionMaterial\.source\.text\}/u);
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

test("workspace source consent revokes atomically with saved content before publishing edits", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const persistStart = app.indexOf("function persistStudyWorkspaceDraft(");
  const persistEnd = app.indexOf("function selectStudyPlanStep(", persistStart);
  const persist = app.slice(persistStart, persistEnd);
  const importStart = app.indexOf("async function importMaterials(");
  const importEnd = app.indexOf("async function readHandwriting(", importStart);
  const importMaterials = app.slice(importStart, importEnd);
  const handwritingStart = importEnd;
  const handwritingEnd = app.indexOf("async function generateStudyGuide(", handwritingStart);
  const handwriting = app.slice(handwritingStart, handwritingEnd);
  const acceptStart = app.indexOf("function acceptStudyGuide(");
  const acceptEnd = app.indexOf("function discardStudyGuideDraft(", acceptStart);
  const accept = app.slice(acceptStart, acceptEnd);
  const notesStart = app.indexOf("<StudyNotesInput value={documentText}");
  const notesEnd = app.indexOf("disabled={busy || studyGuideNeedsConfirmation", notesStart);
  const notesChange = app.slice(notesStart, notesEnd);
  const sourceStart = app.indexOf("textareaLabel={`Nội dung nguồn");
  const sourceEnd = app.indexOf("}} />", sourceStart);
  const sourceEdit = app.slice(sourceStart, sourceEnd);

  assert.match(persist, /findStudyWorkspaceDraft\(storage, identity\)/u);
  assert.match(persist, /studyWorkspaceSourceContentChanged\(previousWorkspaceDraft, nextWorkspaceDraft\)/u);
  assert.match(persist, /sourceConsent: false/u);
  assert.match(persist, /commit\(\{ \.\.\.value, studyPlanStorage: nextStorage \}\)/u);
  assert.ok(importMaterials.indexOf("persistStudyWorkspaceDraft({ sources: nextSources, materials: nextMaterials })") < importMaterials.indexOf("originalFiles.current.set"));
  assert.ok(importMaterials.indexOf("persistStudyWorkspaceDraft({ sources: nextSources, materials: nextMaterials })") < importMaterials.indexOf("setSources(nextSources)"));
  assert.ok(handwriting.indexOf("persistStudyWorkspaceDraft({ sources: nextSources, materials: nextMaterials })") < handwriting.indexOf("noteStudyExerciseSourceChange"));
  assert.ok(handwriting.indexOf("noteStudyExerciseSourceChange") < handwriting.indexOf("setSources(nextSources)"));
  assert.ok(accept.indexOf("persistStudyWorkspaceDraft({ notes: nextNotes, sources: nextSources, materials: nextMaterials }") < accept.indexOf("for (const existing of sources) noteStudyExerciseSourceChange"));
  assert.ok(notesChange.indexOf("persistStudyWorkspaceDraft({ notes: text })") < notesChange.indexOf("setDocumentText(text)"));
  assert.ok(sourceEdit.indexOf("persistStudyWorkspaceDraft({ sources: nextSources })") < sourceEdit.indexOf("noteStudyExerciseSourceChange"));
  assert.ok(sourceEdit.indexOf("noteStudyExerciseSourceChange") < sourceEdit.indexOf("setSources(nextSources)"));
  assert.doesNotMatch(app, /revokeQuizPrefetchSourceConsent/u);
  assert.match(persist, /if \(!loaded \|\| !exclusive \|\| value\.active \|\| mode !== "solo"/u);
  assert.match(persist, /setError\([\s\S]*?return false;/u);
  const unavailableGuardEnd = persist.indexOf("let storage =", persist.indexOf("if (!loaded"));
  assert.doesNotMatch(persist.slice(persist.indexOf("if (!loaded"), unavailableGuardEnd), /return true;/u);
  const workspaceStart = app.indexOf("<StudyPlanWorkspace");
  const workspaceEnd = app.indexOf("</StudyPlanWorkspace>", workspaceStart);
  const workspace = app.slice(workspaceStart, workspaceEnd);
  assert.match(workspace, /<StudyNotesInput[\s\S]*?disabled=\{busy \|\| !!active/u);
  assert.match(workspace, /<MaterialSourceReader[\s\S]*?disabled=\{busy \|\| !!active/u);
  assert.match(workspace, /type="file"[\s\S]*?disabled=\{busy \|\| !!active/u);
});

test("restarting the selected plan step rotates completed and tombstoned candidates", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const start = app.indexOf("function selectStudyPlanStep(");
  const end = app.indexOf("function focusRevisionSource", start);
  const selectStep = app.slice(start, end);

  assert.match(selectStep, /new Set\(\[[\s\S]*?historySessions\([\s\S]*?removedSessionIds[\s\S]*?\]\)/u);
  assert.match(selectStep, /const candidateUsed = usedSessionIds\.has\(selectedStep\.plannedSessionId\)/u);
  assert.match(selectStep, /samePlan && plan\.selectedStepId === stepId && !candidateUsed/u);
  assert.match(selectStep, /candidateUsed\s*\? crypto\.randomUUID\(\)/u);
  assert.ok(selectStep.indexOf("const candidateUsed") < selectStep.indexOf("samePlan && plan.selectedStepId"));
});

test("starting a history review clears source consent with its new candidate", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const start = app.indexOf("function startReviewTrip(");
  const end = app.indexOf("function saveStudyOnboardingProgress", start);
  const review = app.slice(start, end);

  assert.match(review, /selectedPlanId: null,[\s\S]*?selectedStepId: null,[\s\S]*?candidateSessionId: reviewSessionId/u);
  assert.match(review, /quizPrefetch: \{ \.\.\.storage\.draft\.quizPrefetch, sourceConsent: false \}/u);
  assert.match(review, /const reviewSessionId = crypto\.randomUUID\(\)/u);
  assert.match(review, /commit\(\{ \.\.\.current\.current, studyPlanStorage: savedStorage \}\)/u);
  assert.ok(review.indexOf("commit({ ...current.current, studyPlanStorage: savedStorage })") < review.indexOf("draftSessionIdsRef.current.solo = reviewSessionId"));
  assert.ok(review.indexOf("commit({ ...current.current, studyPlanStorage: savedStorage })") < review.indexOf("setDraftTripId(reviewSessionId)"));
  assert.doesNotMatch(review, /rotateDraftSessionId\(draftSessionIdsRef\.current, "solo", null\)/u);
  assert.doesNotMatch(review, /revokeQuizPrefetchSourceConsent\(/u);
});

test("manual start eligibility uses session and input guards, not tutorial completion", async () => {
  let onboarding = createStudyOnboardingProgress({ goal: "Ôn phản ứng hóa học", preferredMinutes: 25 });
  onboarding = reduceStudyOnboardingProgress(onboarding, { type: "survey/next" });
  onboarding = reduceStudyOnboardingProgress(onboarding, { type: "survey/next" });
  assert.equal(onboarding.phase, "tutorial");
  assert.equal(isValidPersonalStudyStartDuration(onboarding.survey.preferredMinutes, 25 * 60), true);

  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const start = app.indexOf("function start(skipPendingExercises");
  const startEnd = app.indexOf("const hasReadyPreparation", start);
  const body = app.slice(start, startEnd);

  assert.doesNotMatch(body, /canOpenStudyWorkspace|tutorialActive|onboarding\.phase/u);
  assert.match(body, /busy \|\| materialRequest\.current/u);
  assert.match(body, /!loaded/u);
  assert.match(body, /!exclusive/u);
  assert.match(body, /current\.current\.active/u);
  assert.match(body, /!personalDurationValid/u);
  assert.match(body, /startGoal\.trim\(\)\.length < 3/u);
  assert.match(body, /!startBreaksValid/u);
  assert.match(body, /!canStartSessionWithQuizReview\(quizCount, skipQuizReview\)/u);
  assert.match(body, /if \(synchronizedTrip && synchronizedTrip\.status === "departed" && ownTripStatus !== "bound"\)/u);
  assert.match(body, /if \(synchronizedTrip && \(!synchronizedTrip\.ownSessionId \|\| draftTripId !== synchronizedTrip\.ownSessionId\)\)/u);
  assert.match(body, /!synchronizedTripDraftForSession\(current\.current\.readyTripDrafts, synchronizedTrip\.ownSessionId, group\.id\)/u);
});

test("tutorial state controls guide presentation, while explicit guest actions and manual start stay eligible", async () => {
  let progress = createStudyOnboardingProgress({ goal: "Ôn phản ứng hóa học" });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  assert.equal(progress.phase, "tutorial");

  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const start = app.slice(app.indexOf("function start(skipPendingExercises"), app.indexOf("const hasReadyPreparation", app.indexOf("function start(skipPendingExercises")));
  const planner = app.slice(app.indexOf("async function requestStudyPlanFromWorkspace()"), app.indexOf("function startReviewTrip(", app.indexOf("async function requestStudyPlanFromWorkspace()")));
  const summary = app.slice(app.indexOf("function canGeneratePrivateMaterialSummary("), app.indexOf("function privateMaterialSummaryUnavailableReason(", app.indexOf("function canGeneratePrivateMaterialSummary(")));
  const handwriting = app.slice(app.indexOf("async function readHandwriting("), app.indexOf("async function generateStudyGuide(", app.indexOf("async function readHandwriting(")));
  const guide = app.slice(app.indexOf("async function generateStudyGuide("), app.indexOf("function acceptStudyGuide(", app.indexOf("async function generateStudyGuide(")));
  const saveOnboarding = app.slice(app.indexOf("function saveStudyOnboardingProgress("), app.indexOf("function cancelStudyPlanRequest(", app.indexOf("function saveStudyOnboardingProgress(")));
  const resumeOnboarding = app.slice(app.indexOf("function reopenStudyOnboarding("), app.indexOf("function cancelStudyPlanRequest(", app.indexOf("function reopenStudyOnboarding(")));
  const exerciseEditorStart = app.indexOf("<StudyExercisePreparationEditor");
  const exerciseEditorEnd = app.indexOf("/>", exerciseEditorStart);
  const exerciseEditor = app.slice(exerciseEditorStart, exerciseEditorEnd);
  const prefetchEffect = app.slice(app.indexOf("  useEffect(() => {\n    const trip = current.current.active;"), app.indexOf("const minutesTotal", app.indexOf("  useEffect(() => {\n    const trip = current.current.active;")));

  assert.match(app, /canOpenStudyWorkspace/u);
  assert.match(app, /const firstUseNeedsWorkspace = loaded && !saved\.active &&\s*!canOpenStudyWorkspace\(saved\.studyPlanStorage\?\.onboarding\)/u);
  assert.doesNotMatch(start, /canOpenStudyWorkspace|tutorialActive|onboarding\.phase/u);
  assert.match(start, /!personalDurationValid/u);
  assert.match(start, /current\.current\.active/u);
  assert.match(planner, /if \(studyPlanAccessReason\) return/u);
  const accessReasonStart = app.indexOf("const studyPlanAccessReason =");
  const accessReasonEnd = app.indexOf("const ticketTopicName", accessReasonStart);
  const accessReason = app.slice(accessReasonStart, accessReasonEnd);
  const summaryReason = app.slice(app.indexOf("function privateMaterialSummaryUnavailableReason("), app.indexOf("async function generateMaterialSummary(", app.indexOf("function privateMaterialSummaryUnavailableReason(")));
  assert.doesNotMatch(accessReason, /onboarding|tutorial/u);
  assert.doesNotMatch(summary, /canOpenStudyWorkspace|onboarding|tutorial/u);
  assert.doesNotMatch(summaryReason, /onboarding|tutorial/u);
  assert.doesNotMatch(handwriting, /tutorialActive/u);
  assert.match(handwriting, /ownerRef\.current === "guest"[\s\S]*?postGuestAi/u);
  assert.doesNotMatch(guide, /tutorialActive/u);
  assert.match(guide, /ownerRef\.current === "guest"[\s\S]*?postGuestAi/u);
  assert.doesNotMatch(exerciseEditor, /tutorialActive/u);
  assert.match(prefetchEffect, /if \(!trip \|\| trip\.id !== activeTripId\)/u);
  assert.match(prefetchEffect, /if \(guestNeedsExplicitOptIn \|\| !shouldPrefetchQuizReview\(existingDraft\)\)/u);
  const startButtonStart = app.indexOf("<button\n                        className=\"primary\"", app.indexOf("<StudyWorkspaceSettings"));
  const startButtonEnd = app.indexOf("onClick={() => start()}", startButtonStart);
  assert.doesNotMatch(app.slice(startButtonStart, startButtonEnd), /tutorialActive|canOpenStudyWorkspace/u);
  assert.match(app.slice(startButtonStart, startButtonEnd), /!isValidStudyMinutes\(minutes\)/u);
  assert.match(saveOnboarding, /if \(onboardingProgress\.phase === "skipped"\) go\("station"\)/u);
  assert.match(saveOnboarding, /\.\.\.survey,[\s\S]*?preferredMinutes,[\s\S]*?studyPlanStorage: \{ \.\.\.storage, onboarding: onboardingProgress, draft \}/u);
  assert.match(resumeOnboarding, /storage\.onboarding\.phase === "skipped"[\s\S]*?type: "onboarding\/resume"/u);
  assert.match(resumeOnboarding, /reopenStudyOnboardingFromDraft/u);
  assert.match(app, /!online \|\| authOffline/u);
  assert.match(app, /owner !== "guest" && \(!user \|\| needsLogin\)/u);
  assert.match(app, /current\.current\.active/u);
});

test("onboarding progress and station navigation wait for the local save", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const start = app.indexOf("function saveStudyOnboardingProgress(");
  const end = app.indexOf("function reopenStudyOnboarding(", start);
  const save = app.slice(start, end);
  const commit = save.indexOf("const saved = commit({");
  const failedSave = save.indexOf("if (!saved) return false;", commit);
  const updateDraft = save.indexOf("updateQuickTripDraft(quickTripDraft, quickDraft)");
  const stationNavigation = save.indexOf('go("station")');

  assert.notEqual(commit, -1);
  assert.ok(commit < failedSave);
  assert.ok(failedSave < updateDraft);
  assert.ok(failedSave < stationNavigation);
  assert.match(save, /if \(onboardingProgress\.phase === "skipped"\) go\("station"\);\s*return true;/u);
});

test("starting focus durably advances the selected candidate while the active session keeps its original ID", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const start = app.indexOf("const beginFocus = (input:");
  const end = app.indexOf('if (owner === "guest" && withExercises)', start);
  const beginFocus = app.slice(start, end);

  assert.notEqual(start, -1);
  assert.match(beginFocus, /const nextDraftSessionId = input\.groupId \? null : crypto\.randomUUID\(\)/u);
  assert.match(beginFocus, /advanceStudyPlanCandidateAfterStart\(/u);
  assert.match(beginFocus, /studyPlanStorage: nextStudyPlanStorage/u);
  assert.match(beginFocus, /active: trip/u);
  assert.match(beginFocus, /setDraftTripId\(nextDraftTripId\)/u);
  assert.match(beginFocus, /draftSessionIdsRef\.current\.solo = nextDraftTripId/u);
  assert.match(beginFocus, /id: input\.id/u);
  assert.ok(beginFocus.indexOf("advanceStudyPlanCandidateAfterStart") < beginFocus.indexOf("commit({"));
  assert.ok(beginFocus.indexOf("if (commit({") < beginFocus.indexOf("draftSessionIdsRef.current.solo = nextDraftTripId"));
  assert.ok(beginFocus.indexOf("if (commit({") < beginFocus.indexOf("setDraftTripId(nextDraftTripId)"));
});

test("legacy group replay suppresses personal automatic quiz prefetch while summary keeps manual retrieval", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const beginStart = app.indexOf("const beginFocus = (input:");
  const beginEnd = app.indexOf('if (owner === "guest" && withExercises)', beginStart);
  const beginFocus = app.slice(beginStart, beginEnd);
  const quizPanelStart = app.indexOf("<QuizPanel");
  const quizPanelEnd = app.indexOf("/>\n", quizPanelStart);
  const quizPanel = app.slice(quizPanelStart, quizPanelEnd);

  assert.match(beginFocus, /const useAutomaticQuizPrefetch = input\.groupId === null/u);
  assert.match(beginFocus, /enabled: useAutomaticQuizPrefetch && quizPrefetchPreference\.enabled/u);
  assert.match(beginFocus, /sourcePresent: useAutomaticQuizPrefetch && hasQuizSource/u);
  assert.match(beginFocus, /sourceConsent: useAutomaticQuizPrefetch && quizPrefetchPreference\.sourceConsent/u);
  assert.match(quizPanel, /onGenerate=\{\(count\) => generateQuiz\(summarySession, count\)\}/u);
  assert.match(quizPanel, /canUseAI=\{owner === "guest" \? online && !authOffline : !!user && !needsLogin && online && !authOffline\}/u);
});

test("finishing a recovered group session restores the saved personal workspace and its source", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const start = app.indexOf("function finish()");
  const end = app.indexOf("useEffect(() => {\n    finishRef.current", start);
  const finish = app.slice(start, end);

  assert.match(finish, /value\.notes\[s\.id\] = next\.document/u);
  assert.match(finish, /const personalStorage = trip\.groupId\s*\?/u);
  assert.match(finish, /if \(trip\.groupId && personalStorage\)[\s\S]*?selectedStudyWorkspaceIdentity\(personalStorage\)[\s\S]*?findStudyWorkspaceDraft\(personalStorage, personalIdentity\)/u);
  assert.match(finish, /setMode\("solo"\)/u);
  assert.match(finish, /setDraftTripId\(personalIdentity\.sessionId\)/u);
  assert.match(finish, /const legacySessionId = personalIdentity\.sessionId === s\.id \? null : personalIdentity\.sessionId/u);
  assert.match(finish, /setDocumentText\(personalWorkspace\?\.notes \?\? \(legacySessionId \? value\.notes\[legacySessionId\] \?\? "" : ""\)\)/u);
  assert.match(finish, /setSources\(structuredClone\(personalWorkspace\?\.sources \?\? \(legacySessionId \? value\.sources\?\.\[legacySessionId\] \?\? \[\] : \[\]\)\)\)/u);
  assert.match(finish, /setMaterials\(structuredClone\(personalWorkspace\?\.materials \?\? \(legacySessionId \? value\.materials\?\.\[legacySessionId\] \?\? \[\] : \[\]\)\)\)/u);
  assert.ok(finish.indexOf("if (commit(value))") < finish.indexOf("setMode(\"solo\")"));
});

test("reloading an active personal session hydrates its next workspace without replacing the active focus goal", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const lockStart = app.indexOf("const value = readSaved(owner)");
  const lockEnd = app.indexOf("if (pathRun && (pathRun.phase === \"lesson\"", lockStart);
  const hydration = app.slice(lockStart, lockEnd);
  const activeFocusStart = app.indexOf("<QuietFocusCanvas");
  const activeFocusEnd = app.indexOf("essentialControls=", activeFocusStart);
  const activeFocus = app.slice(activeFocusStart, activeFocusEnd);

  assert.match(hydration, /if \(\(!value\.active \|\| value\.active\.groupId === null\) && \(!pathRun \|\| pathRun\.phase === "review"\)\)/u);
  assert.match(hydration, /const workspaceIdentity = selectedStudyWorkspaceIdentity\(storage\)/u);
  assert.match(hydration, /setDraftTripId\(workspaceIdentity\.sessionId\)/u);
  assert.match(hydration, /setDocumentText\(workspaceDraft\?\.notes \?\? ""\)/u);
  assert.match(activeFocus, /goal=\{active\.goal\}/u);
  assert.match(app, /value\.active = restore\(value\.active, tripClockNow\(value\.active, Date\.now\(\)\)\)/u);
});

test("active focus uses the quiet canvas without moving the session controls or clock ownership", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const focusStart = app.indexOf("{view === \"focus\" &&");
  const focusEnd = app.indexOf("{view === \"map\" &&", focusStart);
  const focus = app.slice(focusStart, focusEnd);

  assert.match(app, /import \{ QuietFocusCanvas \} from "\.\/QuietFocusCanvas"/u);
  assert.match(focus, /className="focus-card quiet-focus-shell"/u);
  assert.match(focus, /<QuietFocusCanvas[\s\S]*?goal=\{active\.goal\}/u);
  assert.match(focus, /clockSeconds=\{rest \? rest\.remainingSeconds : studyStage\?\.remainingSeconds \?\? active\.target - elapsedSeconds\(active, displayAt\)\}/u);
  assert.match(focus, /motionAllowed=\{active\.state === "focus" \|\| active\.state === "reconnecting"\}/u);
  assert.match(focus, /essentialControls=\{/u);
  assert.match(focus, /warnings=\{/u);
  assert.match(focus, /materials=\{/u);
  assert.match(focus, /details=\{/u);
  assert.match(focus, /setConfirm\("finish"\)/u);
  assert.match(focus, /studyFullscreen\.toggle/u);
  assert.match(focus, /active\.state === "away"[\s\S]*?role="status"[\s\S]*?Tạm rời/u);
  assert.doesNotMatch(focus, /<FlipClock/u);
});

test("retired group setup is not rendered while active group sessions retain their existing status", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const workspaceStart = app.indexOf("(view === \"station\" || view === \"ticket\") && (");
  const focusStart = app.indexOf("{view === \"focus\"", workspaceStart);
  const mapStart = app.indexOf("{view === \"map\" && (");
  const mapEnd = app.indexOf("{view === \"journal\" && (", mapStart);
  const workspace = app.slice(workspaceStart, focusStart);
  const map = app.slice(mapStart, mapEnd);
  const focusStartBody = app.indexOf("<QuietFocusCanvas", focusStart);
  const focusEnd = app.indexOf("{view === \"map\" && (", focusStartBody);
  const focus = app.slice(focusStartBody, focusEnd);

  assert.doesNotMatch(app, /view === "group"\s*&&/u);
  assert.doesNotMatch(workspace, /Cùng chuyến|Khởi hành cùng lúc|Sẵn sàng →|prepareGroupTripTicket|markSynchronizedTripReady|Lập chuyến đi chung|Tham gia chuyến/u);
  assert.doesNotMatch(map, /setMode\("group"\)|Bản đồ đoàn|Bản đồ chuyến đi chung/u);
  assert.match(focus, /active\.groupId && <p className="overhead-hint">Tiến độ nhóm cập nhật/u);
  assert.match(app, /canOfferLegacyGroupCleanup\(\{/u);
  assert.match(app, /authenticatedMember: owner !== "guest" && Boolean\(user\) && !needsLogin && !authOffline && online/u);
  assert.match(app, /ownStatus: ownGroupTripStatus/u);
  assert.match(app, /hasActiveSession: Boolean\(group && saved\.active\?\.groupId === group\.id\)/u);
  const accountStart = app.indexOf("{view === \"account\" && (");
  const accountEnd = app.indexOf("</main>", accountStart);
  const legacyCleanup = app.slice(accountStart, accountEnd);
  assert.match(legacyCleanup, /legacyGroupCleanupAvailable &&[\s\S]*?setConfirm\("leave"\)/u);
  assert.match(legacyCleanup, /ownsWaitingLegacyTrip \? "Hủy chuyến chờ cũ" : "Rời đoàn cũ"/u);
  assert.match(app, /ownsWaitingLegacyTrip\s*\?\s*"Chuyến đang chờ sẽ bị hủy cho tất cả thành viên\.[\s\S]*?"/u);
  assert.match(app, /if \(!legacyGroupCleanupAvailable\) throw new Error\([\s\S]*?mutation\("leave", \{\}\)/u);
});

test("legacy group ticket preparation is restricted to exact departed bound-session recovery", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const start = app.indexOf("function prepareGroupTripTicket()");
  const end = app.indexOf("function start(", start);
  const prepare = app.slice(start, end);

  assert.match(prepare, /!group \|\| !isSynchronizedTrip\(trip\) \|\| trip\.status !== "departed"/u);
  assert.match(prepare, /memberStatus !== "bound"/u);
  assert.match(prepare, /recoverBoundTripSessionId\(/u);
  assert.match(prepare, /restoreSynchronizedDraft\(recoveredId, trip, group\.id\)/u);
  assert.doesNotMatch(prepare, /trip\.status === "waiting"|groupDraftSessionId\([^\n]*reservationId|setGoal\(trip\.goal/u);
});

test("goal-first workspace shares one desktop editing surface and quiet focus centers without navigation chrome", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const adventureCss = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/adventure.css"), "utf8"));
  const departureCss = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/departure.css"), "utf8"));
  const fullscreenCss = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/fullscreen.css"), "utf8"));
  const themeCss = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/theme.css"), "utf8"));

  assert.match(app, /className=\{`adventure\$\{firstUseNeedsWorkspace \? " adventure--onboarding" : ""\}\$\{view === "focus" && active \? " adventure--quiet-focus" : ""\}`\}/u);
  assert.match(departureCss, /\.boarding-preparation\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.16fr\)\s+minmax\(280px,\s*\.84fr\)/u);
  assert.match(departureCss, /\.boarding-preparation\s*\{[^}]*border-radius:[^;}]+;[^}]*overflow:\s*hidden/u);
  assert.match(departureCss, /\.boarding-preparation\s*>\s*\.panel\s*\{[^}]*background:\s*transparent/u);
  assert.match(departureCss, /@media \(max-width:\s*1100px\)\s*\{\s*\.boarding-preparation\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/u);
  assert.match(departureCss, /html\[data-theme="dark"\] \.adventure \.boarding-preparation > \.panel:not\(\.departure-settings\)/u);
  assert.match(departureCss, /html\[data-theme="dark"\] \.adventure \.boarding-preparation > \.departure-settings\s*\{[^}]*background:\s*var\(--surface-raised\)/u);
  assert.match(adventureCss, /\.adventure--quiet-focus\s+\.sidebar\s*,\s*\.adventure--quiet-focus\s+\.topbar\s*\{\s*display:\s*none/u);
  assert.match(adventureCss, /\.adventure--quiet-focus\s+\.main-area\s*\{[^}]*margin-left:\s*0/u);
  assert.match(adventureCss, /\.adventure\.adventure--quiet-focus main\.view-entrance\s*\{[^}]*display:\s*grid;[^}]*align-content:\s*center/u);
  assert.match(adventureCss, /\.adventure--quiet-focus\s+\.page-footer\s*\{\s*display:\s*none/u);
  assert.match(adventureCss, /\.adventure--quiet-focus \.quiet-focus-canvas\s*\{[^}]*min-height:\s*calc\(100dvh - 24px\)/u);
  assert.match(adventureCss, /@media \(max-width:\s*600px\)\s*\{\s*\.adventure\.adventure--quiet-focus main\.view-entrance\s*\{\s*padding:\s*12px 14px/u);
  const quietFocusCard = adventureCss.match(/\.adventure--quiet-focus\s+\.focus-card\.quiet-focus-shell\s*\{[^}]*\}/u)?.[0] ?? "";
  assert.match(quietFocusCard, /background:\s*transparent/u);
  assert.match(quietFocusCard, /border:\s*0/u);
  assert.match(adventureCss, /html\[data-theme="dark"\]\s+\.adventure\.adventure--quiet-focus,[\s\S]*?background:\s*#0b100d/u);
  assert.match(fullscreenCss, /\.adventure:fullscreen \.sidebar,[\s\S]*?\.adventure:fullscreen \.topbar\s*\{\s*display:\s*none/u);
  assert.match(themeCss, /html\[data-theme="dark"\] \.adventure \.main-area[\s\S]*?background:\s*var\(--page-bg\)/u);
});

test("mandatory onboarding disables navigation that cannot be opened and gives a blocked-state label", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const navStart = app.indexOf("{nav.map((n) => {");
  const navEnd = app.indexOf("})}", navStart);
  const nav = app.slice(navStart, navEnd);

  assert.match(nav, /if \(firstUseNeedsWorkspace && n\.id !== "station"\) return null/u);
  assert.match(nav, /disabled=\{firstUseNeedsWorkspace\}/u);
  assert.match(app, /disabled=\{firstUseNeedsWorkspace\}[\s\S]*?go\("account"\)/u);
  assert.match(app, /firstUseNeedsWorkspace\s*\?\s*"Hoàn tất hướng dẫn để bắt đầu"\s*:\s*online/u);
  assert.match(app, /online && !authOffline && !needsLogin\s*\?\s*"Trực tuyến"/u);
});

test("source tutorial shows a return route to the next guide step after jumping into notes or files", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const notesPanelStart = app.indexOf("data-revision-note-id=");
  const notesPanelEnd = app.indexOf("</div>", notesPanelStart);
  const notesPanel = app.slice(notesPanelStart, notesPanelEnd);
  const filesPanelStart = app.indexOf("hidden={studyInput !== \"files\"}");
  const filesPanelEnd = app.indexOf("</div>", filesPanelStart);
  const filesPanel = app.slice(filesPanelStart, filesPanelEnd);

  assert.match(app, /function focusStudyTutorialHeading\(\)/u);
  assert.match(notesPanel, /study-tutorial-return-cue/u);
  assert.match(filesPanel, /study-tutorial-return-cue/u);
  assert.match(app, /study-tutorial-return-cue">\s*<span role="status">Bước tiếp theo: điều chỉnh thời lượng\.<\/span>\s*<button/u);
  assert.doesNotMatch(app, /study-tutorial-return-cue" role="status"/u);
  assert.match(app, /Quay lại hướng dẫn · Bước 3: thời lượng/u);
  assert.match(app, /getElementById\("study-onboarding-step-heading"\)/u);
  const onboarding = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/StudyOnboarding.tsx"), "utf8"));
  assert.match(onboarding, /const jumpedToSource = previous\.phase === "tutorial" && previous\.step === 1[\s\S]*?progress\.tutorial\.sourceChoice !== "none"/u);
  assert.match(onboarding, /if \(!moved \|\| progress\.phase !== "tutorial" \|\| jumpedToSource\) return/u);
});

test("retrieval guide count edits require a valid count, while deliberate toggles can finish the guide", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const countStart = app.indexOf("onCountChange={(value) => {");
  const countEnd = app.indexOf("onToggleSkip=", countStart);
  const countChange = app.slice(countStart, countEnd);
  const skipStart = app.indexOf("onToggleSkip=", countEnd);
  const skipEnd = app.indexOf("onPrefetchChange=", skipStart);
  const skipChange = app.slice(skipStart, skipEnd);

  assert.match(countChange, /setQuizCount\(value\);[\s\S]*?recordStudyTutorialRetrievalChoice\(value\)/u);
  assert.doesNotMatch(countChange, /recordStudyTutorialRetrievalChoice\(\)/u);
  assert.match(skipChange, /recordStudyTutorialRetrievalChoice\(\)/u);
});

test("mobile workspace header keeps the full connection label and separates the breadcrumb from controls", async () => {
  const css = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/adventure.css"), "utf8"));
  const phone = css.slice(css.lastIndexOf("@media (max-width: 600px)"));

  assert.notEqual(phone, css);
  assert.doesNotMatch(css, /\.connection\s*\{\s*font-size:\s*0/u);
  assert.match(phone, /\.topbar\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*59px;[^}]*padding:\s*8px 12px;[^}]*gap:\s*10px/u);
  assert.match(css, /\.topbar > span\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-width:\s*0/u);
  assert.match(phone, /\.topbar > span\s*\{[^}]*line-height:\s*1\.3/u);
  assert.match(css, /\.top-actions\s*\{[^}]*flex:\s*0 0 auto;[^}]*gap:\s*12px/u);
  assert.match(phone, /\.top-actions\s*\{[^}]*gap:\s*8px/u);
  assert.match(phone, /\.top-actions \.connection\s*\{[^}]*font-size:\s*10px;[^}]*white-space:\s*nowrap/u);
});
