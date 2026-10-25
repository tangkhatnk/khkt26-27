import { useEffect, useState } from "react";
import { API_URL, post, request } from "../services/api";
import type { DeviceCategory, SessionCorrectionFlags } from "../../backend/src/adventure/domain";
import { studyTopics } from "./topics";
import "./experimentResults.css";

export type ExperimentRun = {
  id: string;
  tripCode: string;
  testerCode: string;
  topic: string;
  targetSeconds: number;
  elapsedSeconds: number;
  focusedSeconds: number;
  distractions: number;
  breakSeconds: number | null;
  plannedBreakSeconds: number | null;
  studyElapsedSeconds: number;
  deviceCategory: DeviceCategory | null;
  completionPercent: number | null;
  completed: boolean;
  quizScore: number | null;
  quizTotal: number | null;
  correctionFlags: Omit<SessionCorrectionFlags, "goal">;
  startedAt: string;
  endedAt: string;
  publishedAt: string;
};
type Results = { runs: ExperimentRun[]; total: number; limit: number; offset: number };
type ExperimentMineStatus = "loading" | "shared" | "not-shared" | "unknown";

export function ExperimentShareMineStatus({ status, disabled, onRetry }: {
  status: ExperimentMineStatus;
  disabled: boolean;
  onRetry: () => void;
}) {
  if (status === "loading") return <p className="material-hint" role="status">Đang kiểm tra trạng thái công khai của phiên…</p>;
  if (status === "unknown") return <div className="choice-row">
    <p role="alert">Chưa kiểm tra được phiên này đã công khai chưa. Hãy thử lại trước khi gửi để tránh công khai trùng.</p>
    <button type="button" disabled={disabled} onClick={onRetry}>Thử kiểm tra lại</button>
  </div>;
  return null;
}

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
  "topic", "targetSeconds", "elapsedSeconds", "actualStudySeconds", "focusedSeconds",
  "actualBreakSeconds", "distractions", "quizResult",
];

export function experimentRunHasCorrections(flags: ExperimentRun["correctionFlags"] | undefined) {
  return Boolean(flags && publicCorrectionFields.some((field) => flags[field] === true));
}

function CorrectionBadge({ run }: { run: ExperimentRun }) {
  if (!experimentRunHasCorrections(run.correctionFlags)) return null;
  return <span className="experiment-correction-badge" aria-label="Phiên có chỉ số đã hiệu chỉnh">Đã hiệu chỉnh</span>;
}

function completionStatusText(run: ExperimentRun) {
  const statusSource = run.correctionFlags?.targetSeconds || run.correctionFlags?.actualStudySeconds
    ? "theo số liệu đang áp dụng"
    : "theo dữ liệu đo ban đầu";
  return `${run.completed ? "Đạt mục tiêu" : "Chưa đạt mục tiêu"} ${statusSource}`;
}

function CompletionReport({ run }: { run: ExperimentRun }) {
  return <div className="experiment-completion-summary">
    <span>{completionStatusText(run)}</span>
    <span>{run.completionPercent === null ? "Chưa tự đánh giá" : `${run.completionPercent}% tự đánh giá`}</span>
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
      <div><dt>Thiết bị</dt><dd>{deviceLabel(run.deviceCategory)}</dd></div>
      <div><dt>Bắt đầu (giờ địa phương của bạn)</dt><dd><time dateTime={run.startedAt}>{startedDate}</time></dd></div>
      <div><dt>Kết thúc (giờ địa phương của bạn)</dt><dd><time dateTime={run.endedAt}>{endedDate}</time></dd></div>
      <div><dt>Đăng công khai</dt><dd><time dateTime={run.publishedAt}>{compactDateTime(run.publishedAt, fullTimestampOptions)}</time></dd></div>
      {run.correctionFlags?.elapsedSeconds && <div><dt>Ghi chú thời gian</dt><dd>Mốc bắt đầu và kết thúc là dữ kiện đo ban đầu; thời lượng chuyến đã được hiệu chỉnh.</dd></div>}
      <div><dt>Xao nhãng</dt><dd>{run.distractions} lần</dd></div>
      <div><dt>Giải lao thực tế</dt><dd>{run.breakSeconds == null ? "Chưa có thời gian giải lao" : formatExperimentDuration(run.breakSeconds)}</dd></div>
      <div><dt>Giải lao dự kiến</dt><dd>{run.plannedBreakSeconds == null ? "Không ghi nhận lịch nghỉ" : formatExperimentDuration(run.plannedBreakSeconds)}</dd></div>
      <div><dt>Trạng thái mục tiêu</dt><dd>{completionStatusText(run)}</dd></div>
      <div><dt>Mức hoàn thành tự đánh giá</dt><dd>{run.completionPercent === null ? "Chưa ghi nhận" : `${run.completionPercent}% · tự đánh giá`}</dd></div>
    </dl>
  </details>;
}

