import polygonClipping, {
  type MultiPolygon,
  type Pair,
  type Polygon,
  type Ring,
} from "polygon-clipping";
import type {
  Entity,
  EntityId,
  EntityStyle,
  LayerId,
  ManufacturingIntent,
  Point2D,
  PolylineEntity,
} from "../../document/types";
import { boundsFromPoints, createGeneratorId } from "../generators/common";
import { buildContourHierarchy, signedPolygonArea } from "../topology";
import { entityToClosedPath, type CurveFlattenOptions } from "./pathConversion";
import {
  assertSelectionEditable,
  resolveResultLayerId,
  type OperationLayerContext,
} from "./operationSafety";

export type BooleanOperation = "union" | "difference" | "intersection" | "xor";

export interface BooleanPathOptions extends CurveFlattenOptions {
  /** Coordinates closer than this value are treated as the same vertex. */
  readonly coordinateEpsilon?: number;
}

export interface BooleanOptions extends BooleanPathOptions, OperationLayerContext {
  /** Preferred output layer. A locked or missing layer safely falls back to the subject layer. */
  readonly resultLayerId?: LayerId;
  /** Bottom-to-top entity ids. Subtract uses the lowest selected id as its subject. */
  readonly zOrder?: readonly EntityId[];
  /** Optional user-selected subject. When omitted, the bottom-most operand is used. */
  readonly primaryEntityId?: EntityId;
}

export interface PolygonsToEntitiesOptions {
  readonly style?: EntityStyle;
  readonly visible?: boolean;
  readonly namePrefix?: string;
}

const DEFAULT_EPSILON = 1e-9;
const DEFAULT_STYLE: EntityStyle = Object.freeze({
  strokeColor: null,
  strokeWidth: 1,
  fillColor: null,
  dashArray: Object.freeze([]),
});

function samePair(left: Pair, right: Pair, epsilon: number): boolean {
  return Math.abs(left[0] - right[0]) <= epsilon && Math.abs(left[1] - right[1]) <= epsilon;
}

function normalizedOpenRing(points: readonly Point2D[], epsilon: number): Ring {
  const ring: Ring = [];
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new TypeError("Boolean paths must contain only finite coordinates.");
    }
    const pair: Pair = [point.x, point.y];
    const previous = ring.at(-1);
    if (!previous || !samePair(previous, pair, epsilon)) ring.push(pair);
  }
  if (ring.length > 1 && samePair(ring[0]!, ring.at(-1)!, epsilon)) ring.pop();
  if (ring.length < 3) throw new RangeError("Boolean paths require at least three distinct vertices.");
  const area = signedPolygonArea(ring.map(([x, y]) => ({ x, y })));
  if (!Number.isFinite(area) || Math.abs(area) <= epsilon * epsilon) {
    throw new RangeError("Boolean paths must enclose a non-zero area.");
  }
  return ring;
}

function closedRing(points: readonly Point2D[], epsilon: number): Ring {
  const ring = normalizedOpenRing(points, epsilon);
  ring.push([ring[0]![0], ring[0]![1]]);
  return ring;
}

/** Reconstructs compound shells, direct holes and nested material islands. */
export function entitiesToPolygons(
  entities: readonly Entity[],
  options: BooleanPathOptions = {},
): MultiPolygon {
  const epsilon = options.coordinateEpsilon ?? DEFAULT_EPSILON;
  if (!Number.isFinite(epsilon) || epsilon <= 0) {
    throw new RangeError("Boolean coordinate epsilon must be greater than zero.");
  }
  const hierarchy = buildContourHierarchy(entities, options);
  // Hierarchy skips invalid profiles; Boolean inputs must reject them explicitly.
  for (const entity of entities) {
    const path = entityToClosedPath(entity, options);
    if (!path) {
      const label = entity.name?.trim() || entity.type;
      throw new TypeError(`Boolean operations require closed paths; ${label} is open.`);
    }
    closedRing(path, epsilon);
    if (!hierarchy.byEntityId.has(entity.id)) throw new RangeError("Boolean paths must enclose a non-zero area.");
  }
  return hierarchy.solidBoundaries.map((node) => [
    closedRing(node.path, epsilon),
    ...node.holes.map((hole) => closedRing(hole.path, epsilon)),
  ]);
}

