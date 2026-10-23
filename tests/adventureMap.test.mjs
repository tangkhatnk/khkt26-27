import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { mapGeometry, stopIndices } from "../src/adventure/mapGeometry.ts";
import {
  mapFogMotionShouldRun,
  mapFogRouteDashArray,
  MAP_FOG_ROUTE_CLEARANCE_WIDTH,
  MAP_FOG_STATION_GUARD_RADIUS,
} from "../src/adventure/mapFogGeometry.ts";
import * as mapFogGeometry from "../src/adventure/mapFogGeometry.ts";
import { studyTopics } from "../backend/src/adventure/topics.ts";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let vite;
let TopDownMap;

test.before(async () => {
  vite = await createServer({
    configFile: resolve(projectRoot, "vite.config.ts"),
    cacheDir: resolve(tmpdir(), "viendu-v3-scene-tests", "map"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ TopDownMap } = await vite.ssrLoadModule("/src/adventure/TopDownMap.tsx"));
});

test.after(async () => {
  await vite?.close();
});

test("six carriages fit behind the engine at the first station", () => {
  const geometry = mapGeometry();
  const start = geometry.distances[stopIndices[0]];
  for (let i = 0; i <= 6; i++) {
    const p = geometry.position(start - i * 49);
    assert.ok(p.x > 25 && p.x < 1100);
    assert.equal(p.y, 505);
  }
});
test("both branches visit the same five stations with different tracks", () => {
  const mountain = mapGeometry("mountain"),
    coast = mapGeometry("coast");
  assert.notEqual(mountain.path, coast.path);
  for (const index of stopIndices) {
    for (const geometry of [mountain, coast]) {
      const p = geometry.position(geometry.distances[index]);
      assert.deepEqual([p.x, p.y], mountain.route[index]);
      assert.ok(Number.isFinite(p.angle));
    }
  }
  assert.equal(mountain.position(-100).x, 35);
  assert.equal(coast.position(Infinity).x, 965);
});

test("map railway layers share one continuous route and unopened station names stay hidden", () => {
  const markup = renderToStaticMarkup(
    React.createElement(TopDownMap, {
      journey: { branch: "mountain", station: 0, remaining: 0, threshold: 1800 },
      carriages: [{ id: "guest", name: "Toa Mây", color: "#398575" }],
      ownId: "guest",
    }),
  );
  const rails = [...markup.matchAll(/<path class="map-rail-layer[^"]*" d="([^"]+)"/gu)];

  assert.equal(rails.length, 4, "the bed, tie, rail and highlight strokes render");
  assert.ok(rails.every(([, d]) => d === rails[0][1]), "each rail layer follows the same route");
  assert.match(rails[0][1], /^M35 505 L350 505/u);
  assert.match(markup, /Ga Khởi đầu/u);
  assert.doesNotMatch(markup, /Đồng cỏ Gió|Rừng Sương mù|Đèo Ánh sao|Thành phố Bình minh/u);
});

test("overview scenery uses overhead rooftops, canopies, ridge contours, and unlocked station footprints", () => {
  const markup = renderToStaticMarkup(
    React.createElement(TopDownMap, {
      journey: { branch: "mountain", station: 0, remaining: 0, threshold: 1800 },
      carriages: [{ id: "guest", name: "Toa Mây", color: "#398575" }],
      ownId: "guest",
    }),
  );

  assert.match(markup, /class="map-scenery map-scenery--overview"/u);
  assert.match(markup, /overhead-tree-canopy/u);
  assert.match(markup, /overhead-roof/u);
  assert.match(markup, /overhead-ridge-contour/u);
  assert.equal([...markup.matchAll(/class="overhead-station-footprint"/gu)].length, 1);
});

test("fog uses billowed noise density and soft wisps over the route mask", () => {
  const markup = renderToStaticMarkup(
    React.createElement(TopDownMap, {
      journey: { branch: "coast", station: 0, remaining: 0, threshold: 1800 },
      carriages: [{ id: "guest", name: "Toa Mây", color: "#398575" }],
      ownId: "guest",
    }),
  );
  assert.match(markup, /class="map-fog-cover"[^>]*mask="url\(#.+-route-mask\)"/u);
  assert.match(markup, /class="map-fog-layer"/u);
  assert.doesNotMatch(markup, /cartoon-cloud-body|map-cloud-shape/u);
  assert.match(markup, /class="map-fog-cloud-density"/u);
  assert.match(markup, /feTurbulence type="fractalNoise" baseFrequency="\.004 \.006" numOctaves="3"/u);
  assert.match(markup, /feColorMatrix in="cloudNoise" type="matrix"/u);
  assert.match(markup, /feComponentTransfer in="cloudLuminance" result="cloudDensity"/u);
  assert.match(markup, /feDisplacementMap in="cloudDensity" in2="cloudNoise"/u);
  assert.match(markup, /feFlood flood-color="var\(--fog-bank-blue\)"/u);
  assert.match(markup, /feComposite in="blueFlood" in2="softBanks" operator="in"/u);
  assert.match(markup, /class="map-fog-eddy-density"/u);
  assert.match(markup, /feGaussianBlur in="sharpWisps" stdDeviation="9 7" result="wispGlow"/u);
  assert.doesNotMatch(markup, /<path class="map-fog-(?:bank|wisp)/u);
  assert.doesNotMatch(markup, /class="map-fog-noise"/u);
  assert.match(markup, /filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse"/u);
});

test("fog transforms remain available on map views while the dashboard stays static", async () => {
  const stylesheet = await readFile(resolve(projectRoot, "src/adventure/fog.css"), "utf8");

  assert.match(stylesheet, /\.map-fog-flow--slow\.is-active\s*\{\s*animation: map-fog-drift-slow/u);
  assert.match(stylesheet, /\.map-fog-flow--quick\.is-active\s*\{\s*animation: map-fog-drift-quick/u);
  assert.match(stylesheet, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.map-fog-flow\.is-active\s*\{\s*animation:\s*none;/u);
  assert.match(stylesheet, /\.dashboard-grid\s+\.map-fog-flow\.is-active\s*\{\s*animation-play-state:\s*paused;/u,
    "dashboard fog stays static from activation, so form focus does not pause the animation");
});

test("route fog mask clamps progress and keeps a full-train clear corridor", () => {
  assert.equal(mapFogRouteDashArray(315, 2287.761265), "315.00 2287.76");
  assert.equal(mapFogRouteDashArray(-1, 100), "0.00 100.00");
  assert.equal(mapFogRouteDashArray(150, 100), "100.00 100.00");
  assert.equal(mapFogRouteDashArray(Number.NaN, 100), "0.00 100.00");
  assert.equal(mapFogRouteDashArray(50, Number.NaN), "0.00 0.00");
  assert.equal(MAP_FOG_ROUTE_CLEARANCE_WIDTH, 84);
  assert.ok(MAP_FOG_ROUTE_CLEARANCE_WIDTH / 2 >= 37, "the corridor contains the engine's 37px front reach");
  assert.equal(MAP_FOG_STATION_GUARD_RADIUS, 125);
});

test("fog motion pauses offscreen, when hidden, and for reduced motion", () => {
  assert.equal(mapFogMotionShouldRun(true, true, false), true);
  assert.equal(mapFogMotionShouldRun(false, true, false), false);
  assert.equal(mapFogMotionShouldRun(true, false, false), false);
  assert.equal(mapFogMotionShouldRun(true, true, true), false);
});

test("the final progress window fades the complete fog cover and clamps safely", () => {
  const { mapFogLayerOpacity } = mapFogGeometry;
  assert.equal(typeof mapFogLayerOpacity, "function", "fog coverage exposes a completion fade helper");
  assert.equal(mapFogLayerOpacity(0), 1);
  assert.equal(mapFogLayerOpacity(-1), 1);
  assert.equal(mapFogLayerOpacity(0.98), 1);
  assert.ok(Math.abs(mapFogLayerOpacity(0.99) - 0.5) < 1e-12);
  assert.equal(mapFogLayerOpacity(1), 0);
  assert.equal(mapFogLayerOpacity(2), 0);
  assert.equal(mapFogLayerOpacity(Number.NaN), 1);

  const markup = renderToStaticMarkup(
    React.createElement(TopDownMap, {
      journey: { branch: "mountain", station: 4, remaining: 0, threshold: 1800 },
      carriages: [{ id: "guest", name: "Toa Mây", color: "#398575" }],
      ownId: "guest",
    }),
  );
  assert.match(markup, /class="map-fog-layer"[^>]*style="opacity:0"/u);
});

test("route geometry stays canonical for both branches", () => {
  for (const branch of ["mountain", "coast"]) {
    const geometry = mapGeometry(branch);
    assert.equal(geometry.route.length, 11);
    assert.equal(geometry.path, geometry.route.map((point, index) => `${index ? "L" : "M"}${point.join(" ")}`).join(" "));
    assert.equal(geometry.distances[0], 0);
    assert.equal(geometry.distances.at(-1), geometry.total);
    assert.ok(geometry.distances.every((distance, index) => index === 0 || distance > geometry.distances[index - 1]));
    assert.ok(stopIndices.every((stop) => geometry.distances[stop] <= geometry.total));
  }
  assert.notEqual(mapGeometry("mountain").path, mapGeometry("coast").path);
});

test("overview fog clears the traveled rail with train clearance and guards future stations", () => {
  const markup = renderToStaticMarkup(
    React.createElement(TopDownMap, {
      journey: { branch: "mountain", station: 0, remaining: 0, threshold: 1800 },
      carriages: [{ id: "guest", name: "Toa Mây", color: "#398575" }],
      ownId: "guest",
    }),
  );
  const clearance = markup.match(/<path class="map-fog-route-clearance"[^>]*>/u)?.[0];

  assert.ok(clearance, "the mask has an explicit traveled-route clearance path");
  assert.match(clearance, /d="M35 505 L350 505 L630 505 L810 410 L810 220 L650 140 L430 140 L280 230 L360 320 L610 320 L965 320"/u);
  assert.match(clearance, /stroke-width="84"/u, "the fully clear band covers the train's 74px nose-to-tail footprint");
  assert.match(clearance, /stroke-linecap="round"/u, "the current-position end cap covers the whole engine");
  assert.match(clearance, /stroke-dasharray="315\.00 2287\.76"/u, "only the route traveled through the current station is clear");
  assert.doesNotMatch(markup, /class="map-fog-aperture"/u, "independent cloud holes cannot expose a future route bend");
  assert.equal([...markup.matchAll(/class="map-fog-hidden-station-guard"/gu)].length, 4);
  assert.match(markup, /class="map-fog-hidden-station-guard"[^>]*cx="810" cy="410" r="125" fill="#fff"/u);
  assert.ok(markup.indexOf('class="map-fog-hidden-station-guard"') < markup.indexOf('class="map-fog-route-clearance"'),
    "the opaque train corridor is drawn last so future-station guards cannot hide the train");

  const midwayMarkup = renderToStaticMarkup(
    React.createElement(TopDownMap, {
      journey: { branch: "mountain", station: 0, remaining: 900, threshold: 1800 },
      carriages: [{ id: "guest", name: "Toa Mây", color: "#398575" }],
      ownId: "guest",
    }),
  );
  const midwayClearance = midwayMarkup.match(/<path class="map-fog-route-clearance"[^>]*>/u)?.[0];
  assert.match(midwayClearance, /stroke-dasharray="556\.77 2287\.76"/u, "the cleared prefix grows with journey progress");
  assert.equal([...midwayMarkup.matchAll(/class="map-fog-hidden-station-guard"/gu)].length, 4);

  const arrivedMarkup = renderToStaticMarkup(
    React.createElement(TopDownMap, {
      journey: { branch: "mountain", station: 1, remaining: 0, threshold: 1800 },
      carriages: [{ id: "guest", name: "Toa Mây", color: "#398575" }],
      ownId: "guest",
    }),
  );
  assert.equal([...arrivedMarkup.matchAll(/class="map-fog-hidden-station-guard"/gu)].length, 3,
    "arrival removes the current station's guard");
  assert.doesNotMatch(arrivedMarkup, /class="map-fog-hidden-station-guard"[^>]*cx="810" cy="410"/u);

  const coastMarkup = renderToStaticMarkup(
    React.createElement(TopDownMap, {
      journey: { branch: "coast", station: 0, remaining: 0, threshold: 1800 },
      carriages: [{ id: "guest", name: "Toa Mây", color: "#398575" }],
      ownId: "guest",
    }),
  );
  assert.match(coastMarkup, /class="map-fog-route-clearance"[^>]*d="M35 505 L350 505 L630 505 L810 410 L810 220 L650 140 L870 230/u);
  assert.equal([...coastMarkup.matchAll(/class="map-fog-hidden-station-guard"/gu)].length, 4);

  const finalMarkup = renderToStaticMarkup(
    React.createElement(TopDownMap, {
      journey: { branch: "mountain", station: 4, remaining: 0, threshold: 1800 },
      carriages: [{ id: "guest", name: "Toa Mây", color: "#398575" }],
      ownId: "guest",
    }),
  );
  assert.doesNotMatch(finalMarkup, /class="map-fog-hidden-station-guard"/u);
  assert.match(finalMarkup, /class="map-fog-layer"[^>]*style="opacity:0"/u);
});
test("every study topic has unique valid metadata", () => {
  assert.equal(studyTopics.length, 12);
  assert.equal(new Set(studyTopics.map((t) => t.id)).size, 12);
  for (const topic of studyTopics) {
    assert.match(topic.id, /^[a-z0-9-]+$/);
    assert.ok(topic.name.trim());
    assert.ok(topic.icon.trim());
  }
});
