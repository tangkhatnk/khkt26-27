import { useId } from "react";
import {
  breakWindows,
  totalDurationSeconds,
  type BreakPlan,
} from "../../backend/src/adventure/domain.ts";
import "./duration.css";

const QUICK_TIMES = [15, 25, 45, 60] as const;

function clockTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function inputValue(value: number): number | "" {
  return Number.isFinite(value) ? value : "";
}

export function DurationPicker({
  value,
  onChange,
  breakCount = 0,
  breakMinutes = 5,
  onBreakCountChange,
  onBreakMinutesChange,
}: {
  value: number;
  onChange: (minutes: number) => void;
  breakCount?: number;
  breakMinutes?: number;
  onBreakCountChange?: (count: number) => void;
  onBreakMinutesChange?: (minutes: number) => void;
}) {
  const id = useId();
  const durationHelpId = `${id}-duration-help`;
  const breakHelpId = `${id}-break-help`;
  const breakErrorId = `${id}-break-error`;
  const canConfigureBreaks = Boolean(onBreakCountChange && onBreakMinutesChange);

  const durationValid = Number.isSafeInteger(value) && value >= 1 && value <= 240;
  const maxBreakCount = durationValid ? Math.min(10, value - 1) : 0;
  const breakCountValid = Number.isSafeInteger(breakCount) &&
    breakCount >= 0 && breakCount <= maxBreakCount;
  // A zero count makes the rest duration irrelevant, including while it is blank.
  const breakMinutesValid = breakCount === 0 || (
    Number.isSafeInteger(breakMinutes) && breakMinutes >= 1 && breakMinutes <= 30
  );
  const breakInputsValid = breakCountValid && breakMinutesValid;
  const previewValid = durationValid && breakInputsValid;
  const breakPlan: BreakPlan | undefined = breakCount > 0
    ? { count: breakCount, seconds: breakMinutes * 60 }
    : undefined;
  const breakIntervals = previewValid && breakCount > 0
    ? breakWindows(0, value * 60, breakPlan)
    : [];
  const totalSeconds = previewValid
    ? totalDurationSeconds(value * 60, breakPlan)
    : null;

  const timeline: string[] = [];
  if (previewValid && totalSeconds !== null) {
    let cursor = 0;
    for (const interval of breakIntervals) {
      const studySeconds = (interval.start - cursor) / 1000;
      if (studySeconds > 0) timeline.push(`Học ${clockTime(studySeconds)}`);
      timeline.push(`Nghỉ ${clockTime((interval.end - interval.start) / 1000)}`);
      cursor = interval.end;
    }
    const lastStudySeconds = (totalSeconds * 1000 - cursor) / 1000;
    if (lastStudySeconds > 0) timeline.push(`Học ${clockTime(lastStudySeconds)}`);
  }

  const breakError = !breakCountValid
    ? "Số lượt nghỉ phải là số nguyên từ 0 đến ít hơn số phút học, tối đa 10 lượt."
    : !breakMinutesValid
      ? "Mỗi lượt nghỉ cần từ 1 đến 30 phút."
      : null;

  return (
    <div className="duration-picker">
      <div className="quick-times" role="group" aria-label="Thời gian gợi ý">
        {QUICK_TIMES.map((minutes) => (
          <button
            key={minutes}
            type="button"
            aria-pressed={value === minutes}
            className={value === minutes ? "selected" : ""}
            onClick={() => onChange(minutes)}
          >
            {minutes} phút
          </button>
        ))}
      </div>
      <label className="custom-duration" htmlFor={`${id}-duration`}>
        Thời gian tùy chỉnh
        <span>
          <input
            id={`${id}-duration`}
            type="number"
            inputMode="numeric"
            min={1}
            max={240}
            step={1}
            value={inputValue(value)}
            onChange={(event) =>
              onChange(event.target.value === "" ? NaN : Number(event.target.value))
            }
            aria-describedby={durationHelpId}
            aria-invalid={!durationValid}
          />
          <span>phút</span>
        </span>
      </label>
      <small id={durationHelpId}>
        Nhập từ 1 đến 240 phút, theo nhịp học của bạn.
      </small>

      {canConfigureBreaks && (
        <fieldset className="duration-breaks">
          <legend>Trạm dừng chân giữa giờ</legend>
          <div className="duration-break-grid">
            <label className="duration-break-field" htmlFor={`${id}-break-count`}>
              <span>Số lượt giải lao</span>
              <input
                id={`${id}-break-count`}
                type="number"
                inputMode="numeric"
                min={0}
                max={maxBreakCount}
                step={1}
                value={inputValue(breakCount)}
                onChange={(event) =>
                  onBreakCountChange?.(event.target.value === "" ? NaN : Number(event.target.value))
                }
                aria-describedby={`${breakHelpId}${breakError ? ` ${breakErrorId}` : ""}`}
                aria-invalid={Boolean(breakError)}
              />
            </label>
            <label className="duration-break-field" htmlFor={`${id}-break-minutes`}>
              <span>Phút mỗi lượt</span>
              <input
                id={`${id}-break-minutes`}
                type="number"
                inputMode="numeric"
                min={1}
                max={30}
                step={1}
                disabled={breakCount === 0}
                value={inputValue(breakMinutes)}
                onChange={(event) =>
                  onBreakMinutesChange?.(event.target.value === "" ? NaN : Number(event.target.value))
                }
                aria-describedby={breakHelpId}
                aria-invalid={breakCount !== 0 && !breakMinutesValid}
              />
            </label>
          </div>
          <small id={breakHelpId}>
            Chọn 0 để học liền. Các trạm được chia đều tự động; giải lao không cộng XP và không bị tính xao nhãng. Rời phiên ngoài lịch nghỉ vẫn tính xao nhãng.
          </small>
          {breakError && (
            <p id={breakErrorId} className="duration-error" role="alert">
              {breakError}
            </p>
          )}
        </fieldset>
      )}

      {!durationValid && (
        <p role="alert" className="duration-error">
          Vui lòng nhập số phút nguyên từ 1 đến 240.
        </p>
      )}

      {canConfigureBreaks && (
        <section className="duration-total">
          {totalSeconds === null ? (
            <p className="duration-total-invalid" aria-live="polite">
              Hãy sửa thời gian học và lịch nghỉ để xem tổng thời lượng.
            </p>
          ) : (
            <>
              <div className="duration-total-summary" aria-live="polite" aria-atomic="true">
                <div className="duration-total-heading">
                  <span>Tổng thời lượng</span>
                  <strong>{totalSeconds / 60} phút</strong>
                </div>
                <p className="duration-total-detail">
                  {breakCount > 0
                    ? `${value} phút học · ${breakCount} lần nghỉ × ${breakMinutes} phút`
                    : `${value} phút học liên tục`}
                </p>
                {breakCount > 0 && (
                  <p className="duration-total-explanation">
                    {breakCount + 1} chặng học, chia đều {value} phút học.
                  </p>
                )}
              </div>
              {breakCount > 0 && (
                <details className="duration-details">
                  <summary>Xem lịch từng chặng</summary>
                  <p className="duration-timeline" aria-label="Trình tự phiên học">
                    {timeline.join(" → ")}
                  </p>
                </details>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
