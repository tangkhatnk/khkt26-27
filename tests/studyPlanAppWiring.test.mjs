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
  assert.match(app, /onSaveStep=\{canEditSelectedStudyPlanStep \? saveStudyPlanStep : undefined\}/u);
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
  assert.match(selectStep, /const committedSelectionMatches = currentStorage\.draft\.selectedStepId === stepId &&\s*currentStorage\.draft\.candidateSessionId === selectedStep\.plannedSessionId &&\s*canStartSelectedStudyPlanStep\(currentStorage, selectedStep\.plannedSessionId\) &&\s*draftTripIdRef\.current === selectedStep\.plannedSessionId/u);
  assert.match(selectStep, /samePlan && plan\.selectedStepId === stepId && committedSelectionMatches && !candidateUsed/u);
  assert.match(selectStep, /candidateUsed\s*\? crypto\.randomUUID\(\)/u);
  assert.ok(selectStep.indexOf("const committedSelectionMatches") < selectStep.indexOf("samePlan && plan.selectedStepId"));
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

test("AI plan selection and Start recheck the current unlocked candidate before binding it", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const startAt = app.indexOf("function start(skipPendingExercises");
  const startEnd = app.indexOf("const hasReadyPreparation", startAt);
  const start = app.slice(startAt, startEnd);
  const selectAt = app.indexOf("function selectStudyPlanStep(");
  const selectEnd = app.indexOf("function persistQuickTripStudyDraft", selectAt);
  const select = app.slice(selectAt, selectEnd);
  const beginAt = app.indexOf("const beginFocus = (input:");
  const beginEnd = app.indexOf('if (owner === "guest" && withExercises)', beginAt);
  const begin = app.slice(beginAt, beginEnd);
  const buttonStart = app.indexOf("<button\n                        className=\"primary\"", app.indexOf("<StudyWorkspaceSettings"));
  const buttonEnd = app.indexOf("onClick={() => start()}", buttonStart);
  const startButton = app.slice(buttonStart, buttonEnd);

  assert.match(start, /currentStudyStorage && !canStartSelectedStudyPlanStep\(currentStudyStorage, draftTripId\)/u);
  assert.match(select, /canSelectStudyPlanStep\(currentStorage, plan\.id, stepId\)/u);
  assert.match(startButton, /!studyPlanStepStartAllowed/u);
  assert.match(begin, /current\.current\.active/u);
  assert.match(begin, /clearStudyPlanActiveBinding/u);
  assert.match(begin, /bindStudyPlanStepSession/u);
  assert.ok(begin.indexOf("bindStudyPlanStepSession") < begin.indexOf("advanceStudyPlanCandidateAfterStart"));
  assert.match(begin, /studyPlanStorage:[\s\S]*?active: trip/u);
});

