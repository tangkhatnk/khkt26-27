import { memo, useId } from "react";
import {
  OVERVIEW_FARMSTEADS,
  OVERVIEW_TREE_CLUSTERS,
  TRAVEL_FARMSTEADS,
  TRAVEL_FIELD_ROWS,
  TRAVEL_FLOWER_Y,
  TRAVEL_PERIODIC_PATHS,
  TRAVEL_STATION_GROUND_MARKS,
  TRAVEL_TRACK_BAND,
  TRAVEL_TILE_HEIGHT,
  TRAVEL_TILE_OFFSETS,
  TRAVEL_TILE_WIDTH,
  TRAVEL_TREE_CLUSTERS,
  periodicCubicPath,
  type PeriodicSceneryCurve,
} from "./mapSceneryGeometry";
import "./mapScenery.css";

type SceneryKind = "overview" | "travel";

const overviewRoofs = OVERVIEW_FARMSTEADS;

function TreeCanopy({ x, y, size, index }: { x: number; y: number; size: number; index: number }) {
  return (
    <g
      className={`overhead-tree-cluster overhead-tree-cluster--${index % 3}`}
      transform={`translate(${x} ${y}) scale(${size})`}
    >
      <ellipse className="overhead-tree-shadow" cx="1" cy="9" rx="39" ry="24" />
      <ellipse className="overhead-tree-canopy" cx="0" cy="2" rx="28" ry="24" />
      <circle className="overhead-tree-leaf overhead-tree-leaf--deep" cx="-21" cy="1" r="17" />
      <circle className="overhead-tree-leaf" cx="-3" cy="-8" r="18" />
      <circle className="overhead-tree-leaf overhead-tree-leaf--light" cx="17" cy="-4" r="16" />
      <circle className="overhead-tree-leaf" cx="24" cy="10" r="14" />
      <circle className="overhead-tree-leaf overhead-tree-leaf--deep" cx="2" cy="16" r="16" />
      <path className="overhead-tree-crown" d="M-22 6c5-7 9-7 14-1m5-16c4 3 6 6 7 10m8-7c4 4 5 8 4 12M-5 19c4-3 8-3 12 0" />
      <circle className="overhead-tree-fruit" cx={index % 2 ? 11 : -11} cy="6" r="2.5" />
      <circle className="overhead-tree-fruit overhead-tree-fruit--warm" cx={index % 2 ? -14 : 18} cy="15" r="2" />
    </g>
  );
}

function RoofFootprint({ x, y, color, size = 1, variant = 0 }: {
  x: number;
  y: number;
  color: string;
  size?: number;
  variant?: number;
}) {
  return (
    <g className={`overhead-roof overhead-roof--${variant % 3}`} transform={`translate(${x} ${y}) scale(${size})`}>
      <rect className="overhead-roof-base" x="-33" y="-27" width="66" height="54" rx="8" />
      <path d="M-30-23H0V23H-30Z" fill={color} />
      <path d="M0-23H30V23H0Z" fill={color} opacity=".82" />
      <path className="overhead-roof-eave" d="M-30-23H30M-30 23H30" />
      <path className="overhead-roof-ridge" d="M0-23V23" />
      <path className="overhead-roof-tiles" d="M-26-10h21M5-10h21M-26 3h21M5 3h21M-26 16h21M5 16h21" />
      <rect className="overhead-roof-skylight" x={variant % 2 ? -21 : 12} y="-18" width="9" height="10" rx="2" />
      <rect className="overhead-roof-chimney" x={variant % 2 ? 17 : -25} y="-21" width="9" height="10" rx="2" />
      {variant === 2 && <rect className="overhead-roof-solar" x="-8" y="-17" width="14" height="13" rx="2" />}
    </g>
  );
}

function CropBed({ x, y, width = 22, height = 30, variant = 0 }: {
  x: number;
  y: number;
  width?: number;
  height?: number;
  variant?: number;
}) {
  const rowLeft = x + 4;
  const rowRight = x + width - 4;
  const rowCount = variant % 2 ? 4 : 3;
  return (
    <g className="overhead-garden">
      <rect className="overhead-garden-bed" x={x} y={y} width={width} height={height} rx="4" />
      {Array.from({ length: rowCount }, (_, index) => {
        const rowY = y + 5 + index * ((height - 10) / Math.max(1, rowCount - 1));
        return <path key={`crop-${x}-${y}-${index}`} className="overhead-crop-row" d={`M${rowLeft} ${rowY}H${rowRight}`} />;
      })}
      <circle className="overhead-crop-leaf" cx={x + width * 0.35} cy={y + 8} r="1.8" />
      <circle className="overhead-crop-leaf overhead-crop-leaf--light" cx={x + width * 0.65} cy={y + height - 8} r="1.8" />
    </g>
  );
}

