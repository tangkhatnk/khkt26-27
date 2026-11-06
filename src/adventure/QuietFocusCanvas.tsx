import type { ReactNode } from "react";
import { FlipClock } from "./FlipClock";
import "./quietFocusCanvas.css";

export type QuietFocusCanvasProps = {
  goal: string;
  clockSeconds: number;
  clockLabel: string;
  motionAllowed: boolean;
  status: ReactNode;
  essentialControls: ReactNode;
  warnings?: ReactNode;
  materials?: ReactNode;
  details?: ReactNode;
};

export function QuietFocusCanvas({
  goal,
  clockSeconds,
  clockLabel,
  motionAllowed,
  status,
  essentialControls,
  warnings,
  materials,
  details,
}: QuietFocusCanvasProps) {
  return (
    <section className="quiet-focus-canvas" aria-label="Phiên tập trung">
      <header className="quiet-focus-canvas__intro">
        <p className="quiet-focus-canvas__eyebrow">Mục tiêu hiện tại</p>
        <h1 className="quiet-focus-canvas__goal">{goal}</h1>
        <div className="quiet-focus-canvas__status" role="status" aria-label="Trạng thái phiên">
          {status}
        </div>
      </header>

      <div className="quiet-focus-canvas__clock">
        <FlipClock seconds={clockSeconds} label={clockLabel} motionAllowed={motionAllowed} />
      </div>

      {warnings != null && (
        <div className="quiet-focus-canvas__warnings" aria-live="polite">
          {warnings}
        </div>
      )}

      <div className="quiet-focus-canvas__essentials" role="group" aria-label="Điều khiển phiên">
        {essentialControls}
      </div>

      {(materials != null || details != null) && (
        <div className="quiet-focus-canvas__optional">
          {materials != null && (
            <details className="quiet-focus-canvas__disclosure">
              <summary>Tài liệu</summary>
              <div className="quiet-focus-canvas__disclosure-content">{materials}</div>
            </details>
          )}
          {details != null && (
            <details className="quiet-focus-canvas__disclosure">
              <summary>Chi tiết phiên</summary>
              <div className="quiet-focus-canvas__disclosure-content">{details}</div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
