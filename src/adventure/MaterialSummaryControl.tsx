import type { MaterialSource } from "./materialSources";

export function MaterialSummaryControl({
  source,
  summary,
  pending = false,
  error = "",
  canGenerate = true,
  disabledReason = "",
  onGenerate,
}: {
  source: MaterialSource;
  summary?: string;
  pending?: boolean;
  error?: string;
  canGenerate?: boolean;
  disabledReason?: string;
  onGenerate: () => void;
}) {
  if (!source.reviewed)
    return <p className="material-hint" role="status">Xác nhận nội dung nguồn trước khi yêu cầu tóm tắt.</p>;

  return <div className="material-summary-control">
    <p className="material-hint">Khi tạo tóm tắt, nội dung đã kiểm tra của nguồn này sẽ được gửi đến Gemini.</p>
    <button type="button" disabled={pending || !canGenerate} onClick={onGenerate}>
      {pending ? "Đang tạo tóm tắt…" : "Tóm tắt tài liệu"}
    </button>
    {!canGenerate && disabledReason && <p className="material-hint">{disabledReason}</p>}
    {error && <p role="alert" className="material-hint">{error}</p>}
    {summary && <section className="material-summary-result" aria-label="Tóm tắt tài liệu">
      <h3>Tóm tắt do AI tạo</h3>
      <p>{summary}</p>
    </section>}
  </div>;
}
