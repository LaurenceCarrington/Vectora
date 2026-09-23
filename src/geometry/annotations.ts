import type {
  BoundingBox,
  DimensionAnchorReference,
  DimensionEntity,
  DimensionKind,
  Entity,
  LeaderEntity,
  Point2D,
} from "../document/types";
import { entityToPath } from "./operations/pathConversion";

const EPSILON = 1e-9;

export interface DimensionGeometry {
  readonly dimensionStart: Point2D;
  readonly dimensionEnd: Point2D;
  readonly extensionStart: readonly [Point2D, Point2D] | null;
  readonly extensionEnd: readonly [Point2D, Point2D] | null;
  readonly arrowheads: readonly (readonly [Point2D, Point2D, Point2D])[];
  readonly textAngle: number;
}

export function calculateDimensionValue(
  kind: DimensionKind,
  start: Point2D,
  end: Point2D,
  textPosition: Point2D,
): number {
  if (kind === "radial") return Math.hypot(end.x - start.x, end.y - start.y);
  if (kind === "diameter") return Math.hypot(end.x - start.x, end.y - start.y) * 2;
  if (kind === "linear") {
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    return Math.abs(textPosition.y - midpoint.y) >= Math.abs(textPosition.x - midpoint.x)
      ? Math.abs(end.x - start.x)
      : Math.abs(end.y - start.y);
  }
  return Math.hypot(end.x - start.x, end.y - start.y);
}

function arrowhead(tip: Point2D, toward: Point2D, size: number): readonly [Point2D, Point2D, Point2D] {
  const dx = toward.x - tip.x;
  const dy = toward.y - tip.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  const baseX = tip.x + ux * size;
  const baseY = tip.y + uy * size;
  return [
    tip,
    { x: baseX + nx * size * 0.38, y: baseY + ny * size * 0.38 },
    { x: baseX - nx * size * 0.38, y: baseY - ny * size * 0.38 },
  ];
}

export function getDimensionGeometry(entity: DimensionEntity): DimensionGeometry {
  const size = Math.max(0.25, entity.arrowSize);
  if (entity.dimensionKind === "radial" || entity.dimensionKind === "diameter") {
    const dimensionStart = entity.endPoint;
    const dimensionEnd = entity.textPosition;
    return {
      dimensionStart,
      dimensionEnd,
      extensionStart: null,
      extensionEnd: null,
      arrowheads: [arrowhead(dimensionStart, entity.startPoint, size)],
      textAngle: 0,
    };
  }

  let dimensionStart: Point2D;
  let dimensionEnd: Point2D;
  let textAngle = 0;
  if (entity.dimensionKind === "linear") {
    const midpoint = {
      x: (entity.startPoint.x + entity.endPoint.x) / 2,
      y: (entity.startPoint.y + entity.endPoint.y) / 2,
    };
    const horizontal = Math.abs(entity.textPosition.y - midpoint.y) >=
      Math.abs(entity.textPosition.x - midpoint.x);
    if (horizontal) {
      dimensionStart = { x: entity.startPoint.x, y: entity.textPosition.y };
      dimensionEnd = { x: entity.endPoint.x, y: entity.textPosition.y };
    } else {
      dimensionStart = { x: entity.textPosition.x, y: entity.startPoint.y };
      dimensionEnd = { x: entity.textPosition.x, y: entity.endPoint.y };
      textAngle = Math.PI / 2;
    }
  } else {
    const dx = entity.endPoint.x - entity.startPoint.x;
    const dy = entity.endPoint.y - entity.startPoint.y;
    const length = Math.hypot(dx, dy) || 1;
    const normal = { x: -dy / length, y: dx / length };
    let offset = (entity.textPosition.x - entity.startPoint.x) * normal.x +
      (entity.textPosition.y - entity.startPoint.y) * normal.y;
    if (Math.abs(offset) < EPSILON) offset = size * 3;
    dimensionStart = {
      x: entity.startPoint.x + normal.x * offset,
      y: entity.startPoint.y + normal.y * offset,
    };
    dimensionEnd = {
      x: entity.endPoint.x + normal.x * offset,
      y: entity.endPoint.y + normal.y * offset,
    };
    textAngle = Math.atan2(dy, dx);
    if (textAngle > Math.PI / 2 || textAngle < -Math.PI / 2) textAngle += Math.PI;
  }

  const dx = dimensionEnd.x - dimensionStart.x;
  const dy = dimensionEnd.y - dimensionStart.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const overshoot = size * 0.55;
  return {
    dimensionStart,
    dimensionEnd,
    extensionStart: [
      entity.startPoint,
      { x: dimensionStart.x + nx * overshoot, y: dimensionStart.y + ny * overshoot },
    ],
    extensionEnd: [
      entity.endPoint,
      { x: dimensionEnd.x + nx * overshoot, y: dimensionEnd.y + ny * overshoot },
    ],
    arrowheads: [
      arrowhead(dimensionStart, dimensionEnd, size),
      arrowhead(dimensionEnd, dimensionStart, size),
    ],
    textAngle,
  };
}

