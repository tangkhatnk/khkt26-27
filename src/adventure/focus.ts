import type { MaterialSource } from "./materialSources";
import {
  breakElapsedSeconds as scheduledBreakElapsedSeconds,
  breakStatus as scheduledBreakStatus,
  breakWindowAt,
  breakWindows,
  isValidBreakPlan,
  studyElapsedSeconds,
  totalDurationSeconds as scheduledTotalDurationSeconds,
  type BreakPlan,
  type DeviceCategory,
  type Segment,
} from "../../backend/src/adventure/domain.ts";

export type ActiveTrip = {
  id: string;
  owner: string;
  goal: string;
  topic: string;
  document: string;
  materials?: { sourceId?: string; name: string; size: number; type: string; status: string; message: string }[];
  sources?: MaterialSource[];
  target: number;
  /** Fixed automatic rest schedule; absent on trips created by older versions. */
  breakPlan?: BreakPlan;
  groupId: string | null;
  started: number;
  lastAt: number;
  segments: Segment[];
  state: "focus" | "away" | "reconnecting" | "paused" | "pending";
  reconnect: number;
  observedAt?: number;
  /** Number of distinct departures from the focus session, including zero-length ones. */
  distractions?: number;
  /** Whether this current away interval has already counted as a distraction. */
  awayCounted?: boolean;
  /** Captured at trip start; absent on trips saved by older versions. */
  deviceCategory?: DeviceCategory;
};

/** Compare the current wall clock with the active trip's last accepted timestamp. */
export function isDeviceClockBehind(lastAt: number, readClock: () => number = Date.now): boolean {
  return readClock() < lastAt;
}

export function focused(s: ActiveTrip): number {
  return s.segments.reduce(
    (sum, segment) =>
      sum +
      (segment.kind === "focus" || segment.kind === "material"
        ? (segment.end - segment.start) / 1000
        : 0),
    0,
  );
}

/** Wall-clock elapsed time drives the countdown, even while the trip is away. */
export function elapsedSeconds(s: ActiveTrip, now: number): number {
  return studyElapsedSeconds(
    s.started,
    s.target,
    s.breakPlan,
    Math.max(now, s.lastAt, s.started),
  );
}

export function totalDuration(s: Pick<ActiveTrip, "target" | "breakPlan">): number {
  return scheduledTotalDurationSeconds(s.target, s.breakPlan);
}

/** Visual trip timing includes scheduled breaks and never uses credited focus time. */
export function tripSceneTiming(s: Pick<ActiveTrip, "started" | "target" | "breakPlan">, now: number) {
  const duration = totalDuration(s);
  const elapsedSeconds = Math.min(duration, Math.max(0, (now - s.started) / 1000));
  const elapsedStudySeconds = studyElapsedSeconds(s.started, s.target, s.breakPlan, now);
  const windows = breakWindows(s.started, s.target, s.breakPlan);
  const restAnchors = windows.map((window) => ({
    index: window.index,
    count: windows.length,
    elapsedStudySeconds: studyElapsedSeconds(s.started, s.target, s.breakPlan, window.start),
  }));
  return {
    elapsedSeconds,
    remainingSeconds: Math.max(0, duration - elapsedSeconds),
    elapsedStudySeconds,
    targetStudySeconds: s.target,
    restAnchors,
  };
}

export function breakStatus(s: Pick<ActiveTrip, "started" | "target" | "breakPlan">, now: number) {
  return scheduledBreakStatus(s.started, s.target, s.breakPlan, now);
}

export function breakRemainingSeconds(
  s: Pick<ActiveTrip, "started" | "target" | "breakPlan">,
  now: number,
): number {
  return breakStatus(s, now)?.remainingSeconds ?? 0;
}

export type StudyStageStatus = {
  /** Zero-based study-stage index; scheduled breaks are not stages. */
  index: number;
  /** Number of study stages, which is one more than the scheduled break count. */
  count: number;
  startedAt: number;
  endsAt: number;
  remainingSeconds: number;
};

/** Current focused-work interval, excluding scheduled break intervals. */
export function studyStageStatus(
  s: Pick<ActiveTrip, "started" | "target" | "breakPlan">,
  now: number,
): StudyStageStatus | null {
  if (
    !Number.isFinite(s.started) ||
    !Number.isFinite(s.target) ||
    s.target <= 0 ||
    !Number.isFinite(now)
  ) return null;

  const deadline = s.started + totalDuration(s) * 1000;
  if (!Number.isFinite(deadline)) return null;
  const at = Math.max(s.started, now);
  const windows = breakWindows(s.started, s.target, s.breakPlan);
  if (windows.some((window) => at >= window.start && at < window.end)) return null;

  let stageStart = s.started;
  for (let index = 0; index <= windows.length; index++) {
    const endsAt = index < windows.length ? windows[index].start : deadline;
    const isFinal = index === windows.length;
    if (at < endsAt || isFinal) {
      return {
        index,
        count: windows.length + 1,
        startedAt: stageStart,
        endsAt,
        remainingSeconds: Math.max(0, Math.ceil((endsAt - at) / 1000)),
      };
    }
    stageStart = windows[index].end;
  }
  return null;
}

