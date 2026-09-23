import { imageCorners } from "../cam/rasterCamEngine";
import type { BoundingBox, Entity, Point2D, PolylineEntity } from "../document/types";
import { entityToClosedPath, entityToEditablePolyline } from "./operations/pathConversion";
import { getDimensionGeometry } from "./annotations";
import { evaluatePolylineSegment, flattenPolyline, getPolylineSegment, polylineSegmentCount } from "./bezier";

const TAU = Math.PI * 2;

export function normalizeBox(start: Point2D, end: Point2D): BoundingBox {
  return {
    minX: Math.min(start.x, end.x),
    minY: Math.min(start.y, end.y),
    maxX: Math.max(start.x, end.x),
    maxY: Math.max(start.y, end.y),
  };
}

export function boxesIntersect(left: BoundingBox, right: BoundingBox): boolean {
  return !(
    left.maxX < right.minX ||
    left.minX > right.maxX ||
    left.maxY < right.minY ||
    left.minY > right.maxY
  );
}

export function pointInBox(point: Point2D, box: BoundingBox, tolerance = 0): boolean {
  return (
    point.x >= box.minX - tolerance &&
    point.x <= box.maxX + tolerance &&
    point.y >= box.minY - tolerance &&
    point.y <= box.maxY + tolerance
  );
}

function squaredDistance(left: Point2D, right: Point2D): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

function distanceToSegment(point: Point2D, start: Point2D, end: Point2D): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.sqrt(squaredDistance(point, start));
  const projection = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );
  return Math.hypot(
    point.x - (start.x + projection * dx),
    point.y - (start.y + projection * dy),
  );
}

export interface EntitySegmentHit {
  readonly entityId: string;
  readonly segmentIndex: number;
  readonly distance: number;
}

const editablePathCache = new WeakMap<Entity, PolylineEntity>();

/** Finds the closest editable segment without treating a filled interior as a hit. */
export function hitTestEntitySegment(
  point: Point2D,
  entity: Entity,
  tolerance: number,
): EntitySegmentHit | null {
  if (!pointInBox(point, entity.bbox, tolerance)) return null;
  if (entity.type === "line") {
    const distance = distanceToSegment(point, entity.start, entity.end);
    return distance <= tolerance ? { entityId: entity.id, segmentIndex: 0, distance } : null;
  }
  if (entity.type === "arc") {
    const dx = point.x - entity.center.x;
    const dy = point.y - entity.center.y;
    const distance = Math.abs(Math.hypot(dx, dy) - entity.radius);
    return distance <= tolerance && angleIsOnArc(Math.atan2(dy, dx), entity.startAngle, entity.endAngle, entity.counterClockwise)
      ? { entityId: entity.id, segmentIndex: 0, distance }
      : null;
  }
  if (entity.type === "text" || entity.type === "dimension" || entity.type === "leader") return null;
  let editable = entity.type === "polyline" ? entity : editablePathCache.get(entity);
  if (!editable) {
    editable = entityToEditablePolyline(entity) ?? undefined;
    if (!editable) return null;
    editablePathCache.set(entity, editable);
  }
  const count = polylineSegmentCount(editable.points, editable.closed);
  let nearest: EntitySegmentHit | null = null;
  for (let segmentIndex = 0; segmentIndex < count; segmentIndex += 1) {
    const start = editable.points[segmentIndex];
    const end = editable.points[(segmentIndex + 1) % editable.points.length];
    if (!start || !end) continue;
    const segment = getPolylineSegment(editable.segments, segmentIndex);
    const steps = segment.type === "line" ? 1 : 24;
    let previous = start;
    for (let step = 1; step <= steps; step += 1) {
      const current = evaluatePolylineSegment(start, end, segment, step / steps);
      const distance = distanceToSegment(point, previous, current);
      if (distance <= tolerance && (!nearest || distance < nearest.distance)) {
        nearest = { entityId: entity.id, segmentIndex, distance };
      }
      previous = current;
    }
  }
  return nearest;
}

function normalizeAngle(angle: number): number {
  const normalized = angle % TAU;
  return normalized < 0 ? normalized + TAU : normalized;
}

