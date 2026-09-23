import type { BezierNodeType, BoundingBox, Point2D, PolylineEntity, PolylineSegment } from "../document/types";

const LINE_SEGMENT: PolylineSegment = Object.freeze({ type: "line" });

export function polylineSegmentCount(points: readonly Point2D[], closed: boolean): number {
  return Math.max(0, closed ? points.length : points.length - 1);
}

export function getPolylineSegment(
  segments: readonly PolylineSegment[] | undefined,
  index: number,
): PolylineSegment {
  return segments?.[index] ?? LINE_SEGMENT;
}

export function clonePolylineSegments(
  entity: Pick<PolylineEntity, "points" | "closed" | "segments">,
): PolylineSegment[] {
  const count = polylineSegmentCount(entity.points, entity.closed);
  return Array.from({ length: count }, (_, index) => {
    const segment = getPolylineSegment(entity.segments, index);
    if (segment.type === "line") return { type: "line" };
    if (segment.type === "quadratic") {
      return { type: "quadratic", cp1: { x: segment.cp1.x, y: segment.cp1.y } };
    }
    return {
      type: "cubic",
      cp1: { x: segment.cp1.x, y: segment.cp1.y },
      cp2: { x: segment.cp2.x, y: segment.cp2.y },
    };
  });
}

function lerp(left: Point2D, right: Point2D, amount: number): Point2D {
  return {
    x: left.x + (right.x - left.x) * amount,
    y: left.y + (right.y - left.y) * amount,
  };
}

/** Converts straight/quadratic segments to an exactly equivalent cubic. */
export function segmentAsCubic(
  segment: PolylineSegment,
  start: Point2D,
  end: Point2D,
): Extract<PolylineSegment, { type: "cubic" }> {
  if (segment.type === "cubic") {
    return {
      type: "cubic",
      cp1: { ...segment.cp1 },
      cp2: { ...segment.cp2 },
    };
  }
  if (segment.type === "quadratic") {
    return {
      type: "cubic",
      cp1: lerp(start, segment.cp1, 2 / 3),
      cp2: lerp(end, segment.cp1, 2 / 3),
    };
  }
  return {
    type: "cubic",
    cp1: lerp(start, end, 1 / 3),
    cp2: lerp(start, end, 2 / 3),
  };
}

/**
 * Applies Illustrator-style node semantics. Smooth preserves independent
 * handle lengths; Symmetric aligns them and gives them equal length. Changing
 * a straight node creates cubic handles without initially changing its shape.
 */
