import { spawn as nodeSpawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function validateProductionEnvironment(env) {
  const missing = [];
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    missing.push("DATABASE_URL");
  } else {
    try {
      const url = new URL(databaseUrl);
      if (!["postgres:", "postgresql:"].includes(url.protocol)) {
        missing.push("DATABASE_URL (must be a PostgreSQL URL)");
      }
    } catch {
      missing.push("DATABASE_URL (must be a valid PostgreSQL URL)");
    }
  }

  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) {
    missing.push("REDIS_URL");
  } else {
    try {
      const url = new URL(redisUrl);
      if (!["redis:", "rediss:"].includes(url.protocol)) {
        missing.push("REDIS_URL (must use redis:// or rediss://)");
      }
    } catch {
      missing.push("REDIS_URL (must be a valid Redis URL)");
    }
  }

  if ((env.JWT_SECRET ?? "").trim().length < 32) {
    missing.push("JWT_SECRET (at least 32 characters)");
  }

  if (missing.length) {
    throw new Error(`Production startup requires valid ${missing.join(", ")}.`);
  }
}

export function createProductionEnvironment(env, root = projectRoot) {
  return {
    ...env,
    HOST: "0.0.0.0",
    NODE_ENV: "production",
    WEB_DIST_DIR: path.resolve(root, "dist"),
    STORAGE_DRIVER: env.STORAGE_DRIVER?.trim() || "disabled",
  };
}

export function runChildProcess(
  command,
  args,
  { cwd, env, spawn = nodeSpawn, signalSource = process },
) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    const forwardSignal = (signal) => () => child.kill(signal);
    const handlers = new Map();
    for (const signal of ["SIGINT", "SIGTERM"]) {
      const handler = forwardSignal(signal);
      handlers.set(signal, handler);
      signalSource.on(signal, handler);
    }
    const cleanup = () => {
      for (const [signal, handler] of handlers) {
        signalSource.removeListener(signal, handler);
      }
    };

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `${command} ${args.join(" ")} exited ${signal ? `on ${signal}` : `with code ${code}`}.`,
          ),
        );
      }
    });
  });
}

export async function runProductionStartup({
  env = process.env,
  root = projectRoot,
  exists = existsSync,
  run = runChildProcess,
  logger = console,
} = {}) {
  validateProductionEnvironment(env);

  const requiredArtifacts = [
    "dist/index.html",
    "backend/dist/server.js",
    "backend/prisma/schema.prisma",
    "backend/prisma/seed.ts",
    "backend/prisma/migrations",
  ];
  const missingArtifacts = requiredArtifacts.filter(
    (artifact) => !exists(path.join(root, artifact)),
  );
  if (missingArtifacts.length) {
    throw new Error(
      `Production build is incomplete. Missing ${missingArtifacts.join(", ")}; run npm run build.`,
    );
  }

  const childEnv = createProductionEnvironment(env, root);
  const commands = [
    ["npm", ["--prefix", "backend", "run", "db:migrate"]],
    ["npm", ["--prefix", "backend", "run", "db:seed"]],
    [process.execPath, ["backend/dist/server.js"]],
  ];

  for (const [command, args] of commands) {
    logger.log(`Production startup: ${command} ${args.join(" ")}`);
    await run(command, args, { cwd: root, env: childEnv });
  }
}

function isMainModule() {
  return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMainModule()) {
  try {
    await runProductionStartup();
  } catch (error) {
    console.error("Production startup failed:", error);
    process.exitCode = 1;
  }
}
