import assert from "node:assert/strict";
import test from "node:test";
import { readSaved, writeSaved } from "../src/adventure/storage.ts";
import { createLearningPathProgress } from "../src/adventure/learningPath.ts";
import {
  createStudyPlanStorage,
  applyStudyPlanStepPatch,
  advanceStudyPlanCandidateAfterStart,
  findStudyWorkspaceDraft,
  normalizeStudyPlanStorage,
  saveStudyWorkspaceDraft,
  selectedStudyWorkspaceIdentity,
  studyWorkspaceSourceContentChanged,
  updateStudyPlanDraftFromQuickTrip,
} from "../src/adventure/studyPlanStorage.ts";
import { reduceStudyOnboardingProgress, reopenStudyOnboardingFromDraft } from "../src/adventure/studyOnboardingModel.ts";

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

test("a skipped walkthrough survives owner-local reload and resumes at its saved step", () => {
  withLocalStorage(() => {
    const storage = createStudyPlanStorage();
    storage.onboarding = {
      ...storage.onboarding,
      phase: "tutorial",
      tutorialStep: 2,
      survey: {
        ...storage.onboarding.survey,
        goal: "Ôn phản ứng hóa học",
        topicId: "chemistry",
        topicLabel: "Hóa học",
        preferredMinutes: 45,
      },
      tutorial: { sourceChoice: "files" },
    };
    storage.onboarding = reduceStudyOnboardingProgress(storage.onboarding, { type: "onboarding/skip" });
    localStorage.setItem("train-adventure:v1:guest", JSON.stringify(legacySaved({ studyPlanStorage: storage })));

    const restored = readSaved("guest");
    assert.equal(restored.studyPlanStorage.onboarding.phase, "skipped");
    assert.equal(restored.studyPlanStorage.onboarding.pausedFrom, "tutorial");
    assert.equal(restored.studyPlanStorage.onboarding.tutorialStep, 2);
    assert.equal(restored.studyPlanStorage.onboarding.survey.goal, "Ôn phản ứng hóa học");
    assert.equal(restored.studyPlanStorage.onboarding.survey.preferredMinutes, 45);

    const resumed = reduceStudyOnboardingProgress(restored.studyPlanStorage.onboarding, { type: "onboarding/resume" });
    assert.equal(resumed.phase, "tutorial");
    assert.equal(resumed.tutorialStep, 2);
    assert.equal(resumed.tutorial.sourceChoice, "files");
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

test("workspace draft candidate and material stay inside their owner record across reload", () => {
  withLocalStorage(() => {
    const guest = readSaved("guest");
    const candidateSessionId = "guest-candidate-before-start";
    const storage = {
      ...guest.studyPlanStorage,
      draft: { ...guest.studyPlanStorage.draft, candidateSessionId },
    };
    const withWorkspace = saveStudyWorkspaceDraft(storage, {
      sessionId: candidateSessionId,
      planId: null,
      stepId: null,
      notes: "Ghi chú ôn tập chỉ lưu trên thiết bị này.",
      sources: [{ id: "source-guest", name: "Ghi chú.txt", text: "Nội dung đã trích xuất và đang chờ kiểm tra.", source: "embedded-text", requiresReview: true, reviewed: false }],
      materials: [{ sourceId: "source-guest", name: "Ghi chú.txt", size: 48, type: "text/plain", status: "extracted", message: "Đã đọc trên thiết bị." }],
      updatedAt: 3_000,
    });
    writeSaved("guest", { ...guest, studyPlanStorage: withWorkspace });

    const guestReload = readSaved("guest");
    const identity = selectedStudyWorkspaceIdentity(guestReload.studyPlanStorage);
    const studentReload = readSaved("student-a");

    assert.equal(identity.sessionId, candidateSessionId);
    assert.deepEqual(findStudyWorkspaceDraft(guestReload.studyPlanStorage, identity)?.sources[0], withWorkspace.workspaceDrafts[0].sources[0]);
    assert.equal(findStudyWorkspaceDraft(studentReload.studyPlanStorage, identity), undefined);
  });
});

test("reopening onboarding uses the edited goal and duration while preserving private legacy material and grades", () => {
  withLocalStorage(() => {
    const storage = createStudyPlanStorage({ legacyActivity: true });
    storage.onboarding = {
      ...storage.onboarding,
      survey: {
        ...storage.onboarding.survey,
        goal: "Mục tiêu khảo sát cũ",
        preferredMinutes: 25,
      },
    };
    storage.draft = {
      ...storage.draft,
      goal: "Mục tiêu đã chỉnh trong buổi học",
      topicId: "chemistry",
      topicLabel: "Hóa học",
      preferredMinutes: 90,
    };
    localStorage.setItem("train-adventure:v1:guest", JSON.stringify(legacySaved({ studyPlanStorage: storage })));

    const saved = readSaved("guest");
    const reopened = reopenStudyOnboardingFromDraft(saved.studyPlanStorage.onboarding, saved.studyPlanStorage.draft);
    const nextSaved = {
      ...saved,
      studyPlanStorage: { ...saved.studyPlanStorage, onboarding: reopened },
    };

    assert.equal(reopened.survey.goal, "Mục tiêu đã chỉnh trong buổi học");
    assert.equal(reopened.survey.preferredMinutes, 90);
    assert.equal(reopened.survey.topicLabel, "Hóa học");
    assert.equal(nextSaved.notes["session-old"], "Ghi chú riêng đã lưu");
    assert.equal(nextSaved.sources["session-old"][0].id, "source-old");
    assert.equal(nextSaved.materials["session-old"][0].sourceId, "source-old");
    assert.equal(nextSaved.local.sessions["session-old"].quiz.score, 1);
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

test("starting a session advances the selected plan or manual candidate without changing the session ID", () => {
  const base = createStudyPlanStorage();
  const plan = {
    id: "manual-plan",
    origin: "manual",
    title: "Ôn cấu trúc tế bào",
    goal: "Giải thích vai trò của màng tế bào",
    topicId: "biology",
    topicLabel: "Sinh học",
    level: "",
    preferredMinutes: 25,
    selectedStepId: "step-one",
    createdAt: 1_000,
    updatedAt: 1_000,
    steps: [{
      id: "step-one",
      plannedSessionId: "candidate-in-focus",
      title: "Ôn cấu trúc",
      action: "Đọc ghi chú",
      outcome: "Nêu chức năng chính",
      check: "Giải thích bằng lời mình",
      preferredMinutes: 25,
    }],
  };
  const planned = {
    ...base,
    draft: { ...base.draft, selectedPlanId: plan.id, selectedStepId: "step-one", candidateSessionId: "candidate-in-focus" },
    plans: [plan],
    workspaceDrafts: [{
      sessionId: "candidate-in-focus",
      planId: plan.id,
      stepId: "step-one",
      notes: "Ghi chú đang soạn cho bước này.",
      sources: [{ id: "source-private", name: "Ghi chú.txt", text: "Nguồn đã duyệt.", source: "notes", reviewed: true, requiresReview: false }],
      materials: [{ sourceId: "source-private", name: "Ghi chú.txt", size: 28, type: "text/plain", status: "extracted", message: "Đã đọc trên thiết bị." }],
      updatedAt: 2_000,
    }],
  };

  const advancedPlan = advanceStudyPlanCandidateAfterStart(planned, "candidate-in-focus", "candidate-next");
  const advancedManual = advanceStudyPlanCandidateAfterStart({
    ...base,
    draft: { ...base.draft, candidateSessionId: "manual-in-focus" },
  }, "manual-in-focus", "manual-next");

  assert.equal(advancedPlan.draft.selectedPlanId, plan.id);
  assert.equal(advancedPlan.draft.selectedStepId, "step-one");
  assert.equal(advancedPlan.draft.candidateSessionId, "candidate-next");
  assert.equal(advancedPlan.plans[0].steps[0].plannedSessionId, "candidate-next");
  assert.equal(plan.steps[0].plannedSessionId, "candidate-in-focus");
  assert.deepEqual(advancedPlan.workspaceDrafts.map((draft) => draft.sessionId), ["candidate-in-focus", "candidate-next"]);
  assert.deepEqual(advancedPlan.workspaceDrafts[1], {
    ...planned.workspaceDrafts[0],
    sessionId: "candidate-next",
  });
  assert.equal(advancedManual.draft.candidateSessionId, "manual-next");
  assert.equal(advancedManual.draft.selectedPlanId, null);
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

test("workspace material drafts restore only for the exact owner-local plan step and candidate", () => {
  const storage = createStudyPlanStorage({ legacyActivity: true });
  const plan = {
    id: "plan-private",
    origin: "ai",
    title: "Ôn cấu trúc tế bào",
    goal: "Giải thích vai trò của màng tế bào",
    topicId: "biology",
    topicLabel: "Sinh học",
    level: "",
    preferredMinutes: 45,
    selectedStepId: "step-one",
    createdAt: 1_000,
    updatedAt: 1_000,
    steps: [
      { id: "step-one", plannedSessionId: "candidate-one", title: "Nhận biết cấu trúc", action: "Đọc ghi chú đã chọn", outcome: "Nêu chức năng chính", check: "Giải thích bằng lời mình", preferredMinutes: 45 },
      { id: "step-two", plannedSessionId: "candidate-two", title: "Liên hệ trao đổi chất", action: "Mô tả chất đi qua màng", outcome: "Phân biệt được hai cách vận chuyển", check: "Nêu dấu hiệu cần năng lượng", preferredMinutes: 45 },
      { id: "step-three", plannedSessionId: "candidate-three", title: "Tự kiểm tra kiến thức", action: "Trả lời câu hỏi ôn tập", outcome: "Tìm được điểm cần ôn", check: "Nêu điều còn chưa chắc", preferredMinutes: 45 },
    ],
  };
  const selected = {
    ...storage,
    draft: { ...storage.draft, selectedPlanId: plan.id, selectedStepId: "step-one" },
    plans: [plan],
  };
  const firstStepDraft = {
    sessionId: "candidate-one",
    planId: "plan-private",
    stepId: "step-one",
    notes: "Ý chính: màng tế bào điều hòa trao đổi chất.",
    sources: [{ id: "source-one", name: "Ghi chú.txt", text: "Nội dung đã nhập nhưng chưa xác nhận.", source: "embedded-text", requiresReview: true, reviewed: false }],
    materials: [{ sourceId: "source-one", name: "Ghi chú.txt", size: 42, type: "text/plain", status: "extracted", message: "Đã đọc trên thiết bị." }],
    updatedAt: 2_000,
  };
  const saved = saveStudyWorkspaceDraft(selected, firstStepDraft);
  const restored = normalizeStudyPlanStorage(saved);

  assert.equal(restored.draft.selectedPlanId, "plan-private");
  assert.equal(restored.draft.selectedStepId, "step-one");
  assert.deepEqual(findStudyWorkspaceDraft(restored, {
    sessionId: "candidate-one", planId: "plan-private", stepId: "step-one",
  }), firstStepDraft);
  assert.equal(findStudyWorkspaceDraft(restored, {
    sessionId: "candidate-one", planId: "plan-private", stepId: "step-two",
  }), undefined);
  assert.equal(restored.workspaceDrafts[0].sources[0].reviewed, false);
  assert.equal(restored.workspaceDrafts[0].materials[0].name, "Ghi chú.txt");
});

test("workspace draft bounds reject oversized notes with a recoverable message", () => {
  const storage = createStudyPlanStorage({ legacyActivity: true });
  assert.throws(() => saveStudyWorkspaceDraft(storage, {
    sessionId: storage.draft.candidateSessionId,
    planId: null,
    stepId: null,
    notes: "x".repeat(50_001),
    sources: [],
    materials: [],
    updatedAt: 4_000,
  }), /Nội dung vượt giới hạn lưu/u);
});

test("selected plan step patches save bounded content without changing duration or candidate", () => {
  const base = createStudyPlanStorage({ legacyActivity: true });
  const plan = {
    id: "plan-edit",
    origin: "ai",
    title: "Ôn cấu trúc tế bào",
    goal: "Giải thích vai trò của màng tế bào",
    topicId: "biology",
    topicLabel: "Sinh học",
    level: "",
    preferredMinutes: 45,
    selectedStepId: "step-edit",
    createdAt: 1_000,
    updatedAt: 1_000,
    steps: [
      { id: "step-edit", plannedSessionId: "candidate-edit", title: "Nhận biết cấu trúc", action: "Đọc ghi chú đã chọn", outcome: "Nêu chức năng chính", check: "Giải thích bằng lời mình", preferredMinutes: 45 },
      { id: "step-other", plannedSessionId: "candidate-other", title: "Liên hệ trao đổi chất", action: "Mô tả chất đi qua màng", outcome: "Phân biệt hai cách vận chuyển", check: "Nêu dấu hiệu cần năng lượng", preferredMinutes: 45 },
      { id: "step-last", plannedSessionId: "candidate-last", title: "Tự kiểm tra kiến thức", action: "Trả lời câu hỏi ôn tập", outcome: "Tìm điểm cần ôn", check: "Nêu điều còn chưa chắc", preferredMinutes: 45 },
    ],
  };
  const storage = {
    ...base,
    draft: { ...base.draft, selectedPlanId: plan.id, selectedStepId: plan.selectedStepId, candidateSessionId: "candidate-edit", preferredMinutes: 90 },
    plans: [plan],
  };
  const updated = applyStudyPlanStepPatch(storage, "step-edit", {
    action: "Giải một ví dụ cụ thể",
    outcome: "Nêu được chức năng qua ví dụ",
    check: "Tự giải thích bằng lời mình",
  }, 2_000);

  assert.ok(updated);
  assert.equal(updated.draft.preferredMinutes, 90);
  assert.equal(updated.draft.candidateSessionId, "candidate-edit");
  assert.equal(updated.plans[0].steps[0].action, "Giải một ví dụ cụ thể");
  assert.equal(applyStudyPlanStepPatch(storage, "step-other", { action: "Nội dung khác hợp lệ" }, 2_000), null);
  assert.equal(applyStudyPlanStepPatch(storage, "step-edit", { action: "x" }, 2_000), null);
});

test("explicit null clears optional level, confidence, and selected plan fields", () => {
  const current = {
    ...createStudyPlanStorage().draft,
    level: "Lớp 9",
    confidence: 3,
    selectedPlanId: "plan-a",
    selectedStepId: "step-a",
  };

  const updated = updateStudyPlanDraftFromQuickTrip(current, {
    goal: "Ôn phản ứng hóa học",
    topic: "chemistry",
    minutes: 45,
    breakCount: 0,
    breakMinutes: 5,
    level: "",
    confidence: null,
    selectedPlanId: null,
    selectedStepId: null,
  }, "Hóa học");

  assert.equal(updated.level, "");
  assert.equal(updated.confidence, null);
  assert.equal(updated.selectedPlanId, null);
  assert.equal(updated.selectedStepId, null);
});

test("workspace source comparison detects notes, review, source, and material changes without treating clones as edits", () => {
  const previous = {
    sessionId: "candidate-1",
    planId: null,
    stepId: null,
    notes: "Ghi chú đã lưu.",
    sources: [{ id: "source-1", name: "Ghi chú.txt", text: "Nội dung đủ dài đã duyệt.", source: "notes", reviewed: true, requiresReview: false }],
    materials: [{ sourceId: "source-1", name: "Ghi chú.txt", size: 27, type: "text/plain", status: "extracted", message: "Đã đọc." }],
    updatedAt: 1_000,
  };
  const clone = structuredClone(previous);
  assert.equal(studyWorkspaceSourceContentChanged(previous, clone), false);
  assert.equal(studyWorkspaceSourceContentChanged(previous, { ...clone, notes: "Ghi chú mới." }), true);
  assert.equal(studyWorkspaceSourceContentChanged(previous, { ...clone, sources: [{ ...clone.sources[0], text: "Nội dung thay đổi đủ dài." }] }), true);
  assert.equal(studyWorkspaceSourceContentChanged(previous, { ...clone, sources: [{ ...clone.sources[0], reviewed: false }] }), true);
  assert.equal(studyWorkspaceSourceContentChanged(previous, { ...clone, materials: [{ ...clone.materials[0], status: "empty" }] }), true);
  assert.equal(studyWorkspaceSourceContentChanged(undefined, clone), true);
});
