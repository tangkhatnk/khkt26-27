import { useEffect, useState } from "react";
import { API_URL, request } from "../services/api";
import type { DeviceCategory, SessionCorrectionFlags } from "../../backend/src/adventure/domain";
import { studyTopics } from "./topics";
import "./experimentResults.css";

export type ExperimentRun = {
  id: string;
  tripCode: string;
  testerCode: string;
  goalSummary: string;
  topic: string;
  targetSeconds: number;
  elapsedSeconds: number;
  focusedSeconds: number;
  distractions: number;
  breakSeconds: number | null;
  plannedBreakSeconds: number | null;
  plannedBreakCount: number | null;
  studyElapsedSeconds: number | null;
  deviceCategory: DeviceCategory | null;
  completed: boolean;
  quizScore: number | null;
  quizTotal: number | null;
  correctionFlags: SessionCorrectionFlags;
  startedAt: string;
  endedAt: string;
};
type Results = { runs: ExperimentRun[]; total: number; limit: number; offset: number };

export function formatExperimentDuration(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours} giờ`);
  if (minutes) parts.push(`${minutes} phút`);
  if (remainder || parts.length === 0) parts.push(`${remainder} giây`);
  return parts.join(" ");
}

export function experimentStudySeconds(run: ExperimentRun): number {
  return run.studyElapsedSeconds ?? Math.max(0, run.elapsedSeconds - (run.breakSeconds ?? 0));
}

export function experimentEfficiencyPercent(run: ExperimentRun): number | null {
  const denominator = run.studyElapsedSeconds;
  if (!Number.isFinite(denominator) || denominator === null || denominator <= 0 ||
      !Number.isFinite(run.focusedSeconds) || run.focusedSeconds < 0) return null;
  return Math.round(run.focusedSeconds / denominator * 100);
}

function compactDateTime(value: string, options: Intl.DateTimeFormatOptions): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Không rõ";
  try {
    return new Intl.DateTimeFormat("vi-VN", options).format(date);
  } catch {
    return "Không rõ";
  }
}

const deviceLabels: Record<DeviceCategory, string> = {
  pc: "PC", ios: "iOS", android: "Android", tablet: "iPad/Tablet",
  unknown: "Không xác định",
};
const deviceLabel = (category: ExperimentRun["deviceCategory"]) =>
  category == null ? "Chưa ghi nhận" : deviceLabels[category];

function topicLabel(topic: string): string {
  return studyTopics.find((item) => item.id === topic)?.name ?? topic;
}

function QuizBadge({ run }: { run: ExperimentRun }) {
  const scored = run.quizTotal !== null && run.quizScore !== null;
  return <span className={`experiment-quiz-badge ${scored ? "experiment-quiz-badge--scored" : "experiment-quiz-badge--pending"}`}>
    {scored ? `${run.quizScore}/${run.quizTotal} điểm` : "Chưa làm"}
  </span>;
}

const publicCorrectionFields: (keyof ExperimentRun["correctionFlags"])[] = [
  "goal", "topic", "targetSeconds", "elapsedSeconds", "actualStudySeconds", "focusedSeconds",
  "actualBreakSeconds", "distractions", "quizResult",
];

export function experimentRunHasCorrections(flags: ExperimentRun["correctionFlags"] | undefined) {
  return Boolean(flags && publicCorrectionFields.some((field) => flags[field] === true));
}

function CorrectionBadge({ run }: { run: ExperimentRun }) {
  if (!experimentRunHasCorrections(run.correctionFlags)) return null;
  return <span className="experiment-correction-badge" aria-label="Phiên có chỉ số đã hiệu chỉnh">Đã hiệu chỉnh</span>;
}

function GoalSummary({ run }: { run: ExperimentRun }) {
  return <div className="experiment-goal-summary">
    <span>{run.goalSummary || "Không ghi mục tiêu"}</span>
  </div>;
}

function RunDetails({ run }: { run: ExperimentRun }) {
  const fullTimestampOptions: Intl.DateTimeFormatOptions = {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  };
  const startedDate = compactDateTime(run.startedAt, fullTimestampOptions);
  const endedDate = compactDateTime(run.endedAt, fullTimestampOptions);
  return <details className="experiment-details">
    <summary>Chi tiết</summary>
    <dl>
      <div><dt>ID chuyến ẩn danh</dt><dd><code>{run.id}</code></dd></div>
      <div><dt>Mã người thử</dt><dd><code>{run.testerCode}</code></dd></div>
      <div><dt>Tóm tắt mục tiêu</dt><dd>{run.goalSummary || "Không ghi mục tiêu"}</dd></div>
      <div><dt>Thiết bị</dt><dd>{deviceLabel(run.deviceCategory)}</dd></div>
      <div><dt>Bắt đầu (giờ địa phương của bạn)</dt><dd><time dateTime={run.startedAt}>{startedDate}</time></dd></div>
      <div><dt>Kết thúc (giờ địa phương của bạn)</dt><dd><time dateTime={run.endedAt}>{endedDate}</time></dd></div>
      <div><dt>Mục tiêu thời gian</dt><dd>{formatExperimentDuration(run.targetSeconds)}</dd></div>
      <div><dt>Thời lượng chuyến</dt><dd>{formatExperimentDuration(run.elapsedSeconds)}</dd></div>
      <div><dt>Khoảng học đã diễn ra (không tính nghỉ)</dt><dd>{run.studyElapsedSeconds == null
        ? "Chưa ghi nhận khoảng học đã diễn ra"
        : formatExperimentDuration(run.studyElapsedSeconds)}</dd></div>
      <div><dt>Thời gian thực học</dt><dd>{formatExperimentDuration(run.focusedSeconds)}</dd></div>
      {run.correctionFlags?.elapsedSeconds && <div><dt>Ghi chú thời gian</dt><dd>Mốc bắt đầu và kết thúc là dữ kiện đo ban đầu; thời lượng chuyến đã được hiệu chỉnh.</dd></div>}
      <div><dt>Xao nhãng</dt><dd>{run.distractions} lần</dd></div>
      <div><dt>Giải lao thực tế</dt><dd>{run.breakSeconds == null ? "Chưa có thời gian giải lao" : formatExperimentDuration(run.breakSeconds)}</dd></div>
      <div><dt>Giải lao dự kiến</dt><dd>{run.plannedBreakSeconds == null ? "Không ghi nhận lịch nghỉ" : formatExperimentDuration(run.plannedBreakSeconds)}</dd></div>
    </dl>
  </details>;
}

function JourneyTime({ run }: { run: ExperimentRun }) {
  return <div className="experiment-time-summary">
    <strong>{formatExperimentDuration(run.focusedSeconds)}</strong>
    <span className="experiment-run-card__meta">Mục tiêu: {formatExperimentDuration(run.targetSeconds)} · {run.plannedBreakCount == null
      ? "Chưa ghi nhận lượt nghỉ"
      : `${run.plannedBreakCount} lượt nghỉ`}</span>
  </div>;
}

function EfficiencySummary({ run }: { run: ExperimentRun }) {
  const efficiency = experimentEfficiencyPercent(run);
  return <div className="experiment-efficiency-summary">
    <strong>{efficiency === null ? "Chưa có dữ liệu hiệu suất" : `${efficiency}%`}</strong>
  </div>;
}

export function ExperimentRunList({ runs }: { runs: readonly ExperimentRun[] }) {
  return <>
    <div className="experiment-table-wrap" tabIndex={0} aria-label="Bảng lịch sử chuyến đi; cuộn ngang để xem thêm">
      <table className="experiment-table">
      <caption>Lịch sử các phiên học đã lưu</caption>
        <thead><tr>
          <th scope="col">Mã chuyến</th>
          <th scope="col">Khởi hành</th>
          <th scope="col">Chủ đề</th>
          <th scope="col">Thời gian học</th>
          <th scope="col">Hiệu suất</th>
          <th scope="col">Tóm tắt mục tiêu</th>
          <th scope="col">Quiz</th>
        </tr></thead>
        <tbody>{runs.map((run) => <tr key={run.id}>
          <td className="experiment-code-cell">
            <code className="experiment-trip-code">{run.tripCode}</code>
            <RunDetails run={run} />
          </td>
          <td className="experiment-started-cell">
            <time dateTime={run.startedAt}>
              <span>{compactDateTime(run.startedAt, { day: "2-digit", month: "2-digit", year: "numeric" })}</span>
              <small>{compactDateTime(run.startedAt, { hour: "2-digit", minute: "2-digit" })}</small>
            </time>
          </td>
          <td className="experiment-topic"><strong>{topicLabel(run.topic)}</strong><CorrectionBadge run={run} /></td>
          <td><JourneyTime run={run} /></td>
          <td><EfficiencySummary run={run} /></td>
          <td><GoalSummary run={run} /></td>
          <td><QuizBadge run={run} /></td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="experiment-run-cards" aria-label="Lịch sử chuyến đã lưu">
      {runs.map((run) => <article className="experiment-run-card" key={run.id}>
        <header className="experiment-run-card__header">
          <div><span className="experiment-run-card__meta">Mã chuyến</span><code className="experiment-trip-code">{run.tripCode}</code></div>
          <time dateTime={run.startedAt}>
            {compactDateTime(run.startedAt, { day: "2-digit", month: "2-digit", year: "numeric" })}
            <small>{compactDateTime(run.startedAt, { hour: "2-digit", minute: "2-digit" })}</small>
          </time>
        </header>
        <h3>{topicLabel(run.topic)}</h3>
        <CorrectionBadge run={run} />
        <div className="experiment-run-card__metrics">
          <div><span className="experiment-run-card__metric-label">Thời gian học</span><JourneyTime run={run} /></div>
          <div><span className="experiment-run-card__metric-label">Hiệu suất</span><EfficiencySummary run={run} /></div>
          <div><span className="experiment-run-card__metric-label">Tóm tắt mục tiêu</span><GoalSummary run={run} /></div>
          <div><span className="experiment-run-card__metric-label">Quiz</span><QuizBadge run={run} /></div>
        </div>
        <RunDetails run={run} />
      </article>)}
    </div>
  </>;
}

export function ExperimentResults() {
  const [data, setData] = useState<Results | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    request<Results>(`/experiments?limit=50&offset=${offset}`, {}, false).then((value) => {
      if (!cancelled) { setData(value); setError(""); }
    }).catch((error: unknown) => {
      if (!cancelled) setError(error instanceof Error ? error.message : "Không tải được lịch sử.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [offset, revision]);
  useEffect(() => {
    const refreshIfVisible = () => { if (!document.hidden) setRevision((value) => value + 1); };
    const interval = setInterval(refreshIfVisible, 30000);
    window.addEventListener("online", refreshIfVisible);
    return () => { clearInterval(interval); window.removeEventListener("online", refreshIfVisible); };
  }, []);
  const refresh = () => { setLoading(true); setRevision((value) => value + 1); };
  return <section className="experiment-results">
    <div className="page-heading"><span className="eyebrow">LỊCH SỬ HỌC TẬP</span>
      <h1>Lịch sử chuyến đi</h1>
      <p>Các phiên đã lưu tự động xuất hiện trong lịch sử chung. Mỗi phiên có tóm tắt mục tiêu dài tối đa 200 ký tự, chủ đề, thời gian, thiết bị và điểm quiz. Tránh ghi thông tin riêng tư vào mục tiêu; email, mã tài khoản, tài liệu và câu trả lời chi tiết không được gửi thành các trường riêng.</p>
    </div>
    <div className="choice-row"><button disabled={loading} onClick={refresh}>{loading ? "Đang tải…" : "Cập nhật lịch sử"}</button>
      <a className="experiment-export" href={`${API_URL}/experiments/export.csv`} download="viendu-trip-history.csv">Tải lịch sử CSV</a></div>
    {error && <p role="alert" className="info-box">{error}</p>}
    {data && <><p>{data.total} phiên đã lưu</p>
      {data.runs.length ? <ExperimentRunList runs={data.runs} />
        : <div className="panel"><h2>Chưa có phiên học</h2><p>Phiên học đã lưu sẽ xuất hiện tự động tại đây.</p></div>}
      <div className="choice-row"><button disabled={loading || offset === 0} onClick={() => { setLoading(true); setData(null); setOffset(Math.max(0, offset - 50)); }}>Trang trước</button>
        <button disabled={loading || offset + 50 >= data.total} onClick={() => { setLoading(true); setData(null); setOffset(offset + 50); }}>Trang sau</button></div></>}
    <p className="material-hint">Khoảng học đã diễn ra không tính giờ nghỉ; thời gian thực học không tính xao nhãng. CSV chứa tối đa 10.000 phiên gần nhất.</p>
  </section>;
}
