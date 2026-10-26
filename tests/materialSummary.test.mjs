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
let publicSummary;
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
  publicSummary = await vite.ssrLoadModule("/src/services/publicMaterialSummary.ts");
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

test("public summary candidates require a reviewed source with a matching current fingerprint", () => {
  const fingerprint = "a".repeat(64);
  const candidates = [
    { sourceId: "source-a", sourceName: "Chapter.pdf", summary: " Exact text. ", reviewed: true,
      sourceFingerprint: fingerprint, currentSourceFingerprint: fingerprint },
    { sourceId: "source-b", sourceName: "Unreviewed.pdf", summary: "Must stay private", reviewed: false,
      sourceFingerprint: fingerprint, currentSourceFingerprint: fingerprint },
    { sourceId: "source-c", sourceName: "Edited.pdf", summary: "Stale summary", reviewed: true,
      sourceFingerprint: fingerprint, currentSourceFingerprint: "b".repeat(64) },
  ];
  const eligible = publicSummary.eligiblePublicMaterialSummaryCandidates(candidates);
  assert.deepEqual(eligible, [candidates[0]]);
  assert.equal(publicSummary.composePublicMaterialSummary(eligible), " Exact text. ");
  assert.equal(publicSummary.publicMaterialSummaryLength("😀".repeat(250)), 500);
  assert.equal(publicSummary.publicMaterialSummaryLength("😀".repeat(251)), 502);
});

test("public summary writes require an exact preview, current candidates, and the current scope", () => {
  const status = { summary: null, version: 0, approvedAt: null };
  const base = { sessionId: "session-a", status, mode: "publish", previewMode: "publish", previewVersion: 0,
    previewSummary: null, previewApprovedAt: null, canManage: true,
    scopeCurrent: true, selectedCandidatesCurrent: true, selectedSourceCount: 1 };
  assert.equal(publicSummary.publicSummaryWriteIntent({ ...base, previewText: null }), null);
  assert.equal(publicSummary.publicSummaryWriteIntent({ ...base, previewText: "Approved", scopeCurrent: false }), null);
  assert.equal(publicSummary.publicSummaryWriteIntent({ ...base, previewText: "Approved", selectedCandidatesCurrent: false }), null);
  assert.equal(publicSummary.publicSummaryWriteIntent({ ...base, previewText: "Approved", selectedSourceCount: 0 }), null);
  assert.equal(publicSummary.publicSummaryWriteIntent({ ...base, previewText: "😀".repeat(251) }), null);
  assert.equal(publicSummary.publicSummaryWriteIntent({ ...base, previewText: "\u0000" }), null);
  // A refreshed withdrawn status has a later version. The earlier preview must not authorize it.
  assert.equal(publicSummary.publicSummaryWriteIntent({ ...base, previewText: "Approved", status: { summary: null, version: 2, approvedAt: null } }), null);
  // A preview created for a different action or publication snapshot is stale even if the text matches.
  assert.equal(publicSummary.publicSummaryWriteIntent({ ...base, previewText: "Approved", mode: "replace",
    status: { summary: "Current copy", version: 0, approvedAt: "approved" } }), null);
  assert.equal(publicSummary.publicSummaryWriteIntent({ ...base, previewText: "Approved",
    status: { summary: "New publication", version: 0, approvedAt: "approved" } }), null);
  assert.equal(publicSummary.publicSummaryWriteIntent({ ...base, previewText: "Approved",
    status: { summary: null, version: 0, approvedAt: "new approval" } }), null);
  const exact = "  Approved line.\nSecond line.  ";
  assert.deepEqual(publicSummary.publicSummaryWriteIntent({ ...base, previewText: exact }), {
    sessionId: "session-a", summary: exact, expectedVersion: 0, mode: "publish",
  });
  assert.equal(publicSummary.publicSummaryWriteIntent({
    ...base, mode: "replace", previewText: "Replacement", status: { summary: null, version: 3, approvedAt: null },
  }), null);
  assert.deepEqual(publicSummary.publicSummaryWriteIntent({
    ...base, mode: "replace", previewText: exact, previewMode: "replace", previewVersion: 4,
    previewSummary: "Current copy", previewApprovedAt: "approved",
    status: { summary: "Current copy", version: 4, approvedAt: "approved" },
  }), { sessionId: "session-a", summary: exact, expectedVersion: 4, mode: "replace" });
});

