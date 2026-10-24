import assert from "node:assert/strict";
import test from "node:test";
import {
  THEME_STORAGE_KEY,
  parseThemePreference,
  readThemePreference,
  resolveThemePreference,
  subscribeThemePreferenceEvents,
  writeThemePreference,
} from "../src/adventure/themePreference.ts";

const memoryStorage = (initial = null) => {
  const values = new Map(initial ? [[THEME_STORAGE_KEY, initial]] : []);
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
};

test("only supported explicit display preferences are accepted", () => {
  assert.equal(parseThemePreference("dark"), "dark");
  assert.equal(parseThemePreference("light"), "light");
  assert.equal(parseThemePreference(null), null);
  assert.equal(parseThemePreference("system"), null);
  assert.equal(parseThemePreference("Dark"), null);
});

test("an explicit preference wins while an unset preference follows the device", () => {
  assert.equal(resolveThemePreference("light", "dark"), "light");
  assert.equal(resolveThemePreference("dark", "light"), "dark");
  assert.equal(resolveThemePreference(null, "dark"), "dark");
  assert.equal(resolveThemePreference(null, "light"), "light");
});

test("preference reads and writes use only the display key", () => {
  const storage = memoryStorage("dark");
  assert.equal(readThemePreference(storage), "dark");
  assert.equal(writeThemePreference("light", storage), true);
  assert.equal(storage.values.size, 1);
  assert.equal(storage.values.get(THEME_STORAGE_KEY), "light");
  assert.equal(readThemePreference(storage), "light");
});

test("unavailable or blocked local storage falls back without throwing", () => {
  const blocked = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };
  assert.equal(readThemePreference(blocked), null);
  assert.equal(writeThemePreference("dark", blocked), false);
  assert.equal(writeThemePreference("light", null), false);
});

test("theme listeners support legacy media queries and always clean up storage", () => {
  const listeners = new Map();
  const target = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
  let mediaListener;
  let removedMediaListener;
  const media = {
    matches: false,
    addListener(listener) { mediaListener = listener; },
    removeListener(listener) { removedMediaListener = listener; },
  };
  let systemChanges = 0;
  let storageChanges = 0;
  const onSystemChange = () => { systemChanges += 1; };
  const onStorage = () => { storageChanges += 1; };

  const cleanup = subscribeThemePreferenceEvents(target, media, onSystemChange, onStorage);
  assert.equal(mediaListener, onSystemChange);
  assert.equal(listeners.get("storage"), onStorage);
  mediaListener({ matches: true });
  listeners.get("storage")({ key: THEME_STORAGE_KEY, newValue: "dark" });
  assert.equal(systemChanges, 1);
  assert.equal(storageChanges, 1);

  cleanup();
  assert.equal(removedMediaListener, onSystemChange);
  assert.equal(listeners.has("storage"), false);
});

test("storage listener remains active when system media queries are unavailable", () => {
  const listeners = new Map();
  const target = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
  let storageChanges = 0;
  const onStorage = () => { storageChanges += 1; };

  const cleanup = subscribeThemePreferenceEvents(target, null, () => {}, onStorage);
  listeners.get("storage")({ key: THEME_STORAGE_KEY, newValue: "light" });
  assert.equal(storageChanges, 1);
  cleanup();
  assert.equal(listeners.has("storage"), false);
});
