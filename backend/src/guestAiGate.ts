import type { Redis } from "ioredis";
import { ApiError, missing } from "./errors.js";

export const GUEST_AI_PRIVATE_TTL_SECONDS = 7 * 24 * 60 * 60;
export type GuestAiFeature = "exercise" | "quiz";
type ClaimInput = {
  principalId: string;
  sessionId: string;
  feature: GuestAiFeature;
  requestId: string;
  fingerprint: string;
  id: string;
};
export type GuestAiFeatureClaim =
  | { status: "claimed"; id: string }
  | { status: "replay"; id: string }
  | { status: "pending"; id: string }
  | { status: "conflict" };

function gateKey(sessionId: string) { return `guest-ai:session-gate:${sessionId}`; }
function sessionKey(sessionId: string) { return `guest-ai:session:${sessionId}`; }
function tombstoneKey(sessionId: string, requestId: string) {
  return `guest-ai:feature-tombstone:${sessionId}:${requestId}`;
}

const claimScript = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 1 end
local tombstone = redis.call('GET', KEYS[3])
if tombstone == ARGV[1] then return 7 end
local owner = redis.call('HGET', KEYS[2], 'principalId')
if owner and owner ~= ARGV[1] then return 2 end
if not owner then redis.call('HSET', KEYS[2], 'principalId', ARGV[1]) end
if redis.call('HGET', KEYS[2], 'started') == '1' then return 3 end
local prefix = ARGV[2]
local status = redis.call('HGET', KEYS[2], prefix .. 'Status')
if status then
  if redis.call('HGET', KEYS[2], prefix .. 'RequestId') == ARGV[3] and
     redis.call('HGET', KEYS[2], prefix .. 'Fingerprint') == ARGV[4] then
    if status == 'preparing' then
      if tonumber(redis.call('HGET', KEYS[2], prefix .. 'LeaseUntil') or '0') > tonumber(ARGV[7]) then return 4 end
      redis.call('HDEL', KEYS[2], prefix .. 'Status', prefix .. 'Id', prefix .. 'RequestId', prefix .. 'Fingerprint', prefix .. 'LeaseUntil')
      status = nil
    end
    if status == 'prepared' or status == 'bound' then return 5 end
  end
  return 6
end
redis.call('HSET', KEYS[2], prefix .. 'Status', 'preparing', prefix .. 'RequestId', ARGV[3],
  prefix .. 'Fingerprint', ARGV[4], prefix .. 'Id', ARGV[5], prefix .. 'LeaseUntil', tostring(tonumber(ARGV[7]) + 300))
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[6]))
return 0
`;

/** Claims one session-bound private AI preparation without racing a timer start. */
export async function claimGuestAiFeature(redis: Redis, input: ClaimInput): Promise<GuestAiFeatureClaim> {
  let raw: unknown;
  try {
    raw = await redis.eval(
      claimScript, 3,
      sessionKey(input.sessionId), gateKey(input.sessionId), tombstoneKey(input.sessionId, input.requestId),
      input.principalId, input.feature, input.requestId, input.fingerprint, input.id,
      GUEST_AI_PRIVATE_TTL_SECONDS, Math.floor(Date.now() / 1000),
    );
  } catch {
    throw new ApiError(503, "service-unavailable", "Guest AI session storage is unavailable.");
  }
  const status = Number(raw);
  if (status === 0) return { status: "claimed", id: input.id };
  if (status === 4) return { status: "pending", id: input.id };
  if (status === 5) {
    const id = await redis.hget(gateKey(input.sessionId), `${input.feature}Id`);
    return id ? { status: "replay", id } : { status: "conflict" };
  }
  if (status === 2) return { status: "conflict" };
  if (status === 1 || status === 3)
    throw new ApiError(409, "conflict", "Không thể chuẩn bị nội dung AI sau khi phiên học đã bắt đầu.");
  if (status === 7) throw new ApiError(409, "conflict", "Yêu cầu AI này đã bị hủy.");
  throw new ApiError(409, "conflict", "Đã có nội dung AI khác gắn với phiên học này.");
}

const completeScript = `
local owner = redis.call('HGET', KEYS[1], 'principalId')
if not owner then return 1 end
if owner ~= ARGV[1] then return 2 end
local prefix = ARGV[2]
if redis.call('HGET', KEYS[1], prefix .. 'Status') ~= 'preparing' or
   redis.call('HGET', KEYS[1], prefix .. 'Id') ~= ARGV[3] or
   redis.call('HGET', KEYS[1], prefix .. 'RequestId') ~= ARGV[4] or
   redis.call('HGET', KEYS[1], prefix .. 'Fingerprint') ~= ARGV[5] or
   tonumber(redis.call('HGET', KEYS[1], prefix .. 'LeaseUntil') or '0') <= tonumber(ARGV[8]) or
   redis.call('HGET', KEYS[1], 'started') == '1' then return 3 end
