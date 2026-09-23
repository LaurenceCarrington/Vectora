import { documentModel } from "../document/DocumentModel";
import type { ArcEntity, BoundingBox, Entity, EntityId, Point2D } from "../document/types";
import { gridSizeInDocumentUnits, useVectorStore, type DraftingPreferences, type GridStyle } from "../store/useVectorStore";
import { ISOMETRIC_ROW_HEIGHT_RATIO } from "./GridGeometry";
import { vectoraRenderColors } from "../design/vectoraRenderColors";

export type SnapType = "endpoint" | "midpoint" | "center" | "intersection";

export interface SnapResult {
  readonly point: Point2D;
  readonly type: SnapType;
  readonly distancePx: number;
  readonly entityIds: readonly EntityId[];
}

export interface SnapQuery {
  readonly cursor: Point2D;
  readonly zoom: number;
  /** Optional isolated source used by tests/import previews. The live canvas uses DocumentModel's index. */
  readonly entities?: readonly Entity[];
  readonly thresholdPx?: number;
  readonly enabledTypes?: readonly SnapType[];
  readonly excludeEntityIds?: ReadonlySet<EntityId>;
  /** Origin for an explicitly requested isometric drawing constraint (Shift). */
  readonly angleOrigin?: Point2D;
}

export interface DraftingSnapResult {
  readonly point: Point2D;
  readonly snap: SnapResult | null;
}

export interface SnapIndicatorSpec {
  readonly color: string;
  readonly fill: string;
  readonly sizePx: number;
  readonly lineWidthPx: number;
}

export const SNAP_INDICATOR_SPEC: Readonly<Record<SnapType, SnapIndicatorSpec>> = Object.freeze({
  endpoint: Object.freeze({ color: vectoraRenderColors.ui.snap, fill: vectoraRenderColors.ui.surface, sizePx: 10, lineWidthPx: 1.5 }),
  midpoint: Object.freeze({ color: vectoraRenderColors.ui.snap, fill: vectoraRenderColors.ui.surface, sizePx: 11, lineWidthPx: 1.5 }),
  center: Object.freeze({ color: vectoraRenderColors.ui.snap, fill: vectoraRenderColors.ui.surface, sizePx: 10, lineWidthPx: 1.5 }),
  intersection: Object.freeze({ color: vectoraRenderColors.ui.snap, fill: vectoraRenderColors.ui.surface, sizePx: 11, lineWidthPx: 1.5 }),
});

/**
 * Takes ownership of an allocation-free snap result's current coordinate.
 * Callers that retain an anchor beyond the current pointer event must use this
 * snapshot because the live SnapResult is intentionally reused on the next query.
 */
export function snapshotSnapPoint(result: SnapResult): Point2D {
  const { x, y } = result.point;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new TypeError("Cannot snapshot a non-finite OSNAP coordinate.");
  }
  return { x, y };
}

interface LinePrimitive {
  kind: "line";
  start: Point2D;
  end: Point2D;
  entityId: EntityId;
}

interface CirclePrimitive {
  kind: "circle";
  center: Point2D;
  radius: number;
  entityId: EntityId;
  arc: ArcEntity | null;
}

type Primitive = LinePrimitive | CirclePrimitive;

const DEFAULT_THRESHOLD_PX = 10;
const EPSILON = 1e-9;
const TAU = Math.PI * 2;
// Primitive lattice vectors for 0, 30, 60, 90, 120 and 150 degrees.
const ISOMETRIC_ANGLE_VECTORS = [[2, 0], [1, 1], [1, 3], [0, 2], [-1, 3], [-1, 1]] as const;
const TYPE_PRIORITY: Readonly<Record<SnapType, number>> = {
  endpoint: 0,
  intersection: 1,
  midpoint: 2,
  center: 3,
};

// Reused query storage keeps the normal pointer path allocation-light.
const indexedCandidates: Entity[] = [];
const isolatedCandidates: Entity[] = [];
const primitives: Primitive[] = [];
const linePool: LinePrimitive[] = [];
const circlePool: CirclePrimitive[] = [];
const queryBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
const resultPoint = { x: 0, y: 0 };
const resultEntityIds: EntityId[] = [];
const reusableResult = {
  point: resultPoint,
  type: "endpoint" as SnapType,
  distancePx: 0,
  entityIds: resultEntityIds,
};