function JourneyTime({ run }: { run: ExperimentRun }) {
  const studyTarget = formatExperimentDuration(run.targetSeconds);
  const journeyTarget = formatExperimentDuration(run.targetSeconds + (run.plannedBreakSeconds ?? 0));
  return <div className="experiment-time-summary">
    <strong>{formatExperimentDuration(experimentStudySeconds(run))} học</strong>
    <span className="experiment-run-card__meta">{studyTarget} mục tiêu</span>
    <span className="experiment-run-card__meta">
      {formatExperimentDuration(run.elapsedSeconds)} tổng chuyến / {journeyTarget} dự kiến
    </span>
  </div>;
}

function RestAndFocus({ run }: { run: ExperimentRun }) {
  return <div className="experiment-rest-summary">
    <strong>{formatExperimentDuration(run.focusedSeconds)} tập trung</strong>
    <span className="experiment-run-card__meta">{run.breakSeconds == null ? "Chưa có thời gian giải lao" : `${formatExperimentDuration(run.breakSeconds)} giải lao thực tế`}</span>
    <span className="experiment-run-card__meta">{run.plannedBreakSeconds == null ? "Không ghi nhận lịch nghỉ" : `${formatExperimentDuration(run.plannedBreakSeconds)} giải lao dự kiến`}</span>
  </div>;
}

export function ExperimentRunList({ runs }: { runs: readonly ExperimentRun[] }) {
  return <>
    <div className="experiment-table-wrap" tabIndex={0} aria-label="Bảng lịch sử chuyến đi; cuộn ngang để xem thêm">
      <table className="experiment-table">
        <caption>Các phiên người học đã chọn công khai</caption>
        <thead><tr>
          <th scope="col">Mã chuyến</th>
          <th scope="col">Khởi hành</th>
          <th scope="col">Chủ đề</th>
          <th scope="col">Thời gian học và chuyến</th>
          <th scope="col">Tập trung và nghỉ</th>
          <th scope="col">Mục tiêu và tự đánh giá</th>
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
          <td><RestAndFocus run={run} /></td>
          <td><CompletionReport run={run} /></td>
          <td><QuizBadge run={run} /></td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="experiment-run-cards" aria-label="Các phiên đã công khai">
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
          <div><span className="experiment-run-card__metric-label">Thời gian học và chuyến</span><JourneyTime run={run} /></div>
          <div><span className="experiment-run-card__metric-label">Tập trung và nghỉ</span><RestAndFocus run={run} /></div>
          <div><span className="experiment-run-card__metric-label">Mục tiêu và tự đánh giá</span><CompletionReport run={run} /></div>
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
    <div className="page-heading"><span className="eyebrow">DỮ LIỆU THỰC NGHIỆM</span>
      <h1>Kết quả tester</h1>
      <p>Chỉ các phiên người học đã chủ động chọn công khai mới xuất hiện. Mục tiêu riêng, email, tài liệu và câu trả lời chi tiết vẫn được giữ riêng tư.</p>
    </div>
    <div className="choice-row"><button disabled={loading} onClick={refresh}>{loading ? "Đang tải…" : "Cập nhật kết quả"}</button>
      <a className="experiment-export" href={`${API_URL}/experiments/export.csv`} download="viendu-tester-runs.csv">Tải dữ liệu CSV</a></div>
    {error && <p role="alert" className="info-box">{error}</p>}
    {data && <><p>{data.total} phiên công khai · Phiên riêng tư, chưa đồng bộ hoặc chưa được chọn sẽ không xuất hiện.</p>
      {data.runs.length ? <ExperimentRunList runs={data.runs} />
        : <div className="panel"><h2>Chưa có kết quả công khai</h2><p>Sau khi đăng nhập và đồng bộ một phiên, người học có thể chọn công khai phiên đó từ tổng kết.</p></div>}
      <div className="choice-row"><button disabled={loading || offset === 0} onClick={() => { setLoading(true); setData(null); setOffset(Math.max(0, offset - 50)); }}>Trang trước</button>
        <button disabled={loading || offset + 50 >= data.total} onClick={() => { setLoading(true); setData(null); setOffset(offset + 50); }}>Trang sau</button></div></>}
    <p className="material-hint">Thời gian học loại trừ các khoảng nghỉ; thời gian tập trung loại trừ cả xao nhãng. Đạt mục tiêu được tính bằng thời gian học thực tế so với thời lượng mục tiêu hiện hành. Mức hoàn thành là tự đánh giá, không phải phép đo tự động. Điểm quiz được chấm trên máy chủ. CSV chứa tối đa 10.000 phiên gần nhất.</p>
  </section>;
}

