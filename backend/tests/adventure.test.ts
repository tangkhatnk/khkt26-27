import { describe, it, expect } from "vitest";
import {
  advance,
  byDay,
  emptyWorld,
  journey,
  person,
  resolveVote,
  settle,
  snapshot,
  type Session,
} from "../src/adventure/domain.js";
const now = Date.parse("2026-10-07T12:00:00Z");
const input = (
  id = "one",
  start = now - 60000,
  end = now,
): Omit<Session, "seconds" | "contribution" | "rules"> => ({
  id,
  userId: "u",
  groupId: null,
  goal: "Study",
  topic: "biology",
  started: start,
  ended: end,
  target: 3600,
  segments: [{ start, end, kind: "focus" }],
});
describe("adventure progress", () => {
  it("saves study around a multi-day break without crediting the break", () => {
    const start = now - 2 * 86400000;
    const s = { ...input("long-break", start, now), segments: [
      { start, end: start + 60000, kind: "focus" as const },
      { start: start + 60000, end: now - 60000, kind: "break" as const },
      { start: now - 60000, end: now, kind: "focus" as const },
    ] };
    const world = emptyWorld();
    expect(settle(world, s, now).seconds).toBe(120);
    expect(person(world, "u").journey.seconds).toBe(120);
    expect(settle(world, s, now).seconds).toBe(120);
  });
  it("credits incomplete sessions and rejects overlap without giving duplicate rewards", () => {
    const world = emptyWorld();
    settle(world, input(), now);
    settle(world, input(), now);
    expect(person(world, "u").seconds).toBe(60);
    expect(() => settle(world, input("two"), now)).toThrow("chồng");
    expect(() => settle(world, { ...input(), userId: "other" }, now)).toThrow(
      "sử dụng",
    );
  });
  it("preserves the distinct distraction count even when a departure has no duration", () => {
    const world = emptyWorld();
    const result = settle(world, { ...input(), distractions: 2 }, now);

    expect(result.distractions).toBe(2);
    expect(snapshot(world, "u", now).sessions[0]?.distractions).toBe(2);
    expect(() => settle(emptyWorld(), { ...input(), distractions: -1 }, now)).toThrow(
      "Số lần rời phiên",
    );

    const legacy = {
      ...input("legacy"),
      segments: [
        { start: now - 60000, end: now - 30000, kind: "focus" as const },
        { start: now - 30000, end: now - 20000, kind: "distraction" as const },
        { start: now - 20000, end: now, kind: "focus" as const },
      ],
    };
    expect(settle(emptyWorld(), legacy, now).distractions).toBe(1);
  });
  it("persists a device category and keeps the original value on an idempotent replay", () => {
    const world = emptyWorld();
    const first = settle(world, { ...input("device-trip"), deviceCategory: "ios" }, now);
    const replay = settle(world, { ...input("device-trip"), deviceCategory: "pc" }, now);

    expect(first.deviceCategory).toBe("ios");
    expect(replay.deviceCategory).toBe("ios");
    expect(snapshot(world, "u", now).sessions[0]?.deviceCategory).toBe("ios");
  });
  it("carries fractions between sessions instead of rounding each contribution", () => {
    const w = emptyWorld();
    settle(w, input("a", now - 60000, now - 30000), now);
    settle(w, input("b", now - 30000, now), now);
    expect(person(w, "u").journey.seconds).toBe(60);
  });
  it("excludes breaks and distraction, rejects overlapping segments and future clocks", () => {
    const w = emptyWorld(),
      s = input();
    s.segments = [
      { start: now - 60000, end: now - 30000, kind: "focus" },
      { start: now - 30000, end: now, kind: "break" },
    ];
    expect(settle(w, s, now).seconds).toBe(30);
    expect(() =>
      settle(
        emptyWorld(),
        {
          ...s,
          segments: [
            ...s.segments,
            { start: now - 40000, end: now, kind: "focus" },
          ],
        },
        now,
      ),
    ).toThrow("chồng");
    expect(() =>
      settle(emptyWorld(), input("future", now, now + 60000), now),
    ).toThrow("Thời gian");
  });
  it("accepts scheduled break segments without awarding XP for rest", () => {
    const start = now - 3660000;
    const breakStart = start + 1800000;
    const value = {
      ...input("planned-break", start, now),
      target: 3600,
      breakPlan: { count: 1, seconds: 60 },
      segments: [
        { start, end: breakStart, kind: "focus" as const },
        { start: breakStart, end: breakStart + 60000, kind: "break" as const },
        { start: breakStart + 60000, end: now, kind: "focus" as const },
      ],
    };
    const world = emptyWorld();
    const result = settle(world, value, now);

    expect(result.seconds).toBe(3600);
    expect(result.contribution).toBe(3600);
    expect(person(world, "u").seconds).toBe(3600);
    expect(result.breakPlan).toEqual({ count: 1, seconds: 60 });
  });
  it("rejects invalid break counts, unplanned rest segments, and time past the plan", () => {
    const start = now - 120000;
    const base = {
      ...input("break-invalid", start, now),
      target: 120,
      breakPlan: { count: 1, seconds: 60 },
      segments: [
        { start, end: start + 60000, kind: "focus" as const },
        { start: start + 60000, end: now, kind: "break" as const },
      ],
    };

    expect(() => settle(emptyWorld(), { ...base, breakPlan: { count: 2, seconds: 60 } }, now))
      .toThrow(/kế hoạch nghỉ/i);
    expect(() => settle(emptyWorld(), { ...base, breakPlan: { count: 0, seconds: 60 } }, now))
      .toThrow(/không theo kế hoạch/i);
    const deadline = start + 180000;
    expect(() => settle(emptyWorld(), { ...base, ended: deadline + 1, segments: [] }, deadline + 1))
      .toThrow(/thời lượng nghỉ/i);
  });
  it("rejects focus, material, and distraction claims during scheduled rest", () => {
    const start = now - 120000;
    const base = {
      ...input("break-credit", start, now),
      target: 120,
      breakPlan: { count: 1, seconds: 60 },
      segments: [
        { start, end: start + 60000, kind: "focus" as const },
        { start: start + 60000, end: now, kind: "focus" as const },
      ],
    };

    for (const kind of ["focus", "material", "distraction"] as const) {
      const segments = [
        { start, end: start + 60000, kind: "focus" as const },
        { start: start + 60000, end: now, kind },
      ];
      expect(() => settle(emptyWorld(), { ...base, segments }, now)).toThrow(/trùng thời gian nghỉ/i);
    }
  });
  it("applies the group cap without removing individual XP and keeps member data private", () => {
    const w = emptyWorld(),
      p = person(w, "u");
    p.groupId = "g";
    p.joinedAt = now - 86400000;
    w.groups.g = {
      id: "g",
      name: "Group",
      owner: "u",
      members: ["u", "v"],
      timezone: "Asia/Ho_Chi_Minh",
      archived: false,
      journey: journey(2),
      daily: {},
    };
    settle(
      w,
      { ...input("a", now - 7200000, now - 3600000), groupId: "g" },
      now,
    );
    settle(w, { ...input("b", now - 3600000, now), groupId: "g" }, now);
    expect(p.seconds).toBe(7200);
    expect(w.groups.g.journey.seconds).toBe(3600);
    const publicGroup = snapshot(w, "v", now).group;
    expect(JSON.stringify(publicGroup)).not.toContain("Study");
    expect(snapshot(w, "v", now).sessions).toHaveLength(0);
  });
  it("splits contribution at local midnight, including DST days", () => {
    const start = Date.parse("2026-10-07T16:59:00Z"),
      end = start + 120000;
    expect(byDay(start, end, "Asia/Ho_Chi_Minh").map((v) => v[1])).toEqual([
      60, 60,
    ]);
    const spring = Date.parse("2026-03-08T05:00:00Z");
    expect(
      byDay(spring, spring + 24 * 3600000, "America/New_York").map((v) => v[1]),
    ).toEqual([23 * 3600, 3600]);
  });
  it("locks thresholds within a stage and retains surplus at the terminus", () => {
    const j = journey(2);
    advance(j, 1800, 6, now);
    expect(j.station).toBe(0);
    expect(j.threshold).toBe(3600);
    advance(j, 1800, 6, now);
    expect(j.station).toBe(1);
    expect(j.threshold).toBe(5400);
    advance(j, 50000, 6, now);
    expect(j.station).toBe(4);
    expect(j.remaining).toBeGreaterThan(0);
  });
  it("rejects contributions to a group before joining and resolves tied votes predictably", () => {
    const w = emptyWorld(),
      p = person(w, "u");
    p.groupId = "g";
    p.joinedAt = now;
    w.groups.g = {
      id: "g",
      name: "Group",
      owner: "u",
      members: ["u"],
      timezone: "UTC",
      archived: false,
      journey: journey(),
      daily: {},
    };
    expect(() => settle(w, { ...input(), groupId: "g" }, now)).toThrow(
      "không thuộc",
    );
    const j = journey();
    j.voteUntil = now;
    j.votes = { a: "mountain", b: "coast" };
    resolveVote(j, now);
    expect(j.branch).toBe("mountain");
  });
  it("settles offline study after leaving without crediting time beyond membership", () => {
    const w = emptyWorld();
    person(w, "u").groupId = null;
    w.groups.g = {
      id: "g",
      name: "Past group",
      owner: "v",
      members: ["v"],
      timezone: "UTC",
      archived: false,
      journey: journey(),
      daily: {},
      membershipHistory: { u: [{ joined: now - 60000, left: now - 30000 }] },
    };
    const result = settle(w, { ...input(), groupId: "g" }, now);
    expect(result.seconds).toBe(60);
    expect(result.contribution).toBe(30);
    expect(person(w, "u").seconds).toBe(60);
    expect(w.groups.g.journey.seconds).toBe(30);
    expect(settle(w, { ...input(), groupId: "g" }, now).contribution).toBe(30);
  });
});
