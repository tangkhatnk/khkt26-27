import assert from "node:assert/strict";
import test from "node:test";
import { canonicalStudyView, replaceBrowserView } from "../src/adventure/navigation.ts";

test("legacy group and lesson routes resolve without overriding an incomplete first-use guide", () => {
  assert.equal(canonicalStudyView("group", { active: false, firstUseNeedsWorkspace: false }), "library");
  assert.equal(canonicalStudyView("lesson", { active: true, firstUseNeedsWorkspace: false }), "focus");
  assert.equal(canonicalStudyView("lesson", { active: false, firstUseNeedsWorkspace: false }), "station");
  assert.equal(canonicalStudyView("ticket", { active: true, firstUseNeedsWorkspace: false }), "focus");
  assert.equal(canonicalStudyView("ticket", { active: false, firstUseNeedsWorkspace: false }), "station");
  assert.equal(canonicalStudyView("group", { active: false, firstUseNeedsWorkspace: true }), "station");
  assert.equal(canonicalStudyView("unrecognized", { active: false, firstUseNeedsWorkspace: false }), "station");
});

test("automatic route correction replaces only the view while preserving unrelated URL state", () => {
  const previousWindow = globalThis.window;
  const previousPopStateEvent = globalThis.PopStateEvent;
  const calls = [];
  const windowState = {
    location: new URL("http://localhost:5173/?view=group&theme=dark#journal"),
    history: {
      pushState() { calls.push("push"); },
      replaceState(_state, _title, url) {
        calls.push("replace");
        windowState.location = new URL(String(url));
      },
    },
    dispatchEvent(event) { calls.push(event.type); return true; },
  };
  globalThis.window = windowState;
  globalThis.PopStateEvent = class { constructor(type) { this.type = type; } };
  try {
    replaceBrowserView("library");
    assert.deepEqual(calls, ["replace", "popstate"]);
    assert.equal(windowState.location.searchParams.get("view"), "library");
    assert.equal(windowState.location.searchParams.get("theme"), "dark");
    assert.equal(windowState.location.hash, "#journal");
  } finally {
    globalThis.window = previousWindow;
    globalThis.PopStateEvent = previousPopStateEvent;
  }
});
