import type { BoundingBox, LayerId, ManufacturingIntent, Point2D, PolylineEntity } from "../document/types";

export interface AutoTraceOptions {
  /** Pixel-space Ramer–Douglas–Peucker tolerance. */
  readonly simplifyTolerance?: number;
  /** Catmull-Rom-to-cubic smoothing strength in the range 0–1. */
  readonly curveFitting?: number;
  /** Higher values preserve progressively softer corners. */
  readonly cornerSensitivity?: number;
  readonly minimumPathArea?: number;
  readonly maximumPaths?: number;
  readonly maximumEdges?: number;
}

export type TracePathCommand =
  | { readonly type: "move"; readonly point: Point2D }
  | { readonly type: "line"; readonly point: Point2D }
  | { readonly type: "cubic"; readonly control1: Point2D; readonly control2: Point2D; readonly point: Point2D }
  | { readonly type: "close" };

export interface VectorPathLoop {
  readonly id: string;
  readonly points: readonly Point2D[];
  readonly commands: readonly TracePathCommand[];
  readonly bounds: BoundingBox;
  readonly signedArea: number;
  readonly isHole: boolean;
  readonly closed: true;
}

export interface AutoTraceResult {
  readonly mode: "outline" | "fill";
  readonly width: number;
  readonly height: number;
  readonly loops: readonly VectorPathLoop[];
  readonly sourceEdgeCount: number;
  readonly pointCount: number;
}

export interface TraceEntityOptions {
  readonly layerId: LayerId;
  readonly intent?: ManufacturingIntent;
  readonly origin?: Point2D;
  readonly scale?: number;
  readonly curveSteps?: number;
  readonly strokeColor?: string | null;
  readonly strokeWidth?: number;
  readonly fillColor?: string | null;
  readonly idPrefix?: string;
}

const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const;
const EPSILON = 1e-9;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function point(x: number, y: number): Point2D {
  return Object.freeze({ x, y });
}

function signedArea(points: readonly Point2D[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function boundsOf(points: readonly Point2D[]): BoundingBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const candidate of points) {
    minX = Math.min(minX, candidate.x);
    minY = Math.min(minY, candidate.y);
    maxX = Math.max(maxX, candidate.x);
    maxY = Math.max(maxY, candidate.y);
  }
  return Object.freeze({ minX, minY, maxX, maxY });
}

function perpendicularDistance(candidate: Point2D, start: Point2D, end: Point2D): number {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared <= EPSILON) return Math.hypot(candidate.x - start.x, candidate.y - start.y);
  const amount = clamp(
    ((candidate.x - start.x) * deltaX + (candidate.y - start.y) * deltaY) / lengthSquared,
    0,
    1,
  );
  return Math.hypot(candidate.x - (start.x + deltaX * amount), candidate.y - (start.y + deltaY * amount));
}

function simplifyOpen(points: readonly Point2D[], tolerance: number): readonly Point2D[] {
  if (points.length <= 2 || tolerance <= 0) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<readonly [number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [startIndex, endIndex] = stack.pop()!;
    let farthestIndex = -1;
    let farthestDistance = tolerance;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const distance = perpendicularDistance(points[index]!, points[startIndex]!, points[endIndex]!);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthestIndex = index;
      }
    }
    if (farthestIndex >= 0) {
      keep[farthestIndex] = 1;
      stack.push([startIndex, farthestIndex], [farthestIndex, endIndex]);
    }
  }
  return points.filter((_, index) => keep[index] === 1);
}

