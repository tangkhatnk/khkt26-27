import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let vite;
let QuietFocusCanvas;

before(async () => {
  vite = await createServer({
    configFile: resolve(projectRoot, "vite.config.ts"),
    cacheDir: resolve(projectRoot, "node_modules/.vite-quiet-focus-canvas-tests"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ QuietFocusCanvas } = await vite.ssrLoadModule("/src/adventure/QuietFocusCanvas.tsx"));
});

after(async () => {
  await vite?.close();
});

function renderCanvas(overrides = {}) {
  return renderToStaticMarkup(React.createElement(QuietFocusCanvas, {
    goal: "Ôn quang hợp",
    clockSeconds: 25 * 60,
    clockLabel: "Thời gian còn lại",
    motionAllowed: true,
    status: React.createElement("span", null, "Đang tập trung"),
    essentialControls: React.createElement("button", { type: "button" }, "Kết thúc phiên"),
    ...overrides,
  }));
}

test("quiet focus gives the goal and live session state names while keeping essential controls visible", () => {
  const markup = renderCanvas({
    status: React.createElement("span", null, "Đang tập trung · bước 2 trên 3"),
    essentialControls: React.createElement("button", { type: "button" }, "Kết thúc phiên"),
    warnings: React.createElement("p", null, "Tài liệu chưa được xác nhận."),
    materials: React.createElement("p", null, "Tài liệu về quang hợp"),
    details: React.createElement("p", null, "Bắt đầu lúc 09:00"),
  });

  assert.match(markup, /<h1[^>]*>Ôn quang hợp<\/h1>/u);
  assert.match(markup, /role="status"[^>]*aria-label="Trạng thái phiên"[^>]*>.*?Đang tập trung · bước 2 trên 3/u);
  assert.match(markup, /<div class="quiet-focus-canvas__essentials" role="group" aria-label="Điều khiển phiên">/u);
  assert.match(markup, /<button type="button">Kết thúc phiên<\/button>/u);
  assert.match(markup, /Tài liệu chưa được xác nhận\./u);

  const disclosures = [...markup.matchAll(/<details\b[^>]*>/gu)].map(([tag]) => tag);
  assert.equal(disclosures.length, 2);
  assert.ok(disclosures.every(tag => !/\bopen(?:=|\s|>)/u.test(tag)));
  assert.match(markup, /<details[^>]*>[\s\S]*?<summary>Tài liệu<\/summary>[\s\S]*?Tài liệu về quang hợp[\s\S]*?<\/details>/u);
  assert.match(markup, /<details[^>]*>[\s\S]*?<summary>Chi tiết phiên<\/summary>[\s\S]*?Bắt đầu lúc 09:00[\s\S]*?<\/details>/u);
  assert.ok(markup.indexOf("Kết thúc phiên") < markup.indexOf("<details"));
});

test("optional warnings, materials, and details do not add empty disclosures", () => {
  const markup = renderCanvas();

  assert.doesNotMatch(markup, /<details\b/u);
  assert.doesNotMatch(markup, /quiet-focus-canvas__warnings/u);
  assert.match(markup, /Ôn quang hợp/u);
  assert.match(markup, /Kết thúc phiên/u);
});

test("quiet focus passes the 240-minute clock and its label and motion preference to FlipClock", () => {
  const markup = renderCanvas({
    clockSeconds: 240 * 60,
    clockLabel: "Lượt học còn lại",
    motionAllowed: false,
  });

  assert.match(markup, /role="timer"/u);
  assert.match(markup, /aria-label="Lượt học còn lại: 240 phút 0 giây"/u);
  assert.match(markup, /datetime="PT14400S"/iu);
  assert.match(markup, /data-animated="false"/u);
  assert.match(markup, /flip-clock-panel--minutes flip-clock-panel--wide/u);
  const digits = [...markup.matchAll(/class="flip-clock-digit" data-digit="(\d)"/gu)]
    .map((match) => match[1]).join("");
  assert.equal(digits, "24000");
  assert.match(markup, /class="flip-clock-separator" aria-hidden="true">:<\/span>/u);
});
