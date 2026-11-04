import { LearningBuddy } from "./LearningPathView";
import type { ActiveTrip } from "./focus";

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
