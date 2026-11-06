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

test("the full 240:00 readout scales to the available width across portrait and landscape sizes", async () => {
  const css = await readFile(resolve(projectRoot, "src/adventure/flipClock.css"), "utf8");
  const appCss = await readFile(resolve(projectRoot, "src/adventure/adventure.css"), "utf8");
  const timerRule = css.match(/\.timer\.flip-clock\s*\{([^}]*)\}/u)?.[1] ?? "";
  const readoutRule = css.match(/\.flip-clock-readout\s*\{([^}]*)\}/u)?.[1] ?? "";
  const focusWidthRule = css.match(/(\.adventure\.adventure--quiet-focus \.quiet-focus-canvas__clock)\s*\{([^}]*)\}/u);
  const appFocusWidthRule = appCss.match(/(\.adventure--quiet-focus \.quiet-focus-canvas__clock),\s*\.adventure--quiet-focus \.quiet-focus-canvas__essentials\s*\{([^}]*)\}/u);

  assert.match(timerRule, /container-type:\s*inline-size/u);
  assert.match(readoutRule, /font-size:\s*clamp\(2rem,\s*min\(23vw,\s*42vh,\s*24cqi\),\s*27rem\)/u);
  assert.ok(focusWidthRule);
  assert.ok(appFocusWidthRule);
  assert.match(focusWidthRule[2], /width:\s*min\(calc\(100vw - 2rem\),\s*112\.5rem\)/u);
  assert.match(focusWidthRule[2], /max-width:\s*none/u);
  assert.match(
    focusWidthRule[2],
    /grid-template-columns:\s*minmax\(0,\s*1fr\)/u,
    "the inline-size timer needs a definite track or its width can collapse to zero in the focus grid",
  );
  assert.match(appFocusWidthRule[2], /width:\s*100%/u);
  assert.ok(
    (focusWidthRule[1].match(/\./gu) ?? []).length > (appFocusWidthRule[1].match(/\./gu) ?? []).length,
    "the clock wrapper selector must outrank the later app width rule",
  );
  assert.match(css, /@media \(max-width: 920px\)[\s\S]*?\.flip-clock-readout\s*\{[^}]*23cqi/su);

  const viewports = [
    { width: 1920, height: 1080, containerWidth: 1800, label: "roomy desktop" },
    { width: 2560, height: 1440, containerWidth: 1800, label: "large desktop" },
    { width: 1440, height: 900, containerWidth: 1408, label: "desktop" },
    { width: 768, height: 1024, containerWidth: 736, label: "tablet portrait" },
    { width: 390, height: 844, containerWidth: 358, label: "phone portrait" },
    { width: 844, height: 390, containerWidth: 812, label: "short phone landscape" },
  ];

  for (const viewport of viewports) {
    const { width, height, containerWidth, label } = viewport;
    const cqiScale = width <= 920 ? 0.23 : 0.24;
    const fontSize = Math.max(32, Math.min(width * 0.23, height * 0.42, containerWidth * cqiScale, 432));
    const phoneLayout = width <= 420;
    const minuteScale = phoneLayout ? 0.84 : 0.88;
    const minuteDigits = (3 * 0.62 + 2 * 0.035) * minuteScale;
    const secondDigits = 2 * 0.62 + 0.035;
    // Bound the separator by its full CSS font size to avoid relying on a browser font's colon width.
    const separator = 0.55;
    const panelPadding = phoneLayout
      ? 4 * 11.2
      : 4 * Math.min(24, Math.max(12, width * 0.03));
    const readoutGaps = phoneLayout
      ? 2 * 6.4
      : 2 * Math.min(20, Math.max(7.2, width * 0.025));
    const conservativeReadoutWidth = fontSize * (minuteDigits + secondDigits + separator)
      + panelPadding + readoutGaps + 4;

    assert.ok(
      conservativeReadoutWidth <= width,
      `${label}: 240:00 estimate ${conservativeReadoutWidth.toFixed(1)}px exceeds ${width}px`,
    );
    assert.ok(
      conservativeReadoutWidth <= containerWidth,
      `${label}: 240:00 estimate ${conservativeReadoutWidth.toFixed(1)}px exceeds its ${containerWidth}px container`,
    );
    assert.ok(
      conservativeReadoutWidth / containerWidth >= 0.8,
      `${label}: 240:00 estimate uses less than 80% of its ${containerWidth}px container`,
    );
  }

  const desktopDigitHeight = 0.92 * Math.min(1920 * 0.23, 1080 * 0.42, 1800 * 0.24, 432);
  assert.ok(desktopDigitHeight + 0.01 >= 3 * (0.92 * 144));
  assert.match(css, /\.flip-clock-panel--wide \.flip-clock-digits\s*\{[^}]*font-size:\s*0\.88em/u);
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*?\.flip-clock-panel--wide \.flip-clock-digits\s*\{[^}]*font-size:\s*0\.84em/u);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/u);
});

test("animated fold faces cover their static glyphs while steady halves stay transparent", async () => {
  const css = await readFile(resolve(projectRoot, "src/adventure/flipClock.css"), "utf8");
  const lightFolds = css.match(/\.flip-clock-fold-top,\s*\.flip-clock-fold-bottom\s*\{([^}]*)\}/u)?.[1] ?? "";

  assert.match(lightFolds, /background:\s*#f0f3eb/u);
  assert.match(css, /\.flip-clock-half\s*\{[^}]*background:\s*transparent/su);
  assert.match(css, /html\[data-theme="dark"\] \.adventure \.focus-card \.flip-clock-half\s*\{[^}]*background:\s*transparent/su);
  assert.match(css, /html\[data-theme="dark"\] \.adventure \.focus-card \.flip-clock-fold-top,\s*html\[data-theme="dark"\] \.adventure \.focus-card \.flip-clock-fold-bottom\s*\{[^}]*background:\s*#243229/su);
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
