import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { z } from "zod";
import { config } from "./config.js";
import { ApiError } from "./errors.js";

const GUEST_AI_CREDENTIAL_TTL_SECONDS = 7 * 24 * 60 * 60;
export type GuestAiCredentialLimits = { perIpDaily: number; globalDaily: number };
export const GUEST_AI_CREDENTIAL_LIMITS: GuestAiCredentialLimits = {
  perIpDaily: config.GUEST_AI_PER_IP_DAILY_ISSUE_LIMIT,
  globalDaily: config.GUEST_AI_GLOBAL_DAILY_ISSUE_LIMIT,
};
const credentialRecordSchema = z.object({
  principalId: z.uuid(),
  expiresAt: z.number().int().positive(),
}).strict();

const reserveIssuanceScript = `
local ipIssued = tonumber(redis.call('GET', KEYS[1]) or '0')
local globalIssued = tonumber(redis.call('GET', KEYS[2]) or '0')
if ipIssued + 1 > tonumber(ARGV[1]) then return 1 end
if globalIssued + 1 > tonumber(ARGV[2]) then return 2 end
redis.call('INCR', KEYS[1])
redis.call('INCR', KEYS[2])
redis.call('EXPIREAT', KEYS[1], tonumber(ARGV[3]))
redis.call('EXPIREAT', KEYS[2], tonumber(ARGV[3]))
return 0
`;

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function ipHash(value: string) {
  return hash(value);
}

function nextUtcDaySeconds(now: number) {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return Math.ceil(next.getTime() / 1000);
}

export async function issueGuestAiCredential(
  redis: Redis,
  remoteAddress: string,
  now = Date.now(),
  limits = GUEST_AI_CREDENTIAL_LIMITS,
) {
  const day = new Date(now).toISOString().slice(0, 10);
  const issueKey = `guest-ai:quota:credential-ip:${day}:${ipHash(remoteAddress)}`;
  const globalKey = `guest-ai:quota:credential-global:${day}`;
  let allowed: number;
  try {
    allowed = Number(await redis.eval(
      reserveIssuanceScript,
      2,
      issueKey,
      globalKey,
      limits.perIpDaily,
      limits.globalDaily,
      nextUtcDaySeconds(now),
    ));
  } catch {
    throw new ApiError(503, "service-unavailable", "Guest AI quota storage is unavailable.");
  }
  if (allowed !== 0)
    throw new ApiError(429, "rate-limit-exceeded", "Đã đạt giới hạn tạo phiên AI khách.");

  const token = randomBytes(32).toString("base64url");
  const expiresAt = now + GUEST_AI_CREDENTIAL_TTL_SECONDS * 1000;
  const principalId = randomUUID();
  let created: string | null;
  try {
    created = await redis.set(
      `guest-ai:credential:${hash(token)}`,
      JSON.stringify({ principalId, expiresAt }),
      "EX",
      GUEST_AI_CREDENTIAL_TTL_SECONDS,
      "NX",
    );
  } catch {
    throw new ApiError(503, "service-unavailable", "Guest AI credential storage is unavailable.");
  }
  if (created !== "OK")
    throw new ApiError(503, "service-unavailable", "Không thể tạo phiên AI khách. Hãy thử lại sau.");

  return { token, expiresAt: new Date(expiresAt).toISOString() };
}

export async function verifyGuestAiCredential(redis: Redis, authorization?: string) {
  const match = authorization?.match(/^GuestAI ([A-Za-z0-9_-]{43})$/u);
  if (!match)
    throw new ApiError(401, "authentication-error", "Guest AI authorization required");

  let value: string | null;
  try {
    value = await redis.get(`guest-ai:credential:${hash(match[1]!)}`);
  } catch {
    throw new ApiError(503, "service-unavailable", "Guest AI credential storage is unavailable.");
  }
  if (!value)
    throw new ApiError(401, "authentication-error", "Guest AI credential is invalid or expired");

  let record: z.infer<typeof credentialRecordSchema>;
  try {
    record = credentialRecordSchema.parse(JSON.parse(value));
  } catch {
    throw new ApiError(401, "authentication-error", "Guest AI credential is invalid or expired");
  }
  if (record.expiresAt <= Date.now())
    throw new ApiError(401, "authentication-error", "Guest AI credential is invalid or expired");
  return record.principalId;
}
