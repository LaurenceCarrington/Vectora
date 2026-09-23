import type { Point2D } from "../document/types";
import type { ManufacturingPlan, ManufacturingToolpath } from "./processModel";
import { pocketLinkIsClear, type PocketPath } from "./pocketingEngine";
import type { PathsD } from "clipper2-ts";

/** Join only cutter-clear feed moves. Separate chains retain retract transitions. */
export function linkPocketPaths(paths: readonly PocketPath[], clearance: PathsD): readonly (readonly Point2D[])[] {
  const chains: Point2D[][] = [];
  for (const path of paths) {
    const previous = chains.at(-1);
    const cursor = previous?.at(-1);
    let points = [...path.points];
    if (cursor) {
      const candidates = (path.closed ? points.map((_, index) => index) : [0, points.length - 1])
        .sort((a, b) => distanceBetween(cursor, points[a]!) - distanceBetween(cursor, points[b]!));
      const index = candidates.slice(0, 16).find((i) => pocketLinkIsClear(cursor, points[i]!, clearance));
      if (index !== undefined) {
        points = path.closed ? [...points.slice(index), ...points.slice(0, index)] : index === 0 ? points : points.reverse();
        if (path.closed) points.push(points[0]!);
        previous!.push(...(distanceBetween(cursor, points[0]!) < 1e-8 ? points.slice(1) : points));
        continue;
      }
    }
    if (path.closed) points.push(points[0]!);
    chains.push(points);
  }
  return chains;
}

export interface ToolpathOptimizationOptions {
  /** Position of the head before the first operation, in document units. */
  readonly startPosition?: Point2D;
}

export interface OptimizedToolpath extends ManufacturingToolpath {
  readonly sequenceIndex: number;
  readonly entryPoint: Point2D;
  readonly exitPoint: Point2D;
  readonly rapidDistance: number;
  readonly cuttingDistance: number;
}

export interface OptimizedManufacturingPlan extends Omit<ManufacturingPlan, "toolpaths"> {
  readonly startPosition: Point2D;
  readonly toolpaths: readonly OptimizedToolpath[];
  readonly totalRapidDistance: number;
  readonly totalCuttingDistance: number;
}

const EPSILON = 1e-9;

export function distanceBetween(left: Point2D, right: Point2D): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

export function pathLength(points: readonly Point2D[], closed = false): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += distanceBetween(points[index - 1]!, points[index]!);
  }
  if (closed && points.length > 2) length += distanceBetween(points.at(-1)!, points[0]!);
  return length;
}

function processRank(toolpath: ManufacturingToolpath): number {
  // Marking operations happen before profiles can detach from the stock.
  if (toolpath.processType === "raster-engrave") return 0;
  if (toolpath.processType === "vector-engrave" || toolpath.processType === "pocket") return 1;
  return 2;
}

function compareSafetyPriority(left: ManufacturingToolpath, right: ManufacturingToolpath): number {
  const rankDifference = processRank(left) - processRank(right);
  if (rankDifference !== 0) return rankDifference;
  if (left.processType === "vector-cut" && right.processType === "vector-cut") {
    // Deepest contained profiles first: holes before their enclosing perimeter.
    const depthDifference = right.nestingDepth - left.nestingDepth;
    if (depthDifference !== 0) return depthDifference;
  }
  return left.processId.localeCompare(right.processId);
}

function priorityKey(toolpath: ManufacturingToolpath): string {
  const depth = toolpath.processType === "vector-cut" ? toolpath.nestingDepth : 0;
  return `${processRank(toolpath)}:${toolpath.processId}:${-depth}`;
}

function freezePoint(point: Point2D): Point2D {
  return Object.freeze({ x: point.x, y: point.y });
}

function orientOpenPath(
  points: readonly Point2D[],
  current: Point2D,
): readonly Point2D[] {
  const first = points[0]!;
  const last = points.at(-1)!;
  if (distanceBetween(current, last) + EPSILON < distanceBetween(current, first)) {
    return Object.freeze([...points].reverse().map(freezePoint));
  }
  return Object.freeze(points.map(freezePoint));
}

