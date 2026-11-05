import assert from "node:assert/strict";
import test from "node:test";
import { readSaved, writeSaved } from "../src/adventure/storage.ts";
import { createLearningPathProgress } from "../src/adventure/learningPath.ts";
import { createStudyPlanStorage, normalizeStudyPlanStorage } from "../src/adventure/studyPlanStorage.ts";

function withLocalStorage(callback) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
    },
  });
  try {
    callback();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
}

function legacySaved(overrides = {}) {
  return {
    active: null,
    pending: [],
    snapshot: null,
    local: {
      people: {},
      groups: {},
      sessions: {
        "session-old": {
          id: "session-old",
          userId: "guest",
          groupId: null,
          goal: "Ôn cấu trúc tế bào",
          topic: "biology",
          started: 1_000,
          ended: 61_000,
          target: 60,
          segments: [{ start: 1_000, end: 61_000, kind: "focus" }],
          seconds: 60,
          contribution: 0,
          rules: "train-v1",
          quiz: { score: 1, total: 1 },
        },
      },
      invites: {},
    },
    notes: { "session-old": "Ghi chú riêng đã lưu" },
    sources: {
      "session-old": [{
        id: "source-old",
        name: "Ghi chú tế bào",
        text: "Màng tế bào điều hòa trao đổi chất.",
        source: "typed-text",
        requiresReview: false,
        reviewed: true,
      }],
    },
    materials: {
      "session-old": [{
        sourceId: "source-old",
        name: "Ghi chú tế bào",
        size: 38,
        type: "text/plain",
        status: "extracted",
        message: "Đã lưu",
      }],
    },
    guestPublished: [],
    quizDrafts: {},
    learningPath: createLearningPathProgress(),
    ...overrides,
  };
}

test("legacy owners get goal-first defaults without replaying onboarding or losing existing records", () => {
  withLocalStorage(() => {
    const learningPath = createLearningPathProgress("physics-9-ohm");
    localStorage.setItem("train-adventure:v1:guest", JSON.stringify(legacySaved({ learningPath })));

    const restored = readSaved("guest");

    assert.equal(restored.studyPlanStorage.version, 1);
    assert.equal(restored.studyPlanStorage.onboarding.phase, "complete");
    assert.equal(restored.studyPlanStorage.draft.topicId, "biology");
    assert.equal(restored.studyPlanStorage.draft.preferredMinutes, 25);
    assert.equal(restored.notes["session-old"], "Ghi chú riêng đã lưu");
    assert.equal(restored.local.sessions["session-old"].quiz.score, 1);
    assert.equal(restored.sources["session-old"][0].id, "source-old");
    assert.equal(restored.materials["session-old"][0].sourceId, "source-old");
    assert.equal(restored.learningPath.selectedCourseId, "physics-9-ohm");
  });
});

test("an empty owner starts the survey with current manual-study defaults", () => {
  withLocalStorage(() => {
    const restored = readSaved("new-owner");

    assert.equal(restored.studyPlanStorage.onboarding.phase, "survey");
    assert.equal(restored.studyPlanStorage.draft.goal, "");
    assert.equal(restored.studyPlanStorage.draft.topicId, "biology");
    assert.equal(restored.studyPlanStorage.draft.topicLabel, "Sinh học");
    assert.equal(restored.studyPlanStorage.draft.preferredMinutes, 25);
  });
});

test("a malformed new plan field resets independently and preserves existing saved records", () => {
  withLocalStorage(() => {
    localStorage.setItem("train-adventure:v1:guest", JSON.stringify(legacySaved({
      studyPlanStorage: { version: 999, draft: { goal: "bad" }, onboarding: null, plans: "bad" },
    })));

    const restored = readSaved("guest");

    assert.equal(restored.studyPlanStorage.onboarding.phase, "complete");
    assert.equal(restored.notes["session-old"], "Ghi chú riêng đã lưu");
    assert.equal(restored.local.sessions["session-old"].quiz.score, 1);
    assert.equal(restored.sources["session-old"][0].id, "source-old");
  });
});

