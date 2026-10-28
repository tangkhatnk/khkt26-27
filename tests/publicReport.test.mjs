import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let vite;
let api;
let component;

before(async () => {
  vite = await createServer({
    configFile: resolve(projectRoot, "vite.config.ts"),
    configLoader: "runner",
    cacheDir: resolve(projectRoot, "node_modules/.vite-public-report-tests"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  api = await vite.ssrLoadModule("/src/services/publicReportApi.ts");
  component = await vite.ssrLoadModule("/src/adventure/PublicReport.tsx");
});

after(async () => vite?.close());

const dailyMetrics = {
  plannedStudySeconds: 60, actualStudySeconds: 60, focusedSeconds: 45,
  plannedBreakSeconds: 0, actualBreakSeconds: 0, distractions: 1, completedSessions: 1,
  completionPercent: 100, gradedQuizSessions: 1, quizCoveragePercent: 100,
  quizScore: 2, quizTotal: 3, quizScorePercent: 66.7,
};
const report = {
  days: 7,
  analysisLimit: 5000,
  matchingSessionCount: 2,
  recordsAnalyzed: 2,
  truncated: false,
  totals: {
    sessionCount: 2, plannedStudySeconds: 120, actualStudySeconds: 120, focusedSeconds: 75,
    plannedBreakSeconds: 0, actualBreakSeconds: 0, distractions: 1, completedSessions: 2,
    completionPercent: 100, gradedQuizSessions: 1, quizCoveragePercent: 50,
    quizScore: 2, quizTotal: 3, quizScorePercent: 66.7,
  },
  daily: [
    { dateUtc: "2026-10-27", sessionCount: 1, ...dailyMetrics },
    { dateUtc: "2026-10-28", sessionCount: 1, ...dailyMetrics },
  ],
  topics: [{
    topic: "Khác", sessionCount: 1, plannedStudySeconds: 60, actualStudySeconds: 60,
    focusedSeconds: 30, plannedBreakSeconds: 0, actualBreakSeconds: 0, distractions: 0,
    completedSessions: 1, completionPercent: 100, gradedQuizSessions: 0,
    quizCoveragePercent: 0, quizScore: 0, quizTotal: 0, quizScorePercent: null,
  }],
};

test("public report fetch uses an anonymous no-store request for the selected period", async () => {
  const originalFetch = globalThis.fetch;
  let call;
  const monthReport = { ...report, days: 30 };
  globalThis.fetch = async (url, init) => {
    call = { url: String(url), init };
    return Response.json(monthReport);
  };
  try {
    assert.deepEqual(await api.getPublicReport(30), monthReport);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.match(call.url, /\/public\/report\?days=30$/u);
  assert.equal(call.init.cache, "no-store");
  assert.equal(new Headers(call.init.headers).has("Authorization"), false);
});

test("report view names its aggregate scope and provides the matching CSV", () => {
  const html = renderToStaticMarkup(React.createElement(component.PublicReportContent, {
    report,
    days: 7,
    loading: false,
    error: null,
    onRetry() {},
    onDaysChange() {},
  }));

  assert.match(html, /<h1[^>]*>Báo cáo tổng hợp<\/h1>/u);
  assert.match(html, /Số chuyến học/u);
  assert.match(html, /Thời gian tập trung/u);
  assert.match(html, /Xu hướng hàng ngày/u);
  assert.match(html, /Thời gian tập trung/u);
  assert.match(html, /2026-10-27/u);
  assert.match(html, /<select[^>]*id="public-report-period"/u);
  assert.match(html, /7 ngày/u);
  assert.match(html, /Khác/u);
  assert.match(html, /href="http:\/\/localhost:3000\/api\/v1\/public\/report\/export\.csv\?days=7"[^>]*download/u);
  assert.match(html, /không chứa thông tin tài khoản/u);
  assert.doesNotMatch(html, /PRIVATE|learner@example\.test|exam answer key|classmate name/u);

  const monthHtml = renderToStaticMarkup(React.createElement(component.PublicReportContent, {
    report: { ...report, days: 30 },
    days: 30,
    loading: false,
    error: null,
    onRetry() {},
    onDaysChange() {},
  }));
  assert.match(monthHtml, /href="http:\/\/localhost:3000\/api\/v1\/public\/report\/export\.csv\?days=30"/u);
  assert.match(monthHtml, /30 NGÀY GẦN NHẤT/u);
});

test("report view provides clear loading and retryable error states", () => {
  const loading = renderToStaticMarkup(React.createElement(component.PublicReportContent, {
    report: null,
    days: 7,
    loading: true,
    error: null,
    onRetry() {},
    onDaysChange() {},
  }));
  const error = renderToStaticMarkup(React.createElement(component.PublicReportContent, {
    report: null,
    days: 7,
    loading: false,
    error: "Không tải được báo cáo. Hãy thử lại sau.",
    onRetry() {},
    onDaysChange() {},
  }));
  assert.match(loading, /Đang tải báo cáo/u);
  assert.match(error, /Không tải được báo cáo\. Hãy thử lại sau\./u);
  assert.match(error, /<button[^>]*>Thử lại<\/button>/u);
});

test("a stale report response cannot replace data from the current period", () => {
  const oldRequest = new AbortController();
  oldRequest.abort();
  let current = report;
  const olderPeriod = { ...report, days: 7, totals: { ...report.totals, sessionCount: 70 } };

  component.setPublicReportIfCurrent(oldRequest.signal, olderPeriod, (value) => { current = value; });
  assert.equal(current, report);

  const activeRequest = new AbortController();
  component.setPublicReportIfCurrent(activeRequest.signal, { ...report, days: 30 }, (value) => { current = value; });
  assert.equal(current.days, 30);
});

test("a truncated public report explains the sample limit without exposing source rows", () => {
  const html = renderToStaticMarkup(React.createElement(component.PublicReportContent, {
    report: { ...report, matchingSessionCount: 6200, recordsAnalyzed: 5000, truncated: true },
    days: 7,
    loading: false,
    error: null,
    onRetry() {},
    onDaysChange() {},
  }));

  assert.match(html, /Đã phân tích 5\.000 trên 6\.200 phiên khớp trong 7 ngày gần nhất/u);
  assert.match(html, /Giới hạn tối đa 5\.000 phiên/u);
  assert.match(html, /các tổng, biểu đồ, bảng và CSV chỉ tính phần đã phân tích/u);
  assert.doesNotMatch(html, /PRIVATE|learner@example\.test|exam answer key|classmate name/u);
});