function Farmstead({ x, y, scale = 1, color, variant = 0 }: {
  x: number;
  y: number;
  scale?: number;
  color: string;
  variant?: number;
}) {
  const gardenX = variant % 2 ? -48 : 27;
  const shedX = variant % 2 ? 35 : -47;
  return (
    <g className={`overhead-farmstead overhead-farmstead--${variant % 3}`} transform={`translate(${x} ${y}) scale(${scale})`}>
      <rect className="overhead-yard" x="-55" y="-35" width="110" height="70" rx="12" />
      <path className="overhead-yard-path" d={`M0 19V11H${gardenX < 0 ? -18 : 18}V1`} />
      <path className="overhead-fence" d="M-54-32H-42M-30-32H54V28H10M-5 28H-54V-32Z" />
      {[-50, -38, -28, -16, -4, 8, 20, 32, 44, 52].map((post) => (
        <circle key={`fence-top-${post}`} className="overhead-fence-post" cx={post} cy="-32" r="2" />
      ))}
      {[-50, -38, -26, -14, -2, 10, 22].map((post) => (
        <circle key={`fence-bottom-${post}`} className="overhead-fence-post" cx={post} cy="28" r="2" />
      ))}
      <CropBed x={gardenX} y={-25} width={22} height={30} variant={variant} />
      <CropBed x={gardenX} y={9} width={22} height={14} variant={variant + 1} />
      <rect className="overhead-well" x={variant % 2 ? 24 : -30} y="19" width="8" height="7" rx="2" />
      <RoofFootprint x={0} y={-5} color={color} size={0.78} variant={variant} />
      <RoofFootprint x={shedX} y={22} color={variant % 2 ? "#9eac79" : "#bd8d63"} size={0.28} variant={(variant + 1) % 3} />
      <path className="overhead-yard-flowers" d="M-42-23h3m2 5h3m-5 8h3" />
    </g>
  );
}

function OverviewTerrain() {
  return (
    <g className="map-overview-terrain" aria-hidden="true">
      <path className="overhead-field-patch overhead-field-patch--sage" d="M24 337C44 298 90 270 143 278c44 6 69 33 113 31 36-2 64-21 97-10 33 12 39 41 17 69-24 29-90 37-143 28-48-8-77-1-116 17-48 21-91 6-94-24-2-17 0-35 7-52Z" />
      <path className="overhead-ridge-contour" d="M49 339c17-31 54-50 95-48 45 2 64 26 107 28 34 1 60-13 82-4 22 9 24 25 8 41-20 19-72 24-116 17-53-9-82 5-120 17-34 11-61 5-66-12-4-12 2-26 10-39Z" />
      <path className="overhead-ridge-contour" d="M78 341c18-18 39-29 68-28 39 1 61 22 98 25 29 2 47-7 64 0 12 5 13 14 4 21-18 14-52 15-84 10-48-7-78 8-112 16-24 5-40 0-42-10-1-11 0-22 4-34Z" />
      <path className="overhead-field-patch overhead-field-patch--mint" d="M710 518c15-35 46-62 84-68 44-8 71 13 110 8 40-5 74-23 112-4 30 15 34 44 8 68-29 26-82 37-130 28-57-10-92 14-136 26-47 13-85-11-53-58Z" />
      <path className="overhead-ridge-contour" d="M751 510c20-27 48-40 84-40 43 1 63 19 105 19 33 1 62-11 85-3 16 5 19 17 9 30-14 18-49 28-83 24-48-5-82 9-117 23-38 15-77 8-88-12-8-13-3-28 5-41Z" />
      <path className="overhead-field-patch overhead-field-patch--gold" d="M8 44c42-25 92-34 137-18 46 16 73 13 117-6 31-13 70-11 85 10 14 18-1 40-27 50-45 18-83 0-129 16-54 19-93 37-147 19C-7 97-28 64 8 44Z" />
      <path className="overhead-road-bed" d="M-20 271C97 250 174 262 256 292s168 37 249 18 166-31 265-6 225 23 351-22" />
      <path className="overhead-road-center" d="M-20 271C97 250 174 262 256 292s168 37 249 18 166-31 265-6 225 23 351-22" />
      <path className="overhead-road-inlay" d="M-20 271C97 250 174 262 256 292s168 37 249 18 166-31 265-6 225 23 351-22" />
    </g>
  );
}

function periodicPath(curve: PeriodicSceneryCurve) {
  return periodicCubicPath(curve);
}