function angleIsOnArc(
  angle: number,
  startAngle: number,
  endAngle: number,
  counterClockwise: boolean,
): boolean {
  const start = normalizeAngle(startAngle);
  const end = normalizeAngle(endAngle);
  const candidate = normalizeAngle(angle);
  if (counterClockwise) {
    return normalizeAngle(start - candidate) <= normalizeAngle(start - end);
  }
  return normalizeAngle(candidate - start) <= normalizeAngle(end - start);
}

function rectangleEdgeHit(point: Point2D, box: BoundingBox, tolerance: number): boolean {
  if (!pointInBox(point, box, tolerance)) return false;
  return (
    Math.abs(point.x - box.minX) <= tolerance ||
    Math.abs(point.x - box.maxX) <= tolerance ||
    Math.abs(point.y - box.minY) <= tolerance ||
    Math.abs(point.y - box.maxY) <= tolerance
  );
}

function radialShapeHit(
  point: Point2D,
  cx: number,
  cy: number,
  count: number,
  rotation: number,
  radiusAt: (index: number) => number,
  tolerance: number,
  filled: boolean,
): boolean {
  const vertices: Point2D[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = rotation + (index * TAU) / count;
    const radius = radiusAt(index);
    vertices.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  }
  if (filled && pointInPolygon(point, vertices)) return true;
  for (let index = 0; index < vertices.length; index += 1) {
    if (distanceToSegment(point, vertices[index]!, vertices[(index + 1) % vertices.length]!) <= tolerance) return true;
  }
  return false;
}

function sectorHit(
  point: Point2D,
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
  tolerance: number,
  filled: boolean,
): boolean {
  const dx = point.x - cx;
  const dy = point.y - cy;
  const distance = Math.hypot(dx, dy);
  const onSweep = angleIsOnArc(Math.atan2(dy, dx), startAngle, endAngle, false);
  if (filled && distance <= radius + tolerance && onSweep) return true;
  if (Math.abs(distance - radius) <= tolerance && onSweep) return true;
  const center = { x: cx, y: cy };
  const start = { x: cx + Math.cos(startAngle) * radius, y: cy + Math.sin(startAngle) * radius };
  const end = { x: cx + Math.cos(endAngle) * radius, y: cy + Math.sin(endAngle) * radius };
  return distanceToSegment(point, center, start) <= tolerance || distanceToSegment(point, center, end) <= tolerance;
}

