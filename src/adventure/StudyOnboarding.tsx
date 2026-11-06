import { useEffect, useRef } from "react";
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

export function StudyOnboarding({ progress, currentDraft, currentDuration, topics = [], onProgressChange, onGuideControl, onSourceChoice }: {
  progress: StudyOnboardingProgress;
  currentDraft?: StudySurvey;
  currentDuration?: number;
  topics?: readonly Topic[];
  onProgressChange: (progress: StudyOnboardingProgress) => void;
  onGuideControl?: (control: StudyTutorialControl) => boolean | void;
  onSourceChoice?: (choice: StudySourceChoice) => void;
}) {
  const tutorialStepHeading = useRef<HTMLHeadingElement | null>(null);
  const lastGuideLocation = useRef({
    phase: progress.phase,
    step: progress.tutorialStep,
    sourceChoice: progress.tutorial.sourceChoice,
  });
  useEffect(() => {
    const previous = lastGuideLocation.current;
    const moved = previous.phase !== progress.phase || previous.step !== progress.tutorialStep;
    const jumpedToSource = previous.phase === "tutorial" && previous.step === 1 &&
      progress.phase === "tutorial" && progress.tutorialStep === 2 &&
      progress.tutorial.sourceChoice !== null && progress.tutorial.sourceChoice !== "none";
    lastGuideLocation.current = {
      phase: progress.phase,
      step: progress.tutorialStep,
      sourceChoice: progress.tutorial.sourceChoice,
    };
    if (!moved || progress.phase !== "tutorial" || jumpedToSource) return;
    const heading = tutorialStepHeading.current;
    if (!heading) return;
    heading.scrollIntoView({ behavior: "auto", block: "center" });
    heading.focus({ preventScroll: true });
  }, [progress.phase, progress.tutorialStep, progress.tutorial.sourceChoice]);
  const tutorialSurvey = progress.phase === "tutorial" && currentDraft
    ? syncStudySurveyWithCurrentDraft(
        progress.survey,
        currentDraft,
        currentDuration ?? currentDraft.preferredMinutes ?? NaN,
      )
    : progress.survey;
  const dispatch = (action: Parameters<typeof reduceStudyOnboardingProgress>[1]) => {
    const liveProgress = progress.phase === "tutorial"
      ? { ...progress, survey: tutorialSurvey }
      : progress;
    onProgressChange(reduceStudyOnboardingProgress(liveProgress, action));
  };
  const options = topics.length ? topics : FALLBACK_TOPICS;
  const topicLabel = options.find((topic) => topic.id === tutorialSurvey.topicId)?.name ?? tutorialSurvey.topicLabel;
  const surveyChange = (changes: Partial<StudySurvey>) => dispatch({
    type: "survey/change",
    changes: { ...changes, ...(changes.topicId ? {
      topicLabel: options.find((topic) => topic.id === changes.topicId)?.name ?? changes.topicId,
    } : {}) },
  });
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
    <div className="study-onboarding__actions">
      <button className="primary" type="button" onClick={() => dispatch({ type: "onboarding/resume" })}>Tiếp tục hướng dẫn</button>
    </div>
  </section>;

  if (progress.phase === "survey") return <section className="study-onboarding" aria-labelledby="study-onboarding-title">
    <p className="study-onboarding__eyebrow">KHỞI ĐỘNG KHÔNG GIAN HỌC · CÂU {progress.surveyStep + 1}/2</p>
    <h1 id="study-onboarding-title">Bắt đầu từ điều bạn muốn đạt được</h1>
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
    <div className="study-onboarding__actions">
      {progress.surveyStep === 1 && <button type="button" onClick={() => dispatch({ type: "survey/previous" })}>Quay lại</button>}
      <button className="primary" type="button" disabled={!surveyValid(progress.survey, progress.surveyStep)}
        onClick={() => dispatch({ type: "survey/next" })}>
        {progress.surveyStep === 0 ? "Tiếp tục" : "Bắt đầu hướng dẫn"}
      </button>
      <button type="button" className="study-onboarding__quiet-action" onClick={() => dispatch({ type: "onboarding/pause" })}>Tạm dừng</button>
    </div>
  </section>;

  const step = progress.tutorialStep;
  const action = (control: "goal" | "duration", label: string) => <button className="primary" type="button"
    disabled={control === "goal" ? tutorialSurvey.goal.trim().length < 3 : control === "duration" &&
      (currentDuration !== undefined
        ? !Number.isSafeInteger(currentDuration) || currentDuration < 1 || currentDuration > 240
        : progress.survey.preferredMinutes === null || !Number.isSafeInteger(progress.survey.preferredMinutes) ||
          progress.survey.preferredMinutes < 1 || progress.survey.preferredMinutes > 240)}
    onClick={() => {
      if (onGuideControl?.(control) === false) return;
      dispatch({ type: "tutorial/used", control });
    }}>{label}</button>;
  const sourceChoice = (choice: StudySourceChoice, label: string) => <button type="button"
    aria-pressed={progress.tutorial.sourceChoice === choice}
    className={progress.tutorial.sourceChoice === choice ? "selected" : ""}
    onClick={() => { onSourceChoice?.(choice); dispatch({ type: "tutorial/used", control: "source", choice }); }}>{label}</button>;

  return <section className="study-onboarding" aria-labelledby="study-onboarding-title">
    <p className="study-onboarding__eyebrow">HƯỚNG DẪN · BƯỚC {step + 1}/4</p>
    <h1 id="study-onboarding-title">Thử các thao tác chính</h1>
    <p className="study-onboarding__intro">Không có đồng hồ hay nội dung nào được gửi đi trong hướng dẫn này.</p>
    <ProgressTrail label="Tiến trình hướng dẫn" currentStep={step} steps={["Mục tiêu", "Nội dung", "Thời lượng", "Tự kiểm tra"]} />
    {step === 0 && <div className="study-onboarding__step">
      <h2 ref={tutorialStepHeading} id="study-onboarding-step-heading" tabIndex={-1}>1. Xem hoặc sửa mục tiêu trong không gian học bên dưới</h2>
      <p>Ô mục tiêu nằm ở cột thiết lập. Bạn có thể sửa nội dung, nhưng chưa bắt đầu phiên học.</p>
      <button type="button" onClick={() => onGuideControl?.("goal")}>Đi tới ô mục tiêu</button>
      {action("goal", "Đã xem mục tiêu")}
    </div>}
    {step === 1 && <div className="study-onboarding__step">
      <h2 ref={tutorialStepHeading} id="study-onboarding-step-heading" tabIndex={-1}>2. Chọn cách bắt đầu với nội dung</h2>
      <p>Bạn có thể ghi chú, chọn tài liệu từ thiết bị ở không gian học, hoặc học trước rồi bổ sung sau.</p>
      <div className="study-onboarding__choices" role="group" aria-label="Chọn cách chuẩn bị nội dung">
        {sourceChoice("notes", "Ghi nội dung")}
        {sourceChoice("files", "Chọn tệp sau")}
        {sourceChoice("none", "Hiện chưa có tài liệu")}
      </div>
    </div>}
    {step === 2 && <div className="study-onboarding__step">
      <h2 ref={tutorialStepHeading} id="study-onboarding-step-heading" tabIndex={-1}>3. Điều chỉnh thời lượng</h2>
      <p>Chọn thanh trượt hoặc ô nhập phút trong cột thiết lập bên dưới; có thể chọn từ 1 đến 240 phút. Chưa có phiên học nào bắt đầu.</p>
      <button type="button" onClick={() => onGuideControl?.("duration")}>Đi tới thời lượng</button>
      {action("duration", "Đã chọn thời lượng")}
    </div>}
    {step === 3 && <div className="study-onboarding__step">
      <h2 ref={tutorialStepHeading} id="study-onboarding-step-heading" tabIndex={-1}>4. Tự kiểm tra sau khi tập trung</h2>
      <p>Chọn số câu hỏi hoặc bật/tắt chuẩn bị Quiz AI trong cột thiết lập. Khi bạn đổi một lựa chọn, hướng dẫn hoàn tất; trong lúc hướng dẫn chưa có yêu cầu AI nào được gửi.</p>
      <button type="button" onClick={() => onGuideControl?.("retrieval")}>Đi tới lựa chọn ôn tập</button>
    </div>}
    <div className="study-onboarding__actions">
      <button type="button" onClick={() => dispatch({ type: "tutorial/previous" })}>{step === 0 ? "Sửa khảo sát" : "Quay lại"}</button>
      <button type="button" className="study-onboarding__quiet-action" onClick={() => dispatch({ type: "onboarding/pause" })}>Tạm dừng</button>
    </div>
    <p className="study-onboarding__selected">Mục tiêu: {tutorialSurvey.goal} · {topicLabel} · {tutorialSurvey.preferredMinutes} phút</p>
  </section>;
}