function TravelTile({ coast }: { coast: boolean }) {
  const stream = periodicPath(TRAVEL_PERIODIC_PATHS.stream);
  const road = periodicPath(TRAVEL_PERIODIC_PATHS.road);
  const ridge = periodicPath(TRAVEL_PERIODIC_PATHS.ridge);
  const upperField = periodicPath(TRAVEL_PERIODIC_PATHS.upperField);
  const lowerField = periodicPath(TRAVEL_PERIODIC_PATHS.lowerField);
  const coastline = periodicPath(TRAVEL_PERIODIC_PATHS.coastline);
  const stationGround = TRAVEL_STATION_GROUND_MARKS.map(({ x, y }) =>
    `M${x - 4} ${y + 2}q2-4 5-3m-3 3q-2-4-4-2`,
  ).join("");
  const southLand = coast
    ? `${lowerField} L900 368 L900 420 H0 Z`
    : `${lowerField} L900 ${TRAVEL_TILE_HEIGHT} H0 Z`;
  const treeClusters = TRAVEL_TREE_CLUSTERS.filter((tree) => !coast || tree.y < 342);

  return (
    <g className="travel-land-tile" aria-hidden="true">
      <rect width={TRAVEL_TILE_WIDTH} height={TRAVEL_TILE_HEIGHT} className="travel-meadow" />
      <path className="travel-north-meadow" d={`${upperField} L900 ${TRAVEL_TRACK_BAND.top - 1} H0 Z`} />
      <path className="travel-south-meadow" d={southLand} />
      <path className="travel-station-tufts" d={stationGround} />
      {coast && <path className="travel-coast-beach" d={`${lowerField} L900 390 H0 Z`} />}
      {coast && <path className="travel-coast-water" d={`${coastline} L900 ${TRAVEL_TILE_HEIGHT} H0 Z`} />}
      {coast && <path className="travel-coast-edge" d={coastline} />}
      <path className="travel-ridge-contour" d={ridge} />
      {!coast && TRAVEL_FIELD_ROWS.map((row) => (
        <path key={`field-row-${row}`} className="travel-field-row" d={`M0 ${row}H${TRAVEL_TILE_WIDTH}`} />
      ))}
      <path className="travel-stream-bank" d={stream} />
      <path className="travel-stream-water" d={stream} />
      <path className="travel-stream-highlight" d={stream} />
      <g className="travel-stream-shimmer">
        <path d="M80 38q12-5 23 0m68 7q10-4 19 0m346-8q12-5 23 0m68 7q10-4 19 0m161-8q12-5 23 0" />
        <circle cx="302" cy="56" r="2.4" />
        <circle cx="586" cy="34" r="2" />
        <circle cx="824" cy="53" r="2.5" />
      </g>
      <path className="travel-road-bed" d={road} />
      <path className="travel-road-surface" d={road} />
      <path className="travel-road-inlay" d={road} />
      <path className="travel-road-shoulder" d={road} />
      <g className="travel-road-stones">
        {[44, 246, 495, 720, 842].map((x) => <circle key={`stone-${x}`} cx={x} cy={x % 2 ? 141 : 167} r="2.2" />)}
      </g>
      <g className="travel-field-flowers">
        {Array.from({ length: 23 }, (_, index) => (
          <g key={`flower-${index}`} transform={`translate(${22 + index * 39} ${TRAVEL_FLOWER_Y + (index % 3) * 1})`}>
            <circle className="flower flower--halo" r="4.4" />
            <circle className={index % 3 ? "flower" : "flower flower--rose"} cy="-1" r="2.1" />
          </g>
        ))}
      </g>
      <g className="travel-orchard">
        {treeClusters.map((tree, index) => (
          <TreeCanopy key={`travel-tree-${tree.x}`} x={tree.x} y={tree.y} size={tree.scale} index={tree.variant + index} />
        ))}
      </g>
      <g className="travel-settlement">
        {TRAVEL_FARMSTEADS.map((home) => (
          <Farmstead key={`travel-farm-${home.x}`} x={home.x} y={home.y} scale={home.scale} color={home.roofColor} variant={home.variant} />
        ))}
      </g>
      {coast && <g className="travel-coast-shells">
        {[[88, 389], [266, 399], [514, 390], [788, 401]].map(([x, y], index) => (
          <path key={`shell-${index}`} d={`M${x} ${y}q5-6 10 0`} />
        ))}
      </g>}
    </g>
  );
}

