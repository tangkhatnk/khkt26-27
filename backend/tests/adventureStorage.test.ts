import { afterEach, expect, it, vi } from "vitest";
import { emptySaved, readSaved, writeSaved } from "../../src/adventure/storage";
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
