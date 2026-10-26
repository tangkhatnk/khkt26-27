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
let ExperimentResults;
let formatExperimentDuration;
let experimentStudySeconds;
let experimentRunHasCorrections;

before(async () => {
  vite = await createServer({
    configFile: resolve(projectRoot, "vite.config.ts"),
    configLoader: "runner",
    cacheDir: resolve(projectRoot, "node_modules/.vite-experiment-results-tests"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ ExperimentRunList, ExperimentResults, formatExperimentDuration, experimentStudySeconds, experimentRunHasCorrections } = await vite.ssrLoadModule("/src/adventure/ExperimentResults.tsx"));
});

after(async () => {
  await vite?.close();
});

const fixture = {
  id: "run-1",
  tripCode: "V-1234567890AB",
  testerCode: "TESTER-PRIVATE-42",
  topic: "biology",
  // This summary is the only goal text exposed by the public history projection.
  goalSummary: "Ôn tập cấu trúc tế bào và chức năng của các bào quan",
  goal: "RAW PRIVATE GOAL MUST NOT RENDER",
  targetSeconds: 90 * 60,
  elapsedSeconds: 100 * 60,
  focusedSeconds: 82 * 60,
  studyElapsedSeconds: 78 * 60,
  distractions: 3,
  breakSeconds: 8 * 60,
  plannedBreakSeconds: 10 * 60,
  plannedBreakCount: 1,
  deviceCategory: "tablet",
  completed: false,
  quizScore: 4,
  quizTotal: 5,
  startedAt: "2026-10-21T03:05:00.000Z",
  endedAt: "2026-10-21T04:45:00.000Z",
};

test("history uses compact semantic columns while retaining every run detail", () => {
  const markup = renderToStaticMarkup(React.createElement(ExperimentRunList, { runs: [fixture] }));

  assert.match(markup, /<caption>Lịch sử các phiên học đã lưu/u);
  for (const heading of ["Mã chuyến", "Khởi hành", "Chủ đề", "Thời gian học và chuyến", "Hiệu suất", "Tóm tắt mục tiêu", "Quiz"]) {
    assert.match(markup, new RegExp(`<th[^>]*>${heading}</th>`, "u"));
  }
  assert.match(markup, /class="experiment-trip-code"[^>]*>V-1234567890AB/u);
  assert.match(markup, /1 giờ 18 phút học/u);
  assert.match(markup, /1 giờ 30 phút mục tiêu/u);
  assert.match(markup, /1 giờ 40 phút tổng chuyến/u);
  assert.match(markup, /1 giờ 22 phút tập trung/u);
  assert.match(markup, /Hiệu suất: 105%/u);
  assert.match(markup, /Mục tiêu: 1 giờ 30 phút · 1 lượt nghỉ/u);
  assert.match(markup, /8 phút giải lao thực tế/u);
  assert.match(markup, /<dt>Giải lao dự kiến<\/dt><dd>10 phút<\/dd>/u);
  assert.match(markup, /4\/5 điểm/u);
  for (const detail of ["TESTER-PRIVATE-42", "iPad/Tablet", "3 lần", "Ôn tập cấu trúc tế bào và chức năng của các bào quan"]) {
    assert.match(markup, new RegExp(detail, "u"));
  }
  assert.doesNotMatch(markup, /RAW PRIVATE GOAL MUST NOT RENDER|80%|Đăng công khai|Đạt mục tiêu|Chưa đạt mục tiêu/u);
  assert.match(markup, /<details class="experiment-details">/u);
  assert.match(markup, /<dt>Bắt đầu \(giờ địa phương của bạn\)<\/dt><dd><time dateTime="2026-10-21T03:05:00\.000Z">[^<]*:\d{2}:\d{2}[^<]*<\/time>/u);
  assert.match(markup, /<dt>Kết thúc \(giờ địa phương của bạn\)<\/dt><dd><time dateTime="2026-10-21T04:45:00\.000Z">[^<]*:\d{2}:\d{2}[^<]*<\/time>/u);
});

test("history explains that saved sessions appear automatically and summarizes goal privacy", () => {
  const markup = renderToStaticMarkup(React.createElement(ExperimentResults));

  assert.match(markup, /Lịch sử chuyến đi/u);
  assert.match(markup, /phiên đã lưu tự động xuất hiện/u);
  assert.match(markup, /tối đa 200 ký tự/u);
  assert.match(markup, /Tránh ghi thông tin riêng tư vào mục tiêu/u);
  assert.match(markup, /không được gửi thành các trường riêng/u);
  assert.doesNotMatch(markup, /chọn công khai|Phiên riêng tư|Mức hoàn thành là tự đánh giá/u);
});

test("history provides a labeled mobile card layout for the same trip", () => {
  const markup = renderToStaticMarkup(React.createElement(ExperimentRunList, { runs: [fixture] }));
  assert.match(markup, /class="experiment-run-cards" aria-label="Lịch sử chuyến đã lưu"/u);
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

test("public history keeps corrected timing provenance without inferring goal achievement", () => {
  const markup = renderToStaticMarkup(React.createElement(ExperimentRunList, {
    runs: [{
      ...fixture,
      breakSeconds: 0,
      correctionFlags: {
        topic: false, targetSeconds: true, elapsedSeconds: true, actualStudySeconds: true,
        focusedSeconds: false, actualBreakSeconds: false, distractions: false, quizResult: false,
      },
    }],
  }));

  assert.match(markup, /0 giây giải lao thực tế/u);
  assert.doesNotMatch(markup, /<dt>Trạng thái mục tiêu|Đạt mục tiêu|Chưa đạt mục tiêu/u);
  assert.match(markup, /Mốc bắt đầu và kết thúc.*dữ kiện đo ban đầu.*thời lượng chuyến đã được hiệu chỉnh/u);
  assert.doesNotMatch(markup, /theo đồng hồ/u);
});

test("history reports no efficiency when study denominator is absent or non-positive", () => {
  const markup = renderToStaticMarkup(React.createElement(ExperimentRunList, {
    runs: [
      { ...fixture, studyElapsedSeconds: 0 },
      { ...fixture, studyElapsedSeconds: undefined },
    ],
  }));
  assert.equal((markup.match(/Chưa có dữ liệu hiệu suất/gu) ?? []).length, 4);
  assert.doesNotMatch(markup, /Hiệu suất: 105%/u);
});

test("history does not guess a planned break count from elapsed or break seconds", () => {
  const markup = renderToStaticMarkup(React.createElement(ExperimentRunList, {
    runs: [{ ...fixture, plannedBreakCount: null, plannedBreakSeconds: 0, breakSeconds: 8 * 60 }],
  }));
  assert.match(markup, /Không ghi nhận lịch nghỉ/u);
  assert.doesNotMatch(markup, /0 lượt nghỉ/u);
});

test("public history shows a concise correction flag without exposing private fields", () => {
  const markup = renderToStaticMarkup(React.createElement(ExperimentRunList, {
    runs: [{
      ...fixture,
      correctionFlags: {
        topic: false, targetSeconds: false, elapsedSeconds: false, actualStudySeconds: false,
        focusedSeconds: false, actualBreakSeconds: false, distractions: false, quizResult: true,
        ownerId: true,
      },
      goal: "Không được công khai mục tiêu riêng",
      ownerId: "private-owner-id",
      materials: ["private-material-name.pdf"],
    }],
  }));

  assert.match(markup, /Đã hiệu chỉnh/u);
  assert.doesNotMatch(markup, /Không được công khai mục tiêu riêng/u);
  assert.doesNotMatch(markup, /private-owner-id/u);
  assert.doesNotMatch(markup, /private-material-name\.pdf/u);
  assert.equal(experimentRunHasCorrections({ ownerId: true }), false);
  assert.equal(experimentRunHasCorrections({ quizResult: true }), true);
});

test("a goal-only correction is marked while the row keeps only its summary", () => {
  const markup = renderToStaticMarkup(React.createElement(ExperimentRunList, {
    runs: [{ ...fixture, goalSummary: "Revised short goal", goal: "RAW CORRECTED GOAL",
      correctionFlags: {
        goal: true, topic: false, targetSeconds: false, elapsedSeconds: false, actualStudySeconds: false,
        focusedSeconds: false, actualBreakSeconds: false, distractions: false, quizResult: false,
      } }],
  }));

  assert.match(markup, /<th[^>]*>Tóm tắt mục tiêu<\/th>/u);
  assert.match(markup, /Revised short goal/u);
  assert.match(markup, /Đã hiệu chỉnh/u);
  assert.doesNotMatch(markup, /RAW CORRECTED GOAL/u);
  assert.equal(experimentRunHasCorrections({ goal: true }), true);
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