/** Returns the one canonical grid spacing in active document/world units. */
export function getWorldGridSpacing(): number {
  const drafting = useVectorStore.getState().preferences.drafting;
  return gridSizeInDocumentUnits(drafting, documentModel.getDocument().units);
}

export function getAngleSnapDegrees(drafting: DraftingPreferences = useVectorStore.getState().preferences.drafting): number {
  return drafting.gridStyle === "isometric" ? 30 : drafting.angleSnapDeg;
}

export function isGridSnapEnabled(): boolean {
  const drafting = useVectorStore.getState().preferences.drafting;
  return drafting.snapToGrid;
}

/** Snaps a world-space scalar to the grid lattice whose origin is world (0, 0). */
export function snapWorldCoordinate(value: number, gridSpacing = getWorldGridSpacing()): number {
  if (!Number.isFinite(value)) throw new TypeError("A grid coordinate must be finite.");
  if (!Number.isFinite(gridSpacing) || gridSpacing <= 0) {
    throw new RangeError("Grid spacing must be a finite number greater than zero.");
  }
  // Avoid displaying -0 while preserving the exact requested lattice.
  const snapped = Math.round(value / gridSpacing) * gridSpacing;
  return Object.is(snapped, -0) ? 0 : snapped;
}

/** Grid snapping is intentionally independent of viewport pan, zoom, and DPR. */
export function snapWorldPointToGrid(
  point: Point2D,
  gridSpacing = getWorldGridSpacing(),
  gridStyle: GridStyle = useVectorStore.getState().preferences.drafting.gridStyle,
): Point2D {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new TypeError("A grid coordinate must be finite.");
  if (!Number.isFinite(gridSpacing) || gridSpacing <= 0) {
    throw new RangeError("Grid spacing must be a finite number greater than zero.");
  }
  if (gridStyle === "isometric") {
    const rowHeight = gridSpacing * ISOMETRIC_ROW_HEIGHT_RATIO;
    // The line-family coordinates are u = x/s, v = (sqrt(3)y-x)/(2s),
    // w = u+v. All three must be integral at a rendered intersection.
    // For each adjacent column choose its nearest staggered row, then compare
    // Euclidean distances. Rounding u/v independently is not a nearest-point
    // solver in this oblique basis. More distant columns cannot be closer.
    const u = point.x / gridSpacing;
    const column = Math.floor(u);
    let best = { x: 0, y: 0 };
    let bestDistance = Infinity;
    for (let offset = 0; offset <= 1; offset += 1) {
      const i = column + offset;
      const row = 2 * Math.round((point.y / rowHeight - i) / 2) + i;
      const x = i * gridSpacing;
      const y = row * rowHeight;
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
      }
    }
    return best;
  }
  return {
    x: snapWorldCoordinate(point.x, gridSpacing),
    y: snapWorldCoordinate(point.y, gridSpacing),
  };
}

/**
 * Quantizes a world-space displacement to whole grid increments.
 *
 * This is deliberately separate from absolute-point snapping used by drawing
 * and resize tools. A move starts at an arbitrary grab point inside the
 * selection, so only its displacement may be quantized safely.
 */
export function snapWorldDeltaToGrid(
  delta: Point2D,
  gridSpacing = getWorldGridSpacing(),
  gridStyle: GridStyle = useVectorStore.getState().preferences.drafting.gridStyle,
): Point2D {
  return snapWorldPointToGrid(delta, gridSpacing, gridStyle);
}