function resultRingToPoints(ring: Ring, epsilon: number): readonly Point2D[] | null {
  if (ring.length < 4) return null;
  const points: Point2D[] = [];
  for (const pair of ring) {
    if (!Number.isFinite(pair[0]) || !Number.isFinite(pair[1])) {
      throw new TypeError("The Boolean solver returned a non-finite coordinate.");
    }
    const point = { x: pair[0], y: pair[1] };
    const previous = points.at(-1);
    if (!previous || Math.abs(previous.x - point.x) > epsilon || Math.abs(previous.y - point.y) > epsilon) {
      points.push(point);
    }
  }
  if (points.length > 1) {
    const first = points[0]!;
    const last = points.at(-1)!;
    if (Math.abs(first.x - last.x) <= epsilon && Math.abs(first.y - last.y) <= epsilon) points.pop();
  }
  if (points.length < 3 || Math.abs(signedPolygonArea(points)) <= epsilon * epsilon) return null;
  return points;
}

/**
 * Converts every exterior and hole ring to a separate closed Vectora contour.
 * Ring orientation is retained, allowing the shared topology/CAM pipeline to
 * reconstruct holes and material islands deterministically.
 */
export function polygonsToEntities(
  polygons: MultiPolygon,
  originalLayerId: LayerId,
  originalIntent: ManufacturingIntent,
  options: PolygonsToEntitiesOptions = {},
): readonly PolylineEntity[] {
  const entities: PolylineEntity[] = [];
  const style = options.style ?? DEFAULT_STYLE;
  const namePrefix = options.namePrefix?.trim() || "Boolean result";
  const compoundId = createGeneratorId("boolean-compound", 0, {});
  for (const polygon of polygons) {
    for (const ring of polygon) {
      const points = resultRingToPoints(ring, DEFAULT_EPSILON);
      if (!points) continue;
      const index = entities.length;
      entities.push({
        id: createGeneratorId("boolean", index, {}),
        compoundId,
        name: `${namePrefix} ${index + 1}`,
        type: "polyline",
        layerId: originalLayerId,
        intent: originalIntent,
        style: { ...style, dashArray: [...style.dashArray] },
        bbox: boundsFromPoints(points),
        visible: options.visible ?? true,
        locked: false,
        points: points.map((point) => ({ x: point.x, y: point.y })),
        closed: true,
      });
    }
  }
  return Object.freeze(entities);
}

