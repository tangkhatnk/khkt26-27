import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let vite;
let FocusFullscreenRecovery;

before(async () => {
  vite = await createServer({
    configFile: resolve(projectRoot, "vite.config.ts"),
    configLoader: "runner",
    cacheDir: resolve(projectRoot, "node_modules/.vite-focus-fullscreen-recovery-tests"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ FocusFullscreenRecovery } = await vite.ssrLoadModule("/src/adventure/FocusFullscreenRecovery.tsx"));
});

after(async () => {
  await vite?.close();
});

test("pending recovery keeps the windowed option while disabling duplicate fullscreen requests", () => {
  const markup = renderToStaticMarkup(React.createElement(FocusFullscreenRecovery, {
    status: "pending",
    message: "Đang bật toàn màn hình…",
    onRequest() {},
    onDismiss() {},
  }));

  assert.match(markup, /<section class="focus-fullscreen-recovery"[^>]*aria-labelledby="focus-fullscreen-recovery-title"/u);
  assert.match(markup, /<h2 id="focus-fullscreen-recovery-title">Phiên học đang mở lại<\/h2>/u);
  assert.match(markup, /<button class="primary" type="button" disabled="">Đang bật toàn màn hình…<\/button>/u);
  assert.match(markup, /<p class="focus-fullscreen-recovery__status" role="status">Đang bật toàn màn hình…<\/p>/u);
  assert.match(markup, /<button type="button">Tiếp tục ở cửa sổ<\/button>/u);
});

test("a rejected recovery keeps a visible, retryable fullscreen action", () => {
  const markup = renderToStaticMarkup(React.createElement(FocusFullscreenRecovery, {
    status: "failed",
    message: "Không bật được toàn màn hình. Bạn vẫn có thể học và thử lại.",
    onRequest() {},
    onDismiss() {},
  }));

  assert.match(markup, /<button class="primary" type="button">Tiếp tục toàn màn hình<\/button>/u);
  assert.match(markup, /role="status">Không bật được toàn màn hình\. Bạn vẫn có thể học và thử lại\.<\/p>/u);
  assert.match(markup, /<button type="button">Tiếp tục ở cửa sổ<\/button>/u);
});

test("initial fullscreen failure uses a native modal with retry and windowed continuation", () => {
  const markup = renderToStaticMarkup(React.createElement(FocusFullscreenRecovery, {
    variant: "initial",
    status: "failed",
    message: "Không bật được toàn màn hình. Bạn vẫn có thể học và thử lại.",
    onRequest() {},
    onDismiss() {},
  }));

  assert.match(markup, /<dialog[^>]*aria-labelledby="focus-fullscreen-initial-title"/u);
  assert.match(markup, /<h2 id="focus-fullscreen-initial-title">Bật toàn màn hình\?<\/h2>/u);
  assert.match(markup, /<button class="primary" type="button">Bật toàn màn hình<\/button>/u);
  assert.match(markup, /<button type="button">Tiếp tục trong cửa sổ<\/button>/u);
  assert.match(markup, /role="status">Không bật được toàn màn hình/u);
});

test("unsupported initial fullscreen keeps the windowed choice available", () => {
  const markup = renderToStaticMarkup(React.createElement(FocusFullscreenRecovery, {
    variant: "initial",
    status: "unsupported",
    message: "Toàn màn hình không khả dụng trên trình duyệt này.",
    onRequest() {},
    onDismiss() {},
  }));

  assert.match(markup, /<button class="primary" type="button" disabled="">Toàn màn hình không khả dụng<\/button>/u);
  assert.match(markup, /<button type="button">Tiếp tục trong cửa sổ<\/button>/u);
});