/** Constrain a drawing ray, retaining exact triangular vertices when possible. */
export function snapWorldPointToAngle(point: Point2D, origin: Point2D): Point2D {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const increment = getAngleSnapDegrees() * Math.PI / 180;
  const direction = Math.round(Math.atan2(dy, dx) / increment);
  const angle = direction * increment;
  const drafting = useVectorStore.getState().preferences.drafting;
  if (isGridSnapEnabled() && drafting.gridStyle === "isometric") {
    const spacing = getWorldGridSpacing();
    const anchor = snapWorldPointToGrid(origin, spacing);
    const tolerance = Math.max(1, spacing, Math.abs(origin.x), Math.abs(origin.y)) * 1e-10;
    // A document/style change can leave a drawing anchor off this lattice.
    // Preserve the authoritative grid policy in that case.
    if (Math.hypot(anchor.x - origin.x, anchor.y - origin.y) > tolerance) {
      return snapWorldPointToGrid(point, spacing);
    }
    const index = ((direction % 12) + 12) % 12;
    const vector = ISOMETRIC_ANGLE_VECTORS[index % 6]!;
    const sign = index < 6 ? 1 : -1;
    const stepX = vector[0] * spacing * sign;
    const stepY = vector[1] * spacing * ISOMETRIC_ROW_HEIGHT_RATIO * sign;
    const count = Math.max(0, Math.round((dx * stepX + dy * stepY) / (stepX * stepX + stepY * stepY)));
    return snapWorldPointToGrid({ x: anchor.x + count * stepX, y: anchor.y + count * stepY }, spacing);
  }
  const radius = Math.hypot(dx, dy);
  return { x: origin.x + Math.cos(angle) * radius, y: origin.y + Math.sin(angle) * radius };
}

/**
 * Resolves the combined Grid Snap + OSNAP policy in world space. When Grid
 * Snap is enabled it is authoritative: an object snap is accepted only when
 * that object candidate already lies on the same grid lattice. This prevents
 * an off-grid endpoint/midpoint from silently overriding the visible grid.
 */
export function resolveDraftingSnap(query: SnapQuery): DraftingSnapResult {
  const drafting = useVectorStore.getState().preferences.drafting;
  if (query.angleOrigin && drafting.gridStyle === "isometric") {
    const { angleOrigin, ...unconstrained } = query;
    const point = snapWorldPointToAngle(query.cursor, angleOrigin);
    const result = resolveDraftingSnap({ ...unconstrained, cursor: point });
    // An OSNAP candidate must not pull a constrained point off the chosen ray.
    return result.point.x === point.x && result.point.y === point.y ? result : { point, snap: null };
  }
  const objectSnap = findObjectSnap(query);
  if (!drafting.snapToGrid) {
    return objectSnap
      ? { point: snapshotSnapPoint(objectSnap), snap: objectSnap }
      : { point: { x: query.cursor.x, y: query.cursor.y }, snap: null };
  }

  const spacing = getWorldGridSpacing();
  const gridPoint = snapWorldPointToGrid(query.cursor, spacing, drafting.gridStyle);
  if (objectSnap) {
    const objectGridPoint = snapWorldPointToGrid(objectSnap.point, spacing, drafting.gridStyle);
    const scale = Math.max(1, spacing, Math.abs(objectSnap.point.x), Math.abs(objectSnap.point.y));
    const tolerance = scale * 1e-10;
    if (
      Math.abs(objectGridPoint.x - objectSnap.point.x) <= tolerance &&
      Math.abs(objectGridPoint.y - objectSnap.point.y) <= tolerance
    ) {
      return { point: snapshotSnapPoint(objectSnap), snap: objectSnap };
    }
  }
  return { point: gridPoint, snap: null };
}

function intersects(left: BoundingBox, right: BoundingBox): boolean {
  return !(
    left.maxX < right.minX || left.minX > right.maxX ||
    left.maxY < right.minY || left.minY > right.maxY
  );
}

function normalizeAngle(angle: number): number {
  const normalized = angle % TAU;
  return normalized < 0 ? normalized + TAU : normalized;
}

function pointIsOnArc(x: number, y: number, arc: ArcEntity): boolean {
  const angle = normalizeAngle(Math.atan2(y - arc.center.y, x - arc.center.x));
  const start = normalizeAngle(arc.startAngle);
  const end = normalizeAngle(arc.endAngle);
  return arc.counterClockwise
    ? normalizeAngle(start - angle) <= normalizeAngle(start - end) + EPSILON
    : normalizeAngle(angle - start) <= normalizeAngle(end - start) + EPSILON;
}