function orientClosedPath(
  points: readonly Point2D[],
  current: Point2D,
): readonly Point2D[] {
  let closestIndex = 0;
  let closestDistance = Infinity;
  for (let index = 0; index < points.length; index += 1) {
    const candidateDistance = distanceBetween(current, points[index]!);
    if (candidateDistance + EPSILON < closestDistance) {
      closestDistance = candidateDistance;
      closestIndex = index;
    }
  }
  return Object.freeze([
    ...points.slice(closestIndex),
    ...points.slice(0, closestIndex),
  ].map(freezePoint));
}

function nearestDistance(toolpath: ManufacturingToolpath, current: Point2D): number {
  if (toolpath.raster) return distanceBetween(current, toolpath.points[0]!);
  if (toolpath.closed) {
    return toolpath.points.reduce(
      (minimum, point) => Math.min(minimum, distanceBetween(current, point)),
      Infinity,
    );
  }
  return Math.min(
    distanceBetween(current, toolpath.points[0]!),
    distanceBetween(current, toolpath.points.at(-1)!),
  );
}

/**
 * Applies manufacturing safety ordering, then a deterministic nearest-neighbour
 * pass within each equally ranked process/depth bucket.
 */
export function optimizeToolpaths(
  plan: ManufacturingPlan,
  options: ToolpathOptimizationOptions = {},
): OptimizedManufacturingPlan {
  const startPosition = freezePoint(options.startPosition ?? { x: 0, y: 0 });
  const indexed = plan.toolpaths
    .filter((toolpath) => toolpath.points.length >= 2)
    .map((toolpath, sourceIndex) => ({ toolpath, sourceIndex }))
    .sort((left, right) => {
      const priority = compareSafetyPriority(left.toolpath, right.toolpath);
      return priority || left.sourceIndex - right.sourceIndex;
    });

  const buckets: typeof indexed[] = [];
  for (const item of indexed) {
    const bucket = buckets.at(-1);
    if (!bucket || priorityKey(bucket[0]!.toolpath) !== priorityKey(item.toolpath)) buckets.push([item]);
    else bucket.push(item);
  }

  const optimized: OptimizedToolpath[] = [];
  let current = startPosition;
  let totalRapidDistance = 0;
  let totalCuttingDistance = 0;

  for (const bucket of buckets) {
    const remaining = [...bucket];
    while (remaining.length > 0) {
      let bestIndex = 0;
      let bestDistance = Infinity;
      for (let index = 0; index < remaining.length; index += 1) {
        const candidate = remaining[index]!;
        const candidateDistance = nearestDistance(candidate.toolpath, current);
        const best = remaining[bestIndex]!;
        if (
          candidateDistance + EPSILON < bestDistance ||
          (Math.abs(candidateDistance - bestDistance) <= EPSILON &&
            (candidate.sourceIndex < best.sourceIndex ||
              (candidate.sourceIndex === best.sourceIndex && candidate.toolpath.id < best.toolpath.id)))
        ) {
          bestIndex = index;
          bestDistance = candidateDistance;
        }
      }

      const selected = remaining.splice(bestIndex, 1)[0];
      if (!selected) throw new Error("Toolpath optimisation selected an invalid candidate.");
      const { toolpath } = selected;
      const points = toolpath.raster ? toolpath.points : toolpath.closed
        ? orientClosedPath(toolpath.points, current)
        : orientOpenPath(toolpath.points, current);
      const entryPoint = freezePoint(points[0]!);
      const exitPoint = freezePoint(toolpath.closed ? points[0]! : points.at(-1)!);
      const rapidDistance = distanceBetween(current, entryPoint);
      const cuttingDistance = (toolpath.raster ? toolpath.raster.lines.reduce((total, line) => {
        let cursor = line.start;
        for (const run of line.runs) { total += distanceBetween(cursor, run.end); cursor = run.end; }
        return total;
      }, 0) : pathLength(points, toolpath.closed)) * toolpath.passes;
      totalRapidDistance += rapidDistance;
      totalCuttingDistance += cuttingDistance;
      optimized.push(Object.freeze({
        ...toolpath,
        points,
        sequenceIndex: optimized.length,
        entryPoint,
        exitPoint,
        rapidDistance,
        cuttingDistance,
      }));
      current = exitPoint;
    }
  }

  return Object.freeze({
    ...plan,
    startPosition,
    toolpaths: Object.freeze(optimized),
    totalRapidDistance,
    totalCuttingDistance,
  });
}
