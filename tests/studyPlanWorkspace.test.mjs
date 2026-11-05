import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let vite;
let StudyPlanWorkspace;
let StudyWorkspaceSettings;
let StudyOnboarding;
let studyPlanFlow;
let learningPath;
let studyOnboardingModel;
let isStudyWorkspaceView;

before(async () => {
  vite = await createServer({
    configFile: resolve(projectRoot, "vite.config.ts"),
    configLoader: "runner",
    cacheDir: resolve(projectRoot, "node_modules/.vite-study-plan-workspace-tests"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ StudyPlanWorkspace } = await vite.ssrLoadModule("/src/adventure/StudyPlanWorkspace.tsx"));
  ({ StudyWorkspaceSettings } = await vite.ssrLoadModule("/src/adventure/StudyWorkspaceSettings.tsx"));
  ({ StudyOnboarding } = await vite.ssrLoadModule("/src/adventure/StudyOnboarding.tsx"));
  studyPlanFlow = await vite.ssrLoadModule("/src/adventure/studyPlanFlow.ts");
  learningPath = await vite.ssrLoadModule("/src/adventure/learningPath.ts");
  studyOnboardingModel = await vite.ssrLoadModule("/src/adventure/studyOnboardingModel.ts");
  ({ isStudyWorkspaceView } = await vite.ssrLoadModule("/src/adventure/navigation.ts"));
});

after(async () => {
  await vite?.close();
});

function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(StudyPlanWorkspace, {
    goal: "",
    subject: "Sinh học",
    preferredMinutes: 45,
    breakCount: 2,
    breakMinutes: 5,
    children: React.createElement("div", { "data-testid": "materials" }, "Nội dung học"),
    legacyDetails: React.createElement("span", null, "Chi tiết tuyến cũ"),
    ...overrides,
  }));
}

test("goal-first workspace summarizes goal, subject, breaks, and total time with one inline content column", () => {
  const view = render();

  assert.match(view, /aria-labelledby="study-plan-workspace-title"/u);
  assert.match(view, /<h1 id="study-plan-workspace-title">Bạn muốn đạt điều gì\?<\/h1>/u);
  assert.match(view, /<dt>Môn học<\/dt><dd>Sinh học<\/dd>/u);
  assert.match(view, /<dt>Thời lượng học<\/dt><dd>45 phút<\/dd>/u);
  assert.match(view, /<dt>Giải lao<\/dt><dd>2 lượt × 5 phút<\/dd>/u);
  assert.match(view, /<dt>Tổng thời gian<\/dt><dd>55 phút<\/dd>/u);
  assert.match(view, /data-testid="materials">Nội dung học/u);
  assert.match(view, /<details class="study-plan-workspace__legacy"><summary>Chi tiết hành trình cũ<\/summary>/u);
  assert.doesNotMatch(view, /<details[^>]*\bopen(?:=|>)/u);
});

test("invalid manual minutes stay visible without a NaN summary or AI start action", () => {
  const view = render({
    goal: "Ôn phản ứng hóa học",
    preferredMinutes: NaN,
    onGeneratePlan: () => {},
  });

  assert.match(view, /<dt>Thời lượng học<\/dt><dd>Chưa hợp lệ<\/dd>/u);
  assert.match(view, /<dt>Tổng thời gian<\/dt><dd>Chưa xác định<\/dd>/u);
  assert.doesNotMatch(view, /NaN/u);
  assert.match(view, /class="study-plan-workspace__generate"[^>]*disabled/u);
});

test("goal and duration controls render visibly with the exact tutorial targets", () => {
  const view = renderToStaticMarkup(React.createElement(StudyWorkspaceSettings, {
    goal: "Ôn trao đổi chất",
    topic: "biology",
    topics: [{ id: "biology", name: "Sinh học" }],
    minutes: 25,
    breakCount: 1,
    breakMinutes: 5,
    goalDisabled: false,
    topicDisabled: false,
    durationLocked: false,
    breaksLocked: false,
    onGoalChange: () => {},
    onTopicChange: () => {},
    onDurationChange: () => {},
    onBreakCountChange: () => {},
    onBreakMinutesChange: () => {},
  }));

  assert.match(view, /<label for="study-workspace-goal">Mục tiêu buổi học<textarea id="study-workspace-goal"/u);
  assert.match(view, /<label for="study-workspace-topic">Chủ đề<select id="study-workspace-topic"/u);
  assert.match(view, /class="duration-range-field"/u);
  assert.match(view, /class="custom-duration"/u);
  assert.doesNotMatch(view, /class="ticket-editor"/u);
});

