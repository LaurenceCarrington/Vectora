import type { BoundingBox, Point2D, PolylineEntity } from "../document/types";
import type { TraceEntityOptions } from "./autoTracer";

export interface CenterlineTraceOptions {
  /** Pixel-space Ramer-Douglas-Peucker tolerance for ordered skeleton paths. */
  readonly simplifyTolerance?: number;
  readonly minimumPathLength?: number;
  readonly maximumPaths?: number;
  readonly maximumEdges?: number;
  readonly maximumIterations?: number;
}

export interface SkeletonPath {
  readonly id: string;
  readonly points: readonly Point2D[];
  readonly bounds: BoundingBox;
  readonly length: number;
  readonly closed: false;
}

export interface CenterlineTraceResult {
  readonly mode: "centerline";
  readonly width: number;
  readonly height: number;
  readonly paths: readonly SkeletonPath[];
  readonly skeletonPixelCount: number;
  readonly sourceEdgeCount: number;
  readonly pointCount: number;
  readonly iterations: number;
}

export interface ThinningResult {
  readonly mask: Uint8Array;
  readonly iterations: number;
  readonly foregroundPixels: number;
}

const NEIGHBOURS = [
  [0, -1], [1, -1], [1, 0], [1, 1],
  [0, 1], [-1, 1], [-1, 0], [-1, -1],
] as const;
const EPSILON = 1e-9;

function assertDimensions(mask: Uint8Array, width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new RangeError("Centreline trace dimensions must be positive integers.");
  }
  if (mask.length !== width * height) {
    throw new RangeError("Centreline trace dimensions do not match the binary mask.");
  }
}

function transitionCount(
  p2: number,
  p3: number,
  p4: number,
  p5: number,
  p6: number,
  p7: number,
  p8: number,
  p9: number,
): number {
  return Number(p2 === 0 && p3 === 1) +
    Number(p3 === 0 && p4 === 1) +
    Number(p4 === 0 && p5 === 1) +
    Number(p5 === 0 && p6 === 1) +
    Number(p6 === 0 && p7 === 1) +
    Number(p7 === 0 && p8 === 1) +
    Number(p8 === 0 && p9 === 1) +
    Number(p9 === 0 && p2 === 1);
}

/**
 * Zhang-Suen parallel thinning. The two deletion sets are evaluated against an
 * unchanged sub-iteration buffer, preserving connectivity and deterministic output.
 * Mathematical reference: T. Y. Zhang and C. Y. Suen, "A fast parallel algorithm
 * for thinning digital patterns", CACM 27(3), 236–239 (1984),
 * https://doi.org/10.1145/357994.358023. Citation is to the method, not source code.
 */
export function thinBinaryMask(
  source: Uint8Array,
  width: number,
  height: number,
  maximumIterations = Math.max(width, height),
): ThinningResult {
  assertDimensions(source, width, height);
  if (!Number.isSafeInteger(maximumIterations) || maximumIterations < 1) {
    throw new RangeError("Maximum thinning iterations must be a positive integer.");
  }
  const mask = Uint8Array.from(source, (value) => value === 0 ? 0 : 1);
  const removals = new Int32Array(mask.length);
  let iterations = 0;

  const foreground = (x: number, y: number): number =>
    x >= 0 && y >= 0 && x < width && y < height ? mask[y * width + x]! : 0;

  const runSubIteration = (second: boolean): number => {
    let removalCount = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (mask[index] === 0) continue;
        const p2 = foreground(x, y - 1);
        const p3 = foreground(x + 1, y - 1);
        const p4 = foreground(x + 1, y);
        const p5 = foreground(x + 1, y + 1);
        const p6 = foreground(x, y + 1);
        const p7 = foreground(x - 1, y + 1);
        const p8 = foreground(x - 1, y);
        const p9 = foreground(x - 1, y - 1);
        const neighbours = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (neighbours < 2 || neighbours > 6) continue;
        if (transitionCount(p2, p3, p4, p5, p6, p7, p8, p9) !== 1) continue;
        if (!second) {
          if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue;
        } else if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) {
          continue;
        }
        removals[removalCount++] = index;
      }
    }
    for (let index = 0; index < removalCount; index += 1) mask[removals[index]!] = 0;
    return removalCount;
  };

  while (iterations < maximumIterations) {
    iterations += 1;
    const removed = runSubIteration(false) + runSubIteration(true);
    if (removed === 0) break;
  }
  let foregroundPixels = 0;
  for (const value of mask) foregroundPixels += value;
  return Object.freeze({ mask, iterations, foregroundPixels });
}

