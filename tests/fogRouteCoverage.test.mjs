import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tmpdir } from "node:os";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { mapGeometry, stopIndices } from "../src/adventure/mapGeometry.ts";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let vite;
let TopDownMap;

test.before(async () => {
  vite = await createServer({
    configFile: resolve(projectRoot, "vite.config.ts"),
    cacheDir: resolve(tmpdir(), "viendu-fog-route-review", "map"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ TopDownMap } = await vite.ssrLoadModule("/src/adventure/TopDownMap.tsx"));
});

test.after(async () => {
  await vite?.close();
});

const threshold = 1800;
const carriages = Array.from({ length: 6 }, (_, index) => ({
  id: `car-${index + 1}`,
  name: `Car ${index + 1}`,
  color: "#398575",
}));

function journeyAtProgress(branch, progress) {
  const station = progress >= 1 ? 4 : Math.min(3, Math.floor(progress * 4));
  const fraction = progress >= 1 ? 0 : progress * 4 - station;
  return {
    seconds: 0,
    branch,
    station,
    threshold,
    remaining: fraction * threshold,
    votes: {},
    voteUntil: null,
    journal: [],
  };
}

function renderMap(branch, progress, cars = carriages) {
  return renderToStaticMarkup(React.createElement(TopDownMap, {
    journey: journeyAtProgress(branch, progress),
    carriages: cars,
    ownId: cars[0]?.id ?? "no-car",
  }));
}

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/gu)].map(([, name, value]) => [name, value]));
}

function parseRoutePath(path) {
  const points = [...path.matchAll(/[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/gu)]
    .map(([, x, y]) => [Number(x), Number(y)]);
  assert.ok(points.length >= 2, `expected a route polyline, got ${path}`);
  return points;
}

function parseMask(markup) {
  const match = markup.match(/<mask\b[^>]*>([\s\S]*?)<\/mask>/u);
  assert.ok(match, "real component render contains an SVG fog mask");
  const entries = [...match[1].matchAll(/<(path|circle)\b[^>]*>/gu)].map(([tag]) => {
    const attrs = attributes(tag);
    return { tag: tag.startsWith("<circle") ? "circle" : "path", attrs };
  });
  const routeClearance = entries.find(({ attrs }) => attrs.class === "map-fog-route-clearance");
  assert.ok(routeClearance, "fog mask contains its final route-clearance path");
  const route = parseRoutePath(routeClearance.attrs.d);
  const distances = [0];
  for (let index = 1; index < route.length; index++) {
    distances.push(distances[index - 1] + Math.hypot(
      route[index][0] - route[index - 1][0],
      route[index][1] - route[index - 1][1],
    ));
  }
  const [, travelRaw] = routeClearance.attrs["stroke-dasharray"].split(/\s+/u);
  const traveled = Number(routeClearance.attrs["stroke-dasharray"].split(/\s+/u)[0]);
  assert.ok(Number.isFinite(traveled));
  const layer = markup.match(/<g class="map-fog-layer"[^>]*style="opacity:([\d.]+)"/u);
  assert.ok(layer, "fog layer exposes its current fade opacity");
  return {
    entries,
    route,
    distances,
    traveled,
    total: Number(travelRaw),
    layerOpacity: Number(layer[1]),
  };
}

function distanceToSegment(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((point.x - start[0]) * dx + (point.y - start[1]) * dy) / lengthSquared));
  return Math.hypot(point.x - start[0] - t * dx, point.y - start[1] - t * dy);
}

function distanceToTraveledPrefix(point, mask) {
  let nearest = Infinity;
  for (let index = 1; index < mask.route.length && mask.distances[index - 1] < mask.traveled; index++) {
    const start = mask.route[index - 1];
    const fullEnd = mask.route[index];
    const length = mask.distances[index] - mask.distances[index - 1];
    const fraction = Math.min(1, (mask.traveled - mask.distances[index - 1]) / length);
    const end = [
      start[0] + (fullEnd[0] - start[0]) * fraction,
      start[1] + (fullEnd[1] - start[1]) * fraction,
    ];
    nearest = Math.min(nearest, distanceToSegment(point, start, end));
  }
  return nearest;
}