test("legacy ticket entry keeps its optional collapsed editor while station fields stay direct", () => {
  const view = renderToStaticMarkup(React.createElement(StudyWorkspaceSettings, {
    goal: "Ôn trao đổi chất",
    topic: "biology",
    topics: [{ id: "biology", name: "Sinh học" }],
    minutes: 25,
    breakCount: 0,
    breakMinutes: 5,
    goalDisabled: false,
    topicDisabled: false,
    durationLocked: false,
    breaksLocked: false,
    legacyDisclosure: true,
    onGoalChange: () => {},
    onTopicChange: () => {},
    onDurationChange: () => {},
    onBreakCountChange: () => {},
    onBreakMinutesChange: () => {},
  }));

  assert.match(view, /<details class="ticket-editor"><summary>Chỉnh mục tiêu và thời gian<\/summary>/u);
  assert.doesNotMatch(view, /<details[^>]*\bopen(?:=|>)/u);
});

test("AI plan steps remain labeled drafts and expose their action, outcome, and check", () => {
  const view = render({
    goal: "Giải thích chức năng của màng tế bào",
    plan: {
      id: "plan-a",
      title: "Tìm hiểu màng tế bào",
      origin: "ai",
      selectedStepId: "step-a",
      steps: [{
        id: "step-a",
        title: "Đọc và nhận diện",
        action: "Đọc phần ghi chú đã xem",
        outcome: "Nêu được hai chức năng",
        check: "Tự diễn đạt bằng lời của mình",
        preferredMinutes: 45,
      }],
    },
  });

  assert.match(view, /Giải thích chức năng của màng tế bào/u);
  assert.match(view, /Đề xuất AI · chưa xác minh/u);
  assert.match(view, /Đọc phần ghi chú đã xem/u);
  assert.match(view, /Nêu được hai chức năng/u);
  assert.match(view, /Tự diễn đạt bằng lời của mình/u);
  assert.match(view, /aria-current="step"/u);
});

test("workspace exposes a deliberate plan request and visible recoverable states", () => {
  const view = render({
    onGeneratePlan: () => {},
    planStatus: "error",
    planError: "Không thể kết nối. Thử lại sau.",
  });

  assert.match(view, /Nhờ AI chia mục tiêu thành các bước/u);
  assert.match(view, /Không thể kết nối\. Thử lại sau\./u);
});

test("pending plan generation exposes a cancel action and cancelled confirmation", () => {
  const pending = render({ planStatus: "pending", onCancelPlan: () => {} });
  const cancelled = render({ planStatus: "cancelled" });

  assert.match(pending, /role="status"[^>]*>Đang tạo bản nháp lộ trình/u);
  assert.match(pending, /<button class="study-plan-workspace__cancel" type="button">Hủy yêu cầu<\/button>/u);
  assert.match(cancelled, /role="status"[^>]*>Đã hủy yêu cầu lập kế hoạch\./u);
  assert.doesNotMatch(cancelled, /study-plan-workspace__cancel/u);
});