redis.call('SET', KEYS[2], ARGV[6], 'EX', tonumber(ARGV[7]))
redis.call('HSET', KEYS[1], prefix .. 'Status', 'prepared')
redis.call('HDEL', KEYS[1], prefix .. 'LeaseUntil')
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[7]))
return 0
`;

export async function completeGuestAiFeature(
  redis: Redis,
  input: ClaimInput,
  record: unknown,
) {
  let status: number;
  try {
    status = Number(await redis.eval(
      completeScript, 2, gateKey(input.sessionId),
      input.feature === "exercise"
        ? `guest-ai:exercise:${input.principalId}:${input.id}`
        : `guest-ai:quiz:${input.principalId}:${input.id}`,
      input.principalId, input.feature, input.id, input.requestId, input.fingerprint,
      JSON.stringify(record), GUEST_AI_PRIVATE_TTL_SECONDS, Math.floor(Date.now() / 1000),
    ));
  } catch {
    throw new ApiError(503, "service-unavailable", "Guest AI session storage is unavailable.");
  }
  if (status !== 0)
    throw new ApiError(409, "conflict", status === 2
      ? "Không tìm thấy nội dung AI khách."
      : "Nội dung AI đã thay đổi trong lúc chuẩn bị.");
}

const releaseScript = `
local owner = redis.call('HGET', KEYS[1], 'principalId')
if not owner then return 0 end
if owner ~= ARGV[1] then return 2 end
local prefix = ARGV[2]
if redis.call('HGET', KEYS[1], prefix .. 'Status') == 'preparing' and
   redis.call('HGET', KEYS[1], prefix .. 'Id') == ARGV[3] and
   redis.call('HGET', KEYS[1], prefix .. 'RequestId') == ARGV[4] then
  redis.call('HDEL', KEYS[1], prefix .. 'Status', prefix .. 'Id', prefix .. 'RequestId', prefix .. 'Fingerprint', prefix .. 'LeaseUntil')
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[5]))
end
return 0
`;

export async function releaseGuestAiFeature(redis: Redis, input: ClaimInput) {
  try {
    await redis.eval(
      releaseScript, 1, gateKey(input.sessionId),
      input.principalId, input.feature, input.id, input.requestId, GUEST_AI_PRIVATE_TTL_SECONDS,
    );
  } catch {
    throw new ApiError(503, "service-unavailable", "Guest AI session storage is unavailable.");
  }
}

const bindScript = `
local owner = redis.call('HGET', KEYS[1], 'principalId')
if not owner then return 1 end
if owner ~= ARGV[1] then return 2 end
local status = redis.call('HGET', KEYS[1], 'exerciseStatus')
if redis.call('HGET', KEYS[1], 'exerciseId') ~= ARGV[2] then return 1 end
local started = redis.call('HGET', KEYS[1], 'started') == '1'
local hasStart = redis.call('EXISTS', KEYS[2]) == 1
if status == 'bound' then
  if (started and hasStart) or (not started and not hasStart) then return 0 end
  return 3
