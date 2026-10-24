type Point = readonly [number, number];
export const stopIndices = [1, 3, 5, 7, 10];

export function mapGeometry(branch: "mountain" | "coast" = "mountain") {
  const route: Point[] = [
    [35, 505],
    [350, 505],
    [630, 505],
    [810, 410],
    [810, 220],
    [650, 140],
    branch === "coast" ? [870, 230] : [430, 140],
    [280, 230],
    [360, 320],
    [610, 320],
    [965, 320],
  ];
  const lengths = route.map((p, i) =>
    i ? Math.hypot(p[0] - route[i - 1][0], p[1] - route[i - 1][1]) : 0,
  );
  const distances = lengths.map((_, i) =>
    lengths.slice(0, i + 1).reduce((a, b) => a + b, 0),
  );
  const total = distances[distances.length - 1];
  const path = route.map((p, i) => `${i ? "L" : "M"}${p.join(" ")}`).join(" ");
  function position(distance: number) {
    const d = Math.max(0, Math.min(total, distance));
    const i = Math.max(
      1,
      distances.findIndex((v) => v >= d),
    );
    const t = (d - distances[i - 1]) / lengths[i];
    const a = route[i - 1],
      b = route[i];
    return {
      x: a[0] + (b[0] - a[0]) * t,
      y: a[1] + (b[1] - a[1]) * t,
      angle: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI,
    };
  }
  return { route, distances, total, path, position };
}
