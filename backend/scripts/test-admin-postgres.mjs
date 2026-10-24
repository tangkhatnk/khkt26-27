import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const backendDirectory = fileURLToPath(new URL("../", import.meta.url));
const databaseUrl = process.env.ADMIN_TEST_DATABASE_URL;

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!databaseUrl)
  fail("Set ADMIN_TEST_DATABASE_URL to the disposable loopback admin_concurrency database.");

let parsedUrl;
try {
  parsedUrl = new URL(databaseUrl);
} catch {
  fail("ADMIN_TEST_DATABASE_URL must be a valid PostgreSQL URL for the disposable test database.");
}

if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol) ||
  parsedUrl.hostname !== "127.0.0.1" ||
  parsedUrl.port !== "15435" ||
  parsedUrl.pathname !== "/admin_concurrency") {
  fail("Admin PostgreSQL tests are restricted to 127.0.0.1:15435/admin_concurrency.");
}

const childEnvironment = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  REDIS_URL: "redis://127.0.0.1:6379",
  JWT_SECRET: "native-admin-test-secret-not-for-production",
  ADMIN_USER_IDS: "",
  STORAGE_DRIVER: "disabled",
};
const prismaCli = fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url));
const vitestCli = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
const outputRedactions = [databaseUrl];

function displayOutput(value) {
  let output = String(value ?? "");
  for (const secret of outputRedactions) output = output.replaceAll(secret, "[redacted ADMIN_TEST_DATABASE_URL]");
  output = output.replace(/(?:postgres|postgresql):\/\/[^\s'"`]+/gi, "[redacted PostgreSQL URL]");
  if (output) process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
}

function run(label, args) {
  const result = spawnSync(process.execPath, args, {
    cwd: backendDirectory,
    env: childEnvironment,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  displayOutput(result.stdout);
  displayOutput(result.stderr);
  if (result.error) fail(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`${label} failed with exit code ${result.status ?? "unknown"}.`);
}

console.log("Applying migrations to the disposable loopback admin_concurrency database.");
run("Prisma migrate deploy", [prismaCli, "migrate", "deploy"]);
console.log("Running native PostgreSQL admin concurrency tests.");
run("Native PostgreSQL test suite", [vitestCli, "run", "--config", "vitest.adminPostgres.config.ts"]);