function fogMaskAt(point, mask) {
  let luminance = 1;
  for (const { tag, attrs } of mask.entries) {
    if (tag === "path" && attrs.class?.startsWith("map-fog-route-feather")) {
      if (distanceToTraveledPrefix(point, mask) <= Number(attrs["stroke-width"]) / 2) {
        luminance *= 1 - Number(attrs["stroke-opacity"]);
      }
    } else if (tag === "circle" && attrs.class === "map-fog-hidden-station-guard") {
      if (Math.hypot(point.x - Number(attrs.cx), point.y - Number(attrs.cy)) <= Number(attrs.r))
        luminance = 1;
    } else if (tag === "path" && attrs.class === "map-fog-route-clearance") {
      if (distanceToTraveledPrefix(point, mask) <= Number(attrs["stroke-width"]) / 2)
        luminance = 0;
    }
  }
  return luminance * mask.layerOpacity;
}

function maximumFeatherRadius(mask) {
  return Math.max(...mask.entries
    .filter(({ attrs }) => attrs.class?.startsWith("map-fog-route-feather"))
    .map(({ attrs }) => Number(attrs["stroke-width"]) / 2));
}

function parseTransform(transform) {
  const match = transform.match(/translate\(([-\d.]+) ([-\d.]+)\) rotate\(([-\d.]+)\)/u);
  assert.ok(match, `expected train transform, got ${transform}`);
  return { x: Number(match[1]), y: Number(match[2]), angle: Number(match[3]) * Math.PI / 180 };
}

function sampleEllipse(cx, cy, rx, ry, count = 48) {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index * Math.PI * 2) / count;
    return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
  });
}

function sampleCircle(cx, cy, radius, count = 24) {
  return sampleEllipse(cx, cy, radius, radius, count);
}

function trainFootprint(kind) {
  if (kind === "map-engine") {
    const shadow = sampleEllipse(3, 15, 30, 18);
    const body = [
      { x: -28.5, y: -19.5 }, { x: 28.5, y: -19.5 },
      { x: 28.5, y: 17.5 }, { x: -28.5, y: 17.5 },
    ];
    const nose = Array.from({ length: 17 }, (_, index) => {
      const t = index / 16;
      const inv = 1 - t;
      return {
        x: inv * inv * 26 + 2 * inv * t * 37 + t * t * 26,
        y: inv * inv * -9 + t * t * 9,
      };
    });
    return [
      ...shadow,
      ...body,
      ...nose,
      ...sampleCircle(-15, 12, 8),
      ...sampleCircle(15, 12, 8),
      ...sampleCircle(29, 0, 3.5),
    ];
  }
  return [
    ...sampleEllipse(1, 14, 27, 15),
    { x: -23.5, y: -18.5 }, { x: 23.5, y: -18.5 },
    { x: 23.5, y: 18.5 }, { x: -23.5, y: 18.5 },
    ...sampleCircle(-14, 12, 7),
    ...sampleCircle(14, 12, 7),
  ];
}

function parseTrain(markup) {
  const groups = [...markup.matchAll(/<g\b([^>]*class="(?:map-engine|overhead-car)"[^>]*)>/gu)];
  return groups.map(([, tag]) => {
    const attrs = attributes(`<g ${tag}>`);
    return { kind: attrs.class, transform: parseTransform(attrs.transform) };
  });
}

function worldPoint(local, transform) {
  const cos = Math.cos(transform.angle);
  const sin = Math.sin(transform.angle);
  return {
    x: transform.x + cos * local.x - sin * local.y,
    y: transform.y + sin * local.x + cos * local.y,
  };
}