test("plan drafts remain scoped to the existing owner-specific Saved record", () => {
  withLocalStorage(() => {
    const guest = readSaved("guest");
    writeSaved("guest", {
      ...guest,
      studyPlanStorage: {
        ...guest.studyPlanStorage,
        draft: { ...guest.studyPlanStorage.draft, goal: "Ôn cấu trúc tế bào" },
      },
    });

    assert.equal(readSaved("guest").studyPlanStorage.draft.goal, "Ôn cấu trúc tế bào");
    assert.equal(readSaved("student-a").studyPlanStorage.draft.goal, "");
  });
});

test("plan storage keeps valid records, drops malformed plan entries, and does not clamp invalid duration", () => {
  const initial = createStudyPlanStorage();
  const validPlan = {
    id: "plan-1",
    origin: "ai",
    title: "Ôn cấu trúc tế bào",
    goal: "Giải thích vai trò của màng tế bào",
    topicId: "biology",
    topicLabel: "Sinh học",
    level: "Lớp 9",
    preferredMinutes: 45,
    selectedStepId: "step-1",
    createdAt: 1_000,
    updatedAt: 1_000,
    steps: [
      {
        id: "step-1",
        plannedSessionId: "session-plan-1",
        title: "Nhận biết cấu trúc",
        action: "Đọc ghi chú về màng tế bào",
        outcome: "Nêu được chức năng chính",
        check: "Tự giải thích bằng lời của mình",
        preferredMinutes: 45,
      },
      {
        id: "step-2",
        plannedSessionId: "session-plan-2",
        title: "Liên hệ trao đổi chất",
        action: "Mô tả một chất đi qua màng tế bào",
        outcome: "Phân biệt được vận chuyển thụ động và chủ động",
        check: "Nêu dấu hiệu cần năng lượng",
        preferredMinutes: 35,
      },
      {
        id: "step-3",
        plannedSessionId: "session-plan-3",
        title: "Tự kiểm tra",
        action: "Vẽ sơ đồ đơn giản của màng tế bào",
        outcome: "Giải thích được hai thành phần chính",
        check: "So sánh sơ đồ với ghi chú đã xem",
        preferredMinutes: 25,
      },
    ],
  };

  const restored = normalizeStudyPlanStorage({
    ...initial,
    draft: { ...initial.draft, preferredMinutes: 241 },
    plans: [validPlan, { ...validPlan, id: "broken", steps: [] }, {
      ...validPlan,
      id: "one-step-ai",
      steps: [validPlan.steps[0]],
    }],
  });

  assert.equal(restored.draft.preferredMinutes, 25);
  assert.deepEqual(restored.plans.map((plan) => plan.id), ["plan-1"]);
});

test("one-step local manual plans remain readable while generated plans require three steps", () => {
  const base = createStudyPlanStorage();
  const manual = {
    id: "manual-plan",
    origin: "manual",
    title: "Ôn một mục tiêu nhỏ",
    goal: "Nêu được chức năng của màng tế bào",
    topicId: "biology",
    topicLabel: "Sinh học",
    level: "",
    preferredMinutes: 25,
    selectedStepId: "step-one",
    createdAt: 1_000,
    updatedAt: 1_000,
    steps: [{
      id: "step-one",
      plannedSessionId: "manual-session",
      title: "Giải thích chức năng",
      action: "Đọc lại ghi chú đã lưu",
      outcome: "Nêu được vai trò của màng tế bào",
      check: "Tự nói lại bằng lời của mình",
      preferredMinutes: 25,
    }],
  };

  const restored = normalizeStudyPlanStorage({ ...base, plans: [manual] });

  assert.deepEqual(restored.plans.map((plan) => plan.id), ["manual-plan"]);
});
