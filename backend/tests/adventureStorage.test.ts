import { afterEach, expect, it, vi } from "vitest";
import { emptySaved, readSaved, writeSaved } from "../../src/adventure/storage";
import { synchronizedTripDraftForSession, synchronizedTripQuizPreferences } from "../../src/adventure/synchronizedTripUi";
import { createSessionQuizDraft, shouldPrefetchQuizReview } from "../../src/adventure/quizDrafts";
const entries = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => entries.get(key) ?? null,
  setItem: (key: string, value: string) => entries.set(key, value),
});
afterEach(() => entries.clear());
it("round trips saved study under a separate key for each owner", () => {
  const saved = emptySaved();
  saved.notes.one = "Private study notes";
  writeSaved("learner", saved);
  expect(readSaved("learner").notes.one).toBe("Private study notes");
  expect(readSaved("guest").notes).toEqual({});
});
it("retains attachment metadata after completing a session and reads older backups", () => {
  const saved = emptySaved();
  saved.materials = { session: [{ name: "lesson.pdf", size: 600, type: "application/pdf", status: "extracted", message: "Đã đọc" }] };
  writeSaved("learner", saved);
  expect(readSaved("learner").materials?.session[0].name).toBe("lesson.pdf");
  delete saved.materials;
  writeSaved("learner", saved);
  expect(readSaved("learner").notes).toEqual({});
});
it("keeps a ready member's private draft on the owner device for reconnect", () => {
  const saved = emptySaved();
  saved.readyTripDrafts = {
    "session-1": {
      groupId: "group-1",
      goal: "Review cell structure",
      topic: "biology",
      target: 600,
      breakPlan: { count: 1, seconds: 60 },
      quizCount: "5",
      skipQuizReview: true,
    },
  };
  saved.notes["session-1"] = "Private local notes";
  writeSaved("learner", saved);

  const restored = readSaved("learner");
  expect(restored.readyTripDrafts?.["session-1"]).toEqual(saved.readyTripDrafts?.["session-1"]);
  expect(restored.notes["session-1"]).toBe("Private local notes");
  const draft = synchronizedTripDraftForSession(restored.readyTripDrafts, "session-1", "group-1");
  expect(draft).toBeDefined();
  const preferences = synchronizedTripQuizPreferences(draft!);
  expect(preferences).toEqual({ quizCount: "5", skipQuizReview: true });
  expect(shouldPrefetchQuizReview(createSessionQuizDraft(preferences.quizCount, preferences.skipQuizReview))).toBe(false);
});
it("rejects malformed synchronized-trip quiz preferences in saved state", () => {
  const invalid = emptySaved();
  invalid.readyTripDrafts = {
    "session-1": {
      groupId: "group-1",
      goal: "Review cell structure",
      topic: "biology",
      target: 600,
      quizCount: "31",
      skipQuizReview: false,
    },
  } as typeof invalid.readyTripDrafts;
  localStorage.setItem("train-adventure:v1:learner", JSON.stringify(invalid));

  expect(() => readSaved("learner")).toThrow("Dữ liệu đã lưu không hợp lệ");
});
it("canonicalizes a skipped invalid quiz count before ready-draft reload and avoids prefetch", () => {
  const preferences = synchronizedTripQuizPreferences({ quizCount: "31", skipQuizReview: true });
  const saved = emptySaved();
  saved.readyTripDrafts = {
    "session-2": {
      groupId: "group-2",
      goal: "Review cell structure",
      topic: "biology",
      target: 600,
      ...preferences,
    },
  };
  writeSaved("learner", saved);

  const restored = readSaved("learner");
  const draft = synchronizedTripDraftForSession(restored.readyTripDrafts, "session-2", "group-2");
  expect(draft).toMatchObject({ quizCount: "3", skipQuizReview: true });
  const launchDraft = createSessionQuizDraft(draft!.quizCount!, draft!.skipQuizReview!);
  expect(launchDraft.count).toBe(3);
  expect(shouldPrefetchQuizReview(launchDraft)).toBe(false);
});
it("accepts legacy records without a device category and validates new categories", () => {
  const legacy = emptySaved();
  legacy.active = { id: "old-active", owner: "owner", goal: "Study", topic: "biology", document: "",
    target: 60, groupId: null, started: 1000, lastAt: 1000, segments: [], state: "focus", reconnect: 0 };
  legacy.pending = [{ id: "old", userId: "owner", goal: "Study", topic: "biology",
    started: 1000, ended: 2000, target: 60, segments: [], seconds: 0, contribution: 0, rules: "train-v1" }];
  writeSaved("owner", legacy);
  expect(readSaved("owner").active).not.toHaveProperty("deviceCategory");
  expect(readSaved("owner").pending[0]).not.toHaveProperty("deviceCategory");

  const current = emptySaved();
  current.active = { ...legacy.active!, id: "new-active", deviceCategory: "android" };
  current.pending = [{ ...legacy.pending[0], id: "new", deviceCategory: "tablet" }];
  writeSaved("owner", current);
  expect(readSaved("owner").active).toMatchObject({ deviceCategory: "android" });
  expect(readSaved("owner").pending[0]).toMatchObject({ deviceCategory: "tablet" });

  const invalid = structuredClone(current);
  (invalid.pending[0] as unknown as { deviceCategory: string }).deviceCategory = "raw-user-agent";
  (invalid.active as unknown as { deviceCategory: string }).deviceCategory = "raw-user-agent";
  localStorage.setItem("train-adventure:v1:owner", JSON.stringify(invalid));
  expect(() => readSaved("owner")).toThrow("Dữ liệu đã lưu không hợp lệ");
  expect(localStorage.getItem("train-adventure:v1:owner")).toBe(JSON.stringify(invalid));
});
it.each([
  { local: {}, pending: [], notes: {} },
  { ...emptySaved(), active: { state: "focus", segments: null } },
  { ...emptySaved(), snapshot: { person: null, sessions: [] } },
])("rejects damaged saved shapes before the timer or journey can crash", (value) => {
  entries.set("train-adventure:v1:guest", JSON.stringify(value));
  expect(() => readSaved("guest")).toThrow("Dữ liệu");
  expect(entries.get("train-adventure:v1:guest")).toBe(JSON.stringify(value));
});
