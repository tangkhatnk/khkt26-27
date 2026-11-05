import assert from "node:assert/strict";
import test, { after, before } from "node:test";
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

function markup(progress) {
  return renderToStaticMarkup(React.createElement(StudyOnboarding, {
    progress,
    topics: [
      { id: "biology", name: "Sinh học" },
      { id: "chemistry", name: "Hóa học" },
    ],
    onProgressChange: () => {},
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

test("tutorial renders the real selected controls, explicit no-material path, and retrieval step without starting focus", () => {
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
  assert.match(retrieval, /Tôi đã biết bước tự kiểm tra/u);
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