function boundsOf(points: readonly Point2D[]): BoundingBox {
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

function pathLength(points: readonly Point2D[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index]!.x - points[index - 1]!.x, points[index]!.y - points[index - 1]!.y);
  }
  return length;
}

function perpendicularDistance(point: Point2D, start: Point2D, end: Point2D): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) return Math.hypot(point.x - start.x, point.y - start.y);
  const amount = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - start.x - dx * amount, point.y - start.y - dy * amount);
}

function simplifyOpen(points: readonly Point2D[], tolerance: number): readonly Point2D[] {
  if (points.length <= 2 || tolerance <= 0) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<readonly [number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let farthest = -1;
    let distance = tolerance;
    for (let index = start + 1; index < end; index += 1) {
      const candidate = perpendicularDistance(points[index]!, points[start]!, points[end]!);
      if (candidate > distance) {
        distance = candidate;
        farthest = index;
      }
    }
    if (farthest >= 0) {
      keep[farthest] = 1;
      stack.push([start, farthest], [farthest, end]);
    }
  }
  return Object.freeze(points.filter((_, index) => keep[index] === 1));
}

function connectedNeighbours(mask: Uint8Array, width: number, height: number, index: number): readonly number[] {
  const x = index % width;
  const y = Math.floor(index / width);
  const output: number[] = [];
  for (let direction = 0; direction < NEIGHBOURS.length; direction += 1) {
    const [dx, dy] = NEIGHBOURS[direction]!;
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    const neighbour = ny * width + nx;
    if (mask[neighbour] === 0) continue;
    // Suppress diagonal shortcuts around an existing orthogonal corner.
    if (dx !== 0 && dy !== 0) {
      if (mask[y * width + nx] === 1 || mask[ny * width + x] === 1) continue;
    }
    output.push(neighbour);
  }
  return output;
}

function directionBetween(from: number, to: number, width: number): number {
  const deltaX = to % width - from % width;
  const deltaY = Math.floor(to / width) - Math.floor(from / width);
  for (let direction = 0; direction < NEIGHBOURS.length; direction += 1) {
    const [x, y] = NEIGHBOURS[direction]!;
    if (x === deltaX && y === deltaY) return direction;
  }
  throw new Error("Skeleton graph contains a non-adjacent edge.");
}

function traceSkeletonPaths(
  mask: Uint8Array,
  width: number,
  height: number,
  maximumEdges: number,
): { readonly paths: readonly (readonly Point2D[])[]; readonly edgeCount: number } {
  const neighbours = new Map<number, readonly number[]>();
  let edgeCount = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] === 0) continue;
    const adjacent = connectedNeighbours(mask, width, height, index);
    neighbours.set(index, adjacent);
    edgeCount += adjacent.length;
  }
  edgeCount /= 2;
  if (edgeCount > maximumEdges) {
    throw new RangeError(`The skeleton contains more than ${maximumEdges.toLocaleString()} edges. Increase simplification or lower the source resolution.`);
  }

  // One bit per 8-neighbour direction avoids allocating string edge keys while
  // walking large skeletons in the worker.
  const visited = new Uint8Array(mask.length);
  const paths: Point2D[][] = [];
  const hasVisited = (from: number, to: number): boolean =>
    (visited[from]! & (1 << directionBetween(from, to, width))) !== 0;
  const markVisited = (from: number, to: number): void => {
    const direction = directionBetween(from, to, width);
    visited[from] = visited[from]! | (1 << direction);
    visited[to] = visited[to]! | (1 << ((direction + 4) % 8));
  };
  const toPoint = (index: number): Point2D => Object.freeze({
    x: index % width + 0.5,
    y: Math.floor(index / width) + 0.5,
  });
  const walk = (start: number, next: number): Point2D[] => {
    const points = [toPoint(start)];
    let previous = start;
    let current = next;
    markVisited(previous, current);
    for (let guard = 0; guard <= edgeCount; guard += 1) {
      points.push(toPoint(current));
      const adjacent = neighbours.get(current) ?? [];
      if (adjacent.length !== 2) break;
      const candidate = adjacent[0] === previous ? adjacent[1] : adjacent[0];
      if (candidate === undefined || hasVisited(current, candidate)) break;
      previous = current;
      current = candidate;
      markVisited(previous, current);
    }
    return points;
  };

  const nodes = [...neighbours.keys()].sort((left, right) => left - right);
  for (const node of nodes) {
    const adjacent = neighbours.get(node) ?? [];
    if (adjacent.length === 2) continue;
    for (const next of adjacent) {
      if (!hasVisited(node, next)) paths.push(walk(node, next));
    }
  }
  // Pure loops have no endpoint or junction, so deterministically break each at
  // its lowest row-major pixel. The repeated endpoint is removed before output
  // so the document receives a genuinely open Polyline.
  for (const node of nodes) {
    for (const next of neighbours.get(node) ?? []) {
      if (!hasVisited(node, next)) paths.push(walk(node, next));
    }
  }
  return { paths, edgeCount };
}

