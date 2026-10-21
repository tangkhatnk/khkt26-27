import type { Segment } from "../../backend/src/adventure/domain";

export type ActiveTrip = {
  id: string;
  owner: string;
  goal: string;
  topic: string;
  document: string;
  materials?: { name: string; size: number; type: string; status: string; message: string }[];
  target: number;
  groupId: string | null;
  started: number;
  lastAt: number;
  segments: Segment[];
  state: "focus" | "away" | "reconnecting" | "paused" | "pending";
  reconnect: number;
  observedAt?: number;
  /** Number of distinct departures from the focus session, including zero-length ones. */
  distractions?: number;
};

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
  return Math.min(
    s.target,
    Math.max(0, (Math.max(now, s.lastAt, s.started) - s.started) / 1000),
  );
}

export function sessionEndAt(s: ActiveTrip, now: number): number {
  return Math.min(now, s.started + s.target * 1000);
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
  const end = Math.min(now, s.started + s.target * 1000);
  append(s, s.lastAt, end, away ? "distraction" : "focus");
  s.lastAt = now;
  s.state = away ? "away" : "focus";
  s.reconnect = 0;
  if (!away) s.observedAt = undefined;
  return s;
}

/** Mark the start of one away interval. Repeated browser events extend that interval. */
export function depart(value: ActiveTrip, now: number): ActiveTrip {
  const alreadyAway = value.state === "away" || legacyAway(value.state);
  const next = tick(value, now);
  if (alreadyAway || now < value.lastAt) return next;
  return {
    ...next,
    state: "away",
    observedAt: now,
    reconnect: 0,
    distractions: (next.distractions ?? 0) + 1,
  };
}

// Kept as the event-facing name used by older browser lifecycle wiring.
export const observe = depart;
export const leaveFocusView = depart;

export function returnFromBackground(value: ActiveTrip, now: number): ActiveTrip {
  const next = tick(value, now);
  if (now < value.lastAt || next.state !== "away") return next;
  return { ...next, state: "focus", reconnect: 0, observedAt: undefined };
}

/** Catch up saved time as away; browser lifecycle resumes only visible focus views. */
export function restore(value: ActiveTrip, now = Date.now()): ActiveTrip {
  const next = structuredClone(value);
  if (next.state === "away") {
    next.distractions ??= 1;
  } else if (legacyAway(next.state)) {
    next.distractions = Math.max(next.distractions ?? 0, 1);
  } else {
    next.state = "away";
    next.observedAt = next.lastAt;
    next.distractions = (next.distractions ?? 0) + 1;
  }
  next.state = "away";
  next.reconnect = 0;
  return tick(next, now);
}
