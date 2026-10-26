import type { MaterialSource } from "./materialSources";
import type { Saved } from "./storage";

export type MaterialSummaryScope = {
  ownerId: string;
  workspaceGeneration: number;
  authGeneration: number;
  sessionId: string;
  sourceId: string;
  sourceFingerprint: string;
  requestGeneration: number;
};

export async function fingerprintMaterialSourceText(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isCurrentMaterialSummaryScope(
  expected: MaterialSummaryScope,
  current: MaterialSummaryScope,
): boolean {
  return expected.ownerId === current.ownerId &&
    expected.workspaceGeneration === current.workspaceGeneration &&
    expected.authGeneration === current.authGeneration &&
    expected.sessionId === current.sessionId &&
    expected.sourceId === current.sourceId &&
    expected.sourceFingerprint === current.sourceFingerprint &&
    expected.requestGeneration === current.requestGeneration;
}

export function cachedMaterialSummary(
  saved: Pick<Saved, "materialSummaries">,
  sessionId: string,
  source: Pick<MaterialSource, "id" | "reviewed">,
  sourceFingerprint: string,
): string | undefined {
  if (!source.reviewed || !/^[0-9a-f]{64}$/u.test(sourceFingerprint)) return undefined;
  const cached = saved.materialSummaries?.[sessionId]?.[source.id];
  return cached?.sourceFingerprint === sourceFingerprint ? cached.summary : undefined;
}
