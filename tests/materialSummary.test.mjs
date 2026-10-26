import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let vite;
let summaryHelpers;
let MaterialSummaryControl;
let summarizeReviewedMaterial;
let api;

before(async () => {
  vite = await createServer({
    configFile: resolve(projectRoot, "vite.config.ts"),
    configLoader: "runner",
    cacheDir: resolve(projectRoot, "node_modules/.vite-material-summary-tests"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  summaryHelpers = await vite.ssrLoadModule("/src/adventure/materialSummary.ts");
  ({ MaterialSummaryControl } = await vite.ssrLoadModule("/src/adventure/MaterialSummaryControl.tsx"));
  ({ summarizeReviewedMaterial } = await vite.ssrLoadModule("/src/services/materialSummary.ts"));
  api = await vite.ssrLoadModule("/src/services/api.ts");
});

after(async () => {
  await vite?.close();
});

const source = (overrides = {}) => ({
  id: "source-a",
  name: "Chapter.pdf",
  text: "Reviewed source content with enough detail.",
  source: "local-ocr",
  requiresReview: false,
  reviewed: true,
  ...overrides,
});

test("source fingerprint covers the exact text and request identity covers owner, auth, workspace and source", async () => {
  const fingerprint = await summaryHelpers.fingerprintMaterialSourceText(source().text);
  assert.match(fingerprint, /^[0-9a-f]{64}$/u);
  assert.equal(await summaryHelpers.fingerprintMaterialSourceText(source().text), fingerprint);
  assert.notEqual(await summaryHelpers.fingerprintMaterialSourceText(` ${source().text}`), fingerprint);

  const request = {
    ownerId: "owner-a",
    workspaceGeneration: 4,
    authGeneration: 8,
    sessionId: "session-a",
    sourceId: "source-a",
    sourceFingerprint: fingerprint,
    requestGeneration: 12,
  };
  assert.equal(summaryHelpers.isCurrentMaterialSummaryScope(request, { ...request }), true);
  for (const key of Object.keys(request))
    assert.equal(summaryHelpers.isCurrentMaterialSummaryScope(request, { ...request, [key]: "changed" }), false, key);
});

test("cached material summary is visible only for the same confirmed source fingerprint", () => {
  const fingerprint = "a".repeat(64);
  const saved = {
    materialSummaries: {
      "session-a": {
        "source-a": { sourceFingerprint: fingerprint, summary: "AI summary", generatedAt: 10 },
      },
    },
  };

  assert.equal(summaryHelpers.cachedMaterialSummary(saved, "session-a", source(), fingerprint), "AI summary");
  assert.equal(summaryHelpers.cachedMaterialSummary(saved, "session-a", source({ reviewed: false }), fingerprint), undefined);
  assert.equal(summaryHelpers.cachedMaterialSummary(saved, "session-a", source(), "b".repeat(64)), undefined);
  assert.equal(summaryHelpers.cachedMaterialSummary(saved, "other-session", source(), fingerprint), undefined);
});

test("private summary control sends clear notice and labels generated text as AI-created", () => {
  const markup = renderToStaticMarkup(React.createElement(MaterialSummaryControl, {
    source: source(), summary: "Key ideas from the reviewed text.", onGenerate() {},
  }));
  assert.match(markup, /Tóm tắt tài liệu/u);
  assert.match(markup, /nội dung đã kiểm tra.*gửi đến Gemini/u);
  assert.match(markup, /Tóm tắt do AI tạo/u);
  assert.match(markup, /Key ideas from the reviewed text\./u);
});

test("unreviewed or legacy sources cannot request or display an AI summary", () => {
  const markup = renderToStaticMarkup(React.createElement(MaterialSummaryControl, {
    source: source({ reviewed: false, requiresReview: true }),
    summary: "STALE SUMMARY MUST STAY HIDDEN",
    onGenerate() {},
  }));
  assert.doesNotMatch(markup, /<button/u);
  assert.doesNotMatch(markup, /STALE SUMMARY MUST STAY HIDDEN/u);
  assert.match(markup, /Xác nhận nội dung nguồn trước/u);
});

test("summary button is unavailable when authenticated AI access is unavailable", () => {
  const markup = renderToStaticMarkup(React.createElement(MaterialSummaryControl, {
    source: source(), canGenerate: false, disabledReason: "Đăng nhập để tạo tóm tắt.", onGenerate() {},
  }));
  assert.match(markup, /<button[^>]*disabled=""/u);
  assert.match(markup, /Đăng nhập để tạo tóm tắt/u);
});

test("authenticated summary client sends only selected source text and accepts the summary response", async () => {
  const previousWindow = globalThis.window;
  const previousStorage = globalThis.sessionStorage;
  const previousFetch = globalThis.fetch;
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
  globalThis.window = {};
  globalThis.sessionStorage = storage;
  let requested;
  globalThis.fetch = async (url, init) => {
    requested = { url: String(url), init };
    return new Response(JSON.stringify({ summary: "Source summary" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const generationBeforeLogin = api.getAuthGeneration();
    await api.acceptTokens({ access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600 });
    assert.notEqual(api.getAuthGeneration(), generationBeforeLogin);
    const controller = new AbortController();
    const result = await summarizeReviewedMaterial(source().text, controller.signal);

    assert.deepEqual(result, { summary: "Source summary" });
    assert.match(requested.url, /\/materials\/summarize$/u);
    assert.deepEqual(JSON.parse(requested.init.body), { text: source().text });
    assert.match(new Headers(requested.init.headers).get("Authorization"), /^Bearer synthetic-access$/u);
  } finally {
    const generationBeforeLogout = api.getAuthGeneration();
    await api.clearTokens();
    assert.notEqual(api.getAuthGeneration(), generationBeforeLogout);
    globalThis.window = previousWindow;
    globalThis.sessionStorage = previousStorage;
    globalThis.fetch = previousFetch;
  }
});
