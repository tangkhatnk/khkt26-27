import { useEffect, useRef, useState } from "react";
import {
  advanceFlipDigit,
  finishFlipDigit,
  finishFlipTop,
  flipDigitFaces,
  splitClockTime,
  type FlipDigitState,
} from "./flipClockModel";
import "./flipClock.css";

type FlipDigitProps = {
  value: string;
  motionAllowed: boolean;
};

function FlipDigit({ value, motionAllowed }: FlipDigitProps) {
  const [state, setState] = useState<FlipDigitState>(() => ({
    current: value,
    previous: null,
    phase: "idle",
    transitionId: 0,
  }));
  const displayed = advanceFlipDigit(state, value, motionAllowed);
  if (displayed !== state) setState(displayed);
  const faces = flipDigitFaces(displayed);

  return (
    <span className="flip-clock-digit" data-digit={value}>
      <span className="flip-clock-half flip-clock-upper"><span>{faces.upper}</span></span>
      <span className="flip-clock-half flip-clock-lower"><span>{faces.lower}</span></span>
      {(faces.topFlap !== null || faces.bottomFlap !== null) && (
        <span className="flip-clock-flipper" aria-hidden="true" key={displayed.transitionId}>
          {faces.topFlap !== null && (
            <span
              className="flip-clock-half flip-clock-fold-top"
              data-transition-id={displayed.transitionId}
              onAnimationEnd={(event) => {
                if (event.animationName !== "flip-clock-top-out") return;
                const transitionId = Number(event.currentTarget.dataset.transitionId);
                setState((current) => finishFlipTop(current, transitionId));
              }}
            >
              <span>{faces.topFlap}</span>
            </span>
          )}
          {faces.bottomFlap !== null && (
            <span
              className="flip-clock-half flip-clock-fold-bottom"
              data-transition-id={displayed.transitionId}
              onAnimationEnd={(event) => {
                if (event.animationName !== "flip-clock-bottom-in") return;
                const transitionId = Number(event.currentTarget.dataset.transitionId);
                setState((current) => finishFlipDigit(current, transitionId));
              }}
            >
              <span>{faces.bottomFlap}</span>
            </span>
          )}
        </span>
      )}
    </span>
  );
}

function ClockDigits({ digits, unit, motionAllowed }: {
  digits: string[];
  unit: "minutes" | "seconds";
  motionAllowed: boolean;
}) {
  return (
    <span className="flip-clock-group">
      <span className="flip-clock-digits">
        {digits.map((digit, index) => (
          <FlipDigit
            key={`${unit}-${digits.length - index}`}
            value={digit}
            motionAllowed={motionAllowed}
          />
        ))}
      </span>
      <span className="flip-clock-unit" aria-hidden="true">{unit === "minutes" ? "PHÚT" : "GIÂY"}</span>
    </span>
  );
}

export function FlipClock({
  seconds,
  label,
  motionAllowed = true,
}: {
  seconds: number;
  label: string;
  motionAllowed?: boolean;
}) {
  const element = useRef<HTMLTimeElement>(null);
  const [visible, setVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const time = splitClockTime(seconds);
  useEffect(() => {
    let inView = true;
    const update = () => setVisible(inView && !document.hidden);
    const observer = typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(([entry]) => {
          inView = entry.isIntersecting;
          update();
        });
    if (element.current) observer?.observe(element.current);
    document.addEventListener("visibilitychange", update);
    update();

    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const updateMotionPreference = () => setReducedMotion(Boolean(media?.matches));
    updateMotionPreference();
    if (media?.addEventListener) media.addEventListener("change", updateMotionPreference);
    else media?.addListener?.(updateMotionPreference);
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", update);
      if (media?.removeEventListener) media.removeEventListener("change", updateMotionPreference);
      else media?.removeListener?.(updateMotionPreference);
    };
  }, []);

  const canAnimate = motionAllowed && visible && !reducedMotion;
  return (
    <time
      ref={element}
      className="timer flip-clock"
      role="timer"
      aria-label={`${label}: ${time.spoken}`}
      dateTime={time.duration}
      data-animated={canAnimate}
    >
      <span className="flip-clock-readout" aria-hidden="true">
        <ClockDigits digits={time.minuteDigits} unit="minutes" motionAllowed={canAnimate} />
        <span className="flip-clock-separator" aria-hidden="true" />
        <ClockDigits digits={time.secondDigits} unit="seconds" motionAllowed={canAnimate} />
      </span>
    </time>
  );
}
