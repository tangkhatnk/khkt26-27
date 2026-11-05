import { request } from "./api";
import { postGuestAi } from "./guestAiApi";
import type { StudyPlanRequest, StudyPlanResponse } from "../../backend/src/studyPlanContracts.ts";

const REQUEST_BODY_LIMIT_BYTES = 256 * 1024;

type ReviewedPlanSource = { text: string; reviewed: boolean };
export type StudyPlanRequestInput = {
  goal: string;
  topic?: string;
  level?: string;
  preferredMinutes: number;
  includeSource?: boolean;
  source?: ReviewedPlanSource;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

async function fingerprint(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildStudyPlanRequest(input: StudyPlanRequestInput): Promise<StudyPlanRequest> {
  const goal = input.goal.trim();
  if (goal.length < 3 || goal.length > 500) throw new Error("Mục tiêu cần từ 3 đến 500 ký tự.");
  if (!Number.isSafeInteger(input.preferredMinutes) || input.preferredMinutes < 1 || input.preferredMinutes > 240)
    throw new Error("Thời lượng cần là số nguyên từ 1 đến 240 phút.");

  const topicValue = input.topic?.trim();
  const levelValue = input.level?.trim();
  const topic = topicValue || undefined;
  const level = levelValue || undefined;
  if (topic !== undefined && topic.length > 100) throw new Error("Môn học hoặc chủ đề cần từ 1 đến 100 ký tự.");
  if (level !== undefined && level.length > 100) throw new Error("Cấp học cần từ 1 đến 100 ký tự.");

  const request: StudyPlanRequest = {
    goal,
    preferredMinutes: input.preferredMinutes,
    ...(topic === undefined ? {} : { topic }),
    ...(level === undefined ? {} : { level }),
  };
  if (input.includeSource) {
    if (!input.source || !input.source.reviewed)
      throw new Error("Chỉ có thể gửi nguồn bạn đã kiểm tra và chủ động chọn.");
    const sourceText = input.source.text;
    const nonWhitespaceLength = Array.from(sourceText).filter((character) => !/\s/u.test(character)).length;
    if (sourceText.length > 50_000 || nonWhitespaceLength < 10)
      throw new Error("Nguồn cần có từ 10 đến 50.000 ký tự đã kiểm tra.");
    request.sourceText = sourceText;
    request.sourceFingerprint = await fingerprint(sourceText);
  }

  if (new TextEncoder().encode(JSON.stringify(request)).byteLength > REQUEST_BODY_LIMIT_BYTES)
    throw new Error("Yêu cầu lập kế hoạch vượt giới hạn dung lượng.");
  return request;
}

export function isValidStudyPlanResponse(
  requestInput: Pick<StudyPlanRequest, "sourceText">,
  value: unknown,
): value is StudyPlanResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["title", "steps", "finalCheck", "verificationNote"]) ||
      typeof value.title !== "string" || value.title.trim().length < 3 || value.title.length > 120 ||
      !Array.isArray(value.steps) || value.steps.length < 3 || value.steps.length > 8 ||
      (value.finalCheck !== undefined && (typeof value.finalCheck !== "string" || value.finalCheck.trim().length < 3 || value.finalCheck.length > 500)) ||
      (value.verificationNote !== undefined && (typeof value.verificationNote !== "string" || value.verificationNote.trim().length < 3 || value.verificationNote.length > 500))) return false;
  return value.steps.every((step) => {
    if (!isRecord(step) || !hasOnlyKeys(step, ["title", "action", "outcome", "check", "sourceExcerpt"]) ||
        typeof step.title !== "string" || step.title.trim().length < 3 || step.title.length > 120 ||
        typeof step.action !== "string" || step.action.trim().length < 3 || step.action.length > 400 ||
        typeof step.outcome !== "string" || step.outcome.trim().length < 3 || step.outcome.length > 400 ||
        typeof step.check !== "string" || step.check.trim().length < 3 || step.check.length > 400 ||
        (step.sourceExcerpt !== undefined &&
          (typeof step.sourceExcerpt !== "string" || step.sourceExcerpt.trim().length < 5 || step.sourceExcerpt.length > 500))) return false;
    return step.sourceExcerpt === undefined ||
      (requestInput.sourceText !== undefined && requestInput.sourceText.includes(String(step.sourceExcerpt)));
  });
}

type AccountRequest = (path: string, init: RequestInit, authenticated?: boolean) => Promise<unknown>;
type GuestRequest = (path: string, body: unknown, signal?: AbortSignal) => Promise<unknown>;

export async function generateStudyPlan(
  requestBody: StudyPlanRequest,
  options: {
    owner: string;
    signal?: AbortSignal;
    accountRequest?: AccountRequest;
    guestRequest?: GuestRequest;
  },
): Promise<StudyPlanResponse> {
  if (options.signal?.aborted) throw new DOMException("Yêu cầu đã được hủy.", "AbortError");
  const response = options.owner === "guest"
    ? await (options.guestRequest ?? postGuestAi)("/study-plans", requestBody, options.signal)
    : await (options.accountRequest ?? request)("/study-plans", {
        method: "POST",
        body: JSON.stringify(requestBody),
        signal: options.signal,
        cache: "no-store",
      }, true);
  if (!isValidStudyPlanResponse(requestBody, response))
    throw new Error("Kế hoạch nhận được chưa đúng định dạng. Hãy thử tạo lại.");
  return response;
}
