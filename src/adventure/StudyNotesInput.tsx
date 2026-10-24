import "./studyContent.css";

type StudyNotesInputProps = {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  hasDocuments: boolean;
};

export function StudyNotesInput({
  value,
  onChange,
  disabled,
  hasDocuments,
}: StudyNotesInputProps) {
  const help = hasDocuments
    ? "Đã thêm tài liệu: câu hỏi sẽ dựa trên nội dung tài liệu bạn đã kiểm tra. Ghi chú vẫn được lưu riêng và không thay thế nguồn tài liệu."
    : "AI dùng phần nội dung này để tạo câu hỏi. Nếu chưa có nội dung, chọn ‘Nhờ AI soạn’ để tạo bản ôn tập từ yêu cầu của bạn.";

  return (
    <section className="study-notes-input" aria-labelledby="study-notes-input-title">
      <div className="study-notes-input__intro">
        <h3 id="study-notes-input-title">Nội dung bạn đã có</h3>
        <p>
          Mục tiêu chuyến đi cho biết bạn muốn đạt gì; ghi chú bên dưới là kiến thức
          thực tế để tạo câu hỏi ôn tập.
        </p>
        <p className="study-notes-input__example">
          <strong>Ví dụ:</strong> Dán đoạn bài học về quang hợp hoặc ghi các ý chính
          cần nhớ.
        </p>
      </div>

      <label className="study-notes-input__field">
        Ghi chú học tập (không bắt buộc)
        <textarea
          rows={5}
          maxLength={50000}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby="study-notes-input-help"
          placeholder="Dán nội dung bài học hoặc ghi các khái niệm, định nghĩa và ý chính muốn ôn."
        />
      </label>
      <p id="study-notes-input-help" className="study-notes-input__help">
        {help}
      </p>
    </section>
  );
}
