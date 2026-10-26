export const SCENE_ENGINE_CENTER_X = 450;
export const SCENE_REST_STATION_X = SCENE_ENGINE_CENTER_X;
export const SCENE_ARRIVAL_STATION_X = SCENE_ENGINE_CENTER_X;
export const SCENE_TRAIN_ARRIVAL_X = SCENE_ENGINE_CENTER_X;
export const SCENE_WORLD_TILE_WIDTH = 900;
export const SCENE_WORLD_LAYER_VIEWPORTS = 3;
export const SCENE_BASE_WORLD_SPEED = 50 / 3;
export const SCENE_MIN_STATION_SPACING = 220;
export const SCENE_MAX_INTERPOLATION_GAP_SECONDS = 2;
const SCENE_TRAIN_CARRIAGE_STEP = 64;

/** Keep the engine centered while the surrounding world moves past it. */
export function sceneTrainLayout(engineX: number) {
  return {
    travelX: engineX,
    travelShift: 0,
    restShift: 0,
    arrivalShift: SCENE_ENGINE_CENTER_X - engineX,
  };
}

/** The car shadow is the furthest-left rendered extent for each carriage. */
export function sceneTrainLeftExtent(carriageCount: number): number {
  return carriageCount > 0 ? carriageCount * SCENE_TRAIN_CARRIAGE_STEP + 34 : 41;
}

/** Compress the train around its engine only enough to fit its current viewBox. */
export function sceneTrainScale(
  carriageCount: number,
  engineWorldX: number,
  viewBoxLeft: number,
): number {
  const availableLeft = engineWorldX - viewBoxLeft;
  return Math.max(0, Math.min(1, availableLeft / sceneTrainLeftExtent(carriageCount)));
}

export function sceneViewBoxForZoom(zoom: number, terminal = false): string {
  const width = 900 / zoom;
  const height = 420 / zoom;
  const centerX = terminal ? SCENE_ARRIVAL_STATION_X : SCENE_ENGINE_CENTER_X;
  const left = centerX - width / 2;
  return `${left} ${210 - height / 2} ${width} ${height}`;
}

/**
 * Use one global speed for the whole trip, with enough space between station
 * centers for their captions even when a legacy or unusually dense schedule
 * has short study stages.
 */
export function sceneWorldSpeedForSchedule(
  targetStudySeconds: number,
  restAnchorStudySeconds: number[],
): number {
  const target = Number.isFinite(targetStudySeconds) && targetStudySeconds > 0
    ? targetStudySeconds
    : 0;
  const points = [
    0,
    ...restAnchorStudySeconds.filter((value) => Number.isFinite(value) && value > 0 && value < target),
    target,
  ].sort((a, b) => a - b);
  let minimumGap = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    const gap = points[index] - points[index - 1];
    if (gap > 0) minimumGap = Math.min(minimumGap, gap);
  }
  return Number.isFinite(minimumGap)
    ? Math.max(SCENE_BASE_WORLD_SPEED, SCENE_MIN_STATION_SPACING / minimumGap)
    : SCENE_BASE_WORLD_SPEED;
}

export function sceneWorldDistance(elapsedStudySeconds: number, speed = SCENE_BASE_WORLD_SPEED): number {
  const elapsed = Number.isFinite(elapsedStudySeconds) ? Math.max(0, elapsedStudySeconds) : 0;
  const safeSpeed = Number.isFinite(speed) ? Math.max(0, speed) : SCENE_BASE_WORLD_SPEED;
  return elapsed * safeSpeed;
}

/** Shared camera translation plus a static-tile origin for the repeating land. */
export function sceneMotionForStudyElapsed(
  elapsedStudySeconds: number,
  speed = SCENE_BASE_WORLD_SPEED,
) {
  const distance = sceneWorldDistance(elapsedStudySeconds, speed);
  const periodicOrigin = Math.floor(distance / SCENE_WORLD_TILE_WIDTH) * SCENE_WORLD_TILE_WIDTH;
  return {
    distance,
    cameraOffset: -distance,
    periodicOrigin,
    periodicOffset: periodicOrigin - distance,
  };
}

