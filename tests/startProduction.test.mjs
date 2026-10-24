import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import test from "node:test";
import { runPrestart, runStart } from "../scripts/start.mjs";
import {
  createProductionEnvironment,
  runChildProcess,
  runProductionStartup,
  validateProductionEnvironment,
} from "../scripts/start-production.mjs";

const root = path.resolve("/app");
const productionEnv = {
  DATABASE_URL: "postgresql://db.example/viendu",
  REDIS_URL: "rediss://cache.example:6380",
  JWT_SECRET: "a-secure-random-secret-with-more-than-32-characters",
  PORT: "8080",
};
const artifacts = new Set([
  path.join(root, "dist/index.html"),
  path.join(root, "backend/dist/server.js"),
  path.join(root, "backend/prisma/schema.prisma"),
  path.join(root, "backend/prisma/seed.ts"),
  path.join(root, "backend/prisma/migrations"),
]);

test("production startup rejects missing cloud services before running commands", async () => {
  const calls = [];

  await assert.rejects(
    runProductionStartup({
      env: { JWT_SECRET: productionEnv.JWT_SECRET },
      root,
      exists: (path) => artifacts.has(path),
      run: async (...args) => calls.push(args),
      logger: { log() {} },
    }),
    /DATABASE_URL.*REDIS_URL/,
  );

  assert.deepEqual(calls, []);
});

test("production startup rejects an invalid Redis URL and short JWT secret", () => {
  assert.throws(
    () =>
      validateProductionEnvironment({
        ...productionEnv,
        REDIS_URL: "localhost:6379",
        JWT_SECRET: "too-short",
      }),
    /REDIS_URL.*JWT_SECRET/,
  );
});

test("production artifacts are checked before migrations or server startup", async () => {
  const calls = [];

  await assert.rejects(
    runProductionStartup({
      env: productionEnv,
      root,
      exists: (artifactPath) =>
        artifactPath !== path.join(root, "backend/dist/server.js") && artifacts.has(artifactPath),
      run: async (...args) => calls.push(args),
      logger: { log() {} },
    }),
    /backend\/dist\/server\.js/,
  );

  assert.deepEqual(calls, []);
});

test("production startup migrates, seeds, then starts with Railway-safe defaults", async () => {
  const calls = [];
  const env = { ...productionEnv };

  await runProductionStartup({
    env,
    root,
    exists: (path) => artifacts.has(path),
    run: async (command, args, options) => calls.push({ command, args, options }),
    logger: { log() {} },
  });

  assert.deepEqual(
    calls.map(({ command, args }) => [command, args]),
    [
      ["npm", ["--prefix", "backend", "run", "db:migrate"]],
      ["npm", ["--prefix", "backend", "run", "db:seed"]],
      [process.execPath, ["backend/dist/server.js"]],
    ],
  );
  assert.equal(calls[0].options.cwd, root);
  assert.equal(calls[0].options.env.NODE_ENV, "production");
  assert.equal(calls[0].options.env.HOST, "0.0.0.0");
  assert.equal(calls[0].options.env.PORT, "8080");
  assert.equal(calls[0].options.env.WEB_DIST_DIR, path.resolve(root, "dist"));
  assert.equal(calls[0].options.env.STORAGE_DRIVER, "disabled");
});

test("explicit storage configuration is preserved for production", () => {
  assert.equal(
    createProductionEnvironment({ ...productionEnv, STORAGE_DRIVER: "s3" }, root)
      .STORAGE_DRIVER,
    "s3",
  );
});

test("a failed migration prevents seeding and server startup", async () => {
  const calls = [];

  await assert.rejects(
    runProductionStartup({
      env: productionEnv,
      root,
      exists: (path) => artifacts.has(path),
      run: async (command, args) => {
        calls.push([command, args]);
        throw new Error("migration failed");
      },
      logger: { log() {} },
    }),
    /migration failed/,
  );

  assert.equal(calls.length, 1);
});

test("production and either Railway environment variable select cloud startup", async (context) => {
  const environments = [
    { NODE_ENV: "production" },
    { NODE_ENV: "development", RAILWAY_ENVIRONMENT: "production" },
    { NODE_ENV: "development", RAILWAY_ENVIRONMENT_NAME: "production" },
  ];

  for (const env of environments) {
    await context.test(JSON.stringify(env), async () => {
      const calls = [];

      await runStart({
        env,
        startProduction: async () => calls.push("production"),
        loadLocal: async () => ({ runLocalStartup: async () => calls.push("local") }),
      });

      assert.deepEqual(calls, ["production"]);
    });
  }
});

test("plain local startup loads and invokes the exported local entry point", async () => {
  let loads = 0;
  let starts = 0;

  await runStart({
    env: { NODE_ENV: "development" },
    startProduction: async () => assert.fail("production launcher should not run"),
    loadLocal: async () => {
      loads += 1;
      return {
        runLocalStartup: async () => {
          starts += 1;
        },
      };
    },
  });

  assert.equal(loads, 1);
  assert.equal(starts, 1);
});

test("production prestart skips local asset preparation", async () => {
  let loaded = false;

  const result = await runPrestart({
    env: { NODE_ENV: "production" },
    loadMaterialWorker: async () => {
      loaded = true;
      throw new Error("production must skip local preparation");
    },
  });

  assert.equal(result, false);
  assert.equal(loaded, false);
});

test("local prestart still prepares the same-origin PDF worker", async () => {
  let imports = 0;
  let preparations = 0;

  const result = await runPrestart({
    env: { NODE_ENV: "development" },
    loadMaterialWorker: async () => {
      imports += 1;
      return {
        prepareMaterialWorker: async () => {
          preparations += 1;
        },
      };
    },
  });

  assert.equal(result, true);
  assert.equal(imports, 1);
  assert.equal(preparations, 1);
});

test("startup forwards termination signals to its active child process", async () => {
  const signalSource = new EventEmitter();
  const child = new EventEmitter();
  const forwardedSignals = [];
  child.kill = (signal) => forwardedSignals.push(signal);
  let spawnArguments;

  const pending = runChildProcess("npm", ["run", "db:migrate"], {
    cwd: root,
    env: productionEnv,
    signalSource,
    spawn: (...args) => {
      spawnArguments = args;
      return child;
    },
  });

  signalSource.emit("SIGTERM");
  child.emit("close", null, "SIGTERM");

  await assert.rejects(pending, /exited on SIGTERM/);
  assert.equal(spawnArguments[0], "npm");
  assert.deepEqual(forwardedSignals, ["SIGTERM"]);
  assert.equal(signalSource.listenerCount("SIGINT"), 0);
  assert.equal(signalSource.listenerCount("SIGTERM"), 0);
});
