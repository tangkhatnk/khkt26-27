import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

export const LOCAL_PORTS = Object.freeze({ api: 3000, database: 15433, web: 8084 });
const LOOPBACK_ADDRESSES = Object.freeze(["127.0.0.1", "::1"]);

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), "..");

function portIsAvailable(host, port) {
  return new Promise((resolveAvailability, reject) => {
    const server = createServer();
    server.once("error", error => {
      if (error.code === "EADDRINUSE") resolveAvailability(false);
      else if (["EADDRNOTAVAIL", "EAFNOSUPPORT", "ENOPROTOOPT"].includes(error.code)) resolveAvailability(true);
      else reject(error);
    });
    server.listen({ host, port, exclusive: true }, () => {
      server.close(error => error ? reject(error) : resolveAvailability(true));
    });
  });
}

function responseUrl(host, port, path) {
  const address = host.includes(":") ? `[${host}]` : host;
  return `http://${address}:${port}${path}`;
}

async function probeHttp(host, port, path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000);
  try {
    const response = await fetch(responseUrl(host, port, path), { signal: controller.signal });
    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("json") ? await response.json() : await response.text();
    return { status: response.status, body };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function isHealthyApi(response) {
  return response?.status === 200 && response.body?.status === "healthy" &&
    response.body?.version === "1.0.0";
}

function isVienduWeb(response) {
  return response?.status === 200 && typeof response.body === "string" &&
    /<title>\s*Viễn Du\b/i.test(response.body);
}

async function inspectExistingService({ name, port, addresses, path, isHealthy, checkPort, request }) {
  const occupied = [];
  for (const host of addresses) {
    if (!(await checkPort(host, port))) occupied.push(host);
  }
  if (!occupied.length) return false;

  const responses = await Promise.all(occupied.map(host => request(host, port, path)));
  if (responses.every(isHealthy)) return true;
  throw new Error(`Cannot start Viễn Du: ${name} port ${port} is occupied by a server that failed its health check. The existing process was left running.`);
}

async function assertPortAvailable(name, port, addresses, checkPort) {
  for (const host of addresses) {
    if (!(await checkPort(host, port)))
      throw new Error(`Cannot start Viễn Du: ${name} port ${port} is already in use. The existing process was left running.`);
  }
}

function isRunning(child) {
  return child.exitCode == null && child.signalCode == null;
}

function waitForExit(child, timeoutMs) {
  return new Promise(resolveExit => {
    if (!isRunning(child)) return resolveExit(true);
    let settled = false;
    const finish = didExit => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      resolveExit(didExit);
    };
    const onExit = () => finish(true);
    child.once("exit", onExit);
    const timer = setTimeout(() => finish(false), timeoutMs);
  });
}

async function waitForReady(child, addresses, port, path, label, isHealthy, request, timeoutMs = 60000, signal) {
  const deadline = Date.now() + timeoutMs;
  let spawnError;
  const onError = error => { spawnError = error; };
  child.on("error", onError);
  try {
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error("Local startup was interrupted.");
      if (spawnError) throw new Error(`Could not start ${label}: ${spawnError.message}`);
      if (!isRunning(child)) throw new Error(`${label} exited before port ${port} became ready.`);
      const responses = await Promise.all(addresses.map(host => request(host, port, path)));
      if (signal?.aborted) throw new Error("Local startup was interrupted.");
      if (responses.some(isHealthy)) return;
      await new Promise(resolveDelay => setTimeout(resolveDelay, 200));
    }
    throw new Error(`${label} did not become ready on port ${port} within ${timeoutMs / 1000} seconds.`);
  } finally {
    child.removeListener("error", onError);
  }
}

function frontendEnvironment(environment) {
  const env = { ...environment };
  for (const key of Object.keys(env)) {
    if (/^(GEMINI_API_KEY|OPENAI_API_KEY|JWT_SECRET|METRICS_TOKEN|DATABASE_URL|REDIS_URL|S3_|AWS_|GOOGLE_CLIENT_ID|APPLE_CLIENT_ID)/.test(key))
      delete env[key];
  }
  const apiUrl = environment.VITE_API_URL?.trim();
  if (apiUrl) env.VITE_API_URL = apiUrl;
  else delete env.VITE_API_URL;
  return env;
}

