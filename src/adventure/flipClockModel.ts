export type FlipDigitPhase = "idle" | "top-out" | "bottom-in";

export type FlipDigitState = {
  current: string;
  previous: string | null;
  phase: FlipDigitPhase;
  transitionId: number;
};

export function splitClockTime(seconds: number) {
  const safeSeconds = Number.isFinite(seconds)
    ? Math.max(0, Math.floor(seconds))
    : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  const minuteText = String(minutes).padStart(2, "0");
  const secondText = String(remainder).padStart(2, "0");
  return {
    minuteDigits: Array.from(minuteText),
    secondDigits: Array.from(secondText),
    minutes,
    seconds: remainder,
    duration: `PT${safeSeconds}S`,
    spoken: `${minutes} phút ${remainder} giây`,
  };
}

export function advanceFlipDigit(
  state: FlipDigitState,
  next: string,
  motionAllowed: boolean,
): FlipDigitState {
  if (state.current === next) {
    return motionAllowed || state.previous === null
      ? state
      : {
          current: next,
          previous: null,
          phase: "idle",
          transitionId: state.transitionId + 1,
        };
  }
  return {
    current: next,
    previous: motionAllowed ? state.current : null,
    phase: motionAllowed ? "top-out" : "idle",
    transitionId: state.transitionId + 1,
  };
}

export function flipDigitFaces(state: FlipDigitState) {
  return {
    upper: state.current,
    lower: state.previous ?? state.current,
    topFlap: state.phase === "top-out" ? state.previous : null,
    bottomFlap: state.phase === "bottom-in" ? state.current : null,
  };
}

export function finishFlipTop(
  state: FlipDigitState,
  transitionId: number,
): FlipDigitState {
  return state.transitionId === transitionId && state.phase === "top-out" && state.previous !== null
    ? { ...state, phase: "bottom-in" }
    : state;
}

export function finishFlipDigit(
  state: FlipDigitState,
  transitionId: number,
): FlipDigitState {
  return state.transitionId === transitionId && state.phase === "bottom-in" && state.previous !== null
    ? { ...state, previous: null, phase: "idle" }
    : state;
}
