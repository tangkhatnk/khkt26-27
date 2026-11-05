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
  view: "station" | "ticket" | "summary";
  planId: string | null;
  stepId: string | null;
};

export type MaterialSummaryRequestAvailability = {
  targetView: MaterialSummaryScope["view"];
  view: string;
  ownerReady: boolean;
  online: boolean;
  authOffline: boolean;
  loaded: boolean;
  exclusive: boolean;
  workspaceLive: boolean;
  onboardingComplete: boolean;
  activeSession: boolean;
  source: Pick<MaterialSource, "reviewed" | "text">;
};

export type MaterialSummaryResponseValidity = {
  expected: MaterialSummaryScope;
  current: MaterialSummaryScope;
  ownerMatches: boolean;
  workspaceLive: boolean;
  sessionValid: boolean;
  source: Pick<MaterialSource, "reviewed" | "text"> | undefined;
  sourceText: string;
  onboardingComplete: boolean;
  activeSession: boolean;
};

export function canRequestMaterialSummary(input: MaterialSummaryRequestAvailability): boolean {
  if (input.view !== input.targetView || !input.ownerReady || !input.online || input.authOffline ||
      !input.loaded || !input.exclusive || !input.workspaceLive || !input.source.reviewed ||
      input.source.text.trim().length < 10 || input.source.text.length > 50_000) return false;
  if (input.targetView === "summary") return true;
  return input.onboardingComplete && !input.activeSession;
}

export function canApplyMaterialSummaryResponse(input: MaterialSummaryResponseValidity): boolean {
  return input.ownerMatches && input.workspaceLive && input.sessionValid &&
    isCurrentMaterialSummaryScope(input.expected, input.current) &&
    input.source?.reviewed === true && input.source.text === input.sourceText &&
    (input.expected.view === "summary" || (input.onboardingComplete && !input.activeSession));
}

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
    expected.requestGeneration === current.requestGeneration &&
    expected.view === current.view &&
    expected.planId === current.planId &&
    expected.stepId === current.stepId;
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
