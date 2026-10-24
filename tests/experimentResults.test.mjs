import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let vite;
let ExperimentRunList;
let formatExperimentDuration;
let experimentStudySeconds;

before(async () => {
  vite = await createServer({
    configFile: resolve(projectRoot, "vite.config.ts"),
    cacheDir: resolve(projectRoot, "node_modules/.vite-experiment-results-tests"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ ExperimentRunList, formatExperimentDuration, experimentStudySeconds } = await vite.ssrLoadModule("/src/adventure/ExperimentResults.tsx"));
});

after(async () => {
  await vite?.close();
});

const fixture = {
  id: "run-1",
  tripCode: "V-1234567890AB",
  testerCode: "TESTER-PRIVATE-42",
  topic: "biology",
  // Deliberately present as an untrusted/legacy field: public history must ignore it.
  goalSummary: "Ôn tập cấu trúc tế bào và chức năng của các bào quan",
  targetSeconds: 90 * 60,
  elapsedSeconds: 100 * 60,
  focusedSeconds: 82 * 60,
  studyElapsedSeconds: 78 * 60,
  distractions: 3,
  breakSeconds: 8 * 60,
  plannedBreakSeconds: 10 * 60,
  deviceCategory: "tablet",
  completionPercent: 80,
  completed: false,
  quizScore: 4,
  quizTotal: 5,
  startedAt: "2026-10-21T03:05:00.000Z",
  endedAt: "2026-10-21T04:45:00.000Z",
  publishedAt: "2026-10-21T04:45:01.000Z",
};

test("history uses compact semantic columns while retaining every run detail", () => {
  const markup = renderToStaticMarkup(React.createElement(ExperimentRunList, { runs: [fixture] }));

  assert.match(markup, /<caption>Các phiên người học đã chọn công khai/u);
  for (const heading of ["Mã chuyến", "Khởi hành", "Chủ đề", "Thời gian học và chuyến", "Tập trung và nghỉ", "Đồng hồ và tự đánh giá", "Quiz"]) {
    assert.match(markup, new RegExp(`<th[^>]*>${heading}</th>`, "u"));
  }
  assert.match(markup, /class="experiment-trip-code"[^>]*>V-1234567890AB/u);
  assert.match(markup, /1 giờ 18 phút học/u);
  assert.match(markup, /1 giờ 30 phút mục tiêu/u);
  assert.match(markup, /1 giờ 40 phút tổng chuyến/u);
  assert.match(markup, /1 giờ 22 phút tập trung/u);
  assert.match(markup, /8 phút giải lao thực tế/u);
  assert.match(markup, /10 phút giải lao dự kiến/u);
  assert.match(markup, /4\/5 điểm/u);
  for (const detail of ["TESTER-PRIVATE-42", "iPad/Tablet", "3 lần", "Kết thúc sớm", "80% · tự đánh giá"]) {
    assert.match(markup, new RegExp(detail, "u"));
  }
  assert.doesNotMatch(markup, /Ôn tập cấu trúc tế bào và chức năng của các bào quan/u);
  assert.match(markup, /<details class="experiment-details">/u);
  assert.match(markup, /<dt>Bắt đầu \(giờ địa phương của bạn\)<\/dt><dd><time dateTime="2026-10-21T03:05:00\.000Z">[^<]*:\d{2}:\d{2}[^<]*<\/time>/u);
  assert.match(markup, /<dt>Kết thúc \(giờ địa phương của bạn\)<\/dt><dd><time dateTime="2026-10-21T04:45:00\.000Z">[^<]*:\d{2}:\d{2}[^<]*<\/time>/u);
});

test("history provides a labeled mobile card layout for the same trip", () => {
  const markup = renderToStaticMarkup(React.createElement(ExperimentRunList, { runs: [fixture] }));
  assert.match(markup, /class="experiment-run-cards" aria-label="Các phiên đã công khai"/u);
  assert.match(markup, /class="experiment-run-card"/u);
  assert.match(markup, /class="experiment-run-card__metrics"/u);
  assert.match(markup, /<h3[^>]*>Sinh học/u);
  assert.match(markup, /class="experiment-quiz-badge experiment-quiz-badge--scored"/u);
});

test("history handles a missing quiz and missing optional timing values accessibly", () => {
  const markup = renderToStaticMarkup(React.createElement(ExperimentRunList, {
    runs: [{ ...fixture, quizScore: null, quizTotal: null, breakSeconds: undefined, plannedBreakSeconds: undefined, studyElapsedSeconds: undefined }],
  }));
  assert.match(markup, /class="experiment-quiz-badge experiment-quiz-badge--pending"[^>]*>Chưa làm/u);
  assert.match(markup, /Chưa có thời gian giải lao/u);
  assert.match(markup, /1 giờ 40 phút học/u);
  assert.match(markup, /1 giờ 30 phút mục tiêu/u);
});

test("duration values stay human-readable and legacy study time excludes known rests", () => {
  assert.equal(formatExperimentDuration(0), "0 giây");
  assert.equal(formatExperimentDuration(65), "1 phút 5 giây");
  assert.equal(formatExperimentDuration(3900), "1 giờ 5 phút");
  assert.equal(formatExperimentDuration(193), "3 phút 13 giây");
  assert.equal(formatExperimentDuration(3605), "1 giờ 5 giây");
  assert.equal(formatExperimentDuration(3665), "1 giờ 1 phút 5 giây");
  assert.equal(formatExperimentDuration(-30), "0 giây");
  assert.equal(formatExperimentDuration(Number.NaN), "0 giây");
  assert.equal(experimentStudySeconds({ ...fixture, studyElapsedSeconds: undefined }), 92 * 60);
});