test("focus start rechecks every solo candidate after asynchronous preparation returns", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const beginAt = app.indexOf("const beginFocus = (input:");
  const guestAt = app.indexOf('if (owner === "guest" && withExercises)', beginAt);
  const guestEnd = app.indexOf("if (sharedTrip && group)", guestAt);
  const begin = app.slice(beginAt, guestAt);
  const guest = app.slice(guestAt, guestEnd);
  const validation = begin.indexOf("if (!canStartSelectedStudyPlanStep(startStorage, trip.id))");
  const selectedPlan = begin.indexOf("const selectedPlan = startStorage.plans.find");
  const binding = begin.indexOf("bindStudyPlanStepSession(startStorage, binding)");
  const anchor = guest.indexOf("const started = await startGuestAiSession");
  const lateScopeGuard = guest.indexOf("if (!isCurrent()) return;", anchor);

  assert.notEqual(validation, -1);
  assert.notEqual(selectedPlan, -1);
  assert.notEqual(binding, -1);
  assert.notEqual(anchor, -1);
  assert.notEqual(lateScopeGuard, -1);
  assert.ok(validation < selectedPlan);
  assert.ok(validation < binding);
  assert.ok(lateScopeGuard > anchor);
  assert.ok(lateScopeGuard < guest.indexOf("beginFocus({", anchor));
  assert.match(begin.slice(validation, selectedPlan), /setError[\s\S]*?return false/u);
  assert.match(guest, /captureStudyPlanStartScope\([\s\S]*?studyPlanWorkspaceTransition\.current/u);
  assert.match(guest, /isStudyPlanStartScopeCurrent\([\s\S]*?current\.current\.studyPlanStorage/u);
  assert.ok(guest.indexOf("if (!isCurrent()) return;", guest.indexOf("await bindStudyExercises")) < guest.indexOf("await startGuestAiSession"));
  assert.match(app, /if \(draftTripIdRef\.current !== id\) studyPlanWorkspaceTransition\.current \+= 1/u);
  assert.match(app, /studyPlanWorkspaceTransition\.current \+= 1;[\s\S]*?updateQuickTripDraft/u);
});

test("disabled personal Start explains a missing goal or stale/locked step with a recovery action", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const startAt = app.indexOf("Bắt đầu buổi học ·");
  const startEnd = app.indexOf("studyExerciseStartPrompt", startAt);
  const startPanel = app.slice(app.lastIndexOf("<button", startAt), startEnd);

  assert.match(app, /const studyPlanStartBlockReason = goal\.trim\(\)\.length < 3[\s\S]*?studyPlanStepStartAllowed/u);
  assert.match(startPanel, /aria-describedby=\{studyPlanStartBlockReason \? "study-plan-start-block-reason" : undefined\}/u);
  assert.match(startPanel, /id="study-plan-start-block-reason"[\s\S]*?role="status"/u);
  assert.match(startPanel, /<p className="material-hint" id="study-plan-start-block-reason" role="status">\{studyPlanStartBlockReason\}<\/p>/u);
  assert.match(app, /"Nhập mục tiêu học ít nhất 3 ký tự để bật nút bắt đầu\."/u);
  assert.match(app, /"Bước đang chọn chưa mở hoặc bản nháp đã cũ/u);
  assert.match(startPanel, /document\.getElementById\("study-workspace-goal"\).*?\.focus\(\)/u);
  assert.match(startPanel, /Chọn bước đang mở/u);
  assert.match(startPanel, /selectStudyPlanStep\(firstStartableStudyPlanStep\.id, selectedStudyPlan\.id\)/u);
  assert.match(app, /onEnterFreeStudy=\{mode === "solo" && selectedStudyPlan \? enterFreeStudyWorkspace : undefined\}/u);
  assert.match(app, /studyPlanStepForRecovery\(studyPlanStorage, selectedStudyPlan\.id\)/u);
});

test("App sends explicit route states and keeps stale locked step details read only", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const storageStart = app.indexOf("const studyPlanStorage = saved.studyPlanStorage");
  const storageEnd = app.indexOf("const studyPlanStartBlockReason", storageStart);
  const routeState = app.slice(storageStart, storageEnd);
  const saveStart = app.indexOf("function saveStudyPlanStep(");
  const saveEnd = app.indexOf("function persistStudyWorkspaceDraft", saveStart);
  const save = app.slice(saveStart, saveEnd);
  const workspaceStart = app.indexOf("<StudyPlanWorkspace");
  const workspaceEnd = app.indexOf("legacyDetails={<BoardingTicket", workspaceStart);
  const workspace = app.slice(workspaceStart, workspaceEnd);

  assert.match(routeState, /studyPlanRouteStates\(studyPlanStorage, selectedStudyPlan\.id\)/u);
  assert.match(routeState, /requestedStudyPlanStep[\s\S]*?canSelectStudyPlanStep\(studyPlanStorage, selectedStudyPlan\.id/u);
  assert.match(routeState, /studyPlanStepForRecovery\(studyPlanStorage, selectedStudyPlan\.id\)/u);
  assert.match(routeState, /canEditSelectedStudyPlanStep[\s\S]*?draft\.candidateSessionId === selectedStudyPlanStep\.plannedSessionId/u);
  assert.match(workspace, /stepStates=\{studyPlanStepStates\}/u);
  assert.match(workspace, /selectedStepId=\{selectedStudyPlanStep\?\.id \?\? ""\}/u);
  assert.match(workspace, /onSaveStep=\{canEditSelectedStudyPlanStep \? saveStudyPlanStep : undefined\}/u);
  assert.match(workspace, /onEnterFreeStudy=\{mode === "solo" && selectedStudyPlan \? enterFreeStudyWorkspace : undefined\}/u);
  assert.match(workspace, /freeStudyDisabled=\{busy \|\| !!active \|\| tripStartInFlight\.current/u);
  assert.match(save, /!canSelectStudyPlanStep\(storage, selectedPlanId, stepId\)/u);
});

test("free study saves and restores exact owner-local workspace identities without crossing live starts", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const enterStart = app.indexOf("function enterFreeStudyWorkspace()");
  const returnStart = app.indexOf("function returnToSavedStudyPlan()");
  const switchStart = app.indexOf("function selectStudyPlanStep(", returnStart);
  const enter = app.slice(enterStart, returnStart);
  const restore = app.slice(returnStart, switchStart);
  const actionRegionStart = app.indexOf("Bắt đầu buổi học ·");
  const actionRegion = app.slice(actionRegionStart, app.indexOf("studyPlanStartBlockReason &&", actionRegionStart));
  const workspaceStart = app.indexOf("<StudyPlanWorkspace");
  const workspaceEnd = app.indexOf("legacyDetails={<BoardingTicket", workspaceStart);
  const workspace = app.slice(workspaceStart, workspaceEnd);

  assert.notEqual(enterStart, -1);
  assert.notEqual(returnStart, -1);
  assert.notEqual(switchStart, -1);
  assert.match(enter, /value\.active \|\| tripStartInFlight\.current/u);
  assert.match(enter, /mode !== "solo"/u);
  assert.match(enter, /enterFreeStudyWorkspaceStorage\(storage,[\s\S]*?notes: documentText,[\s\S]*?sources,[\s\S]*?materials/u);
  assert.ok(enter.indexOf("commit({") < enter.indexOf("setDraftTripId(freeSessionId)"));
  assert.match(enter, /updateQuickTripDraft\(quickTripDraft,[\s\S]*?selectedPlanId: null,[\s\S]*?selectedStepId: null/u);
  assert.ok(enter.indexOf("commit({") < enter.indexOf("updateQuickTripDraft(quickTripDraft"));
  assert.ok(enter.indexOf("updateQuickTripDraft(quickTripDraft") < enter.indexOf("setDraftTripId(freeSessionId)"));
  assert.ok(enter.indexOf("setDraftTripId(freeSessionId)") < enter.indexOf("setDocumentText(\"\")"));
  assert.match(restore, /value\.active \|\| tripStartInFlight\.current/u);
  assert.match(restore, /returnFromFreeStudyWorkspace\(storage,[\s\S]*?currentSessionId: draftTripIdRef\.current,[\s\S]*?notes: documentText,[\s\S]*?sources,[\s\S]*?materials/u);
  assert.match(restore, /const usedSessionIds = new Set\([\s\S]*?historySessions[\s\S]*?guestExerciseSessions[\s\S]*?removedSessionIds/u);
  assert.ok(restore.indexOf("commit({") < restore.indexOf("setDraftTripId(identity.sessionId)"));
  assert.match(workspace, /onEnterFreeStudy=\{mode === "solo" && selectedStudyPlan \? enterFreeStudyWorkspace : undefined\}/u);
  assert.match(actionRegion, /Quay lại lộ trình/u);
  assert.doesNotMatch(actionRegion, /Học tự do/u, "the path component owns the dirty-editor guard for this transition");
});

test("only a matching full solo focus receipt is committed with its completed session", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const start = app.indexOf("function finish() {");
  const end = app.indexOf("useEffect(() => {\n    finishRef.current = finish;", start);
  const finish = app.slice(start, end);
  const proof = finish.indexOf("qualifiesStudyPlanStepCompletion");
  const record = finish.indexOf("recordCompletedStudyPlanStep", proof);
  const commit = finish.indexOf("if (commit(value))", record);

  assert.notEqual(proof, -1);
  assert.notEqual(record, -1);
  assert.notEqual(commit, -1);
  assert.match(finish.slice(proof, record), /sessionId: s\.id[\s\S]*?activeSessionId: trip\.id[\s\S]*?tripOwner: trip\.owner[\s\S]*?currentOwner: ownerRef\.current[\s\S]*?groupId: trip\.groupId[\s\S]*?focusedSeconds: s\.seconds/u);
  assert.match(finish.slice(record, commit), /clearStudyPlanActiveBinding|activePlanBinding/u);
  assert.match(finish.slice(record, commit), /recordCompletedStudyPlanStep\(value\.studyPlanStorage, activePlanBinding, s\.ended\)/u);
  assert.ok(record < commit);
});

test("exercise focus-start notification happens once and only after the active session commits", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const beginAt = app.indexOf("const beginFocus = (input:");
  const beginEnd = app.indexOf('if (owner === "guest" && withExercises)', beginAt);
  const begin = app.slice(beginAt, beginEnd);
  const callers = app.slice(beginEnd, app.indexOf("const autoResumePrepared", beginEnd));
  const commitStart = begin.indexOf("if (commit({");
  const notification = begin.indexOf("onStudyExerciseFocusStarted(trip.id)", commitStart);

  assert.notEqual(commitStart, -1);
  assert.notEqual(notification, -1);
  assert.ok(commitStart < notification);
  assert.match(begin, /if \(withExercises\) onStudyExerciseFocusStarted\(trip\.id\)/u);
  assert.doesNotMatch(callers, /onStudyExerciseFocusStarted\(/u);
  assert.equal((app.match(/onStudyExerciseFocusStarted\(/gu) ?? []).length, 1);
});

test("onboarding tutorial renders only the live owner-local control and ordinary edits do not advance it", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const onboardingStart = app.indexOf("canShowStudyOnboarding(loaded, saved.active, saved.studyPlanStorage?.onboarding) ? (");
  const workspaceStart = app.indexOf("<StudyPlanWorkspace", onboardingStart);
  const tutorial = app.slice(onboardingStart, workspaceStart);
  const retrievalStart = app.indexOf("<QuizReviewPreference", workspaceStart);
  const retrievalEnd = app.indexOf("/>", retrievalStart);
  const workspaceRetrieval = app.slice(retrievalStart, retrievalEnd);
  const sourceStart = app.indexOf("function validateStudyTutorialControl(");
  const sourceEnd = app.indexOf("return (\n    <div", sourceStart);
  const guideHandlers = app.slice(sourceStart, sourceEnd);
  const sourceModeEffectStart = app.indexOf("useEffect(() => {\n    if (onboardingPhase !== \"complete\" && onboardingPhase !== \"skipped\") return;");
  const sourceModeEffectEnd = app.indexOf("const tutorialControlDisabled", sourceModeEffectStart);
  const sourceModeEffect = app.slice(sourceModeEffectStart, sourceModeEffectEnd);

  assert.notEqual(onboardingStart, -1);
  assert.match(tutorial, /goalControl=/u);
  assert.match(tutorial, /durationControl=/u);
  assert.match(tutorial, /retrievalControl=/u);
  assert.match(tutorial, /onGuideControl=\{validateStudyTutorialControl\}/u);
  assert.match(tutorial, /onProgressChange=\{saveStudyOnboardingProgress\}/u);
  assert.doesNotMatch(tutorial, /<StudyPlanWorkspace/u);
  assert.doesNotMatch(guideHandlers, /querySelector|scrollIntoView|requestAnimationFrame/u);
  assert.match(guideHandlers, /if \(control === "retrieval"\) return canStartSessionWithQuizReview\(quizCount, skipQuizReview\)/u);
  assert.match(sourceModeEffect, /onboardingPhase !== "complete" && onboardingPhase !== "skipped"/u);
  assert.match(sourceModeEffect, /onboardingSourceChoice === "notes"\) setStudyInput\("notes"\)/u);
  assert.match(sourceModeEffect, /onboardingSourceChoice === "files"\) setStudyInput\("files"\)/u);
  assert.doesNotMatch(sourceModeEffect, /studyInput|quizPrefetch|sourceConsent/u);
  assert.doesNotMatch(workspaceRetrieval, /recordStudyTutorialRetrievalChoice/u);
  assert.doesNotMatch(app, /recordStudyTutorialRetrievalChoice/u);
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

test("mandatory onboarding disables unavailable navigation while the guide remains skippable", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const navStart = app.indexOf("{nav.map((n) => {");
  const navEnd = app.indexOf("})}", navStart);
  const nav = app.slice(navStart, navEnd);

  assert.match(nav, /if \(firstUseNeedsWorkspace && n\.id !== "station"\) return null/u);
  assert.match(nav, /disabled=\{firstUseNeedsWorkspace\}/u);
  assert.match(app, /disabled=\{firstUseNeedsWorkspace\}[\s\S]*?go\("account"\)/u);
  assert.match(app, /firstUseNeedsWorkspace\s*\?\s*"Hướng dẫn có thể bỏ qua"\s*:\s*online/u);
  assert.doesNotMatch(app, /Hoàn tất hướng dẫn để bắt đầu/u);
  assert.match(app, /online && !authOffline && !needsLogin\s*\?\s*"Trực tuyến"/u);
});

test("source tutorial changes only the local input mode and does not query a hidden workspace control", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const start = app.indexOf("function chooseStudyTutorialSource(");
  const end = app.indexOf("const tutorialControlDisabled", start);
  const chooseSource = app.slice(start, end);

  assert.match(chooseSource, /const mode = choice === "files" \? "files" : "notes"/u);
  assert.match(chooseSource, /setStudyInput\(mode\)/u);
  assert.doesNotMatch(chooseSource, /querySelector|scrollIntoView|requestAnimationFrame|postGuestAi|request\(/u);
  assert.doesNotMatch(app, /study-tutorial-return-cue/u);
});

test("retrieval tutorial slot keeps local preferences separate from explicit Continue validation", async () => {
  const app = normalizedApp(await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"));
  const slotStart = app.indexOf("const studyTutorialRetrievalControl =");
  const slotEnd = app.indexOf(";\n  return (", slotStart);
  const slot = app.slice(slotStart, slotEnd);
  const validationStart = app.indexOf("function validateStudyTutorialControl(");
  const validationEnd = app.indexOf("function chooseStudyTutorialSource(", validationStart);
  const validation = app.slice(validationStart, validationEnd);

  assert.match(slot, /value=\{quizCount\}/u);
  assert.match(slot, /onChange=\{\(event\) => setQuizCount/u);
  assert.match(slot, /aria-pressed=\{skipQuizReview\}/u);
  assert.match(slot, /onClick=\{\(\) => setSkipQuizReview/u);
  assert.doesNotMatch(slot, /prefetchEnabled|sourceConsent|recordStudyTutorialRetrievalChoice|generateQuiz|postGuestAi|startGuestAiSession/u);
  assert.match(validation, /return canStartSessionWithQuizReview\(quizCount, skipQuizReview\)/u);
  assert.doesNotMatch(validation, /recordStudyTutorialRetrievalChoice|saveStudyOnboardingProgress/u);
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