/** Fixed world coordinate for a station scheduled at a study-time anchor. */
export function sceneStationWorldX(anchorStudySeconds: number, speed = SCENE_BASE_WORLD_SPEED): number {
  return SCENE_ENGINE_CENTER_X + sceneWorldDistance(anchorStudySeconds, speed);
}

/** Current screen coordinate after applying the same world camera as terrain. */
export function sceneStationScreenX(
  anchorStudySeconds: number,
  elapsedStudySeconds: number,
  speed = SCENE_BASE_WORLD_SPEED,
): number {
  return sceneStationWorldX(anchorStudySeconds, speed) - sceneWorldDistance(elapsedStudySeconds, speed);
}

/** Do not animate an initial mount or the first update after motion resumes. */
export function sceneMotionCanInterpolate(
  currentlyAllowed: boolean,
  previouslyAllowed: boolean,
  currentStudyElapsedSeconds?: number,
  previousStudyElapsedSeconds?: number,
): boolean {
  if (!currentlyAllowed || !previouslyAllowed) return false;
  if (currentStudyElapsedSeconds === undefined || previousStudyElapsedSeconds === undefined) return true;
  const delta = currentStudyElapsedSeconds - previousStudyElapsedSeconds;
  return delta >= 0 && delta <= SCENE_MAX_INTERPOLATION_GAP_SECONDS;
}

/** Match the CSS camera transition to the elapsed sample interval. */
export function sceneMotionInterpolationDurationMs(
  currentStudyElapsedSeconds: number,
  previousStudyElapsedSeconds: number,
): number {
  const delta = currentStudyElapsedSeconds - previousStudyElapsedSeconds;
  return Number.isFinite(delta) && delta > 0 ? delta * 1000 : 0;
}

/** Return the current offset of the linear CSS sample at a monotonic timestamp. */
export function sceneMotionInterpolatedOffset(
  animation: {
    active: boolean;
    fromOffset: number;
    toOffset: number;
    durationMs: number;
    startedAt: number | null;
  },
  now: number,
): number {
  if (!animation.active || animation.startedAt === null || animation.durationMs <= 0) return animation.toOffset;
  const elapsedMs = Number.isFinite(now) ? now - animation.startedAt : animation.durationMs;
  const progress = Math.max(0, Math.min(1, elapsedMs / animation.durationMs));
  return animation.fromOffset + (animation.toOffset - animation.fromOffset) * progress;
}

/** Re-express a rendered world offset after periodic scenery advances to another tile. */
export function sceneMotionRebaseOffset(
  offset: number,
  previousPeriodicOrigin: number,
  currentPeriodicOrigin: number,
): number {
  return offset + currentPeriodicOrigin - previousPeriodicOrigin;
}

/** Keep a single sampled camera step shorter than one periodic world tile. */
export function sceneMotionDistanceGapCanInterpolate(previousDistance: number, currentDistance: number): boolean {
  const delta = currentDistance - previousDistance;
  return Number.isFinite(delta) && delta >= 0 && delta < SCENE_WORLD_TILE_WIDTH;
}

/**
 * Express both interpolation endpoints in the current periodic world's frame.
 * At a tile wrap this keeps the old screen position while stations are rebased.
 */
export function sceneMotionInterpolationOffsets(
  previousDistance: number,
  currentDistance: number,
  currentPeriodicOrigin: number,
) {
  return {
    fromOffset: currentPeriodicOrigin - previousDistance,
    toOffset: currentPeriodicOrigin - currentDistance,
  };
}

/** Convert a world-unit camera offset to a percentage of the viewport-sized compositor layer. */
export function sceneWorldLayerOffsetPercent(cameraOffset: number, viewportWorldWidth: number): number {
  if (!Number.isFinite(cameraOffset) || !Number.isFinite(viewportWorldWidth) || viewportWorldWidth <= 0) return 0;
  return cameraOffset / viewportWorldWidth * 100;
}
