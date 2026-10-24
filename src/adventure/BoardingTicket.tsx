import {
  isValidBreakPlan,
  totalDurationSeconds,
} from "../../backend/src/adventure/domain.ts";
import "./boarding.css";

type BoardingTicketProps = {
  goal: string;
  topicName: string;
  minutes: number;
  breakCount: number;
  breakMinutes: number;
  station: string;
  branch: "mountain" | "coast" | undefined;
  carriageName: string;
  mode: "solo" | "group";
  tripCode?: string;
};

export function BoardingTicket({
  goal,
  topicName,
  minutes,
  breakCount,
  breakMinutes,
  station,
  branch,
  carriageName,
  mode,
  tripCode,
}: BoardingTicketProps) {
  const validStudyDuration = Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= 240;
  const breakPlan = { count: breakCount, seconds: breakMinutes * 60 };
  const validBreakPlan = breakCount === 0 || (
    validStudyDuration && isValidBreakPlan(breakPlan, minutes * 60)
  );
  const validPlan = validStudyDuration && validBreakPlan;
  const totalMinutes = validPlan
    ? totalDurationSeconds(minutes * 60, breakCount > 0 ? breakPlan : undefined) / 60
    : null;

  const safeGoal = goal.trim() || "Chưa đặt mục tiêu học tập";
  const safeTopic = topicName.trim() || "Chưa chọn chủ đề";
  const safeStation = station.trim() || "Ga Khởi đầu";
  const safeCarriage = carriageName.trim() || "Toa của bạn";
  const focusValue = validStudyDuration ? `${minutes} phút` : "Cần kiểm tra";
  const restValue = !validBreakPlan
    ? "Cần kiểm tra"
    : breakCount === 0
      ? "Không nghỉ"
      : `${breakCount * breakMinutes} phút`;
  const totalValue = totalMinutes === null ? "Cần kiểm tra" : `${totalMinutes} phút`;
  const branchLabel = branch === "coast"
    ? "Ven biển"
    : branch === "mountain"
      ? "Qua núi"
      : "Chưa chọn tuyến";
  const safeTripCode = typeof tripCode === "string" && /^V-[A-F0-9]{12}$/u.test(tripCode)
    ? tripCode
    : undefined;

  return (
    <section className="boarding-ticket" aria-label="Vé chuyến học">
      <header className="boarding-ticket__band boarding-ticket__band--top">
        <span className="boarding-ticket__brand">VIỄN DU · VÉ LÊN TÀU</span>
        <span className="boarding-ticket__mode">
          {mode === "group" ? "Cùng đoàn" : "Một mình"}
        </span>
      </header>

      <div className="boarding-ticket__main">
        <div className="boarding-ticket__details">
          <div className="boarding-ticket__destination">
            <p className="boarding-ticket__field-label">MỤC TIÊU HÔM NAY</p>
            <h2>{safeGoal}</h2>
            <p className="boarding-ticket__topic">Chủ đề · {safeTopic}</p>
          </div>

          <div
            className="boarding-ticket__route"
            role="group"
            aria-label={`Từ ${safeStation}, tuyến ${branchLabel}`}
          >
            <div className="boarding-ticket__route-stop">
              <span className="boarding-ticket__field-label">GA HIỆN TẠI</span>
              <strong>{safeStation}</strong>
            </div>
            <span className="boarding-ticket__route-arrow" aria-hidden="true">→</span>
            <div className="boarding-ticket__route-stop">
              <span className="boarding-ticket__field-label">TUYẾN</span>
              <strong>{branchLabel}</strong>
            </div>
          </div>

          <p className="boarding-ticket__carriage">
            <span className="boarding-ticket__field-label">TOA TÀU</span>
            <strong>{safeCarriage}</strong>
          </p>
        </div>

        <div className="boarding-ticket__barcode" aria-hidden="true" />
      </div>

      <aside className="boarding-ticket__stub" aria-label="Mã chuyến và thời lượng">
        <div className="boarding-ticket__trip-code">
          <span className="boarding-ticket__field-label">MÃ CHUYẾN</span>
          {safeTripCode
            ? <code>{safeTripCode}</code>
            : <span className="boarding-ticket__pending-code">Chờ cấp mã chuyến</span>}
        </div>

        <dl className="boarding-ticket__stats">
          <div>
            <dt>Tập trung</dt>
            <dd>{focusValue}</dd>
          </div>
          <div>
            <dt>Giải lao</dt>
            <dd>{restValue}{validPlan && breakCount > 0 && <small>{breakCount} lần × {breakMinutes} phút</small>}</dd>
          </div>
          <div className="boarding-ticket__total">
            <dt>Tổng thời lượng</dt>
            <dd>{totalValue}</dd>
          </div>
        </dl>
      </aside>

      <footer className="boarding-ticket__band boarding-ticket__band--bottom">
        <span>CHUYẾN ĐI SẮP KHỞI HÀNH</span>
        <span>Mỗi phút, một bước tiến.</span>
      </footer>
    </section>
  );
}
