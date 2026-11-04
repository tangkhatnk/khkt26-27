import { ApiError, post, request } from "./api";
import type { BreakPlan } from "../../backend/src/adventure/domain.ts";

type GuestAiCredential = { token: string; expiresAt: string };
const storageKey = "viendu:guest-ai-credential:v1";
let cachedCredential: GuestAiCredential | null = null;
let credentialRequest: Promise<GuestAiCredential> | null = null;

function validCredential(value: unknown): value is GuestAiCredential {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const credential = value as Record<string, unknown>;
  return typeof credential.token === "string" && credential.token.length > 0 &&
    typeof credential.expiresAt === "string" && Number.isFinite(Date.parse(credential.expiresAt));
}

function browserSessionStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

function removeStoredCredential() {
  cachedCredential = null;
  try { browserSessionStorage()?.removeItem(storageKey); } catch { /* Ignore unavailable browser storage. */ }
}

function storedCredential(): GuestAiCredential | null {
  if (!cachedCredential) {
    const raw = browserSessionStorage()?.getItem(storageKey);
    if (!raw) return null;
    try {
      const value: unknown = JSON.parse(raw);
      if (validCredential(value)) cachedCredential = value;
      else browserSessionStorage()?.removeItem(storageKey);
    } catch {
      browserSessionStorage()?.removeItem(storageKey);
    }
  }
  if (!cachedCredential) return null;
  if (Date.parse(cachedCredential.expiresAt) <= Date.now()) {
    removeStoredCredential();
    throw new ApiError(401, "Phiên AI riêng tư đã hết hạn. Hãy tạo lại bộ câu hỏi hoặc bài tập.");
  }
  return cachedCredential;
}

async function issueCredential(): Promise<GuestAiCredential> {
  if (!credentialRequest) {
    credentialRequest = post<GuestAiCredential>("/ai/guest/credential", {}, false)
      .then((credential) => {
        if (!validCredential(credential) || Date.parse(credential.expiresAt) <= Date.now())
          throw new ApiError(502, "Máy chủ chưa cấp được phiên AI riêng tư hợp lệ.");
        cachedCredential = credential;
        try {
          browserSessionStorage()?.setItem(storageKey, JSON.stringify(credential));
        } catch {
          // Keep the credential in memory when browser session storage is unavailable.
        }
        return credential;
      })
      .finally(() => { credentialRequest = null; });
  }
  return credentialRequest;
}

function guestPath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized.includes("..") || normalized.includes("//"))
    throw new Error("Đường dẫn AI riêng tư không hợp lệ.");
  return `/ai/guest${normalized}`;
}

export async function requestGuestAi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const route = guestPath(path);
  const credential = storedCredential() ?? await issueCredential();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `GuestAI ${credential.token}`);
  try {
    return await request<T>(route, { ...init, headers }, false);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      removeStoredCredential();
      throw new ApiError(401, "Phiên AI riêng tư đã hết hạn. Hãy tạo lại bộ câu hỏi hoặc bài tập.");
    }
    throw error;
  }
}

export function postGuestAi<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return requestGuestAi<T>(path, { method: "POST", body: JSON.stringify(body), signal });
}

export type GuestAiSessionStartInput = {
  id: string;
  target: number;
  breakPlan?: BreakPlan;
};
export type GuestAiSessionStart = {
  sessionId: string;
  startedAt: number;
  serverNow: number;
  target: number;
  breakPlan?: BreakPlan;
};

export function startGuestAiSession(input: GuestAiSessionStartInput, signal?: AbortSignal) {
  return postGuestAi<GuestAiSessionStart>("/sessions/start", input, signal);
}

/** Clears only this tab's short-lived private AI credential. */
export function clearGuestAiCredential() {
  removeStoredCredential();
}

/** Inspect this tab's credential without minting a new one. */
export function hasGuestAiCredential(): boolean {
  try {
    return storedCredential() !== null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return false;
    throw error;
  }
}
