import type { BoundingBox, Point2D } from "../document/types";

export interface HoldingTabOptions {
  readonly tabWidth: number;
  /** Explicit evenly distributed tab count. Takes precedence over targetInterval. */
  readonly tabCount?: number;
  /** Desired perimeter distance between tabs when tabCount is omitted. */
  readonly targetInterval?: number;
}

export interface HoldingTabSpan {
  readonly cutting: boolean;
  readonly points: readonly Point2D[];
  readonly startDistance: number;
  readonly endDistance: number;
}

/** Stable world-space geometry used by the canvas to preview a laser-off gap. */
export interface HoldingTabMarker {
  readonly index: number;
  readonly center: Point2D;
  readonly start: Point2D;
  readonly end: Point2D;
  readonly points: readonly Point2D[];
  readonly bounds: BoundingBox;
  readonly startDistance: number;
  readonly endDistance: number;
  readonly width: number;
}

export interface HoldingTabSplit {
  readonly spans: readonly HoldingTabSpan[];
  readonly tabs: readonly HoldingTabMarker[];
  readonly tabCount: number;
  readonly tabWidth: number;
  readonly perimeter: number;
}

interface PathMetric {
  readonly points: readonly Point2D[];
  readonly cumulative: readonly number[];
  readonly perimeter: number;
}

interface Interval {
  readonly start: number;
  readonly end: number;
}

const EPSILON = 1e-9;

function distance(left: Point2D, right: Point2D): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function buildMetric(source: readonly Point2D[]): PathMetric {
  if (source.length < 3) throw new RangeError("Holding tabs require a closed path with at least three points.");
  const points = [...source];
  const first = points[0]!;
  const last = points.at(-1)!;
  if (distance(first, last) <= EPSILON) points.pop();
  if (points.length < 3) throw new RangeError("Holding tabs require three distinct path points.");
  const cumulative = [0];
  let perimeter = 0;
  for (let index = 0; index < points.length; index += 1) {
    const segment = distance(points[index]!, points[(index + 1) % points.length]!);
    if (segment <= EPSILON) {
      cumulative.push(perimeter);
      continue;
    }
    perimeter += segment;
    cumulative.push(perimeter);
  }
  if (perimeter <= EPSILON) throw new RangeError("Holding tabs require a non-zero path perimeter.");
  return { points: Object.freeze(points), cumulative: Object.freeze(cumulative), perimeter };
}

function pointAt(metric: PathMetric, distanceAlongPath: number): Point2D {
  const clamped = Math.max(0, Math.min(metric.perimeter, distanceAlongPath));
  if (clamped >= metric.perimeter - EPSILON) return metric.points[0]!;
  let low = 0;
  let high = metric.points.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (metric.cumulative[middle + 1]! <= clamped + EPSILON) low = middle + 1;
    else high = middle - 1;
  }
  const index = Math.min(metric.points.length - 1, low);
  const startDistance = metric.cumulative[index]!;
  const endDistance = metric.cumulative[index + 1]!;
  const amount = endDistance - startDistance <= EPSILON ? 0 : (clamped - startDistance) / (endDistance - startDistance);
  const start = metric.points[index]!;
  const end = metric.points[(index + 1) % metric.points.length]!;
  return Object.freeze({
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
  });
}

function tabIntervals(perimeter: number, count: number, width: number): readonly Interval[] {
  const intervals: Interval[] = [];
  for (let index = 0; index < count; index += 1) {
    const center = ((index + 0.5) / count) * perimeter;
    const start = center - width / 2;
    const end = center + width / 2;
    if (start < 0) {
      intervals.push({ start: 0, end }, { start: perimeter + start, end: perimeter });
    } else if (end > perimeter) {
      intervals.push({ start, end: perimeter }, { start: 0, end: end - perimeter });
    } else {
      intervals.push({ start, end });
    }
  }
  return Object.freeze(intervals.sort((left, right) => left.start - right.start));
}

function isGap(distanceAlongPath: number, intervals: readonly Interval[]): boolean {
  return intervals.some((interval) => distanceAlongPath > interval.start - EPSILON && distanceAlongPath < interval.end + EPSILON);
}

function pointsBetween(metric: PathMetric, start: number, end: number): readonly Point2D[] {
  const points: Point2D[] = [pointAt(metric, start)];
  for (let index = 1; index < metric.cumulative.length - 1; index += 1) {
    const at = metric.cumulative[index]!;
    if (at > start + EPSILON && at < end - EPSILON) points.push(metric.points[index]!);
  }
  points.push(pointAt(metric, end));
  return Object.freeze(points);
}