test("real train footprints remain inside traveled clear mask on both routes and station boundaries", () => {
  const checkpoints = [0, 0.249, 0.25, 0.499, 0.5, 0.749, 0.75, 0.999];
  for (const branch of ["mountain", "coast"]) {
    for (const progress of checkpoints) {
      const markup = renderMap(branch, progress);
      const mask = parseMask(markup);
      const train = parseTrain(markup);
      assert.equal(train.length, 7, `${branch} at ${progress}: engine plus six carriages render`);
      for (const vehicle of train) {
        for (const local of trainFootprint(vehicle.kind)) {
          const point = worldPoint(local, vehicle.transform);
          assert.ok(fogMaskAt(point, mask) <= 0.01,
            `${branch} at ${progress}: ${vehicle.kind} footprint remains clear at (${point.x.toFixed(1)},${point.y.toFixed(1)})`);
        }
      }
    }
  }
});

test("far future self-approach regions stay fogged until the train is spatially nearby", () => {
  for (const branch of ["mountain", "coast"]) {
    const farFuture = branch === "mountain" ? { x: 844, y: 320 } : { x: 569.47, y: 320 };
    for (const progress of [0, 0.08, 0.15]) {
      const markup = renderMap(branch, progress);
      const mask = parseMask(markup);
      const distance = distanceToTraveledPrefix(farFuture, mask);
      assert.ok(distance > maximumFeatherRadius(mask),
        `${branch} at ${progress}: fixture is outside all route-feather neighborhoods (distance ${distance.toFixed(1)})`);
      assert.ok(fogMaskAt(farFuture, mask) >= 0.9,
        `${branch} at ${progress}: far future point remains covered`);
      if (progress === 0.15) {
        const guardTags = [...markup.matchAll(/<circle\b[^>]*class="map-fog-hidden-station-guard"[^>]*>/gu)];
        assert.equal(guardTags.length, 4, `${branch}: all four future stations are guarded`);
        for (const [tag] of guardTags) {
          const guard = attributes(tag);
          assert.ok(fogMaskAt({ x: Number(guard.cx), y: Number(guard.cy) }, mask) >= 0.9,
            `${branch}: distant future station (${guard.cx},${guard.cy}) stays fogged`);
        }
      }
    }

    const nearStationDistance = 850;
    const geometry = mapGeometry(branch);
    const journeyProgress = 0.25 + ((nearStationDistance - geometry.distances[stopIndices[1]]) /
      (geometry.distances[stopIndices[2]] - geometry.distances[stopIndices[1]])) / 4;
    const nearStationMask = parseMask(renderMap(branch, journeyProgress));
    const farLoopPoint = { x: 569.47, y: 320 };
    assert.ok(distanceToTraveledPrefix(farLoopPoint, nearStationMask) > maximumFeatherRadius(nearStationMask),
      `${branch}: the later loop is outside the train/feather neighborhood after the first bend`);
    assert.ok(fogMaskAt(farLoopPoint, nearStationMask) >= 0.9,
      `${branch}: distant later-loop point remains fogged even when its route is spatially near elsewhere`);
  }
});

test("fog at fixed world points never increases while journey progress advances", () => {
  const probes = [
    { x: 569.47, y: 320 },
    { x: 844, y: 320 },
    { x: 810, y: 410 },
    { x: 650, y: 140 },
  ];
  for (const branch of ["mountain", "coast"]) {
    const previous = probes.map(() => Infinity);
    for (let step = 0; step <= 100; step++) {
      const mask = parseMask(renderMap(branch, step / 100, []));
      for (const [index, point] of probes.entries()) {
        const current = fogMaskAt(point, mask);
        assert.ok(current <= previous[index] + 1e-6,
          `${branch} point (${point.x},${point.y}) re-fogged at ${step}%: ${previous[index]} -> ${current}`);
        previous[index] = current;
      }
    }
  }
});

test("completed journey fades all fog and removes hidden station guards", () => {
  for (const branch of ["mountain", "coast"]) {
    const markup = renderMap(branch, 1, []);
    const mask = parseMask(markup);
    assert.equal(mask.layerOpacity, 0);
    assert.equal(mask.entries.filter(({ attrs }) => attrs.class === "map-fog-hidden-station-guard").length, 0);
    assert.equal(fogMaskAt({ x: 550, y: 300 }, mask), 0);
  }
});