test("late plan responses are rejected after step change, focus start, navigation, or lease loss", () => {
  const sources = [];
  const materials = [];
  const original = {
    owner: "guest",
    authGeneration: 0,
    draftTripId: "draft-a",
    goal: "Ôn phản ứng hóa học",
    topic: "chemistry",
    minutes: 45,
    level: "",
    documentText: "",
    sources,
    materials,
    selectedPlanId: "plan-a",
    selectedStepId: "step-a",
    view: "station",
    activeSessionId: null,
    exclusive: true,
  };

  assert.equal(studyPlanFlow.isCurrentStudyPlanRequest(original, original), true);
  const invalidScope = { ...original, minutes: NaN };
  assert.equal(studyPlanFlow.isCurrentStudyPlanRequest(invalidScope, { ...invalidScope }), true);
  assert.equal(studyPlanFlow.isCurrentStudyPlanRequest(original, { ...original, selectedPlanId: "plan-b" }), false);
  assert.equal(studyPlanFlow.isCurrentStudyPlanRequest(original, { ...original, selectedStepId: "step-b" }), false);
  assert.equal(studyPlanFlow.isCurrentStudyPlanRequest(original, {
    ...original,
    view: "focus",
    activeSessionId: "session-a",
  }), false);
  assert.equal(studyPlanFlow.isCurrentStudyPlanRequest(original, { ...original, view: "report" }), false);
  assert.equal(studyPlanFlow.isCurrentStudyPlanRequest(original, { ...original, exclusive: false }), false);
});

test("AdventureApp wires the planner response fence and cancel action to its controller", async () => {
  const app = await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8");

  assert.match(app, /isCurrentStudyPlanRequest\(scope, latest\)/u);
  assert.match(app, /function cancelStudyPlanRequest\(\)[\s\S]*?studyPlanRequestGeneration\.current\+\+/u);
  assert.match(app, /onCancelPlan=\{cancelStudyPlanRequest\}/u);
  assert.match(app, /const draft = "minutes" in changes[\s\S]*?updateQuickTripDuration/u);
  assert.match(app, /setMinutes\(draft\.minutes\);[\s\S]*?if \(isValidStudyMinutes\(draft\.minutes\)\)/u);
  assert.match(app, /isGuestExerciseStartScopeCurrent\(\{[\s\S]*?view: viewRef\.current/u);
  assert.doesNotMatch(app, /workspaceLive\.current && viewRef\.current === "ticket" && draftTripIdRef/u);
  assert.match(app, /!current\.current\.active && current\.current\.studyPlanStorage\?\.onboarding\.phase !== "complete"/u);
  assert.match(app, /async function generateStudyGuide[\s\S]*?busy \|\| tutorialActive/u);
  assert.match(app, /async function readHandwriting[\s\S]*?busy \|\| tutorialActive/u);
  assert.match(app, /disabled=\{busy \|\| tutorialActive \|\| privateTripDraftLocked/u);
  assert.match(app, /const firstUseNeedsWorkspace = loaded && !saved\.active/u);
});

test("the station goal and duration controls stay visible and match tutorial targets", async () => {
  const app = (await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8")).replace(/\r\n?/gu, "\n");
  const settingsStart = app.indexOf('<section className="panel form departure-settings">');
  const settingsEnd = app.indexOf("</section>", settingsStart);
  const settings = app.slice(settingsStart, settingsEnd);

  assert.notEqual(settingsStart, -1);
  assert.notEqual(settingsEnd, -1);
  assert.doesNotMatch(settings, /<TicketEditor/u);
  assert.doesNotMatch(settings, /<TicketEditor/u);
  assert.match(settings, /<StudyWorkspaceSettings[\s\S]*?legacyDisclosure=\{view === "ticket"\}/u);
  assert.match(settings, /<QuizReviewPreference[\s\S]*?disabled=\{busy \|\| privateTripDraftLocked\}/u);
  assert.match(app, /function focusStudyTutorialControl[\s\S]*?target\.getClientRects\(\)\.length === 0\) return false/u);
  assert.match(app, /function recordStudyTutorialRetrievalChoice[\s\S]*?completeStudyOnboardingRetrievalChoice/u);
  assert.match(app, /onCountChange=\{\(value\) => \{ setQuizCount\(value\); recordStudyTutorialRetrievalChoice\(\); \}\}/u);
  assert.match(app, /quiz-review-preference input:not\(:disabled\), \.quiz-review-preference button:not\(:disabled\)/u);
});

test("retrieval tutorial asks for a local preference change rather than an acknowledgement", () => {
  let progress = studyOnboardingModel.createStudyOnboardingProgress({ goal: "Ôn tế bào" });
  progress = studyOnboardingModel.reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  progress = studyOnboardingModel.reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  progress = studyOnboardingModel.reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "goal" });
  progress = studyOnboardingModel.reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "source", choice: "none" });
  progress = studyOnboardingModel.reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "duration" });
  const view = renderToStaticMarkup(React.createElement(StudyOnboarding, {
    progress,
    currentDuration: 25,
    currentDraft: { ...progress.survey },
    onProgressChange: () => {},
  }));

  assert.match(view, /Khi bạn đổi một lựa chọn, hướng dẫn hoàn tất/u);
  assert.match(view, /Đi tới lựa chọn ôn tập/u);
  assert.doesNotMatch(view, /Tôi đã biết bước tự kiểm tra/u);
});

