import { imageCorners, decodeRgba, validateRasterSettings } from "../cam/rasterCamEngine";
import type {
  ArcEntity,
  BoxPanelMetadata,
  BoundingBox,
  CadDocument,
  CircleEntity,
  DimensionEntity,
  Entity,
  EntityId,
  EntityStyle,
  EntityUpdate,
  Layer,
  LineEntity,
  LeaderEntity,
  Point2D,
  PolylineEntity,
  PolylineSegment,
  RectangleEntity,
  WorkArea,
} from "./types";
import { EntitySpatialIndex } from "../geometry/SpatialIndex";
import { annotationBounds } from "../geometry/annotations";
import { calculatePolylineBounds, polylineSegmentCount } from "../geometry/bezier";
import { vectoraRenderColors } from "../design/vectoraRenderColors";

export type DocumentChange =
  | { readonly type: "document-replaced"; readonly entityCount: number }
  | { readonly type: "entity-added"; readonly entityId: EntityId }
  | { readonly type: "entity-updated"; readonly entityId: EntityId }
  | { readonly type: "entities-updated"; readonly entityIds: readonly EntityId[] }
  | { readonly type: "entity-set-replaced"; readonly removedIds: readonly EntityId[]; readonly addedIds: readonly EntityId[] }
  | { readonly type: "entity-removed"; readonly entityId: EntityId }
  | { readonly type: "layer-added"; readonly layerId: string }
  | { readonly type: "layer-updated"; readonly layerId: string }
  | { readonly type: "layer-removed"; readonly layerId: string }
  | { readonly type: "active-layer-changed"; readonly layerId: string }
  | { readonly type: "work-area-changed"; readonly workArea: WorkArea }
  | { readonly type: "selection-changed"; readonly entityIds: readonly EntityId[] };

export type DocumentListener = (
  document: Readonly<CadDocument>,
  change: DocumentChange,
) => void;

export type EntityMutationKind = "add" | "modify" | "delete";

/**
 * Raised whenever a mutation attempts to cross an entity or layer lock.
 * Keeping this error at the document boundary makes lock enforcement apply to
 * keyboard shortcuts, history commands, and future non-React callers alike.
 */
export class DocumentLockError extends Error {
  readonly entityId: EntityId;
  readonly layerId: string;
  readonly mutation: EntityMutationKind;
  readonly lockSource: "entity" | "layer";

  constructor(
    entityId: EntityId,
    layerId: string,
    mutation: EntityMutationKind,
    lockSource: "entity" | "layer",
  ) {
    const subject = lockSource === "entity"
      ? `Entity "${entityId}"`
      : `Layer "${layerId}" containing entity "${entityId}"`;
    super(`${subject} is locked and cannot be ${mutation === "delete" ? "deleted" : mutation === "add" ? "added to" : "modified"}.`);
    this.name = "DocumentLockError";
    this.entityId = entityId;
    this.layerId = layerId;
    this.mutation = mutation;
    this.lockSource = lockSource;
  }
}

export interface DocumentReplacement {
  readonly id?: string;
  readonly version?: number;
  readonly title: string;
  readonly units: CadDocument["units"];
  readonly workArea?: WorkArea;
  readonly activeLayerId?: string;
  readonly layers: readonly Layer[];
  readonly entities: readonly Entity[];
}

const DEFAULT_LAYERS: readonly Layer[] = [
  {
    id: "cut",
    name: "Cut path",
    intent: "cut",
    color: vectoraRenderColors.operation.cut,
    visible: true,
    locked: false,
    order: 0,
  },
  {
    id: "engrave",
    name: "Engrave",
    intent: "engrave",
    color: vectoraRenderColors.operation.engrave,
    visible: true,
    locked: false,
    order: 1,
  },
  {
    id: "construction",
    name: "Construction",
    intent: "construction",
    color: vectoraRenderColors.operation.construction,
    visible: true,
    locked: true,
    order: 2,
  },
];

export function defaultWorkArea(units: CadDocument["units"]): WorkArea {
  if (units === "in") return Object.freeze({ enabled: false, width: 12, height: 8 });
  if (units === "px") return Object.freeze({ enabled: false, width: 1_120, height: 750 });
  return Object.freeze({ enabled: false, width: 300, height: 200 });
}

function freezeWorkArea(workArea: WorkArea): WorkArea {
  if (typeof workArea.enabled !== "boolean") throw new TypeError("Work-area visibility must be boolean.");
  assertFinite(workArea.width, "Work-area width");
  assertFinite(workArea.height, "Work-area height");
  if (workArea.width <= 0 || workArea.height <= 0) throw new RangeError("Work-area dimensions must be greater than zero.");
  if (workArea.width > 1_000_000 || workArea.height > 1_000_000) throw new RangeError("Work-area dimensions cannot exceed 1,000,000 document units.");
  return Object.freeze({ ...workArea });
}

const TAU = Math.PI * 2;
const CARDINAL_ANGLES = [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2] as const;
const BASE_UPDATE_KEYS = new Set(["name", "layerId", "intent", "style", "visible", "locked"]);
const GEOMETRY_UPDATE_KEYS: Readonly<Record<Entity["type"], ReadonlySet<string>>> = {
  line: new Set(["start", "end"]),
  polyline: new Set(["points", "closed", "segments", "nodeTypes"]),
  image: new Set(["origin", "right", "top", "pixelWidth", "pixelHeight", "rgba", "raster"]),
  rectangle: new Set(["origin", "width", "height", "cornerRadius"]),
  circle: new Set(["center", "radius"]),
  arc: new Set(["center", "radius", "startAngle", "endAngle", "counterClockwise"]),
  ellipse: new Set(["cx", "cy", "rx", "ry", "rotation"]),
  polygon: new Set(["cx", "cy", "radius", "sides", "rotation"]),
  quadrant: new Set(["cx", "cy", "radius", "quadrantIndex"]),
  semicircle: new Set(["cx", "cy", "radius", "startAngle"]),
  segment: new Set(["cx", "cy", "radius", "startAngle", "endAngle"]),
  star: new Set(["cx", "cy", "innerRadius", "outerRadius", "points", "rotation"]),
  cloud: new Set(["points", "arcRadius"]),
  text: new Set(["text", "fontFamily", "fontSize", "x", "y"]),
  dimension: new Set(["dimensionKind", "startPoint", "endPoint", "textPosition", "value", "prefix", "suffix", "precision", "arrowSize", "references"]),
  leader: new Set(["arrowPoint", "elbowPoint", "textPosition", "text"]),
};

function createDocumentId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `document-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be a finite number.`);
}

function freezePoint(point: Point2D): Point2D {
  assertFinite(point.x, "Point x");
  assertFinite(point.y, "Point y");
  return Object.freeze({ x: point.x, y: point.y });
}