export const MapScenery = memo(function MapScenery({ kind, coast = false }: { kind: SceneryKind; coast?: boolean }) {
  // Encode React's opaque token losslessly so every SVG fragment ID stays unique.
  const tileId = `travel-tile-${useId().split("").map((character) => character.charCodeAt(0).toString(16).padStart(4, "0")).join("")}`;
  if (kind === "travel") {
    return (
      <g className="map-scenery map-scenery--travel map-scenery--static" aria-hidden="true">
        <defs>
          <g id={tileId} className="travel-tile-source">
            <TravelTile coast={coast} />
          </g>
        </defs>
        {TRAVEL_TILE_OFFSETS.map((offset) => (
          <g key={offset} data-scenery-tile={offset} transform={`translate(${offset} 0)`}>
            <use href={`#${tileId}`} />
          </g>
        ))}
      </g>
    );
  }

  const farmsteads = coast
    ? [...overviewRoofs.slice(0, 4), { x: 850, y: 255, color: "#d57064", scale: 0.82, variant: 2 }]
    : overviewRoofs;

  return (
    <g className="map-scenery map-scenery--overview" aria-hidden="true">
      <OverviewTerrain />
      <g className="overhead-woodland">
        {OVERVIEW_TREE_CLUSTERS.map(([x, y, size], index) => (
          <TreeCanopy key={`overview-tree-${x}-${y}`} x={x} y={y} size={size} index={index} />
        ))}
      </g>
      <g className="overhead-settlement">
        {farmsteads.map(({ x, y, color, scale, variant }) => (
          <Farmstead key={`overview-farm-${x}`} x={x} y={y} color={color} scale={scale} variant={variant} />
        ))}
      </g>
      <g className="overview-flower-meadow">
        {Array.from({ length: 25 }, (_, index) => (
          <circle
            key={index}
            cx={54 + index * 39}
            cy={584 + (index % 3) * 14}
            r="4"
            className={index % 2 ? "flower flower--rose" : "flower"}
          />
        ))}
      </g>
    </g>
  );
});

export function OverheadStationFootprint({
  x = 0,
  y = 0,
  scale = 1,
  roofColor = "#d8875e",
  title,
  detail,
}: {
  x?: number;
  y?: number;
  scale?: number;
  roofColor?: string;
  title?: string;
  detail?: string;
}) {
  return (
    <g className="overhead-station-footprint" transform={`translate(${x} ${y}) scale(${scale})`}>
      <rect className="station-platform" x="-88" y="-5" width="176" height="40" rx="10" />
      <rect className="station-platform-inset" x="-82" y="-1" width="164" height="30" rx="7" />
      <path className="station-platform-edge" d="M-78 2H78M-78 25H78" />
      <path className="station-tactile" d="M-76 19h8m4 0h8m4 0h8m4 0h8m4 0h8m4 0h8m4 0h8m4 0h8m4 0h8m4 0h8m4 0h8m4 0h8" />
      <rect className="station-roof-base" x="-53" y="-22" width="106" height="31" rx="8" />
      <rect className="station-roof" x="-48" y="-18" width="96" height="23" rx="6" fill={roofColor} />
      <path className="station-roof-shade" d="M-45-16H0V2H-45Z" />
      <path className="station-roof-seam" d="M0-16v18M-43-5h86" />
      <path className="station-roof-tiles" d="M-40-10h31m18 0h31M-39 0h29m20 0h29" />
      <path className="station-columns" d="M-42 4v12m84-12v12" />
      <rect className="station-bench" x="-67" y="5" width="25" height="7" rx="2" />
      <path className="station-bench-legs" d="M-63 12v4m17-4v4" />
      <rect className="station-bench" x="42" y="5" width="25" height="7" rx="2" />
      <path className="station-bench-legs" d="M46 12v4m17-4v4" />
      <rect className="station-planter" x="-80" y="8" width="12" height="11" rx="3" />
      <path className="station-planter-leaves" d="M-74 8v-4m0 4-3-3m3 3 3-4" />
      <rect className="station-planter" x="68" y="8" width="12" height="11" rx="3" />
      <path className="station-planter-leaves" d="M74 8V4m0 4-3-3m3 3 3-4" />
      <path className="station-lamp-post" d="M-27 5v14m54-14v14" />
      <circle className="station-lamp" cx="-27" cy="4" r="4" />
      <circle className="station-lamp" cx="27" cy="4" r="4" />
      {(title || detail) && <rect className="station-caption" x="-64" y="36" width="128" height={detail ? 34 : 24} rx="9" />}
      {title && <text className="station-title" x="0" y="50" textAnchor="middle">{title}</text>}
      {detail && <text className="station-detail" x="0" y="62" textAnchor="middle">{detail}</text>}
    </g>
  );
}
