export type StudyGuideIllustrationSection = "theory" | "examples";

export type StudyGuideSequenceIllustration = {
  kind: "sequence";
  afterSection: StudyGuideIllustrationSection;
  title: string;
  description: string;
  steps: { label: string; detail?: string }[];
};

export type StudyGuideCoordinatePlotIllustration = {
  kind: "coordinate-plot";
  afterSection: StudyGuideIllustrationSection;
  title: string;
  description: string;
  xAxis: { label: string; min: number; max: number };
  yAxis: { label: string; min: number; max: number };
  series: { label: string; points: [number, number][] }[];
  markers?: { x: number; y: number; label: string }[];
};

export type StudyGuideIllustration = StudyGuideSequenceIllustration | StudyGuideCoordinatePlotIllustration;

const MAX_ILLUSTRATIONS = 3;
const MAX_TOTAL_POINTS = 192;
const MAX_ILLUSTRATION_BYTES = 16 * 1024;
const MAX_COORDINATE = 1_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  const keys = Object.keys(value);
  return required.every(key => Object.hasOwn(value, key)) &&
    keys.every(key => required.includes(key) || optional.includes(key));
}

function isBoundedText(value: unknown, max: number, min = 1): value is string {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max;
}

function isCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -MAX_COORDINATE && value <= MAX_COORDINATE;
}

function isAxis(value: unknown): value is { label: string; min: number; max: number } {
  return isRecord(value) && hasOnlyKeys(value, ["label", "min", "max"]) &&
    isBoundedText(value.label, 80) && isCoordinate(value.min) && isCoordinate(value.max) && value.min < value.max;
}

function isSequence(value: Record<string, unknown>): value is StudyGuideSequenceIllustration {
  return value.kind === "sequence" && hasOnlyKeys(value, ["kind", "afterSection", "title", "description", "steps"]) &&
    (value.afterSection === "theory" || value.afterSection === "examples") &&
    isBoundedText(value.title, 120) && isBoundedText(value.description, 240) &&
    Array.isArray(value.steps) && value.steps.length >= 2 && value.steps.length <= 8 &&
    value.steps.every(step => isRecord(step) && hasOnlyKeys(step, ["label"], ["detail"]) &&
      isBoundedText(step.label, 80) && (step.detail === undefined || isBoundedText(step.detail, 240, 0)));
}

function isCoordinatePlot(value: Record<string, unknown>): value is StudyGuideCoordinatePlotIllustration {
  if (value.kind !== "coordinate-plot" || !hasOnlyKeys(value,
    ["kind", "afterSection", "title", "description", "xAxis", "yAxis", "series"], ["markers"]) ||
    (value.afterSection !== "theory" && value.afterSection !== "examples") ||
    !isBoundedText(value.title, 120) || !isBoundedText(value.description, 240) ||
    !isAxis(value.xAxis) || !isAxis(value.yAxis) || !Array.isArray(value.series) ||
    value.series.length < 1 || value.series.length > 3 ||
    (value.markers !== undefined && (!Array.isArray(value.markers) || value.markers.length > 8))) return false;

  for (const series of value.series) {
    if (!isRecord(series) || !hasOnlyKeys(series, ["label", "points"]) || !isBoundedText(series.label, 80) ||
        !Array.isArray(series.points) || series.points.length < 2 || series.points.length > 96) return false;
    for (const point of series.points) {
      if (!Array.isArray(point) || point.length !== 2 || !isCoordinate(point[0]) || !isCoordinate(point[1]) ||
          point[0] < value.xAxis.min || point[0] > value.xAxis.max ||
          point[1] < value.yAxis.min || point[1] > value.yAxis.max) return false;
    }
  }

  for (const marker of value.markers ?? []) {
    if (!isRecord(marker) || !hasOnlyKeys(marker, ["x", "y", "label"]) ||
        !isCoordinate(marker.x) || !isCoordinate(marker.y) || !isBoundedText(marker.label, 80) ||
        marker.x < value.xAxis.min || marker.x > value.xAxis.max ||
        marker.y < value.yAxis.min || marker.y > value.yAxis.max) return false;
  }
  return true;
}

function isIllustration(value: unknown): value is StudyGuideIllustration {
  if (!isRecord(value)) return false;
  return isSequence(value) || isCoordinatePlot(value);
}

/** Validate untrusted persisted/provider data before it is rendered by app-owned primitives. */
export function isValidStudyGuideIllustrations(value: unknown): value is StudyGuideIllustration[] {
  if (!Array.isArray(value) || value.length > MAX_ILLUSTRATIONS || !value.every(isIllustration)) return false;
  const pointCount = value.reduce((total, illustration) => total + (illustration.kind === "coordinate-plot"
    ? illustration.series.reduce((seriesTotal, series) => seriesTotal + series.points.length, 0)
    : 0), 0);
  if (pointCount > MAX_TOTAL_POINTS) return false;
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length <= MAX_ILLUSTRATION_BYTES;
  } catch {
    return false;
  }
}
