import { DEVICE_CATEGORIES, type DeviceCategory } from "../../backend/src/adventure/domain.ts";

export function isDeviceCategory(value: unknown): value is DeviceCategory {
  return typeof value === "string" &&
    (DEVICE_CATEGORIES as readonly string[]).includes(value);
}

/** Classify at trip start; only the coarse result is suitable for persistence. */
export function detectDeviceCategory(userAgent: string, maxTouchPoints: number): DeviceCategory {
  const agent = typeof userAgent === "string" ? userAgent : "";
  const touches = Number.isFinite(maxTouchPoints) ? maxTouchPoints : 0;

  if (/iPhone|iPod/i.test(agent)) return "ios";
  if (/iPad/i.test(agent)) return "tablet";
  if (/Android/i.test(agent)) {
    if (/tablet/i.test(agent) || !/mobile/i.test(agent)) return "tablet";
    return "android";
  }
  if (touches > 1 && /Macintosh|Mac OS|MacIntel/i.test(agent)) return "tablet";
  if (/Windows|Macintosh|Mac OS|MacIntel|Linux|X11|CrOS/i.test(agent)) return "pc";
  return "unknown";
}