export function traceCenterlines(
  source: Uint8Array,
  width: number,
  height: number,
  options: CenterlineTraceOptions = {},
): CenterlineTraceResult {
  const maximumEdges = Math.max(100, Math.round(options.maximumEdges ?? 2_000_000));
  const thinned = thinBinaryMask(source, width, height, options.maximumIterations ?? Math.max(width, height));
  const traced = traceSkeletonPaths(thinned.mask, width, height, maximumEdges);
  const tolerance = Math.max(0, options.simplifyTolerance ?? 0.75);
  const minimumLength = Math.max(0, options.minimumPathLength ?? 2);
  const maximumPaths = Math.max(1, Math.round(options.maximumPaths ?? 10_000));
  const paths = traced.paths
    .map((points, index): SkeletonPath | null => {
      const first = points[0];
      const last = points.at(-1);
      const openPoints = first && last && points.length > 2 &&
        Math.abs(first.x - last.x) <= EPSILON && Math.abs(first.y - last.y) <= EPSILON
        ? points.slice(0, -1)
        : points;
      if (openPoints.length < 2 || pathLength(openPoints) + EPSILON < minimumLength) return null;
      const simplified = simplifyOpen(openPoints, tolerance);
      if (simplified.length < 2) return null;
      return Object.freeze({
        id: `centerline-${index}`,
        points: Object.freeze(simplified),
        bounds: boundsOf(simplified),
        length: pathLength(simplified),
        closed: false,
      });
    })
    .filter((path): path is SkeletonPath => path !== null)
    .sort((left, right) => right.length - left.length || left.id.localeCompare(right.id))
    .slice(0, maximumPaths);
  return Object.freeze({
    mode: "centerline",
    width,
    height,
    paths: Object.freeze(paths),
    skeletonPixelCount: thinned.foregroundPixels,
    sourceEdgeCount: traced.edgeCount,
    pointCount: paths.reduce((total, path) => total + path.points.length, 0),
    iterations: thinned.iterations,
  });
}

export function centerlinePathToSvgPath(path: SkeletonPath): string {
  const number = (value: number) => Number(value.toFixed(3)).toString();
  return path.points.map((point, index) => `${index === 0 ? "M" : "L"}${number(point.x)} ${number(point.y)}`).join(" ");
}

function entityId(prefix: string, index: number): string {
  const token = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${index}-${token}`;
}

export function centerlineResultToPolylineEntities(
  result: CenterlineTraceResult,
  options: TraceEntityOptions,
): readonly PolylineEntity[] {
  const scale = options.scale ?? 0.25;
  if (!Number.isFinite(scale) || scale <= 0) throw new RangeError("Trace insertion scale must be greater than zero.");
  const origin = options.origin ?? { x: 0, y: 0 };
  const intent = options.intent ?? "score";
  return Object.freeze(result.paths.flatMap((path, index) => {
    if (path.points.length < 2) return [];
    const points = path.points.map((point) => Object.freeze({
      x: origin.x + (point.x - result.width / 2) * scale,
      y: origin.y + (result.height / 2 - point.y) * scale,
    }));
    return [Object.freeze({
      id: entityId(options.idPrefix ?? "centerline", index),
      name: `Centreline ${index + 1}`,
      type: "polyline",
      layerId: options.layerId,
      intent,
      style: Object.freeze({
        strokeColor: options.strokeColor ?? null,
        strokeWidth: options.strokeWidth ?? 1,
        fillColor: null,
        dashArray: Object.freeze([]),
      }),
      bbox: boundsOf(points),
      visible: true,
      locked: false,
      points: Object.freeze(points),
      closed: false,
    } satisfies PolylineEntity)];
  }));
}
