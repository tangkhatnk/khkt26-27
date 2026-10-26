import type { StudyFullscreenStatus } from "./studyFullscreen";

type FocusFullscreenRecoveryProps = {
  status: StudyFullscreenStatus;
  message: string;
  onRequest: () => void;
  onDismiss: () => void;
};

export function FocusFullscreenRecovery({
  status,
  message,
  onRequest,
  onDismiss,
}: FocusFullscreenRecoveryProps) {
  const pending = status === "pending";

  return (
    <section className="focus-fullscreen-recovery" aria-labelledby="focus-fullscreen-recovery-title">
      <div>
        <h2 id="focus-fullscreen-recovery-title">Phiên học đang mở lại</h2>
        <p>Bạn có thể bật lại toàn màn hình để tiếp tục tập trung.</p>
        {message && (
          <p className="focus-fullscreen-recovery__status" role="status">
            {message}
          </p>
        )}
      </div>
      <div className="focus-fullscreen-recovery__actions">
        <button
          className="primary"
          type="button"
          onClick={onRequest}
          disabled={pending}
        >
          {pending ? "Đang bật toàn màn hình…" : "Tiếp tục toàn màn hình"}
        </button>
        <button type="button" onClick={onDismiss}>
          Tiếp tục ở cửa sổ
        </button>
      </div>
    </section>
  );
}