export function simplifyClosedContour(
  contour: readonly Point2D[],
  tolerance: number,
): readonly Point2D[] {
  if (contour.length <= 4 || tolerance <= 0) return contour.map((candidate) => point(candidate.x, candidate.y));
  const anchor = contour[0]!;
  let splitIndex = 1;
  let maximumDistance = 0;
  for (let index = 1; index < contour.length; index += 1) {
    const distance = Math.hypot(contour[index]!.x - anchor.x, contour[index]!.y - anchor.y);
    if (distance > maximumDistance) {
      maximumDistance = distance;
      splitIndex = index;
    }
  }
  const firstHalf = simplifyOpen(contour.slice(0, splitIndex + 1), tolerance);
  const secondHalf = simplifyOpen([...contour.slice(splitIndex), anchor], tolerance);
  const simplified = [...firstHalf.slice(0, -1), ...secondHalf.slice(0, -1)];
  return simplified.length >= 3
    ? Object.freeze(simplified.map((candidate) => point(candidate.x, candidate.y)))
    : Object.freeze(contour.map((candidate) => point(candidate.x, candidate.y)));
}

function isCorner(points: readonly Point2D[], index: number, sensitivity: number): boolean {
  const previous = points[(index - 1 + points.length) % points.length]!;
  const current = points[index]!;
  const next = points[(index + 1) % points.length]!;
  const incoming = { x: current.x - previous.x, y: current.y - previous.y };
  const outgoing = { x: next.x - current.x, y: next.y - current.y };
  const denominator = Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y);
  if (denominator <= EPSILON) return true;
  const cosine = clamp((incoming.x * outgoing.x + incoming.y * outgoing.y) / denominator, -1, 1);
  const turnDegrees = Math.acos(cosine) * 180 / Math.PI;
  const cornerThreshold = 150 - clamp(sensitivity, 0, 1) * 120;
  return turnDegrees >= cornerThreshold;
}

function buildCommands(
  points: readonly Point2D[],
  curveFitting: number,
  cornerSensitivity: number,
): readonly TracePathCommand[] {
  const commands: TracePathCommand[] = [{ type: "move", point: points[0]! }];
  const smoothing = clamp(curveFitting, 0, 1);
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length]!;
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    const after = points[(index + 2) % points.length]!;
    if (
      smoothing <= EPSILON ||
      isCorner(points, index, cornerSensitivity) ||
      isCorner(points, (index + 1) % points.length, cornerSensitivity)
    ) {
      commands.push({ type: "line", point: next });
      continue;
    }
    commands.push({
      type: "cubic",
      control1: point(
        current.x + (next.x - previous.x) * smoothing / 6,
        current.y + (next.y - previous.y) * smoothing / 6,
      ),
      control2: point(
        next.x - (after.x - current.x) * smoothing / 6,
        next.y - (after.y - current.y) * smoothing / 6,
      ),
      point: next,
    });
  }
  commands.push({ type: "close" });
  return Object.freeze(commands.map((command) => Object.freeze(command)));
}

