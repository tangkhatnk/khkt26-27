import { readFile } from "node:fs/promises";
import { join } from "node:path";

function normalizeApiOrigin(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

export async function readConfiguredApiOrigin(webRoot: string): Promise<string | undefined> {
  try {
    const config = JSON.parse(
      await readFile(join(webRoot, "desktop-config.json"), "utf8"),
    ) as { apiOrigin?: unknown };
    return normalizeApiOrigin(config.apiOrigin);
  } catch {
    return undefined;
  }
}

export function buildContentSecurityPolicy(apiOrigin?: string): string {
  const connectSources = new Set(["'self'"]);
  const normalizedOrigin = normalizeApiOrigin(apiOrigin);
  if (normalizedOrigin) connectSources.add(normalizedOrigin);
  connectSources.add("http://localhost:3000");
  connectSources.add("http://127.0.0.1:3000");

  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${[...connectSources].join(" ")}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
  ].join("; ");
}
