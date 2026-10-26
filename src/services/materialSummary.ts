import { request } from "./api";

export type MaterialSummaryResponse = { summary: string };

export function summarizeReviewedMaterial(text: string, signal: AbortSignal): Promise<MaterialSummaryResponse> {
  return request<MaterialSummaryResponse>("/materials/summarize", {
    method: "POST",
    body: JSON.stringify({ text }),
    signal,
  });
}