end
if status ~= 'prepared' then return 4 end
if started or hasStart then return 3 end
redis.call('HSET', KEYS[1], 'exerciseStatus', 'bound')
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return 0
`;

export async function bindGuestAiExercises(
  redis: Redis,
  principalId: string,
  sessionId: string,
  exerciseId: string,
) {
  let status: number;
  try {
    status = Number(await redis.eval(
      bindScript, 2, gateKey(sessionId), sessionKey(sessionId), principalId,
      exerciseId, GUEST_AI_PRIVATE_TTL_SECONDS,
    ));
  } catch {
    throw new ApiError(503, "service-unavailable", "Guest AI session storage is unavailable.");
  }
  if (status === 2) missing("Không tìm thấy bộ bài tập AI khách.");
  if (status === 3) throw new ApiError(409, "conflict", "Phiên học đã bắt đầu hoặc đã kết thúc.");
  if (status !== 0) missing("Không tìm thấy bộ bài tập AI khách.");
  return { ok: true as const, exerciseId };
}

const cancelScript = `
if redis.call('EXISTS', KEYS[2]) == 1 then return 3 end
local owner = redis.call('HGET', KEYS[1], 'principalId')
if owner and owner ~= ARGV[1] then return 2 end
if owner then
  if redis.call('HGET', KEYS[1], 'exerciseRequestId') == ARGV[2] then
    local id = redis.call('HGET', KEYS[1], 'exerciseId')
    redis.call('HDEL', KEYS[1], 'exerciseStatus', 'exerciseId', 'exerciseRequestId', 'exerciseFingerprint', 'exerciseLeaseUntil')
    if id then redis.call('DEL', ARGV[4] .. owner .. ':' .. id) end
  end
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
end
redis.call('SET', KEYS[3], ARGV[1], 'EX', tonumber(ARGV[3]))
return 0
`;

export async function cancelGuestAiExercises(
  redis: Redis,
  principalId: string,
  sessionId: string,
  requestId: string,
) {
  let status: number;
  try {
    status = Number(await redis.eval(
      cancelScript, 3, gateKey(sessionId), sessionKey(sessionId),
      tombstoneKey(sessionId, requestId), principalId, requestId,
      GUEST_AI_PRIVATE_TTL_SECONDS, "guest-ai:exercise:",
    ));
  } catch {
    throw new ApiError(503, "service-unavailable", "Guest AI session storage is unavailable.");
  }
  if (status === 2) missing("Không tìm thấy yêu cầu bài tập AI khách.");
  if (status === 3) throw new ApiError(409, "conflict", "Không thể hủy bài tập AI sau khi phiên học đã bắt đầu.");
  return { ok: true as const };
}

const startScript = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 1 end
local owner = redis.call('HGET', KEYS[2], 'principalId')
if owner and owner ~= ARGV[1] then return 2 end
if redis.call('HGET', KEYS[2], 'started') == '1' then return 3 end
if redis.call('HGET', KEYS[2], 'exerciseStatus') == 'preparing' then
  if tonumber(redis.call('HGET', KEYS[2], 'exerciseLeaseUntil') or '0') > tonumber(ARGV[4]) then return 4 end
  redis.call('HDEL', KEYS[2], 'exerciseStatus', 'exerciseId', 'exerciseRequestId', 'exerciseFingerprint', 'exerciseLeaseUntil')
end
if redis.call('HGET', KEYS[2], 'exerciseStatus') == 'prepared' then return 5 end
if redis.call('HGET', KEYS[2], 'quizStatus') == 'preparing' then return 4 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]), 'NX')
redis.call('HSET', KEYS[2], 'principalId', ARGV[1], 'started', '1')
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[3]))
return 0
`;

/** Atomically freezes pending guest preparation and reserves the server timer anchor. */
export async function commitGuestAiSessionStart(
  redis: Redis,
  principalId: string,
  sessionId: string,
  serializedRecord: string,
) {
  let status: number;
  try {
    status = Number(await redis.eval(
      startScript, 2, sessionKey(sessionId), gateKey(sessionId), principalId,
      serializedRecord, GUEST_AI_PRIVATE_TTL_SECONDS, Math.floor(Date.now() / 1000),
    ));
  } catch {
    throw new ApiError(503, "service-unavailable", "Guest AI session storage is unavailable.");
  }
  if (status === 0 || status === 1) return status;
  if (status === 2) missing("Không tìm thấy phiên AI khách.");
  if (status === 4)
    throw new ApiError(409, "conflict", "Nội dung AI đang được tạo. Hãy đợi chuẩn bị xong rồi bắt đầu phiên.");
  if (status === 5)
    throw new ApiError(409, "conflict", "Hãy xác nhận bộ bài tập AI trước khi bắt đầu phiên.");
  throw new ApiError(409, "conflict", "Phiên học AI khách đã được bắt đầu.");
}

export async function readGuestAiGate(redis: Redis, sessionId: string) {
  try {
    const fields = await redis.hgetall(gateKey(sessionId));
    if (!Object.keys(fields).length) return null;
    if (!fields.principalId) throw new Error("invalid guest AI gate");
    const gate: {
      principalId: string;
      started?: boolean;
      exercise?: { status: string; id: string; requestId: string; fingerprint: string };
      quiz?: { status: string; id: string; requestId: string; fingerprint: string };
    } = { principalId: fields.principalId };
    if (fields.started === "1") gate.started = true;
    for (const feature of ["exercise", "quiz"] as const) {
      const status = fields[`${feature}Status`];
      if (status) gate[feature] = {
        status,
        id: fields[`${feature}Id`] ?? "",
        requestId: fields[`${feature}RequestId`] ?? "",
        fingerprint: fields[`${feature}Fingerprint`] ?? "",
      };
    }
    return gate;
  } catch {
    throw new ApiError(503, "service-unavailable", "Guest AI session state is unavailable.");
  }
}
