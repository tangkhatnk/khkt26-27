import type { StudyFullscreenStatus } from "./studyFullscreen";
import { useEffect, useRef, type RefObject } from "react";

type FocusFullscreenRecoveryProps = {
  variant?: "restore" | "initial";
  status: StudyFullscreenStatus;
  message: string;
  onRequest: () => void;
  onDismiss: () => void;
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
};

export function FocusFullscreenRecovery({
  variant = "restore",
  status,
  message,
  onRequest,
  onDismiss,
  returnFocusRef,
}: FocusFullscreenRecoveryProps) {
  if (variant === "initial")
    return <InitialFullscreenFailureDialog
      status={status}
      message={message}
      onRequest={onRequest}
      onDismiss={onDismiss}
      returnFocusRef={returnFocusRef}
    />;

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

function InitialFullscreenFailureDialog({
  status,
  message,
  onRequest,
  onDismiss,
  returnFocusRef,
}: Omit<FocusFullscreenRecoveryProps, "variant">) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const returnFocusTarget = returnFocusRef?.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    continueRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      const target = returnFocusTarget ?? previousFocus;
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
  }, [returnFocusRef]);

  const pending = status === "pending";
  const unsupported = status === "unsupported";
  return <dialog
    ref={dialogRef}
    className="focus-fullscreen-dialog"
    aria-labelledby="focus-fullscreen-initial-title"
    aria-describedby="focus-fullscreen-initial-description"
    onCancel={(event) => {
      event.preventDefault();
      onDismiss();
    }}
  >
    <div className="focus-fullscreen-dialog__content">
      <h2 id="focus-fullscreen-initial-title">Bật toàn màn hình?</h2>
      <p id="focus-fullscreen-initial-description">Phiên học vẫn đang chạy. Bạn có thể tiếp tục trong cửa sổ hiện tại.</p>
      {message && <p className="focus-fullscreen-dialog__status" role="status">{message}</p>}
    </div>
    <div className="focus-fullscreen-dialog__actions">
      <button
        className="primary"
        type="button"
        onClick={onRequest}
        disabled={pending || unsupported}
      >
        {pending ? "Đang bật toàn màn hình…" : unsupported ? "Toàn màn hình không khả dụng" : "Bật toàn màn hình"}
      </button>
      <button ref={continueRef} type="button" onClick={onDismiss}>Tiếp tục trong cửa sổ</button>
    </div>
  </dialog>;
}
