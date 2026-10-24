import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tmpdir } from "node:os";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let vite;
let TopDownScene;

before(async () => {
  vite = await createServer({
    configFile: resolve(projectRoot, "vite.config.ts"),
    cacheDir: resolve(tmpdir(), "viendu-v4-motion-tests", "rest-stop"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ TopDownScene } = await vite.ssrLoadModule("/src/adventure/TopDownScene.tsx"));
});

after(async () => {
  await vite?.close();
});

const timingAtStudy = (elapsedStudySeconds, targetStudySeconds = 120, restAnchors = [
  { index: 1, count: 1, elapsedStudySeconds: 60 },
]) => ({
  elapsedSeconds: elapsedStudySeconds,
  remainingSeconds: targetStudySeconds - elapsedStudySeconds,
  elapsedStudySeconds,
  targetStudySeconds,
  restAnchors,
});

const sceneMarkup = (overrides = {}) => renderToStaticMarkup(
  React.createElement(TopDownScene, {
    carriages: [{ id: "guest", name: "Toa Mây", color: "#398575" }],
    ownId: "guest",
    running: true,
    fogStrength: 0,
    exploration: 0.25,
    restStop: null,
    sessionTiming: timingAtStudy(0),
    motionAllowed: true,
    ...overrides,
  }),
);

function stationTag(markup, id) {
  const index = markup.indexOf(`data-station-id="${id}"`);
  assert.notEqual(index, -1, `station ${id} is rendered`);
  const start = markup.lastIndexOf("<g", index);
  const end = markup.indexOf(">", index);
  return markup.slice(start, end + 1);
}

function stationNumber(markup, id, attribute) {
  const tag = stationTag(markup, id);
  const value = tag.match(new RegExp(`${attribute}="([^"]+)"`, "u"))?.[1];
  assert.notEqual(value, undefined, `station ${id} exposes ${attribute}`);
  return Number(value);
}

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 0.0001, `expected ${actual} to be near ${expected}`);
}

function worldMotionTag(markup) {
  const tag = markup.match(/<div\b[^>]*class="travel-world-motion"[^>]*>/u)?.[0];
  assert.ok(tag, "the scene uses an HTML camera layer for the moving world");
  return tag;
}

function worldNumber(markup, attribute) {
  const tag = worldMotionTag(markup);
  const value = tag.match(new RegExp(`${attribute}="([^"]+)"`, "u"))?.[1];
  assert.notEqual(value, undefined, `world motion exposes ${attribute}`);
  return Number(value);
}

test("the trip origin stays visible after the opening seconds and follows the terrain distance", () => {
  const atStart = sceneMarkup({ sessionTiming: timingAtStudy(0) });
  const afterTwoSeconds = sceneMarkup({ sessionTiming: timingAtStudy(2) });

  assert.equal(stationNumber(atStart, "start", "data-station-screen-x"), 450);
  assert.ok(Math.abs(stationNumber(afterTwoSeconds, "start", "data-station-screen-x") - 416.6666666667) < 0.0001);
  assert.ok(Math.abs(worldNumber(afterTwoSeconds, "data-world-distance") - 33.3333333333) < 0.0001);
  assert.ok(Math.abs(
    stationNumber(afterTwoSeconds, "start", "data-station-screen-x") -
    (450 - worldNumber(afterTwoSeconds, "data-world-distance")),
  ) < 0.0001);
});

