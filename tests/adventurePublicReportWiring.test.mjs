import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("public report is reachable from navigation and registered on the API app", async () => {
  const [adventure, app] = await Promise.all([
    readFile(resolve(projectRoot, "src/adventure/AdventureApp.tsx"), "utf8"),
    readFile(resolve(projectRoot, "backend/src/app.ts"), "utf8"),
  ]);

  assert.match(adventure, /import \{ PublicReport \} from "\.\/PublicReport"/u);
  assert.match(adventure, /\{ id: "report"[\s\S]*?label: "Báo cáo" \}/u);
  assert.match(adventure, /const views = \[[^\]]*"report"/u);
  assert.match(adventure, /view === "report" && <PublicReport \/>/u);
  assert.match(adventure, /view === "experiments" && <ExperimentResults \/>/u);
  assert.match(app, /import \{ publicReportRoutes \} from "\.\/publicReport\.js"/u);
  assert.match(app, /publicReportRoutes\(app, db\)/u);
});
