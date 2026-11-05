import type { ReactNode } from "react";
import type { SavedStudyPlan } from "./studyPlanStorage.ts";
import { isValidStudyMinutes } from "./quickTripDraft.ts";
import "./studyPlanWorkspace.css";

export type StudyPlanWorkspaceStatus = "idle" | "pending" | "ready" | "error" | "cancelled";

export function StudyPlanWorkspace({
  goal,
  subject,
  preferredMinutes,
  breakCount,
  breakMinutes,
  plan,
  planStatus = "idle",
  planError,
  planActionReason,
  onGeneratePlan,
  onCancelPlan,
  onSelectStep,
  sourceAvailable = false,
  sourceReviewed = false,
  includeSource = false,
  onIncludeSourceChange,
  children,
  legacyDetails,
}: {
  goal: string;
  subject: string;
  preferredMinutes: number;
  breakCount: number;
  breakMinutes: number;
  plan?: SavedStudyPlan;
  planStatus?: StudyPlanWorkspaceStatus;
  planError?: string;
  planActionReason?: string;
  onGeneratePlan?: () => void;
  onCancelPlan?: () => void;
  onSelectStep?: (stepId: string) => void;
  sourceAvailable?: boolean;
  sourceReviewed?: boolean;
  includeSource?: boolean;
  onIncludeSourceChange?: (include: boolean) => void;
  children?: ReactNode;
  legacyDetails?: ReactNode;
}) {
  const durationValid = isValidStudyMinutes(preferredMinutes);
  const totalMinutes = durationValid && Number.isSafeInteger(breakCount) && breakCount >= 0 &&
    Number.isSafeInteger(breakMinutes) && breakMinutes >= 1
    ? preferredMinutes + breakCount * breakMinutes
    : null;
  return <section className="study-plan-workspace" aria-labelledby="study-plan-workspace-title">
    <header className="study-plan-workspace__summary">
      <div className="study-plan-workspace__goal">
        <p className="study-plan-workspace__eyebrow">BUỔI HỌC THEO MỤC TIÊU</p>
        <h1 id="study-plan-workspace-title">{goal.trim() || "Bạn muốn đạt điều gì?"}</h1>
        <p className="study-plan-workspace__subject">{subject}</p>
      </div>
      <dl className="study-plan-workspace__timing">
        <div><dt>Môn học</dt><dd>{subject}</dd></div>
        <div><dt>Thời lượng học</dt><dd>{durationValid ? `${preferredMinutes} phút` : "Chưa hợp lệ"}</dd></div>
        <div><dt>Giải lao</dt><dd>{breakCount > 0 ? `${breakCount} lượt × ${breakMinutes} phút` : "Không có"}</dd></div>
        <div><dt>Tổng thời gian</dt><dd>{totalMinutes === null ? "Chưa xác định" : `${totalMinutes} phút`}</dd></div>
      </dl>
    </header>

    <section className="study-plan-workspace__plan" aria-labelledby="study-plan-workspace-plan-title">
      <div className="study-plan-workspace__plan-heading">
        <div>
          <p className="study-plan-workspace__eyebrow">LỘ TRÌNH CÁ NHÂN</p>
          <h2 id="study-plan-workspace-plan-title">{plan?.title ?? "Chọn bước học của bạn"}</h2>
        </div>
        {plan?.origin === "ai" && <span className="study-plan-workspace__draft-label">Đề xuất AI · chưa xác minh</span>}
        {plan?.origin === "manual" && <span className="study-plan-workspace__draft-label">Kế hoạch của bạn</span>}
      </div>
      {plan?.steps.length ? <ol className="study-plan-workspace__steps">
        {plan.steps.map((step, index) => <li key={step.id} aria-current={step.id === plan.selectedStepId ? "step" : undefined}>
          {onSelectStep
            ? <button type="button" className="study-plan-workspace__step-select"
                aria-current={step.id === plan.selectedStepId ? "step" : undefined}
                onClick={() => onSelectStep(step.id)}>
                <span className="study-plan-workspace__step-number">{index + 1}</span>
                <span className="study-plan-workspace__step-copy">
                  <strong>{step.title}</strong>
                  <span><b>Hành động:</b> {step.action}</span>
                  <span><b>Kết quả:</b> {step.outcome}</span>
                  <span><b>Tự kiểm tra:</b> {step.check}</span>
                </span>
              </button>
            : <div className="study-plan-workspace__step-select">
                <span className="study-plan-workspace__step-number">{index + 1}</span>
                <span className="study-plan-workspace__step-copy">
                  <strong>{step.title}</strong>
                  <span><b>Hành động:</b> {step.action}</span>
                  <span><b>Kết quả:</b> {step.outcome}</span>
                  <span><b>Tự kiểm tra:</b> {step.check}</span>
                </span>
              </div>}
        </li>)}
      </ol> : <p className="study-plan-workspace__empty-plan">Bắt đầu với nội dung của bạn; có thể nhờ AI chia mục tiêu thành các bước rồi xem lại trước khi dùng.</p>}
      {planStatus === "pending" && <p role="status" className="study-plan-workspace__status">Đang tạo bản nháp lộ trình…</p>}
      {planStatus === "error" && planError && <p role="alert" className="study-plan-workspace__error">{planError}</p>}
      {planStatus === "cancelled" && <p role="status" className="study-plan-workspace__status">Đã hủy yêu cầu lập kế hoạch.</p>}
      {sourceAvailable && onIncludeSourceChange && <label className="study-plan-workspace__source-consent">
        <input type="checkbox" checked={includeSource} disabled={!sourceReviewed || planStatus === "pending"}
          onChange={(event) => onIncludeSourceChange(event.target.checked)} />
        <span>Gửi nội dung đã kiểm tra cùng mục tiêu cho AI lập kế hoạch. Chỉ gửi khi chọn ô này.</span>
      </label>}
      {planActionReason && <p className="study-plan-workspace__reason">{planActionReason}</p>}
      {planStatus === "pending" && onCancelPlan && <button className="study-plan-workspace__cancel" type="button" onClick={onCancelPlan}>Hủy yêu cầu</button>}
      {onGeneratePlan && <button className="study-plan-workspace__generate" type="button"
        disabled={planStatus === "pending" || goal.trim().length < 3 || !durationValid || Boolean(planActionReason)}
        onClick={onGeneratePlan}>
        {planStatus === "pending" ? "Đang chia mục tiêu…" : plan ? "Tạo lại bản nháp AI" : "Nhờ AI chia mục tiêu thành các bước"}
      </button>}
    </section>

    <div className="study-plan-workspace__content">{children}</div>
    {legacyDetails && <details className="study-plan-workspace__legacy">
      <summary>Chi tiết hành trình cũ</summary>
      {legacyDetails}
    </details>}
  </section>;
}
