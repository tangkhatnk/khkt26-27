import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { tmpdir } from "node:os";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let vite;
let profileStats;

before(async () => {
  vite = await createServer({
    configFile: resolve(projectRoot, "vite.config.ts"),
    cacheDir: resolve(tmpdir(), "viendu-profile-stats-tests"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ profileStats } = await vite.ssrLoadModule("/src/adventure/profileStats.ts"));
});

after(async () => {
  await vite?.close();
});

const session = (id, userId, ended, seconds) => ({
  id,
  userId,
  ended,
  seconds,
  topic: `topic-${id}`,
  goal: `goal-${id}`,
});

test("profile stats count and total unique sessions for one owner while keeping the four most recent", () => {
  const stats = profileStats("account-a", [
    session("saved-1", "account-a", 100, 100),
    session("duplicate", "account-a", 200, 200),
    session("saved-3", "account-a", 300, 300),
    session("saved-4", "account-a", 400, 400),
    session("saved-5", "account-a", 500, 500),
    session("other-snapshot", "account-b", 1000, 999),
  ], [
    session("pending-new", "account-a", 600, 60),
    session("pending-old", "account-a", 50, 50),
    session("duplicate", "account-a", 700, 700),
    session("other-pending", "account-b", 900, 1000),
  ]);

  assert.equal(stats.sessionCount, 7);
  assert.equal(stats.focusedSeconds, 1610);
  assert.deepEqual(stats.recentStudies.map(({ id }) => id), [
    "pending-new", "saved-5", "saved-4", "saved-3",
  ]);
  assert.equal(stats.recentStudies.length, 4);
});
