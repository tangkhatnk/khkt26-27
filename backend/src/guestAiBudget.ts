import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
import { config } from "./config.js";
import { ApiError } from "./errors.js";

export type GuestAiTask = "document" | "tutor" | "question" | "evaluation" | "session";

export type GuestAiBudgetLimits = {
  perIpRequests: number;
  perPrincipalDailyUnits: number;
  perTaskRequests: Record<GuestAiTask, number>;
  globalDailyUnits: number;
};

export const GUEST_AI_BUDGET_LIMITS: GuestAiBudgetLimits = {
  perIpRequests: config.GUEST_AI_PER_IP_DAILY_REQUEST_LIMIT,
  perPrincipalDailyUnits: config.GUEST_AI_PER_CREDENTIAL_DAILY_UNITS,
  perTaskRequests: {
    document: config.GUEST_AI_DOCUMENT_DAILY_REQUESTS,
    tutor: config.GUEST_AI_TUTOR_DAILY_REQUESTS,
    question: config.GUEST_AI_QUESTION_DAILY_REQUESTS,
    evaluation: config.GUEST_AI_EVALUATION_DAILY_REQUESTS,
    session: config.GUEST_AI_SESSION_DAILY_REQUESTS,
  },
  globalDailyUnits: config.GUEST_AI_GLOBAL_DAILY_UNITS,
};

const reserveQuotaScript = `
local ipRequests = tonumber(redis.call('GET', KEYS[1]) or '0')
local principalUnits = tonumber(redis.call('GET', KEYS[2]) or '0')
local taskRequests = tonumber(redis.call('GET', KEYS[3]) or '0')
local globalUnits = tonumber(redis.call('GET', KEYS[4]) or '0')
local requestIncrement = tonumber(ARGV[1])
local unitIncrement = tonumber(ARGV[2])

if ipRequests + requestIncrement > tonumber(ARGV[3]) then return 1 end
if principalUnits + unitIncrement > tonumber(ARGV[4]) then return 2 end
if taskRequests + requestIncrement > tonumber(ARGV[5]) then return 3 end
if globalUnits + unitIncrement > tonumber(ARGV[6]) then return 4 end

redis.call('INCRBY', KEYS[1], requestIncrement)
redis.call('INCRBY', KEYS[2], unitIncrement)
redis.call('INCRBY', KEYS[3], requestIncrement)
redis.call('INCRBY', KEYS[4], unitIncrement)
for index = 1, 4 do redis.call('EXPIREAT', KEYS[index], tonumber(ARGV[7])) end
return 0
`;

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function utcDay(now: number) {
  return new Date(now).toISOString().slice(0, 10);
}

function nextUtcDaySeconds(now: number) {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return Math.ceil(next.getTime() / 1000);
}

/** Atomically reserves caller, task, and global capacity before a provider call. */
export async function reserveGuestAiBudget(
  redis: Redis,
  input: {
    principalId: string;
    remoteAddress: string;
    task: GuestAiTask;
    providerUnits: number;
    now?: number;
    limits?: GuestAiBudgetLimits;
  },
) {
  const now = input.now ?? Date.now();
  const limits = input.limits ?? GUEST_AI_BUDGET_LIMITS;
  if (!Number.isSafeInteger(input.providerUnits) || input.providerUnits < 0)
    throw new Error("Guest AI provider units must be a non-negative integer.");

  const day = utcDay(now);
  const ipHash = hash(input.remoteAddress);
  let result: number;
  try {
    result = Number(await redis.eval(
      reserveQuotaScript,
      4,
      `guest-ai:quota:ip:${day}:${ipHash}`,
      `guest-ai:quota:principal:${day}:${input.principalId}:units`,
      `guest-ai:quota:principal:${day}:${input.principalId}:task:${input.task}`,
      `guest-ai:quota:global:${day}:units`,
      1,
      input.providerUnits,
      limits.perIpRequests,
      limits.perPrincipalDailyUnits,
      limits.perTaskRequests[input.task],
      limits.globalDailyUnits,
      nextUtcDaySeconds(now),
    ));
  } catch {
    throw new ApiError(503, "service-unavailable", "Guest AI quota storage is unavailable.");
  }

  if (result !== 0)
    throw new ApiError(429, "rate-limit-exceeded", "Đã đạt giới hạn AI trong ngày. Hãy thử lại vào ngày mai.");
}
