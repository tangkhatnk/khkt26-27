import type { QuizAssessment } from "./quizAssessment.js";
export const RULES = "train-v1";
export const DEVICE_CATEGORIES = ["pc", "ios", "android", "tablet", "unknown"] as const;
export type DeviceCategory = (typeof DEVICE_CATEGORIES)[number];
export type BreakPlan = { count: number; seconds: number };
export const MAX_BREAK_COUNT = 10;
export const MIN_BREAK_SECONDS = 60;
export const MAX_BREAK_SECONDS = 1800;
export type BreakWindow = { index: number; start: number; end: number };

export function isValidBreakPlan(value: unknown, target: unknown): value is BreakPlan {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const plan = value as Record<string, unknown>;
  return typeof target === "number" && Number.isSafeInteger(target) && target >= 60 &&
    typeof plan.count === "number" && Number.isSafeInteger(plan.count) && plan.count >= 0 &&
    plan.count <= MAX_BREAK_COUNT &&
    typeof plan.seconds === "number" && Number.isSafeInteger(plan.seconds) && plan.seconds >= MIN_BREAK_SECONDS &&
    plan.seconds <= MAX_BREAK_SECONDS && plan.count < Math.floor(target / 60);
}

export function totalDurationSeconds(target: number, plan?: BreakPlan): number {
  const safeTarget = Number.isFinite(target) && target > 0 ? target : 0;
  return safeTarget + (plan && isValidBreakPlan(plan, safeTarget) ? plan.count * plan.seconds : 0);
}

export function breakWindows(started: number, target: number, plan?: BreakPlan): BreakWindow[] {
  if (!Number.isFinite(started) || !plan || !isValidBreakPlan(plan, target)) return [];
  return Array.from({ length: plan.count }, (_, offset) => {
    const index = offset + 1;
    const studyOffset = Math.round((index * target * 1000) / (plan.count + 1));
    const start = started + studyOffset + offset * plan.seconds * 1000;
    return { index, start, end: start + plan.seconds * 1000 };
  });
}

export function breakElapsedSeconds(
  started: number,
  target: number,
  plan: BreakPlan | undefined,
  at: number,
): number {
  if (!Number.isFinite(at)) return 0;
  return breakWindows(started, target, plan).reduce(
    (sum, window) => sum + Math.max(0, Math.min(at, window.end) - window.start) / 1000,
    0,
  );
}

export function studyElapsedSeconds(
  started: number,
  target: number,
  plan: BreakPlan | undefined,
  at: number,
): number {
  if (!Number.isFinite(started) || !Number.isFinite(at) || !Number.isFinite(target)) return 0;
  const wallSeconds = Math.max(0, Math.max(at, started) - started) / 1000;
  return Math.min(target, Math.max(0, wallSeconds - breakElapsedSeconds(started, target, plan, at)));
}

