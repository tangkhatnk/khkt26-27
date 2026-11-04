import { afterEach, expect, it } from "vitest";
import type { Redis } from "ioredis";
import RedisMock from "ioredis-mock";
import { ApiError } from "../src/errors.js";
import { reserveGuestAiBudget, type GuestAiBudgetLimits } from "../src/guestAiBudget.js";

const limits: GuestAiBudgetLimits = {
  perIpRequests: 100,
  perPrincipalDailyUnits: 100,
  perTaskRequests: { document: 10, tutor: 10, question: 4, evaluation: 20, session: 20 },
  globalDailyUnits: 100,
};
const redis = new RedisMock();
afterEach(async () => {
  await redis.flushall();
});

it("reserves per-task quota atomically when concurrent guest calls arrive", async () => {
  const results = await Promise.allSettled(Array.from({ length: 12 }, () =>
    reserveGuestAiBudget(redis as unknown as Redis, {
      principalId: "principal-a",
      remoteAddress: "203.0.113.10",
      task: "question",
      providerUnits: 1,
      now: Date.UTC(2026, 10, 4, 12),
      limits,
    }),
  ));

  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(4);
  const rejected = results.filter(result => result.status === "rejected");
  expect(rejected).toHaveLength(8);
  expect(rejected.every(result => result.status === "rejected" &&
    result.reason instanceof ApiError && result.reason.status === 429)).toBe(true);
});

it("applies the shared provider envelope across independent guest principals", async () => {
  const smallGlobalLimit = { ...limits, globalDailyUnits: 5 };
  const results = await Promise.allSettled([
    reserveGuestAiBudget(redis as unknown as Redis, {
      principalId: "principal-a", remoteAddress: "203.0.113.10", task: "tutor",
      providerUnits: 3, now: Date.UTC(2026, 10, 4, 12), limits: smallGlobalLimit,
    }),
    reserveGuestAiBudget(redis as unknown as Redis, {
      principalId: "principal-b", remoteAddress: "203.0.113.11", task: "tutor",
      providerUnits: 3, now: Date.UTC(2026, 10, 4, 12), limits: smallGlobalLimit,
    }),
  ]);

  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const rejected = results.filter(result => result.status === "rejected");
  expect(rejected).toHaveLength(1);
  expect(rejected[0]).toMatchObject({ status: "rejected", reason: expect.objectContaining({ status: 429 }) });
});

it("does not charge provider units for deterministic evaluation", async () => {
  const oneUnitEnvelope = { ...limits, globalDailyUnits: 1 };
  const response = await reserveGuestAiBudget(redis as unknown as Redis, {
    principalId: "principal-a", remoteAddress: "203.0.113.10", task: "evaluation",
    providerUnits: 0, now: Date.UTC(2026, 10, 4, 12), limits: oneUnitEnvelope,
  });

  expect(response).toBeUndefined();
});

it("shares the daily socket-IP request ceiling across guest credentials", async () => {
  const smallIpLimit = { ...limits, perIpRequests: 2 };
  const calls = [
    { principalId: "principal-a", task: "question" as const },
    { principalId: "principal-b", task: "question" as const },
    { principalId: "principal-c", task: "question" as const },
  ];
  const results = await Promise.allSettled(calls.map(({ principalId, task }) =>
    reserveGuestAiBudget(redis as unknown as Redis, {
      principalId,
      remoteAddress: "203.0.113.10",
      task,
      providerUnits: 0,
      now: Date.UTC(2026, 10, 4, 12),
      limits: smallIpLimit,
    }),
  ));

  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(2);
  expect(results.filter(result => result.status === "rejected" &&
    result.reason instanceof ApiError && result.reason.status === 429)).toHaveLength(1);
});
