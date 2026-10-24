import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let vite;
let FlipClock;

before(async () => {
  vite = await createServer({
    configFile: resolve(projectRoot, "vite.config.ts"),
    cacheDir: resolve(projectRoot, "node_modules/.vite-flip-clock-tests"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ FlipClock } = await vite.ssrLoadModule("/src/adventure/FlipClock.tsx"));
});

after(async () => {
  await vite?.close();
});

test("flip clock exposes one spoken timer value and hides its split-face digits", () => {
  const markup = renderToStaticMarkup(
    React.createElement(FlipClock, {
      seconds: 10 * 60 + 5,
      label: "Chặng học còn lại",
    }),
  );

  assert.match(markup, /role="timer"/u);
  assert.match(markup, /aria-label="Chặng học còn lại: 10 phút 5 giây"/u);
  assert.match(markup, /datetime="PT605S"/iu);
  assert.match(markup, /aria-hidden="true"/u);
  assert.equal([...markup.matchAll(/class="flip-clock-digit"/gu)].length, 4);
});

test("long trips retain every minute digit instead of wrapping at an hour", () => {
  const markup = renderToStaticMarkup(
    React.createElement(FlipClock, {
      seconds: 255 * 60,
      label: "Giải lao còn lại",
    }),
  );

  assert.match(markup, /aria-label="Giải lao còn lại: 255 phút 0 giây"/u);
  assert.equal([...markup.matchAll(/class="flip-clock-digit"/gu)].length, 5);
});
