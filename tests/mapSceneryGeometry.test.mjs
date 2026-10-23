import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let vite;
let MapScenery;
let OverheadStationFootprint;
let layout;
let sceneryCss;

test.before(async () => {
  vite = await createServer({
    configFile: resolve(projectRoot, "vite.config.ts"),
    cacheDir: resolve(tmpdir(), "viendu-v4-scenery-tests", "map"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ MapScenery, OverheadStationFootprint } = await vite.ssrLoadModule("/src/adventure/mapScenery.tsx"));
  layout = await vite.ssrLoadModule("/src/adventure/mapSceneryGeometry.ts");
  sceneryCss = readFileSync(resolve(projectRoot, "src/adventure/mapScenery.css"), "utf8");
});

test.after(async () => {
  await vite?.close();
});

function intersects(interval, band) {
  return interval.minY < band.bottom && interval.maxY > band.top;
}

test("travel scenery defines one static tile and reuses it at all three periodic offsets", () => {
  for (const coast of [false, true]) {
    const markup = renderToStaticMarkup(React.createElement(MapScenery, { kind: "travel", coast }));
    const source = markup.match(/<g id="([^"]+)" class="travel-tile-source">/u);
    assert.ok(source, "one reusable tile definition is rendered");
    const tileId = source[1];
    const instances = [...markup.matchAll(/<g data-scenery-tile="(-?\d+)" transform="translate\((-?\d+) 0\)"><use href="#([^"]+)"><\/use><\/g>/gu)];

    assert.deepEqual(instances.map((match) => [Number(match[1]), Number(match[2]), match[3]]), [
      [-900, -900, tileId],
      [0, 0, tileId],
      [900, 900, tileId],
    ]);
    assert.equal([...markup.matchAll(/class="travel-tile-source"/gu)].length, 1);
    assert.equal([...markup.matchAll(/class="travel-land-tile"/gu)].length, 1, "only one copy of the tile geometry is in the DOM");
    assert.match(markup, /class="map-scenery map-scenery--travel map-scenery--static"/u);
    assert.doesNotMatch(markup, /travel-(?:mid-layer|parallax-layer)/u);
    assert.equal(markup.includes('class="travel-coast-water"'), coast, "the reusable tile retains the selected coastline");
  }
  assert.equal(layout.TRAVEL_TILE_WIDTH, 900);
  assert.equal(layout.TRAVEL_TILE_HEIGHT, 420);
});

test("separate travel maps keep their reusable tile IDs unique and their uses linked", () => {
  const markup = renderToStaticMarkup(React.createElement("svg", {},
    React.createElement(MapScenery, { kind: "travel" }),
    React.createElement(MapScenery, { kind: "travel", coast: true }),
  ));
  const ids = [...markup.matchAll(/<g id="([^"]+)" class="travel-tile-source">/gu)].map((match) => match[1]);
  const references = [...markup.matchAll(/<use href="#([^"]+)"/gu)].map((match) => match[1]);

  assert.equal(ids.length, 2, "each map has one tile source");
  assert.notEqual(ids[0], ids[1], "different maps do not duplicate document IDs");
  assert.equal(references.length, 6, "each map has three instances");
  assert.ok(references.every((reference) => ids.includes(reference)), "every tile instance points to one of the local sources");
});

test("repeating river, road and coast edges meet with continuous tangents", () => {
  const { TRAVEL_TILE_WIDTH, TRAVEL_PERIODIC_PATHS, periodicCubicPath, periodicCurveBounds } = layout;
  const travelMarkup = renderToStaticMarkup(React.createElement(MapScenery, { kind: "travel" }));
  const coastMarkup = renderToStaticMarkup(React.createElement(MapScenery, { kind: "travel", coast: true }));

  for (const [name, curve] of Object.entries(TRAVEL_PERIODIC_PATHS)) {
    const first = curve.segments[0];
    const last = curve.segments.at(-1);
    assert.equal(curve.start[0], 0, `${name} begins at the left tile edge`);
    assert.equal(last.end[0], TRAVEL_TILE_WIDTH, `${name} ends at the right tile edge`);
    assert.equal(last.end[1], curve.start[1], `${name} meets at the same height`);

    const startDx = first.control1[0] - curve.start[0];
    const startDy = first.control1[1] - curve.start[1];
    const endDx = last.end[0] - last.control2[0];
    const endDy = last.end[1] - last.control2[1];
    assert.ok(startDx > 0 && endDx > 0, `${name} tangents point across the seam`);
    assert.ok(Math.abs(startDy * endDx - endDy * startDx) < 1e-8, `${name} has a matching seam slope`);

    const renderedPath = `d="${periodicCubicPath(curve)}"`;
    assert.ok(renderedPath.length > 20, `${name} produces path geometry`);
    assert.ok(
      (name === "coastline" ? coastMarkup : travelMarkup).includes(periodicCubicPath(curve)),
      `${name} uses the tested curve in the rendered tiles`,
    );
    const bounds = periodicCurveBounds(curve);
    assert.ok(bounds.minX >= 0 && bounds.maxX <= TRAVEL_TILE_WIDTH, `${name} does not spill sideways`);
    if (curve.zone === "north") {
      assert.ok(bounds.maxY < 183, `${name} stays above the track`);
    } else if (curve.zone === "south") {
      assert.ok(bounds.minY > 342, `${name} stays below the station strip`);
    }
  }
  const sharedStrokeRule = sceneryCss.match(/\.travel-stream-bank,[\s\S]*?\.travel-coast-edge\s*\{([^}]*)\}/u)?.[1] ?? "";
  assert.match(sharedStrokeRule, /stroke-linecap:\s*butt/u, "curved travel strokes end flush at tile boundaries");
  assert.match(sceneryCss, /\.travel-ridge-contour\s*\{[^}]*stroke-linecap:\s*butt/u);
});

