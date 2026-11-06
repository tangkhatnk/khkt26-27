import { isQuizCount } from "./quizDrafts";

export function QuizReviewPreference({
  count,
  skipped,
  disabled = false,
  onCountChange,
  onToggleSkip,
  prefetchEnabled = false,
  sourcePresent = false,
  sourceReviewed = false,
  sourceConsent = false,
  onPrefetchChange = () => {},
  onSourceConsentChange = () => {},
}: {
  count: string;
  skipped: boolean;
  disabled?: boolean;
  onCountChange: (value: string) => void;
  onToggleSkip: () => void;
  prefetchEnabled?: boolean;
  sourcePresent?: boolean;
  sourceReviewed?: boolean;
  sourceConsent?: boolean;
  onPrefetchChange?: (enabled: boolean) => void;
  onSourceConsentChange?: (consent: boolean) => void;
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
          ? "Quiz AI là tùy chọn. Bạn có thể tạo câu hỏi sau buổi học mà không cần tài khoản. Chuẩn bị trước chỉ bắt đầu nếu bạn bật tùy chọn bên dưới."
          : "Chọn số câu hỏi là số nguyên từ 1 đến 30."}
      </small>
    </>}
    <fieldset className="quiz-prefetch-options">
      <legend>Chuẩn bị Quiz AI</legend>
      <label>
        <input type="checkbox" checked={prefetchEnabled} disabled={disabled || skipped}
          onChange={(event) => onPrefetchChange(event.currentTarget.checked)} />
        <span>Chuẩn bị câu hỏi trong lúc học (tùy chọn)</span>
      </label>
      {prefetchEnabled && sourcePresent && sourceReviewed && <label>
        <input type="checkbox" checked={sourceConsent} disabled={disabled || skipped}
          onChange={(event) => onSourceConsentChange(event.currentTarget.checked)} />
        <span>Cho phép gửi nội dung đã kiểm tra để chuẩn bị Quiz AI</span>
      </label>}
      {prefetchEnabled && sourcePresent && !sourceReviewed && <small role="status">
        Hãy kiểm tra nguồn trước. Câu hỏi sẽ chưa được chuẩn bị cho tới khi bạn xác nhận nguồn và cho phép gửi.
      </small>}
      {!prefetchEnabled && <small>Không gửi nội dung hay chuẩn bị câu hỏi khi tùy chọn này đang tắt.</small>}
    </fieldset>
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
      Ứng dụng không chuẩn bị câu hỏi trong lúc học. Sau phiên, bạn vẫn có thể tự tạo Quiz AI mà không cần tài khoản.
    </small>}
  </div>;
}