export function pointHitsEntity(point: Point2D, entity: Entity, tolerance: number): boolean {
  if (!pointInBox(point, entity.bbox, tolerance)) return false;

  switch (entity.type) {
    case "image": return pointInPolygon(point, imageCorners(entity));
    case "line":
      return distanceToSegment(point, entity.start, entity.end) <= tolerance;
    case "polyline": {
      const points = flattenPolyline(entity);
      for (let index = 1; index < points.length; index += 1) {
        const start = points[index - 1];
        const end = points[index];
        if (start && end && distanceToSegment(point, start, end) <= tolerance) return true;
      }
      const first = points[0];
      const last = points.at(-1);
      return Boolean(
        entity.closed &&
        first &&
        last &&
        (distanceToSegment(point, last, first) <= tolerance ||
          (entity.style.fillColor && pointInPolygon(point, points))),
      );
    }
    case "rectangle":
      return entity.style.fillColor
        ? pointInBox(point, entity.bbox)
        : rectangleEdgeHit(point, entity.bbox, tolerance);
    case "circle": {
      const distance = Math.hypot(point.x - entity.center.x, point.y - entity.center.y);
      return entity.style.fillColor
        ? distance <= entity.radius + tolerance
        : Math.abs(distance - entity.radius) <= tolerance;
    }
    case "arc": {
      const dx = point.x - entity.center.x;
      const dy = point.y - entity.center.y;
      const distance = Math.hypot(dx, dy);
      return (
        Math.abs(distance - entity.radius) <= tolerance &&
        angleIsOnArc(
          Math.atan2(dy, dx),
          entity.startAngle,
          entity.endAngle,
          entity.counterClockwise,
        )
      );
    }
    case "ellipse": {
      if (entity.rx <= Number.EPSILON || entity.ry <= Number.EPSILON) return false;
      const cos = Math.cos(-entity.rotation);
      const sin = Math.sin(-entity.rotation);
      const dx = point.x - entity.cx;
      const dy = point.y - entity.cy;
      const localX = dx * cos - dy * sin;
      const localY = dx * sin + dy * cos;
      const normalized = Math.sqrt((localX * localX) / (entity.rx * entity.rx) + (localY * localY) / (entity.ry * entity.ry));
      if (entity.style.fillColor) return normalized <= 1 + tolerance / Math.max(entity.rx, entity.ry);
      return Math.abs(normalized - 1) * Math.min(entity.rx, entity.ry) <= tolerance;
    }
    case "polygon":
      return radialShapeHit(point, entity.cx, entity.cy, entity.sides, entity.rotation, () => entity.radius, tolerance, Boolean(entity.style.fillColor));
    case "quadrant": {
      const start = (entity.quadrantIndex - 1) * Math.PI / 2;
      return sectorHit(point, entity.cx, entity.cy, entity.radius, start, start + Math.PI / 2, tolerance, Boolean(entity.style.fillColor));
    }
    case "semicircle":
      return sectorHit(point, entity.cx, entity.cy, entity.radius, entity.startAngle, entity.startAngle + Math.PI, tolerance, Boolean(entity.style.fillColor));
    case "segment":
      return sectorHit(point, entity.cx, entity.cy, entity.radius, entity.startAngle, entity.endAngle, tolerance, Boolean(entity.style.fillColor));
    case "star":
      return radialShapeHit(point, entity.cx, entity.cy, entity.points * 2, entity.rotation, (index) => index % 2 === 0 ? entity.outerRadius : entity.innerRadius, tolerance, Boolean(entity.style.fillColor));
    case "cloud": {
      const outline = entityToClosedPath(entity, { tolerance: 0.1, maximumSegments: 256 }) ?? entity.points;
      if (entity.style.fillColor && pointInPolygon(point, outline)) return true;
      for (let index = 0; index < outline.length; index += 1) {
        const start = outline[index];
        const end = outline[(index + 1) % outline.length];
        if (start && end && distanceToSegment(point, start, end) <= tolerance) return true;
      }
      return false;
    }
    case "text":
      return true;
    case "dimension": {
      const geometry = getDimensionGeometry(entity);
      if (distanceToSegment(point, geometry.dimensionStart, geometry.dimensionEnd) <= tolerance) return true;
      if (geometry.extensionStart && distanceToSegment(point, geometry.extensionStart[0], geometry.extensionStart[1]) <= tolerance) return true;
      if (geometry.extensionEnd && distanceToSegment(point, geometry.extensionEnd[0], geometry.extensionEnd[1]) <= tolerance) return true;
      return Math.hypot(point.x - entity.textPosition.x, point.y - entity.textPosition.y) <= Math.max(tolerance, entity.arrowSize * 2);
    }
    case "leader":
      return distanceToSegment(point, entity.arrowPoint, entity.elbowPoint) <= tolerance ||
        distanceToSegment(point, entity.elbowPoint, entity.textPosition) <= tolerance ||
        pointInBox(point, entity.bbox, tolerance);
  }
}

export function entityIntersectsBox(entity: Entity, box: BoundingBox): boolean {
  if (!boxesIntersect(entity.bbox, box)) return false;

  switch (entity.type) {
    case "image": return true;
    case "line":
      return segmentIntersectsBox(entity.start, entity.end, box);
    case "polyline": {
      const points = flattenPolyline(entity);
      if (points.some((point) => pointInBox(point, box))) return true;
      for (let index = 1; index < points.length; index += 1) {
        const start = points[index - 1];
        const end = points[index];
        if (start && end && segmentIntersectsBox(start, end, box)) return true;
      }
      const first = points[0];
      const last = points.at(-1);
      return Boolean(entity.closed && first && last && segmentIntersectsBox(last, first, box));
    }
    case "rectangle":
      return true;
    case "circle": {
      const nearestX = Math.max(box.minX, Math.min(entity.center.x, box.maxX));
      const nearestY = Math.max(box.minY, Math.min(entity.center.y, box.maxY));
      const nearestDistance = Math.hypot(nearestX - entity.center.x, nearestY - entity.center.y);
      if (nearestDistance > entity.radius) return false;
      if (entity.style.fillColor) return true;
      const corners = [
        { x: box.minX, y: box.minY },
        { x: box.minX, y: box.maxY },
        { x: box.maxX, y: box.minY },
        { x: box.maxX, y: box.maxY },
      ];
      return corners.some(
        (corner) => squaredDistance(corner, entity.center) >= entity.radius * entity.radius,
      );
    }
    case "arc":
      // The exact arc test is intentionally bounded: endpoints, box corners and
      // cardinal extrema cover CAD marquee selection without path rasterisation.
      return arcIntersectsBox(entity, box);
    case "ellipse":
    case "polygon":
    case "quadrant":
    case "semicircle":
    case "segment":
    case "star":
    case "cloud": {
      const points = entityToClosedPath(entity, { tolerance: 0.2, maximumSegments: 192 });
      return points ? closedPathIntersectsBox(points, box) : false;
    }
    case "text":
    case "dimension":
    case "leader":
      return true;
  }
}

