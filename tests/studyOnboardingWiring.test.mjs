import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createStudyOnboardingProgress, reduceStudyOnboardingProgress } from "../src/adventure/studyOnboardingModel.ts";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let vite;
let StudyOnboarding;

before(async () => {
  vite = await createServer({
    configFile: resolve(projectRoot, "vite.config.ts"),
    configLoader: "runner",
    cacheDir: resolve(projectRoot, "node_modules/.vite-study-onboarding-tests"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ StudyOnboarding } = await vite.ssrLoadModule("/src/adventure/StudyOnboarding.tsx"));
});

after(async () => {
  await vite?.close();
});

function markup(progress, props = {}) {
  return renderToStaticMarkup(React.createElement(StudyOnboarding, {
    progress,
    topics: [
      { id: "biology", name: "Sinh học" },
      { id: "chemistry", name: "Hóa học" },
    ],
    onProgressChange: () => {},
    ...props,
  }));
}

test("first-use survey exposes required goal/topic, 1–240 duration, and optional local questions", () => {
  let progress = createStudyOnboardingProgress({
    goal: "Ôn phản ứng hóa học",
    topicId: "chemistry",
    topicLabel: "Hóa học",
  });
  const goalAndTopic = markup(progress);

  assert.match(goalAndTopic, /Bắt đầu từ điều bạn muốn đạt được/u);
  assert.match(goalAndTopic, /for="onboarding-goal"/u);
  assert.match(goalAndTopic, /for="onboarding-topic"/u);
  assert.match(goalAndTopic, /option value="chemistry" selected="">Hóa học/u);

  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  const durationAndOptional = markup(progress);
  assert.match(durationAndOptional, /for="onboarding-level"/u);
  assert.match(durationAndOptional, /for="onboarding-confidence"/u);
  assert.match(durationAndOptional, /1 đến 240 phút/u);
  assert.doesNotMatch(durationAndOptional, /Tạo bản ôn tập bằng AI|Tạo câu hỏi bằng AI|Bắt đầu phiên/u);
  assert.doesNotMatch(durationAndOptional, /type="file"/u);
});

test("tutorial renders real controls and explicit choices without triggering focus or AI", () => {
  let progress = createStudyOnboardingProgress({
    goal: "Ôn phản ứng hóa học",
    topicId: "chemistry",
    topicLabel: "Hóa học",
  });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  progress = reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "goal" });
  assert.match(markup(progress), /Hiện chưa có tài liệu/u);
  assert.match(markup(progress), /aria-pressed="false"/u);

  progress = reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "source", choice: "none" });
  assert.match(markup(progress), /Điều chỉnh thời lượng/u);
  progress = reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "duration" });
  const retrieval = markup(progress);
  assert.match(retrieval, /Tự kiểm tra sau khi tập trung/u);
  assert.match(retrieval, /Hướng dẫn không tự gửi yêu cầu/u);
  assert.match(retrieval, /thao tác AI chỉ chạy khi bạn chủ động chọn/u);
  assert.doesNotMatch(retrieval, /Tôi đã biết bước tự kiểm tra/u);
  assert.doesNotMatch(retrieval, /Bắt đầu phiên|Tạo bản ôn tập bằng AI/u);
  progress = reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "retrieval" });
  assert.equal(progress.phase, "complete");
  progress = reduceStudyOnboardingProgress(progress, { type: "onboarding/reopen" });
  assert.equal(progress.phase, "tutorial");
  assert.equal(progress.tutorialStep, 0);
  assert.equal(progress.survey.goal, "Ôn phản ứng hóa học");
});

test("paused tutorial can be reopened to the preserved step, while completion exposes a re-openable tutorial state", () => {
  let progress = createStudyOnboardingProgress({ goal: "Ôn phản ứng hóa học" });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  progress = reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "goal" });
  progress = reduceStudyOnboardingProgress(progress, { type: "onboarding/pause" });
  assert.match(markup(progress), /Tiếp tục hướng dẫn/u);
  progress = reduceStudyOnboardingProgress(progress, { type: "onboarding/resume" });
  assert.equal(progress.tutorialStep, 1);
  assert.equal(progress.survey.goal, "Ôn phản ứng hóa học");
});

