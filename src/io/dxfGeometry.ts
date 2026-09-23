import type { Point2D, PolylineSegment } from "../document/types";

export interface SplinePath {
  points: Point2D[];
  segments: PolylineSegment[];
  closed: boolean;
}

/** De Boor on one specified span, including its one-sided endpoints. */
function evaluateSpan(points: readonly Point2D[], knots: readonly number[], degree: number, span: number, t: number): Point2D {
  const work = Array.from({ length: degree + 1 }, (_, j) => ({ ...points[span - degree + j]! }));
  for (let r = 1; r <= degree; r++) {
    for (let j = degree; j >= r; j--) {
      const i = span - degree + j;
      const denominator = knots[i + degree - r + 1]! - knots[i]!;
      const alpha = denominator === 0 ? 0 : (t - knots[i]!) / denominator;
      const a = work[j - 1]!;
      const b = work[j]!;
      work[j] = { x: a.x + alpha * (b.x - a.x), y: a.y + alpha * (b.y - a.y) };
    }
  }
  return work[degree]!;
}

/**
 * Each nonzero knot span is a polynomial. Recover its Bézier coefficients
 * exactly (up to floating point arithmetic), without tessellating the curve.
 * Works with nonuniform, repeated, unclamped and periodic knot vectors.
 */
export function splineToBezier(points: readonly Point2D[], knots: readonly number[], degree: number, closed: boolean): SplinePath[] {
  if (!Number.isInteger(degree) || degree < 1 || degree > 3) throw new Error("Only degree 1–3 polynomial SPLINEs are supported; export cubic non-rational splines.");
  if (points.length < degree + 1 || knots.length !== points.length + degree + 1 ||
      knots.some((k, i) => !Number.isFinite(k) || (i > 0 && k < knots[i - 1]!)) ||
      !(knots[degree]! < knots[points.length]!)) throw new Error("Invalid SPLINE control-point count or knot vector; repair the spline in the source CAD application.");
  const paths: SplinePath[] = [];
  let path: SplinePath | undefined;
  for (let span = degree; span < points.length; span++) {
    const a = knots[span]!;
    const b = knots[span + 1]!;
    if (a === b) continue;
    const at = (t: number) => evaluateSpan(points, knots, degree, span, a + (b - a) * t);
    const start = at(0);
    const end = at(1);
    // Multiplicity p+1 permits a discontinuity; never bridge it with a line.
    if (!path || knots[span - degree] === a) {
      path = { points: [start], segments: [], closed: false };
      paths.push(path);
    }
    if (degree === 1) path.segments.push({ type: "line" });
    else if (degree === 2) {
      const mid = at(0.5);
      path.segments.push({ type: "quadratic", cp1: { x: 2 * mid.x - (start.x + end.x) / 2, y: 2 * mid.y - (start.y + end.y) / 2 } });
    } else {
      const u = at(1 / 3);
      const v = at(2 / 3);
      const controls = (s: number, e: number, p: number, q: number) => {
        const c = 27 * (p - s) - (e - s);
        const d = 27 * (q - s) - 8 * (e - s);
        return [s + (2 * c - d) / 18, s + (2 * d - c) / 18] as const;
      };
      const x = controls(start.x, end.x, u.x, v.x);
      const y = controls(start.y, end.y, u.y, v.y);
      path.segments.push({ type: "cubic", cp1: { x: x[0], y: y[0] }, cp2: { x: x[1], y: y[1] } });
    }
    path.points.push(end);
  }
  if (closed && paths.length === 1 && path) {
    const start = path.points[0]!;
    const end = path.points.at(-1)!;
    const extent = path.points.reduce((size, p) => Math.max(size, Math.hypot(p.x - start.x, p.y - start.y)), 1);
    if (Math.hypot(start.x - end.x, start.y - end.y) > 1e-8 * extent) {
      throw new Error("Closed SPLINE endpoints do not meet; repair its periodic control points in the source CAD application.");
    }
    path.points.pop();
    path.closed = true;
  }
  return paths;
}

/** bulge = tan(signed sweep / 4); negative means decreasing world angle. */
export function bulgeToArc(start: Point2D, end: Point2D, bulge: number) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chord = Math.hypot(dx, dy);
  if (!Number.isFinite(bulge) || bulge === 0 || chord === 0) throw new Error("Invalid bulge arc; repair coincident vertices or non-finite bulges.");
  const offset = (1 / bulge - bulge) / 4;
  const center = { x: start.x + dx / 2 - dy * offset, y: start.y + dy / 2 + dx * offset };
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  return { center, radius: chord * (Math.abs(bulge) + 1 / Math.abs(bulge)) / 4,
    startAngle, endAngle: startAngle + 4 * Math.atan(bulge), counterClockwise: bulge < 0 };
}