function normalizeDistance(value: number, perimeter: number): number {
  const normalized = value % perimeter;
  return normalized < 0 ? normalized + perimeter : normalized;
}

function markerPoints(metric: PathMetric, startDistance: number, endDistance: number): readonly Point2D[] {
  if (startDistance >= 0 && endDistance <= metric.perimeter) {
    return pointsBetween(metric, startDistance, endDistance);
  }
  if (startDistance < 0) {
    const tail = pointsBetween(metric, metric.perimeter + startDistance, metric.perimeter);
    const head = pointsBetween(metric, 0, endDistance);
    return Object.freeze([...tail, ...head.slice(1)]);
  }
  const tail = pointsBetween(metric, startDistance, metric.perimeter);
  const head = pointsBetween(metric, 0, endDistance - metric.perimeter);
  return Object.freeze([...tail, ...head.slice(1)]);
}

function markerBounds(points: readonly Point2D[]): BoundingBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return Object.freeze({ minX, minY, maxX, maxY });
}

function buildTabMarkers(metric: PathMetric, count: number, width: number): readonly HoldingTabMarker[] {
  const tabs: HoldingTabMarker[] = [];
  for (let index = 0; index < count; index += 1) {
    const centerDistance = ((index + 0.5) / count) * metric.perimeter;
    const rawStart = centerDistance - width / 2;
    const rawEnd = centerDistance + width / 2;
    const points = markerPoints(metric, rawStart, rawEnd);
    const start = pointAt(metric, normalizeDistance(rawStart, metric.perimeter));
    const end = pointAt(metric, normalizeDistance(rawEnd, metric.perimeter));
    tabs.push(Object.freeze({
      index,
      center: pointAt(metric, centerDistance),
      start,
      end,
      points,
      bounds: markerBounds(points),
      startDistance: normalizeDistance(rawStart, metric.perimeter),
      endDistance: normalizeDistance(rawEnd, metric.perimeter),
      width,
    }));
  }
  return Object.freeze(tabs);
}

/** Splits a closed path into alternating laser-on cuts and laser-off tab gaps. */
export function splitPathForHoldingTabs(
  points: readonly Point2D[],
  options: HoldingTabOptions,
): HoldingTabSplit {
  const metric = buildMetric(points);
  if (!Number.isFinite(options.tabWidth) || options.tabWidth <= 0) {
    throw new RangeError("Holding-tab width must be greater than zero.");
  }
  let count: number;
  if (options.tabCount !== undefined) {
    if (!Number.isSafeInteger(options.tabCount) || options.tabCount < 1) {
      throw new RangeError("Holding-tab count must be a positive integer.");
    }
    count = options.tabCount;
  } else {
    const interval = options.targetInterval ?? metric.perimeter / 4;
    if (!Number.isFinite(interval) || interval <= 0) {
      throw new RangeError("Holding-tab target interval must be greater than zero.");
    }
    count = Math.max(1, Math.round(metric.perimeter / interval));
  }
  if (count > 10_000) throw new RangeError("Holding-tab count exceeds the 10,000-tab safety limit.");
  if (options.tabWidth * count >= metric.perimeter * 0.8) {
    throw new RangeError("Holding tabs would suppress 80% or more of the cut perimeter.");
  }
  const intervals = tabIntervals(metric.perimeter, count, options.tabWidth);
  const breakpoints = [...new Set([
    0,
    metric.perimeter,
    ...intervals.flatMap((interval) => [interval.start, interval.end]),
  ])].sort((left, right) => left - right);
  const spans: HoldingTabSpan[] = [];
  for (let index = 1; index < breakpoints.length; index += 1) {
    const start = breakpoints[index - 1]!;
    const end = breakpoints[index]!;
    if (end - start <= EPSILON) continue;
    const cutting = !isGap((start + end) / 2, intervals);
    const segmentPoints = pointsBetween(metric, start, end);
    const previous = spans.at(-1);
    if (previous?.cutting === cutting) {
      spans[spans.length - 1] = Object.freeze({
        cutting,
        points: Object.freeze([...previous.points, ...segmentPoints.slice(1)]),
        startDistance: previous.startDistance,
        endDistance: end,
      });
    } else {
      spans.push(Object.freeze({ cutting, points: segmentPoints, startDistance: start, endDistance: end }));
    }
  }
  return Object.freeze({
    spans: Object.freeze(spans),
    tabs: buildTabMarkers(metric, count, options.tabWidth),
    tabCount: count,
    tabWidth: options.tabWidth,
    perimeter: metric.perimeter,
  });
}