function extractContours(
  mask: Uint8Array,
  width: number,
  height: number,
  maximumEdges: number,
): { readonly contours: readonly (readonly Point2D[])[]; readonly edgeCount: number } {
  if (mask.length !== width * height) throw new RangeError("Binary mask dimensions do not match its buffer.");
  const vertexWidth = width + 1;
  const edgeFlags = new Uint8Array((width + 1) * (height + 1) * 4);
  let edgeCount = 0;
  const mark = (vertexX: number, vertexY: number, direction: number) => {
    edgeFlags[(vertexY * vertexWidth + vertexX) * 4 + direction] = 1;
    edgeCount += 1;
    if (edgeCount > maximumEdges) {
      throw new RangeError(`The bitmap creates more than ${maximumEdges.toLocaleString()} contour edges. Increase noise reduction or lower its resolution.`);
    }
  };
  const foreground = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!foreground(x, y)) continue;
      if (!foreground(x, y - 1)) mark(x, y, 0);
      if (!foreground(x + 1, y)) mark(x + 1, y, 1);
      if (!foreground(x, y + 1)) mark(x + 1, y + 1, 2);
      if (!foreground(x - 1, y)) mark(x, y + 1, 3);
    }
  }

  const used = new Uint8Array(edgeFlags.length);
  const contours: Point2D[][] = [];
  for (let seedEdge = 0; seedEdge < edgeFlags.length; seedEdge += 1) {
    if (edgeFlags[seedEdge] !== 1 || used[seedEdge] === 1) continue;
    const startVertex = Math.floor(seedEdge / 4);
    const contour: Point2D[] = [];
    let edge = seedEdge;
    let closed = false;
    for (let guard = 0; guard <= edgeCount; guard += 1) {
      if (used[edge] === 1) break;
      used[edge] = 1;
      const vertex = Math.floor(edge / 4);
      const direction = edge % 4;
      if (contour.length === 0) contour.push(point(vertex % vertexWidth, Math.floor(vertex / vertexWidth)));
      const [deltaX, deltaY] = DIRECTIONS[direction]!;
      const vertexX = vertex % vertexWidth + deltaX;
      const vertexY = Math.floor(vertex / vertexWidth) + deltaY;
      const nextVertex = vertexY * vertexWidth + vertexX;
      if (nextVertex === startVertex) {
        closed = true;
        break;
      }
      contour.push(point(vertexX, vertexY));
      const directionPriority = [
        (direction + 1) % 4,
        direction,
        (direction + 3) % 4,
        (direction + 2) % 4,
      ];
      let nextEdge = -1;
      for (const candidateDirection of directionPriority) {
        const candidate = nextVertex * 4 + candidateDirection;
        if (edgeFlags[candidate] === 1 && used[candidate] === 0) {
          nextEdge = candidate;
          break;
        }
      }
      if (nextEdge < 0) break;
      edge = nextEdge;
    }
    if (closed && contour.length >= 3) contours.push(contour);
  }
  return { contours, edgeCount };
}

export function traceBinaryImage(
  mask: Uint8Array,
  width: number,
  height: number,
  options: AutoTraceOptions = {},
): AutoTraceResult {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError("Trace dimensions must be positive integers.");
  }
  const tolerance = Math.max(0, options.simplifyTolerance ?? 1.25);
  const curveFitting = clamp(options.curveFitting ?? 0.65, 0, 1);
  const cornerSensitivity = clamp(options.cornerSensitivity ?? 0.55, 0, 1);
  const minimumPathArea = Math.max(0, options.minimumPathArea ?? 4);
  const maximumPaths = Math.max(1, Math.round(options.maximumPaths ?? 10_000));
  const maximumEdges = Math.max(100, Math.round(options.maximumEdges ?? 2_000_000));
  const extracted = extractContours(mask, width, height, maximumEdges);
  const loops = extracted.contours
    .map((contour, index): VectorPathLoop | null => {
      const areaBeforeSimplification = signedArea(contour);
      if (Math.abs(areaBeforeSimplification) < minimumPathArea) return null;
      const points = simplifyClosedContour(contour, tolerance);
      if (points.length < 3) return null;
      const area = signedArea(points);
      return Object.freeze({
        id: `trace-loop-${index}`,
        points,
        commands: buildCommands(points, curveFitting, cornerSensitivity),
        bounds: boundsOf(points),
        signedArea: area,
        isHole: area < 0,
        closed: true,
      });
    })
    .filter((loop): loop is VectorPathLoop => loop !== null)
    .sort((left, right) => Math.abs(right.signedArea) - Math.abs(left.signedArea) || left.id.localeCompare(right.id))
    .slice(0, maximumPaths);
  return Object.freeze({
    mode: "outline",
    width,
    height,
    loops: Object.freeze(loops),
    sourceEdgeCount: extracted.edgeCount,
    pointCount: loops.reduce((total, loop) => total + loop.points.length, 0),
  });
}

export function traceLoopToSvgPath(loop: VectorPathLoop): string {
  const number = (value: number) => Number(value.toFixed(3)).toString();
  return loop.commands.map((command) => {
    if (command.type === "move") return `M${number(command.point.x)} ${number(command.point.y)}`;
    if (command.type === "line") return `L${number(command.point.x)} ${number(command.point.y)}`;
    if (command.type === "cubic") {
      return `C${number(command.control1.x)} ${number(command.control1.y)} ${number(command.control2.x)} ${number(command.control2.y)} ${number(command.point.x)} ${number(command.point.y)}`;
    }
    return "Z";
  }).join(" ");
}