function addLine(start: Point2D, end: Point2D, entityId: EntityId, index: number): number {
  let primitive = linePool[index];
  if (!primitive) {
    primitive = { kind: "line", start, end, entityId };
    linePool[index] = primitive;
  } else {
    primitive.start = start;
    primitive.end = end;
    primitive.entityId = entityId;
  }
  primitives.push(primitive);
  return index + 1;
}

function addCircle(entity: Extract<Entity, { type: "circle" | "arc" }>, index: number): number {
  let primitive = circlePool[index];
  if (!primitive) {
    primitive = {
      kind: "circle",
      center: entity.center,
      radius: entity.radius,
      entityId: entity.id,
      arc: entity.type === "arc" ? entity : null,
    };
    circlePool[index] = primitive;
  } else {
    primitive.center = entity.center;
    primitive.radius = entity.radius;
    primitive.entityId = entity.id;
    primitive.arc = entity.type === "arc" ? entity : null;
  }
  primitives.push(primitive);
  return index + 1;
}

function midpointCoordinate(start: number, end: number): number {
  // Halving before addition avoids overflowing when valid finite CAD
  // coordinates are very large. Numbers are values, so no mutable entity
  // point reference is ever retained by the candidate solver.
  return start / 2 + end / 2;
}

/**
 * Finds the nearest CAD snap from spatially-local candidates. Live document
 * queries are O(k + k²), where k is the small number of entities in the cursor
 * neighborhood; total document size is not part of the pointer cost.
 */
