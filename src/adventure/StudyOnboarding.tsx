import { useEffect, useRef, useState, type ReactNode } from "react";
import { DurationPicker } from "./DurationPicker";
import {
  reduceStudyOnboardingProgress,
  type StudyOnboardingProgress,
  type StudySourceChoice,
  type StudySurvey,
  type StudyTutorialControl,
  syncStudySurveyWithCurrentDraft,
} from "./studyOnboardingModel.ts";
import "./studyOnboarding.css";

type Topic = { id: string; name: string };

type StudyOnboardingAction = Parameters<typeof reduceStudyOnboardingProgress>[1];

type OnboardingCommitResult =
  | { status: "unchanged"; progress: StudyOnboardingProgress }
  | { status: "rejected"; progress: StudyOnboardingProgress }
  | { status: "failed"; progress: StudyOnboardingProgress }
  | { status: "saved"; progress: StudyOnboardingProgress };

type OnboardingCommitOptions = {
  beforeSave?: () => boolean | void;
  afterSave?: () => void;
};

export function commitStudyOnboardingAction(
  progress: StudyOnboardingProgress,
  action: StudyOnboardingAction,
  onProgressChange: (progress: StudyOnboardingProgress) => boolean | void,
  options: OnboardingCommitOptions = {},
): OnboardingCommitResult {
  const nextProgress = reduceStudyOnboardingProgress(progress, action);
  if (nextProgress === progress) return { status: "unchanged", progress };
  if (options.beforeSave?.() === false) return { status: "rejected", progress };
  if (onProgressChange(nextProgress) === false) return { status: "failed", progress };
  options.afterSave?.();
  return { status: "saved", progress: nextProgress };
}

const FALLBACK_TOPICS: Topic[] = [
  { id: "biology", name: "Sinh học" },
  { id: "chemistry", name: "Hóa học" },
  { id: "physics", name: "Vật lý" },
  { id: "math", name: "Toán học" },
  { id: "english", name: "Tiếng Anh" },
  { id: "literature", name: "Ngữ văn" },
  { id: "history", name: "Lịch sử" },
  { id: "geography", name: "Địa lý" },
  { id: "other", name: "Môn khác" },
];

function ProgressTrail({ label, steps, currentStep }: {
  label: string;
  steps: readonly string[];
  currentStep: number;
}) {
  return <ol className="study-onboarding__progress" aria-label={label}>
    {steps.map((step, index) => <li key={step} aria-current={index === currentStep ? "step" : undefined}
      data-complete={index < currentStep ? "true" : undefined}>
      <span aria-hidden="true">{index + 1}</span>
      <span>{step}</span>
    </li>)}
  </ol>;
}

function surveyValid(survey: StudySurvey, step: 0 | 1): boolean {
  if (step === 0) return survey.goal.trim().length >= 3 && !!survey.topicId && !!survey.topicLabel;
  return survey.preferredMinutes !== null && Number.isSafeInteger(survey.preferredMinutes) &&
    survey.preferredMinutes >= 1 && survey.preferredMinutes <= 240;
}

