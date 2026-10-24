/** Triples the original 42px half-width reveal corridor around the traveled route. */
export const MAP_FOG_ROUTE_CLEARANCE_WIDTH = 84 * 3;
/** Scale each graduated feather stroke with the clear corridor to keep the same edge profile. */
export const MAP_FOG_ROUTE_FEATHER_WIDTHS = [
  MAP_FOG_ROUTE_CLEARANCE_WIDTH + 52 * 3,
  MAP_FOG_ROUTE_CLEARANCE_WIDTH + 28 * 3,
  MAP_FOG_ROUTE_CLEARANCE_WIDTH + 12 * 3,
] as const;
export const MAP_FOG_STATION_GUARD_RADIUS = 125;

/** Keep only the traveled prefix of the route transparent in the fog mask. */
export function mapFogRouteDashArray(distance: number, total: number): string {
  const routeLength = Number.isFinite(total) ? Math.max(0, total) : 0;
  const traveled = Number.isFinite(distance)
    ? Math.min(routeLength, Math.max(0, distance))
    : 0;
  return `${traveled.toFixed(2)} ${routeLength.toFixed(2)}`;
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
