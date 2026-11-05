import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("focus timer renders exact minute and second digits through the 240-minute limit", () => {
  const cases = [
    { seconds: 1, spoken: "0 phút 1 giây", digits: "0001" },
    { seconds: 59, spoken: "0 phút 59 giây", digits: "0059" },
    { seconds: 60, spoken: "1 phút 0 giây", digits: "0100" },
    { seconds: 240 * 60, spoken: "240 phút 0 giây", digits: "24000" },
  ];

  for (const { seconds, spoken, digits } of cases) {
    const markup = renderToStaticMarkup(React.createElement(FlipClock, {
      seconds,
      label: "Lượt học còn lại",
    }));
    const renderedDigits = [...markup.matchAll(/class="flip-clock-digit" data-digit="(\d)"/gu)]
      .map((match) => match[1]).join("");
    assert.equal(renderedDigits, digits);
    assert.match(markup, new RegExp(`aria-label="Lượt học còn lại: ${spoken}"`, "u"));
  }
});

test("minute overflow uses a wide panel that remains responsive at phone width", async () => {
  const markup = renderToStaticMarkup(React.createElement(FlipClock, {
    seconds: 240 * 60,
    label: "Lượt học còn lại",
  }));
  const css = await readFile(resolve(projectRoot, "src/adventure/flipClock.css"), "utf8");

  assert.equal([...markup.matchAll(/class="flip-clock-panel /gu)].length, 2);
  assert.match(markup, /class="flip-clock-panel flip-clock-panel--minutes flip-clock-panel--wide" data-digit-count="3"/u);
  assert.match(markup, /class="flip-clock-panel flip-clock-panel--seconds" data-digit-count="2"/u);
  assert.match(css, /@media \(max-width: 420px\)/u);
  assert.match(css, /\.flip-clock-panel--wide/u);
});

test("clock keeps its accessible label and disables flap animation when motion is disallowed", async () => {
  const markup = renderToStaticMarkup(React.createElement(FlipClock, {
    seconds: 59,
    label: "Lượt học còn lại",
    motionAllowed: false,
  }));
  const css = await readFile(resolve(projectRoot, "src/adventure/flipClock.css"), "utf8");

  assert.match(markup, /role="timer"/u);
  assert.match(markup, /aria-label="Lượt học còn lại: 0 phút 59 giây"/u);
  assert.match(markup, /data-animated="false"/u);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(css, /\.flip-clock-fold-top,[\s\S]*?\.flip-clock-fold-bottom\s*\{\s*display:\s*none;\s*animation:\s*none;/u);
});