test("survey and every tutorial step have a direct exit to the editable workspace", () => {
  const survey = markup(createStudyOnboardingProgress());
  assert.match(survey, /Bỏ qua khảo sát, học ngay/u);

  let progress = createStudyOnboardingProgress({ goal: "Ôn phản ứng hóa học", preferredMinutes: 45 });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  for (const tutorialStep of [0, 1, 2, 3]) {
    const tutorial = { ...progress, tutorialStep };
    assert.match(markup(tutorial, { currentDraft: tutorial.survey, currentDuration: 45 }), /Bỏ qua hướng dẫn, học ngay/u);
  }
});

test("the guide itself never starts an AI request and copy permits explicit AI actions", async () => {
  const component = await readFile(resolve(projectRoot, "src/adventure/StudyOnboarding.tsx"), "utf8");
  let progress = createStudyOnboardingProgress({ goal: "Ôn phản ứng hóa học" });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });

  assert.equal(progress.phase, "tutorial");
  const tutorial = markup(progress, { currentDraft: progress.survey, currentDuration: 25 });
  assert.match(tutorial, /Hướng dẫn không tự gửi yêu cầu AI/u);
  assert.match(tutorial, /Bạn vẫn có thể chủ động dùng tính năng AI/u);
  assert.doesNotMatch(component, /postGuestAi|generateStudyPlan|await request\(/u);
});

test("reopened tutorial uses the live valid draft goal when its legacy survey goal is empty", () => {
  const progress = createStudyOnboardingProgress();
  progress.phase = "tutorial";
  progress.tutorialStep = 0;
  const view = markup(progress, {
    currentDraft: { ...progress.survey, goal: "Ôn cấu trúc tế bào" },
    currentDuration: 25,
  });

  assert.match(view, /Đã xem mục tiêu/u);
  assert.doesNotMatch(view, /class="primary" type="button" disabled=""[^>]*>Đã xem mục tiêu/u);
  assert.match(view, /Mục tiêu: Ôn cấu trúc tế bào/u);
});

test("survey and tutorial show a clear progress hierarchy and each guide step has a keyboard return target", () => {
  assert.match(markup(createStudyOnboardingProgress()), /study-onboarding__validation-hint[^>]*role="status"/u);
  let progress = createStudyOnboardingProgress({
    goal: "Ôn phản ứng hóa học",
    topicId: "chemistry",
    topicLabel: "Hóa học",
  });
  const survey = markup(progress);
  assert.match(survey, /aria-label="Tiến trình khảo sát"/u);
  assert.match(survey, /aria-current="step"><span aria-hidden="true">1<\/span><span>Mục tiêu<\/span>/u);

  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  const duration = markup(progress);
  assert.match(duration, /aria-label="Tiến trình khảo sát"/u);
  assert.match(duration, /aria-current="step"><span aria-hidden="true">2<\/span><span>Thời lượng<\/span>/u);

  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  const goalStep = markup(progress, { currentDraft: progress.survey, currentDuration: 25 });
  assert.match(goalStep, /aria-label="Tiến trình hướng dẫn"/u);
  assert.match(goalStep, /id="study-onboarding-step-heading" tabindex="-1">1\. Xem hoặc sửa mục tiêu/u);

  progress = reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "goal" });
  progress = reduceStudyOnboardingProgress(progress, { type: "tutorial/used", control: "source", choice: "notes" });
  const durationStep = markup(progress, { currentDraft: progress.survey, currentDuration: 25 });
  assert.match(durationStep, /aria-current="step"><span aria-hidden="true">3<\/span><span>Thời lượng<\/span>/u);
  assert.match(durationStep, /id="study-onboarding-step-heading" tabindex="-1">3\. Điều chỉnh thời lượng/u);
  assert.match(durationStep, /Đi tới thời lượng/u);
});
