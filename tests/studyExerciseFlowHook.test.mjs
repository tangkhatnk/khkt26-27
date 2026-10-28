import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const hookRuntimeId = "\0study-exercise-test-react";
const hookRuntimeSource = `
function runtime() {
  const value = globalThis.__studyExerciseHookRuntime;
  if (!value) throw new Error("Hook rendered outside its test runtime");
  return value;
}
export const useCallback = (...args) => runtime().useCallback(...args);
export const useEffect = (...args) => runtime().useEffect(...args);
export const useRef = (...args) => runtime().useRef(...args);
export const useState = (...args) => runtime().useState(...args);
`;
const hookRuntimePlugin = {
  name: "study-exercise-test-react-runtime",
  enforce: "pre",
  resolveId(source) {
    return source === "react" ? hookRuntimeId : null;
  },
  load(id) {
    return id === hookRuntimeId ? hookRuntimeSource : null;
  },
};

let vite;
let flow;
let api;

before(async () => {
  vite = await createServer({
    configFile: resolve(projectRoot, "vite.config.ts"),
    configLoader: "runner",
    cacheDir: resolve(projectRoot, "node_modules/.vite-study-exercise-hook-tests"),
    appType: "custom",
    logLevel: "silent",
    plugins: [hookRuntimePlugin],
    server: { middlewareMode: true },
    ssr: { noExternal: ["react"] },
  });
  flow = await vite.ssrLoadModule("/src/adventure/useStudyExerciseFlow.ts");
  api = await vite.ssrLoadModule("/src/services/api.ts");
});

after(async () => {
  await vite?.close();
});

const previousGlobals = {};

beforeEach(async () => {
  previousGlobals.window = globalThis.window;
  previousGlobals.sessionStorage = globalThis.sessionStorage;
  previousGlobals.fetch = globalThis.fetch;
  const values = new Map();
  globalThis.window = { location: { href: "http://localhost/" } };
  globalThis.sessionStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  await api.acceptTokens({ access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600 });
});

afterEach(async () => {
  await api.clearTokens();
  if (previousGlobals.fetch === undefined) delete globalThis.fetch;
  else globalThis.fetch = previousGlobals.fetch;
  if (previousGlobals.window === undefined) delete globalThis.window;
  else globalThis.window = previousGlobals.window;
  if (previousGlobals.sessionStorage === undefined) delete globalThis.sessionStorage;
  else globalThis.sessionStorage = previousGlobals.sessionStorage;
});

function createHookRuntime() {
  const slots = [];
  let cursor = 0;
  let pendingEffects = [];
  const stateWaiters = [];
  const sameDependencies = (left, right) => left && right && left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index]));
  const runtime = {
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { kind: "ref", value: { current: initial } };
      return slots[index].value;
    },
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { kind: "state", value: typeof initial === "function" ? initial() : initial };
      const slot = slots[index];
      const setValue = next => {
        const value = typeof next === "function" ? next(slot.value) : next;
        if (!Object.is(slot.value, value)) {
          slot.value = value;
          for (const resolveState of stateWaiters.splice(0)) resolveState();
        }
      };
      return [slot.value, setValue];
    },
    useCallback(callback, dependencies) {
      const index = cursor++;
      const slot = slots[index];
      if (!slot || !sameDependencies(slot.dependencies, dependencies)) {
        slots[index] = { kind: "callback", value: callback, dependencies };
      }
      return slots[index].value;
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      const slot = slots[index] ?? { kind: "effect", dependencies: undefined, cleanup: null };
      const changed = !sameDependencies(slot.dependencies, dependencies);
      slots[index] = slot;
      if (changed) pendingEffects.push({ slot, effect, dependencies });
    },
    render(callback) {
      cursor = 0;
      pendingEffects = [];
      globalThis.__studyExerciseHookRuntime = runtime;
      let result;
      try {
        result = callback();
      } finally {
        delete globalThis.__studyExerciseHookRuntime;
      }
      const changedEffects = pendingEffects;
      pendingEffects = [];
      for (const { slot } of changedEffects) slot.cleanup?.();
      for (const { slot, effect, dependencies } of changedEffects) {
        slot.dependencies = dependencies;
        const cleanup = effect();
        slot.cleanup = typeof cleanup === "function" ? cleanup : null;
      }
      return result;
    },
    waitForStateChange() {
      return new Promise(resolveState => stateWaiters.push(resolveState));
    },
    unmount() {
      for (const slot of slots) slot?.cleanup?.();
    },
  };
  return runtime;
}