function cubicPoint(start: Point2D, command: Extract<TracePathCommand, { type: "cubic" }>, amount: number): Point2D {
  const inverse = 1 - amount;
  const inverseSquared = inverse * inverse;
  const amountSquared = amount * amount;
  return point(
    inverseSquared * inverse * start.x + 3 * inverseSquared * amount * command.control1.x + 3 * inverse * amountSquared * command.control2.x + amountSquared * amount * command.point.x,
    inverseSquared * inverse * start.y + 3 * inverseSquared * amount * command.control1.y + 3 * inverse * amountSquared * command.control2.y + amountSquared * amount * command.point.y,
  );
}

export function flattenTraceLoop(loop: VectorPathLoop, curveSteps = 5): readonly Point2D[] {
  const steps = Math.max(2, Math.min(24, Math.round(curveSteps)));
  const output: Point2D[] = [];
  let current: Point2D | null = null;
  for (const command of loop.commands) {
    if (command.type === "move") {
      current = command.point;
      output.push(command.point);
    } else if (command.type === "line") {
      current = command.point;
      output.push(command.point);
    } else if (command.type === "cubic" && current) {
      const start = current;
      for (let step = 1; step <= steps; step += 1) output.push(cubicPoint(start, command, step / steps));
      current = command.point;
    }
  }
  const first = output[0];
  const last = output.at(-1);
  if (first && last && Math.hypot(first.x - last.x, first.y - last.y) <= EPSILON) output.pop();
  return Object.freeze(output);
}

function traceEntityId(prefix: string, index: number): string {
  const token = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${index}-${token}`;
}

export function traceResultToPolylineEntities(
  result: AutoTraceResult,
  options: TraceEntityOptions,
): readonly PolylineEntity[] {
  const scale = options.scale ?? 0.25;
  if (!Number.isFinite(scale) || scale <= 0) throw new RangeError("Trace insertion scale must be greater than zero.");
  const origin = options.origin ?? { x: 0, y: 0 };
  const intent = options.intent ?? "engrave";
  const contours = result.loops.flatMap((loop) => {
    const flattened = flattenTraceLoop(loop, options.curveSteps);
    if (flattened.length < 3) return [];
    const points = flattened.map((candidate) => point(
      origin.x + (candidate.x - result.width / 2) * scale,
      origin.y + (result.height / 2 - candidate.y) * scale,
    ));
    return [points];
  });
  const entityPoints = result.mode === "fill" && contours.length > 0
    ? [contours.slice(1).reduce<Point2D[]>((combined, contour) => {
        const attachment = combined.at(-1)!;
        const first = contour[0]!;
        // Walk to each additional contour and return over the same zero-area
        // seam. Canvas even-odd fill and SVG winding then retain holes and
        // disconnected islands while the document still stores one shape.
        combined.push(first, ...contour.slice(1), first, attachment);
        return combined;
      }, [...contours[0]!])]
    : contours;
  const entities = entityPoints.map((points, index) => Object.freeze({
      id: traceEntityId(options.idPrefix ?? "trace", index),
      name: `${result.mode === "fill" ? "Filled Shape" : "Traced Path"} ${index + 1}`,
      type: "polyline",
      layerId: options.layerId,
      intent,
      style: Object.freeze({
        strokeColor: options.strokeColor ?? null,
        strokeWidth: options.strokeWidth ?? 1,
        fillColor: options.fillColor ?? null,
        dashArray: Object.freeze([]),
      }),
      bbox: boundsOf(points),
      visible: true,
      locked: false,
      points: Object.freeze(points),
      closed: true,
    } satisfies PolylineEntity));
  return Object.freeze(entities);
}
