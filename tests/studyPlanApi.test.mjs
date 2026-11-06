import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createStudyOnboardingProgress, reduceStudyOnboardingProgress } from "../src/adventure/studyOnboardingModel.ts";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let vite;
let api;
let serviceApi;

before(async () => {
  vite = await createServer({
    configFile: resolve(projectRoot, "vite.config.ts"),
    configLoader: "runner",
    cacheDir: resolve(projectRoot, "node_modules/.vite-study-plan-api-tests"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  api = await vite.ssrLoadModule("/src/services/studyPlanApi.ts");
  serviceApi = await vite.ssrLoadModule("/src/services/api.ts");
});

after(async () => {
  await vite?.close();
});

test("plan request keeps exact source bytes, hashes them, and sends level only from an explicit AI request", async () => {
  const sourceText = "  Ghi chú đã kiểm tra.\nGiữ nguyên khoảng trắng.  ";
  const request = await api.buildStudyPlanRequest({
    goal: "  Hiểu chức năng màng tế bào  ",
    topic: " Sinh học ",
    level: " Lớp 9 ",
    preferredMinutes: 45,
    includeSource: true,
    source: { text: sourceText, reviewed: true },
  });

  assert.equal(request.goal, "Hiểu chức năng màng tế bào");
  assert.equal(request.topic, "Sinh học");
  assert.equal(request.level, "Lớp 9");
  assert.equal(request.preferredMinutes, 45);
  assert.equal(request.sourceText, sourceText);
  assert.equal(request.sourceFingerprint, "69f7c32b224419c99ea9ac75b4ba4c8384aa374dbad598de1c76d432e0898984");
});

test("goal-only plan request omits source unless the learner opted in and source was reviewed", async () => {
  const input = { goal: "Ôn hô hấp tế bào", topic: "Sinh học", preferredMinutes: 25 };
  const plain = await api.buildStudyPlanRequest(input);
  assert.deepEqual(plain, input);
  const blankOptionalLevel = await api.buildStudyPlanRequest({ ...input, level: "   " });
  assert.equal("level" in blankOptionalLevel, false);

  await assert.rejects(api.buildStudyPlanRequest({
    ...input,
    includeSource: true,
    source: { text: "Nội dung chưa xem lại", reviewed: false },
  }), /đã kiểm tra/u);
});

test("plan request enforces duration, goal, source pair, and body-size bounds before dispatch", async () => {
  await assert.rejects(api.buildStudyPlanRequest({ goal: "ok", preferredMinutes: 25 }), /Mục tiêu/u);
  await assert.rejects(api.buildStudyPlanRequest({ goal: "Ôn tế bào", preferredMinutes: 241 }), /Thời lượng/u);
  await assert.rejects(api.buildStudyPlanRequest({
    goal: "Ôn tế bào",
    preferredMinutes: 25,
    includeSource: true,
    source: { text: "Ngắn", reviewed: true },
  }), /10 đến 50\.000 ký tự/u);
});

test("request selects the correct owner route, preserves AbortSignal, and disables caching", async () => {
  const signal = new AbortController().signal;
  const body = { goal: "Ôn phản ứng hóa học", preferredMinutes: 45 };
  const calls = [];
  const response = {
    title: "Bản nháp",
    steps: ["Mở đầu", "Luyện tập", "Tự kiểm tra"].map((title) => ({
      title,
      action: "Đọc phần ghi chú phù hợp",
      outcome: "Nêu được ý chính",
      check: "Tự giải thích lại",
    })),
  };
  const accountRequest = async (...args) => { calls.push(["account", ...args]); return response; };
  const guestRequest = async (...args) => { calls.push(["guest", ...args]); return response; };

  await api.generateStudyPlan(body, { owner: "account", signal, accountRequest, guestRequest });
  await api.generateStudyPlan(body, { owner: "guest", signal, accountRequest, guestRequest });

  assert.equal(calls[0][0], "account");
  assert.equal(calls[0][1], "/study-plans");
  assert.equal(calls[0][2].signal, signal);
  assert.equal(calls[0][2].cache, "no-store");
  assert.equal(calls[0][3], true);
  assert.equal(calls[1][0], "guest");
  assert.equal(calls[1][1], "/study-plans");
  assert.equal(calls[1][2], body);
  assert.equal(calls[1][3], signal);
});

test("fresh guest request with skipped optional level reaches the guest plan route", async () => {
  const body = await api.buildStudyPlanRequest({
    goal: "Ôn phản ứng hóa học",
    topic: "Hóa học",
    level: "",
    preferredMinutes: 25,
  });
  let request;
  await api.generateStudyPlan(body, {
    owner: "guest",
    guestRequest: async (path, input) => {
      request = { path, input };
      return {
        title: "Ôn phản ứng hóa học",
        steps: ["Nhận biết", "Giải thích", "Tự kiểm tra"].map((title) => ({
          title,
          action: "Đọc ghi chú đã xác nhận",
          outcome: "Nêu được ý chính",
          check: "Tự giải thích lại",
        })),
      };
    },
  });

  assert.equal(request.path, "/study-plans");
  assert.equal("level" in request.input, false);
});

test("an explicit guest plan request remains available while the walkthrough is incomplete", async () => {
  let progress = createStudyOnboardingProgress({ goal: "Ôn phản ứng hóa học" });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  progress = reduceStudyOnboardingProgress(progress, { type: "survey/next" });
  assert.equal(progress.phase, "tutorial");

  const body = await api.buildStudyPlanRequest({
    goal: progress.survey.goal,
    topic: progress.survey.topicLabel,
    preferredMinutes: progress.survey.preferredMinutes,
  });
  let called = false;
  await api.generateStudyPlan(body, {
    owner: "guest",
    guestRequest: async (path) => {
      called = true;
      assert.equal(path, "/study-plans");
      return {
        title: "Ôn phản ứng hóa học",
        steps: ["Nhận biết", "Giải thích", "Tự kiểm tra"].map((title) => ({
          title,
          action: "Đọc lại phần ghi chú phù hợp",
          outcome: "Nêu được ý chính",
          check: "Tự giải thích lại",
        })),
      };
    },
  });

  assert.equal(called, true);
  assert.equal(progress.phase, "tutorial");
});

test("account and GuestAI plan requests share a 100-second deadline for the planner fallback", () => {
  assert.equal(serviceApi.apiRequestTimeoutMs("/study-plans"), 100_000);
  assert.equal(serviceApi.apiRequestTimeoutMs("/ai/guest/study-plans"), 100_000);
  assert.equal(serviceApi.apiRequestTimeoutMs("/materials/read"), 115_000);
});

test("strict response validation bounds steps and keeps excerpts tied to the request source", () => {
  const request = { goal: "Ôn tế bào", preferredMinutes: 25, sourceText: "Nguồn đã kiểm tra về tế bào." };
  const response = {
    title: "Tìm hiểu tế bào",
    steps: ["Nhận biết", "Giải thích", "Tự kiểm tra"].map((title) => ({
      title,
      action: "Đọc lại phần ghi chú tương ứng",
      outcome: "Nêu được chức năng chính",
      check: "Tự trình bày bằng lời của mình",
    })),
  };

  assert.equal(api.isValidStudyPlanResponse(request, response), true);
  assert.equal(api.isValidStudyPlanResponse(request, {
    ...response,
    steps: response.steps.slice(0, 2),
  }), false);
  assert.equal(api.isValidStudyPlanResponse(request, {
    ...response,
    steps: response.steps.map((step, index) => index === 0 ? { ...step, sourceExcerpt: "không có trong nguồn" } : step),
  }), false);
  assert.equal(api.isValidStudyPlanResponse({ goal: "Ôn tế bào", preferredMinutes: 25 }, {
    ...response,
    steps: response.steps.map((step, index) => index === 0 ? { ...step, sourceExcerpt: "trích dẫn" } : step),
  }), false);
});
