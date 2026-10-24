import { tokenStorage } from "./tokenStorage";
import type { Tokens } from "./contracts";
import { apiConnectionFailure, resolveApiUrl } from "./apiUrl";

export const API_URL = resolveApiUrl(
  import.meta.env.VITE_API_URL,
  typeof window === "undefined" ? undefined : window.location.href,
);
export const REGISTRATION_PASSWORD_HINT =
  "Mật khẩu cần từ 8 đến 72 ký tự, có chữ hoa, số và ký tự đặc biệt (ví dụ: @, !, #).";
let accessToken: string | null = null;
let expiresAt = 0;
let refreshing: { generation: number; promise: Promise<void> } | null = null;
let storageUpdates: Promise<void> = Promise.resolve();
let onExpired: () => void = () => {};
let generation = 0;
export function setExpiredHandler(handler: () => void) {
  onExpired = handler;
}
function persistCredential(update: () => Promise<void>) {
  const pending = storageUpdates.then(update);
  storageUpdates = pending.catch(() => {});
  return pending;
}
function assertGeneration(current: number) {
  if (current !== generation)
    throw new ApiError(409, "Tài khoản đã thay đổi. Vui lòng thử lại.");
}
async function applyTokens(tokens: Tokens, current: number, isCurrent = () => true) {
  const assertCurrent = () => {
    assertGeneration(current);
    if (!isCurrent())
      throw new ApiError(409, "Tài khoản đã thay đổi. Vui lòng thử lại.");
  };
  await persistCredential(async () => {
    assertCurrent();
    await tokenStorage.set(tokens.refresh_token);
  });
  assertCurrent();
  accessToken = tokens.access_token;
  expiresAt = Date.now() + tokens.expires_in * 1000;
}
export async function acceptTokens(tokens: Tokens, isCurrent = () => true) {
  const current = ++generation;
  accessToken = null;
  expiresAt = 0;
  refreshing = null;
  try {
    await applyTokens(tokens, current, isCurrent);
  } catch (error) {
    // A cancelled login may have already written storage; remove only its own credentials.
    if (current === generation && !isCurrent()) {
      await clearTokens();
      if (generation === current + 1) onExpired();
    }
    throw error;
  }
}
export async function clearTokens() {
  generation++;
  accessToken = null;
  expiresAt = 0;
  refreshing = null;
  await persistCredential(() => tokenStorage.clear());
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function fetchWithTimeout(path: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    path === "/materials/read" ? 115000 : ["/quizzes/generate", "/quiz/generate", "/materials/generate"].includes(path) ? 100000 : 30000,
  );
  const abort = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener("abort", abort, { once: true });
  const url = `${API_URL}${path}`;
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    const err = error as {
      message?: string;
      response?: unknown;
      config?: { url?: string };
    };
    console.error(
      "API request failed. message:",
      err?.message,
      "| response:",
      err?.response,
      "| config.url:",
      err?.config?.url,
      "| request URL:",
      url,
    );
    const failure = apiConnectionFailure(controller.signal.aborted);
    throw new ApiError(failure.status, failure.message);
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abort);
  }
}
async function decode<T>(response: Response, path?: string): Promise<T> {
  if (response.status === 204) return undefined as T;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    if (!response.ok && response.status >= 500)
      throw new ApiError(
        response.status,
        `Máy chủ API tạm thời không khả dụng (HTTP ${response.status}). Hãy thử lại sau.`,
      );
    throw new ApiError(response.status, "Máy chủ trả về dữ liệu không hợp lệ.");
  }
  if (!response.ok) {
    const problem = body && typeof body === "object" && !Array.isArray(body)
      ? body as { detail?: unknown; errors?: unknown }
      : {};
    if (path === "/auth/register") {
      if (response.status === 409)
        throw new ApiError(409, "Email này đã được đăng ký. Hãy đăng nhập hoặc dùng email khác.");
      if (response.status === 400 && Array.isArray(problem.errors)) {
        const passwordErrors = problem.errors.filter((error): error is { field?: unknown; message?: unknown } =>
          typeof error === "object" && error !== null && "field" in error,
        ).filter((error) => error.field === "password");
        if (passwordErrors.length)
          throw new ApiError(400, passwordErrors.some((error) =>
            typeof error.message === "string" && error.message.includes("72 UTF-8 bytes"),
          )
            ? "Mật khẩu quá dài. Hãy rút ngắn mật khẩu, nhất là khi dùng ký tự có dấu."
            : REGISTRATION_PASSWORD_HINT);
      }
    }
    throw new ApiError(
      response.status,
      typeof problem.detail === "string" ? problem.detail : "Yêu cầu thất bại.",
    );
  }
  return body as T;
}
export async function restoreTokens() {
  if (!refreshing || refreshing.generation !== generation) {
    const current = generation;
    const attempt = { generation: current, promise: Promise.resolve() };
    attempt.promise = (async () => {
      await storageUpdates;
      assertGeneration(current);
      const refresh = await tokenStorage.get();
      assertGeneration(current);
      if (!refresh) throw new ApiError(401, "Vui lòng đăng nhập.");
      const response = await fetchWithTimeout("/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      const tokens = await decode<Tokens>(response);
      assertGeneration(current);
      await applyTokens(tokens, current);
    })()
      .catch(async (error) => {
        if (
          current === generation &&
          error instanceof ApiError &&
          error.status === 401
        ) {
          await clearTokens();
          if (generation === current + 1) onExpired();
        }
        throw error;
      })
      .finally(() => {
        if (refreshing === attempt) refreshing = null;
      });
    refreshing = attempt;
  }
  await refreshing.promise;
}
export async function request<T>(
  path: string,
  init: RequestInit = {},
  authenticated = true,
): Promise<T> {
  const current = generation;
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  if (authenticated) {
    if (!accessToken) await restoreTokens();
    assertGeneration(current);
    if (!accessToken) throw new ApiError(401, "Vui lòng đăng nhập.");
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  let response = await fetchWithTimeout(path, { ...init, headers });
  if (authenticated) assertGeneration(current);
  if (authenticated && response.status === 401) {
    await restoreTokens();
    assertGeneration(current);
    if (!accessToken) throw new ApiError(401, "Vui lòng đăng nhập.");
    headers.set("Authorization", `Bearer ${accessToken}`);
    response = await fetchWithTimeout(path, { ...init, headers });
  }
  const result = await decode<T>(response, path);
  if (authenticated) assertGeneration(current);
  return result;
}
export const post = <T>(path: string, body: unknown, authenticated = true) =>
  request<T>(
    path,
    { method: "POST", body: JSON.stringify(body) },
    authenticated,
  );

export async function getAccessToken() {
  const current = generation;
  if (!accessToken || expiresAt - Date.now() < 30000) await restoreTokens();
  assertGeneration(current);
  if (!accessToken) throw new ApiError(401, "Vui lòng đăng nhập.");
  return accessToken;
}