function studyExerciseOptions(overrides = {}) {
  let latestView = overrides.view ?? "focus";
  return {
    ownerId: "owner-a",
    authenticated: true,
    needsLogin: false,
    online: true,
    loaded: true,
    exclusive: true,
    view: latestView,
    plannedSessionId: "session-a",
    sources: [],
    activeSession: { id: "session-a", owner: "owner-a", sources: [] },
    summarySession: null,
    summarySources: [],
    getAuthGeneration: () => 1,
    getWorkspaceGeneration: () => 1,
    isOwnerWorkspaceCurrent: () => true,
    isRouteScopeCurrent: (_ownerId, sessionId, view) => sessionId === "session-a" && view === latestView,
    isPersistedOwnerSession: () => true,
    isPersistedCompleted: () => false,
    sync: async () => {},
    update(next) {
      if (next.view) latestView = next.view;
      return { ...this, ...next };
    },
    ...overrides,
  };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function exerciseRequestKind(url, method) {
  const path = new URL(String(url), "http://localhost").pathname;
  if (path.endsWith("/bind")) return "bind";
  if (method === "GET" && path.includes("/study-exercises/session/")) return "lookup";
  return "other";
}

test("focus binds once when entering the session, despite start callback and checkpoint source clones", async () => {
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const kind = exerciseRequestKind(url, init.method ?? "GET");
    requests.push({ kind, signal: init.signal });
    return jsonResponse(kind === "bind" ? { ok: true } : { detail: "No set" }, kind === "lookup" ? 404 : 200);
  };

  const runtime = createHookRuntime();
  let options = studyExerciseOptions({ view: "ticket", activeSession: null });
  let result = runtime.render(() => flow.useStudyExerciseFlow(options));
  result.setPreparation({
    id: "request-a",
    plannedSessionId: "session-a",
    mode: "provided",
    exercises: [{ id: "question-a", prompt: "Solve x + 2 = 5." }],
  });

  const activeSession = { id: "session-a", owner: "owner-a", sources: [] };
  options = studyExerciseOptions({ view: "focus", activeSession });
  result = runtime.render(() => flow.useStudyExerciseFlow(options));
  result.onFocusStarted("session-a");

  // tick() structured-clones the active trip at each five-second checkpoint.
  const checkpointSession = { ...activeSession, sources: [...activeSession.sources] };
  options = options.update({ activeSession: checkpointSession });
  runtime.render(() => flow.useStudyExerciseFlow(options));
  await Promise.resolve();

  assert.equal(requests.filter(request => request.kind === "bind").length, 1);
  runtime.unmount();
});

test("a delayed focus lookup survives a checkpoint clone and hydrates its server snapshot", async () => {
  const requests = [];
  const lookups = [];
  globalThis.fetch = (url, init = {}) => {
    const kind = exerciseRequestKind(url, init.method ?? "GET");
    requests.push({ kind, signal: init.signal });
    if (kind === "lookup")
      return new Promise(resolveResponse => lookups.push(resolveResponse));
    return Promise.resolve(jsonResponse({ ok: true }));
  };

  const runtime = createHookRuntime();
  const source = { id: "source-a", name: "reviewed.txt", text: "Synthetic reviewed text.", reviewed: true };
  const activeSession = { id: "session-a", owner: "owner-a", sources: [source] };
  let options = studyExerciseOptions({ view: "focus", activeSession });
  let result = runtime.render(() => flow.useStudyExerciseFlow(options));
  const firstLookup = requests.find(request => request.kind === "lookup");
  assert.ok(firstLookup);
  assert.equal(lookups.length, 1);

  try {
    const checkpointSession = { ...activeSession, sources: [{ ...source }] };
    options = options.update({ activeSession: checkpointSession });
    result = runtime.render(() => flow.useStudyExerciseFlow(options));
    assert.equal(firstLookup.signal.aborted, false);
    assert.equal(requests.filter(request => request.kind === "lookup").length, 1);
    assert.equal(requests.filter(request => request.kind === "bind").length, 1);

    const stateChanged = runtime.waitForStateChange();
    lookups[0](jsonResponse({
      id: "request-a",
      plannedSessionId: "session-a",
      mode: "generated",
      sourceFingerprint: "a".repeat(64),
      exercises: [{ id: "question-a", prompt: "Solve x + 2 = 5." }],
    }));
    await stateChanged;
    result = runtime.render(() => flow.useStudyExerciseFlow(options));
    assert.equal(result.preparation?.id, "request-a");
    assert.equal(result.preparation?.mode, "generated");
    assert.equal(firstLookup.signal.aborted, false);
  } finally {
    for (const resolveLookup of lookups) resolveLookup(jsonResponse({ detail: "released" }, 404));
    await new Promise(resolveState => setImmediate(resolveState));
    runtime.unmount();
  }
});
