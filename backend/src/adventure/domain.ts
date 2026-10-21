export const RULES = "train-v1";
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
  quiz?: { score: number; total: number };
};
export type World = {
  revision?: number;
  people: Record<string, Person>;
  groups: Record<string, Group>;
  sessions: Record<string, Session>;
  invites: Record<
    string,
    { groupId: string; expires: number; revoked: boolean }
  >;
};
export const emptyWorld = (): World => ({
  people: {},
  groups: {},
  sessions: {},
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
  let contribution = seconds;
  if (input.groupId) {
    const group = world.groups[input.groupId];
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
  return session;
}
export function snapshot(world: World, userId: string, now: number) {
  const p = person(world, userId);
  resolveVote(p.journey, now);
  const g = p.groupId ? world.groups[p.groupId] : null;
  if (g) resolveVote(g.journey, now);
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
          })),
        }
      : null,
    sessions: Object.values(world.sessions)
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.ended - a.ended),
    rules: RULES,
  };
}
export type Snapshot = ReturnType<typeof snapshot>;
