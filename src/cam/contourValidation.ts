import type { Point2D } from "../document/types";
import { signedPolygonArea } from "../geometry/topology";

export type ContourError = "degenerate-contour" | "self-intersection";
const EPSILON = 1e-9;
const same = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y) <= EPSILON;
const cross = (a: Point2D, b: Point2D, c: Point2D) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

function onSegment(a: Point2D, b: Point2D, p: Point2D): boolean {
  return Math.abs(cross(a, b, p)) <= EPSILON &&
    p.x >= Math.min(a.x, b.x) - EPSILON && p.x <= Math.max(a.x, b.x) + EPSILON &&
    p.y >= Math.min(a.y, b.y) - EPSILON && p.y <= Math.max(a.y, b.y) + EPSILON;
}

/** Checks flattened closed loops before offsetting can repair or discard corrupt input. */
export function validateClosedContour(input: readonly Point2D[]): ContourError | null {
  if (input.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return "degenerate-contour";
  const points = input.length > 1 && same(input[0]!, input.at(-1)!) ? input.slice(0, -1) : input;
  if (points.length < 3) return "degenerate-contour";
  const edges = points.map((a, index) => {
    const b = points[(index + 1) % points.length]!;
    return { a, b, index, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) };
  });
  for (const { a, b, index } of edges) {
    if (same(a, b)) return "degenerate-contour";
    const c = points[(index + 2) % points.length]!;
    // Adjacent edges may share one vertex, but must never retrace each other.
    if (Math.abs(cross(a, b, c)) <= EPSILON &&
      (a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y) > EPSILON) return "self-intersection";
  }
  edges.sort((a, b) => a.minX - b.minX);
  for (let i = 0; i < edges.length; i += 1) {
    const left = edges[i]!;
    for (let j = i + 1; j < edges.length; j += 1) {
      const right = edges[j]!;
      if (right.minX > left.maxX + EPSILON) break;
      if (right.minY > left.maxY + EPSILON || left.minY > right.maxY + EPSILON) continue;
      const separation = Math.abs(left.index - right.index);
      if (separation === 1 || separation === points.length - 1) continue;
      const abC = cross(left.a, left.b, right.a);
      const abD = cross(left.a, left.b, right.b);
      const cdA = cross(right.a, right.b, left.a);
      const cdB = cross(right.a, right.b, left.b);
      if ((abC * abD < 0 && cdA * cdB < 0) ||
        onSegment(left.a, left.b, right.a) || onSegment(left.a, left.b, right.b) ||
        onSegment(right.a, right.b, left.a) || onSegment(right.a, right.b, left.b)) return "self-intersection";
    }
  }
  const area = signedPolygonArea(points);
  return !Number.isFinite(area) || Math.abs(area) <= EPSILON ? "degenerate-contour" : null;
}
