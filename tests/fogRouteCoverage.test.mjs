import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tmpdir } from "node:os";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { mapGeometry, stopIndices } from "../src/adventure/mapGeometry.ts";
import {
  MAP_FOG_ROUTE_CLEARANCE_COLLAR_FEATHER_RADIUS,
  MAP_FOG_ROUTE_CLEARANCE_COLLAR_WIDTH,
  MAP_FOG_ROUTE_CLEARANCE_WIDTH,
  MAP_FOG_ROUTE_EDGE_FEATHER_RADIUS,
  MAP_FOG_ROUTE_GUARD_LEAD,
  MAP_FOG_ROUTE_UNDERLAY_WIDTH,
  MAP_FOG_STATION_GUARD_RADIUS,
} from "../src/adventure/mapFogGeometry.ts";

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

function progressAtRouteDistance(branch, distance) {
  const geometry = mapGeometry(branch);
  const leg = stopIndices.slice(1).findIndex((stop) => distance <= geometry.distances[stop]);
  assert.notEqual(leg, -1, `route distance ${distance} falls before the final station`);
  const startDistance = geometry.distances[stopIndices[leg]];
  const endDistance = geometry.distances[stopIndices[leg + 1]];
  return (leg + (distance - startDistance) / (endDistance - startDistance)) / 4;
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

function pointAtRouteDistance(distance, mask) {
  const segmentIndex = mask.distances.findIndex((segmentEnd, index) =>
    index > 0 && distance <= segmentEnd,
  );
  const index = segmentIndex < 0 ? mask.route.length - 1 : segmentIndex;
  const start = mask.route[index - 1];
  const end = mask.route[index];
  const length = mask.distances[index] - mask.distances[index - 1];
  const fraction = Math.max(0, Math.min(1, (distance - mask.distances[index - 1]) / length));
  return {
    x: start[0] + (end[0] - start[0]) * fraction,
    y: start[1] + (end[1] - start[1]) * fraction,
  };
}

function parseMask(markup) {
  const match = markup.match(/<mask\b[^>]*>([\s\S]*?)<\/mask>/u);
  assert.ok(match, "real component render contains an SVG fog mask");
  const maskMarkup = match[1];
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
  const routeGuardEntries = entries.filter(({ attrs }) => attrs.class === "map-fog-unexplored-route-guard");
  const routeGuard = routeGuardEntries[0];
  assert.ok(routeGuard, "fog mask guards its untraveled route suffix");
  const [guardDashRaw, guardGapRaw] = routeGuard.attrs["stroke-dasharray"].split(/\s+/u);
  const guardDashLength = Number(guardDashRaw);
  const guardGapLength = Number(guardGapRaw);
  const guardPathLength = Number(routeGuard.attrs.pathLength);
  const guardDashOffset = Number(routeGuard.attrs["stroke-dashoffset"]);
  assert.equal(guardDashLength, guardPathLength,
    "the untraveled-route pattern uses one dash as long as the complete path");
  assert.equal(guardGapLength, guardPathLength,
    "the matching full-path gap keeps the guard to one suffix dash");
  assert.ok(routeGuardEntries.every(({ attrs }) =>
    attrs["stroke-dasharray"] === `${guardPathLength} ${guardPathLength}` &&
    attrs["stroke-dashoffset"] === routeGuard.attrs["stroke-dashoffset"]),
  "all graduated guard strokes use the same rendered suffix interval");
  const expectedGuardStart = Math.min(guardPathLength, traveled + MAP_FOG_ROUTE_GUARD_LEAD);
  assert.ok(Math.abs(guardDashOffset + expectedGuardStart) <= 0.006,
    "the negative dash offset leaves a graduated transition between the clear core and opaque suffix");
  // SVG's negative dash offset shifts this full-length dash forward by -offset.
  const guardStart = Math.max(0, Math.min(guardPathLength, -guardDashOffset));
  const guardEnd = Math.min(guardPathLength, guardStart + guardDashLength);
  const layer = markup.match(/<g class="map-fog-layer"[^>]*style="opacity:([\d.]+)"/u);
  assert.ok(layer, "fog layer exposes its current fade opacity");
  return {
    maskMarkup,
    entries,
    routeGuardEntries,
    underlayEntries: entries.filter(({ attrs }) => attrs.class === "map-fog-route-soft-underlay"),
    collarEntries: entries.filter(({ attrs }) => attrs.class === "map-fog-route-clearance-collar"),
    stationGuardEntries: entries.filter(({ attrs }) => attrs.class === "map-fog-hidden-station-guard"),
    route,
    distances,
    traveled,
    total: Number(travelRaw),
    guardStart,
    guardEnd,
    guardRadius: routeGuardEntries.reduce((largest, { attrs }) =>
      Math.max(largest, Number(attrs["stroke-width"]) / 2), 0),
    edgeRadius: entries.filter(({ attrs }) => attrs.class === "map-fog-route-soft-underlay")
      .reduce((largest, { attrs }) => Math.max(largest, Number(attrs["stroke-width"]) / 2), 0),
    collarRadius: entries.filter(({ attrs }) => attrs.class === "map-fog-route-clearance-collar")
      .reduce((largest, { attrs }) => Math.max(largest, Number(attrs["stroke-width"]) / 2), 0),
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

function distanceToUntraveledSuffix(point, mask) {
  let nearest = Infinity;
  for (let index = 1; index < mask.route.length; index++) {
    const startDistance = Math.max(mask.guardStart, mask.distances[index - 1]);
    const endDistance = Math.min(mask.guardEnd, mask.distances[index]);
    if (startDistance >= endDistance) continue;
    const fullStart = mask.route[index - 1];
    const end = mask.route[index];
    const length = mask.distances[index] - mask.distances[index - 1];
    const fraction = (startDistance - mask.distances[index - 1]) / length;
    const endFraction = (endDistance - mask.distances[index - 1]) / length;
    const start = [
      fullStart[0] + (end[0] - fullStart[0]) * fraction,
      fullStart[1] + (end[1] - fullStart[1]) * fraction,
    ];
    const intervalEnd = [
      fullStart[0] + (end[0] - fullStart[0]) * endFraction,
      fullStart[1] + (end[1] - fullStart[1]) * endFraction,
    ];
    nearest = Math.min(nearest, distanceToSegment(point, start, intervalEnd));
  }
  return nearest;
}

function edgeCoverage(distance, radius) {
  return Math.max(0, Math.min(1, radius + 0.5 - distance));
}

function strokeAlphaAt(distance, attrs) {
  const radius = Number(attrs["stroke-width"]) / 2;
  const opacity = attrs["stroke-opacity"] === undefined ? 1 : Number(attrs["stroke-opacity"]);
  return edgeCoverage(distance, radius) * opacity;
}

function stationGuardAlphaAt(distance, entries) {
  let alpha = 0;
  for (const { attrs } of entries) {
    const radius = Number(attrs.r);
    const opacity = attrs["fill-opacity"] === undefined ? 1 : Number(attrs["fill-opacity"]);
    const layerAlpha = edgeCoverage(distance, radius) * opacity;
    alpha += (1 - alpha) * layerAlpha;
  }
  return alpha;
}

function routeProfileAlphaAt(distance, entries) {
  let alpha = 0;
  for (const { attrs } of entries) {
    const layerAlpha = strokeAlphaAt(distance, attrs);
    alpha += (1 - alpha) * layerAlpha;
  }
  return alpha;
}

function fogMaskAt(point, mask) {
  let luminance = 1;
  for (const { tag, attrs } of mask.entries) {
    if (tag === "path" && attrs.class === "map-fog-route-soft-underlay") {
      const distance = distanceToTraveledPrefix(point, mask);
      luminance *= 1 - strokeAlphaAt(distance, attrs);
    } else if (tag === "circle" && attrs.class === "map-fog-hidden-station-guard") {
      const distance = Math.hypot(point.x - Number(attrs.cx), point.y - Number(attrs.cy));
      const coverage = edgeCoverage(distance, Number(attrs.r)) *
        (attrs["fill-opacity"] === undefined ? 1 : Number(attrs["fill-opacity"]));
      luminance = luminance * (1 - coverage) + coverage;
    } else if (tag === "path" && attrs.class === "map-fog-unexplored-route-guard") {
      const distance = distanceToUntraveledSuffix(point, mask);
      const coverage = strokeAlphaAt(distance, attrs);
      luminance = luminance * (1 - coverage) + coverage;
    } else if (tag === "path" && attrs.class === "map-fog-route-clearance-collar") {
      const distance = distanceToTraveledPrefix(point, mask);
      luminance *= 1 - strokeAlphaAt(distance, attrs);
    } else if (tag === "path" && attrs.class === "map-fog-route-clearance") {
      const distance = distanceToTraveledPrefix(point, mask);
      luminance *= 1 - edgeCoverage(distance, Number(attrs["stroke-width"]) / 2);
    }
  }
  return luminance * mask.layerOpacity;
}

function maximumSoftRevealRadius(mask) {
  return mask.edgeRadius;
}

test("rendered fog profiles feather every mask edge without full-map filters", () => {
  const mask = parseMask(renderMap("mountain", 0.01, []));
  assert.doesNotMatch(mask.maskMarkup, /\bfilter=/u,
    "fog mask routes and stations use vector opacity profiles rather than filter passes");

  const edgeSamples = Array.from({ length: 9 }, (_, index) => 193 + index);
  const routeProfile = edgeSamples.map((distance) =>
    routeProfileAlphaAt(distance, mask.underlayEntries));
  const routeSteps = routeProfile.slice(1).map((value, index) => routeProfile[index] - value);
  assert.ok(mask.underlayEntries.length >= 20, "the route edge is built from a dense graduated profile");
  assert.ok(mask.underlayEntries.every(({ attrs }) => Number.isFinite(Number(attrs["stroke-opacity"]))),
    "each rendered route layer carries an explicit opacity");
  assert.ok(routeProfile[0] > 0 && routeProfile.at(-1) < 0.01,
    `the traveled profile eases to fog at its bounded outer edge (${routeProfile.join(", ")})`);
  assert.ok(routeSteps.every((value) => value >= -1e-6 && value < 0.1),
    `one-pixel route profile samples remain continuous (${routeProfile.join(", ")})`);
  assert.ok(routeProfileAlphaAt(126, mask.underlayEntries) > 0.99,
    "the graduated underlay already covers the 252px opaque-core boundary");

  const guardSamples = Array.from({ length: 9 }, (_, index) =>
    mask.guardStart - mask.guardRadius + index);
  const guardProfile = guardSamples.map((distance) => routeProfileAlphaAt(
    distanceToUntraveledSuffix(pointAtRouteDistance(distance, mask), mask), mask.routeGuardEntries,
  ));
  const guardSteps = guardProfile.slice(1).map((value, index) => value - guardProfile[index]);
  assert.ok(guardProfile.at(-1) > guardProfile[0],
    `the suffix guard progressively restores fog (${guardProfile.join(", ")})`);
  assert.ok(guardSteps.every((value) => value >= -1e-6 && value < 0.1),
    `one-pixel suffix-guard samples remain continuous (${guardProfile.join(", ")})`);

  const guardGroups = new Map();
  for (const entry of mask.stationGuardEntries) {
    const { cx, cy } = entry.attrs;
    const key = `${cx}:${cy}`;
    guardGroups.set(key, [...(guardGroups.get(key) ?? []), entry]);
  }
  assert.ok([...guardGroups.values()].every((layers) => layers.length >= 10),
    "future stations use nested graduated alpha circles");
  for (const [key, layers] of guardGroups) {
    const center = layers[0].attrs;
    const nominalRadius = Math.min(...layers.map(({ attrs }) => Number(attrs.r)));
    const stationProfile = Array.from({ length: 9 }, (_, index) =>
      stationGuardAlphaAt(nominalRadius + 28 + index, layers));
    const stationSteps = stationProfile.slice(1).map((value, index) => stationProfile[index] - value);
    assert.ok(stationProfile[0] > stationProfile.at(-1),
      `station ${key} fades toward its outer edge (${stationProfile.join(", ")})`);
    assert.ok(stationSteps.every((value) => value >= -1e-6 && value < 0.1),
      `one-pixel station samples remain continuous (${stationProfile.join(", ")})`);
    assert.ok(stationGuardAlphaAt(0, layers) > 0.99,
      `station ${center.cx},${center.cy} remains protected at its center`);
  }
});

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

test("straight route reveal joins its crisp core with a gradual edge profile", () => {
  const mask = parseMask(renderMap("mountain", 0.01, []));
  assert.doesNotMatch(mask.maskMarkup, /\bfilter=/u, "the mask edge avoids raster filter passes");
  assert.ok(mask.underlayEntries.length >= 20, "the traveled route has a dense rendered alpha profile");
  assert.ok(mask.routeGuardEntries.length >= 18, "the suffix guard has a dense rendered alpha profile");
  assert.equal(mask.edgeRadius, MAP_FOG_ROUTE_UNDERLAY_WIDTH / 2);
  assert.equal(mask.edgeRadius, 198);
  const endpoint = pointAtRouteDistance(mask.traveled, mask);
  const next = pointAtRouteDistance(mask.traveled + 1, mask);
  const tangent = { x: next.x - endpoint.x, y: next.y - endpoint.y };
  const samples = [124, 125, 126, 127, 128, 129, 130].map((ahead) => ({
    x: endpoint.x + tangent.x * ahead,
    y: endpoint.y + tangent.y * ahead,
  }));
  const profile = samples.map((point) => fogMaskAt(point, mask));
  const largestPixelStep = Math.max(...profile.slice(1).map((value, index) => value - profile[index]));

  assert.ok(largestPixelStep < 0.1,
    `fog should blend across the 252px core edge, not jump in one pixel (profile ${profile.join(", ")})`);
  assert.ok(profile[0] < 0.02, "the train-clear core stays nearly fully revealed");
  assert.ok(profile.at(-1) < 0.1, "the feather begins near-black just outside the crisp core");
});

test("future station guards fade smoothly at their rendered circle edge", () => {
  const mask = parseMask(renderMap("mountain", 0.01, []));
  const stationGuard = mask.stationGuardEntries[0];
  assert.ok(stationGuard, "future stations have rendered vector guards");
  const center = stationGuard.attrs;
  const stationLayers = mask.stationGuardEntries.filter(({ attrs }) =>
    attrs.cx === center.cx && attrs.cy === center.cy);
  const radius = Math.min(...stationLayers.map(({ attrs }) => Number(attrs.r)));
  assert.ok(radius >= MAP_FOG_STATION_GUARD_RADIUS && radius <= MAP_FOG_STATION_GUARD_RADIUS + 0.5,
    "the innermost station profile slightly overlaps its nominal protected radius");
  const edgeProfile = Array.from({ length: 9 }, (_, index) =>
    stationGuardAlphaAt(radius + index, stationLayers));
  const edgeSteps = edgeProfile.slice(1).map((value, index) => edgeProfile[index] - value);

  assert.ok(edgeProfile.every((value, index) => index === 0 || value <= edgeProfile[index - 1] + 1e-6),
    `the station guard fades monotonically across its edge (${edgeProfile.join(", ")})`);
  assert.ok(edgeSteps.every((value) => value >= -1e-6 && value < 0.1),
    `the station guard changes gradually at one-pixel samples (${edgeProfile.join(", ")})`);
  assert.ok(stationGuardAlphaAt(radius, stationLayers) > 0.99,
    "the station remains protected through its nominal boundary");
  assert.ok(stationGuardAlphaAt(radius + 36, stationLayers) < 0.002,
    "the graduated station guard is negligible beyond its outer feather");
  assert.ok(fogMaskAt({ x: Number(center.cx), y: Number(center.cy) }, mask) > 0.99,
    "the future station center remains protected by the rendered mask");
});

test("future-station protection does not jump at the traveled core boundary", () => {
  for (const branch of ["mountain", "coast"]) {
    const geometry = mapGeometry(branch);
    for (const stop of stopIndices.slice(1)) {
      const stationRouteDistance = geometry.distances[stop];
      const mask = parseMask(renderMap(branch,
        progressAtRouteDistance(branch, stationRouteDistance - 30), []));
      const station = geometry.route[stop];
      const stationGuard = mask.entries.find(({ tag, attrs }) =>
        tag === "circle" && attrs.class === "map-fog-hidden-station-guard" &&
        Number(attrs.cx) === station[0] && Number(attrs.cy) === station[1],
      );
      assert.ok(stationGuard, `${branch}: station ${stop} remains guarded 30 route-pixels ahead`);

      const endpoint = pointAtRouteDistance(mask.traveled, mask);
      const next = pointAtRouteDistance(mask.traveled + 1, mask);
      const tangentLength = Math.hypot(next.x - endpoint.x, next.y - endpoint.y);
      const tangent = {
        x: (next.x - endpoint.x) / tangentLength,
        y: (next.y - endpoint.y) / tangentLength,
      };
      const edgePoints = [125.5, 126.5].map((radius) => ({
        x: endpoint.x + tangent.x * radius,
        y: endpoint.y + tangent.y * radius,
      }));
      const profile = edgePoints.map((point) => fogMaskAt(point, mask));
      const stationDistance = Math.hypot(
        edgePoints[1].x - station[0], edgePoints[1].y - station[1],
      );
      assert.ok(stationDistance < Number(stationGuard.attrs.r),
        `${branch}: the outer core-edge sample is inside the future station guard`);
      assert.ok(Math.abs(profile[1] - profile[0]) < 0.1,
        `${branch}: station ${stop} stays continuous across the 252px core edge ` +
        `(126.5px from the endpoint is ${stationDistance.toFixed(1)}px from the station; profile ${profile.join(", ")})`);
      assert.ok(profile[0] < 0.01 && profile[1] < 0.02,
        `${branch}: the collar keeps the join near-black outside the core (${profile.join(", ")})`);
    }
  }
});

test("unexplored-route guard blends into the graduated traveled cap", () => {
  const mask = parseMask(renderMap("mountain", 0, []));
  const coreRadius = MAP_FOG_ROUTE_CLEARANCE_WIDTH / 2;
  assert.equal(coreRadius, 126);
  assert.ok(mask.edgeRadius > coreRadius, "the soft profile extends beyond the crisp core");
  assert.equal(mask.guardRadius, coreRadius + MAP_FOG_ROUTE_CLEARANCE_COLLAR_FEATHER_RADIUS);
  const distances = Array.from({ length: 75 }, (_, index) => 126 + index);
  const profile = distances.map((distance) =>
    fogMaskAt(pointAtRouteDistance(mask.traveled + distance, mask), mask));
  const profileSteps = profile.slice(1).map((value, index) => value - profile[index]);
  const largestStep = Math.max(...profileSteps);

  assert.ok(profile[0] < 0.02 && profile[1] < 0.02 && profile.at(-1) > 0.9,
    `the combined core/collar/suffix guard transitions from clear to fog (${profile.join(", ")})`);
  assert.ok(profileSteps.every((step) => step >= -1e-6),
    `the rendered guard composition does not re-clear pixels as its cap passes (${profile.join(", ")})`);
  assert.ok(largestStep < 0.1,
    `the rendered guard/core join changes gradually at one-pixel samples (${profile.join(", ")})`);
});

test("expanded route reveal keeps the crisp corridor inside a bounded graduated underlay", () => {
  const mask = parseMask(renderMap("mountain", 0.15, []));
  const clear = mask.entries.find(({ attrs }) => attrs.class === "map-fog-route-clearance");

  assert.equal(Number(clear.attrs["stroke-width"]), MAP_FOG_ROUTE_CLEARANCE_WIDTH);
  assert.equal(mask.edgeRadius, MAP_FOG_ROUTE_UNDERLAY_WIDTH / 2);
  assert.equal(MAP_FOG_ROUTE_CLEARANCE_WIDTH, 252,
    "the train-clear core retains its three-times-expanded width");
  assert.equal(MAP_FOG_ROUTE_EDGE_FEATHER_RADIUS, 72);
  assert.ok(mask.underlayEntries.length >= 20, "the traveled underlay uses graduated alpha layers");
  assert.ok(mask.routeGuardEntries.length >= 18, "the future-route guard uses graduated alpha layers");
  assert.ok(mask.collarEntries.length >= 10, "the collar softly joins guard overlaps to the core");
  const guardIndex = mask.entries.findIndex(({ attrs }) => attrs.class === "map-fog-unexplored-route-guard");
  const collarIndex = mask.entries.findIndex(({ attrs }) => attrs.class === "map-fog-route-clearance-collar");
  const clearIndex = mask.entries.findIndex(({ attrs }) => attrs.class === "map-fog-route-clearance");
  assert.ok(guardIndex < collarIndex && collarIndex < clearIndex,
    "the collar re-clears guard overlaps before final crisp train clearance");
  assert.equal(mask.collarRadius, MAP_FOG_ROUTE_CLEARANCE_COLLAR_WIDTH / 2);
  assert.equal(mask.guardRadius, MAP_FOG_ROUTE_CLEARANCE_WIDTH / 2 + MAP_FOG_ROUTE_CLEARANCE_COLLAR_FEATHER_RADIUS);
  assert.equal(MAP_FOG_ROUTE_CLEARANCE_COLLAR_WIDTH, 324);
  assert.ok(routeProfileAlphaAt(MAP_FOG_ROUTE_CLEARANCE_WIDTH / 2, mask.collarEntries) > 0.998,
    "the collar is near-black at the 252px core boundary");
  assert.ok(routeProfileAlphaAt(MAP_FOG_ROUTE_CLEARANCE_WIDTH / 2, mask.underlayEntries) > 0.998,
    "the graduated underlay is near-black at the 252px core boundary");
  assert.doesNotMatch(mask.maskMarkup, /\bfilter=/u, "the mask does not spend filter passes on edge shapes");
  assert.equal(maximumSoftRevealRadius(mask), 198,
    "the bounded reveal skirt reaches no farther than the outer profile radius");
  assert.equal(mask.entries.filter(({ attrs }) => attrs.class?.startsWith("map-fog-route-feather")).length, 0,
    "the edge uses a continuous profile instead of discrete bands");
});

test("far future self-approach regions stay fogged until the train is spatially nearby", () => {
  for (const branch of ["mountain", "coast"]) {
    const farFuture = branch === "mountain" ? { x: 844, y: 320 } : { x: 569.47, y: 320 };
    for (const progress of [0, 0.08, 0.15]) {
      const markup = renderMap(branch, progress);
      const mask = parseMask(markup);
      const futureRouteGuard = mask.entries.find(({ attrs }) => attrs.class === "map-fog-unexplored-route-guard");
      assert.ok(futureRouteGuard, `${branch} at ${progress}: the untraveled route has an opaque guard`);
      assert.ok(distanceToUntraveledSuffix(farFuture, mask) <= Number(futureRouteGuard.attrs["stroke-width"]) / 2,
        `${branch} at ${progress}: distant route point is covered by the untraveled-route guard`);
      assert.ok(fogMaskAt(farFuture, mask) >= 0.9,
        `${branch} at ${progress}: widened feather does not reveal the far future point`);
      if (progress === 0.15) {
        const guardTags = [...markup.matchAll(/<circle\b[^>]*class="map-fog-hidden-station-guard"[^>]*>/gu)];
        const guards = new Map();
        for (const [tag] of guardTags) {
          const guard = attributes(tag);
          guards.set(`${guard.cx}:${guard.cy}`, guard);
        }
        assert.equal(guards.size, 4, `${branch}: all four future stations are guarded`);
        for (const guard of guards.values()) {
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
    const futureRouteGuard = nearStationMask.entries.find(({ attrs }) => attrs.class === "map-fog-unexplored-route-guard");
    assert.ok(futureRouteGuard, `${branch}: the untraveled route has an opaque guard`);
    const suffixDistance = distanceToUntraveledSuffix(farLoopPoint, nearStationMask);
    assert.ok(suffixDistance <= Number(futureRouteGuard.attrs["stroke-width"]) / 2,
      `${branch}: the later loop is covered by the untraveled-route guard (distance ${suffixDistance}, radius ${Number(futureRouteGuard.attrs["stroke-width"]) / 2}, traveled ${nearStationMask.traveled})`);
    assert.ok(distanceToTraveledPrefix(farLoopPoint, nearStationMask) <= maximumSoftRevealRadius(nearStationMask),
      `${branch}: the fixture overlaps the bounded feather from a traveled bend`);
    assert.ok(fogMaskAt(farLoopPoint, nearStationMask) >= 0.9,
      `${branch}: the later loop stays fogged despite that spatial overlap`);
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
