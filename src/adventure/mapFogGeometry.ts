/** Triples the original 42px half-width reveal corridor around the traveled route. */
export const MAP_FOG_ROUTE_CLEARANCE_WIDTH = 84 * 3;
/** A bounded vector profile fades the mask edge beyond the crisp route corridor. */
export const MAP_FOG_ROUTE_EDGE_FEATHER_RADIUS = 72;
/** The collar only needs to cover the near-core overlap with future-route guards. */
export const MAP_FOG_ROUTE_CLEARANCE_COLLAR_FEATHER_RADIUS = 36;
/** The route underlay reaches its bounded outer profile radius. */
export const MAP_FOG_ROUTE_UNDERLAY_WIDTH =
  MAP_FOG_ROUTE_CLEARANCE_WIDTH + MAP_FOG_ROUTE_EDGE_FEATHER_RADIUS * 2;
/** Softly re-clear guards near the traveled core before its crisp boundary is applied. */
export const MAP_FOG_ROUTE_CLEARANCE_COLLAR_WIDTH =
  MAP_FOG_ROUTE_CLEARANCE_WIDTH + MAP_FOG_ROUTE_CLEARANCE_COLLAR_FEATHER_RADIUS * 2;
/** Offset the suffix dash so its round cap overlaps the traveled edge profile. */
export const MAP_FOG_ROUTE_GUARD_LEAD =
  MAP_FOG_ROUTE_CLEARANCE_WIDTH + MAP_FOG_ROUTE_CLEARANCE_COLLAR_FEATHER_RADIUS;
export const MAP_FOG_STATION_GUARD_RADIUS = 125;

export type MapFogProfileLayer = Readonly<{ radius: number; opacity: number }>;

/**
 * Build a static, densely graduated set of nested vector shapes. Each inner
 * layer adds only the opacity needed to reach a smoothstep coverage target,
 * avoiding per-shape full-map Gaussian filters while keeping a near-black core.
 */
export function mapFogRadialProfile(innerRadius: number, outerRadius: number): MapFogProfileLayer[] {
  if (!Number.isFinite(innerRadius) || !Number.isFinite(outerRadius) || outerRadius <= innerRadius) {
    return [];
  }

  const layers: MapFogProfileLayer[] = [];
  const step = 2;
  let previousCoverage = 0;
  const append = (radius: number) => {
    const progress = Math.min(1, Math.max(0, (outerRadius - radius) / (outerRadius - innerRadius)));
    const smooth = progress * progress * (3 - 2 * progress);
    const coverage = 0.001 + 0.999 * smooth;
    const opacity = (coverage - previousCoverage) / (1 - previousCoverage);
    layers.push({ radius, opacity: Math.min(1, Math.max(0, opacity)) });
    previousCoverage = coverage;
  };

  append(outerRadius);
  for (let radius = outerRadius - step; radius > innerRadius; radius -= step) {
    append(radius);
  }
  append(innerRadius);
  return layers;
}

const ROUTE_CORE_RADIUS = MAP_FOG_ROUTE_CLEARANCE_WIDTH / 2;
export const MAP_FOG_ROUTE_UNDERLAY_PROFILE = mapFogRadialProfile(
  ROUTE_CORE_RADIUS + 0.5,
  MAP_FOG_ROUTE_UNDERLAY_WIDTH / 2,
);
export const MAP_FOG_ROUTE_GUARD_PROFILE = mapFogRadialProfile(
  ROUTE_CORE_RADIUS + 0.5,
  ROUTE_CORE_RADIUS + MAP_FOG_ROUTE_CLEARANCE_COLLAR_FEATHER_RADIUS,
);
export const MAP_FOG_ROUTE_COLLAR_PROFILE = mapFogRadialProfile(
  ROUTE_CORE_RADIUS + 0.5,
  MAP_FOG_ROUTE_CLEARANCE_COLLAR_WIDTH / 2,
);
export const MAP_FOG_STATION_GUARD_PROFILE = mapFogRadialProfile(
  MAP_FOG_STATION_GUARD_RADIUS + 0.5,
  MAP_FOG_STATION_GUARD_RADIUS + MAP_FOG_ROUTE_CLEARANCE_COLLAR_FEATHER_RADIUS,
);

/** Keep only the traveled prefix of the route transparent in the fog mask. */
export function mapFogRouteDashArray(distance: number, total: number): string {
  const routeLength = Number.isFinite(total) ? Math.max(0, total) : 0;
  const traveled = Number.isFinite(distance)
    ? Math.min(routeLength, Math.max(0, distance))
    : 0;
  return `${traveled.toFixed(2)} ${routeLength.toFixed(2)}`;
}

/** Place the suffix guard cap so it overlaps the traveled profile transition. */
export function mapFogRouteGuardDashOffset(distance: number, total: number): string {
  const routeLength = Number.isFinite(total) ? Math.max(0, total) : 0;
  const traveled = Number.isFinite(distance)
    ? Math.min(routeLength, Math.max(0, distance))
    : 0;
  return `-${Math.min(routeLength, traveled + MAP_FOG_ROUTE_GUARD_LEAD).toFixed(2)}`;
}

export function mapFogMotionShouldRun(
  intersects: boolean,
  documentVisible: boolean,
  prefersReducedMotion: boolean,
): boolean {
  return intersects && documentVisible && !prefersReducedMotion;
}

/** Guarantees the whole map is clear once exploration reaches 100%. */
export function mapFogLayerOpacity(progress: number): number {
  const current = Number.isFinite(progress)
    ? Math.min(1, Math.max(0, progress))
    : 0;
  return Math.min(1, Math.max(0, (1 - current) / 0.02));
}
