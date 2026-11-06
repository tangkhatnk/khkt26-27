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
let StudyPlanStepEditor;
let StudyPlanStepNavigation;
let getStudyPlanStepDraftErrors;
let isStudyPlanStepDraftDirty;
let buildStudyPlanStepPatch;
let commitStudyPlanStepDraft;
let requestStudyPlanStepSelection;
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
  ({
    StudyPlanWorkspace,
    StudyPlanStepEditor,
    StudyPlanStepNavigation,
    getStudyPlanStepDraftErrors,
    isStudyPlanStepDraftDirty,
    buildStudyPlanStepPatch,
    commitStudyPlanStepDraft,
    requestStudyPlanStepSelection,
  } = await vite.ssrLoadModule("/src/adventure/StudyPlanWorkspace.tsx"));
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

function collectElements(element, result = []) {
  if (Array.isArray(element)) {
    for (const child of element) collectElements(child, result);
  } else if (element && typeof element === "object" && "type" in element && "props" in element) {
    result.push(element);
    collectElements(element.props.children, result);
  }
  return result;
}

test("goal-first workspace prioritizes the objective and keeps subject and focus time as support", () => {
  const view = render();

  assert.match(view, /aria-labelledby="study-plan-workspace-title"/u);
  assert.match(view, /<h1 id="study-plan-workspace-title">Bạn muốn đạt điều gì\?<\/h1>/u);
  assert.match(view, /class="study-plan-workspace__hero-meta"[^>]*>[\s\S]*?Sinh học[\s\S]*?45 phút học/u);
  assert.doesNotMatch(view, /<dt>Môn học<\/dt>|<dt>Thời lượng học<\/dt>/u);
  assert.match(view, /<dt>Giải lao<\/dt><dd>2 lượt × 5 phút<\/dd>/u);
  assert.match(view, /<dt>Tổng buổi<\/dt><dd>55 phút<\/dd>/u);
  assert.match(view, /data-testid="materials">Nội dung học/u);
  assert.match(view, /<details class="study-plan-workspace__legacy"><summary>Chi tiết hành trình cũ<\/summary>/u);
  assert.doesNotMatch(view, /<details[^>]*\bopen(?:=|>)/u);
});

test("selected step position is truthful and plan generation is the single highlighted plan action", () => {
  const view = render({
    plan: {
      id: "plan-a",
      title: "Ôn tập tế bào",
      origin: "manual",
      selectedStepId: "step-b",
      steps: [
        { id: "step-a", title: "Đọc ý chính", action: "Đọc ghi chú", outcome: "Nêu được ý", check: "Tự nhắc lại", preferredMinutes: 20 },
        { id: "step-b", title: "Tự kiểm tra", action: "Trả lời câu hỏi", outcome: "Tìm điểm chưa rõ", check: "Giải thích lại", preferredMinutes: 25 },
        { id: "step-c", title: "Củng cố", action: "Viết tóm tắt", outcome: "Ghi lại ý chính", check: "Đối chiếu ghi chú", preferredMinutes: 25 },
      ],
    },
    onGeneratePlan: () => {},
  });

  assert.match(view, /class="[^"]*study-plan-workspace__step-position[^"]*">BƯỚC 2 \/ 3<\/p>/u);
  assert.equal((view.match(/class="study-plan-workspace__generate"/gu) ?? []).length, 1);
  assert.doesNotMatch(view, /class="[^"]*\bprimary\b[^"]*"/u);
});

