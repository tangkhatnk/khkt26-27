import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { afterEach } from "node:test";
import ts from "typescript";

const originalWindow = globalThis.window;
const originalSessionStorage = globalThis.sessionStorage;
let api;
let calls;
let responseHandler;
let apiErrorClass;

function loadGuestApi() {
  calls = [];
  responseHandler = async () => ({ ok: true });
  const source = readFileSync(new URL("../src/services/guestAiApi.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }
  apiErrorClass = ApiError;
  const mockedApi = {
    ApiError,
    async post(path, body, authenticated) {
      calls.push({ kind: "credential", path, body, authenticated });
      return { token: "opaque-guest-token", expiresAt: new Date(Date.now() + 60_000).toISOString() };
    },
    async request(path, init, authenticated) {
      calls.push({ kind: "request", path, init, authenticated });
      return responseHandler(path, init, authenticated);
    },
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(() => mockedApi, mod, mod.exports);
  return mod.exports;
}

function installStorage() {
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
  globalThis.window = { sessionStorage: storage };
  globalThis.sessionStorage = storage;
  return storage;
}

afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.sessionStorage = originalSessionStorage;
});

test("guest credentials only authorize requests under the private AI path", async () => {
  installStorage();
  api = loadGuestApi();

  assert.deepEqual(await api.requestGuestAi("/quizzes/generate", { method: "POST", body: "{}" }), { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].path, "/ai/guest/credential");
  assert.equal(calls[0].authenticated, false);
  assert.equal(calls[1].path, "/ai/guest/quizzes/generate");
  assert.equal(calls[1].authenticated, false);
  assert.equal(new Headers(calls[1].init.headers).get("Authorization"), "GuestAI opaque-guest-token");
  assert.equal(api.hasGuestAiCredential(), true);

  await api.requestGuestAi("/adventure/guest-sessions", {});
  assert.equal(calls[2].path, "/ai/guest/adventure/guest-sessions");
  assert.notEqual(calls[2].path, "/adventure/guest-sessions");
});

test("a guest 401 clears only the private credential and does not retry the request", async () => {
  installStorage();
  api = loadGuestApi();
  responseHandler = async () => { throw new apiErrorClass(401, "expired"); };

  await assert.rejects(api.requestGuestAi("/quizzes/quiz-id/grade", { method: "POST", body: "{}" }),
    (error) => error.status === 401);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].path, "/ai/guest/quizzes/quiz-id/grade");
  assert.equal(new Headers(calls[1].init.headers).get("Authorization"), "GuestAI opaque-guest-token");
  assert.equal(api.hasGuestAiCredential(), false);
});

test("guest exercise start uses the strict body and returns both the immutable anchor and fresh server time", async () => {
  installStorage();
  api = loadGuestApi();
  responseHandler = async () => ({
    sessionId: "session-a",
    startedAt: 1_700_000_000_000,
    serverNow: 1_700_000_000_325,
    target: 120,
    breakPlan: { count: 1, seconds: 60 },
  });

  const result = await api.startGuestAiSession({
    id: "session-a",
    target: 120,
    breakPlan: { count: 1, seconds: 60 },
  });

  assert.equal(result.startedAt, 1_700_000_000_000);
  assert.equal(result.serverNow, 1_700_000_000_325);
  const start = calls.find(call => call.kind === "request");
  assert.equal(start.path, "/ai/guest/sessions/start");
  assert.deepEqual(JSON.parse(start.init.body), {
    id: "session-a", target: 120, breakPlan: { count: 1, seconds: 60 },
  });
  assert.equal(new Headers(start.init.headers).get("Authorization"), "GuestAI opaque-guest-token");
});

test("retry after a lost start response reuses the same planned session and accepts a fresh server sample", async () => {
  installStorage();
  api = loadGuestApi();
  let startAttempts = 0;
  responseHandler = async (path) => {
    if (path !== "/ai/guest/sessions/start") return { ok: true };
    startAttempts += 1;
    if (startAttempts === 1) throw new TypeError("Connection lost after request dispatch.");
    return {
      sessionId: "session-a",
      startedAt: 1_700_000_000_000,
      serverNow: 1_700_000_004_000,
      target: 120,
      breakPlan: { count: 1, seconds: 60 },
    };
  };
  const input = { id: "session-a", target: 120, breakPlan: { count: 1, seconds: 60 } };

  await assert.rejects(api.startGuestAiSession(input), /Connection lost/u);
  const replay = await api.startGuestAiSession(input);

  assert.equal(startAttempts, 2);
  assert.equal(replay.startedAt, 1_700_000_000_000);
  assert.equal(replay.serverNow, 1_700_000_004_000);
  const starts = calls.filter(call => call.path === "/ai/guest/sessions/start");
  assert.equal(starts.length, 2);
  assert.deepEqual(JSON.parse(starts[0].init.body), input);
  assert.deepEqual(JSON.parse(starts[1].init.body), input);
});