/** One projection for owner history, admin reports, and public tester metrics. */
export function projectSessionMetrics<T extends SessionProjectionSource>(
  session: T,
  override?: SessionOverride,
): T & ProjectedSession {
  const measuredTarget = session.target;
  const target = override?.targetSeconds ?? measuredTarget;
  const plan = session.breakPlan && isValidBreakPlan(session.breakPlan, measuredTarget)
    ? session.breakPlan
    : undefined;
  const wallSeconds = Math.max(0, (session.ended - session.started) / 1000);
  const plannedBreakSeconds = plan ? plan.count * plan.seconds : 0;
  const segmentBreakSeconds = session.segments.reduce((sum, segment) => {
    if (segment.kind !== "break") return sum;
    const start = Math.max(session.started, segment.start);
    const end = Math.min(session.ended, segment.end);
    return sum + Math.max(0, end - start) / 1000;
  }, 0);
  const derivedBreakSeconds = plan
    ? breakElapsedSeconds(session.started, measuredTarget, plan, session.ended)
    : Math.min(wallSeconds, segmentBreakSeconds);
  const cappedWallElapsed = Math.min(totalDurationSeconds(measuredTarget, plan), wallSeconds);
  const actualStudySeconds = plan
    ? studyElapsedSeconds(session.started, measuredTarget, plan, session.ended)
    : Math.min(measuredTarget, Math.max(0, wallSeconds - derivedBreakSeconds));
  const elapsedSeconds = Math.max(cappedWallElapsed, actualStudySeconds + derivedBreakSeconds);
  const segmentFocusSeconds = session.segments.reduce((sum, segment) =>
    segment.kind === "focus" || segment.kind === "material"
      ? sum + Math.max(0, segment.end - segment.start) / 1000
      : sum, 0);
  const measuredFocus = Math.min(measuredTarget, session.seconds ?? segmentFocusSeconds);
  const effectiveStudySeconds = override?.actualStudySeconds ?? actualStudySeconds;
  const effectiveFocusedSeconds = override?.focusedSeconds ?? measuredFocus;
  const quiz = session.quiz && session.quiz.score <= session.quiz.total ? session.quiz : undefined;
  const effectiveQuiz = override?.quizResult ?? quiz;
  const metrics: SessionMetrics = {
    targetSeconds: target,
    elapsedSeconds: override?.elapsedSeconds ?? elapsedSeconds,
    actualStudySeconds: effectiveStudySeconds,
    focusedSeconds: effectiveFocusedSeconds,
    plannedBreakSeconds,
    actualBreakSeconds: override?.actualBreakSeconds ?? derivedBreakSeconds,
    distractions: override?.distractions ?? session.distractions ??
      session.segments.filter((segment) => segment.kind === "distraction").length,
    completed: effectiveStudySeconds >= target,
    quizScore: effectiveQuiz?.score ?? null,
    quizTotal: effectiveQuiz?.total ?? null,
  };
  const correctionFlags: SessionCorrectionFlags = {
    goal: override?.goal !== undefined,
    topic: override?.topic !== undefined,
    targetSeconds: override?.targetSeconds !== undefined,
    elapsedSeconds: override?.elapsedSeconds !== undefined,
    actualStudySeconds: override?.actualStudySeconds !== undefined,
    focusedSeconds: override?.focusedSeconds !== undefined,
    actualBreakSeconds: override?.actualBreakSeconds !== undefined,
    distractions: override?.distractions !== undefined,
    quizResult: override?.quizResult !== undefined,
  };
  return {
    ...session,
    goal: override?.goal ?? session.goal ?? "",
    topic: override?.topic ?? session.topic,
    target,
    correctionVersion: override?.version ?? 0,
    effectiveMetrics: metrics,
    correctionFlags,
  };
}

export function isSessionRemoved(world: World, sessionId: string): boolean {
  return world.sessionOverrides?.[sessionId]?.removedAt !== undefined;
}

export function breakWindowAt(
  started: number,
  target: number,
  plan: BreakPlan | undefined,
  at: number,
): BreakWindow | null {
  return breakWindows(started, target, plan).find((window) => at >= window.start && at < window.end) ?? null;
}

export function breakStatus(
  started: number,
  target: number,
  plan: BreakPlan | undefined,
  at: number,
) {
  const window = breakWindowAt(started, target, plan, at);
  return window
    ? {
        index: window.index,
        count: plan!.count,
        startedAt: window.start,
        endsAt: window.end,
        remainingSeconds: Math.max(0, Math.ceil((window.end - at) / 1000)),
      }
    : null;
}

export type Segment = {
  start: number;
  end: number;
  kind: "focus" | "material" | "break" | "distraction";
};
export type Journey = {
  seconds: number;
  station: number;
  threshold: number;
  remaining: number;
  branch: "mountain" | "coast";
  votes: Record<string, "mountain" | "coast">;
  voteUntil: number | null;
  journal: { at: number; text: string }[];
};
export type Person = {
  name: string;
  color: string;
  decor: string;
  seconds: number;
  groupId: string | null;
  joinedAt: number;
  journey: Journey;
};
export type TripParticipantStatus = "ready" | "bound" | "completed" | "skipped";
export type GroupTrip = {
  status: "waiting" | "departed" | "closed";
  goal: string;
  topic: string;
  target: number;
  participants: Record<string, {
    status: TripParticipantStatus;
    sessionId?: string;
  }>;
};
export type Group = {
  id: string;
  name: string;
  owner: string;
  members: string[];
  timezone: string;
  archived: boolean;
  journey: Journey;
  daily: Record<string, number>;
  membershipHistory?: Record<string, { joined: number; left: number | null }[]>;
  /** New groups use this tagged record for one shared trip; absent on legacy groups. */
  trip?: GroupTrip;
};
export type Session = {
  id: string;
  userId: string;
  groupId: string | null;
  goal: string;
  topic: string;
  started: number;
  ended: number;
  target: number;
  segments: Segment[];
  seconds: number;
  contribution: number;
  rules: string;
  /** Distinct departures from focus, including departures shorter than one millisecond. */
  distractions?: number;
  /** Coarse category captured when the trip began; absent on legacy trips. */
  deviceCategory?: DeviceCategory;
  /** Fixed wall-clock rest schedule; absent on legacy trips. */
  breakPlan?: BreakPlan;
  quiz?: QuizAssessment;
};
export type SessionQuizResult = { score: number; total: number };
export type SessionOverride = {
  version: number;
  removedAt?: number;
  removedOwnerId?: string;
  goal?: string;
  topic?: string;
  targetSeconds?: number;
  elapsedSeconds?: number;
  actualStudySeconds?: number;
  focusedSeconds?: number;
  actualBreakSeconds?: number;
  distractions?: number;
  quizResult?: SessionQuizResult;
};
export type SessionMetrics = {
  targetSeconds: number;
  elapsedSeconds: number;
  actualStudySeconds: number;
  focusedSeconds: number;
  plannedBreakSeconds: number;
  actualBreakSeconds: number;
  distractions: number;
  completed: boolean;
  quizScore: number | null;
  quizTotal: number | null;
};
export type SessionProjectionSource = Pick<Session, "topic" | "started" | "ended" | "target" | "segments"> &
  Partial<Pick<Session, "id" | "userId" | "groupId" | "goal" | "seconds" | "distractions" | "breakPlan" | "quiz">>;
