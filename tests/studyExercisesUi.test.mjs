import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let vite;
let helpers;
let components;
let client;
let api;
let StudyExerciseTextImportController;
let emptyTextImport;

before(async () => {
  vite = await createServer({
    configFile: resolve(projectRoot, "vite.config.ts"),
    configLoader: "runner",
    cacheDir: resolve(projectRoot, "node_modules/.vite-study-exercises-tests"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  helpers = await vite.ssrLoadModule("/src/adventure/studyExercises.ts");
  components = await vite.ssrLoadModule("/src/adventure/StudyExercisePreparation.tsx");
  client = await vite.ssrLoadModule("/src/services/studyExercisesApi.ts");
  api = await vite.ssrLoadModule("/src/services/api.ts");
  ({ StudyExerciseTextImportController, EMPTY_STUDY_EXERCISE_TEXT_IMPORT: emptyTextImport } =
    await vite.ssrLoadModule("/src/adventure/studyExerciseTextImport.ts"));
});

after(async () => {
  await vite?.close();
});

const source = (overrides = {}) => ({
  id: "source-a",
  name: "Chương 1.pdf",
  text: "Nội dung nguồn đã được xem lại.\nGiữ nguyên dấu và xuống dòng.",
  source: "local-ocr",
  requiresReview: false,
  reviewed: true,
  ...overrides,
});

const preparation = {
  id: "request-a",
  plannedSessionId: "session-a",
  mode: "generated",
  exercises: [
    { id: "question-a", prompt: "Tính $x$ từ phương trình $x + 2 = 5$." },
    { id: "question-b", prompt: "Giải thích cách kiểm tra nghiệm." },
  ],
};

const solutions = {
  exercises: [
    { id: "question-a", solution: "ANSWER_SECRET: $x = 3$", explanation: "EXPLANATION_SECRET: thay lại vào đề." },
    { id: "question-b", solution: "ANSWER_SECRET: thế lại nghiệm.", explanation: "EXPLANATION_SECRET: hai vế bằng nhau." },
  ],
};

function findElement(node, predicate) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return null;
  }
  if (!React.isValidElement(node)) return null;
  if (predicate(node)) return node;
  return findElement(node.props.children, predicate);
}

test("preparation inputs preserve exact problem text and require authentication and confirmation", () => {
  const exact = "  Tính x.\n\nGiải thích mã `x += 1`.  ";
  const input = helpers.createStudyExercisePreparationInput({
    requestId: "request-a",
    plannedSessionId: "session-a",
    mode: "provided",
    text: exact,
    count: 3,
    authenticated: true,
    confirmed: true,
  });
  assert.deepEqual(input, {
    requestId: "request-a",
    plannedSessionId: "session-a",
    mode: "provided",
    text: exact,
  });
  assert.equal(helpers.createStudyExercisePreparationInput({
    requestId: "request-a", plannedSessionId: "session-a", mode: "provided", text: exact,
    count: 3, authenticated: false, confirmed: true,
  }), null);
  assert.equal(helpers.createStudyExercisePreparationInput({
    requestId: "request-a", plannedSessionId: "session-a", mode: "provided", text: exact,
    count: 3, authenticated: true, confirmed: false,
  }), null);
});

test("exercise text imports support explicit replacement and append within the 20k limit", () => {
  assert.equal(helpers.applyStudyExerciseTextImport("Old exercise", "Extracted exercise", "replace"), "Extracted exercise");
  assert.equal(helpers.applyStudyExerciseTextImport("Old exercise", "Extracted exercise", "append"), "Old exercise\nExtracted exercise");
  assert.equal(helpers.applyStudyExerciseTextImport("Old exercise\n", "Extracted exercise", "append"), "Old exercise\nExtracted exercise");
  assert.equal(helpers.applyStudyExerciseTextImport("x".repeat(19_999), "y", "append"), null);
  assert.equal(helpers.applyStudyExerciseTextImport("Old exercise", " ", "replace"), null);
  assert.equal(helpers.applyStudyExerciseTextImport("Old exercise", "y".repeat(20_001), "replace"), null);
});

test("cancel aborts extraction and ignores its late file result", async () => {
  let finishExtraction;
  let signal;
  let extractionOptions;
  let currentState;
  const controller = new StudyExerciseTextImportController(state => { currentState = state; }, (_file, options) => {
    signal = options.signal;
    extractionOptions = options;
    return new Promise(resolve => { finishExtraction = resolve; });
  });
  const pending = controller.start({ name: "exercise.pdf" }, { plannedSessionId: "session-a", mode: "provided" });

  assert.equal(currentState.extracting, true);
  assert.equal(extractionOptions.maxTextChars, 20_000);
  controller.cancel("Đã hủy trích xuất.");
  assert.equal(signal.aborted, true);
  finishExtraction({ name: "exercise.pdf", text: "STALE OCR TEXT", status: "extracted", message: "Đã trích xuất." });
  await pending;

  assert.equal(currentState.text, "");
  assert.equal(currentState.message, "Đã hủy trích xuất.");
  controller.dispose();
});

test("unmount disposal aborts extraction without publishing late results", async () => {
  let finishExtraction;
  let signal;
  const states = [];
  const controller = new StudyExerciseTextImportController(state => { states.push(state); }, (_file, options) => {
    signal = options.signal;
    return new Promise(resolve => { finishExtraction = resolve; });
  });
  const pending = controller.start({ name: "exercise.pdf" }, { plannedSessionId: "session-a", mode: "provided" });
  const renderedStatesBeforeUnmount = states.length;

  controller.dispose();
  assert.equal(signal.aborted, true);
  finishExtraction({ name: "exercise.pdf", text: "AFTER UNMOUNT", status: "extracted", message: "Đã trích xuất." });
  await pending;

  assert.equal(states.length, renderedStatesBeforeUnmount);
});

test("mode and planned-session changes abort stale extraction results", async () => {
  const requests = [];
  let currentState;
  const controller = new StudyExerciseTextImportController(state => { currentState = state; }, (_file, options) =>
    new Promise(resolve => requests.push({ resolve, signal: options.signal })));
  const modePending = controller.start({ name: "exercise-a.pdf" }, { plannedSessionId: "session-a", mode: "provided" });

  controller.setContext({ plannedSessionId: "session-a", mode: "generated" });
  assert.equal(requests[0].signal.aborted, true);
  requests[0].resolve({ name: "exercise-a.pdf", text: "STALE MODE TEXT", status: "extracted", message: "Đã trích xuất." });
  await modePending;
  assert.equal(currentState.text, "");

  const sessionPending = controller.start({ name: "exercise-b.png" }, { plannedSessionId: "session-a", mode: "provided" });
  controller.setContext({ plannedSessionId: "session-b", mode: "provided" });
  assert.equal(requests[1].signal.aborted, true);
  requests[1].resolve({ name: "exercise-b.png", text: "STALE SESSION TEXT", status: "extracted", message: "Đã trích xuất." });
  await sessionPending;
  assert.equal(currentState.text, "");
  controller.dispose();
});

test("a newly rendered session context rejects late extraction before effects abort it", async () => {
  let context = { plannedSessionId: "session-a", mode: "provided" };
  let finishExtraction;
  let currentState;
  let signal;
  const controller = new StudyExerciseTextImportController(
    state => { currentState = state; },
    (_file, options) => {
      signal = options.signal;
      return new Promise(resolve => { finishExtraction = resolve; });
    },
    () => context,
  );
  const pending = controller.start({ name: "exercise.pdf" }, context);

  context = { plannedSessionId: "session-b", mode: "provided" };
  finishExtraction({ name: "exercise.pdf", text: "STALE SESSION TEXT", status: "extracted", message: "Đã trích xuất." });
  await pending;
  assert.equal(currentState.text, "");
  assert.equal(currentState.extracting, true);

  controller.setContext(context);
  assert.equal(signal.aborted, true);
  assert.equal(currentState.extracting, false);
  controller.dispose();
});

test("reviewed extraction edits are what explicit append or replace actions apply", async () => {
  const controller = new StudyExerciseTextImportController(() => {}, async file => ({
    name: file.name, text: "OCR output to review", status: "extracted", message: "Đã trích xuất nội dung từ tệp.",
  }));

  await controller.start({ name: "exercise.png" }, { plannedSessionId: "session-a", mode: "provided" });
  controller.editText("");
  controller.editText("Learner-reviewed prompt");

  assert.equal(controller.apply("Existing prompt", "replace"), "Learner-reviewed prompt");
  assert.equal(controller.apply("Existing prompt", "append"), "Existing prompt\nLearner-reviewed prompt");
  controller.dispose();
});

test("file import controls send file, cancel, edit and apply interactions to the production controller", async () => {
  let state = { ...emptyTextImport };
  let resolveExtraction;
  let pendingRequest;
  let extractionSignal;
  const applied = [];
  const controller = new StudyExerciseTextImportController(next => { state = next; }, (file, options) => {
    extractionSignal = options.signal;
    return new Promise(resolve => {
      resolveExtraction = () => resolve({
        name: file.name,
        text: "OCR draft",
        status: "extracted",
        message: "Đã trích xuất nội dung từ tệp.",
      });
    });
  });
  const renderPanel = () => components.StudyExerciseTextImportPanel({
    state,
    disabled: false,
    onFileSelected: file => { pendingRequest = controller.start(file, { plannedSessionId: "session-a", mode: "provided" }); },
    onCancel: () => controller.cancel("Đã hủy trích xuất."),
    onEdit: text => controller.editText(text),
    onApply: action => applied.push(controller.apply("Existing prompt", action)),
  });

  const fileInput = findElement(renderPanel(), element => element.props.id === "study-exercise-file");
  const file = { name: "exercise.png" };
  const event = { currentTarget: { files: [file], value: "exercise.png" } };
  fileInput.props.onChange(event);
  assert.equal(event.currentTarget.value, "");
  assert.equal(state.extracting, true);
  resolveExtraction();
  await pendingRequest;
  assert.equal(state.text, "OCR draft");

  const edit = findElement(renderPanel(), element => element.props.id === "study-exercise-extracted-text");
  edit.props.onChange({ target: { value: "Learner-reviewed prompt" } });
  const replace = findElement(renderPanel(), element => element.type === "button" &&
    element.props.children === "Thay đề bằng nội dung đã trích xuất");
  const append = findElement(renderPanel(), element => element.type === "button" &&
    element.props.children === "Nối vào cuối đề");
  replace.props.onClick();
  append.props.onClick();
  assert.deepEqual(applied, ["Learner-reviewed prompt", "Existing prompt\nLearner-reviewed prompt"]);

  let cancelState = { ...emptyTextImport };
  const cancelController = new StudyExerciseTextImportController(next => { cancelState = next; }, (_file, options) => {
    extractionSignal = options.signal;
    return new Promise(() => {});
  });
  const originalStart = cancelController.start.bind(cancelController);
  const cancelPanel = () => components.StudyExerciseTextImportPanel({
    state: cancelState,
    disabled: false,
    onFileSelected: file => {
      void originalStart(file, { plannedSessionId: "session-a", mode: "provided" });
    },
    onCancel: () => cancelController.cancel("Đã hủy trích xuất."),
    onEdit() {},
    onApply() {},
  });
  const cancelInput = findElement(cancelPanel(), element => element.props.id === "study-exercise-file");
  cancelInput.props.onChange({ currentTarget: { files: [{ name: "slow.pdf" }], value: "slow.pdf" } });
  assert.equal(cancelState.extracting, true);
  findElement(cancelPanel(), element => element.type === "button" && element.props.children === "Hủy đọc tệp").props.onClick();
  assert.equal(extractionSignal.aborted, true);
  controller.dispose();
  cancelController.dispose();
});

test("exercise preparation offers local file and image reading without replacing the prompt silently", () => {
  const markup = renderToStaticMarkup(React.createElement(components.StudyExercisePreparation, {
    plannedSessionId: "session-a",
    authenticated: true,
    sources: [source()],
    preparation: null,
    onPrepare: async () => preparation,
    onPreparationChange() {},
    onInvalidate: async () => undefined,
  }));
  assert.match(markup, /type="file"/u);
  assert.match(markup, /\.pdf.*\.png.*\.jpg/iu);
  assert.match(markup, /đọc ngay trên thiết bị|đọc cục bộ/iu);
  assert.match(markup, /thay thế hoặc nối vào đề/u);
  assert.match(markup, /id="study-exercise-provided-text"/u);
  assert.match(markup, /class="study-exercises__mode study-exercises__mode--selected"/u);
  assert.match(markup, /class="study-exercises__confirmation"/u);
  assert.doesNotMatch(markup, /Nội dung nguồn đã được xem lại\.\\nGiữ nguyên dấu và xuống dòng\.<\/textarea>/u);
});

test("generated preparation requires the exact reviewed source and a bounded open-ended count", () => {
  const reviewed = source();
  const base = {
    requestId: "request-a", plannedSessionId: "session-a", mode: "generated", text: reviewed.text,
    count: 3, authenticated: true, confirmed: true, selectedSource: reviewed,
  };
  assert.deepEqual(helpers.createStudyExercisePreparationInput(base), {
    requestId: "request-a", plannedSessionId: "session-a", mode: "generated", text: reviewed.text, count: 3,
  });
  assert.equal(helpers.createStudyExercisePreparationInput({ ...base, selectedSource: source({ reviewed: false }) }), null);
  assert.equal(helpers.createStudyExercisePreparationInput({ ...base, text: "unreviewed replacement text" }), null);
  for (const count of [0, 6, 1.5]) assert.equal(helpers.createStudyExercisePreparationInput({ ...base, count }), null);
  assert.equal(helpers.createStudyExercisePreparationInput({ ...base, text: "😀".repeat(10_001) }), null);
  assert.equal(helpers.createStudyExercisePreparationInput({ ...base, selectedSource: source({ text: "😀".repeat(10_001) }), text: "😀".repeat(10_001) }), null);
});

test("generated source scope becomes stale when selected material props change across rerenders", async () => {
  const selected = source();
  const fingerprint = await helpers.fingerprintStudyExerciseSourceText(selected.text);
  const fingerprintedSnapshot = {
    sourceId: selected.id,
    sourceText: selected.text,
    sourceReviewed: selected.reviewed,
    textFingerprint: fingerprint,
  };
  const scope = { sourceId: selected.id, textFingerprint: fingerprint };
  assert.equal(helpers.isCurrentStudyExerciseSourceScope(scope, fingerprintedSnapshot, selected), true);
  const generatedConfirmation = { mode: "generated", ...scope };
  assert.equal(helpers.isCurrentStudyExerciseConfirmation(
    generatedConfirmation, "generated", "", fingerprintedSnapshot, selected,
  ), true);

  const edited = source({ text: `${selected.text}\nThêm nội dung mới.` });
  const sourcesAfterTextEdit = [edited];
  const selectedAfterTextEdit = sourcesAfterTextEdit.find(item => item.id === selected.id);
  assert.equal(helpers.isCurrentStudyExerciseSourceFingerprint(fingerprintedSnapshot, edited), false);
  assert.equal(helpers.isCurrentStudyExerciseSourceScope(scope, fingerprintedSnapshot, selectedAfterTextEdit), false);
  assert.equal(helpers.isCurrentStudyExerciseConfirmation(
    generatedConfirmation, "generated", "", fingerprintedSnapshot, selectedAfterTextEdit,
  ), false);
  const noLongerReviewed = source({ reviewed: false });
  const sourcesAfterReviewLoss = [noLongerReviewed];
  const selectedAfterReviewLoss = sourcesAfterReviewLoss.find(item => item.id === selected.id);
  assert.equal(helpers.isCurrentStudyExerciseSourceFingerprint(fingerprintedSnapshot, noLongerReviewed), false);
  assert.equal(helpers.isCurrentStudyExerciseSourceScope(scope, fingerprintedSnapshot, selectedAfterReviewLoss), false);
  assert.equal(helpers.isCurrentStudyExerciseConfirmation(
    generatedConfirmation, "generated", "", fingerprintedSnapshot, selectedAfterReviewLoss,
  ), false);

  const unrelatedEdit = source({ id: "source-b", text: "Tài liệu khác đã thay đổi." });
  const sourcesAfterRerender = [selected, unrelatedEdit];
  const selectedAfterRerender = sourcesAfterRerender.find(item => item.id === selected.id);
  assert.equal(helpers.isCurrentStudyExerciseSourceScope(scope, fingerprintedSnapshot, selectedAfterRerender), true);

  const exactProvidedCopy = "  Bài toán đã chép.\\nGiữ nguyên định dạng.  ";
  const providedConfirmation = { mode: "provided", exactText: exactProvidedCopy };
  assert.equal(helpers.isCurrentStudyExerciseConfirmation(
    providedConfirmation, "provided", exactProvidedCopy, fingerprintedSnapshot, selectedAfterTextEdit,
  ), true);
  assert.deepEqual(helpers.createStudyExercisePreparationInput({
    requestId: "request-a", plannedSessionId: "session-a", mode: "provided", text: exactProvidedCopy,
    count: 3, authenticated: true, confirmed: true, selectedSource: edited,
  }), {
    requestId: "request-a", plannedSessionId: "session-a", mode: "provided", text: exactProvidedCopy,
  });
});

test("provided text over 20k keeps its full tail in the editor preview and never posts", async () => {
  const pastedText = `${"x".repeat(20_999)}TAIL_SENTINEL`;
  const markup = renderToStaticMarkup(React.createElement(components.StudyExerciseProblemEditor, {
    value: pastedText,
    disabled: false,
    onChange() {},
  }));
  assert.doesNotMatch(markup, /maxlength=/iu);
  assert.equal(markup.match(/TAIL_SENTINEL/gu)?.length, 2);

  const input = helpers.createStudyExercisePreparationInput({
    requestId: "request-a", plannedSessionId: "session-a", mode: "provided", text: pastedText,
    count: 3, authenticated: true, confirmed: true,
  });
  assert.equal(input, null);
  let posts = 0;
  const onPrepare = async () => { posts += 1; };
  if (helpers.canSubmitStudyExercisePreparation(input)) await onPrepare();
  assert.equal(posts, 0);
});

test("request scope changes reject results from another account, session, source or generation", async () => {
  const fingerprint = await helpers.fingerprintStudyExerciseSourceText(source().text);
  const scope = {
    ownerId: "owner-a", authGeneration: 3, workspaceGeneration: 4, plannedSessionId: "session-a",
    sourceId: "source-a", sourceFingerprint: fingerprint, requestGeneration: 5,
  };
  assert.equal(helpers.isCurrentStudyExerciseScope(scope, { ...scope }), true);
  for (const key of Object.keys(scope))
    assert.equal(helpers.isCurrentStudyExerciseScope(scope, { ...scope, [key]: "changed" }), false, key);
  assert.match(fingerprint, /^[0-9a-f]{64}$/u);
});

test("solution presentation remains hidden during focus and until summary release is ready", () => {
  const markup = (phase, solutionStatus) => renderToStaticMarkup(React.createElement(
    components.StudyExerciseQuestionViewer,
    { preparation, phase, solutionStatus, solutions },
  ));
  const focus = markup("focus", "ready");
  assert.match(focus, /Tính/u);
  assert.doesNotMatch(focus, /ANSWER_SECRET|EXPLANATION_SECRET/u);
  const lockedSummary = markup("summary", "locked");
  assert.match(lockedSummary, /chỉ mở sau khi phiên đã được lưu/u);
  assert.doesNotMatch(lockedSummary, /ANSWER_SECRET|EXPLANATION_SECRET/u);
  const availableSummary = markup("summary", "available");
  assert.match(availableSummary, /Xem lời giải/u);
  assert.doesNotMatch(availableSummary, /ANSWER_SECRET|EXPLANATION_SECRET/u);
  const releasedSummary = markup("summary", "ready");
  assert.match(releasedSummary, /ANSWER_SECRET/u);
  assert.match(releasedSummary, /EXPLANATION_SECRET/u);
  assert.equal(helpers.canRevealStudyExerciseSolutions("focus", "ready"), false);
  assert.equal(helpers.canRevealStudyExerciseSolutions("summary", "ready"), true);
});

test("guest preparation offers sign-in without rendering private source or a preparation form", () => {
  const markup = renderToStaticMarkup(React.createElement(components.StudyExercisePreparation, {
    plannedSessionId: "session-a",
    authenticated: false,
    sources: [source()],
    preparation: null,
    onPrepare: async () => preparation,
    onPreparationChange() {},
    onInvalidate: async () => undefined,
  }));
  assert.match(markup, /Đăng nhập để lưu bài tập riêng tư/u);
  assert.doesNotMatch(markup, /Nội dung nguồn đã được xem lại|study-exercise-provided-text/u);
  assert.match(markup, /Giải bài tập bằng AI/u);
});

test("AI confirmation explains which private text is sent and when answers become available", () => {
  assert.match(components.studyExerciseConfirmationCopy("provided"), /nguyên văn đề bài này cho AI.*sau khi phiên học hoàn tất/u);
  assert.match(components.studyExerciseConfirmationCopy("generated"), /nguồn đã xem lại cho AI.*lời giải chỉ có sau khi phiên học hoàn tất/u);
});

test("API client uses owner-scoped preparation, session lookup, bind, invalidation and solution paths", async () => {
  const previousWindow = globalThis.window;
  const previousStorage = globalThis.sessionStorage;
  const previousFetch = globalThis.fetch;
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
  const calls = [];
  globalThis.window = { location: { href: "http://localhost/" } };
  globalThis.sessionStorage = storage;
  globalThis.fetch = async (url, init) => {
    const path = String(url);
    calls.push({
      path,
      method: init.method ?? "GET",
      body: init.body,
      contentType: new Headers(init.headers).get("content-type"),
      signal: init.signal,
    });
    const body = path.endsWith("/solution") ? solutions
      : path.includes("/requests/") || path.endsWith("/bind") ? { ok: true }
        : preparation;
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    await api.acceptTokens({ access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600 });
    const controller = new AbortController();
    await client.prepareStudyExercises({ requestId: "request-a", plannedSessionId: "session-a", mode: "provided", text: "Exact problem" }, controller.signal);
    await client.getStudyExercisesForSession("session-a", controller.signal);
    await client.bindStudyExercises("session-a", controller.signal);
    await client.invalidateStudyExercises("session-a", "request-a", controller.signal);
    await client.requestStudyExerciseSolutions("request-a", controller.signal);
    assert.deepEqual(calls.map(call => call.method), ["POST", "GET", "POST", "DELETE", "POST"]);
    assert.match(calls[0].path, /\/study-exercises$/u);
    assert.match(calls[1].path, /\/study-exercises\/session\/session-a$/u);
    assert.match(calls[2].path, /\/study-exercises\/session\/session-a\/bind$/u);
    assert.match(calls[3].path, /\/study-exercises\/session\/session-a\/requests\/request-a$/u);
    assert.match(calls[4].path, /\/study-exercises\/request-a\/solution$/u);
    assert.deepEqual(JSON.parse(calls[0].body), {
      requestId: "request-a", plannedSessionId: "session-a", mode: "provided", text: "Exact problem",
    });
    for (const call of calls.slice(2)) {
      assert.equal(call.body, "{}");
      assert.equal(call.contentType, "application/json");
    }
    assert.ok(calls.every(call => call.signal instanceof AbortSignal));
  } finally {
    await api.clearTokens();
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previousStorage;
  }
});

test("study exercise AI requests get the bounded AI timeout while reads and mutations keep the normal limit", () => {
  assert.equal(api.apiRequestTimeoutMs("/study-exercises"), 100_000);
  assert.equal(api.apiRequestTimeoutMs("/study-exercises/request-a/solution"), 100_000);
  assert.equal(api.apiRequestTimeoutMs("/study-exercises/session/session-a"), 30_000);
  assert.equal(api.apiRequestTimeoutMs("/study-exercises/session/session-a/bind"), 30_000);
  assert.equal(api.apiRequestTimeoutMs("/study-exercises/session/session-a/requests/request-a"), 30_000);
  assert.equal(api.apiRequestTimeoutMs("/adventure"), 30_000);
  assert.equal(api.apiRequestTimeoutMs("/quizzes/generate"), 100_000);
  assert.equal(api.apiRequestTimeoutMs("/materials/read"), 115_000);
});
