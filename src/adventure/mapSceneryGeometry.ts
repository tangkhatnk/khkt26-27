export type SceneryPoint = readonly [number, number];

export type SceneryCubic = {
  control1: SceneryPoint;
  control2: SceneryPoint;
  end: SceneryPoint;
};

export type PeriodicSceneryCurve = {
  start: SceneryPoint;
  segments: readonly SceneryCubic[];
  strokeWidth: number;
  zone: "north" | "south";
};

export type SceneryBounds = { minX: number; maxX: number; minY: number; maxY: number };

const cubic = (
  control1: SceneryPoint,
  control2: SceneryPoint,
  end: SceneryPoint,
): SceneryCubic => ({ control1, control2, end });

export const TRAVEL_TILE_WIDTH = 900;
export const TRAVEL_TILE_HEIGHT = 420;
export const TRAVEL_TILE_OFFSETS = [-TRAVEL_TILE_WIDTH, 0, TRAVEL_TILE_WIDTH] as const;
export const TRAVEL_TRACK_BAND = { top: 183, bottom: 237 } as const;
export const TRAVEL_STATION_BAND = { top: 244, bottom: 342 } as const;

export const TRAVEL_PERIODIC_PATHS: Record<string, PeriodicSceneryCurve> = {
  stream: {
    start: [0, 44],
    segments: [
      cubic([28.125, 44], [56.25, 28], [112.5, 28]),
      cubic([140.625, 28], [168.75, 44], [225, 44]),
      cubic([253.125, 44], [281.25, 60], [337.5, 60]),
      cubic([365.625, 60], [393.75, 44], [450, 44]),
      cubic([478.125, 44], [506.25, 28], [562.5, 28]),
      cubic([590.625, 28], [618.75, 44], [675, 44]),
      cubic([703.125, 44], [731.25, 60], [787.5, 60]),
      cubic([815.625, 60], [843.75, 44], [900, 44]),
    ],
    strokeWidth: 34,
    zone: "north",
  },
  road: {
    start: [0, 154],
    segments: [
      cubic([28.125, 154], [56.25, 145], [112.5, 145]),
      cubic([140.625, 145], [168.75, 154], [225, 154]),
      cubic([253.125, 154], [281.25, 164], [337.5, 164]),
      cubic([365.625, 164], [393.75, 154], [450, 154]),
      cubic([478.125, 154], [506.25, 145], [562.5, 145]),
      cubic([590.625, 145], [618.75, 154], [675, 154]),
      cubic([703.125, 154], [731.25, 164], [787.5, 164]),
      cubic([815.625, 164], [843.75, 154], [900, 154]),
    ],
    strokeWidth: 18,
    zone: "north",
  },
  ridge: {
    start: [0, 102],
    segments: [
      cubic([28.125, 102], [56.25, 91], [112.5, 91]),
      cubic([140.625, 91], [168.75, 102], [225, 102]),
      cubic([253.125, 102], [281.25, 112], [337.5, 112]),
      cubic([365.625, 112], [393.75, 102], [450, 102]),
      cubic([478.125, 102], [506.25, 91], [562.5, 91]),
      cubic([590.625, 91], [618.75, 102], [675, 102]),
      cubic([703.125, 102], [731.25, 112], [787.5, 112]),
      cubic([815.625, 112], [843.75, 102], [900, 102]),
    ],
    strokeWidth: 3,
    zone: "north",
  },
  upperField: {
    start: [0, 174],
    segments: [
      cubic([28.125, 174], [56.25, 168], [112.5, 168]),
      cubic([140.625, 168], [168.75, 174], [225, 174]),
      cubic([253.125, 174], [281.25, 180], [337.5, 180]),
      cubic([365.625, 180], [393.75, 174], [450, 174]),
      cubic([478.125, 174], [506.25, 168], [562.5, 168]),
      cubic([590.625, 168], [618.75, 174], [675, 174]),
      cubic([703.125, 174], [731.25, 180], [787.5, 180]),
      cubic([815.625, 180], [843.75, 174], [900, 174]),
    ],
    strokeWidth: 0,
    zone: "north",
  },
  lowerField: {
    start: [0, 354],
    segments: [
      cubic([28.125, 354], [56.25, 350], [112.5, 350]),
      cubic([140.625, 350], [168.75, 354], [225, 354]),
      cubic([253.125, 354], [281.25, 360], [337.5, 360]),
      cubic([365.625, 360], [393.75, 354], [450, 354]),
      cubic([478.125, 354], [506.25, 350], [562.5, 350]),
      cubic([590.625, 350], [618.75, 354], [675, 354]),
      cubic([703.125, 354], [731.25, 360], [787.5, 360]),
      cubic([815.625, 360], [843.75, 354], [900, 354]),
    ],
    strokeWidth: 0,
    zone: "south",
  },
  coastline: {
    start: [0, 368],
    segments: [
      cubic([28.125, 368], [56.25, 361], [112.5, 361]),
      cubic([140.625, 361], [168.75, 368], [225, 368]),
      cubic([253.125, 368], [281.25, 375], [337.5, 375]),
      cubic([365.625, 375], [393.75, 368], [450, 368]),
      cubic([478.125, 368], [506.25, 361], [562.5, 361]),
      cubic([590.625, 361], [618.75, 368], [675, 368]),
      cubic([703.125, 368], [731.25, 375], [787.5, 375]),
      cubic([815.625, 375], [843.75, 368], [900, 368]),
    ],
    strokeWidth: 5,
    zone: "south",
  },
};

