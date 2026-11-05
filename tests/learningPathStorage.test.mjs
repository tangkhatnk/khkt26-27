import assert from "node:assert/strict";
import test from "node:test";
import { readSaved, writeSaved } from "../src/adventure/storage.ts";
import { createLearningPathProgress } from "../src/adventure/learningPath.ts";

function withLocalStorage(callback) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
    },
  });
  try {
    callback();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
}

test("lesson progress stays in the existing owner-scoped saved record", () => {
  withLocalStorage(() => {
    const saved = readSaved("guest");
    const progress = createLearningPathProgress("physics-9-ohm");
    writeSaved("guest", { ...saved, learningPath: progress });

    assert.equal(readSaved("guest").learningPath.selectedCourseId, "physics-9-ohm");
    assert.equal(readSaved("student-a").learningPath.selectedCourseId, "math-7-ratios");
  });
});

test("legacy saved data receives default path progress without changing its history", () => {
  withLocalStorage(() => {
    localStorage.setItem("train-adventure:v1:guest", JSON.stringify({
      active: null,
      pending: [],
      snapshot: null,
      local: { people: {}, groups: {}, sessions: {}, invites: {} },
      notes: { "session-old": "private notes" },
      sources: {},
      materials: {},
      guestPublished: [],
      quizDrafts: {},
    }));

    const restored = readSaved("guest");
    assert.equal(restored.learningPath.selectedCourseId, "math-7-ratios");
    assert.equal(restored.notes["session-old"], "private notes");
  });
});
