import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import RedisMock from "ioredis-mock";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import type { World, Session, SessionOverride } from "../src/adventure/domain.js";
import { ApiError } from "../src/errors.js";
import {
  requireCompletedGuestAiSession,
  reserveGuestAiSessionStart,
} from "../src/guestAiSessions.js";

const startAt = Date.UTC(2026, 10, 4, 12);
const breakPlan = { count: 1, seconds: 60 };

function emptyWorld(overrides: Partial<World> = {}): World {
  return {
    people: {}, groups: {}, sessions: {}, invites: {}, sessionOverrides: {}, ...overrides,
  } as World;
}

function completeSession(id: string, started = startAt, target = 120): Session {
  return {
    id,
    userId: `guest:${id}`,
    groupId: null,
    goal: "Ôn tập nội dung đã chọn",
    topic: "biology",
    started,
    ended: started + 180_000,
    target,
    breakPlan,
    segments: [
      { start: started, end: started + 60_000, kind: "focus" },
      { start: started + 60_000, end: started + 120_000, kind: "break" },
      { start: started + 120_000, end: started + 180_000, kind: "focus" },
    ],
    seconds: 120,
    contribution: 120,
    rules: "train-v1",
    distractions: 0,
  };
}

function fakeDb(world: World) {
  const queryDb = {
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      const sessionId = String(values[0]);
      return [{
        session: world.sessions?.[sessionId] ?? null,
        sessionOverride: world.sessionOverrides?.[sessionId] as SessionOverride | undefined ?? null,
      }];
    }),
  };
  const db = {
    ...queryDb,
    $transaction: vi.fn(async (callback: (tx: typeof queryDb) => unknown) => callback(queryDb)),
  };
  return db as unknown as PrismaClient;
}

it("creates an immutable server-time anchor bound to one credential and session ID", async () => {
  const redis = new RedisMock();
  const db = fakeDb(emptyWorld());
  const principalId = randomUUID();
  const sessionId = randomUUID();
  try {
    const first = await reserveGuestAiSessionStart(redis as unknown as Redis, db, principalId, {
      id: sessionId, target: 120, breakPlan,
    }, startAt);
    const replay = await reserveGuestAiSessionStart(redis as unknown as Redis, db, principalId, {
      id: sessionId, target: 120, breakPlan,
    }, startAt + 10_000);

    expect(first.startedAt).toBe(startAt);
    expect(replay).toEqual(first);
    await expect(reserveGuestAiSessionStart(redis as unknown as Redis, db, randomUUID(), {
      id: sessionId, target: 120, breakPlan,
    }, startAt + 20_000)).rejects.toMatchObject({ status: 404 });
    await expect(reserveGuestAiSessionStart(redis as unknown as Redis, db, principalId, {
      id: sessionId, target: 180, breakPlan,
    }, startAt + 20_000)).rejects.toMatchObject({ status: 409 });
  } finally {
    redis.disconnect();
  }
});

it("rejects a stored start record whose embedded session ID differs from its Redis key", async () => {
  const redis = new RedisMock();
  const db = fakeDb(emptyWorld());
  const principalId = randomUUID();
  const sessionId = randomUUID();
  try {
    await redis.set(`guest-ai:session:${sessionId}`, JSON.stringify({
      principalId,
      sessionId: randomUUID(),
      startedAt: startAt,
      target: 120,
      breakPlan,
      expiresAt: startAt + 7 * 24 * 60 * 60 * 1000,
    }), "EX", 60);

    await expect(reserveGuestAiSessionStart(redis as unknown as Redis, db, principalId, {
      id: sessionId, target: 120, breakPlan,
    }, startAt + 1_000)).rejects.toMatchObject({ status: 404 });
  } finally {
    redis.disconnect();
  }
});

it("requires a matching persisted guest session that completed actual study time after scheduled breaks", async () => {
  const redis = new RedisMock();
  const principalId = randomUUID();
  const sessionId = randomUUID();
  const world = emptyWorld();
  const db = fakeDb(world);
  try {
    await reserveGuestAiSessionStart(redis as unknown as Redis, db, principalId, {
      id: sessionId, target: 120, breakPlan,
    }, startAt);
    world.sessions[sessionId] = completeSession(sessionId);
    const result = await requireCompletedGuestAiSession(
      redis as unknown as Redis, db, principalId, sessionId, startAt + 180_000,
    );
    expect(result.session.id).toBe(sessionId);
    expect(result.session.target).toBe(120);
  } finally {
    redis.disconnect();
  }
});

it("rejects early-ended, parameter-mismatched, foreign, and tombstoned session records", async () => {
  const redis = new RedisMock();
  const principalId = randomUUID();
  const sessionId = randomUUID();
  const early = completeSession(sessionId);
  early.ended -= 1_000;
  early.segments[2]!.end -= 1_000;
  const world = emptyWorld();
  const db = fakeDb(world);
  try {
    await reserveGuestAiSessionStart(redis as unknown as Redis, db, principalId, {
      id: sessionId, target: 120, breakPlan,
    }, startAt);
    world.sessions[sessionId] = early;
    await expect(requireCompletedGuestAiSession(
      redis as unknown as Redis, db, principalId, sessionId, startAt + 180_000,
    )).rejects.toMatchObject({ status: 409 });

    const complete = completeSession(sessionId);
    world.sessions[sessionId] = { ...complete, target: 180 };
    await expect(requireCompletedGuestAiSession(
      redis as unknown as Redis, db, principalId, sessionId, startAt + 180_000,
    )).rejects.toMatchObject({ status: 409 });

    world.sessions[sessionId] = { ...complete, userId: "guest:another-session" };
    await expect(requireCompletedGuestAiSession(
      redis as unknown as Redis, db, principalId, sessionId, startAt + 180_000,
    )).rejects.toMatchObject({ status: 404 });

    world.sessions[sessionId] = complete;
    world.sessionOverrides![sessionId] = { version: 1, removedAt: startAt + 190_000 };
    await expect(requireCompletedGuestAiSession(
      redis as unknown as Redis, db, principalId, sessionId, startAt + 190_000,
    )).rejects.toMatchObject({ status: 410 });
  } finally {
    redis.disconnect();
  }
});

it("rejects a session that has not reached its server-computed deadline", async () => {
  const redis = new RedisMock();
  const principalId = randomUUID();
  const sessionId = randomUUID();
  const world = emptyWorld();
  const db = fakeDb(world);
  try {
    await reserveGuestAiSessionStart(redis as unknown as Redis, db, principalId, {
      id: sessionId, target: 120, breakPlan,
    }, startAt);
    world.sessions[sessionId] = completeSession(sessionId);
    await expect(requireCompletedGuestAiSession(
      redis as unknown as Redis, db, principalId, sessionId, startAt + 179_999,
    )).rejects.toBeInstanceOf(ApiError);
  } finally {
    redis.disconnect();
  }
});
