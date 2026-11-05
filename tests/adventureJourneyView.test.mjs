import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tmpdir } from "node:os";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let vite;
let BoardingTicket;
let StudyPreparationSummary;
let JourneyView;
let StudyNotesInput;
let tripSceneTiming;
let StudyGuideComposer;
let QuizPanel;
let QuizReviewPreference;
let SessionCorrectionNotice;

before(async () => {
  vite = await createServer({
    configFile: resolve(projectRoot, "vite.config.ts"),
    cacheDir: resolve(tmpdir(), "viendu-v3-scene-tests", "journey-view"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ BoardingTicket } = await vite.ssrLoadModule("/src/adventure/BoardingTicket.tsx"));
  ({ StudyPreparationSummary } = await vite.ssrLoadModule("/src/adventure/StudySessionPresentation.tsx"));
  ({ JourneyView } = await vite.ssrLoadModule("/src/adventure/JourneyView.tsx"));
  ({ StudyNotesInput } = await vite.ssrLoadModule("/src/adventure/StudyNotesInput.tsx"));
  ({ StudyGuideComposer } = await vite.ssrLoadModule("/src/adventure/StudyGuideComposer.tsx"));
  ({ QuizPanel } = await vite.ssrLoadModule("/src/adventure/QuizPanel.tsx"));
  ({ QuizReviewPreference } = await vite.ssrLoadModule("/src/adventure/QuizReviewPreference.tsx"));
  ({ SessionCorrectionNotice } = await vite.ssrLoadModule("/src/adventure/SessionCorrectionNotice.tsx"));
  ({ tripSceneTiming } = await vite.ssrLoadModule("/src/adventure/focus.ts"));
});

after(async () => {
  await vite?.close();
});

const boardingTicket = (overrides = {}) => renderToStaticMarkup(
  React.createElement(BoardingTicket, {
    goal: "Review cell structure",
    topicName: "Biology",
    minutes: 45,
    breakCount: 2,
    breakMinutes: 5,
    station: "Rừng Sương mù",
    branch: "coast",
    carriageName: "Toa Mây",
    mode: "group",
    ...overrides,
  }),
);

test("boarding pass keeps the goal, route, and planned time on a concise ticket", () => {
  const markup = boardingTicket({ tripCode: "V-ABCDEF012345" });

  assert.match(markup, /Review cell structure/u);
  assert.match(markup, /Biology/u);
  assert.match(markup, /Toa Mây/u);
  assert.match(markup, /45 phút/u);
  assert.match(markup, /10 phút/u);
  assert.match(markup, /2 lần × 5 phút/u);
  assert.match(markup, /55 phút/u);
  assert.match(markup, /Rừng Sương mù/u);
  assert.match(markup, /Ven biển/u);
  assert.match(markup, /Cùng đoàn/u);
  assert.match(markup, /V-ABCDEF012345/u);
  assert.doesNotMatch(markup, /Kết thúc phiên|Nghỉ xen kẽ/u);
  assert.doesNotMatch(markup, /Thành phố Bình minh/u);
  assert.match(markup, /<svg class="boarding-ticket__ornament" aria-hidden="true"/u);
  assert.match(markup, /<svg class="boarding-ticket__landscape" aria-hidden="true"/u);
});

test("boarding pass uses shared-trip wording only for synchronized group sessions", () => {
  const synchronized = boardingTicket({ synchronizedTrip: true });
  const legacy = boardingTicket({ synchronizedTrip: false });
  const solo = boardingTicket({ mode: "solo", synchronizedTrip: false });

  assert.match(synchronized, /Cùng chuyến/u);
  assert.doesNotMatch(synchronized, /Cùng đoàn/u);
  assert.match(legacy, /Cùng đoàn/u);
  assert.match(solo, /Một mình/u);
  assert.doesNotMatch(solo, /Cùng chuyến|Cùng đoàn/u);
});

test("preparation summary shows the study plan and keeps journey details collapsed", () => {
  assert.equal(typeof StudyPreparationSummary, "function", "the shared preparation summary is available");

  const markup = renderToStaticMarkup(React.createElement(StudyPreparationSummary, {
    goal: "Giải phương trình bậc hai",
    subject: "Toán học",
    minutes: 25,
    breakCount: 2,
    breakMinutes: 5,
    children: React.createElement(BoardingTicket, {
      goal: "Giải phương trình bậc hai",
      topicName: "Toán học",
      minutes: 25,
      breakCount: 2,
      breakMinutes: 5,
      station: "Rừng Sương mù",
      branch: "coast",
      carriageName: "Toa Mây",
      mode: "solo",
    }),
  }));

  assert.match(markup, /aria-labelledby="study-preparation-summary-title"/u);
  assert.match(markup, /<h2 id="study-preparation-summary-title"[^>]*>Tóm tắt buổi học<\/h2>/u);
  assert.match(markup, /aria-label="Người bạn học, một sinh vật nhỏ đội lá"/u);
  assert.match(markup, /<dt>Mục tiêu<\/dt><dd>Giải phương trình bậc hai<\/dd>/u);
  assert.match(markup, /<dt>Môn học<\/dt><dd>Toán học<\/dd>/u);
  assert.match(markup, /<dt>Tập trung<\/dt><dd>25 phút<\/dd>/u);
  assert.match(markup, /<dt>Giải lao<\/dt><dd>2 lần × 5 phút<\/dd>/u);
  assert.match(markup, /<dt>Tổng thời lượng<\/dt><dd>35 phút<\/dd>/u);
  assert.match(markup, /<details class="study-preparation-summary__journey"><summary>Chi tiết hành trình<\/summary><section class="boarding-ticket"/u);
  assert.doesNotMatch(markup, /<details[^>]*\bopen(?:=|>)/u);
});

test("study notes describe a goal for the study session", () => {
  const markup = renderToStaticMarkup(React.createElement(StudyNotesInput, {
    value: "",
    onChange: () => {},
    disabled: false,
    hasDocuments: false,
  }));

  assert.match(markup, /Mục tiêu buổi học cho biết/u);
  assert.doesNotMatch(markup, /Mục tiêu chuyến đi/u);
});

test("pending AI guide review exposes a clearly primary confirmation and explicit discard", () => {
  const markup = renderToStaticMarkup(React.createElement(StudyGuideComposer, {
    disabled: false,
    canGenerate: true,
    unavailableReason: "",
    review: { draft: { title: "Ôn Sinh học", text: "## Tế bào\nMàng tế bào điều hòa trao đổi chất." }, view: "preview" },
    onReviewAction: () => {},
    onGenerate: async () => undefined,
    onCancel: () => {},
    onUse: () => {},
    onDiscard: () => {},
    onDownload: () => {},
  }));

  assert.match(markup, /<button class="primary"[^>]*>Xác nhận và dùng làm tài liệu<\/button>/u);
  assert.match(markup, /Bản AI chưa là tài liệu/u);
  assert.match(markup, /Bỏ bản nháp AI/u);
  assert.match(markup, /Liệt kê từ vựng tiếng Anh về các môn thể thao/u);
  assert.match(markup, /Bản ôn tập sẽ theo yêu cầu của bạn/u);
  assert.doesNotMatch(markup, /Bố cục bản ôn tập|đúng 8 mục|Lý thuyết \(chi tiết nhất\)/u);
});

test("quiz generation exposes a distinct primary action", () => {
  const markup = renderToStaticMarkup(React.createElement(QuizPanel, {
    ownerId: "owner-a",
    session: { id: "trip-a", topic: "biology", goal: "Review cells" },
    canUseAI: true,
    needsLogin: false,
    onGenerate: async () => [],
    onSaveDraft: () => {},
    onGrade: async () => ({}),
    onLogin: () => {},
    onStartReview: () => {},
  }));

  assert.match(markup, /<button class="primary quiz-panel__generate"[^>]*>Tạo câu hỏi bằng AI<\/button>/u);
});

test("a saved private quiz grade remains visible when the guest credential is gone", () => {
  const questionId = "123e4567-e89b-42d3-a456-426614174000";
  const markup = renderToStaticMarkup(React.createElement(QuizPanel, {
    ownerId: "guest",
    session: { id: "session-a", topic: "biology", goal: "Review cells" },
    draft: {
      count: 1,
      requestedCount: 1,
      guestQuizId: "private-quiz-a",
      questions: [{
        id: questionId,
        question: "Which structure stores genetic information?",
        options: ["Cell wall", "Nucleus", "Ribosome", "Cytoplasm"],
      }],
      answers: { [questionId]: 1 },
      guestGrade: {
        score: 1,
        total: 1,
        feedback: [{
          questionId,
          question: "Which structure stores genetic information?",
          options: ["Cell wall", "Nucleus", "Ribosome", "Cytoplasm"],
          selected: 1,
          correctIndex: 1,
          correct: true,
          explanation: "The nucleus contains most of the cell's genetic material.",
          knowledgePoint: "Cell structure",
        }],
      },
    },
    canUseAI: false,
    isGuest: true,
    needsLogin: false,
    onGenerate: async () => ({ questions: [], guestQuizId: "private-quiz-a" }),
    onSaveDraft() {},
    onGrade: async () => ({}),
    onLogin() {},
    onStartReview() {},
  }));

  assert.match(markup, /Điểm: 1\/1/u);
  assert.match(markup, /The nucleus contains most of the cell&#x27;s genetic material\./u);
  assert.doesNotMatch(markup, /hết hạn|Đăng nhập để tạo quiz AI/u);
});

test("an ungraded private quiz asks the learner to regenerate the expired deck", () => {
  const questionId = "123e4567-e89b-42d3-a456-426614174001";
  const markup = renderToStaticMarkup(React.createElement(QuizPanel, {
    ownerId: "guest",
    session: { id: "session-b", topic: "biology", goal: "Review cells" },
    draft: {
      count: 1,
      requestedCount: 1,
      guestQuizId: "private-quiz-b",
      questions: [{
        id: questionId,
        question: "Which structure stores genetic information?",
        options: ["Cell wall", "Nucleus", "Ribosome", "Cytoplasm"],
      }],
      answers: {},
    },
    canUseAI: true,
    isGuest: true,
    needsLogin: false,
    onGenerate: async () => ({ questions: [], guestQuizId: "private-quiz-b" }),
    onSaveDraft() {},
    onGrade: async () => ({}),
    onLogin() {},
    onStartReview() {},
  }));

  assert.match(markup, /Bộ câu hỏi này không còn gắn với phiên AI riêng tư hiện tại\. Hãy tạo lại bộ câu hỏi trước khi trả lời\./u);
  assert.match(markup, /Tạo lại câu hỏi bằng AI/u);
  assert.match(markup, /<fieldset disabled="">/u);
  assert.doesNotMatch(markup, /Đăng nhập/u);
});

test("a skipped review stays closed after the session and offers an explicit opt-in", () => {
  const markup = renderToStaticMarkup(React.createElement(QuizPanel, {
    ownerId: "owner-a",
    session: { id: "trip-a", topic: "biology", goal: "Review cells" },
    draft: { count: 3, requestedCount: 3, questions: [], answers: {}, reviewSkipped: true },
    canUseAI: true,
    needsLogin: false,
    onGenerate: async () => [],
    onSaveDraft: () => {},
    onGrade: async () => ({}),
    onLogin: () => {},
    onStartReview: () => {},
  }));

  assert.match(markup, /Đã bỏ qua câu hỏi ôn tập/u);
  assert.match(markup, /Bật ôn tập/u);
  assert.doesNotMatch(markup, /Tạo câu hỏi bằng AI/u);
});

test("departure review preference uses an explicit skip toggle and hides the count while skipped", () => {
  const control = (skipped, disabled = false) => renderToStaticMarkup(React.createElement(QuizReviewPreference, {
    count: "3",
    skipped,
    disabled,
    onCountChange: () => {},
    onToggleSkip: () => {},
  }));
  const enabledMarkup = control(false);
  assert.match(enabledMarkup, /type="number"[^>]*value="3"/u);
  assert.match(enabledMarkup, /aria-pressed="false"[^>]*>Bỏ qua ôn tập/u);
  assert.match(enabledMarkup, /Quiz AI là tùy chọn/u);
  assert.match(enabledMarkup, /Bạn có thể tạo câu hỏi sau buổi học mà không cần tài khoản/u);
  assert.match(enabledMarkup, /có thể chuẩn bị trước câu hỏi từ nguồn đã xác nhận trong lúc bạn học/u);
  assert.match(enabledMarkup, /Khi đăng nhập và bật ôn tập/u);
  assert.doesNotMatch(enabledMarkup, /chỉ khi đăng nhập/u);

  const skippedMarkup = control(true);
  assert.doesNotMatch(skippedMarkup, /type="number"/u);
  assert.match(skippedMarkup, /aria-pressed="true"[^>]*>Bật ôn tập/u);
  assert.match(skippedMarkup, /không chuẩn bị câu hỏi/u);
  assert.match(skippedMarkup, /Sau phiên, bạn vẫn có thể tự tạo Quiz AI mà không cần tài khoản/u);

  const busyMarkup = control(false, true);
  assert.match(busyMarkup, /<input[^>]*disabled=""/u);
  assert.match(busyMarkup, /<button[^>]*disabled=""/u);
});

test("corrected summary notice separates effective metrics from the recorded end time", () => {
  const markup = renderToStaticMarkup(React.createElement(SessionCorrectionNotice, {
    correctionFlags: {
      goal: false, topic: false, targetSeconds: false, elapsedSeconds: true,
      actualStudySeconds: false, focusedSeconds: true, actualBreakSeconds: false,
      distractions: false, quizResult: false,
    },
    recordedEnd: "22/10, 11:30",
  }));

  assert.match(markup, /Một số nội dung hoặc số liệu phiên này đã được hiệu chỉnh/u);
  assert.match(markup, /Mốc kết thúc ghi nhận vẫn là thời điểm đã đo: 22\/10, 11:30/u);
  assert.match(markup, /Thời lượng hiệu lực đã được hiệu chỉnh riêng/u);
});

test("summary correction notice stays absent when no correction is active", () => {
  const markup = renderToStaticMarkup(React.createElement(SessionCorrectionNotice, {
    correctionFlags: {
      goal: false, topic: false, targetSeconds: false, elapsedSeconds: false,
      actualStudySeconds: false, focusedSeconds: false, actualBreakSeconds: false,
      distractions: false, quizResult: false,
    },
    recordedEnd: "22/10, 11:30",
  }));

  assert.equal(markup, "");
});

test("corrected quiz metrics stay separate from the original grade feedback", () => {
  const markup = renderToStaticMarkup(React.createElement(QuizPanel, {
    ownerId: "owner-a",
    session: {
      id: "trip-a",
      topic: "biology",
      goal: "Review cells",
      correctionVersion: 2,
      effectiveMetrics: {
        targetSeconds: 60, elapsedSeconds: 60, actualStudySeconds: 60, focusedSeconds: 45,
        plannedBreakSeconds: 0, actualBreakSeconds: 0, distractions: 1, completed: true,
        quizScore: 2, quizTotal: 3,
      },
      correctionFlags: { goal: false, topic: false, targetSeconds: false, elapsedSeconds: false,
        actualStudySeconds: false, focusedSeconds: false, actualBreakSeconds: false,
        distractions: false, quizResult: true },
      quiz: { score: 0, total: 1, feedback: [{ questionId: "original-q", question: "Original question?",
        options: ["A", "B"], selected: 0, correctIndex: 1, correct: false,
        explanation: "Original explanation.", knowledgePoint: "Cells" }] },
    },
    canUseAI: true,
    needsLogin: false,
    onGenerate: async () => [],
    onSaveDraft: () => {},
    onGrade: async () => ({}),
    onLogin: () => {},
    onStartReview: () => {},
  }));

  assert.match(markup, /Điểm theo lịch sử đã điều chỉnh: 2\/3/u);
  assert.match(markup, /Điểm chấm ban đầu: 0\/1/u);
  assert.match(markup, /Original explanation\./u);
});

test("a corrected session topic keeps the original quiz score and feedback visible", () => {
  const markup = renderToStaticMarkup(React.createElement(QuizPanel, {
    ownerId: "owner-a",
    session: {
      id: "trip-a",
      topic: "history",
      goal: "Review cells",
      correctionVersion: 1,
      effectiveMetrics: {
        targetSeconds: 60, elapsedSeconds: 60, actualStudySeconds: 60, focusedSeconds: 45,
        plannedBreakSeconds: 0, actualBreakSeconds: 0, distractions: 1, completed: true,
        quizScore: 0, quizTotal: 1,
      },
      correctionFlags: { goal: false, topic: true, targetSeconds: false, elapsedSeconds: false,
        actualStudySeconds: false, focusedSeconds: false, actualBreakSeconds: false,
        distractions: false, quizResult: false },
      quiz: { score: 0, total: 1, feedback: [{ questionId: "original-q", question: "Original question?",
        options: ["A", "B"], selected: 0, correctIndex: 1, correct: false,
        explanation: "Original feedback stays here.", knowledgePoint: "Cells" }] },
    },
    canUseAI: true,
    needsLogin: false,
    onGenerate: async () => [],
    onSaveDraft: () => {},
    onGrade: async () => ({}),
    onLogin: () => {},
    onStartReview: () => {},
  }));

  assert.match(markup, /Chủ đề phiên học đã được hiệu chỉnh; điểm và phản hồi dưới đây vẫn là kết quả chấm ban đầu\./u);
  assert.match(markup, /Điểm chấm ban đầu: 0\/1/u);
  assert.match(markup, /Original feedback stays here\./u);
  assert.doesNotMatch(markup, /Điểm theo lịch sử đã điều chỉnh/u);
});

test("boarding pass shows the honest pending code copy unless given a valid history code", () => {
  for (const tripCode of [undefined, "V-abcdef012345", "V-ABCDEF01234"]) {
    const markup = boardingTicket({ tripCode });

    assert.match(markup, /Chờ cấp mã chuyến/u);
    assert.doesNotMatch(markup, /V-(?:abcdef012345|ABCDEF01234)/u);
  }
});

test("boarding pass shows no planned break time when the plan has no breaks", () => {
  const markup = boardingTicket({ minutes: 25, breakCount: 0 });

  assert.match(markup, /25 phút/u);
  assert.match(markup, /Không nghỉ/u);
  assert.doesNotMatch(markup, /lượt nghỉ/u);
});

test("boarding pass handles invalid duration and break values without exposing NaN", () => {
  const markup = boardingTicket({ minutes: Number.NaN, breakCount: 2, breakMinutes: Number.NaN });

  assert.doesNotMatch(markup, /NaN|Infinity/u);
  assert.match(markup, /Cần kiểm tra/u);
});

test("journey view uses the map and active 2D scene without exposing a 3D switch", () => {
  const props = {
    journey: undefined,
    carriages: [{ id: "guest", name: "Toa Mây", color: "#398575" }],
    ownId: "guest",
  };
  const mapMarkup = renderToStaticMarkup(React.createElement(JourneyView, props));
  const focusMarkup = renderToStaticMarkup(React.createElement(JourneyView, {
    ...props,
    focusState: "focus",
  }));
  const upcomingRestMarkup = renderToStaticMarkup(React.createElement(JourneyView, {
    ...props,
    focusState: "focus",
    upcomingRestStop: { index: 1, count: 2, remainingSeconds: 12 },
    sessionTiming: tripSceneTiming({ started: 0, target: 180, breakPlan: { count: 2, seconds: 60 } }, 48000),
  }));

  assert.match(mapMarkup, /Bản đồ tiến trình từ trên xuống/u);
  assert.match(focusMarkup, /Cảnh tàu 2D nhìn thẳng từ trên xuống/u);
  const stationX = upcomingRestMarkup.match(/data-station-id="rest-1"[^>]*data-station-screen-x="([^"]+)"/u);
  assert.ok(stationX, "the scheduled rest station reaches the running scene");
  assert.ok(Math.abs(Number(stationX[1]) - 650) < 0.001, "the rest station shares the scenery speed");
  for (const markup of [mapMarkup, focusMarkup]) {
    assert.doesNotMatch(markup, /camera-switch|scene-3d|train-canvas|Cảnh 3D/u);
  }
});

test("journey view forwards total session timing to the active scene", () => {
  const markup = renderToStaticMarkup(React.createElement(JourneyView, {
    journey: undefined,
    carriages: [{ id: "guest", name: "Toa Mây", color: "#398575" }],
    ownId: "guest",
    focusState: "focus",
    sessionTiming: tripSceneTiming({ started: 0, target: 1800 }, 90000),
  }));

  assert.match(markup, /data-session-elapsed="90"/u);
  assert.match(markup, /data-session-remaining="1710"/u);
  assert.match(markup, /data-session-study-elapsed="90"/u);
  assert.match(markup, /data-world-distance="1500"/u);
});