export async function startLocalStack({
  ports = LOCAL_PORTS,
  portIsAvailable: checkPort = portIsAvailable,
  probeHttp: request = probeHttp,
  spawnChild = spawn,
  waitForReady: waitForService = waitForReady,
  environment = process.env,
  root = projectRoot,
  signal,
} = {}) {
  const children = [];
  let stopPromise;
  const onAbort = () => { void stop(); };
  signal?.addEventListener("abort", onAbort, { once: true });
  const stop = () => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      const running = [...children].reverse().filter(isRunning);
      const exitWaits = running.map(child => waitForExit(child, 5000));
      for (const child of running) child.kill("SIGTERM");
      const exited = await Promise.all(exitWaits);
      const stubborn = running.filter((_, index) => !exited[index] && isRunning(running[index]));
      const forceWaits = stubborn.map(child => waitForExit(child, 1000));
      for (const child of stubborn) child.kill("SIGKILL");
      await Promise.all(forceWaits);
      signal?.removeEventListener("abort", onAbort);
    })();
    return stopPromise;
  };

  try {
    if (signal?.aborted) throw new Error("Local startup was interrupted.");
    const apiReused = await inspectExistingService({
      name: "API", port: ports.api, addresses: LOOPBACK_ADDRESSES,
      path: "/health", isHealthy: isHealthyApi, checkPort, request,
    });
    const webReused = await inspectExistingService({
      name: "web", port: ports.web, addresses: LOOPBACK_ADDRESSES,
      path: "/", isHealthy: isVienduWeb, checkPort, request,
    });
    if (!apiReused)
      await assertPortAvailable("database", ports.database, ["127.0.0.1"], checkPort);
    if (signal?.aborted) throw new Error("Local startup was interrupted.");

    if (apiReused) console.log(`Reusing the healthy local API on port ${ports.api}.`);
    else {
      const backendDir = resolve(root, "backend");
      const tsxCli = resolve(backendDir, "node_modules/tsx/dist/cli.mjs");
      const backendEnv = { ...environment, PORT: String(ports.api) };
      console.log(`Starting local API and database on port ${ports.api}...`);
      const api = spawnChild(process.execPath, [tsxCli, "scripts/dev-local.ts"], {
        cwd: backendDir,
        env: backendEnv,
        stdio: "inherit",
        detached: true,
        windowsHide: true,
      });
      children.push(api);
      await waitForService(api, LOOPBACK_ADDRESSES, ports.api, "/health", "Local API", isHealthyApi, request, 60000, signal);
    }

    if (signal?.aborted) throw new Error("Local startup was interrupted.");
    if (webReused) console.log(`Reusing the healthy Viễn Du web app on port ${ports.web}.`);
    else {
      const viteCli = resolve(root, "node_modules/vite/bin/vite.js");
      console.log(`Starting Viễn Du web app on port ${ports.web}...`);
      const web = spawnChild(process.execPath, [viteCli, "--host", "localhost", "--port", String(ports.web), "--strictPort"], {
        cwd: root,
        env: frontendEnvironment(environment),
        stdio: "inherit",
        detached: true,
        windowsHide: true,
      });
      children.push(web);
      await waitForService(web, LOOPBACK_ADDRESSES, ports.web, "/", "Vite", isVienduWeb, request, 60000, signal);
    }
    console.log(`Viễn Du is ready at http://localhost:${ports.web}`);
    return { children, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

export async function runLocalStartup() {
  const controller = new AbortController();
  let signal = null;
  let ended = false;
  const signalHandlers = new Map();
  let resolveStop;
  const stopped = new Promise(resolve => { resolveStop = resolve; });
  const finish = value => {
    if (ended) return;
    ended = true;
    resolveStop(value);
  };
  for (const currentSignal of ["SIGINT", "SIGTERM"]) {
    const handler = () => {
      signal = currentSignal;
      controller.abort();
      finish({ signal: currentSignal });
    };
    signalHandlers.set(currentSignal, handler);
    process.once(currentSignal, handler);
  }

  let stack;
  try {
    stack = await startLocalStack({ signal: controller.signal });
  } catch (error) {
    for (const [currentSignal, handler] of signalHandlers)
      process.removeListener(currentSignal, handler);
    if (!signal) throw error;
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    return;
  }

  const exited = stack.children.find(child => !isRunning(child));
  if (exited) finish({ code: exited.exitCode, childSignal: exited.signalCode });
  else for (const child of stack.children)
    child.once("exit", (code, childSignal) => finish({ code, childSignal }));
  const result = await stopped;
  for (const [currentSignal, handler] of signalHandlers)
    process.removeListener(currentSignal, handler);
  await stack.stop();
  if (signal) process.exitCode = signal === "SIGINT" ? 130 : 143;
  else {
    console.error("A Viễn Du development process stopped unexpectedly.");
    process.exitCode = result.code || 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    await runLocalStartup();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
