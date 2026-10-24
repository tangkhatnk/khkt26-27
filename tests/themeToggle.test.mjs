import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let vite;
let ThemeProvider;
let ThemeToggle;
let bootstrapThemePreference;

test.before(async () => {
  vite = await createServer({
    configFile: resolve(projectRoot, "vite.config.ts"),
    cacheDir: resolve(projectRoot, "node_modules/.vite-theme-toggle-tests"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ ThemeProvider, ThemeToggle, bootstrapThemePreference } = await vite.ssrLoadModule("/src/adventure/theme.tsx"));
});

test.after(async () => {
  await vite?.close();
});

function withBrowserPreferences(preference, systemDark, callback) {
  const keys = ["window", "document", "localStorage"];
  const descriptors = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const root = { dataset: {}, style: {} };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { matchMedia: () => ({ matches: systemDark }) },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { documentElement: root },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => preference, setItem() {} },
  });
  try {
    callback(root);
  } finally {
    for (const key of keys) {
      const descriptor = descriptors.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test("bootstrap applies an explicit preference before rendering and otherwise uses the system", () => {
  withBrowserPreferences("light", true, (root) => {
    bootstrapThemePreference();
    assert.equal(root.dataset.theme, "light");
    assert.equal(root.style.colorScheme, "light");
  });
  withBrowserPreferences(null, true, (root) => {
    bootstrapThemePreference();
    assert.equal(root.dataset.theme, "dark");
    assert.equal(root.style.colorScheme, "dark");
  });
});

test("theme toggle exposes its action and pressed state to assistive technology", () => {
  withBrowserPreferences("dark", false, () => {
    const markup = renderToStaticMarkup(React.createElement(
      ThemeProvider,
      null,
      React.createElement(ThemeToggle),
    ));
    assert.match(markup, /aria-label="Chuyển sang giao diện sáng"/u);
    assert.match(markup, /aria-pressed="true"/u);
    assert.match(markup, />Sáng</u);
  });
});