function freezeStyle(style: EntityStyle): EntityStyle {
  assertFinite(style.strokeWidth, "Stroke width");
  if (style.strokeWidth < 0) throw new RangeError("Stroke width cannot be negative.");
  for (const dash of style.dashArray) {
    assertFinite(dash, "Dash length");
    if (dash < 0) throw new RangeError("Dash lengths cannot be negative.");
  }
  return Object.freeze({
    ...style,
    dashArray: Object.freeze([...style.dashArray]),
  });
}

function freezeEntityMetadata(metadata: Entity["metadata"]): BoxPanelMetadata | undefined {
  if (!metadata) return undefined;
  if (!metadata.assemblyId.trim()) throw new TypeError("Box assembly id cannot be empty.");
  for (const [label, value] of [
    ["Box width", metadata.width],
    ["Box depth", metadata.depth],
    ["Box height", metadata.height],
    ["Box material thickness", metadata.materialThickness],
  ] as const) {
    assertFinite(value, label);
    if (value <= 0) throw new RangeError(`${label} must be greater than zero.`);
  }
  return Object.freeze({ ...metadata });
}

function normalizeAngle(angle: number): number {
  const value = angle % TAU;
  return value < 0 ? value + TAU : value;
}

const DEFAULT_ENTITY_NAMES: Readonly<Record<Entity["type"], string>> = Object.freeze({
  line: "Line",
  polyline: "Polyline",
  image: "Bitmap image",
  rectangle: "Rectangle",
  circle: "Circle",
  arc: "Arc",
  ellipse: "Ellipse",
  polygon: "Polygon",
  quadrant: "Quadrant",
  semicircle: "Semi-circle",
  segment: "Segment",
  star: "Star",
  cloud: "Cloud",
  text: "Text",
  dimension: "Dimension",
  leader: "Leader",
});
const EMPTY_ENTITY_LIST: readonly Entity[] = Object.freeze([]);
const DEGENERATE_BOUNDS_PADDING = 0.0001;
const MAX_REGULAR_SHAPE_VERTICES = 10_000;
const DOCUMENT_UNITS = new Set<CadDocument["units"]>(["mm", "in", "px"]);
const MANUFACTURING_INTENTS = new Set<Entity["intent"]>(["cut", "engrave", "score", "pocket", "raster", "construction"]);

export function defaultEntityName(entity: Pick<Entity, "type">): string {
  return DEFAULT_ENTITY_NAMES[entity.type];
}

function angleIsOnArc(angle: number, arc: ArcEntity): boolean {
  const start = normalizeAngle(arc.startAngle);
  const end = normalizeAngle(arc.endAngle);
  const candidate = normalizeAngle(angle);
  if (arc.counterClockwise) {
    const sweep = normalizeAngle(start - end);
    const offset = normalizeAngle(start - candidate);
    return offset <= sweep;
  }
  const sweep = normalizeAngle(end - start);
  const offset = normalizeAngle(candidate - start);
  return offset <= sweep;
}

function angleOnPositiveSweep(angle: number, startAngle: number, endAngle: number): boolean {
  const start = normalizeAngle(startAngle);
  const sweep = normalizeAngle(endAngle - startAngle);
  return normalizeAngle(angle - start) <= sweep + 1e-9;
}

