import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adventureApp = await readFile(new URL("../src/adventure/AdventureApp.tsx", import.meta.url), "utf8");
const finishStart = adventureApp.indexOf("function finish() {");
const finishEnd = adventureApp.indexOf("\n  useEffect(() => {\n    finishRef.current", finishStart);
const finish = finishStart >= 0 && finishEnd > finishStart
  ? adventureApp.slice(finishStart, finishEnd)
  : "";

test("the real focus finish path applies scheduled-duration eligibility before lesson review", () => {
  assert.ok(finish.includes("const s: Session = {"));
  assert.ok(finish.indexOf("started: next.started,") < finish.indexOf("ended: sessionEndAt(trip, at),"));
  assert.ok(finish.indexOf("ended: sessionEndAt(trip, at),") < finish.indexOf("target: next.target,"));
  assert.ok(finish.includes("breakPlan: next.breakPlan,"));
  assert.ok(finish.includes("value.learningPath = finishLessonFocus(value.learningPath, s);"));
});