export function formatDimensionText(entity: DimensionEntity): string {
  const precision = Math.min(8, Math.max(0, Math.round(entity.precision)));
  return `${entity.prefix}${entity.value.toFixed(precision)}${entity.suffix}`;
}

function includePoint(bounds: { minX: number; minY: number; maxX: number; maxY: number }, point: Point2D): void {
  bounds.minX = Math.min(bounds.minX, point.x);
  bounds.minY = Math.min(bounds.minY, point.y);
  bounds.maxX = Math.max(bounds.maxX, point.x);
  bounds.maxY = Math.max(bounds.maxY, point.y);
}

export function annotationBounds(entity: DimensionEntity | LeaderEntity): BoundingBox {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  if (entity.type === "dimension") {
    const geometry = getDimensionGeometry(entity);
    includePoint(bounds, entity.startPoint);
    includePoint(bounds, entity.endPoint);
    includePoint(bounds, entity.textPosition);
    includePoint(bounds, geometry.dimensionStart);
    includePoint(bounds, geometry.dimensionEnd);
    for (const triangle of geometry.arrowheads) for (const point of triangle) includePoint(bounds, point);
    const textWidth = Math.max(entity.arrowSize * 2, formatDimensionText(entity).length * entity.arrowSize * 0.72);
    bounds.minX = Math.min(bounds.minX, entity.textPosition.x - textWidth / 2);
    bounds.maxX = Math.max(bounds.maxX, entity.textPosition.x + textWidth / 2);
    bounds.minY = Math.min(bounds.minY, entity.textPosition.y - entity.arrowSize);
    bounds.maxY = Math.max(bounds.maxY, entity.textPosition.y + entity.arrowSize);
  } else {
    includePoint(bounds, entity.arrowPoint);
    includePoint(bounds, entity.elbowPoint);
    includePoint(bounds, entity.textPosition);
    bounds.maxX += Math.max(4, entity.text.length * 3.2);
    bounds.minY -= 4;
    bounds.maxY += 4;
  }
  return Object.freeze(bounds);
}

function closestPathParameter(points: readonly Point2D[], closed: boolean, target: Point2D): number {
  if (points.length < 2) return 0;
  const segmentCount = closed ? points.length : points.length - 1;
  const lengths = new Array<number>(segmentCount);
  let total = 0;
  for (let index = 0; index < segmentCount; index += 1) {
    const start = points[index]!;
    const end = points[(index + 1) % points.length]!;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    lengths[index] = length;
    total += length;
  }
  if (total <= EPSILON) return 0;
  let traversed = 0;
  let bestDistance = Infinity;
  let bestDistanceAlong = 0;
  for (let index = 0; index < segmentCount; index += 1) {
    const start = points[index]!;
    const end = points[(index + 1) % points.length]!;
    const length = lengths[index] ?? 0;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const fraction = length <= EPSILON ? 0 : Math.max(0, Math.min(1,
      ((target.x - start.x) * dx + (target.y - start.y) * dy) / (length * length),
    ));
    const x = start.x + dx * fraction;
    const y = start.y + dy * fraction;
    const distance = Math.hypot(target.x - x, target.y - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestDistanceAlong = traversed + length * fraction;
    }
    traversed += length;
  }
  return bestDistanceAlong / total;
}

