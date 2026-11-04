import { request } from "./api";
import { postGuestAi } from "./guestAiApi";

export type MaterialSummaryResponse = { summary: string };

export function summarizeReviewedMaterial(text: string, signal: AbortSignal, guest = false): Promise<MaterialSummaryResponse> {
  return guest
    ? postGuestAi<MaterialSummaryResponse>("/materials/summarize", { text }, signal)
    : request<MaterialSummaryResponse>("/materials/summarize", {
        method: "POST",
        body: JSON.stringify({ text }),
        signal,
      });
}