export function applyBezierNodeType(
  points: readonly Point2D[],
  closed: boolean,
  segments: PolylineSegment[],
  nodeTypes: BezierNodeType[],
  vertexIndex: number,
  nodeType: BezierNodeType,
): void {
  const anchor = points[vertexIndex];
  if (!anchor || vertexIndex < 0 || vertexIndex >= points.length) return;
  nodeTypes[vertexIndex] = nodeType;
  if (nodeType === "corner") return;

  const count = polylineSegmentCount(points, closed);
  const incomingIndex = vertexIndex === 0 ? (closed ? count - 1 : -1) : vertexIndex - 1;
  const outgoingIndex = vertexIndex < count ? vertexIndex : -1;
  if (incomingIndex >= 0) {
    const start = points[incomingIndex];
    if (start) segments[incomingIndex] = segmentAsCubic(getPolylineSegment(segments, incomingIndex), start, anchor);
  }
  if (outgoingIndex >= 0) {
    const end = points[(vertexIndex + 1) % points.length];
    if (end) segments[outgoingIndex] = segmentAsCubic(getPolylineSegment(segments, outgoingIndex), anchor, end);
  }

  const incoming = incomingIndex >= 0 ? segments[incomingIndex] : undefined;
  const outgoing = outgoingIndex >= 0 ? segments[outgoingIndex] : undefined;
  const incomingControl = incoming?.type === "cubic" ? incoming.cp2 : null;
  const outgoingControl = outgoing?.type === "cubic" ? outgoing.cp1 : null;
  const incomingLength = incomingControl ? Math.hypot(incomingControl.x - anchor.x, incomingControl.y - anchor.y) : 0;
  const outgoingLength = outgoingControl ? Math.hypot(outgoingControl.x - anchor.x, outgoingControl.y - anchor.y) : 0;

  let directionX = outgoingControl?.x ?? anchor.x;
  let directionY = outgoingControl?.y ?? anchor.y;
  directionX -= anchor.x;
  directionY -= anchor.y;
  let length = Math.hypot(directionX, directionY);
  if (length <= Number.EPSILON && incomingControl) {
    directionX = anchor.x - incomingControl.x;
    directionY = anchor.y - incomingControl.y;
    length = Math.hypot(directionX, directionY);
  }
  if (length <= Number.EPSILON) {
    const previous = incomingIndex >= 0 ? points[incomingIndex] : anchor;
    const next = outgoingIndex >= 0 ? points[(vertexIndex + 1) % points.length] : anchor;
    directionX = (next?.x ?? anchor.x) - (previous?.x ?? anchor.x);
    directionY = (next?.y ?? anchor.y) - (previous?.y ?? anchor.y);
    length = Math.hypot(directionX, directionY);
  }
  if (length <= Number.EPSILON) return;
  const ux = directionX / length;
  const uy = directionY / length;
  const symmetricLength = incomingLength > 0 && outgoingLength > 0
    ? (incomingLength + outgoingLength) / 2
    : Math.max(incomingLength, outgoingLength);
  const nextIncomingLength = nodeType === "symmetric" ? symmetricLength : incomingLength;
  const nextOutgoingLength = nodeType === "symmetric" ? symmetricLength : outgoingLength;
  if (incoming?.type === "cubic") {
    segments[incomingIndex] = {
      ...incoming,
      cp2: { x: anchor.x - ux * nextIncomingLength, y: anchor.y - uy * nextIncomingLength },
    };
  }
  if (outgoing?.type === "cubic") {
    segments[outgoingIndex] = {
      ...outgoing,
      cp1: { x: anchor.x + ux * nextOutgoingLength, y: anchor.y + uy * nextOutgoingLength },
    };
  }
}

/** Builds a tangent-preserving bridge when a node between two segments is removed. */
export function bridgeAfterNodeRemoval(
  incoming: PolylineSegment,
  outgoing: PolylineSegment,
  previous: Point2D,
  removed: Point2D,
  next: Point2D,
): PolylineSegment {
  if (incoming.type === "line" && outgoing.type === "line") return { type: "line" };
  const incomingCubic = segmentAsCubic(incoming, previous, removed);
  const outgoingCubic = segmentAsCubic(outgoing, removed, next);
  return {
    type: "cubic",
    cp1: incomingCubic.cp1,
    cp2: outgoingCubic.cp2,
  };
}

export function evaluatePolylineSegment(
  start: Point2D,
  end: Point2D,
  segment: PolylineSegment,
  amount: number,
): Point2D {
  const t = Math.max(0, Math.min(1, amount));
  const inverse = 1 - t;
  if (segment.type === "line") {
    return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
  }
  if (segment.type === "quadratic") {
    return {
      x: inverse * inverse * start.x + 2 * inverse * t * segment.cp1.x + t * t * end.x,
      y: inverse * inverse * start.y + 2 * inverse * t * segment.cp1.y + t * t * end.y,
    };
  }
  return {
    x: inverse ** 3 * start.x + 3 * inverse * inverse * t * segment.cp1.x + 3 * inverse * t * t * segment.cp2.x + t ** 3 * end.x,
    y: inverse ** 3 * start.y + 3 * inverse * inverse * t * segment.cp1.y + 3 * inverse * t * t * segment.cp2.y + t ** 3 * end.y,
  };
}