export function createDimensionReference(
  entity: Entity | undefined,
  point: Point2D,
  snapType: "endpoint" | "midpoint" | "center" | "intersection" | null,
): DimensionAnchorReference | undefined {
  if (!entity || entity.type === "dimension" || entity.type === "leader") return undefined;
  if (snapType === "center") return { entityId: entity.id, mode: "center", parameter: 0 };
  const path = entityToPath(entity, { tolerance: 0.05, minimumSegments: 32, maximumSegments: 512 });
  if (!path) return undefined;
  return {
    entityId: entity.id,
    mode: "path",
    parameter: closestPathParameter(path.points, path.closed, point),
  };
}

function entityCenter(entity: Entity): Point2D {
  if (entity.type === "circle" || entity.type === "arc") return entity.center;
  if (
    entity.type === "ellipse" || entity.type === "polygon" || entity.type === "quadrant" ||
    entity.type === "semicircle" || entity.type === "segment" || entity.type === "star"
  ) return { x: entity.cx, y: entity.cy };
  return { x: (entity.bbox.minX + entity.bbox.maxX) / 2, y: (entity.bbox.minY + entity.bbox.maxY) / 2 };
}

export function resolveDimensionReference(
  reference: DimensionAnchorReference | undefined,
  entities: ReadonlyMap<string, Entity>,
): Point2D | null {
  if (!reference) return null;
  const entity = entities.get(reference.entityId);
  if (!entity) return null;
  if (reference.mode === "center") return entityCenter(entity);
  const path = entityToPath(entity, { tolerance: 0.05, minimumSegments: 32, maximumSegments: 512 });
  if (!path || path.points.length < 2) return null;
  const segmentCount = path.closed ? path.points.length : path.points.length - 1;
  let total = 0;
  for (let index = 0; index < segmentCount; index += 1) {
    const start = path.points[index]!;
    const end = path.points[(index + 1) % path.points.length]!;
    total += Math.hypot(end.x - start.x, end.y - start.y);
  }
  let remaining = Math.max(0, Math.min(1, reference.parameter)) * total;
  for (let index = 0; index < segmentCount; index += 1) {
    const start = path.points[index]!;
    const end = path.points[(index + 1) % path.points.length]!;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (remaining <= length || index === segmentCount - 1) {
      const fraction = length <= EPSILON ? 0 : remaining / length;
      return { x: start.x + (end.x - start.x) * fraction, y: start.y + (end.y - start.y) * fraction };
    }
    remaining -= length;
  }
  return null;
}

export function updateBoundDimension(
  dimension: DimensionEntity,
  entities: ReadonlyMap<string, Entity>,
): DimensionEntity {
  const startPoint = resolveDimensionReference(dimension.references?.start, entities) ?? dimension.startPoint;
  const endPoint = resolveDimensionReference(dimension.references?.end, entities) ?? dimension.endPoint;
  const oldDx = dimension.endPoint.x - dimension.startPoint.x;
  const oldDy = dimension.endPoint.y - dimension.startPoint.y;
  const newDx = endPoint.x - startPoint.x;
  const newDy = endPoint.y - startPoint.y;
  const oldLength = Math.hypot(oldDx, oldDy);
  const newLength = Math.hypot(newDx, newDy);

  let textPosition = dimension.textPosition;
  if (oldLength > EPSILON && newLength > EPSILON) {
    const oldUx = oldDx / oldLength;
    const oldUy = oldDy / oldLength;
    const newUx = newDx / newLength;
    const newUy = newDy / newLength;
    const textDx = dimension.textPosition.x - dimension.startPoint.x;
    const textDy = dimension.textPosition.y - dimension.startPoint.y;
    const along = textDx * oldUx + textDy * oldUy;
    const normal = textDx * -oldUy + textDy * oldUx;
    const scale = newLength / oldLength;
    textPosition = {
      x: startPoint.x + (newUx * along - newUy * normal) * scale,
      y: startPoint.y + (newUy * along + newUx * normal) * scale,
    };
  } else if (startPoint.x !== dimension.startPoint.x || startPoint.y !== dimension.startPoint.y) {
    textPosition = {
      x: dimension.textPosition.x + startPoint.x - dimension.startPoint.x,
      y: dimension.textPosition.y + startPoint.y - dimension.startPoint.y,
    };
  }

  return {
    ...dimension,
    startPoint,
    endPoint,
    textPosition,
    value: calculateDimensionValue(dimension.dimensionKind, startPoint, endPoint, textPosition),
  };
}