function closedPathIntersectsBox(points: readonly Point2D[], box: BoundingBox): boolean {
  if (points.some((point) => pointInBox(point, box))) return true;
  const corners = [
    { x: box.minX, y: box.minY },
    { x: box.minX, y: box.maxY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
  ];
  if (corners.some((corner) => pointInPolygon(corner, points))) return true;
  for (let index = 0; index < points.length; index += 1) {
    if (segmentIntersectsBox(points[index]!, points[(index + 1) % points.length]!, box)) return true;
  }
  return false;
}

export function pointInPolygon(point: Point2D, points: readonly Point2D[]): boolean {
  let inside = false;
  for (let current = 0, previous = points.length - 1; current < points.length; previous = current++) {
    const a = points[current];
    const b = points[previous];
    if (!a || !b) continue;
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Tests the actual interior of fillable geometry, independent of its current fill style. */
export function pointInClosedEntity(point: Point2D, entity: Entity): boolean {
  if (!pointInBox(point, entity.bbox)) return false;
  const outline = entityToClosedPath(entity, { tolerance: 0.08, maximumSegments: 512 });
  return Boolean(outline && outline.length >= 3 && pointInPolygon(point, outline));
}

function segmentIntersectsBox(start: Point2D, end: Point2D, box: BoundingBox): boolean {
  if (pointInBox(start, box) || pointInBox(end, box)) return true;
  const topLeft = { x: box.minX, y: box.maxY };
  const topRight = { x: box.maxX, y: box.maxY };
  const bottomLeft = { x: box.minX, y: box.minY };
  const bottomRight = { x: box.maxX, y: box.minY };
  return (
    segmentsIntersect(start, end, topLeft, topRight) ||
    segmentsIntersect(start, end, topRight, bottomRight) ||
    segmentsIntersect(start, end, bottomRight, bottomLeft) ||
    segmentsIntersect(start, end, bottomLeft, topLeft)
  );
}

function segmentsIntersect(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
  const cross = (p: Point2D, q: Point2D, r: Point2D) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return (
    ((abC <= 0 && abD >= 0) || (abC >= 0 && abD <= 0)) &&
    ((cdA <= 0 && cdB >= 0) || (cdA >= 0 && cdB <= 0))
  );
}

function arcIntersectsBox(entity: Extract<Entity, { type: "arc" }>, box: BoundingBox): boolean {
  const candidates: Point2D[] = [
    {
      x: entity.center.x + Math.cos(entity.startAngle) * entity.radius,
      y: entity.center.y + Math.sin(entity.startAngle) * entity.radius,
    },
    {
      x: entity.center.x + Math.cos(entity.endAngle) * entity.radius,
      y: entity.center.y + Math.sin(entity.endAngle) * entity.radius,
    },
  ];
  for (const angle of [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2]) {
    if (angleIsOnArc(angle, entity.startAngle, entity.endAngle, entity.counterClockwise)) {
      candidates.push({
        x: entity.center.x + Math.cos(angle) * entity.radius,
        y: entity.center.y + Math.sin(angle) * entity.radius,
      });
    }
  }
  if (candidates.some((point) => pointInBox(point, box))) return true;
  return [
    { x: box.minX, y: box.minY },
    { x: box.minX, y: box.maxY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
  ].some((point) => pointHitsEntity(point, entity, 0.5));
}