export function StudyOnboarding({ progress, currentDraft, currentDuration, topics = [], goalControl, durationControl, retrievalControl, onProgressChange, onGuideControl, onSourceChoice }: {
  progress: StudyOnboardingProgress;
  currentDraft?: StudySurvey;
  currentDuration?: number;
  topics?: readonly Topic[];
  goalControl?: ReactNode;
  durationControl?: ReactNode;
  retrievalControl?: ReactNode;
  onProgressChange: (progress: StudyOnboardingProgress) => boolean | void;
  onGuideControl?: (control: StudyTutorialControl) => boolean | void;
  onSourceChoice?: (choice: StudySourceChoice) => void;
}) {
  const [feedback, setFeedback] = useState("");
  const tutorialStepHeading = useRef<HTMLHeadingElement | null>(null);
  const lastGuideLocation = useRef({
    phase: progress.phase,
    step: progress.tutorialStep,
  });
  useEffect(() => {
    const previous = lastGuideLocation.current;
    const moved = previous.phase !== progress.phase || previous.step !== progress.tutorialStep;
    lastGuideLocation.current = {
      phase: progress.phase,
      step: progress.tutorialStep,
    };
    if (!moved || progress.phase !== "tutorial") return;
    const heading = tutorialStepHeading.current;
    if (!heading) return;
    heading.scrollIntoView({ behavior: "auto", block: "center" });
    heading.focus({ preventScroll: true });
  }, [progress.phase, progress.tutorialStep]);
  const tutorialSurvey = progress.phase === "tutorial" && currentDraft
    ? syncStudySurveyWithCurrentDraft(
        progress.survey,
        currentDraft,
        currentDuration ?? currentDraft.preferredMinutes ?? NaN,
      )
    : progress.survey;
  const dispatch = (action: StudyOnboardingAction, options?: OnboardingCommitOptions): boolean => {
    const liveProgress = progress.phase === "tutorial"
      ? { ...progress, survey: tutorialSurvey }
      : progress;
    const result = commitStudyOnboardingAction(liveProgress, action, onProgressChange, options);
    if (result.status === "unchanged") return false;
    if (result.status === "rejected") {
      setFeedback("Kiểm tra lựa chọn trong ô bên cạnh rồi thử tiếp tục lại.");
      return false;
    }
    if (result.status === "failed") {
      setFeedback("Không lưu được bước hướng dẫn trên thiết bị. Bạn vẫn ở màn hình này; hãy thử lại.");
      return false;
    }
    setFeedback("");
    return true;
  };
  const options = topics.length ? topics : FALLBACK_TOPICS;
  const surveyChange = (changes: Partial<StudySurvey>) => dispatch({
    type: "survey/change",
    changes: { ...changes, ...(changes.topicId ? {
      topicLabel: options.find((topic) => topic.id === changes.topicId)?.name ?? changes.topicId,
    } : {}) },
  });
  const topicLabel = options.find((topic) => topic.id === tutorialSurvey.topicId)?.name ?? tutorialSurvey.topicLabel;
  const renderGoalAndTopic = (disabled: boolean) => <div className="study-onboarding__fields">
    <label htmlFor="onboarding-goal">Mục tiêu buổi học
      <textarea id="onboarding-goal" value={progress.survey.goal} maxLength={500} rows={3} disabled={disabled}
        onChange={(event) => surveyChange({ goal: event.target.value })}
        placeholder="Ví dụ: Giải thích được cách tế bào trao đổi chất." />
    </label>
    <label htmlFor="onboarding-topic">Môn học hoặc chủ đề
      <select id="onboarding-topic" value={progress.survey.topicId} disabled={disabled}
        onChange={(event) => surveyChange({ topicId: event.target.value })}>
        {options.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
      </select>
    </label>
  </div>;
  const renderDuration = (disabled: boolean) => <DurationPicker
    value={progress.survey.preferredMinutes ?? NaN}
    onChange={(preferredMinutes) => surveyChange({ preferredMinutes: Number.isFinite(preferredMinutes) ? preferredMinutes : null })}
    durationLocked={disabled}
  />;

  if (progress.phase === "paused") return <section className="study-onboarding" aria-labelledby="study-onboarding-title">
    <p className="study-onboarding__eyebrow">KHỞI ĐỘNG KHÔNG GIAN HỌC</p>
    <h1 id="study-onboarding-title">Hướng dẫn đang tạm dừng</h1>
    <p>Câu trả lời và bước hiện tại đã được lưu trên thiết bị này.</p>
    {feedback && <p className="study-onboarding__feedback" role="status" aria-live="polite">{feedback}</p>}
    <div className="study-onboarding__actions">
      <button className="primary" type="button" onClick={() => dispatch({ type: "onboarding/resume" })}>Tiếp tục hướng dẫn</button>
      <button type="button" className="study-onboarding__quiet-action" onClick={() => dispatch({ type: "onboarding/skip" })}>
        {progress.pausedFrom === "survey" ? "Bỏ qua khảo sát, học ngay" : "Bỏ qua hướng dẫn, học ngay"}
      </button>
    </div>
  </section>;

  if (progress.phase === "skipped" || progress.phase === "complete") return null;

  if (progress.phase === "survey") return <section className="study-onboarding" aria-labelledby="study-onboarding-title">
    <p className="study-onboarding__eyebrow">KHỞI ĐỘNG KHÔNG GIAN HỌC · CÂU {progress.surveyStep + 1}/2</p>
    <h1 id="study-onboarding-title">
      {progress.surveyStep === 0 ? "Bắt đầu từ điều bạn muốn đạt được" : "Chọn thời lượng cho buổi học"}
    </h1>
    <p className="study-onboarding__intro">Thông tin này điền vào buổi học của bạn. Bạn có thể sửa lại bất cứ lúc nào.</p>
    <ProgressTrail label="Tiến trình khảo sát" currentStep={progress.surveyStep} steps={["Mục tiêu", "Thời lượng"]} />
    {progress.surveyStep === 0 ? renderGoalAndTopic(false) : <div className="study-onboarding__fields">
      <div>
        <h2>Thời lượng mỗi buổi</h2>
        {renderDuration(false)}
      </div>
      <label htmlFor="onboarding-level">Cấp học hoặc cách bạn muốn ghi
        <input id="onboarding-level" value={progress.survey.level} maxLength={100}
          onChange={(event) => surveyChange({ level: event.target.value })}
          placeholder="Không bắt buộc · ví dụ: Lớp 9, tự học" />
      </label>
      <label htmlFor="onboarding-confidence">Bạn thấy mình đang ở mức nào?
        <select id="onboarding-confidence" value={progress.survey.confidence ?? ""}
          onChange={(event) => surveyChange({ confidence: event.target.value ? Number(event.target.value) : null })}>
          <option value="">Bỏ qua câu hỏi này</option>
          <option value="1">Mới bắt đầu</option>
          <option value="2">Đang làm quen</option>
          <option value="3">Khá vững</option>
          <option value="4">Muốn thử nâng cao</option>
        </select>
      </label>
      <p className="study-onboarding__privacy">Cấp/lớp chỉ gửi khi bạn chủ động yêu cầu AI lập kế hoạch. Mức tự tin chỉ được giữ trên thiết bị và không gửi đi.</p>
    </div>}
    {!surveyValid(progress.survey, progress.surveyStep) && <p className="study-onboarding__validation-hint" role="status">
      {progress.surveyStep === 0
        ? "Nhập mục tiêu ít nhất 3 ký tự và chọn môn học để tiếp tục."
        : "Chọn số phút nguyên từ 1 đến 240 để tiếp tục."}
    </p>}
    {feedback && <p className="study-onboarding__feedback" role="status" aria-live="polite">{feedback}</p>}
    <div className="study-onboarding__actions">
      {progress.surveyStep === 1 && <button type="button" onClick={() => dispatch({ type: "survey/previous" })}>Quay lại</button>}
      <button className="primary" type="button" disabled={!surveyValid(progress.survey, progress.surveyStep)}
        onClick={() => dispatch({ type: "survey/next" })}>
        {progress.surveyStep === 0 ? "Tiếp tục" : "Bắt đầu hướng dẫn"}
      </button>
      <button type="button" className="study-onboarding__quiet-action" onClick={() => dispatch({ type: "onboarding/skip" })}>
        Bỏ qua khảo sát, học ngay
      </button>
    </div>
  </section>;

  const step = progress.tutorialStep;
  const hasControl = (control: StudyTutorialControl) => control === "goal"
    ? goalControl !== null && goalControl !== undefined && goalControl !== false
    : control === "duration"
      ? durationControl !== null && durationControl !== undefined && durationControl !== false
      : control === "retrieval"
        ? retrievalControl !== null && retrievalControl !== undefined && retrievalControl !== false
        : true;
  const controlSpotlight = (control: "goal" | "duration" | "retrieval", label: string, content: ReactNode) =>
    <div className="study-onboarding__control-spotlight" role="group" aria-label={label}>
      <span className="study-onboarding__guide-arrow" aria-hidden="true" />
      <div className="study-onboarding__control-slot">
        {hasControl(control) ? content : <p role="status">Điều khiển này chưa sẵn sàng. Bạn có thể quay lại hoặc bắt đầu học ngay.</p>}
      </div>
    </div>;
  const action = (control: "goal" | "duration" | "retrieval", label: string) => <button className="primary" type="button"
    aria-label={`Tiếp tục: ${label}`}
    disabled={!hasControl(control) || (control === "goal" ? tutorialSurvey.goal.trim().length < 3 : control === "duration" &&
      (currentDuration !== undefined
        ? !Number.isSafeInteger(currentDuration) || currentDuration < 1 || currentDuration > 240
        : progress.survey.preferredMinutes === null || !Number.isSafeInteger(progress.survey.preferredMinutes) ||
          progress.survey.preferredMinutes < 1 || progress.survey.preferredMinutes > 240))}
    onClick={() => {
      dispatch({ type: "tutorial/used", control }, {
        beforeSave: () => onGuideControl?.(control),
      });
    }}>{label}</button>;
  const sourceChoice = (choice: StudySourceChoice, label: string) => <button type="button"
    aria-label={`Tiếp tục với lựa chọn: ${label}`}
    aria-pressed={progress.tutorial.sourceChoice === choice}
    className={progress.tutorial.sourceChoice === choice ? "selected" : ""}
    onClick={() => dispatch({ type: "tutorial/used", control: "source", choice }, {
      afterSave: () => onSourceChoice?.(choice),
    })}>{label}</button>;
  const continueAction = step === 0
    ? action("goal", "Đã xem mục tiêu")
    : step === 2
      ? action("duration", "Đã chọn thời lượng")
      : step === 3
        ? action("retrieval", "Tiếp tục sau khi chọn ôn tập")
        : null;

  return <section className="study-onboarding" aria-labelledby="study-onboarding-step-heading">
    <p className="study-onboarding__eyebrow">HƯỚNG DẪN · BƯỚC {step + 1}/4</p>
    <h1 ref={tutorialStepHeading} id="study-onboarding-step-heading" tabIndex={-1}>
      {["1. Xem hoặc sửa mục tiêu", "2. Chọn cách bắt đầu với nội dung", "3. Điều chỉnh thời lượng", "4. Tự kiểm tra sau khi tập trung"][step]}
    </h1>
    <p className="study-onboarding__intro">Hướng dẫn không tự gửi yêu cầu AI. Bạn vẫn có thể chủ động dùng tính năng AI; từng tính năng sẽ nêu rõ nội dung cần gửi và điều kiện sử dụng.</p>
    <ProgressTrail label="Tiến trình hướng dẫn" currentStep={step} steps={["Mục tiêu", "Nội dung", "Thời lượng", "Tự kiểm tra"]} />
    <div className="study-onboarding__step" key={step}>
    {step === 0 && <>
      {controlSpotlight("goal", "Mục tiêu buổi học", goalControl)}
    </>}
    {step === 1 && <>
      <p>Bạn có thể ghi chú, chọn tài liệu từ thiết bị, hoặc chọn chưa có tài liệu.</p>
      <div className="study-onboarding__control-spotlight">
        <span className="study-onboarding__guide-arrow" aria-hidden="true" />
        <div className="study-onboarding__choices" role="group" aria-label="Chọn cách chuẩn bị nội dung">
          {sourceChoice("notes", "Ghi nội dung")}
          {sourceChoice("files", "Chọn tệp sau")}
          {sourceChoice("none", "Hiện chưa có tài liệu")}
        </div>
      </div>
    </>}
    {step === 2 && <>
      <p>Đi tới thời lượng phù hợp bằng bộ điều khiển ngay tại đây, từ 1 đến 240 phút.</p>
      {controlSpotlight("duration", "Thời lượng buổi học", durationControl)}
    </>}
    {step === 3 && <>
      <p>Chọn số câu hỏi hoặc tùy chọn Quiz AI ngay tại đây. Hướng dẫn không tự gửi yêu cầu; thao tác AI chỉ chạy khi bạn chủ động chọn.</p>
      {controlSpotlight("retrieval", "Tự kiểm tra sau buổi học", retrievalControl)}
    </>}
    </div>
    {feedback && <p className="study-onboarding__feedback" role="status" aria-live="polite">{feedback}</p>}
    <div className="study-onboarding__actions">
      <button type="button" onClick={() => dispatch({ type: "tutorial/previous" })}>{step === 0 ? "Sửa khảo sát" : "Quay lại"}</button>
      {continueAction}
      <button type="button" className="study-onboarding__quiet-action" onClick={() => dispatch({ type: "onboarding/skip" })}>
        Bỏ qua hướng dẫn, học ngay
      </button>
    </div>
    <p className="study-onboarding__selected">Mục tiêu: {tutorialSurvey.goal} · {topicLabel} · {tutorialSurvey.preferredMinutes} phút</p>
  </section>;
}