export type ProjectedSession = SessionProjectionSource & {
  correctionVersion: number;
  effectiveMetrics: SessionMetrics;
  correctionFlags: SessionCorrectionFlags;
};
export type SessionCorrectionField =
  | "goal"
  | "topic"
  | "targetSeconds"
  | "elapsedSeconds"
  | "actualStudySeconds"
  | "focusedSeconds"
  | "actualBreakSeconds"
  | "distractions"
  | "quizResult";
export type SessionCorrectionFlags = Record<SessionCorrectionField, boolean>;
export type World = {
  revision?: number;
  people: Record<string, Person>;
  groups: Record<string, Group>;
  sessions: Record<string, Session>;
  sessionOverrides?: Record<string, SessionOverride>;
  invites: Record<
    string,
    { groupId: string; expires: number; revoked: boolean }
  >;
};
export const emptyWorld = (): World => ({
  people: {},
  groups: {},
  sessions: {},
  sessionOverrides: {},
  invites: {},
});
export const journey = (members = 1): Journey => ({
  seconds: 0,
  station: 0,
  threshold: 1800 * Math.min(members, 3),
  remaining: 0,
  branch: "mountain",
  votes: {},
  voteUntil: null,
  journal: [],
});
export function person(world: World, id: string): Person {
  return (world.people[id] ??= {
    name: "Toa Mây",
    color: "#398575",
    decor: "plant",
    seconds: 0,
    groupId: null,
    joinedAt: 0,
    journey: journey(),
  });
}
export function advance(
  j: Journey,
  seconds: number,
  members: number,
  now: number,
) {
  j.seconds += seconds;
  j.remaining += seconds;
  while (j.station < 4 && j.remaining >= j.threshold) {
    j.remaining -= j.threshold;
    j.station++;
    j.journal.unshift({
      at: now,
      text: `Đã đến ${["Ga Khởi đầu", "Đồng cỏ Gió", "Rừng Sương mù", "Đèo Ánh sao", "Thành phố Bình minh"][j.station]}.`,
    });
    if (j.station === 2) j.voteUntil = now + 86400000;
    j.threshold = 1800 * Math.min(members, 3);
  }
  j.journal = j.journal.slice(0, 100);
}
export function resolveVote(j: Journey, now: number) {
  if (j.voteUntil !== null && now >= j.voteUntil) {
    const votes = Object.values(j.votes);
    j.branch =
      votes.filter((v) => v === "coast").length >
      votes.filter((v) => v === "mountain").length
        ? "coast"
        : "mountain";
    j.voteUntil = null;
  }
}
function dayKey(time: number, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(time);
}
// Split at calendar boundaries, including DST. Binary search avoids assumptions
// about 24-hour days or the UTC offset of the group's IANA timezone.
export function byDay(
  start: number,
  end: number,
  timezone: string,
): [string, number][] {
  const result: [string, number][] = [];
  while (start < end) {
    const key = dayKey(start, timezone);
    let boundary = end;
    if (dayKey(end - 1, timezone) !== key) {
      let low = start + 1,
        high = end;
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (dayKey(mid, timezone) === key) low = mid + 1;
        else high = mid;
      }
      boundary = low;
    }
    result.push([key, (boundary - start) / 1000]);
    start = boundary;
  }
  return result;
}
export function settle(
  world: World,
  input: Omit<Session, "seconds" | "contribution" | "rules">,
  now: number,
): Session {
  const prior = world.sessions[input.id];
  if (prior) {
    if (prior.userId !== input.userId)
      throw new Error("Mã phiên đã được sử dụng.");
    return prior;
  }
  if (
    input.ended > now + 5000 ||
    input.started < now - 30 * 86400000 ||
    input.ended < input.started
  )
    throw new Error(
      "Thời gian phiên không hợp lệ (đồng bộ trong 30 ngày từ lúc bắt đầu).",
    );
  if (input.breakPlan !== undefined) {
    if (!isValidBreakPlan(input.breakPlan, input.target))
      throw new Error("Kế hoạch nghỉ không hợp lệ.");
    const deadline = input.started + totalDurationSeconds(input.target, input.breakPlan) * 1000;
    if (input.ended > deadline)
      throw new Error("Thời gian phiên vượt thời lượng nghỉ đã chọn.");
    const windows = breakWindows(input.started, input.target, input.breakPlan);
    for (const segment of input.segments) {
      if (segment.kind === "break") {
        if (!windows.some(
          (window) => segment.start >= window.start && segment.end <= window.end,
        )) throw new Error("Khoảng nghỉ không theo kế hoạch đã chọn.");
      } else if (windows.some(
        (window) => segment.start < window.end && segment.end > window.start,
      )) {
        throw new Error("Khoảng học hoặc rời phiên trùng thời gian nghỉ theo kế hoạch.");
      }
    }
    const breakSegments = input.segments.filter((segment) => segment.kind === "break")
      .slice().sort((a, b) => a.start - b.start);
    for (const window of windows) {
      const requiredEnd = Math.min(input.ended, window.end);
      if (requiredEnd <= window.start) continue;
      let coveredUntil = window.start;
      for (const segment of breakSegments) {
        if (segment.end <= coveredUntil) continue;
        if (segment.start > coveredUntil) break;
        coveredUntil = Math.min(requiredEnd, segment.end);
        if (coveredUntil >= requiredEnd) break;
      }
      if (coveredUntil < requiredEnd)
        throw new Error("Khoảng nghỉ theo kế hoạch chưa được ghi nhận.");
    }
  }
  if (
    input.distractions !== undefined &&
    (!Number.isSafeInteger(input.distractions) || input.distractions < 0)
  )
    throw new Error("Số lần rời phiên không hợp lệ.");
  for (const s of Object.values(world.sessions)) {
    if (
      s.userId === input.userId &&
      input.started < s.ended &&
      input.ended > s.started
    )
      throw new Error("Phiên bị chồng với thời gian đã ghi nhận.");
  }
  let last = input.started,
    seconds = 0;
  for (const segment of input.segments) {
    if (
      segment.start < last ||
      segment.end <= segment.start ||
      segment.end > input.ended
    )
      throw new Error("Khoảng học bị chồng hoặc ngoài phiên.");
    last = segment.end;
    if (segment.kind === "focus" || segment.kind === "material")
      seconds += (segment.end - segment.start) / 1000;
  }
  if (seconds > input.target + 1)
    throw new Error("Thời gian học vượt mục tiêu.");
  const p = person(world, input.userId);
  const tripBinding = Object.values(world.groups).find((group) =>
    Object.values(group.trip?.participants ?? {}).some((participant) => participant.sessionId === input.id),
  );
  const tripGroup = input.groupId ? world.groups[input.groupId] : null;
  const participant = tripGroup?.trip?.participants[input.userId];
  const boundParticipant = tripBinding?.trip?.participants[input.userId];
  if (tripBinding && boundParticipant?.sessionId !== input.id)
    throw new Error("Mã phiên đã được liên kết với thành viên khác.");
  if (tripBinding && tripBinding.id !== input.groupId)
    throw new Error("Phiên đã được liên kết với một chuyến khác.");
  if (tripGroup?.trip) {
    if (
      tripGroup.trip.status !== "departed" ||
      tripGroup.archived ||
      p.groupId !== tripGroup.id ||
      !tripGroup.members.includes(input.userId) ||
      participant?.status !== "bound" ||
      participant.sessionId !== input.id
    )
      throw new Error("Phiên chưa được liên kết hợp lệ với chuyến này.");
    if (
      input.goal !== tripGroup.trip.goal ||
      input.topic !== tripGroup.trip.topic ||
      input.target !== tripGroup.trip.target
    )
      throw new Error("Mục tiêu, chủ đề hoặc thời lượng không khớp với chuyến đã lập.");
  } else if (!input.groupId && tripBinding) {
    throw new Error("Phiên cần được lưu theo chuyến đã liên kết.");
  }
  let contribution = seconds;
  if (input.groupId) {
    const group = tripGroup;
    const membership =
      group?.membershipHistory?.[input.userId]?.find(
        (m) =>
          input.started >= m.joined &&
          (m.left === null || input.started < m.left),
      ) ??
      (group?.members.includes(input.userId) &&
      p.groupId === group.id &&
      input.started >= p.joinedAt
        ? { joined: p.joinedAt, left: null }
        : null);
    if (!group || !membership)
      throw new Error("Bạn không thuộc đoàn tại thời điểm bắt đầu phiên.");
    contribution = 0;
    for (const s of input.segments.filter(
      (s) => s.kind === "focus" || s.kind === "material",
    )) {
      for (const [day, amount] of byDay(
        s.start,
        Math.min(s.end, membership.left ?? s.end),
        group.timezone,
      )) {
        const key = `${input.userId}:${day}`,
          used = group.daily[key] ?? 0;
        const credited = Math.max(0, Math.min(amount, 3600 - used));
        group.daily[key] = used + credited;
        contribution += credited;
      }
    }
    advance(
      group.journey,
      contribution,
      Math.max(1, group.members.length),
      now,
    );
  } else advance(p.journey, seconds, 1, now);
  p.seconds += seconds;
  const session: Session = {
    ...input,
    seconds,
    contribution,
    rules: RULES,
    distractions:
      input.distractions ??
      input.segments.filter((segment) => segment.kind === "distraction").length,
  };
  world.sessions[input.id] = session;
  if (tripGroup?.trip && participant) {
    participant.status = "completed";
    const history = tripGroup.membershipHistory?.[input.userId];
    const membership = history?.slice().reverse().find((item) => item.left === null);
    if (membership) membership.left = now;
    p.groupId = null;
    if (Object.values(tripGroup.trip.participants).every((member) =>
      member.status === "completed" || member.status === "skipped",
    )) {
      tripGroup.trip.status = "closed";
      tripGroup.archived = true;
    }
  }
  return session;
}
export function snapshot(world: World, userId: string, now: number) {
  const p = person(world, userId);
  resolveVote(p.journey, now);
  const g = p.groupId ? world.groups[p.groupId] : null;
  if (g) resolveVote(g.journey, now);
  const ownTripSessionId = g?.trip?.participants[userId]?.status === "bound"
    ? g.trip.participants[userId]?.sessionId
    : undefined;
  const ownedSessions = Object.values(world.sessions).filter((session) => session.userId === userId);
  const removedOwnedSessionIds = ownedSessions
    .filter((session) => isSessionRemoved(world, session.id))
    .sort((a, b) => b.ended - a.ended)
    .map((session) => session.id);
  const removedOrphanSessionIds = Object.entries(world.sessionOverrides ?? {})
    .filter(([sessionId, override]) =>
      world.sessions[sessionId] === undefined &&
      override.removedAt !== undefined &&
      override.removedOwnerId === userId,
    )
    .map(([sessionId]) => sessionId)
    .sort();
  return {
    revision: world.revision ?? 0,
    person: p,
    group: g
      ? {
          id: g.id,
          name: g.name,
          owner: g.owner,
          timezone: g.timezone,
          journey: g.journey,
          members: g.members.map((id) => ({
            id,
            name: person(world, id).name,
            color: person(world, id).color,
            decor: person(world, id).decor,
            ...(g.trip ? { tripStatus: g.trip.participants[id]?.status ?? "ready" } : {}),
          })),
          ...(g.trip ? { trip: {
            status: g.trip.status,
            goal: g.trip.goal,
            topic: g.trip.topic,
            target: g.trip.target,
            ...(ownTripSessionId ? { ownSessionId: ownTripSessionId } : {}),
          } } : {}),
        }
      : null,
    sessions: ownedSessions
      .filter((session) => !isSessionRemoved(world, session.id))
      .map((session) => projectSessionMetrics(session, world.sessionOverrides?.[session.id]))
      .sort((a, b) => b.ended - a.ended),
    removedSessionIds: [...removedOwnedSessionIds, ...removedOrphanSessionIds],
    rules: RULES,
  };
}
export type Snapshot = ReturnType<typeof snapshot>;