function calculateSectorBounds(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
  includeCenter: boolean,
): BoundingBox {
  let minX = includeCenter ? cx : Infinity;
  let minY = includeCenter ? cy : Infinity;
  let maxX = includeCenter ? cx : -Infinity;
  let maxY = includeCenter ? cy : -Infinity;
  const includeAngle = (angle: number) => {
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  includeAngle(startAngle);
  includeAngle(endAngle);
  for (const angle of CARDINAL_ANGLES) {
    if (angleOnPositiveSweep(angle, startAngle, endAngle)) includeAngle(angle);
  }
  return { minX, minY, maxX, maxY };
}

export function calculateEntityBounds(entity: Entity): BoundingBox {
  let bbox: BoundingBox;
  switch (entity.type) {
    case "image": {
      const points = imageCorners(entity);
      bbox = { minX: Math.min(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)),
        maxX: Math.max(...points.map(p => p.x)), maxY: Math.max(...points.map(p => p.y)) };
      break;
    }
    case "line":
      bbox = {
        minX: Math.min(entity.start.x, entity.end.x),
        minY: Math.min(entity.start.y, entity.end.y),
        maxX: Math.max(entity.start.x, entity.end.x),
        maxY: Math.max(entity.start.y, entity.end.y),
      };
      break;
    case "polyline": {
      bbox = calculatePolylineBounds(entity);
      break;
    }
    case "rectangle": {
      const x2 = entity.origin.x + entity.width;
      const y2 = entity.origin.y + entity.height;
      bbox = {
        minX: Math.min(entity.origin.x, x2),
        minY: Math.min(entity.origin.y, y2),
        maxX: Math.max(entity.origin.x, x2),
        maxY: Math.max(entity.origin.y, y2),
      };
      break;
    }
    case "circle":
      bbox = {
        minX: entity.center.x - entity.radius,
        minY: entity.center.y - entity.radius,
        maxX: entity.center.x + entity.radius,
        maxY: entity.center.y + entity.radius,
      };
      break;
    case "arc": {
      const points: Point2D[] = [
        {
          x: entity.center.x + Math.cos(entity.startAngle) * entity.radius,
          y: entity.center.y + Math.sin(entity.startAngle) * entity.radius,
        },
        {
          x: entity.center.x + Math.cos(entity.endAngle) * entity.radius,
          y: entity.center.y + Math.sin(entity.endAngle) * entity.radius,
        },
      ];
      for (const angle of CARDINAL_ANGLES) {
        if (angleIsOnArc(angle, entity)) {
          points.push({
            x: entity.center.x + Math.cos(angle) * entity.radius,
            y: entity.center.y + Math.sin(angle) * entity.radius,
          });
        }
      }
      bbox = {
        minX: Math.min(...points.map((point) => point.x)),
        minY: Math.min(...points.map((point) => point.y)),
        maxX: Math.max(...points.map((point) => point.x)),
        maxY: Math.max(...points.map((point) => point.y)),
      };
      break;
    }
    case "ellipse": {
      const cos = Math.cos(entity.rotation);
      const sin = Math.sin(entity.rotation);
      const extentX = Math.sqrt(entity.rx * entity.rx * cos * cos + entity.ry * entity.ry * sin * sin);
      const extentY = Math.sqrt(entity.rx * entity.rx * sin * sin + entity.ry * entity.ry * cos * cos);
      bbox = {
        minX: entity.cx - extentX,
        minY: entity.cy - extentY,
        maxX: entity.cx + extentX,
        maxY: entity.cy + extentY,
      };
      break;
    }
    case "polygon": {
      if (!Number.isSafeInteger(entity.sides) || entity.sides < 3 || entity.sides > MAX_REGULAR_SHAPE_VERTICES) {
        throw new RangeError(`Polygon sides must be an integer from 3 to ${MAX_REGULAR_SHAPE_VERTICES.toLocaleString()}.`);
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let index = 0; index < entity.sides; index += 1) {
        const angle = entity.rotation + (index * TAU) / entity.sides;
        const x = entity.cx + Math.cos(angle) * entity.radius;
        const y = entity.cy + Math.sin(angle) * entity.radius;
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
      bbox = { minX, minY, maxX, maxY };
      break;
    }
    case "quadrant": {
      const start = (entity.quadrantIndex - 1) * Math.PI / 2;
      bbox = calculateSectorBounds(entity.cx, entity.cy, entity.radius, start, start + Math.PI / 2, true);
      break;
    }
    case "semicircle":
      bbox = calculateSectorBounds(entity.cx, entity.cy, entity.radius, entity.startAngle, entity.startAngle + Math.PI, true);
      break;
    case "segment":
      bbox = calculateSectorBounds(entity.cx, entity.cy, entity.radius, entity.startAngle, entity.endAngle, true);
      break;
    case "star": {
      if (!Number.isSafeInteger(entity.points) || entity.points < 3 || entity.points * 2 > MAX_REGULAR_SHAPE_VERTICES) {
        throw new RangeError(`Star points must be an integer from 3 to ${(MAX_REGULAR_SHAPE_VERTICES / 2).toLocaleString()}.`);
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let index = 0; index < entity.points * 2; index += 1) {
        const radius = index % 2 === 0 ? entity.outerRadius : entity.innerRadius;
        const angle = entity.rotation + (index * Math.PI) / entity.points;
        const x = entity.cx + Math.cos(angle) * radius;
        const y = entity.cy + Math.sin(angle) * radius;
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
      bbox = { minX, minY, maxX, maxY };
      break;
    }
    case "cloud": {
      if (entity.points.length === 0) {
        bbox = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        break;
      }
      let centroidX = 0;
      let centroidY = 0;
      for (const point of entity.points) { centroidX += point.x; centroidY += point.y; }
      centroidX /= entity.points.length;
      centroidY /= entity.points.length;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const include = (x: number, y: number) => {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      };
      for (let index = 0; index < entity.points.length; index += 1) {
        const start = entity.points[index]!;
        const end = entity.points[(index + 1) % entity.points.length]!;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.hypot(dx, dy) || 1;
        const midX = (start.x + end.x) / 2;
        const midY = (start.y + end.y) / 2;
        let nx = -dy / length;
        let ny = dx / length;
        if (nx * (midX - centroidX) + ny * (midY - centroidY) < 0) { nx = -nx; ny = -ny; }
        const bulge = Math.min(entity.arcRadius, length / 2);
        const controlX = midX + nx * bulge;
        const controlY = midY + ny * bulge;
        include(start.x, start.y);
        include(end.x, end.y);
        const denominatorX = start.x - 2 * controlX + end.x;
        if (Math.abs(denominatorX) > 1e-12) {
          const t = (start.x - controlX) / denominatorX;
          if (t > 0 && t < 1) {
            const inverse = 1 - t;
            include(inverse * inverse * start.x + 2 * inverse * t * controlX + t * t * end.x, start.y);
          }
        }
        const denominatorY = start.y - 2 * controlY + end.y;
        if (Math.abs(denominatorY) > 1e-12) {
          const t = (start.y - controlY) / denominatorY;
          if (t > 0 && t < 1) {
            const inverse = 1 - t;
            include(start.x, inverse * inverse * start.y + 2 * inverse * t * controlY + t * t * end.y);
          }
        }
      }
      bbox = { minX, minY, maxX, maxY };
      break;
    }
    case "text": {
      // Canvas text metrics are browser/font dependent and do not belong at the
      // document boundary. This conservative em-based box is deterministic;
      // the live renderer uses the actual browser glyphs inside it.
      const glyphCount = Math.max(1, Array.from(entity.text).length);
      const width = Math.max(entity.fontSize * 0.35, glyphCount * entity.fontSize * 0.65);
      bbox = {
        minX: entity.x,
        minY: entity.y - entity.fontSize * 0.25,
        maxX: entity.x + width,
        maxY: entity.y + entity.fontSize * 0.8,
      };
      break;
    }
    case "dimension":
    case "leader":
      bbox = annotationBounds(entity);
      break;
  }
  // Lines and other valid open geometry can have no extent on one axis. Keep
  // those entities indexable/cullable without changing their actual geometry.
  // The symmetric padding also preserves the true geometric centre.
  if (bbox.minX === bbox.maxX) {
    bbox = {
      ...bbox,
      minX: bbox.minX - DEGENERATE_BOUNDS_PADDING / 2,
      maxX: bbox.maxX + DEGENERATE_BOUNDS_PADDING / 2,
    };
  }
  if (bbox.minY === bbox.maxY) {
    bbox = {
      ...bbox,
      minY: bbox.minY - DEGENERATE_BOUNDS_PADDING / 2,
      maxY: bbox.maxY + DEGENERATE_BOUNDS_PADDING / 2,
    };
  }
  return Object.freeze(bbox);
}

function freezeEntity(entity: Entity): Entity {
  if (!entity.id.trim()) throw new TypeError("Entity ids cannot be empty.");
  if (!entity.layerId.trim()) throw new TypeError("Entity layer ids cannot be empty.");
  if (!MANUFACTURING_INTENTS.has(entity.intent)) throw new TypeError(`Unsupported manufacturing intent "${String(entity.intent)}".`);
  if (typeof entity.visible !== "boolean" || typeof entity.locked !== "boolean") throw new TypeError("Entity visibility and lock state must be boolean.");
  assertFinite(entity.bbox.minX, "Bounding-box minX");
  assertFinite(entity.bbox.minY, "Bounding-box minY");
  assertFinite(entity.bbox.maxX, "Bounding-box maxX");
  assertFinite(entity.bbox.maxY, "Bounding-box maxY");

  let entityWithClonedGeometry: Entity;
  switch (entity.type) {
    case "image":
      decodeRgba(entity);
      validateRasterSettings(entity.raster);
      entityWithClonedGeometry = { ...entity, origin: freezePoint(entity.origin), right: freezePoint(entity.right), top: freezePoint(entity.top), raster: Object.freeze({ ...entity.raster }) };
      break;

    case "line":
      entityWithClonedGeometry = {
        ...entity,
        start: freezePoint(entity.start),
        end: freezePoint(entity.end),
      } satisfies LineEntity;
      break;
    case "polyline": {
      const segmentCount = polylineSegmentCount(entity.points, entity.closed);
      if (entity.segments && entity.segments.length !== segmentCount) {
        throw new RangeError(`Polyline segments must contain exactly ${segmentCount} entries.`);
      }
      if (entity.nodeTypes && entity.nodeTypes.length !== entity.points.length) {
        throw new RangeError("Polyline nodeTypes must contain one entry per anchor point.");
      }
      const freezeSegment = (segment: PolylineSegment): PolylineSegment => {
        if (segment.type === "line") return Object.freeze({ type: "line" });
        if (segment.type === "quadratic") {
          return Object.freeze({ type: "quadratic", cp1: freezePoint(segment.cp1) });
        }
        return Object.freeze({
          type: "cubic",
          cp1: freezePoint(segment.cp1),
          cp2: freezePoint(segment.cp2),
        });
      };
      entityWithClonedGeometry = {
        ...entity,
        points: Object.freeze(entity.points.map(freezePoint)),
        ...(entity.segments ? { segments: Object.freeze(entity.segments.map(freezeSegment)) } : {}),
        ...(entity.nodeTypes ? { nodeTypes: Object.freeze(entity.nodeTypes.map((nodeType) => {
          if (nodeType !== "corner" && nodeType !== "smooth" && nodeType !== "symmetric") {
            throw new TypeError(`Unsupported Bézier node type "${String(nodeType)}".`);
          }
          return nodeType;
        })) } : {}),
      } satisfies PolylineEntity;
      break;
    }
    case "rectangle":
      assertFinite(entity.width, "Rectangle width");
      assertFinite(entity.height, "Rectangle height");
      assertFinite(entity.cornerRadius, "Rectangle corner radius");
      entityWithClonedGeometry = {
        ...entity,
        origin: freezePoint(entity.origin),
        cornerRadius: Math.max(0, entity.cornerRadius),
      } satisfies RectangleEntity;
      break;
    case "circle":
      assertFinite(entity.radius, "Circle radius");
      entityWithClonedGeometry = {
        ...entity,
        center: freezePoint(entity.center),
        radius: Math.abs(entity.radius),
      } satisfies CircleEntity;
      break;
    case "arc":
      assertFinite(entity.radius, "Arc radius");
      assertFinite(entity.startAngle, "Arc start angle");
      assertFinite(entity.endAngle, "Arc end angle");
      entityWithClonedGeometry = {
        ...entity,
        center: freezePoint(entity.center),
        radius: Math.abs(entity.radius),
      } satisfies ArcEntity;
      break;
    case "ellipse":
      assertFinite(entity.cx, "Ellipse cx"); assertFinite(entity.cy, "Ellipse cy");
      assertFinite(entity.rx, "Ellipse rx"); assertFinite(entity.ry, "Ellipse ry"); assertFinite(entity.rotation, "Ellipse rotation");
      entityWithClonedGeometry = { ...entity, rx: Math.abs(entity.rx), ry: Math.abs(entity.ry) };
      break;
    case "polygon":
      assertFinite(entity.cx, "Polygon cx"); assertFinite(entity.cy, "Polygon cy"); assertFinite(entity.radius, "Polygon radius"); assertFinite(entity.sides, "Polygon sides"); assertFinite(entity.rotation, "Polygon rotation");
      if (Math.round(entity.sides) > MAX_REGULAR_SHAPE_VERTICES) throw new RangeError(`Polygon sides cannot exceed ${MAX_REGULAR_SHAPE_VERTICES.toLocaleString()}.`);
      entityWithClonedGeometry = { ...entity, radius: Math.abs(entity.radius), sides: Math.max(3, Math.round(entity.sides)) };
      break;
    case "quadrant":
      assertFinite(entity.cx, "Quadrant cx"); assertFinite(entity.cy, "Quadrant cy"); assertFinite(entity.radius, "Quadrant radius"); assertFinite(entity.quadrantIndex, "Quadrant index");
      entityWithClonedGeometry = { ...entity, radius: Math.abs(entity.radius), quadrantIndex: Math.min(4, Math.max(1, Math.round(entity.quadrantIndex))) as 1 | 2 | 3 | 4 };
      break;
    case "semicircle":
      assertFinite(entity.cx, "Semicircle cx"); assertFinite(entity.cy, "Semicircle cy"); assertFinite(entity.radius, "Semicircle radius"); assertFinite(entity.startAngle, "Semicircle start angle");
      entityWithClonedGeometry = { ...entity, radius: Math.abs(entity.radius) };
      break;
    case "segment":
      assertFinite(entity.cx, "Segment cx"); assertFinite(entity.cy, "Segment cy"); assertFinite(entity.radius, "Segment radius"); assertFinite(entity.startAngle, "Segment start angle"); assertFinite(entity.endAngle, "Segment end angle");
      entityWithClonedGeometry = { ...entity, radius: Math.abs(entity.radius) };
      break;
    case "star":
      assertFinite(entity.cx, "Star cx"); assertFinite(entity.cy, "Star cy"); assertFinite(entity.innerRadius, "Star inner radius"); assertFinite(entity.outerRadius, "Star outer radius"); assertFinite(entity.points, "Star points"); assertFinite(entity.rotation, "Star rotation");
      {
        const outerRadius = Math.abs(entity.outerRadius);
        if (Math.round(entity.points) * 2 > MAX_REGULAR_SHAPE_VERTICES) throw new RangeError(`Star points cannot exceed ${(MAX_REGULAR_SHAPE_VERTICES / 2).toLocaleString()}.`);
      entityWithClonedGeometry = {
        ...entity,
        innerRadius: Math.min(Math.abs(entity.innerRadius), outerRadius),
        outerRadius,
        points: Math.max(3, Math.round(entity.points)),
      };
      }
      break;
    case "cloud":
      assertFinite(entity.arcRadius, "Cloud arc radius");
      entityWithClonedGeometry = { ...entity, points: Object.freeze(entity.points.map(freezePoint)), arcRadius: Math.abs(entity.arcRadius) };
      break;
    case "text":
      assertFinite(entity.x, "Text x");
      assertFinite(entity.y, "Text y");
      assertFinite(entity.fontSize, "Text font size");
      if (entity.fontSize <= 0) throw new RangeError("Text font size must be greater than zero.");
      if (!entity.fontFamily.trim()) throw new TypeError("Text font family cannot be empty.");
      entityWithClonedGeometry = {
        ...entity,
        fontFamily: entity.fontFamily.trim(),
      };
      break;
    case "dimension": {
      assertFinite(entity.value, "Dimension value");
      assertFinite(entity.precision, "Dimension precision");
      assertFinite(entity.arrowSize, "Dimension arrow size");
      const startReference = entity.references?.start;
      const endReference = entity.references?.end;
      for (const [label, reference] of [["start", startReference], ["end", endReference]] as const) {
        if (!reference) continue;
        if (!reference.entityId.trim()) throw new TypeError(`Dimension ${label} reference entity id cannot be empty.`);
        if (reference.mode !== "center" && reference.mode !== "path") {
          throw new TypeError(`Dimension ${label} reference mode is invalid.`);
        }
        assertFinite(reference.parameter, `Dimension ${label} reference parameter`);
      }
      entityWithClonedGeometry = {
        ...entity,
        startPoint: freezePoint(entity.startPoint),
        endPoint: freezePoint(entity.endPoint),
        textPosition: freezePoint(entity.textPosition),
        value: Math.abs(entity.value),
        precision: Math.min(8, Math.max(0, Math.round(entity.precision))),
        arrowSize: Math.max(0.25, Math.abs(entity.arrowSize)),
        ...(
          startReference || endReference
            ? {
                references: Object.freeze({
                  ...(startReference ? { start: Object.freeze({ ...startReference, parameter: Math.max(0, Math.min(1, startReference.parameter)) }) } : {}),
                  ...(endReference ? { end: Object.freeze({ ...endReference, parameter: Math.max(0, Math.min(1, endReference.parameter)) }) } : {}),
                }),
              }
            : {}
        ),
      } satisfies DimensionEntity;
      break;
    }
    case "leader":
      entityWithClonedGeometry = {
        ...entity,
        arrowPoint: freezePoint(entity.arrowPoint),
        elbowPoint: freezePoint(entity.elbowPoint),
        textPosition: freezePoint(entity.textPosition),
      } satisfies LeaderEntity;
      break;
  }

  const normalized = {
    ...entityWithClonedGeometry,
    name: entity.name?.trim() || defaultEntityName(entity),
    style: freezeStyle(entity.style),
    ...(entity.metadata ? { metadata: freezeEntityMetadata(entity.metadata) } : {}),
  } as Entity;
  return Object.freeze({ ...normalized, bbox: calculateEntityBounds(normalized) });
}

function freezeLayer(layer: Layer): Layer {
  if (!layer.id.trim()) throw new TypeError("Layer ids cannot be empty.");
  if (!layer.name.trim()) throw new TypeError("Layer names cannot be empty.");
  if (!layer.color.trim()) throw new TypeError("Layer colours cannot be empty.");
  if (!MANUFACTURING_INTENTS.has(layer.intent)) throw new TypeError(`Unsupported manufacturing intent "${String(layer.intent)}".`);
  if (typeof layer.visible !== "boolean" || typeof layer.locked !== "boolean") throw new TypeError("Layer visibility and lock state must be boolean.");
  assertFinite(layer.order, "Layer order");
  if (layer.dxfAci !== undefined && (!Number.isInteger(layer.dxfAci) || layer.dxfAci < 1 || layer.dxfAci > 255)) {
    throw new RangeError("Layer DXF ACI must be an integer from 1 to 255.");
  }
  layer.dxfDashPattern?.forEach(value => assertFinite(value, "Layer DXF dash length"));
  if (layer.material) {
    assertFinite(layer.material.thicknessMm, "Layer material thickness");
    if (layer.material.thicknessMm <= 0) throw new RangeError("Layer material thickness must be greater than zero.");
  }
  return Object.freeze({
    ...layer,
    ...(layer.dxfDashPattern ? { dxfDashPattern: Object.freeze([...layer.dxfDashPattern]) } : {}),
    ...(layer.material ? { material: Object.freeze({ ...layer.material }) } : {}),
  });
}

function createInitialDocument(): CadDocument {
  return Object.freeze({
    id: createDocumentId(),
    version: 1,
    title: "Untitled",
    units: "mm",
    workArea: defaultWorkArea("mm"),
    activeLayerId: DEFAULT_LAYERS[0]!.id,
    layers: Object.freeze(DEFAULT_LAYERS.map(freezeLayer)),
    entities: new Map<EntityId, Entity>(),
    selection: new Set<EntityId>(),
  });
}

export class DocumentModel {
  private document: CadDocument;
  private readonly entities: Map<EntityId, Entity>;
  private readonly listeners = new Set<DocumentListener>();
  private visibleEntitiesCache: readonly Entity[] | null = null;
  private entitiesInZOrderCache: readonly Entity[] | null = null;
  private entitiesByLayerCache: ReadonlyMap<string, readonly Entity[]> | null = null;
  private readonly entityOrder = new Map<EntityId, number>();
  private nextEntityOrder = 0;
  private readonly layersById = new Map<string, Layer>();
  private readonly spatialIndex = new EntitySpatialIndex();
  private readonly compareEntityOrder = (left: Entity, right: Entity): number =>
    ((this.layersById.get(left.layerId)?.order ?? Number.MAX_SAFE_INTEGER) -
      (this.layersById.get(right.layerId)?.order ?? Number.MAX_SAFE_INTEGER)) ||
    ((this.entityOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (this.entityOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER));

  constructor(initialDocument: CadDocument = createInitialDocument()) {
    if (!initialDocument.id.trim() || !initialDocument.title.trim()) throw new TypeError("CAD document id and title cannot be empty.");
    if (!Number.isSafeInteger(initialDocument.version) || initialDocument.version < 1) throw new RangeError("A CAD document version must be a positive safe integer.");
    if (!DOCUMENT_UNITS.has(initialDocument.units)) throw new TypeError(`Unsupported document units "${String(initialDocument.units)}".`);
    if (initialDocument.layers.length === 0) throw new Error("A CAD document must contain at least one layer.");
    const layerIds = new Set<string>();
    const layers = initialDocument.layers.map((layer) => {
      if (!layer.id.trim()) throw new TypeError("Layer ids cannot be empty.");
      if (layerIds.has(layer.id)) throw new Error(`Duplicate layer id "${layer.id}".`);
      layerIds.add(layer.id);
      return freezeLayer(layer);
    });
    this.entities = new Map();
    for (const [id, entity] of initialDocument.entities) {
      if (id !== entity.id) {
        throw new Error(`Entity map key "${id}" does not match entity id "${entity.id}".`);
      }
      if (!layerIds.has(entity.layerId)) throw new Error(`Entity "${id}" references missing layer "${entity.layerId}".`);
      this.entities.set(id, freezeEntity(entity));
    }
    const selection = new Set(
      [...initialDocument.selection].filter((id) => this.entities.has(id)),
    );
    const activeLayerId = initialDocument.layers.some(
      (layer) => layer.id === initialDocument.activeLayerId,
    )
      ? initialDocument.activeLayerId
      : initialDocument.layers.find((layer) => layer.visible && !layer.locked)?.id ??
        initialDocument.layers[0]?.id;
    if (!activeLayerId) throw new Error("A CAD document must contain at least one layer.");
    this.document = Object.freeze({
      ...initialDocument,
      workArea: freezeWorkArea(initialDocument.workArea ?? defaultWorkArea(initialDocument.units)),
      activeLayerId,
      layers: Object.freeze(layers),
      entities: this.entities,
      selection,
    });
    this.rebuildDerivedIndexes();
  }

  getDocument(): Readonly<CadDocument> {
    return this.document;
  }

  getActiveLayer(): Layer {
    const layer = this.layersById.get(this.document.activeLayerId);
    if (!layer) throw new Error("The active layer no longer exists.");
    return layer;
  }

  /** Returns whether an existing entity may be edited or removed right now. */
  canMutateEntity(entityOrId: Entity | EntityId): boolean {
    const entity = typeof entityOrId === "string"
      ? this.entities.get(entityOrId)
      : this.entities.get(entityOrId.id);
    if (!entity || entity.locked) return false;
    const layer = this.layersById.get(entity.layerId);
    return Boolean(layer && !layer.locked);
  }

  /** Public guard used by commands that need to fail before preparing updates. */
  assertEntityMutable(entityOrId: Entity | EntityId, mutation: Exclude<EntityMutationKind, "add">): Entity {
    const entity = typeof entityOrId === "string"
      ? this.entities.get(entityOrId)
      : this.entities.get(entityOrId.id);
    if (!entity) {
      const id = typeof entityOrId === "string" ? entityOrId : entityOrId.id;
      throw new Error(`Entity "${id}" does not exist.`);
    }
    this.assertEntityMutationAllowed(entity, mutation);
    return entity;
  }

  setActiveLayerId(layerId: string): void {
    if (!this.layersById.has(layerId)) throw new Error(`Layer "${layerId}" does not exist.`);
    if (this.document.activeLayerId === layerId) return;
    this.commit(
      { ...this.document, activeLayerId: layerId },
      { type: "active-layer-changed", layerId },
      false,
    );
  }

  setWorkArea(workArea: WorkArea): void {
    const next = freezeWorkArea(workArea);
    const current = this.document.workArea ?? defaultWorkArea(this.document.units);
    if (current.enabled === next.enabled && current.width === next.width && current.height === next.height) return;
    this.commit(
      { ...this.document, workArea: next },
      { type: "work-area-changed", workArea: next },
      false,
    );
  }

  resetDocument(units: CadDocument["units"] = "mm"): Readonly<CadDocument> {
    return this.replaceDocument({
      id: createDocumentId(),
      version: 1,
      title: "Untitled",
      units,
      workArea: defaultWorkArea(units),
      activeLayerId: DEFAULT_LAYERS[0]!.id,
      layers: DEFAULT_LAYERS,
      entities: [],
    });
  }

  replaceDocument(replacement: DocumentReplacement): Readonly<CadDocument> {
    if (replacement.id !== undefined && !replacement.id.trim()) {
      throw new Error("A CAD document id cannot be empty.");
    }
    if (
      replacement.version !== undefined &&
      (!Number.isSafeInteger(replacement.version) || replacement.version < 1)
    ) {
      throw new RangeError("A CAD document version must be a positive safe integer.");
    }
    if (replacement.layers.length === 0) {
      throw new Error("A CAD document must contain at least one layer.");
    }
    if (!replacement.title.trim()) throw new TypeError("A CAD document title cannot be empty.");
    if (!DOCUMENT_UNITS.has(replacement.units)) throw new TypeError(`Unsupported document units "${String(replacement.units)}".`);
    const layerIds = new Set<string>();
    const layers = replacement.layers.map((layer) => {
      if (layerIds.has(layer.id)) throw new Error(`Duplicate layer id "${layer.id}".`);
      layerIds.add(layer.id);
      return freezeLayer(layer);
    });
    const nextEntities = new Map<EntityId, Entity>();
    for (const entity of replacement.entities) {
      if (nextEntities.has(entity.id)) throw new Error(`Duplicate entity id "${entity.id}".`);
      if (!layerIds.has(entity.layerId)) {
        throw new Error(`Layer "${entity.layerId}" does not exist.`);
      }
      nextEntities.set(entity.id, freezeEntity(entity));
    }
    this.entities.clear();
    for (const [id, entity] of nextEntities) this.entities.set(id, entity);
    this.spatialIndex.rebuild(this.entities.values());
    this.entityOrder.clear();
    this.nextEntityOrder = 0;
    for (const entity of this.entities.values()) {
      this.entityOrder.set(entity.id, this.nextEntityOrder++);
    }
    const activeLayerId = replacement.activeLayerId && layerIds.has(replacement.activeLayerId)
      ? replacement.activeLayerId
      : layers.find((layer) => layer.visible && !layer.locked)?.id ?? layers[0]!.id;
    this.commit(
      {
        id: replacement.id ?? createDocumentId(),
        version: this.document.version,
        title: replacement.title,
        units: replacement.units,
        workArea: freezeWorkArea(replacement.workArea ?? defaultWorkArea(replacement.units)),
        activeLayerId,
        layers: Object.freeze(layers),
        entities: this.entities,
        selection: new Set<EntityId>(),
      },
      { type: "document-replaced", entityCount: this.entities.size },
      true,
      replacement.version,
    );
    return this.document;
  }

  addEntity(entity: Entity): Entity {
    if (this.entities.has(entity.id)) {
      throw new Error(`Entity "${entity.id}" already exists.`);
    }
    if (!this.document.layers.some((layer) => layer.id === entity.layerId)) {
      throw new Error(`Layer "${entity.layerId}" does not exist.`);
    }
    this.assertDestinationLayerUnlocked(entity.layerId, entity.id, "add");
    const nextEntity = freezeEntity(entity);
    this.entities.set(nextEntity.id, nextEntity);
    this.entityOrder.set(nextEntity.id, this.nextEntityOrder++);
    this.spatialIndex.insert(nextEntity);
    this.commit(
      {
        ...this.document,
        entities: this.entities,
      },
      { type: "entity-added", entityId: nextEntity.id },
      true,
    );
    return nextEntity;
  }

  updateEntity(id: EntityId, updates: EntityUpdate): Entity {
    const current = this.entities.get(id);
    if (!current) throw new Error(`Entity "${id}" does not exist.`);
    this.assertEntityMutationAllowed(current, "modify");

    const updateRecord = updates as Record<string, unknown>;
    for (const key of Object.keys(updateRecord)) {
      if (!BASE_UPDATE_KEYS.has(key) && !GEOMETRY_UPDATE_KEYS[current.type].has(key)) {
        throw new TypeError(`Property "${key}" cannot be updated on a ${current.type} entity.`);
      }
    }

    const nextLayerId = typeof updateRecord.layerId === "string" ? updateRecord.layerId : current.layerId;
    if (!this.document.layers.some((layer) => layer.id === nextLayerId)) {
      throw new Error(`Layer "${nextLayerId}" does not exist.`);
    }
    this.assertDestinationLayerUnlocked(nextLayerId, current.id, "modify");

    const nextEntity = freezeEntity({
      ...current,
      ...updates,
      id: current.id,
      type: current.type,
      style: updates.style ? { ...current.style, ...updates.style } : current.style,
    } as Entity);

    this.entities.set(id, nextEntity);
    this.spatialIndex.update(current, nextEntity);
    this.commit(
      {
        ...this.document,
        entities: this.entities,
      },
      { type: "entity-updated", entityId: id },
      true,
    );
    return nextEntity;
  }

  /**
   * Applies tree/presentation state without opening a geometry-mutation bypass.
   * A locked entity may only be explicitly unlocked; a locked parent layer still
   * blocks every entity-level transition.
   */
  updateEntityTreeState(
    id: EntityId,
    updates: Readonly<Partial<Pick<Entity, "name" | "visible" | "locked">>>,
  ): Entity {
    const current = this.entities.get(id);
    if (!current) throw new Error(`Entity "${id}" does not exist.`);
    this.assertDestinationLayerUnlocked(current.layerId, current.id, "modify");
    const keys = Object.keys(updates);
    if (keys.length === 0 || keys.some((key) => key !== "name" && key !== "visible" && key !== "locked")) {
      throw new TypeError("Entity tree state can only update name, visibility, or lock state.");
    }
    const explicitlyUnlocking = current.locked && keys.length === 1 && updates.locked === false;
    if (current.locked && !explicitlyUnlocking) {
      throw new DocumentLockError(current.id, current.layerId, "modify", "entity");
    }
    if (updates.name !== undefined && !updates.name.trim()) {
      throw new TypeError("Entity names cannot be empty.");
    }
    const nextEntity = freezeEntity({ ...current, ...updates } as Entity);
    this.entities.set(id, nextEntity);
    this.spatialIndex.update(current, nextEntity);
    this.commit(
      { ...this.document, entities: this.entities },
      { type: "entity-updated", entityId: id },
      true,
    );
    return nextEntity;
  }

  replaceEntities(entities: readonly Entity[]): readonly Entity[] {
    if (entities.length === 0) return entities;
    const replacements: Entity[] = [];
    for (const entity of entities) {
      const current = this.entities.get(entity.id);
      if (!current) throw new Error(`Entity "${entity.id}" does not exist.`);
      this.assertEntityMutationAllowed(current, "modify");
      if (current.type !== entity.type) {
        throw new TypeError(`Entity "${entity.id}" cannot change type.`);
      }
      if (!this.document.layers.some((layer) => layer.id === entity.layerId)) {
        throw new Error(`Layer "${entity.layerId}" does not exist.`);
      }
      this.assertDestinationLayerUnlocked(entity.layerId, entity.id, "modify");
      replacements.push(freezeEntity(entity));
    }
    for (const entity of replacements) {
      const previous = this.entities.get(entity.id);
      if (previous) this.spatialIndex.update(previous, entity);
      this.entities.set(entity.id, entity);
    }
    const ids = Object.freeze(replacements.map((entity) => entity.id));
    this.commit(
      { ...this.document, entities: this.entities },
      { type: "entities-updated", entityIds: ids },
      true,
    );
    return Object.freeze(replacements);
  }

  replaceEntitySet(
    removeIds: readonly EntityId[],
    additions: readonly Entity[],
  ): readonly Entity[] {
    const removals = new Set(removeIds);
    const retainedOrder = new Map<EntityId, number>();
    for (const id of removals) {
      const entity = this.entities.get(id);
      if (!entity) throw new Error(`Entity "${id}" does not exist.`);
      this.assertEntityMutationAllowed(entity, "delete");
      const order = this.entityOrder.get(id);
      if (order !== undefined) retainedOrder.set(id, order);
    }
    const prepared: Entity[] = [];
    const additionIds = new Set<EntityId>();
    for (const entity of additions) {
      if (additionIds.has(entity.id)) throw new Error(`Duplicate entity id "${entity.id}".`);
      if (this.entities.has(entity.id) && !removals.has(entity.id)) {
        throw new Error(`Entity "${entity.id}" already exists.`);
      }
      if (!this.document.layers.some((layer) => layer.id === entity.layerId)) {
        throw new Error(`Layer "${entity.layerId}" does not exist.`);
      }
      this.assertDestinationLayerUnlocked(
        entity.layerId,
        entity.id,
        removals.has(entity.id) ? "modify" : "add",
      );
      additionIds.add(entity.id);
      prepared.push(freezeEntity(entity));
    }
    for (const id of removals) {
      this.entities.delete(id);
      this.entityOrder.delete(id);
      this.spatialIndex.remove(id);
    }
    for (const entity of prepared) {
      this.entities.set(entity.id, entity);
      const previousOrder = retainedOrder.get(entity.id);
      this.entityOrder.set(entity.id, previousOrder ?? this.nextEntityOrder++);
      this.spatialIndex.insert(entity);
    }
    const selection = new Set(
      [...this.document.selection].filter((id) => this.entities.has(id)),
    );
    this.commit(
      { ...this.document, entities: this.entities, selection },
      {
        type: "entity-set-replaced",
        removedIds: Object.freeze([...removals]),
        addedIds: Object.freeze(prepared.map((entity) => entity.id)),
      },
      true,
    );
    return Object.freeze(prepared);
  }

  removeEntity(id: EntityId): boolean {
    const entity = this.entities.get(id);
    if (!entity) return false;
    this.assertEntityMutationAllowed(entity, "delete");
    this.entities.delete(id);
    this.entityOrder.delete(id);
    this.spatialIndex.remove(id);
    const selection = new Set(this.document.selection);
    selection.delete(id);
    this.commit(
      {
        ...this.document,
        entities: this.entities,
        selection,
      },
      { type: "entity-removed", entityId: id },
      true,
    );
    return true;
  }

  addLayer(layer: Layer): Layer {
    if (this.document.layers.some((candidate) => candidate.id === layer.id)) {
      throw new Error(`Layer "${layer.id}" already exists.`);
    }
    const nextLayer = freezeLayer(layer);
    const layers = Object.freeze([...this.document.layers, nextLayer]);
    this.commit(
      { ...this.document, layers },
      { type: "layer-added", layerId: nextLayer.id },
      true,
    );
    return nextLayer;
  }

  removeLayer(id: string): boolean {
    if (!this.document.layers.some((layer) => layer.id === id)) return false;
    if (this.document.layers.length === 1) throw new Error("A CAD document must contain at least one layer.");
    if ([...this.entities.values()].some((entity) => entity.layerId === id)) {
      throw new Error(`Layer "${id}" cannot be removed while it contains entities.`);
    }
    const layers = Object.freeze(this.document.layers.filter((layer) => layer.id !== id));
    const activeLayerId = this.document.activeLayerId === id
      ? layers.find((layer) => layer.visible && !layer.locked)?.id ?? layers[0]!.id
      : this.document.activeLayerId;
    this.commit(
      { ...this.document, layers, activeLayerId },
      { type: "layer-removed", layerId: id },
      true,
    );
    return true;
  }

  updateLayer(id: string, updates: Partial<Omit<Layer, "id">>): Layer {
    const current = this.document.layers.find((layer) => layer.id === id);
    if (!current) throw new Error(`Layer "${id}" does not exist.`);
    const nextLayer = freezeLayer({ ...current, ...updates, id: current.id });
    const layers = Object.freeze(
      this.document.layers.map((layer) => (layer.id === id ? nextLayer : layer)),
    );
    this.commit(
      { ...this.document, layers },
      { type: "layer-updated", layerId: id },
      true,
    );
    return nextLayer;
  }

  getVisibleEntities(): readonly Entity[] {
    if (this.visibleEntitiesCache) return this.visibleEntitiesCache;
    const visible = [...this.entities.values()]
      .filter((entity) => entity.visible && this.layersById.get(entity.layerId)?.visible)
      .sort(this.compareEntityOrder);
    this.visibleEntitiesCache = Object.freeze(visible);
    return this.visibleEntitiesCache;
  }

  /** Returns every entity in the exact bottom-to-top order used by the renderer. */
  getEntitiesInZOrder(): readonly Entity[] {
    if (this.entitiesInZOrderCache) return this.entitiesInZOrderCache;
    this.entitiesInZOrderCache = Object.freeze([...this.entities.values()].sort(this.compareEntityOrder));
    return this.entitiesInZOrderCache;
  }

  /** Returns immutable entity arrays grouped by layer in stable insertion/z-order. */
  getEntitiesByLayer(): ReadonlyMap<string, readonly Entity[]> {
    if (this.entitiesByLayerCache) return this.entitiesByLayerCache;
    const grouped = new Map<string, Entity[]>();
    for (const layer of this.document.layers) grouped.set(layer.id, []);
    for (const entity of this.entities.values()) {
      const bucket = grouped.get(entity.layerId);
      if (bucket) bucket.push(entity);
    }
    const result = new Map<string, readonly Entity[]>();
    for (const [layerId, entities] of grouped) {
      entities.sort((left, right) => (
        (this.entityOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (this.entityOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER)
      ));
      result.set(layerId, Object.freeze(entities));
    }
    this.entitiesByLayerCache = result;
    return result;
  }

  getEntitiesForLayer(layerId: string): readonly Entity[] {
    return this.getEntitiesByLayer().get(layerId) ?? EMPTY_ENTITY_LIST;
  }

  /** Writes visible, layer-ordered spatial matches into a caller-owned array. */
  queryVisibleEntities(bounds: BoundingBox, target: Entity[]): Entity[] {
    this.spatialIndex.query(bounds, target);
    let writeIndex = 0;
    for (let index = 0; index < target.length; index += 1) {
      const entity = target[index];
      if (!entity || !entity.visible || !this.layersById.get(entity.layerId)?.visible) continue;
      target[writeIndex] = entity;
      writeIndex += 1;
    }
    target.length = writeIndex;
    target.sort(this.compareEntityOrder);
    return target;
  }

  getLayer(id: string): Layer | undefined {
    return this.layersById.get(id);
  }

  setSelection(ids: readonly EntityId[]): void {
    const selection = new Set(ids.filter((id) => this.entities.has(id)));
    const nextIds = [...selection];
    const currentIds = [...this.document.selection];
    if (
      nextIds.length === currentIds.length &&
      nextIds.every((id, index) => id === currentIds[index])
    ) return;
    this.commit(
      { ...this.document, selection },
      { type: "selection-changed", entityIds: Object.freeze(nextIds) },
      false,
    );
  }

  selectEntities(ids: readonly EntityId[]): void {
    this.setSelection(ids);
  }

  clearSelection(): void {
    if (this.document.selection.size === 0) return;
    const selection = new Set<EntityId>();
    this.commit(
      { ...this.document, selection },
      { type: "selection-changed", entityIds: Object.freeze([]) },
      false,
    );
  }

  subscribe(callback: DocumentListener): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private commit(
    next: CadDocument,
    change: DocumentChange,
    invalidateVisible: boolean,
    versionOverride?: number,
  ): void {
    this.document = Object.freeze({
      ...next,
      // Selection is transient UI state and is deliberately omitted from
      // native persistence. It must not invalidate a compiled CAM job or its
      // live-head transform, both of which are tied to document.version.
      version: versionOverride ?? (
        change.type === "selection-changed"
          ? this.document.version
          : this.document.version + 1
      ),
    });
    if (invalidateVisible) {
      this.visibleEntitiesCache = null;
      this.entitiesInZOrderCache = null;
      this.entitiesByLayerCache = null;
      this.refreshLayerIndex();
    }
    for (const listener of [...this.listeners]) {
      try {
        listener(this.document, change);
      } catch (error) {
        // The mutation has already committed. A subscriber must not make the
        // caller believe it failed or prevent later subscribers from syncing.
        console.error("Document listener failed after a committed change.", error);
      }
    }
  }

  private assertEntityMutationAllowed(
    entity: Entity,
    mutation: Exclude<EntityMutationKind, "add">,
  ): void {
    if (entity.locked) {
      throw new DocumentLockError(entity.id, entity.layerId, mutation, "entity");
    }
    this.assertDestinationLayerUnlocked(entity.layerId, entity.id, mutation);
  }

  private assertDestinationLayerUnlocked(
    layerId: string,
    entityId: EntityId,
    mutation: EntityMutationKind,
  ): void {
    const layer = this.layersById.get(layerId);
    if (!layer) throw new Error(`Layer "${layerId}" does not exist.`);
    if (layer.locked) {
      throw new DocumentLockError(entityId, layerId, mutation, "layer");
    }
  }

  private refreshLayerIndex(): void {
    this.layersById.clear();
    for (const layer of this.document.layers) this.layersById.set(layer.id, layer);
  }

  private rebuildDerivedIndexes(): void {
    this.refreshLayerIndex();
    this.spatialIndex.rebuild(this.entities.values());
    this.entityOrder.clear();
    this.nextEntityOrder = 0;
    for (const entity of this.entities.values()) {
      this.entityOrder.set(entity.id, this.nextEntityOrder++);
    }
    this.visibleEntitiesCache = null;
    this.entitiesInZOrderCache = null;
    this.entitiesByLayerCache = null;
  }
}

export const documentModel = new DocumentModel();
