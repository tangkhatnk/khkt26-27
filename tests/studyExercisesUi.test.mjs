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