test("selected plan steps bind their planned session id without changing the manual duration", async () => {
  const app = (await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8")).replace(/\r\n?/gu, "\n");
  const selectStart = app.indexOf("function selectStudyPlanStep(stepId: string)");
  const persistStart = app.indexOf("function persistQuickTripStudyDraft", selectStart);
  const selection = app.slice(selectStart, persistStart);

  assert.match(app, /setDraftTripId\(steps\[0\]\.plannedSessionId\)/u);
  assert.match(app, /plannedSessionId: draftTripId/u);
  assert.match(selection, /setDraftTripId\(plannedSessionId\)/u);
  assert.match(selection, /draftSessionIdsRef\.current\.solo = plannedSessionId/u);
  assert.doesNotMatch(selection, /setMinutes\(/u);
});

test("old lesson and ticket URLs recover a pending legacy run as a personal draft", async () => {
  const app = await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8");
  const normalizedApp = app.replace(/\r\n?/gu, "\n");

  for (const oldView of ["lesson", "ticket"]) {
    const course = { id: "math-7-ratios" };
    const pendingRun = {
      courseId: course.id,
      lessonId: "math-7-ratios-meaning",
      lessonVersion: 1,
      sessionId: `legacy-${oldView}`,
      phase: "ticket",
    };
    const retired = learningPath.retireInactiveLegacyLessonRun({
      schemaVersion: 1,
      selectedCourseId: course.id,
      guideDismissed: true,
      completed: [{ lessonId: "prior", lessonVersion: 1, sessionId: "receipt", score: 1, total: 1, completedAt: 1, assessedAnswers: [] }],
      interruptedRuns: [],
      activeRun: pendingRun,
    }, pendingRun.sessionId);

    assert.equal(oldView === "lesson" || oldView === "ticket", true);
    assert.equal(retired.activeRun, undefined);
    assert.equal(retired.completed[0].sessionId, "receipt");
  }

  assert.match(normalizedApp, /pathRun && \(pathRun\.phase === "lesson" \|\| pathRun\.phase === "ticket"\) && !value\.active/u);
  assert.match(normalizedApp, /retireInactiveLegacyLessonRun\(value\.learningPath, pathRun\.sessionId\)/u);
  assert.match(normalizedApp, /updateStudyPlanDraftFromQuickTrip\(studyStorage\.draft, draft, topicLabel\)/u);
  assert.match(normalizedApp, /value\.notes = \{ \.\.\.value\.notes, \[pathRun\.sessionId\]: recoveredText \}/u);
  assert.match(normalizedApp, /value\.sources = \{ \.\.\.value\.sources, \[pathRun\.sessionId\]: recoveredSources \}/u);
  assert.match(normalizedApp, /requestedView === "lesson" \? \(saved\.active \? "focus" : "station"\) : requestedView/u);
  assert.match(normalizedApp, /if \(loaded && requestedView !== view\) setView\(view\)/u);
  assert.match(normalizedApp, /const views = \[[^\]]*"lesson"[^\]]*"ticket"/u);
  assert.match(normalizedApp, /view === "station" \|\| view === "ticket"/u);
});

test("the goal-first station route and legacy ticket alias share the study workspace guard", () => {
  assert.equal(isStudyWorkspaceView("station"), true);
  assert.equal(isStudyWorkspaceView("ticket"), true);
  assert.equal(isStudyWorkspaceView("focus"), false);
  assert.equal(isStudyWorkspaceView("group"), false);
});
