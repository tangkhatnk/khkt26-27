import { useEffect, useState } from "react";
import { API_URL, post, request } from "../services/api";
import { studyTopics } from "./topics";

type Run = {
  id: string; testerCode: string; topic: string; targetSeconds: number; elapsedSeconds: number;
  focusedSeconds: number; distractions: number; completionPercent: number | null; completed: boolean;
  quizScore: number | null; quizTotal: number | null; recordedAt: string;
};
type Results = { runs: Run[]; total: number; limit: number; offset: number };
const duration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
export function ExperimentResults() {
  const [data, setData] = useState<Results | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    request<Results>(`/experiments?limit=50&offset=${offset}`, {}, false).then(value => {
      if (!cancelled) { setData(value); setError(""); }
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Không tải được kết quả."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [offset, revision]);
  const refresh = () => { setLoading(true); setRevision(value => value + 1); };
  return <section className="experiment-results">
    <div className="page-heading"><span className="eyebrow">DỮ LIỆU THỰC NGHIỆM</span>
      <h1>Những chuyến học của tester</h1>
      <p>Các phiên mà tester đã chọn công khai. Mỗi người có mã ẩn danh; chỉ công bố thời lượng, xao nhãng, điểm quiz và mức hoàn thành tự đánh giá.</p>
    </div>
    <div className="choice-row"><button disabled={loading} onClick={refresh}>{loading ? "Đang tải…" : "Cập nhật kết quả"}</button>
      <a className="experiment-export" href={`${API_URL}/experiments/export.csv`} download="viendu-tester-runs.csv">Tải dữ liệu CSV</a></div>
    {error && <p role="alert" className="info-box">{error}</p>}
    {data && <><p>{data.total} phiên công khai · Không bao gồm phiên riêng tư và phiên chưa đồng bộ.</p>
      {data.runs.length ? <div className="experiment-table-wrap"><table className="experiment-table"><caption>Kết quả các phiên tester</caption>
        <thead><tr><th>Mã tester / Ngày</th><th>Chủ đề</th><th>Mục tiêu thời gian</th><th>Đã chạy</th><th>Tập trung</th><th>Xao nhãng</th><th>Quiz</th><th>Hoàn thành tự đánh giá</th></tr></thead>
        <tbody>{data.runs.map(r => <tr key={r.id}><td><strong>{r.testerCode}</strong><br/>{new Date(r.recordedAt).toLocaleString("vi-VN")}</td>
          <td>{studyTopics.find(t => t.id === r.topic)?.name ?? r.topic}</td><td>{duration(r.targetSeconds)}</td>
          <td>{duration(r.elapsedSeconds)}{r.completed ? " · đủ giờ" : " · kết thúc sớm"}</td><td>{duration(r.focusedSeconds)}</td>
          <td>{r.distractions} lần</td><td>{r.quizTotal === null ? "Chưa làm" : `${r.quizScore}/${r.quizTotal}`}</td>
          <td>{r.completionPercent === null ? "Chưa đánh giá" : `${r.completionPercent}%`}</td></tr>)}</tbody></table></div>
        : <div className="panel"><h2>Chưa có kết quả công khai</h2><p>Sau một chuyến học, tester mở tổng kết và chọn công khai kết quả để đóng góp dữ liệu thực nghiệm.</p></div>}
      <div className="choice-row"><button disabled={loading || offset === 0} onClick={() => { setLoading(true); setOffset(Math.max(0, offset - 50)); }}>Trang trước</button>
        <button disabled={loading || offset + 50 >= data.total} onClick={() => { setLoading(true); setOffset(offset + 50); }}>Trang sau</button></div></>}
    <p className="material-hint">Thời gian tập trung loại trừ khoảng rời phiên; đồng hồ chuyến vẫn chạy liên tục. Mức hoàn thành là tự đánh giá, không phải phép đo tự động. Điểm quiz được chấm trên máy chủ. CSV chứa tối đa 10.000 phiên gần nhất.</p>
  </section>;
}

export function ExperimentShare({ sessionId, canPublish, sync }: { sessionId: string; canPublish: boolean; sync: () => Promise<void> }) {
  const [completion, setCompletion] = useState("");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!canPublish) return;
    let cancelled = false;
    request<{ sessionId: string }[]>("/experiments/mine").then(rows => {
      if (!cancelled) setShared(rows.some(row => row.sessionId === sessionId));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [canPublish, sessionId]);
  async function publish() {
    setBusy(true); setMessage("");
    try {
      await sync();
      await post("/experiments", { sessionId, completionPercent: completion === "" ? null : Number(completion) });
      setShared(true); setMessage("Kết quả đã xuất hiện trong mục Kết quả tester.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Chưa công khai được kết quả."); }
    finally { setBusy(false); }
  }
  async function withdraw() {
    setBusy(true); setMessage("");
    try { await request(`/experiments/${sessionId}`, { method: "DELETE" }); setShared(false); setMessage("Đã ẩn phiên này khỏi bảng công khai."); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Chưa ẩn được kết quả."); }
    finally { setBusy(false); }
  }
  return <section className="panel form experiment-share"><h2>Đóng góp kết quả thực nghiệm</h2>
    <p>Công khai chủ đề, ngày giờ phiên học và ngày giờ chia sẻ, thời lượng, số lần xao nhãng, điểm quiz và mức hoàn thành tự đánh giá. Mã tester cố định giúp đối chiếu các lần chạy của cùng một người. Mục tiêu viết riêng, email và tài liệu học vẫn riêng tư.</p>
    {!canPublish ? <p>Đăng nhập và đồng bộ phiên để công khai kết quả.</p> : <>
      <label htmlFor={`completion-${sessionId}`}>Mức hoàn thành mục tiêu tự đánh giá (%) · tùy chọn</label>
      <input id={`completion-${sessionId}`} type="number" min="0" max="100" step="1" placeholder="0–100" value={completion} onChange={e => setCompletion(e.target.value)} />
      <button disabled={busy || (completion !== "" && (!Number.isInteger(Number(completion)) || Number(completion) < 0 || Number(completion) > 100))} onClick={() => void publish()}>{shared ? "Cập nhật kết quả công khai" : "Công khai kết quả phiên này"}</button>
      {shared && <button disabled={busy} onClick={() => void withdraw()}>Ẩn kết quả phiên này</button>}
    </>}{message && <p role="status">{message}</p>}
  </section>;
}
