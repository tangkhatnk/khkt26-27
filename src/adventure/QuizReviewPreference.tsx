import { isQuizCount } from "./quizDrafts";

export function QuizReviewPreference({
  count,
  skipped,
  disabled = false,
  onCountChange,
  onToggleSkip,
}: {
  count: string;
  skipped: boolean;
  disabled?: boolean;
  onCountChange: (value: string) => void;
  onToggleSkip: () => void;
}) {
  return <div className="quiz-review-preference">
    {!skipped && <>
      <label className="quiz-count-label" htmlFor="departure-quiz-count">
        Số câu hỏi ôn tập
        <input
          id="departure-quiz-count"
          type="number"
          min={1}
          max={30}
          step={1}
          value={count}
          disabled={disabled}
          aria-invalid={!isQuizCount(Number(count))}
          onChange={(event) => onCountChange(event.currentTarget.value)}
          aria-describedby="departure-quiz-hint"
        />
      </label>
      <small id="departure-quiz-hint" className="departure-quiz-hint">
        {isQuizCount(Number(count))
          ? "Khi đăng nhập, nguồn đã kiểm tra được gửi cho AI để chuẩn bị câu hỏi trong lúc bạn tập trung. Bạn có thể đổi số lượng ở phần thành quả."
          : "Chọn số câu hỏi là số nguyên từ 1 đến 30."}
      </small>
    </>}
    <button
      type="button"
      className="departure-quiz-skip"
      aria-pressed={skipped}
      disabled={disabled}
      onClick={onToggleSkip}
    >
      {skipped ? "Bật ôn tập" : "Bỏ qua ôn tập"}
    </button>
    {skipped && <small id="departure-quiz-hint" className="departure-quiz-hint">
      Ứng dụng sẽ không tạo sẵn câu hỏi trong lúc học. Bạn vẫn có thể bật ôn tập ở phần thành quả.
    </small>}
  </div>;
}