export function tracePolyline(
  target: Pick<CanvasRenderingContext2D | Path2D, "moveTo" | "lineTo" | "quadraticCurveTo" | "bezierCurveTo" | "closePath">,
  points: readonly Point2D[],
  closed: boolean,
  segments?: readonly PolylineSegment[],
): void {
  const first = points[0];
  if (!first) return;
  target.moveTo(first.x, first.y);
  const count = polylineSegmentCount(points, closed);
  for (let index = 0; index < count; index += 1) {
    const end = points[(index + 1) % points.length];
    if (!end) continue;
    const segment = getPolylineSegment(segments, index);
    if (segment.type === "quadratic") {
      target.quadraticCurveTo(segment.cp1.x, segment.cp1.y, end.x, end.y);
    } else if (segment.type === "cubic") {
      target.bezierCurveTo(segment.cp1.x, segment.cp1.y, segment.cp2.x, segment.cp2.y, end.x, end.y);
    } else {
      target.lineTo(end.x, end.y);
    }
  }
  if (closed) target.closePath();
}

export function transformPolylineSegments(
  segments: readonly PolylineSegment[] | undefined,
  transform: (point: Point2D) => Point2D,
): readonly PolylineSegment[] | undefined {
  if (!segments) return undefined;
  return segments.map((segment) => segment.type === "line"
    ? segment
    : segment.type === "quadratic"
      ? { ...segment, cp1: transform(segment.cp1) }
      : { ...segment, cp1: transform(segment.cp1), cp2: transform(segment.cp2) });
}

function derivativeRoots(p0: number, p1: number, p2: number, p3?: number): readonly number[] {
  if (p3 === undefined) {
    const denominator = p0 - 2 * p1 + p2;
    return Math.abs(denominator) <= Number.EPSILON ? [] : [(p0 - p1) / denominator];
  }
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 3 * p0 - 6 * p1 + 3 * p2;
  const c = -3 * p0 + 3 * p1;
  if (Math.abs(a) <= Number.EPSILON) return Math.abs(b) <= Number.EPSILON ? [] : [-c / (2 * b)];
  const discriminant = 4 * b * b - 12 * a * c;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  return [(-2 * b + root) / (6 * a), (-2 * b - root) / (6 * a)];
}

export function calculatePolylineBounds(entity: Pick<PolylineEntity, "points" | "closed" | "segments">): BoundingBox {
  const first = entity.points[0];
  if (!first) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x;
  let maxY = first.y;
  const include = (point: Point2D) => {
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  };
  const count = polylineSegmentCount(entity.points, entity.closed);
  for (let index = 0; index < count; index += 1) {
    const start = entity.points[index]!;
    const end = entity.points[(index + 1) % entity.points.length]!;
    const segment = getPolylineSegment(entity.segments, index);
    include(start); include(end);
    if (segment.type === "line") continue;
    const xRoots = derivativeRoots(start.x, segment.cp1.x, segment.type === "cubic" ? segment.cp2.x : end.x, segment.type === "cubic" ? end.x : undefined);
    const yRoots = derivativeRoots(start.y, segment.cp1.y, segment.type === "cubic" ? segment.cp2.y : end.y, segment.type === "cubic" ? end.y : undefined);
    for (const amount of [...xRoots, ...yRoots]) {
      if (amount > 0 && amount < 1) include(evaluatePolylineSegment(start, end, segment, amount));
    }
  }
  return { minX, minY, maxX, maxY };
}

/** Flattens only as much as downstream line-only consumers require. */
export function flattenPolyline(entity: PolylineEntity, subdivisions = 20): readonly Point2D[] {
  if (!entity.segments?.some((segment) => segment.type !== "line")) return entity.points;
  const first = entity.points[0];
  if (!first) return entity.points;
  const result: Point2D[] = [{ ...first }];
  const count = polylineSegmentCount(entity.points, entity.closed);
  for (let index = 0; index < count; index += 1) {
    const start = entity.points[index]!;
    const end = entity.points[(index + 1) % entity.points.length]!;
    const segment = getPolylineSegment(entity.segments, index);
    const steps = segment.type === "line" ? 1 : subdivisions;
    for (let step = 1; step <= steps; step += 1) {
      if (entity.closed && index === count - 1 && step === steps) continue;
      result.push(evaluatePolylineSegment(start, end, segment, step / steps));
    }
  }
  return result;
}
