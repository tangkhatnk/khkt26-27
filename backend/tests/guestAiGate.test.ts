import { afterEach, expect, it, vi } from "vitest";
import type { Redis } from "ioredis";
import RedisMock from "ioredis-mock";
import { claimGuestAiFeature, commitGuestAiSessionStart } from "../src/guestAiGate.js";

const redis = new RedisMock();
afterEach(async () => { vi.restoreAllMocks(); await redis.flushall(); });

it("allows one owner-bound preparation claim and makes concurrent retries wait", async () => {
  const attempts = await Promise.all([
    claimGuestAiFeature(redis as unknown as Redis, {
      principalId: "principal-a", sessionId: "00000000-0000-4000-8000-000000000001",
      feature: "exercise", requestId: "00000000-0000-4000-8000-000000000002",
      fingerprint: "a".repeat(64), id: "00000000-0000-4000-8000-000000000002",
    }),
    claimGuestAiFeature(redis as unknown as Redis, {
      principalId: "principal-a", sessionId: "00000000-0000-4000-8000-000000000001",
      feature: "exercise", requestId: "00000000-0000-4000-8000-000000000002",
      fingerprint: "a".repeat(64), id: "00000000-0000-4000-8000-000000000002",
    }),
  ]);

  expect(attempts.filter(result => result.status === "claimed")).toHaveLength(1);
  expect(attempts.filter(result => result.status === "pending")).toHaveLength(1);
});

it("does not let another private principal claim a prepared session", async () => {
  const sessionId = "00000000-0000-4000-8000-000000000003";
  const first = await claimGuestAiFeature(redis as unknown as Redis, {
    principalId: "principal-a", sessionId, feature: "quiz", requestId: "same-request",
    fingerprint: "b".repeat(64), id: "00000000-0000-4000-8000-000000000004",
  });
  const second = await claimGuestAiFeature(redis as unknown as Redis, {
    principalId: "principal-b", sessionId, feature: "quiz", requestId: "same-request",
    fingerprint: "b".repeat(64), id: "00000000-0000-4000-8000-000000000005",
  });

  expect(first.status).toBe("claimed");
  expect(second.status).toBe("conflict");
});

it("lets the timer start after an abandoned exercise preparation lease expires", async () => {
  let now = Date.UTC(2026, 10, 4, 12);
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const sessionId = "00000000-0000-4000-8000-000000000006";
  await claimGuestAiFeature(redis as unknown as Redis, {
    principalId: "principal-a", sessionId, feature: "exercise", requestId: "request-a",
    fingerprint: "c".repeat(64), id: "00000000-0000-4000-8000-000000000007",
  });
  now += 301_000;

  await expect(commitGuestAiSessionStart(
    redis as unknown as Redis,
    "principal-a",
    sessionId,
    JSON.stringify({ principalId: "principal-a", sessionId, startedAt: now }),
  )).resolves.toBe(0);
});