test("step navigation and selected details stay compact while long Vietnamese text can wrap", async () => {
  const css = await readFile(resolve(projectRoot, "src/adventure/studyPlanWorkspace.css"), "utf8");

  assert.match(css, /\.study-plan-workspace__steps\s*\{[^}]*overflow-x:\s*auto/su);
  assert.match(css, /\.study-plan-workspace__selected-content\s*\{[^}]*grid-template-columns:\s*repeat\(3,/su);
  assert.match(css, /\.study-plan-workspace__goal h1\s*\{[^}]*overflow-wrap:\s*anywhere/su);
  assert.match(css, /\.study-plan-workspace__selected-content dd\s*\{[^}]*overflow-wrap:\s*anywhere/su);
  assert.match(css, /\.adventure \.study-plan-workspace__generate\s*\{[^}]*border:\s*2px solid #59856a[^}]*font-weight:\s*700/su);
  assert.match(css, /@media\s*\(max-width:\s*640px\)/u);
});

test("invalid manual minutes stay visible without a NaN summary or AI start action", () => {
  const view = render({
    goal: "Ôn phản ứng hóa học",
    preferredMinutes: NaN,
    onGeneratePlan: () => {},
  });

  assert.match(view, /class="study-plan-workspace__hero-meta"[^>]*>[\s\S]*?Thời lượng chưa hợp lệ/u);
  assert.match(view, /<dt>Tổng buổi<\/dt><dd>Chưa xác định<\/dd>/u);
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

test("plan navigation stays compact while the selected step owns the detail panel", () => {
  const view = render({
    plan: {
      id: "plan-a",
      title: "Ôn trao đổi chất",
      origin: "manual",
      selectedStepId: "step-a",
      steps: [
        {
          id: "step-a", plannedSessionId: "session-a", title: "Đọc phần đầu",
          action: "Đọc phần ghi chú đã xem", outcome: "Nêu được hai ý chính",
          check: "Tự diễn đạt lại bằng lời", preferredMinutes: 20,
        },
        {
          id: "step-b", plannedSessionId: "session-b", title: "Tự kiểm tra",
          action: "Trả lời câu hỏi ôn tập", outcome: "Phát hiện phần còn thiếu",
          check: "Giải thích lại điểm chưa rõ", preferredMinutes: 25,
        },
      ],
    },
    onSelectStep: () => {},
    onSaveStep: () => {},
  });

  assert.match(view, /class="[^"]*study-plan-workspace__step-nav"/u);
  assert.match(view, /<strong>Đọc phần đầu<\/strong>/u);
  assert.match(view, /<strong>Tự kiểm tra<\/strong>/u);
  assert.match(view, /class="study-plan-workspace__selected-step"/u);
  assert.match(view, /Đọc phần ghi chú đã xem/u);
  assert.doesNotMatch(view.slice(view.indexOf("study-plan-workspace__step-nav"), view.indexOf("class=\"study-plan-workspace__selected-step\"")), /Đọc phần ghi chú đã xem|Trả lời câu hỏi ôn tập/u);

  const selected = [];
  const navigation = StudyPlanStepNavigation({
    steps: [
      { id: "step-a", title: "Đọc phần đầu" },
      { id: "step-b", title: "Tự kiểm tra" },
    ],
    selectedStepId: "step-a",
    onSelectStep: (id) => selected.push(id),
  });
  const navButtons = collectElements(navigation).filter((node) => node.type === "button");
  navButtons[1].props.onClick();
  assert.deepEqual(selected, ["step-b"]);
  const staticNavigation = StudyPlanStepNavigation({
    steps: [{ id: "step-a", title: "Đọc phần đầu" }],
    selectedStepId: "step-a",
  });
  assert.equal(collectElements(staticNavigation).find((node) => node.type === "button").props.disabled, true);
});

test("step editor retains raw drafts until Save or Cancel and exposes accessible fields", () => {
  const rawChanges = [];
  let saves = 0;
  let cancels = 0;
  const draft = {
    action: "  Viết lại khái niệm  ",
    outcome: "Nêu được định nghĩa",
    check: "Tự giải thích không nhìn tài liệu",
  };
  const editor = StudyPlanStepEditor({
    stepTitle: "Tự kiểm tra",
    draft,
    errors: {},
    canSave: true,
    onDraftChange: (field, value) => rawChanges.push([field, value]),
    onSave: () => { saves += 1; },
    onCancel: () => { cancels += 1; },
  });
  const nodes = collectElements(editor);
  const textareas = nodes.filter((node) => node.type === "textarea");
  const buttons = nodes.filter((node) => node.type === "button");

  assert.equal(textareas.length, 3);
  assert.match(renderToStaticMarkup(editor), /aria-label="Hành động cho bước Tự kiểm tra"/u);
  assert.match(renderToStaticMarkup(editor), /aria-label="Kết quả mong đợi cho bước Tự kiểm tra"/u);
  assert.match(renderToStaticMarkup(editor), /aria-label="Câu tự kiểm tra cho bước Tự kiểm tra"/u);
  assert.equal(textareas[0].props.value, draft.action);
  textareas[0].props.onChange({ currentTarget: { value: "  bản nháp chưa lưu  " } });
  assert.deepEqual(rawChanges, [["action", "  bản nháp chưa lưu  "]]);
  buttons.find((node) => node.props.children === "Lưu thay đổi").props.onClick();
  buttons.find((node) => node.props.children === "Hủy").props.onClick();
  assert.equal(saves, 1);
  assert.equal(cancels, 1);

  const invalidMarkup = renderToStaticMarkup(StudyPlanStepEditor({
    stepId: "step-a",
    stepTitle: "Tự kiểm tra",
    draft: { ...draft, action: "  " },
    errors: { action: "Nhập ít nhất 3 ký tự." },
    canSave: false,
    onDraftChange: () => {},
    onSave: () => {},
    onCancel: () => {},
  }));
  assert.match(invalidMarkup, /aria-invalid="true"/u);
  assert.match(invalidMarkup, /role="alert">Nhập ít nhất 3 ký tự\.<\/p>/u);
  assert.match(invalidMarkup, /class="study-plan-workspace__save" disabled/u);
});

test("step draft validation enforces trimmed field bounds without mutating raw drafts", () => {
  const draft = {
    action: "  làm  ",
    outcome: "x".repeat(401),
    check: "   ",
  };
  const errors = getStudyPlanStepDraftErrors(draft);

  assert.deepEqual(errors, {
    outcome: "Tối đa 400 ký tự.",
    check: "Nhập ít nhất 3 ký tự.",
  });
  assert.equal(draft.action, "  làm  ");
  assert.equal(draft.outcome.length, 401);
  assert.deepEqual(buildStudyPlanStepPatch({
    action: "  Viết lại khái niệm  ",
    outcome: " Nêu được định nghĩa ",
    check: " Tự giải thích không nhìn tài liệu ",
  }), {
    action: "Viết lại khái niệm",
    outcome: "Nêu được định nghĩa",
    check: "Tự giải thích không nhìn tài liệu",
  });
});

test("dirty step changes block switching and generation until saved or cancelled", () => {
  const original = {
    action: "Đọc phần ghi chú", outcome: "Nêu được hai ý chính", check: "Tự diễn đạt lại",
  };
  const draft = { ...original, action: "  Đọc phần ghi chú  " };
  assert.equal(isStudyPlanStepDraftDirty(original, draft), false);
  assert.equal(isStudyPlanStepDraftDirty(original, { ...draft, action: "Đọc chủ động" }), true);

  const calls = [];
  const allowed = requestStudyPlanStepSelection({
    stepId: "step-b",
    dirty: true,
    onSelect: (id) => calls.push(["select", id]),
    onBlocked: () => calls.push(["blocked"]),
  });
  assert.equal(allowed, false);
  assert.deepEqual(calls, [["blocked"]]);
});

test("step save callback receives only changed step fields after trimming valid drafts", () => {
  const saved = [];
  const current = { action: "Đọc phần ghi chú", outcome: "Nêu được hai ý", check: "Tự diễn đạt lại" };
  const draft = { action: "  Đọc chủ động  ", outcome: "  Nêu được hai ý  ", check: " Tự diễn đạt lại " };

  assert.equal(commitStudyPlanStepDraft({
    stepId: "step-a",
    current,
    draft,
    onSave: (stepId, patch) => {
      saved.push([stepId, patch]);
      return true;
    },
  }), true);
  assert.deepEqual(saved, [["step-a", {
    action: "Đọc chủ động",
    outcome: "Nêu được hai ý",
    check: "Tự diễn đạt lại",
  }]]);
  assert.equal(commitStudyPlanStepDraft({
    stepId: "step-a",
    current,
    draft: { ...draft, action: "  " },
    onSave: () => assert.fail("invalid edits must not be saved"),
  }), false);
  assert.equal(commitStudyPlanStepDraft({
    stepId: "step-a",
    current,
    draft: { ...current },
    onSave: () => assert.fail("unchanged edits must not be saved"),
  }), false);
  assert.equal(commitStudyPlanStepDraft({
    stepId: "step-a",
    current,
    draft,
    onSave: () => false,
  }), false);
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
  assert.doesNotMatch(app.slice(app.indexOf("function start(skipPendingExercises"), app.indexOf("const hasReadyPreparation", app.indexOf("function start(skipPendingExercises"))), /canOpenStudyWorkspace|tutorialActive|onboarding\.phase/u);
  assert.doesNotMatch(app.slice(app.indexOf("async function generateStudyGuide("), app.indexOf("function acceptStudyGuide(", app.indexOf("async function generateStudyGuide("))), /tutorialActive/u);
  assert.doesNotMatch(app.slice(app.indexOf("async function readHandwriting("), app.indexOf("async function generateStudyGuide(", app.indexOf("async function readHandwriting("))), /tutorialActive/u);
  assert.doesNotMatch(app, /disabled=\{busy \|\| tutorialActive \|\| privateTripDraftLocked/u);
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
  assert.match(app, /onCountChange=\{\(value\) => \{\s*setQuizCount\(value\);\s*recordStudyTutorialRetrievalChoice\(value\);\s*\}\}/u);
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

  assert.match(view, /Hướng dẫn không tự gửi yêu cầu/u);
  assert.match(view, /thao tác AI chỉ chạy khi bạn chủ động chọn/u);
  assert.match(view, /Đi tới lựa chọn ôn tập/u);
  assert.doesNotMatch(view, /Tôi đã biết bước tự kiểm tra/u);
});

test("selected plan steps bind their planned session id without changing the manual duration", async () => {
  const app = (await readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8")).replace(/\r\n?/gu, "\n");
  const selectStart = app.indexOf("function selectStudyPlanStep(");
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
  assert.match(normalizedApp, /canonicalStudyView\(requestedView/u);
  assert.match(normalizedApp, /if \(loaded && requestedView !== view\) replaceBrowserView\(view\)/u);
  assert.match(normalizedApp, /view === "station" \|\| view === "ticket"/u);
});

test("the goal-first station route and legacy ticket alias share the study workspace guard", () => {
  assert.equal(isStudyWorkspaceView("station"), true);
  assert.equal(isStudyWorkspaceView("ticket"), true);
  assert.equal(isStudyWorkspaceView("focus"), false);
  assert.equal(isStudyWorkspaceView("group"), false);
});
