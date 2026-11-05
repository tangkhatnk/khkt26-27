import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Redis } from "ioredis";
import RedisMock from "ioredis-mock";
import { issueGuestAiCredential, verifyGuestAiCredential } from "../src/guestAiAuth.js";
import { ApiError } from "../src/errors.js";

const redis = new RedisMock();
const quotaClock = new Date(Date.UTC(2026, 10, 4, 12));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(quotaClock);
});
afterEach(async () => {
  await redis.flushall();
  vi.useRealTimers();
});

it("enforces issuance caps atomically by socket IP and globally", async () => {
  const limits = { perIpDaily: 4, globalDaily: 10 };
  const now = Date.now();
  const issued = await Promise.allSettled(Array.from({ length: 20 }, () =>
    issueGuestAiCredential(redis as unknown as Redis, "198.51.100.7", now, limits),
  ));

  expect(issued.filter(result => result.status === "fulfilled")).toHaveLength(4);
  expect(issued.filter(result => result.status === "rejected" &&
    result.reason instanceof ApiError && result.reason.status === 429)).toHaveLength(16);
});

it("accepts only the GuestAI scheme and refuses an expired opaque credential", async () => {
  const created = await issueGuestAiCredential(redis as unknown as Redis, "198.51.100.8");
  await expect(verifyGuestAiCredential(redis as unknown as Redis, `GuestAI ${created.token}`))
    .resolves.toMatch(/^[0-9a-f-]{36}$/u);
  await expect(verifyGuestAiCredential(redis as unknown as Redis, `Bearer ${created.token}`))
    .rejects.toMatchObject({ status: 401 });

  const expired = await issueGuestAiCredential(
    redis as unknown as Redis,
    "198.51.100.9",
    Date.now() - 8 * 24 * 60 * 60 * 1000,
  );
  await expect(verifyGuestAiCredential(redis as unknown as Redis, `GuestAI ${expired.token}`))
    .rejects.toMatchObject({ status: 401 });
});