export function breakElapsedSeconds(
  s: Pick<ActiveTrip, "started" | "target" | "breakPlan">,
  now: number,
): number {
  return scheduledBreakElapsedSeconds(s.started, s.target, s.breakPlan, now);
}

export function sessionEndAt(s: ActiveTrip, now: number): number {
  return Math.max(s.started, Math.min(now, s.started + totalDuration(s) * 1000));
}

function append(s: ActiveTrip, start: number, end: number, kind: Segment["kind"]) {
  if (end <= start) return;
  const tail = s.segments.at(-1);
  if (tail?.kind === kind && tail.end === start) tail.end = end;
  else s.segments.push({ start, end, kind });
}

function legacyAway(state: ActiveTrip["state"]): boolean {
  return state === "pending" || state === "paused";
}

export function tick(value: ActiveTrip, now: number): ActiveTrip {
  const s = structuredClone(value);
  if (now < s.lastAt) return s;

  const wasLegacyAway = legacyAway(s.state);
  const away = s.state === "away" || wasLegacyAway;
  const end = Math.min(now, s.started + totalDuration(s) * 1000);
  const windows = breakWindows(s.started, s.target, s.breakPlan);
  let cursor = Math.max(s.lastAt, s.started);
  let awayCounted = away ? (s.awayCounted ?? true) : true;
  while (cursor < end) {
    const currentBreak = breakWindowAt(s.started, s.target, s.breakPlan, cursor);
    if (currentBreak) {
      const segmentEnd = Math.min(end, currentBreak.end);
      append(s, cursor, segmentEnd, "break");
      cursor = segmentEnd;
      continue;
    }
    const nextBreak = windows.find((window) => window.start > cursor);
    const segmentEnd = Math.min(end, nextBreak?.start ?? end);
    if (away && !awayCounted) {
      s.distractions = (s.distractions ?? 0) + 1;
      awayCounted = true;
      s.awayCounted = true;
    }
    append(s, cursor, segmentEnd, away ? "distraction" : "focus");
    cursor = segmentEnd;
  }
  s.lastAt = now;
  s.state = away ? "away" : "focus";
  s.reconnect = 0;
  if (!away) {
    s.observedAt = undefined;
    s.awayCounted = undefined;
  }
  return s;
}

/** Mark the start of one away interval. Repeated browser events extend that interval. */
export function depart(value: ActiveTrip, now: number): ActiveTrip {
  const alreadyAway = value.state === "away" || legacyAway(value.state);
  const next = tick(value, now);
  if (alreadyAway || now < value.lastAt) return next;
  const inBreak = breakWindowAt(next.started, next.target, next.breakPlan, now) !== null;
  return {
    ...next,
    state: "away",
    observedAt: now,
    reconnect: 0,
    awayCounted: !inBreak,
    distractions: (next.distractions ?? 0) + Number(!inBreak),
  };
}

// Kept as the event-facing name used by older browser lifecycle wiring.
export const observe = depart;
export const leaveFocusView = depart;

export function returnFromBackground(value: ActiveTrip, now: number): ActiveTrip {
  const next = tick(value, now);
  if (now < value.lastAt || next.state !== "away") return next;
  return { ...next, state: "focus", reconnect: 0, observedAt: undefined, awayCounted: undefined };
}

/** Catch up saved time as away; browser lifecycle resumes only visible focus views. */
export function restore(value: ActiveTrip, now = Date.now()): ActiveTrip {
  const next = structuredClone(value);
  if (next.state === "away") {
    if (next.awayCounted === undefined) {
      next.awayCounted = true;
      next.distractions ??= 1;
    }
  } else if (legacyAway(next.state)) {
    next.distractions = Math.max(next.distractions ?? 0, 1);
    next.awayCounted = true;
  } else {
    next.state = "away";
    next.observedAt = next.lastAt;
    const beganDuringBreak = isValidBreakPlan(next.breakPlan, next.target) &&
      breakWindowAt(next.started, next.target, next.breakPlan, next.lastAt) !== null;
    next.awayCounted = !beganDuringBreak;
    next.distractions = (next.distractions ?? 0) + Number(!beganDuringBreak);
  }
  next.state = "away";
  next.reconnect = 0;
  return tick(next, now);
}