export function periodicCubicPath(curve: PeriodicSceneryCurve): string {
  const point = ([x, y]: SceneryPoint) => `${x} ${y}`;
  return `M${point(curve.start)}${curve.segments.map((segment) =>
    ` C${point(segment.control1)} ${point(segment.control2)} ${point(segment.end)}`,
  ).join("")}`;
}

export function periodicCurveBounds(curve: PeriodicSceneryCurve, strokeWidth = curve.strokeWidth): SceneryBounds {
  const points = [curve.start, ...curve.segments.flatMap((segment) => [segment.control1, segment.control2, segment.end])];
  const radius = Math.max(0, strokeWidth) / 2;
  return {
    // Periodic paths use butt caps and their control points stay in the tile,
    // so stroke width does not extend the left or right seam.
    minX: 0,
    maxX: TRAVEL_TILE_WIDTH,
    minY: Math.min(...points.map((point) => point[1])) - radius,
    maxY: Math.max(...points.map((point) => point[1])) + radius,
  };
}

export const TRAVEL_TREE_EXTENT = { x: 42, y: 36 } as const;
export const TRAVEL_TREE_CLUSTERS = [
  { x: 68, y: 110, scale: 0.48, variant: 0 },
  { x: 316, y: 112, scale: 0.52, variant: 1 },
  { x: 620, y: 110, scale: 0.48, variant: 0 },
  { x: 872, y: 110, scale: 0.48, variant: 2 },
  { x: 40, y: 386, scale: 0.54, variant: 1 },
  { x: 222, y: 389, scale: 0.68, variant: 2 },
  { x: 484, y: 390, scale: 0.61, variant: 0 },
  { x: 704, y: 390, scale: 0.64, variant: 1 },
  { x: 858, y: 386, scale: 0.52, variant: 2 },
] as const;

export const TRAVEL_STATION_GROUND_MARKS = [256, 289, 322].flatMap((y) =>
  Array.from({ length: 25 }, (_, index) => ({ x: 18 + index * 36, y })),
);

export function travelTreeBounds(tree: (typeof TRAVEL_TREE_CLUSTERS)[number]): SceneryBounds {
  return {
    minX: tree.x - TRAVEL_TREE_EXTENT.x * tree.scale,
    maxX: tree.x + TRAVEL_TREE_EXTENT.x * tree.scale,
    minY: tree.y - TRAVEL_TREE_EXTENT.y * tree.scale,
    maxY: tree.y + TRAVEL_TREE_EXTENT.y * tree.scale,
  };
}

export const TRAVEL_FARMSTEAD_EXTENT = { x: 61, y: 42 } as const;
export const TRAVEL_FARMSTEADS = [
  { x: 136, y: 103, scale: 0.65, variant: 0, roofColor: "#c7795d" },
  { x: 463, y: 101, scale: 0.68, variant: 1, roofColor: "#d2a14f" },
  { x: 748, y: 104, scale: 0.64, variant: 2, roofColor: "#8194ad" },
] as const;

export function travelFarmsteadBounds(farmstead: (typeof TRAVEL_FARMSTEADS)[number]): SceneryBounds {
  return {
    minX: farmstead.x - TRAVEL_FARMSTEAD_EXTENT.x * farmstead.scale,
    maxX: farmstead.x + TRAVEL_FARMSTEAD_EXTENT.x * farmstead.scale,
    minY: farmstead.y - TRAVEL_FARMSTEAD_EXTENT.y * farmstead.scale,
    maxY: farmstead.y + TRAVEL_FARMSTEAD_EXTENT.y * farmstead.scale,
  };
}

export const TRAVEL_FIELD_ROWS = [365, 376, 387, 398, 409] as const;
export const TRAVEL_FLOWER_Y = 177;

export const OVERVIEW_TREE_CLUSTERS = [
  [115, 140, 1], [170, 165, 0.88], [140, 220, 0.95], [220, 95, 0.82],
  [520, 75, 0.82], [570, 92, 0.72], [630, 62, 0.86], [685, 85, 0.75], [725, 105, 0.72],
  [410, 215, 0.82], [455, 230, 0.76], [590, 220, 0.78], [665, 265, 0.9], [720, 365, 0.85],
  [740, 580, 0.85], [665, 600, 0.9], [195, 410, 0.92], [245, 385, 0.78], [130, 560, 0.82],
  [565, 505, 0.72], [875, 544, 0.75], [835, 116, 0.68], [57, 198, 0.75], [770, 220, 0.68],
  [42, 84, 0.56], [330, 96, 0.72], [354, 214, 0.66], [780, 485, 0.76], [986, 165, 0.65],
  [316, 550, 0.7], [478, 555, 0.67], [940, 584, 0.76], [1034, 502, 0.62], [90, 310, 0.62],
] as const;

export const OVERVIEW_FARMSTEADS = [
  { x: 220, y: 455, color: "#d4885c", scale: 1, variant: 0 },
  { x: 870, y: 363, color: "#dfac5a", scale: 0.92, variant: 1 },
  { x: 790, y: 65, color: "#8d9cba", scale: 0.86, variant: 2 },
  { x: 320, y: 145, color: "#77a786", scale: 0.88, variant: 1 },
  { x: 1016, y: 265, color: "#d57064", scale: 0.82, variant: 2 },
] as const;

export function stationFootprintBounds({ x, y, scale = 1 }: { x: number; y: number; scale?: number }): SceneryBounds {
  return {
    minX: x - 95 * scale,
    maxX: x + 95 * scale,
    minY: y - 24 * scale,
    maxY: y + 73 * scale,
  };
}