test("the moving world and centered train use separate aligned viewports", () => {
  const markup = sceneMarkup({ sessionTiming: timingAtStudy(2) });
  const cameraTag = worldMotionTag(markup);
  const worldStart = markup.indexOf(cameraTag);
  const worldEnd = markup.indexOf("</div>", worldStart);
  const trainStart = markup.indexOf('<svg class="travel-train-overlay"');

  assert.match(cameraTag, /data-world-camera-offset="-33\.333333333333336"/u);
  assert.match(cameraTag, /style="--world-camera-offset:-3\.703703703703704%/u);
  assert.match(markup, /<svg class="travel-world-map" viewBox="-900 0 2700 420"/u);
  assert.match(markup, /<svg class="travel-train-overlay" viewBox="0 0 900 420"/u);
  assert.ok(worldEnd >= 0 && trainStart > worldEnd, "the fixed train sits outside the transformed world layer");
  assert.ok(markup.indexOf('<g class="travel-train-motion"', trainStart) > trainStart);
});

test("the rest footprint approaches, parks, and departs at the shared world speed", () => {
  const approach = sceneMarkup({ sessionTiming: timingAtStudy(24) });
  const parkedAtBreak = sceneMarkup({
    restStop: { index: 1, count: 1 },
    sessionTiming: timingAtStudy(60),
  });
  const resumedStudy = sceneMarkup({ sessionTiming: timingAtStudy(61) });

  assert.equal(stationNumber(approach, "rest-1", "data-station-screen-x"), 1050);
  near(stationNumber(parkedAtBreak, "rest-1", "data-station-screen-x"), 450);
  near(stationNumber(resumedStudy, "rest-1", "data-station-screen-x"), 433.3333333333);
  near(worldNumber(parkedAtBreak, "data-world-distance"), 1000);
  near(worldNumber(resumedStudy, "data-world-distance"), 1016.6666666667);
});

test("the terminal stays ahead until study target, then meets the centered engine", () => {
  const approach = sceneMarkup({ sessionTiming: timingAtStudy(84) });
  const terminal = sceneMarkup({ sessionTiming: timingAtStudy(120) });

  assert.equal(stationNumber(approach, "terminal", "data-station-screen-x"), 1050);
  near(stationNumber(terminal, "terminal", "data-station-screen-x"), 450);
  assert.match(terminal, /class="travel-train"[^>]*transform="translate\(450 210\)/u);
});

test("scheduled breaks freeze the world camera and the station anchors", () => {
  const breakStart = sceneMarkup({
    restStop: { index: 1, count: 1 },
    sessionTiming: timingAtStudy(60),
  });
  const breakMidpoint = sceneMarkup({
    restStop: { index: 1, count: 1 },
    sessionTiming: {
      ...timingAtStudy(60),
      elapsedSeconds: 90,
      remainingSeconds: 90,
    },
  });

  near(worldNumber(breakStart, "data-world-distance"), 1000);
  near(worldNumber(breakMidpoint, "data-world-distance"), 1000);
  near(stationNumber(breakStart, "rest-1", "data-station-screen-x"), 450);
  near(stationNumber(breakMidpoint, "rest-1", "data-station-screen-x"), 450);
  assert.doesNotMatch(breakMidpoint, /data-station-id="terminal"/u);
});

test("terminal summaries show the destination centered without retaining travel motion", () => {
  const markup = sceneMarkup({
    arrival: { label: "Chuyến học đã kết thúc", completed: true },
    restStop: { index: 1, count: 1 },
    sessionTiming: undefined,
  });

  assert.equal(stationNumber(markup, "arrival", "data-station-screen-x"), 450);
  assert.match(markup, /data-world-motion="false"/u);
  assert.match(markup, /GA CUỐI/u);
  assert.doesNotMatch(markup, /data-station-id="rest-1"/u);
});

test("six-car trains keep the engine fixed and selection semantics intact", () => {
  const carriages = Array.from({ length: 6 }, (_, index) => ({
    id: `guest-${index + 1}`,
    name: `Toa ${index + 1}`,
    color: "#398575",
  }));
  const markup = sceneMarkup({ carriages, ownId: "guest-1" });

  assert.match(markup, /class="travel-train" aria-label="Đoàn tàu nhìn từ trên xuống" transform="translate\(450 210\) scale\(1\) translate\(-450 -210\)"/u);
  assert.equal([...markup.matchAll(/aria-label="Toa [1-6]:/gu)].length, 6);
  assert.match(markup, /aria-pressed="true"/u);
});

test("hidden motion and the initial scene mount do not interpolate world position", () => {
  const initialMount = sceneMarkup();
  const hiddenMotion = sceneMarkup({ motionAllowed: false });

  assert.match(initialMount, /data-world-interpolate="false"/u);
  assert.match(hiddenMotion, /data-world-motion="false"/u);
  assert.match(hiddenMotion, /data-world-interpolate="false"/u);
});
