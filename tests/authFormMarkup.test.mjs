import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let vite;
let AuthForm;

before(async () => {
  vite = await createServer({
    configFile: resolve(projectRoot, "vite.config.ts"),
    configLoader: "runner",
    cacheDir: resolve(projectRoot, "node_modules/.vite-auth-form-tests"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ AuthForm } = await vite.ssrLoadModule("/src/adventure/AuthForm.tsx"));
});

after(async () => {
  await vite?.close();
});

test("login password input allows the field error to explain the API length limit", () => {
  const markup = renderToStaticMarkup(React.createElement(AuthForm, {
    busy: false,
    blocked: false,
    disableRegistration: false,
    onAuthenticate: async () => {},
    onContinue: () => {},
  }));
  const passwordInput = markup.match(/<input[^>]*id="auth-password"[^>]*>/u)?.[0];

  assert.ok(passwordInput);
  assert.doesNotMatch(passwordInput, /maxlength=/iu);
  assert.match(markup, /aria-label="Hiện mật khẩu"/u);
});
