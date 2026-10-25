import type { SessionCorrectionFlags } from "../../backend/src/adventure/domain.ts";
import { hasSessionCorrections } from "./learning";

export function SessionCorrectionNotice({
  correctionFlags,
  recordedEnd,
}: {
  correctionFlags?: Partial<SessionCorrectionFlags>;
  recordedEnd: string;
}) {
  if (!hasSessionCorrections(correctionFlags)) return null;

  return <aside className="info-box session-correction-notice" role="note">
    <strong>Một số nội dung hoặc số liệu phiên này đã được hiệu chỉnh.</strong>
    <p>Các mục đã chỉnh hiển thị giá trị hiệu lực trong lịch sử.</p>
    {correctionFlags?.elapsedSeconds && <p>
      Mốc kết thúc ghi nhận vẫn là thời điểm đã đo: {recordedEnd}. Thời lượng hiệu lực đã được hiệu chỉnh riêng.
    </p>}
  </aside>;
}
