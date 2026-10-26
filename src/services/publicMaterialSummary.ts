import { request } from "./api";

export type PublicMaterialSummaryStatus = {
  summary: string | null;
  version: number;
  approvedAt: string | null;
};

export type PublicSummaryWriteMode = "publish" | "replace";
export type PublicMaterialSummaryPreviewSnapshot = {
  mode: PublicSummaryWriteMode;
  expectedVersion: number;
  statusSummary: string | null;
  statusApprovedAt: string | null;
};
export type PublicSummaryWithdrawalConfirmation = {
  version: number;
  summary: string;
  approvedAt: string;
  scopeKey: string;
};

export type PublicMaterialSummaryCandidate = {
  sourceId: string;
  sourceName: string;
  summary: string;
  reviewed: boolean;
  sourceFingerprint: string;
  currentSourceFingerprint: string;
};

export function publicMaterialSummaryLength(text: string): number {
  return text.length;
}

export function publicSummaryModeMatchesStatus(
  mode: PublicSummaryWriteMode | null,
  status: PublicMaterialSummaryStatus | null,
): boolean {
  if (mode === null || status === null) return false;
  if (mode === "publish") return status.summary === null && status.approvedAt === null;
  return status.summary !== null && status.approvedAt !== null;
}

export function publicSummaryPreviewMatches(
  preview: PublicMaterialSummaryPreviewSnapshot | null,
  status: PublicMaterialSummaryStatus | null,
  mode: PublicSummaryWriteMode | null,
): boolean {
  return preview !== null && status !== null && mode !== null && preview.mode === mode &&
    publicSummaryModeMatchesStatus(mode, status) &&
    publicSummaryStatusMatches({
      version: preview.expectedVersion,
      summary: preview.statusSummary,
      approvedAt: preview.statusApprovedAt,
    }, status);
}

export function publicSummaryStatusMatches(
  snapshot: { version: number; summary: string | null; approvedAt: string | null } | null,
  status: PublicMaterialSummaryStatus | null,
): boolean {
  return snapshot !== null && status !== null && snapshot.version === status.version &&
    snapshot.summary === status.summary && snapshot.approvedAt === status.approvedAt;
}

export function publicSummaryWithdrawalIntent(input: {
  confirmation: PublicSummaryWithdrawalConfirmation | null;
  status: PublicMaterialSummaryStatus | null;
  scopeKey: string;
  scopeCurrent: boolean;
  canManage: boolean;
}): { expectedVersion: number } | null {
  const { confirmation, status } = input;
  if (!confirmation || !status || !input.scopeCurrent || !input.canManage || status.summary === null ||
      confirmation.scopeKey !== input.scopeKey || confirmation.summary.length === 0 ||
      !publicSummaryStatusMatches(confirmation, status)) return null;
  return { expectedVersion: confirmation.version };
}

export function publicSummaryWriteIntent(input: {
  sessionId: string;
  status: PublicMaterialSummaryStatus | null;
  mode: PublicSummaryWriteMode | null;
  previewText: string | null;
  previewMode: PublicSummaryWriteMode | null;
  previewVersion: number | null;
  previewSummary: string | null;
  previewApprovedAt: string | null;
  selectedSourceCount: number;
  selectedCandidatesCurrent: boolean;
  scopeCurrent: boolean;
  canManage: boolean;
}): { sessionId: string; summary: string; expectedVersion: number; mode: PublicSummaryWriteMode } | null {
  const { sessionId, status, mode, previewText } = input;
  if (!sessionId || !status || !mode || previewText === null ||
      input.previewMode === null || input.previewVersion === null ||
      !publicSummaryPreviewMatches({
        mode: input.previewMode,
        expectedVersion: input.previewVersion,
        statusSummary: input.previewSummary,
        statusApprovedAt: input.previewApprovedAt,
      }, status, mode) ||
      !Number.isInteger(input.selectedSourceCount) || input.selectedSourceCount < 1 ||
      !input.selectedCandidatesCurrent || !input.scopeCurrent || !input.canManage ||
      previewText.trim().length === 0 || previewText.length > 500 || previewText.includes("\u0000"))
    return null;
  if ((mode === "replace" && status.summary === null) || (mode === "publish" && status.summary !== null))
    return null;
  return { sessionId, summary: previewText, expectedVersion: status.version, mode };
}

export function composePublicMaterialSummary(candidates: readonly PublicMaterialSummaryCandidate[]): string {
  return candidates.map((candidate) => candidate.summary).join("\n\n");
}

export function eligiblePublicMaterialSummaryCandidates(
  candidates: readonly PublicMaterialSummaryCandidate[],
): PublicMaterialSummaryCandidate[] {
  return candidates.filter((candidate) =>
    candidate.sourceId.length > 0 && candidate.sourceName.length > 0 && candidate.reviewed &&
    /^[0-9a-f]{64}$/u.test(candidate.sourceFingerprint) &&
    candidate.sourceFingerprint === candidate.currentSourceFingerprint &&
    candidate.summary.trim().length > 0,
  );
}

export function readPublicMaterialSummary(sessionId: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ sessionId });
  return request<PublicMaterialSummaryStatus>(`/material-summaries/mine?${query}`, { signal });
}

export function publishPublicMaterialSummary(
  sessionId: string,
  summary: string,
  expectedVersion: number,
  signal?: AbortSignal,
) {
  return request<PublicMaterialSummaryStatus>("/material-summaries/share", {
    method: "POST",
    body: JSON.stringify({ sessionId, summary, expectedVersion, confirmShare: true }),
    signal,
  });
}

export function replacePublicMaterialSummary(
  sessionId: string,
  summary: string,
  expectedVersion: number,
  signal?: AbortSignal,
) {
  return request<PublicMaterialSummaryStatus>("/material-summaries/share", {
    method: "PUT",
    body: JSON.stringify({ sessionId, summary, expectedVersion, confirmReplacement: true }),
    signal,
  });
}

export function withdrawPublicMaterialSummary(sessionId: string, expectedVersion: number, signal?: AbortSignal) {
  return request<PublicMaterialSummaryStatus>("/material-summaries/share/withdraw", {
    method: "POST",
    body: JSON.stringify({ sessionId, expectedVersion }),
    signal,
  });
}
