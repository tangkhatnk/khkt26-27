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
        <svg className="boarding-ticket__ornament" aria-hidden="true" focusable="false" viewBox="0 0 84 20">
          <path d="M5 10h74" fill="none" stroke="currentColor" strokeDasharray="2 4" strokeWidth="1.4" />
          <circle cx="8" cy="10" r="2.4" fill="currentColor" />
          <circle cx="76" cy="10" r="2.4" fill="currentColor" />
          <g fill="currentColor" stroke="var(--ticket-green-dark)" strokeWidth=".8">
            <path d="M36 4.5h14a2 2 0 0 1 2 2v7h-2v2h-2v-2h-9v2h-2v-2h-2v-7a2 2 0 0 1 2-2Z" />
            <path d="M38 6.5h4v3h-4zM45 6.5h4v3h-4z" fill="var(--ticket-green-dark)" stroke="none" />
          </g>
        </svg>
        <span className="boarding-ticket__mode">
          {mode === "group" ? "Cùng đoàn" : "Một mình"}
        </span>
      </header>

      <div className="boarding-ticket__main">
        <svg className="boarding-ticket__landscape" aria-hidden="true" focusable="false" viewBox="0 0 240 72">
          <circle cx="211" cy="16" r="7" fill="currentColor" opacity=".24" />
          <path d="m3 50 24-23 18 19 19-14 24 22m12-3 25-29 21 25 16-17 23 21 20-16 32 17" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
          <path d="M4 59c34-13 63-14 97-3s69 8 135-3" fill="none" stroke="var(--ticket-route)" strokeDasharray="3 4" strokeLinecap="round" strokeWidth="1.5" />
          <path d="M4 64c37-13 65-14 98-3s67 8 134-3M12 59l3 7m12-11 3 7m12-10 3 7m12-9 3 7m12-8 3 7m12-8 3 7m12-7 3 7m12-7 3 7m12-7 3 7m12-7 3 7m12-7 3 7m12-8 3 7m12-10 3 7m12-12 3 7" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1" opacity=".55" />
          <g transform="translate(147 31)" fill="var(--ticket-route)" stroke="var(--ticket-paper)" strokeWidth=".8">
            <path d="M3 4h20a3 3 0 0 1 3 3v13h-3v3h-2v-3H8v3H6v-3H3V7a3 3 0 0 1 3-3Z" />
            <path d="M7 7h5v5H7zm8 0h5v5h-5z" fill="var(--ticket-paper)" stroke="none" />
            <circle cx="8" cy="21" r="2" />
            <circle cx="20" cy="21" r="2" />
          </g>
        </svg>
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
