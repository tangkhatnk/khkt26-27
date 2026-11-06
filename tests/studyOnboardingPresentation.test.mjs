import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { createStudyOnboardingProgress, reduceStudyOnboardingProgress } from "../src/adventure/studyOnboardingModel.ts";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let vite;
let StudyOnboarding;
let commitStudyOnboardingAction;

before(async () => {
  vite = await createServer({
    configFile: resolve(projectRoot, "vite.config.ts"),
    configLoader: "runner",
    cacheDir: resolve(projectRoot, "node_modules/.vite-study-onboarding-presentation-tests"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ StudyOnboarding, commitStudyOnboardingAction } = await vite.ssrLoadModule("/src/adventure/StudyOnboarding.tsx"));
});

after(async () => {
  await vite?.close();
});

function tutorialAt(step) {
  let progress = createStudyOnboardingProgress({
    goal: "Ôn phản ứng hóa học",
    topicId: "chemistry",
    topicLabel: "Hóa học",
    preferredMinutes: 45,
  });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  if (step >= 1) progress = reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "goal" });
  if (step >= 2) progress = reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "source", choice: "none" });
  if (step >= 3) progress = reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "duration" });
  return progress;
}

function markup(progress, props = {}) {
  return renderToStaticMarkup(React.createElement(StudyOnboarding, {
    progress,
    currentDraft: progress.survey,
    currentDuration: progress.survey.preferredMinutes ?? 45,
    goalControl: React.createElement("button", { id: "guide-goal-control", type: "button" }, "Goal control"),
    durationControl: React.createElement("button", { id: "guide-duration-control", type: "button" }, "Duration control"),
    retrievalControl: React.createElement("button", { id: "guide-retrieval-control", type: "button" }, "Retrieval control"),
    onProgressChange: () => true,
    onGuideControl: () => true,
    onSourceChoice: () => true,
    ...props,
  }));
}

test("tutorial presents one current task with continue, back, and a direct workspace exit", () => {
  const html = markup(tutorialAt(0));

  assert.match(html, /aria-current="step"/u);
  assert.match(html, /aria-label="Tiếp tục: Đã xem mục tiêu"[^>]*>Đã xem mục tiêu<\/button>/u);
  assert.match(html, />Sửa khảo sát<\/button>/u);
  assert.match(html, />Bỏ qua hướng dẫn, học ngay<\/button>/u);
});

test("each guide step has one focused heading, visible progress, and only its matching live control", () => {
  const expected = [
    ["1. Xem hoặc sửa mục tiêu", "Goal control"],
    ["2. Chọn cách bắt đầu với nội dung", "Ghi nội dung"],
    ["3. Điều chỉnh thời lượng", "Duration control"],
    ["4. Tự kiểm tra sau khi tập trung", "Retrieval control"],
  ];

  for (const [step, [heading, currentControl]] of expected.entries()) {
    const html = markup(tutorialAt(step));
    assert.match(html, new RegExp(`<h1[^>]*>${heading}<\\/h1>`, "u"));
    assert.ok(html.includes(`<li aria-current="step"><span aria-hidden="true">${step + 1}</span>`));
    assert.ok(html.includes(currentControl), `step ${step + 1} should render its current control`);
    assert.match(html, />Bỏ qua hướng dẫn, học ngay<\/button>/u);
    for (const inactiveControl of ["Goal control", "Duration control", "Retrieval control"].filter((label) => label !== currentControl)) {
      assert.ok(!html.includes(inactiveControl), `step ${step + 1} should not render ${inactiveControl}`);
    }
  }
});

test("survey screens keep a direct workspace exit and expose a screen-specific question", () => {
  const first = createStudyOnboardingProgress();
  const second = reduceStudyOnboardingProgress(first, {
    type: "survey/change",
    changes: { goal: "Ôn phản ứng hóa học", topicId: "chemistry", topicLabel: "Hóa học" },
  });
  const secondScreen = reduceStudyOnboardingProgress(second, { type: "survey/next" });

  assert.match(markup(first), /Bắt đầu từ điều bạn muốn đạt được/u);
  assert.match(markup(first), />Bỏ qua khảo sát, học ngay<\/button>/u);
  assert.match(markup(secondScreen), /Chọn thời lượng cho buổi học/u);
  assert.match(markup(secondScreen), />Quay lại<\/button>/u);
  assert.match(markup(secondScreen), />Bỏ qua khảo sát, học ngay<\/button>/u);
});

test("material choice remains explicit and does not add an automatic AI action", () => {
  const html = markup(tutorialAt(1));

  assert.match(html, /aria-label="Chọn cách chuẩn bị nội dung"/u);
  assert.match(html, />Ghi nội dung<\/button>/u);
  assert.match(html, />Chọn tệp sau<\/button>/u);
  assert.match(html, />Hiện chưa có tài liệu<\/button>/u);
  assert.doesNotMatch(html, /Gửi tài liệu|Tạo câu hỏi tự động|Tạo kế hoạch ngay/u);
});

test("the entrance cue cannot intercept controls and becomes static for reduced motion", async () => {
  const css = await readFile(resolve(projectRoot, "src/adventure/studyOnboarding.css"), "utf8");
  const component = await readFile(resolve(projectRoot, "src/adventure/StudyOnboarding.tsx"), "utf8");

  assert.match(markup(tutorialAt(0)), /study-onboarding__control-spotlight/u);
  assert.match(css, /\.study-onboarding__guide-arrow\s*\{[^}]*pointer-events:\s*none/su);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.study-onboarding__guide-arrow\s*\{\s*animation:\s*none/su);
  assert.doesNotMatch(component, /document\.querySelector/u);
  assert.doesNotMatch(component, /data-guide-target/u);
});

test("a rejected progress save keeps the active step and does not prepare the chosen source", () => {
  const progress = tutorialAt(1);
  let sourceChoiceCalls = 0;
  const result = commitStudyOnboardingAction(
    progress,
    { type: "tutorial/used", control: "source", choice: "notes" },
    () => false,
    { afterSave: () => { sourceChoiceCalls += 1; } },
  );

  assert.equal(result.status, "failed");
  assert.equal(result.progress, progress);
  assert.equal(sourceChoiceCalls, 0);
});

test("a rejected control guard keeps the active step and does not write progress", () => {
  const progress = tutorialAt(0);
  let progressWrites = 0;
  const result = commitStudyOnboardingAction(
    progress,
    { type: "tutorial/used", control: "goal" },
    () => { progressWrites += 1; return true; },
    { beforeSave: () => false },
  );

  assert.equal(result.status, "rejected");
  assert.equal(result.progress, progress);
  assert.equal(progressWrites, 0);
});

test("source choice persistence completes before App receives the local source-mode callback", () => {
  const progress = tutorialAt(1);
  const events = [];
  const result = commitStudyOnboardingAction(
    progress,
    { type: "tutorial/used", control: "source", choice: "files" },
    () => { events.push("persist"); return true; },
    { afterSave: () => events.push("source-mode") },
  );

  assert.equal(result.status, "saved");
  assert.equal(result.progress.tutorial.sourceChoice, "files");
  assert.deepEqual(events, ["persist", "source-mode"]);
});

test("missing App control slots fail closed instead of advancing the tutorial", () => {
  const html = markup(tutorialAt(0), { goalControl: null });

  assert.match(html, /Điều khiển này chưa sẵn sàng/u);
  assert.match(html, /class="primary" type="button" aria-label="Tiếp tục: Đã xem mục tiêu" disabled=""/u);
});
