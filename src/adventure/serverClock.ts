export const MAX_SERVER_CLOCK_OFFSET_MS = 24 * 60 * 60 * 1000;

function boundedOffset(offsetMs: number): number {
  if (!Number.isFinite(offsetMs)) return 0;
  return Math.max(-MAX_SERVER_CLOCK_OFFSET_MS, Math.min(MAX_SERVER_CLOCK_OFFSET_MS, Math.trunc(offsetMs)));
}

/** Estimate device skew from the server's current timestamp in a fresh snapshot. */
export function estimateServerClockOffset(serverNow: number, clientNow: number): number {
  if (!Number.isSafeInteger(serverNow) || !Number.isSafeInteger(clientNow)) return 0;
  return boundedOffset(serverNow - clientNow);
}

/** Convert a local device timestamp into the server clock domain for synchronized trips. */
export function serverTimeFromClientTime(clientNow: number, offsetMs: number): number {
  return Math.trunc(clientNow + boundedOffset(offsetMs));
}
