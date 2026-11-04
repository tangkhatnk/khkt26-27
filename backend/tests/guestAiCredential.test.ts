import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import RedisMock from "ioredis-mock";
import { buildApp } from "../src/app.js";
import type { World } from "../src/adventure/domain.js";

let app: Awaited<ReturnType<typeof buildApp>>;
let redis: RedisMock;

beforeEach(async () => {
  redis = new RedisMock();
  const db = {
    user: { findUnique: async () => null },
    $queryRaw: async () => [{ state: {
      people: {}, groups: {}, sessions: {}, invites: {}, sessionOverrides: {},
    } as World }],
  } as unknown as PrismaClient;
  app = await buildApp({ db, redis: redis as unknown as Redis, logger: false });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  redis.disconnect();
});

describe("POST /api/v1/ai/guest/credential", () => {
  it("issues a server-created opaque credential without creating an account", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/ai/guest/credential",
      payload: {},
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { token: string; expiresAt: string };
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(Number.isNaN(Date.parse(body.expiresAt))).toBe(false);
    const keys = await redis.keys("guest-ai:credential:*");
    expect(keys).toHaveLength(1);
    expect(keys.join("")).not.toContain(body.token);
    const values = await redis.mget(...keys);
    expect(values.join("")).not.toContain(body.token);
  });

  it("rejects a caller-supplied owner and never accepts the guest credential on account routes", async () => {
    const forged = await app.inject({
      method: "POST",
      url: "/api/v1/ai/guest/credential",
      payload: { ownerId: "00000000-0000-4000-8000-000000000001" },
    });
    expect(forged.statusCode).toBe(400);

    const issued = await app.inject({
      method: "POST",
      url: "/api/v1/ai/guest/credential",
      payload: {},
    });
    const { token } = issued.json() as { token: string };
    const guestScheme = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      headers: { authorization: `GuestAI ${token}` },
    });
    expect(guestScheme.statusCode).toBe(401);

    const bearerScheme = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(bearerScheme.statusCode).toBe(401);
  });

  it("starts an AI-gated session with a server timestamp and fixed timer plan", async () => {
    const issued = await app.inject({
      method: "POST",
      url: "/api/v1/ai/guest/credential",
      payload: {},
    });
    const { token } = issued.json() as { token: string };
    const id = "00000000-0000-4000-8000-000000000002";
    const started = await app.inject({
      method: "POST",
      url: "/api/v1/ai/guest/sessions/start",
      headers: { authorization: `GuestAI ${token}` },
      payload: { id, target: 180, breakPlan: { count: 1, seconds: 60 } },
    });

    expect(started.statusCode).toBe(200);
    expect(started.json()).toMatchObject({
      sessionId: id,
      target: 180,
      breakPlan: { count: 1, seconds: 60 },
    });
    expect(Number.isSafeInteger(started.json().startedAt)).toBe(true);

    const otherCredential = await app.inject({
      method: "POST",
      url: "/api/v1/ai/guest/credential",
      payload: {},
    });
    const otherToken = (otherCredential.json() as { token: string }).token;
    const otherPrincipal = await app.inject({
      method: "POST",
      url: "/api/v1/ai/guest/sessions/start",
      headers: { authorization: `GuestAI ${otherToken}` },
      payload: { id, target: 180, breakPlan: { count: 1, seconds: 60 } },
    });
    expect(otherPrincipal.statusCode).toBe(404);

    const callerClock = await app.inject({
      method: "POST",
      url: "/api/v1/ai/guest/sessions/start",
      headers: { authorization: `GuestAI ${token}` },
      payload: { id: "00000000-0000-4000-8000-000000000003", target: 180, startedAt: 1 },
    });
    expect(callerClock.statusCode).toBe(400);
  });
});