test("canopy, farmyard and field bounds stay in-tile and outside track and station lanes", () => {
  const {
    TRAVEL_TILE_WIDTH,
    TRAVEL_TILE_HEIGHT,
    TRAVEL_TRACK_BAND,
    TRAVEL_STATION_BAND,
    TRAVEL_TREE_CLUSTERS,
    TRAVEL_STATION_GROUND_MARKS,
    TRAVEL_FARMSTEADS,
    TRAVEL_FIELD_ROWS,
    travelTreeBounds,
    travelFarmsteadBounds,
  } = layout;

  for (const tree of TRAVEL_TREE_CLUSTERS) {
    const bounds = travelTreeBounds(tree);
    assert.ok(bounds.minX >= 0 && bounds.maxX <= TRAVEL_TILE_WIDTH, "tree canopy and shadow stay within the tile");
    assert.ok(bounds.minY >= 0 && bounds.maxY <= TRAVEL_TILE_HEIGHT, "tree canopy stays within the tile height");
    assert.equal(intersects(bounds, TRAVEL_TRACK_BAND), false, "trees leave the rail corridor clear");
    assert.equal(intersects(bounds, TRAVEL_STATION_BAND), false, "trees leave the full station-label band clear");
  }

  for (const farmstead of TRAVEL_FARMSTEADS) {
    const bounds = travelFarmsteadBounds(farmstead);
    assert.ok(bounds.minX >= 0 && bounds.maxX <= TRAVEL_TILE_WIDTH, "house, fence and garden remain inside the tile");
    assert.equal(intersects(bounds, TRAVEL_TRACK_BAND), false);
    assert.equal(intersects(bounds, TRAVEL_STATION_BAND), false);
  }

  assert.ok(TRAVEL_FIELD_ROWS.every((y) => y > TRAVEL_STATION_BAND.bottom && y < TRAVEL_TILE_HEIGHT));
  assert.ok(TRAVEL_STATION_GROUND_MARKS.every(({ x, y }) =>
    x >= 6 && x <= TRAVEL_TILE_WIDTH - 6 && y >= TRAVEL_STATION_BAND.top + 2 && y <= TRAVEL_STATION_BAND.bottom - 2,
  ), "subtle station-strip texture stays periodic and clear of tile and lane edges");
  const markup = renderToStaticMarkup(React.createElement(MapScenery, { kind: "travel" }));
  assert.match(markup, /class="travel-station-tufts" d="M/u);
  assert.ok(TRAVEL_TRACK_BAND.bottom < TRAVEL_STATION_BAND.top, "track and station lanes keep a gap");
});

test("overview uses overhead garden details and the station footprint stays within its reserved strip", () => {
  const overview = renderToStaticMarkup(React.createElement(MapScenery, { kind: "overview" }));
  const station = renderToStaticMarkup(React.createElement(OverheadStationFootprint, { x: 450, y: 269, title: "GA", detail: "1/4" }));

  assert.match(overview, /overhead-tree-cluster/u);
  assert.match(overview, /overhead-garden/u);
  assert.match(overview, /overhead-crop-row/u);
  assert.match(overview, /overhead-fence/u);
  assert.match(station, /class="station-caption"/u);
  assert.match(station, /class="station-title"/u);
  assert.match(station, /class="station-detail"/u);
  assert.match(station, /class="station-bench"/u);
  assert.match(station, /class="station-planter"/u);
  assert.match(station, /class="station-tactile"/u);
  assert.match(station, /class="station-columns"/u);
  const stationBounds = layout.stationFootprintBounds({ x: 450, y: 269, scale: 1 });
  assert.deepEqual(stationBounds, {
    minX: 355,
    maxX: 545,
    minY: 245,
    maxY: 342,
  });
  assert.ok(stationBounds.maxX - stationBounds.minX <= 190, "station width fits the narrow corridor");
  assert.ok(stationBounds.minY >= layout.TRAVEL_STATION_BAND.top && stationBounds.maxY <= layout.TRAVEL_STATION_BAND.bottom);
});
