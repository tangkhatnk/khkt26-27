import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tokens } from "../../src/services/contracts";

const storage = vi.hoisted(() => ({
  value: null as string | null,
  get: vi.fn(),
  set: vi.fn(),
  clear: vi.fn(),
}));
vi.mock("../../src/services/tokenStorage", () => ({ tokenStorage: storage }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const tokens = (name: string): Tokens => ({
  access_token: `${name}-access`, refresh_token: `${name}-refresh`, expires_in: 900,
});
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("API account boundaries", () => {
  let api: typeof import("../../src/services/api");
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    fetchMock.mockReset();
    storage.value = null;
    storage.get.mockImplementation(async () => storage.value);
    storage.set.mockImplementation(async (value: string) => { storage.value = value; });
    storage.clear.mockImplementation(async () => { storage.value = null; });
    vi.stubGlobal("fetch", fetchMock);
    api = await import("../../src/services/api");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("explains the registration password rejection instead of exposing Zod JSON", async () => {
    const issues = [{
      origin: "string", code: "invalid_format", format: "regex",
      pattern: "/[^a-zA-Z0-9]/", path: ["password"],
      message: "Invalid string: must match pattern /[^a-zA-Z0-9]/",
    }];
    fetchMock.mockResolvedValueOnce(response({
      type: "https://api.pomodoro-focus.com/errors/validation-error",
      title: "validation error", status: 400, detail: JSON.stringify(issues),
      instance: "/api/v1/auth/register",
      errors: [{ field: "password", message: issues[0].message }],
    }, 400));
    const error = await api.post("/auth/register", {
      email: "registration@example.com", name: "Nguyễn An", password: "Password123",
    }, false).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(api.ApiError);
    expect(error).toMatchObject({ status: 400 });
    expect((error as Error).message).toMatch(/Mật khẩu.*chữ hoa.*số.*ký tự đặc biệt/);
    expect((error as Error).message).not.toMatch(/invalid_format|pattern|regex/);
  });

  it("explains the UTF-8 password limit with an actionable registration error", async () => {
    fetchMock.mockResolvedValueOnce(response({
      detail: '[{"code":"custom","path":["password"]}]',
      errors: [{ field: "password", message: "Password must be at most 72 UTF-8 bytes" }],
    }, 400));
    await expect(api.post("/auth/register", {}, false)).rejects.toThrow(/Mật khẩu quá dài.*rút ngắn/);
  });

  it("offers sign-in when the registration email already exists", async () => {
    fetchMock.mockResolvedValueOnce(response({ detail: "Resource already exists" }, 409));
    await expect(api.post("/auth/register", {}, false)).rejects.toThrow(/Email.*đăng ký.*đăng nhập/);
  });

  it("reports a plain-text gateway failure as API unavailable without exposing its body", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Bad Gateway from local proxy", {
      status: 502,
      headers: { "Content-Type": "text/plain" },
    }));
    const error = await api.post("/auth/login", {}, false).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(api.ApiError);
    expect(error).toMatchObject({ status: 502 });
    expect((error as Error).message).toMatch(/không khả dụng.*502.*thử lại/i);
    expect((error as Error).message).not.toContain("Bad Gateway");
  });

  it("keeps a null JSON 401 refresh envelope on the authentication error path", async () => {
    await api.acceptTokens(tokens("old"));
    const expired = vi.fn();
    api.setExpiredHandler(expired);
    fetchMock.mockResolvedValueOnce(response(null, 401));

    const error = await api.restoreTokens().catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(api.ApiError);
    expect(error).toMatchObject({ status: 401 });
    expect(storage.value).toBeNull();
    expect(expired).toHaveBeenCalledOnce();
  });

  it("keeps a successful non-JSON response distinct from an unavailable API", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>unexpected</html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    }));
    const error = await api.post("/auth/login", {}, false).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(api.ApiError);
    expect(error).toMatchObject({ status: 200 });
    expect((error as Error).message).toBe("Máy chủ trả về dữ liệu không hợp lệ.");
  });

  it("preserves JSON problem details when an API request fails", async () => {
    fetchMock.mockResolvedValueOnce(response({ detail: "Invalid email or password" }, 401));
    const error = await api.post("/auth/login", {}, false).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(api.ApiError);
    expect(error).toMatchObject({ status: 401 });
    expect((error as Error).message).toBe("Invalid email or password");
  });

  it("falls back safely for a malformed registration error envelope", async () => {
    fetchMock.mockResolvedValueOnce(response({ detail: null, errors: [null] }, 400));
    const error = await api.post("/auth/register", {}, false).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(api.ApiError);
    expect(error).toMatchObject({ status: 400 });
    expect((error as Error).message).toBe("Yêu cầu thất bại.");
  });

  it("does not overwrite a new login with an old refresh response", async () => {
    await api.acceptTokens(tokens("old"));
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const refresh = api.restoreTokens().catch((error: unknown) => error);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await api.clearTokens();
    await api.acceptTokens(tokens("new"));
    pending.resolve(response(tokens("stale")));
    await refresh;

    expect(storage.value).toBe("new-refresh");
    expect(await api.getAccessToken()).toBe("new-access");
  });

  it("invalidates an old refresh when login is replaced directly", async () => {
    await api.acceptTokens(tokens("old"));
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const refresh = api.restoreTokens().catch((error: unknown) => error);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await api.acceptTokens(tokens("new"));
    pending.resolve(response(tokens("stale")));
    expect(await refresh).toBeInstanceOf(api.ApiError);
    expect(storage.value).toBe("new-refresh");
    expect(await api.getAccessToken()).toBe("new-access");
  });

  it("does not expire a new login when an old refresh returns 401", async () => {
    await api.acceptTokens(tokens("old"));
    const expired = vi.fn();
    api.setExpiredHandler(expired);
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const refresh = api.restoreTokens().catch((error: unknown) => error);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await api.clearTokens();
    await api.acceptTokens(tokens("new"));
    pending.resolve(response({ detail: "expired" }, 401));
    await refresh;

    expect(expired).not.toHaveBeenCalled();
    expect(storage.value).toBe("new-refresh");
    expect(await api.getAccessToken()).toBe("new-access");
  });

  it("never retries an old account's mutation with a new account's token", async () => {
    await api.acceptTokens(tokens("old"));
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    fetchMock.mockImplementation(async (url) =>
      String(url).endsWith("/auth/refresh")
        ? response(tokens("new")) : response({ id: "new-account-session" }),
    );
    const mutation = api.post("/sessions", { goal_text: "old account" })
      .catch((error: unknown) => error);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await api.clearTokens();
    await api.acceptTokens(tokens("new"));
    pending.resolve(response({ detail: "expired" }, 401));
    const error = await mutation;

    expect(error).toBeInstanceOf(api.ApiError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects a successful old-account response after an account change", async () => {
    await api.acceptTokens(tokens("old"));
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const request = api.request("/users/me").catch((error: unknown) => error);
    await api.acceptTokens(tokens("new"));
    pending.resolve(response({ id: "old-user" }));
    expect(await request).toBeInstanceOf(api.ApiError);
  });

  it("shares one refresh between requests from the same account", async () => {
    storage.value = "old-refresh";
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const first = api.restoreTokens();
    const second = api.restoreTokens();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    pending.resolve(response(tokens("fresh")));
    await Promise.all([first, second]);
    expect(await api.getAccessToken()).toBe("fresh-access");
  });

  it("serializes credential storage writes when logout happens during login", async () => {
    const pending = deferred<void>();
    storage.set.mockImplementationOnce(async (value: string) => {
      await pending.promise;
      storage.value = value;
    });
    const login = api.acceptTokens(tokens("old")).catch((error: unknown) => error);
    await vi.waitFor(() => expect(storage.set).toHaveBeenCalledOnce());
    const logout = api.clearTokens();
    const nextLogin = api.acceptTokens(tokens("new"));
    pending.resolve();
    await Promise.all([login, logout, nextLogin]);
    expect(storage.value).toBe("new-refresh");
    expect(await api.getAccessToken()).toBe("new-access");
  });

  it("discards credentials if a login is superseded during its storage write", async () => {
    const pending = deferred<void>();
    let current = true;
    const expired = vi.fn();
    api.setExpiredHandler(expired);
    storage.set.mockImplementationOnce(async (value: string) => {
      await pending.promise;
      storage.value = value;
    });
    const login = api.acceptTokens(tokens("superseded"), () => current)
      .catch((error: unknown) => error);
    await vi.waitFor(() => expect(storage.set).toHaveBeenCalledOnce());
    current = false;
    pending.resolve();
    expect(await login).toBeInstanceOf(api.ApiError);
    expect(storage.value).toBeNull();
    expect(expired).toHaveBeenCalledOnce();
  });

  it("allows a new account to refresh while an old refresh is still pending", async () => {
    await api.acceptTokens(tokens("old"));
    const oldResponse = deferred<Response>();
    const newResponse = deferred<Response>();
    fetchMock.mockReturnValueOnce(oldResponse.promise).mockReturnValueOnce(newResponse.promise);
    const oldRefresh = api.restoreTokens().catch((error: unknown) => error);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await api.acceptTokens(tokens("new"));
    const newRefresh = api.restoreTokens();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    oldResponse.resolve(response(tokens("stale")));
    await oldRefresh;
    const shared = api.restoreTokens();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    newResponse.resolve(response(tokens("fresh-new")));
    await Promise.all([newRefresh, shared]);
    expect(storage.value).toBe("fresh-new-refresh");
  });

  it("clears and reports an expired refresh for the current account", async () => {
    await api.acceptTokens(tokens("old"));
    const expired = vi.fn();
    api.setExpiredHandler(expired);
    fetchMock.mockResolvedValueOnce(response({ detail: "expired" }, 401));
    await expect(api.restoreTokens()).rejects.toMatchObject({ status: 401 });
    expect(storage.value).toBeNull();
    expect(expired).toHaveBeenCalledOnce();
  });
});
