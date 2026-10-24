import { useReducer, useState } from "react";
import type { StudyGuideDraft } from "./studyGuide";
import { StudyGuideArticle } from "./StudyGuideRenderer";
import { createStudyGuideReviewState, reduceStudyGuideReview } from "./studyGuideReview";
import "./studyGuide.css";

export function StudyGuideComposer({ disabled, canGenerate, unavailableReason, onGenerate, onCancel, onUse, onDownload }: {
  disabled: boolean;
  canGenerate: boolean;
  unavailableReason: string;
  onGenerate: (prompt: string) => Promise<StudyGuideDraft | undefined>;
  onCancel: () => void;
  onUse: (draft: StudyGuideDraft) => void;
  onDownload: (draft: StudyGuideDraft) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [review, dispatch] = useReducer(reduceStudyGuideReview, createStudyGuideReviewState());
  const { draft } = review;
  const validDraft = draft && draft.title.trim().length > 0 && draft.title.trim().length <= 120 && draft.text.trim().length >= 10 && draft.text.trim().length <= 20000;
  return <section className="study-guide" aria-labelledby="study-guide-title">
    <div className="study-guide__heading">
      <span aria-hidden="true">✦</span>
      <div>
        <h3 id="study-guide-title">Chưa có tài liệu? Tạo bản ôn tập</h3>
        <p>Nói rõ bạn muốn học gì. Bản ôn tập có đúng 8 mục theo thứ tự dưới đây; phần Lý thuyết được giải thích kỹ nhất.</p>
        <ol className="study-guide__outline" aria-label="Bố cục bản ôn tập">
          <li>Ý chính</li>
          <li>Lý thuyết (chi tiết nhất)</li>
          <li>Vai trò</li>
          <li>So sánh</li>
          <li>Ví dụ minh họa</li>
          <li>Nhầm lẫn thường gặp</li>
          <li>Câu hỏi thực tế</li>
          <li>Gợi ý đáp án theo thứ tự câu hỏi</li>
        </ol>
      </div>
    </div>
    <label htmlFor="study-guide-prompt">Bạn muốn ôn tập nội dung nào?</label>
    <textarea id="study-guide-prompt" rows={3} maxLength={4000} value={prompt} disabled={disabled}
      onChange={event => setPrompt(event.target.value)} aria-describedby="study-guide-prompt-help"
      placeholder="Ví dụ: Soạn bài ôn Sinh học lớp 10 về tế bào, giải thích dễ hiểu, có bảng so sánh tế bào nhân sơ và nhân thực, kèm 5 câu tự luyện." />
    <p id="study-guide-prompt-help" className="material-hint">Ghi môn/lớp, phần kiến thức và mức độ mong muốn. Bản nháp chỉ trở thành tài liệu học sau khi bạn kiểm tra và xác nhận.</p>
    <button className="study-guide__generate" disabled={disabled || !canGenerate || prompt.trim().length < 10}
      onClick={() => { void onGenerate(prompt.trim()).then(value => { if (value) dispatch({ type: "generated", draft: value }); }); }}>
      {disabled ? "Đang xử lý…" : draft ? "Soạn lại bản ôn tập" : "Tạo bản ôn tập bằng AI"}
    </button>
    {disabled && <div className="study-guide__waiting"><p role="status">AI đang soạn bản ôn tập, có thể mất khoảng một phút.</p><button onClick={onCancel}>Hủy tạo bản ôn tập</button></div>}
    {!canGenerate && <p className="material-hint">{unavailableReason}</p>}
    {draft && <div className="study-guide__draft">
      <div className="study-guide__draft-heading"><h4>Bản ôn tập của bạn</h4><p className="material-hint">AI đã soạn bản nháp theo yêu cầu của bạn. Hãy đọc lại, rồi sửa nếu cần.</p></div>
      <div className="study-guide__draft-toolbar" role="group" aria-label="Chế độ xem bản ôn tập">
        <button type="button" aria-pressed={review.view === "preview"} disabled={disabled} onClick={() => dispatch({ type: "set-view", view: "preview" })}>Bản xem trước</button>
        <button type="button" aria-pressed={review.view === "edit"} disabled={disabled} onClick={() => dispatch({ type: "set-view", view: "edit" })}>Chỉnh sửa</button>
      </div>
      {review.view === "preview" ? <StudyGuideArticle title={draft.title} text={draft.text} aiGenerated /> : <div className="study-guide__editor">
        <label htmlFor="study-guide-draft-title">Tiêu đề<input id="study-guide-draft-title" maxLength={120} value={draft.title} disabled={disabled} onChange={event => dispatch({ type: "edit-title", title: event.target.value })} /></label>
        <label htmlFor="study-guide-draft-text">Nội dung Markdown<textarea id="study-guide-draft-text" rows={14} maxLength={20000} value={draft.text} disabled={disabled} onChange={event => dispatch({ type: "edit-text", text: event.target.value })} /></label>
        <p className="material-hint">Bạn đang sửa bản Markdown gốc. Chuyển về bản xem trước để kiểm tra cách trình bày.</p>
      </div>}
      <div className="choice-row">
        <button disabled={disabled || !validDraft} onClick={() => onUse(draft)}>Xác nhận và dùng làm tài liệu</button>
        <button disabled={disabled || !validDraft} onClick={() => onDownload(draft)}>Tải bản ôn tập (.txt)</button>
      </div>
    </div>}
  </section>;
}