export function findObjectSnap(query: SnapQuery): SnapResult | null {
  const zoom = Math.max(query.zoom, EPSILON);
  const drafting = useVectorStore.getState().preferences.drafting;
  const thresholdPx = query.thresholdPx ?? drafting.osnapRadiusPx ?? DEFAULT_THRESHOLD_PX;
  const enabledTypes = query.enabledTypes ?? drafting.osnapEnabledTypes;
  if (enabledTypes.length === 0) return null;
  const intersectionsEnabled = enabledTypes.includes("intersection");
  const radius = thresholdPx / zoom;
  queryBounds.minX = query.cursor.x - radius;
  queryBounds.minY = query.cursor.y - radius;
  queryBounds.maxX = query.cursor.x + radius;
  queryBounds.maxY = query.cursor.y + radius;

  let candidates: readonly Entity[];
  if (query.entities) {
    isolatedCandidates.length = 0;
    for (const entity of query.entities) {
      if (entity.visible && intersects(entity.bbox, queryBounds)) isolatedCandidates.push(entity);
    }
    candidates = isolatedCandidates;
  } else {
    candidates = documentModel.queryVisibleEntities(queryBounds, indexedCandidates);
  }

  let found = false;
  let bestDistance = Infinity;
  let bestPriority = Infinity;
  const excluded = query.excludeEntityIds;

  const consider = (x: number, y: number, type: SnapType, firstId: EntityId, secondId?: EntityId): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!enabledTypes.includes(type)) return;
    if (excluded?.has(firstId) || (secondId !== undefined && excluded?.has(secondId))) return;
    const dx = x - query.cursor.x;
    const dy = y - query.cursor.y;
    const distancePx = Math.sqrt(dx * dx + dy * dy) * zoom;
    if (distancePx > thresholdPx + EPSILON) return;
    const priority = TYPE_PRIORITY[type];
    if (found && distancePx >= bestDistance - 0.1 && (Math.abs(distancePx - bestDistance) > 0.1 || priority >= bestPriority)) return;
    found = true;
    bestDistance = distancePx;
    bestPriority = priority;
    resultPoint.x = x;
    resultPoint.y = y;
    reusableResult.type = type;
    reusableResult.distancePx = distancePx;
    resultEntityIds[0] = firstId;
    if (secondId === undefined) resultEntityIds.length = 1;
    else {
      resultEntityIds[1] = secondId;
      resultEntityIds.length = 2;
    }
  };

  primitives.length = 0;
  let lineCount = 0;
  let circleCount = 0;
  for (const entity of candidates) {
    if (excluded?.has(entity.id)) continue;
    switch (entity.type) {
      case "line":
        consider(entity.start.x, entity.start.y, "endpoint", entity.id);
        consider(entity.end.x, entity.end.y, "endpoint", entity.id);
        consider(
          midpointCoordinate(entity.start.x, entity.end.x),
          midpointCoordinate(entity.start.y, entity.end.y),
          "midpoint",
          entity.id,
        );
        if (intersectionsEnabled) lineCount = addLine(entity.start, entity.end, entity.id, lineCount);
        break;
      case "polyline": {
        const points = entity.points;
        for (let index = 0; index < points.length; index += 1) {
          const point = points[index];
          if (!point) continue;
          consider(point.x, point.y, "endpoint", entity.id);
          if (index > 0) {
            const previous = points[index - 1];
            if (previous) {
              consider(
                midpointCoordinate(previous.x, point.x),
                midpointCoordinate(previous.y, point.y),
                "midpoint",
                entity.id,
              );
              if (intersectionsEnabled) lineCount = addLine(previous, point, entity.id, lineCount);
            }
          }
        }
        const first = points[0];
        const last = points.at(-1);
        if (entity.closed && first && last) {
          consider(
            midpointCoordinate(last.x, first.x),
            midpointCoordinate(last.y, first.y),
            "midpoint",
            entity.id,
          );
          if (intersectionsEnabled) lineCount = addLine(last, first, entity.id, lineCount);
        }
        break;
      }
      case "rectangle": {
        const x1 = entity.origin.x;
        const y1 = entity.origin.y;
        const x2 = x1 + entity.width;
        const y2 = y1 + entity.height;
        const corners = [
          { x: x1, y: y1 }, { x: x2, y: y1 },
          { x: x2, y: y2 }, { x: x1, y: y2 },
        ];
        for (let index = 0; index < 4; index += 1) {
          const start = corners[index]!;
          const end = corners[(index + 1) % 4]!;
          consider(start.x, start.y, "endpoint", entity.id);
          consider(
            midpointCoordinate(start.x, end.x),
            midpointCoordinate(start.y, end.y),
            "midpoint",
            entity.id,
          );
          if (intersectionsEnabled) lineCount = addLine(start, end, entity.id, lineCount);
        }
        break;
      }
      case "circle":
        consider(entity.center.x, entity.center.y, "center", entity.id);
        if (intersectionsEnabled) circleCount = addCircle(entity, circleCount);
        break;
      case "arc":
        consider(entity.center.x, entity.center.y, "center", entity.id);
        consider(entity.center.x + Math.cos(entity.startAngle) * entity.radius, entity.center.y + Math.sin(entity.startAngle) * entity.radius, "endpoint", entity.id);
        consider(entity.center.x + Math.cos(entity.endAngle) * entity.radius, entity.center.y + Math.sin(entity.endAngle) * entity.radius, "endpoint", entity.id);
        {
          const start = normalizeAngle(entity.startAngle);
          const sweep = entity.counterClockwise
            ? normalizeAngle(start - entity.endAngle)
            : normalizeAngle(entity.endAngle - start);
          const middleAngle = entity.counterClockwise ? start - sweep / 2 : start + sweep / 2;
          consider(
            entity.center.x + Math.cos(middleAngle) * entity.radius,
            entity.center.y + Math.sin(middleAngle) * entity.radius,
            "midpoint",
            entity.id,
          );
        }
        if (intersectionsEnabled) circleCount = addCircle(entity, circleCount);
        break;
      case "ellipse": {
        consider(entity.cx, entity.cy, "center", entity.id);
        const cos = Math.cos(entity.rotation);
        const sin = Math.sin(entity.rotation);
        for (const [localX, localY] of [[entity.rx, 0], [0, entity.ry], [-entity.rx, 0], [0, -entity.ry]] as const) {
          consider(entity.cx + localX * cos - localY * sin, entity.cy + localX * sin + localY * cos, "endpoint", entity.id);
        }
        break;
      }
      case "polygon": {
        consider(entity.cx, entity.cy, "center", entity.id);
        let first: Point2D | null = null;
        let previous: Point2D | null = null;
        for (let index = 0; index < entity.sides; index += 1) {
          const angle = entity.rotation + (index * TAU) / entity.sides;
          const point = { x: entity.cx + Math.cos(angle) * entity.radius, y: entity.cy + Math.sin(angle) * entity.radius };
          consider(point.x, point.y, "endpoint", entity.id);
          if (previous) {
            consider(
              midpointCoordinate(previous.x, point.x),
              midpointCoordinate(previous.y, point.y),
              "midpoint",
              entity.id,
            );
            if (intersectionsEnabled) lineCount = addLine(previous, point, entity.id, lineCount);
          } else first = point;
          previous = point;
        }
        if (first && previous) {
          consider(
            midpointCoordinate(previous.x, first.x),
            midpointCoordinate(previous.y, first.y),
            "midpoint",
            entity.id,
          );
          if (intersectionsEnabled) lineCount = addLine(previous, first, entity.id, lineCount);
        }
        break;
      }
      case "quadrant": {
        const startAngle = (entity.quadrantIndex - 1) * Math.PI / 2;
        const center = { x: entity.cx, y: entity.cy };
        const start = { x: entity.cx + Math.cos(startAngle) * entity.radius, y: entity.cy + Math.sin(startAngle) * entity.radius };
        const end = { x: entity.cx + Math.cos(startAngle + Math.PI / 2) * entity.radius, y: entity.cy + Math.sin(startAngle + Math.PI / 2) * entity.radius };
        consider(center.x, center.y, "center", entity.id);
        consider(start.x, start.y, "endpoint", entity.id);
        consider(end.x, end.y, "endpoint", entity.id);
        consider(
          entity.cx + Math.cos(startAngle + Math.PI / 4) * entity.radius,
          entity.cy + Math.sin(startAngle + Math.PI / 4) * entity.radius,
          "midpoint",
          entity.id,
        );
        if (intersectionsEnabled) {
          lineCount = addLine(center, start, entity.id, lineCount);
          lineCount = addLine(center, end, entity.id, lineCount);
        }
        break;
      }
      case "semicircle":
      case "segment": {
        const endAngle = entity.type === "semicircle" ? entity.startAngle + Math.PI : entity.endAngle;
        const sweep = normalizeAngle(endAngle - entity.startAngle) || TAU;
        const center = { x: entity.cx, y: entity.cy };
        const start = { x: entity.cx + Math.cos(entity.startAngle) * entity.radius, y: entity.cy + Math.sin(entity.startAngle) * entity.radius };
        const end = { x: entity.cx + Math.cos(endAngle) * entity.radius, y: entity.cy + Math.sin(endAngle) * entity.radius };
        const midAngle = entity.startAngle + sweep / 2;
        consider(center.x, center.y, "center", entity.id);
        consider(start.x, start.y, "endpoint", entity.id);
        consider(end.x, end.y, "endpoint", entity.id);
        consider(entity.cx + Math.cos(midAngle) * entity.radius, entity.cy + Math.sin(midAngle) * entity.radius, "midpoint", entity.id);
        if (intersectionsEnabled) {
          lineCount = addLine(center, start, entity.id, lineCount);
          lineCount = addLine(center, end, entity.id, lineCount);
        }
        break;
      }
      case "star": {
        consider(entity.cx, entity.cy, "center", entity.id);
        let first: Point2D | null = null;
        let previous: Point2D | null = null;
        const count = entity.points * 2;
        for (let index = 0; index < count; index += 1) {
          const radius = index % 2 === 0 ? entity.outerRadius : entity.innerRadius;
          const angle = entity.rotation + (index * TAU) / count;
          const point = { x: entity.cx + Math.cos(angle) * radius, y: entity.cy + Math.sin(angle) * radius };
          consider(point.x, point.y, "endpoint", entity.id);
          if (previous && intersectionsEnabled) lineCount = addLine(previous, point, entity.id, lineCount);
          else first = point;
          previous = point;
        }
        if (first && previous && intersectionsEnabled) lineCount = addLine(previous, first, entity.id, lineCount);
        break;
      }
      case "cloud":
        for (let index = 0; index < entity.points.length; index += 1) {
          const start = entity.points[index];
          const end = entity.points[(index + 1) % entity.points.length];
          if (!start || !end) continue;
          consider(start.x, start.y, "endpoint", entity.id);
          consider(
            midpointCoordinate(start.x, end.x),
            midpointCoordinate(start.y, end.y),
            "midpoint",
            entity.id,
          );
          if (intersectionsEnabled) lineCount = addLine(start, end, entity.id, lineCount);
        }
        break;
      case "text":
        consider(entity.x, entity.y, "endpoint", entity.id);
        consider(
          midpointCoordinate(entity.bbox.minX, entity.bbox.maxX),
          midpointCoordinate(entity.bbox.minY, entity.bbox.maxY),
          "center",
          entity.id,
        );
        break;
      case "dimension":
        consider(entity.startPoint.x, entity.startPoint.y, "endpoint", entity.id);
        consider(entity.endPoint.x, entity.endPoint.y, "endpoint", entity.id);
        consider(entity.textPosition.x, entity.textPosition.y, "midpoint", entity.id);
        if (intersectionsEnabled) lineCount = addLine(entity.startPoint, entity.endPoint, entity.id, lineCount);
        break;
      case "leader":
        consider(entity.arrowPoint.x, entity.arrowPoint.y, "endpoint", entity.id);
        consider(entity.elbowPoint.x, entity.elbowPoint.y, "endpoint", entity.id);
        consider(entity.textPosition.x, entity.textPosition.y, "endpoint", entity.id);
        if (intersectionsEnabled) {
          lineCount = addLine(entity.arrowPoint, entity.elbowPoint, entity.id, lineCount);
          lineCount = addLine(entity.elbowPoint, entity.textPosition, entity.id, lineCount);
        }
        break;
    }
  }

  for (let leftIndex = 0; intersectionsEnabled && leftIndex < primitives.length; leftIndex += 1) {
    const left = primitives[leftIndex];
    if (!left) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < primitives.length; rightIndex += 1) {
      const right = primitives[rightIndex];
      if (!right || left.entityId === right.entityId) continue;
      if (left.kind === "line" && right.kind === "line") {
        const rx = left.end.x - left.start.x;
        const ry = left.end.y - left.start.y;
        const sx = right.end.x - right.start.x;
        const sy = right.end.y - right.start.y;
        const denominator = rx * sy - ry * sx;
        if (Math.abs(denominator) <= EPSILON) continue;
        const qpx = right.start.x - left.start.x;
        const qpy = right.start.y - left.start.y;
        const t = (qpx * sy - qpy * sx) / denominator;
        const u = (qpx * ry - qpy * rx) / denominator;
        if (t >= -EPSILON && t <= 1 + EPSILON && u >= -EPSILON && u <= 1 + EPSILON) {
          consider(left.start.x + t * rx, left.start.y + t * ry, "intersection", left.entityId, right.entityId);
        }
        continue;
      }
      const line = left.kind === "line" ? left : right.kind === "line" ? right : null;
      const circle = left.kind === "circle" ? left : right.kind === "circle" ? right : null;
      if (!line || !circle) continue;
      const dx = line.end.x - line.start.x;
      const dy = line.end.y - line.start.y;
      const fx = line.start.x - circle.center.x;
      const fy = line.start.y - circle.center.y;
      const a = dx * dx + dy * dy;
      if (a <= EPSILON) continue;
      const b = 2 * (fx * dx + fy * dy);
      const c = fx * fx + fy * fy - circle.radius * circle.radius;
      const discriminant = b * b - 4 * a * c;
      if (discriminant < -EPSILON) continue;
      const root = Math.sqrt(Math.max(0, discriminant));
      const firstT = (-b - root) / (2 * a);
      const secondT = (-b + root) / (2 * a);
      if (firstT >= -EPSILON && firstT <= 1 + EPSILON) {
        const x = line.start.x + firstT * dx;
        const y = line.start.y + firstT * dy;
        if (!circle.arc || pointIsOnArc(x, y, circle.arc)) consider(x, y, "intersection", line.entityId, circle.entityId);
      }
      if (root > EPSILON && secondT >= -EPSILON && secondT <= 1 + EPSILON) {
        const x = line.start.x + secondT * dx;
        const y = line.start.y + secondT * dy;
        if (!circle.arc || pointIsOnArc(x, y, circle.arc)) consider(x, y, "intersection", line.entityId, circle.entityId);
      }
    }
  }

  return found ? reusableResult : null;
}

/** Spatial updates are maintained incrementally by DocumentModel. */
export function invalidateSnapIndex(): void {}