function orderEntities(entities: readonly Entity[], zOrder: readonly EntityId[] | undefined): readonly Entity[] {
  const unique = new Set<EntityId>();
  for (const entity of entities) {
    if (unique.has(entity.id)) throw new Error(`Duplicate Boolean operand "${entity.id}".`);
    unique.add(entity.id);
  }
  if (!zOrder) return entities;
  const indexById = new Map(zOrder.map((id, index) => [id, index]));
  return [...entities].sort((left, right) =>
    (indexById.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
    (indexById.get(right.id) ?? Number.MAX_SAFE_INTEGER));
}

function operationContext(
  entities: readonly Entity[],
  options: BooleanOptions,
  namePrefix: string,
  reconstructSelection = false,
): {
  readonly ordered: readonly Entity[];
  readonly polygons: readonly MultiPolygon[];
  readonly resultLayerId: LayerId;
  readonly primary: Entity;
  readonly output: PolygonsToEntitiesOptions;
} {
  if (entities.length < 2) throw new RangeError("Select at least two closed entities for a Boolean operation.");
  assertSelectionEditable(entities, options.layers);
  const zOrdered = orderEntities(entities, options.zOrder);
  const requestedPrimary = options.primaryEntityId
    ? zOrdered.find((entity) => entity.id === options.primaryEntityId)
    : undefined;
  if (options.primaryEntityId && !requestedPrimary) {
    throw new Error(`Primary Boolean subject "${options.primaryEntityId}" is not selected.`);
  }
  const ordered = requestedPrimary
    ? [requestedPrimary, ...zOrdered.filter((entity) => entity.id !== requestedPrimary.id)]
    : zOrdered;
  const primary = ordered[0]!;
  const spansMultipleLayers = ordered.some((entity) => entity.layerId !== primary.layerId);
  const resultLayerId = resolveResultLayerId(
    primary,
    spansMultipleLayers ? options.resultLayerId : primary.layerId,
    options.layers,
  );
  // A contained cutter is still a separate operand. Only contours sharing a
  // source/result relationship belong to the same compound profile.
  const operands = new Map<string, Entity[]>();
  for (const entity of ordered) {
    const key = entity.compoundId ? `compound:${entity.compoundId}`
      : reconstructSelection ? "selection:ungrouped" : `entity:${entity.id}`;
    const operand = operands.get(key) ?? [];
    operand.push(entity);
    operands.set(key, operand);
  }
  return {
    ordered,
    polygons: [...operands.values()].map((operand) => entitiesToPolygons(operand, options)),
    resultLayerId,
    primary,
    output: {
      style: primary.style,
      visible: primary.visible,
      namePrefix,
    },
  };
}

function finishResult(
  result: MultiPolygon,
  context: ReturnType<typeof operationContext>,
): readonly PolylineEntity[] {
  return polygonsToEntities(
    result,
    context.resultLayerId,
    context.primary.intent,
    context.output,
  );
}

export function weldEntities(
  entities: readonly Entity[],
  options: BooleanOptions,
): readonly PolylineEntity[] {
  const context = operationContext(entities, options, "Weld", true);
  const [first, ...rest] = context.polygons;
  return finishResult(polygonClipping.union(first!, ...rest), context);
}

export function subtractEntities(
  entities: readonly Entity[],
  options: BooleanOptions,
): readonly PolylineEntity[] {
  const context = operationContext(entities, options, "Subtract");
  const [subject, ...cutters] = context.polygons;
  return finishResult(polygonClipping.difference(subject!, ...cutters), context);
}

export function intersectEntities(
  entities: readonly Entity[],
  options: BooleanOptions,
): readonly PolylineEntity[] {
  const context = operationContext(entities, options, "Intersect");
  const [first, ...rest] = context.polygons;
  return finishResult(polygonClipping.intersection(first!, ...rest), context);
}

export function excludeEntities(
  entities: readonly Entity[],
  options: BooleanOptions,
): readonly PolylineEntity[] {
  const context = operationContext(entities, options, "Exclude");
  const [first, ...rest] = context.polygons;
  return finishResult(polygonClipping.xor(first!, ...rest), context);
}

/** Compatibility entry point retained for existing callers and saved history labels. */
export function applyBooleanOperation(
  entities: readonly Entity[],
  operation: BooleanOperation,
  options: BooleanOptions,
): readonly PolylineEntity[] {
  switch (operation) {
    case "union": return weldEntities(entities, options);
    case "difference": return subtractEntities(entities, options);
    case "intersection": return intersectEntities(entities, options);
    case "xor": return excludeEntities(entities, options);
  }
}

/** Lower-level compatibility helper used by geometry tests and non-UI consumers. */
export function booleanPaths(
  operation: BooleanOperation,
  subject: readonly (readonly Point2D[])[],
  clip: readonly (readonly Point2D[])[] = [],
  options: BooleanPathOptions = {},
): readonly (readonly Point2D[])[] {
  if (subject.length === 0) throw new RangeError("A Boolean operation requires at least one subject path.");
  const epsilon = options.coordinateEpsilon ?? DEFAULT_EPSILON;
  const subjects: MultiPolygon = subject.map((path) => [closedRing(path, epsilon)]);
  const clips: MultiPolygon = clip.map((path) => [closedRing(path, epsilon)]);
  let result: MultiPolygon;
  if (operation === "union") {
    const all = [...subjects, ...clips];
    const [first, ...rest] = all;
    result = polygonClipping.union(first!, ...rest);
  } else if (operation === "difference") {
    result = polygonClipping.difference(subjects, clips);
  } else if (operation === "intersection") {
    if (clips.length === 0) return [];
    result = polygonClipping.intersection(subjects, clips);
  } else {
    if (clips.length === 0) return subject;
    result = polygonClipping.xor(subjects, clips);
  }
  return result.flatMap((polygon: Polygon) => polygon)
    .map((ring) => resultRingToPoints(ring, epsilon))
    .filter((path): path is readonly Point2D[] => path !== null);
}
