import path from "node:path";
import { fileURLToPath } from "node:url";
import { runProductionStartup } from "./start-production.mjs";

export function isProductionEnvironment(env = process.env) {
  return (
    env.NODE_ENV === "production" ||
    Boolean(env.RAILWAY_ENVIRONMENT?.trim()) ||
    Boolean(env.RAILWAY_ENVIRONMENT_NAME?.trim())
  );
}

export async function runStart({
  env = process.env,
  startProduction = runProductionStartup,
  loadLocal = () => import("./start-local.mjs"),
} = {}) {
  if (isProductionEnvironment(env)) return startProduction();
  const localLauncher = await loadLocal();
  if (typeof localLauncher.runLocalStartup !== "function") {
    throw new Error("scripts/start-local.mjs must export runLocalStartup().");
  }
  return localLauncher.runLocalStartup();
}

export async function runPrestart({
  env = process.env,
  loadMaterialWorker = () => import("./prepare-material-worker.mjs"),
} = {}) {
  if (isProductionEnvironment(env)) return false;
  const workerModule = await loadMaterialWorker();
  if (typeof workerModule.prepareMaterialWorker !== "function") {
    throw new Error("scripts/prepare-material-worker.mjs must export prepareMaterialWorker().");
  }
  await workerModule.prepareMaterialWorker();
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    if (process.argv[2] === "--prepare-only") {
      await runPrestart();
    } else {
      await runStart();
    }
  } catch (error) {
    console.error("Viễn Du startup failed:", error);
    process.exitCode = 1;
  }
}