export function ExperimentShare({ sessionId, canPublish, sync }: { sessionId: string; canPublish: boolean; sync: () => Promise<void> }) {
  const [completion, setCompletion] = useState("");
  const [mine, setMine] = useState<{ sessionId: string; status: ExperimentMineStatus }>({ sessionId, status: "loading" });
  const [mineRetry, setMineRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!canPublish) return;
    let cancelled = false;
    request<{ sessionId: string }[]>("/experiments/mine").then((rows) => {
      if (!cancelled) setMine({ sessionId, status: rows.some((row) => row.sessionId === sessionId) ? "shared" : "not-shared" });
    }).catch(() => {
      if (!cancelled) setMine({ sessionId, status: "unknown" });
    });
    return () => { cancelled = true; };
  }, [canPublish, sessionId, mineRetry]);
  const mineStatus = mine.sessionId === sessionId ? mine.status : "loading";
  const shared = mineStatus === "shared";
  function retryMine() {
    setMine({ sessionId, status: "loading" });
    setMineRetry((current) => current + 1);
  }
  async function publish() {
    if (busy || !canPublish || mineStatus === "unknown" || mineStatus === "loading") return;
    setBusy(true);
    setMessage("");
    try {
      await sync();
      await post("/experiments", { sessionId, completionPercent: completion === "" ? null : Number(completion) });
      setMine({ sessionId, status: "shared" });
      setMessage("Kết quả đã được công khai trong mục Kết quả tester.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Chưa công khai được kết quả.");
    } finally {
      setBusy(false);
    }
  }
  async function withdraw() {
    if (busy || !canPublish || mineStatus !== "shared") return;
    setBusy(true);
    setMessage("");
    try {
      await request(`/experiments/${sessionId}`, { method: "DELETE" });
      setMine({ sessionId, status: "not-shared" });
      setMessage("Đã rút phiên này khỏi bảng công khai.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Chưa rút được phiên công khai.");
    } finally {
      setBusy(false);
    }
  }
  return <section className="panel form experiment-share">
    <h2>Đóng góp kết quả thực nghiệm</h2>
    <p>Nếu bạn chọn công khai, người xem sẽ thấy chủ đề, mã tester ẩn danh, ngày giờ, thời gian học và giải lao, loại thiết bị, số lần xao nhãng, điểm quiz cùng mức hoàn thành tự đánh giá. Mục tiêu viết riêng, email, tài liệu và câu trả lời chi tiết vẫn riêng tư.</p>
    {!canPublish ? <p>Đăng nhập và đồng bộ phiên để chọn công khai kết quả.</p> : <>
      <ExperimentShareMineStatus status={mineStatus} disabled={busy} onRetry={retryMine} />
      <label htmlFor={`completion-${sessionId}`}>Mức hoàn thành mục tiêu tự đánh giá (%) · tùy chọn</label>
      <input id={`completion-${sessionId}`} type="number" min="0" max="100" step="1" placeholder="0–100" value={completion} onChange={(event) => setCompletion(event.target.value)} />
      <button disabled={busy || mineStatus === "unknown" || mineStatus === "loading" || (completion !== "" && (!Number.isInteger(Number(completion)) || Number(completion) < 0 || Number(completion) > 100))} onClick={() => void publish()}>{shared ? "Cập nhật kết quả công khai" : "Công khai kết quả phiên này"}</button>
      {shared && <button disabled={busy} onClick={() => void withdraw()}>Rút phiên này khỏi bảng công khai</button>}
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