test("public summary previews require a mode compatible with the current publication", () => {
  const active = { summary: "Current copy", version: 2, approvedAt: "approved-v2" };
  const withdrawn = { summary: null, version: 3, approvedAt: null };
  const publishPreview = {
    mode: "publish", expectedVersion: 2, statusSummary: "Current copy", statusApprovedAt: "approved-v2",
  };
  const replacePreview = {
    mode: "replace", expectedVersion: 3, statusSummary: null, statusApprovedAt: null,
  };

  assert.equal(publicSummary.publicSummaryPreviewMatches(publishPreview, active, "publish"), false);
  assert.equal(publicSummary.publicSummaryPreviewMatches(replacePreview, withdrawn, "replace"), false);
  assert.equal(publicSummary.publicSummaryModeMatchesStatus("publish", active), false);
  assert.equal(publicSummary.publicSummaryModeMatchesStatus("replace", withdrawn), false);
  assert.equal(publicSummary.publicSummaryModeMatchesStatus("publish", withdrawn), true);
  assert.equal(publicSummary.publicSummaryModeMatchesStatus("replace", active), true);
});

test("withdraw confirmation is bound to the exact approved status and scope", () => {
  const confirmation = { version: 1, summary: "Copy v1", approvedAt: "approved-v1", scopeKey: "owner/session/view" };
  const confirmedStatus = { summary: "Copy v1", version: 1, approvedAt: "approved-v1" };
  assert.deepEqual(publicSummary.publicSummaryWithdrawalIntent({
    confirmation, status: confirmedStatus, scopeKey: "owner/session/view", scopeCurrent: true, canManage: true,
  }), { expectedVersion: 1 });
  assert.equal(publicSummary.publicSummaryWithdrawalIntent({
    confirmation, status: { summary: "Copy v2", version: 2, approvedAt: "approved-v2" },
    scopeKey: "owner/session/view", scopeCurrent: true, canManage: true,
  }), null);
  assert.equal(publicSummary.publicSummaryWithdrawalIntent({
    confirmation, status: confirmedStatus, scopeKey: "another-owner/session/view", scopeCurrent: true, canManage: true,
  }), null);
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

test("public sharing client uses separate explicit publish, replace, and versioned withdraw requests", async () => {
  const previousWindow = globalThis.window;
  const previousStorage = globalThis.sessionStorage;
  const previousFetch = globalThis.fetch;
  const values = new Map();
  globalThis.window = {};
  globalThis.sessionStorage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : undefined,
      authorization: new Headers(init.headers).get("Authorization") });
    return new Response(JSON.stringify({ summary: "Shared copy", version: calls.length, approvedAt: "2026-10-26T00:00:00.000Z" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await api.acceptTokens({ access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600 });
    const exact = "  Approved line.\nSecond line.  ";
    await publicSummary.readPublicMaterialSummary("session/one");
    await publicSummary.publishPublicMaterialSummary("session/one", exact, 0);
    await publicSummary.replacePublicMaterialSummary("session/one", exact, 1);
    await publicSummary.withdrawPublicMaterialSummary("session/one", 2);

    assert.equal(new URL(calls[0].url).searchParams.get("sessionId"), "session/one");
    assert.deepEqual(calls.map(({ method }) => method), ["GET", "POST", "PUT", "POST"]);
    assert.deepEqual(calls.slice(1).map(({ body }) => body), [
      { sessionId: "session/one", summary: exact, expectedVersion: 0, confirmShare: true },
      { sessionId: "session/one", summary: exact, expectedVersion: 1, confirmReplacement: true },
      { sessionId: "session/one", expectedVersion: 2 },
    ]);
    for (const { body } of calls.slice(1))
      assert.equal(Object.keys(body).some((key) => /source|filename|owner|document/u.test(key)), false);
    assert.ok(calls.every(({ authorization }) => authorization === "Bearer synthetic-access"));
  } finally {
    await api.clearTokens();
    globalThis.window = previousWindow;
    globalThis.sessionStorage = previousStorage;
    globalThis.fetch = previousFetch;
  }
});
