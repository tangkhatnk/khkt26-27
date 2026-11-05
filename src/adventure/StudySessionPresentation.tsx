import type { ReactNode } from "react";
import { isValidBreakPlan, totalDurationSeconds } from "../../backend/src/adventure/domain.ts";
import { LearningBuddy } from "./LearningPathView";
import type { ActiveTrip } from "./focus";

export function StudyPreparationSummary({
  goal,
  subject,
  minutes,
  breakCount,
  breakMinutes,
  children,
}: {
  goal: string;
  subject: string;
  minutes: number;
  breakCount: number;
  breakMinutes: number;
  children: ReactNode;
}) {
  const validStudyDuration = Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= 240;
  const breakPlan = { count: breakCount, seconds: breakMinutes * 60 };
  const validBreakPlan = breakCount === 0 || (
    validStudyDuration && isValidBreakPlan(breakPlan, minutes * 60)
  );
  const validPlan = validStudyDuration && validBreakPlan;
  const totalMinutes = validPlan
    ? Math.round(totalDurationSeconds(minutes * 60, breakCount > 0 ? breakPlan : undefined) / 60)
    : null;

  return <>
    <section className="study-companion study-preparation-summary" aria-labelledby="study-preparation-summary-title">
      <div className="study-companion__buddy study-preparation-summary__buddy"><LearningBuddy compact /></div>
      <div className="study-companion__content study-preparation-summary__content">
        <h2 id="study-preparation-summary-title" className="study-preparation-summary__title">Tóm tắt buổi học</h2>
        <dl className="study-preparation-summary__details">
          <div className="study-preparation-summary__goal">
            <dt>Mục tiêu</dt>
            <dd>{goal.trim() || "Chưa đặt mục tiêu học tập"}</dd>
          </div>
          <div className="study-preparation-summary__subject">
            <dt>Môn học</dt>
            <dd>{subject.trim() || "Chưa chọn môn học"}</dd>
          </div>
          <div>
            <dt>Tập trung</dt>
            <dd>{validStudyDuration ? `${minutes} phút` : "Cần kiểm tra"}</dd>
          </div>
          <div>
            <dt>Giải lao</dt>
            <dd>{!validBreakPlan
              ? "Cần kiểm tra"
              : breakCount === 0
                ? "Không nghỉ"
                : `${breakCount} lần × ${breakMinutes} phút`}</dd>
          </div>
          <div>
            <dt>Tổng thời lượng</dt>
            <dd>{totalMinutes === null ? "Cần kiểm tra" : `${totalMinutes} phút`}</dd>
          </div>
        </dl>
      </div>
    </section>
    <details className="study-preparation-summary__journey">
      <summary>Chi tiết hành trình</summary>
      {children}
    </details>
  </>;
}

type FocusStudyCompanionProps = {
  state: ActiveTrip["state"];
  resting: boolean;
  focusedSeconds: number;
  targetSeconds: number;
  distractions: number;
};

export function FocusStudyCompanion({
  state,
  resting,
  focusedSeconds,
  targetSeconds,
  distractions,
}: FocusStudyCompanionProps) {
  const focused = Math.max(0, focusedSeconds);
  const target = Math.max(1, targetSeconds);
  const status = resting
    ? "Giải lao"
    : state === "away"
      ? "Bạn đang rời phiên"
      : state === "reconnecting"
        ? "Đang kết nối lại"
        : state === "paused"
          ? "Phiên đang tạm dừng"
          : state === "pending"
            ? "Đang chờ phiên học"
        : "Đang tập trung";

  return (
    <section className="study-companion study-companion--focus" aria-label="Tiến độ phiên học">
      <div className="study-companion__buddy"><LearningBuddy compact /></div>
      <div className="study-companion__content">
        <p className="study-companion__status">{status}</p>
        <div className="study-companion__progress-label">
          <span>{Math.floor(focused / 60)} phút tập trung</span>
          <strong>{Math.min(100, Math.round((focused / target) * 100))}%</strong>
        </div>
        <progress className="study-companion__progress" value={Math.min(focused, target)} max={target} aria-label="Thời gian tập trung" />
        <p className="study-companion__detail">{distractions} lần rời phiên · không tính vào thời gian học</p>
      </div>
    </section>
  );
}

export function SessionSummaryCompanion({
  completed,
  focusedSeconds,
}: {
  completed: boolean;
  focusedSeconds: number;
}) {
  return (
    <section className="study-companion study-companion--summary" aria-label="Kết quả phiên học">
      <div className="study-companion__buddy"><LearningBuddy compact /></div>
      <div className="study-companion__content">
        <p className="study-companion__status">{completed ? "Đã hoàn thành" : "Đã dừng sớm"}</p>
        <p className="study-companion__detail">
          Bạn đã tập trung {Math.floor(Math.max(0, focusedSeconds) / 60)} phút. Phần học được lưu trong lịch sử riêng.
        </p>
      </div>
    </section>
  );
}
