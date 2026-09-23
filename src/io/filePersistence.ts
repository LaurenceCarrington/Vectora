import { DEFAULT_RASTER_SETTINGS, decodeRgba, validateRasterSettings, type RasterSettings } from "../cam/rasterCamEngine";
import { documentModel, type DocumentReplacement } from "../document/DocumentModel";
import type {
  BoundingBox,
  BoxPanelMetadata,
  CadDocument,
  DocumentUnits,
  Entity,
  EntityStyle,
  Layer,
  ManufacturingIntent,
  Point2D,
  PolylineSegment,
  PreviewMaterialKind,
  WorkArea,
} from "../document/types";

export const VECTORA_FILE_FORMAT = "vectora";
export const VECTORA_SCHEMA_VERSION = 1;
export const VECTORA_MIME_TYPE = "application/vnd.vectora+json";

export interface VectoraFileDocument {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly units: DocumentUnits;
  readonly workArea?: WorkArea;
  readonly activeLayerId: string;
  readonly layers: readonly Layer[];
  readonly entities: readonly Entity[];
}

export interface VectoraFileSchema {
  readonly format: typeof VECTORA_FILE_FORMAT;
  readonly schemaVersion: typeof VECTORA_SCHEMA_VERSION;
  readonly savedAt: string;
  readonly document: VectoraFileDocument;
}

export interface VectoraWritable {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

export interface VectoraFileHandle {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<VectoraWritable>;
}

type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    readonly suggestedName: string;
    readonly types: readonly {
      readonly description: string;
      readonly accept: Readonly<Record<string, readonly string[]>>;
    }[];
  }) => Promise<VectoraFileHandle>;
};

export interface PersistenceSnapshot {
  readonly dirty: boolean;
  readonly fileName: string | null;
  readonly savedAt: string | null;
}

export interface SaveResult {
  readonly status: "saved" | "cancelled" | "download-started";
  readonly fileName: string | null;
  readonly usedFileSystemAccess: boolean;
  /** Content revision actually written, captured before asynchronous picker/write work. */
  readonly savedRevision?: number;
  /** Time at which the write was committed, rather than when the picker opened. */
  readonly savedAt?: string;
}

type PersistenceListener = () => void;
type UnknownRecord = Record<string, unknown>;

const INTENTS = new Set<ManufacturingIntent>(["cut", "engrave", "score", "pocket", "raster", "construction"]);
const UNITS = new Set<DocumentUnits>(["mm", "in", "px"]);
const PREVIEW_MATERIALS = new Set<PreviewMaterialKind>(["wood", "clear-acrylic", "dark-acrylic", "cardboard", "aluminum"]);
const ENTITY_TYPES = new Set<Entity["type"]>(["image",
  "line", "polyline", "rectangle", "circle", "arc", "ellipse", "polygon",
  "quadrant", "semicircle", "segment", "star", "cloud",
  "text",
  "dimension", "leader",
]);
const MAX_NATIVE_ENTITIES = 1_000_000;
const MAX_NATIVE_POINTS_PER_ENTITY = 250_000;
const MAX_REGULAR_SHAPE_VERTICES = 10_000;

function asRecord(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as UnknownRecord;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
  return value;
}

function asNonEmptyString(value: unknown, label: string): string {
  const result = asString(value, label).trim();
  if (!result) throw new TypeError(`${label} cannot be empty.`);
  return result;
}

function asBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean.`);
  return value;
}

function asFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  return value;
}

function asInteger(value: unknown, label: string, minimum = Number.MIN_SAFE_INTEGER): number {
  const result = asFiniteNumber(value, label);
  if (!Number.isSafeInteger(result) || result < minimum) {
    throw new RangeError(`${label} must be an integer of at least ${minimum}.`);
  }
  return result;
}

function asNullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return asString(value, label);
}

function asPoint(value: unknown, label: string): Point2D {
  const point = asRecord(value, label);
  return {
    x: asFiniteNumber(point.x, `${label}.x`),
    y: asFiniteNumber(point.y, `${label}.y`),
  };
}

function asPolylineSegments(value: unknown, label: string): readonly PolylineSegment[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value.map((item, index) => {
    const segment = asRecord(item, `${label}[${index}]`);
    if (segment.type === "line") return { type: "line" };
    if (segment.type === "quadratic") {
      return { type: "quadratic", cp1: asPoint(segment.cp1, `${label}[${index}].cp1`) };
    }
    if (segment.type === "cubic") {
      return {
        type: "cubic",
        cp1: asPoint(segment.cp1, `${label}[${index}].cp1`),
        cp2: asPoint(segment.cp2, `${label}[${index}].cp2`),
      };
    }
    throw new TypeError(`${label}[${index}].type is not supported.`);
  });
}

function asNodeTypes(value: unknown, label: string): readonly ("corner" | "smooth" | "symmetric")[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value.map((item, index) => {
    if (item !== "corner" && item !== "smooth" && item !== "symmetric") {
      throw new TypeError(`${label}[${index}] is not a supported node type.`);
    }
    return item;
  });
}

function asBounds(value: unknown, label: string): BoundingBox {
  const bounds = asRecord(value, label);
  const result = {
    minX: asFiniteNumber(bounds.minX, `${label}.minX`),
    minY: asFiniteNumber(bounds.minY, `${label}.minY`),
    maxX: asFiniteNumber(bounds.maxX, `${label}.maxX`),
    maxY: asFiniteNumber(bounds.maxY, `${label}.maxY`),
  };
  if (result.minX > result.maxX || result.minY > result.maxY) {
    throw new RangeError(`${label} has inverted extents.`);
  }
  return result;
}

function asIntent(value: unknown, label: string): ManufacturingIntent {
  if (typeof value !== "string" || !INTENTS.has(value as ManufacturingIntent)) {
    throw new TypeError(`${label} is not a supported manufacturing intent.`);
  }
  return value as ManufacturingIntent;
}

function asStyle(value: unknown, label: string): EntityStyle {
  const style = asRecord(value, label);
  if (!Array.isArray(style.dashArray)) throw new TypeError(`${label}.dashArray must be an array.`);
  const dashArray = style.dashArray.map((item, index) => {
    const dash = asFiniteNumber(item, `${label}.dashArray[${index}]`);
    if (dash < 0) throw new RangeError(`${label}.dashArray[${index}] cannot be negative.`);
    return dash;
  });
  const strokeWidth = asFiniteNumber(style.strokeWidth, `${label}.strokeWidth`);
  if (strokeWidth < 0) throw new RangeError(`${label}.strokeWidth cannot be negative.`);
  return {
    strokeColor: asNullableString(style.strokeColor, `${label}.strokeColor`),
    strokeWidth,
    fillColor: asNullableString(style.fillColor, `${label}.fillColor`),
    dashArray,
  };
}

function asPointArray(value: unknown, label: string): readonly Point2D[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  if (value.length > MAX_NATIVE_POINTS_PER_ENTITY) {
    throw new RangeError(`${label} is limited to ${MAX_NATIVE_POINTS_PER_ENTITY.toLocaleString()} points.`);
  }
  return value.map((item, index) => asPoint(item, `${label}[${index}]`));
}

function parseLayer(value: unknown, index: number): Layer {
  const layer = asRecord(value, `document.layers[${index}]`);
  const material = layer.material === undefined
    ? undefined
    : asRecord(layer.material, `document.layers[${index}].material`);
  let parsedMaterial: Layer["material"];
  if (material) {
    if (typeof material.kind !== "string" || !PREVIEW_MATERIALS.has(material.kind as PreviewMaterialKind)) {
      throw new TypeError(`document.layers[${index}].material.kind is not supported.`);
    }
    const thicknessMm = asFiniteNumber(material.thicknessMm, `document.layers[${index}].material.thicknessMm`);
    if (thicknessMm <= 0) throw new RangeError(`document.layers[${index}].material.thicknessMm must be greater than zero.`);
    parsedMaterial = { kind: material.kind as PreviewMaterialKind, thicknessMm };
  }
  return {
    id: asNonEmptyString(layer.id, `document.layers[${index}].id`),
    name: asNonEmptyString(layer.name, `document.layers[${index}].name`),
    intent: asIntent(layer.intent, `document.layers[${index}].intent`),
    color: asNonEmptyString(layer.color, `document.layers[${index}].color`),
    visible: asBoolean(layer.visible, `document.layers[${index}].visible`),
    locked: asBoolean(layer.locked, `document.layers[${index}].locked`),
    order: asFiniteNumber(layer.order, `document.layers[${index}].order`),
    ...(layer.dxfAci === undefined ? {} : { dxfAci: asInteger(layer.dxfAci, "Layer DXF ACI", 1) }),
    ...(layer.dxfLineType === undefined ? {} : { dxfLineType: asNonEmptyString(layer.dxfLineType, "Layer DXF linetype") }),
    ...(layer.dxfDashPattern === undefined ? {} : { dxfDashPattern: (() => {
      if (!Array.isArray(layer.dxfDashPattern)) throw new TypeError("Layer DXF dash pattern must be an array.");
      return layer.dxfDashPattern.map(value => asFiniteNumber(value, "Layer DXF dash length"));
    })() }),
    ...(parsedMaterial ? { material: parsedMaterial } : {}),
  };
}

function parseEntityMetadata(value: unknown, label: string): BoxPanelMetadata {
  const metadata = asRecord(value, label);
  if (metadata.kind !== "box-panel") throw new TypeError(`${label}.kind is not supported.`);
  const panels = new Set(["front", "back", "left", "right", "top", "bottom"]);
  const panel = asString(metadata.panel, `${label}.panel`);
  if (!panels.has(panel)) throw new TypeError(`${label}.panel is not a supported box panel.`);
  const result: BoxPanelMetadata = {
    kind: "box-panel",
    assemblyId: asNonEmptyString(metadata.assemblyId, `${label}.assemblyId`),
    panel: panel as BoxPanelMetadata["panel"],
    width: asFiniteNumber(metadata.width, `${label}.width`),
    depth: asFiniteNumber(metadata.depth, `${label}.depth`),
    height: asFiniteNumber(metadata.height, `${label}.height`),
    materialThickness: asFiniteNumber(metadata.materialThickness, `${label}.materialThickness`),
  };
  if ([result.width, result.depth, result.height, result.materialThickness].some((dimension) => dimension <= 0)) {
    throw new RangeError(`${label} dimensions must be greater than zero.`);
  }
  return result;
}

function parseDimensionReference(value: unknown, label: string) {
  const reference = asRecord(value, label);
  const mode = asString(reference.mode, `${label}.mode`);
  if (mode !== "center" && mode !== "path") throw new TypeError(`${label}.mode is not supported.`);
  const parameter = asFiniteNumber(reference.parameter, `${label}.parameter`);
  return {
    entityId: asNonEmptyString(reference.entityId, `${label}.entityId`),
    mode,
    parameter: Math.max(0, Math.min(1, parameter)),
  } as const;
}

function parseEntity(value: unknown, index: number): Entity {
  const label = `document.entities[${index}]`;
  const source = asRecord(value, label);
  if (typeof source.type !== "string" || !ENTITY_TYPES.has(source.type as Entity["type"])) {
    throw new TypeError(`${label}.type is not supported.`);
  }
  const base = {
    id: asNonEmptyString(source.id, `${label}.id`),
    ...(source.name === undefined ? {} : { name: asNonEmptyString(source.name, `${label}.name`) }),
    layerId: asNonEmptyString(source.layerId, `${label}.layerId`),
    intent: asIntent(source.intent, `${label}.intent`),
    style: asStyle(source.style, `${label}.style`),
    bbox: asBounds(source.bbox, `${label}.bbox`),
    visible: asBoolean(source.visible, `${label}.visible`),
    locked: asBoolean(source.locked, `${label}.locked`),
    ...(source.metadata === undefined ? {} : { metadata: parseEntityMetadata(source.metadata, `${label}.metadata`) }),
    ...(source.compoundId === undefined ? {} : { compoundId: asNonEmptyString(source.compoundId, `${label}.compoundId`) }),
    ...(source.dxfGroup === undefined ? {} : { dxfGroup: asNonEmptyString(source.dxfGroup, `${label}.dxfGroup`) }),
  };

  switch (source.type) {
    case "image": {
      const raster = { ...DEFAULT_RASTER_SETTINGS, ...asRecord(source.raster, `${label}.raster`) } as RasterSettings;
      validateRasterSettings(raster);
      const image: Extract<Entity, { type: "image" }> = { ...base, type: "image", origin: asPoint(source.origin, `${label}.origin`), right: asPoint(source.right, `${label}.right`), top: asPoint(source.top, `${label}.top`),
        pixelWidth: asFiniteNumber(source.pixelWidth, `${label}.pixelWidth`), pixelHeight: asFiniteNumber(source.pixelHeight, `${label}.pixelHeight`), rgba: asNonEmptyString(source.rgba, `${label}.rgba`), raster };
      decodeRgba(image);
      return image;
    }
    case "line":
      return { ...base, type: "line", start: asPoint(source.start, `${label}.start`), end: asPoint(source.end, `${label}.end`) };
    case "polyline":
      return {
        ...base,
        type: "polyline",
        points: asPointArray(source.points, `${label}.points`),
        closed: asBoolean(source.closed, `${label}.closed`),
        ...(source.segments === undefined ? {} : { segments: asPolylineSegments(source.segments, `${label}.segments`)! }),
        ...(source.nodeTypes === undefined ? {} : { nodeTypes: asNodeTypes(source.nodeTypes, `${label}.nodeTypes`)! }),
      };
    case "rectangle":
      return { ...base, type: "rectangle", origin: asPoint(source.origin, `${label}.origin`), width: asFiniteNumber(source.width, `${label}.width`), height: asFiniteNumber(source.height, `${label}.height`), cornerRadius: asFiniteNumber(source.cornerRadius, `${label}.cornerRadius`) };
    case "circle":
      return { ...base, type: "circle", center: asPoint(source.center, `${label}.center`), radius: asFiniteNumber(source.radius, `${label}.radius`) };
    case "arc":
      return { ...base, type: "arc", center: asPoint(source.center, `${label}.center`), radius: asFiniteNumber(source.radius, `${label}.radius`), startAngle: asFiniteNumber(source.startAngle, `${label}.startAngle`), endAngle: asFiniteNumber(source.endAngle, `${label}.endAngle`), counterClockwise: asBoolean(source.counterClockwise, `${label}.counterClockwise`) };
    case "ellipse":
      return { ...base, type: "ellipse", cx: asFiniteNumber(source.cx, `${label}.cx`), cy: asFiniteNumber(source.cy, `${label}.cy`), rx: asFiniteNumber(source.rx, `${label}.rx`), ry: asFiniteNumber(source.ry, `${label}.ry`), rotation: asFiniteNumber(source.rotation, `${label}.rotation`) };
    case "polygon":
      {
        const sides = asInteger(source.sides, `${label}.sides`, 3);
        if (sides > MAX_REGULAR_SHAPE_VERTICES) throw new RangeError(`${label}.sides cannot exceed ${MAX_REGULAR_SHAPE_VERTICES.toLocaleString()}.`);
        return { ...base, type: "polygon", cx: asFiniteNumber(source.cx, `${label}.cx`), cy: asFiniteNumber(source.cy, `${label}.cy`), radius: asFiniteNumber(source.radius, `${label}.radius`), sides, rotation: asFiniteNumber(source.rotation, `${label}.rotation`) };
      }
    case "quadrant": {
      const quadrantIndex = asInteger(source.quadrantIndex, `${label}.quadrantIndex`, 1);
      if (quadrantIndex > 4) throw new RangeError(`${label}.quadrantIndex must be from 1 to 4.`);
      return { ...base, type: "quadrant", cx: asFiniteNumber(source.cx, `${label}.cx`), cy: asFiniteNumber(source.cy, `${label}.cy`), radius: asFiniteNumber(source.radius, `${label}.radius`), quadrantIndex: quadrantIndex as 1 | 2 | 3 | 4 };
    }
    case "semicircle":
      return { ...base, type: "semicircle", cx: asFiniteNumber(source.cx, `${label}.cx`), cy: asFiniteNumber(source.cy, `${label}.cy`), radius: asFiniteNumber(source.radius, `${label}.radius`), startAngle: asFiniteNumber(source.startAngle, `${label}.startAngle`) };
    case "segment":
      return { ...base, type: "segment", cx: asFiniteNumber(source.cx, `${label}.cx`), cy: asFiniteNumber(source.cy, `${label}.cy`), radius: asFiniteNumber(source.radius, `${label}.radius`), startAngle: asFiniteNumber(source.startAngle, `${label}.startAngle`), endAngle: asFiniteNumber(source.endAngle, `${label}.endAngle`) };
    case "star":
      {
        const points = asInteger(source.points, `${label}.points`, 3);
        if (points * 2 > MAX_REGULAR_SHAPE_VERTICES) throw new RangeError(`${label}.points cannot exceed ${(MAX_REGULAR_SHAPE_VERTICES / 2).toLocaleString()}.`);
        return { ...base, type: "star", cx: asFiniteNumber(source.cx, `${label}.cx`), cy: asFiniteNumber(source.cy, `${label}.cy`), innerRadius: asFiniteNumber(source.innerRadius, `${label}.innerRadius`), outerRadius: asFiniteNumber(source.outerRadius, `${label}.outerRadius`), points, rotation: asFiniteNumber(source.rotation, `${label}.rotation`) };
      }
    case "cloud":
      return { ...base, type: "cloud", points: asPointArray(source.points, `${label}.points`), arcRadius: asFiniteNumber(source.arcRadius, `${label}.arcRadius`) };
    case "text": {
      const fontSize = asFiniteNumber(source.fontSize, `${label}.fontSize`);
      if (fontSize <= 0) throw new RangeError(`${label}.fontSize must be greater than zero.`);
      return {
        ...base,
        type: "text",
        text: asString(source.text, `${label}.text`),
        fontFamily: asNonEmptyString(source.fontFamily, `${label}.fontFamily`),
        fontSize,
        x: asFiniteNumber(source.x, `${label}.x`),
        y: asFiniteNumber(source.y, `${label}.y`),
      };
    }
    case "dimension": {
      const dimensionKind = asString(source.dimensionKind, `${label}.dimensionKind`);
      if (!["linear", "aligned", "radial", "diameter"].includes(dimensionKind)) {
        throw new TypeError(`${label}.dimensionKind is not supported.`);
      }
      const references = source.references === undefined ? null : asRecord(source.references, `${label}.references`);
      return {
        ...base,
        type: "dimension",
        dimensionKind: dimensionKind as "linear" | "aligned" | "radial" | "diameter",
        startPoint: asPoint(source.startPoint, `${label}.startPoint`),
        endPoint: asPoint(source.endPoint, `${label}.endPoint`),
        textPosition: asPoint(source.textPosition, `${label}.textPosition`),
        value: asFiniteNumber(source.value, `${label}.value`),
        prefix: asString(source.prefix, `${label}.prefix`),
        suffix: asString(source.suffix, `${label}.suffix`),
        precision: asInteger(source.precision, `${label}.precision`, 0),
        arrowSize: asFiniteNumber(source.arrowSize, `${label}.arrowSize`),
        ...(references
          ? {
              references: {
                ...(references.start === undefined ? {} : { start: parseDimensionReference(references.start, `${label}.references.start`) }),
                ...(references.end === undefined ? {} : { end: parseDimensionReference(references.end, `${label}.references.end`) }),
              },
            }
          : {}),
      };
    }
    case "leader":
      return {
        ...base,
        type: "leader",
        arrowPoint: asPoint(source.arrowPoint, `${label}.arrowPoint`),
        elbowPoint: asPoint(source.elbowPoint, `${label}.elbowPoint`),
        textPosition: asPoint(source.textPosition, `${label}.textPosition`),
        text: asString(source.text, `${label}.text`),
      };
    default:
      throw new TypeError(`${label}.type is not supported.`);
  }
}

function filePayload(document: Readonly<CadDocument>, savedAt: string): VectoraFileSchema {
  return {
    format: VECTORA_FILE_FORMAT,
    schemaVersion: VECTORA_SCHEMA_VERSION,
    savedAt,
    document: {
      id: document.id,
      version: document.version,
      title: document.title,
      units: document.units,
      ...(document.workArea ? { workArea: document.workArea } : {}),
      activeLayerId: document.activeLayerId,
      layers: document.layers,
      entities: [...document.entities.values()],
    },
  };
}

export function serializeVectoraDocument(
  document: Readonly<CadDocument> = documentModel.getDocument(),
): string {
  return `${JSON.stringify(filePayload(document, new Date().toISOString()), null, 2)}\n`;
}

export function parseVectoraDocument(source: string): DocumentReplacement {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new SyntaxError("The selected file is not valid JSON.");
  }
  const root = asRecord(parsed, "Vectora file");
  if (root.format !== VECTORA_FILE_FORMAT) throw new TypeError("The selected JSON file is not a Vectora document.");
  if (root.schemaVersion !== VECTORA_SCHEMA_VERSION) {
    throw new RangeError(`Vectora schema version ${String(root.schemaVersion)} is not supported.`);
  }
  if (typeof root.savedAt !== "string" || !Number.isFinite(Date.parse(root.savedAt))) {
    throw new TypeError("Vectora savedAt must be an ISO date string.");
  }
  const stored = asRecord(root.document, "document");
  asNonEmptyString(stored.id, "document.id");
  asInteger(stored.version, "document.version", 1);
  if (!Array.isArray(stored.layers) || stored.layers.length === 0) {
    throw new RangeError("A Vectora document must contain at least one layer.");
  }
  if (!Array.isArray(stored.entities)) throw new TypeError("document.entities must be an array.");
  if (stored.entities.length > MAX_NATIVE_ENTITIES) {
    throw new RangeError(`Vectora files are limited to ${MAX_NATIVE_ENTITIES.toLocaleString()} entities.`);
  }
  const layers = stored.layers.map(parseLayer);
  const entities = stored.entities.map(parseEntity);
  const layerIds = new Set<string>();
  for (const layer of layers) {
    if (layerIds.has(layer.id)) throw new Error(`Duplicate layer id "${layer.id}".`);
    layerIds.add(layer.id);
  }
  const entityIds = new Set<string>();
  for (const entity of entities) {
    if (entityIds.has(entity.id)) throw new Error(`Duplicate entity id "${entity.id}".`);
    if (!layerIds.has(entity.layerId)) throw new Error(`Entity "${entity.id}" references missing layer "${entity.layerId}".`);
    entityIds.add(entity.id);
  }
  const units = asString(stored.units, "document.units") as DocumentUnits;
  if (!UNITS.has(units)) throw new TypeError(`Document units "${units}" are not supported.`);
  const workArea = stored.workArea === undefined
    ? undefined
    : (() => {
        const value = asRecord(stored.workArea, "document.workArea");
        const width = asFiniteNumber(value.width, "document.workArea.width");
        const height = asFiniteNumber(value.height, "document.workArea.height");
        if (width <= 0 || height <= 0 || width > 1_000_000 || height > 1_000_000) {
          throw new RangeError("Document work-area dimensions must be greater than zero and no more than 1,000,000 units.");
        }
        return Object.freeze({ enabled: asBoolean(value.enabled, "document.workArea.enabled"), width, height });
      })();
  const activeLayerId = asNonEmptyString(stored.activeLayerId, "document.activeLayerId");
  if (!layerIds.has(activeLayerId)) throw new Error(`Active layer "${activeLayerId}" does not exist.`);
  return {
    id: asNonEmptyString(stored.id, "document.id"),
    version: asInteger(stored.version, "document.version", 1),
    title: asNonEmptyString(stored.title, "document.title"),
    units,
    ...(workArea ? { workArea } : {}),
    activeLayerId,
    layers,
    entities,
  };
}

function suggestedFileName(document: Readonly<CadDocument>): string {
  const stem = document.title.trim().replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "vectora-drawing";
  return `${stem}.vectora`;
}

function normalizeFileName(value: string): string {
  const trimmed = value.trim().replace(/[\\/:*?"<>|]+/g, "-");
  if (!trimmed) return "vectora-drawing.vectora";
  return trimmed.toLowerCase().endsWith(".vectora") ? trimmed : `${trimmed}.vectora`;
}

function download(source: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([source], { type: `${VECTORA_MIME_TYPE};charset=utf-8` }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

class FilePersistence {
  private readonly listeners = new Set<PersistenceListener>();
  private contentRevision = 0;
  private cleanRevision: number | null = 0;
  private handle: VectoraFileHandle | null = null;
  private snapshot: PersistenceSnapshot = Object.freeze({ dirty: false, fileName: null, savedAt: null });

  constructor() {
    documentModel.subscribe((document, change) => {
      if (change.type === "selection-changed") return;
      void document;
      this.contentRevision += 1;
      const dirty = this.cleanRevision === null || this.contentRevision !== this.cleanRevision;
      if (dirty !== this.snapshot.dirty) this.publish({ ...this.snapshot, dirty });
    });
  }

  getSnapshot = (): PersistenceSnapshot => this.snapshot;

  isDirty = (): boolean => this.snapshot.dirty;

  /** Monotonic revision for persisted content; selection-only changes are excluded. */
  getContentRevision = (): number => this.contentRevision;

  canContinueAfterSave = (result: SaveResult): boolean => (
    result.status === "saved" && result.savedRevision === this.contentRevision && !this.isDirty()
  );

  subscribe = (listener: PersistenceListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  markClean(fileName: string | null = null, handle: VectoraFileHandle | null = null): void {
    this.handle = handle;
    this.cleanRevision = this.contentRevision;
    this.publish({ dirty: false, fileName, savedAt: fileName ? new Date().toISOString() : null });
  }

  markImported(): void {
    this.handle = null;
    this.cleanRevision = null;
    this.publish({ dirty: true, fileName: null, savedAt: null });
  }

  async save(saveAs = false): Promise<SaveResult> {
    const documentSnapshot = documentModel.getDocument();
    const savedRevision = this.contentRevision;
    const source = serializeVectoraDocument(documentSnapshot);
    let handle = saveAs ? null : this.handle;
    let usedFileSystemAccess = Boolean(handle);
    const picker = (window as SavePickerWindow).showSaveFilePicker;

    if (!handle && picker) {
      try {
        handle = await picker({
          suggestedName: this.snapshot.fileName ?? suggestedFileName(documentSnapshot),
          types: [{
            description: "Vectora document",
            accept: { [VECTORA_MIME_TYPE]: [".vectora"] },
          }],
        });
        usedFileSystemAccess = true;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return { status: "cancelled", fileName: this.snapshot.fileName, usedFileSystemAccess: false };
        }
        // Unsupported picker options are recoverable through the download
        // fallback. Permission, device, and other I/O failures are not: hiding
        // them would falsely report that the requested save path succeeded.
        const unsupported = error instanceof TypeError ||
          (error instanceof DOMException && error.name === "NotSupportedError");
        if (!unsupported) throw error;
      }
    }

    if (handle) {
      const writable = await handle.createWritable();
      try {
        await writable.write(new Blob([source], { type: `${VECTORA_MIME_TYPE};charset=utf-8` }));
        await writable.close();
      } catch (error) {
        try { await writable.abort?.(); } catch { /* Preserve the original write/close failure. */ }
        throw error;
      }
      this.handle = handle;
      this.cleanRevision = savedRevision;
      const savedAt = new Date().toISOString();
      this.publish({
        dirty: this.contentRevision !== savedRevision,
        fileName: handle.name,
        savedAt,
      });
      return { status: "saved", fileName: handle.name, usedFileSystemAccess, savedRevision, savedAt };
    }

    let fileName = this.snapshot.fileName ?? suggestedFileName(documentSnapshot);
    if (saveAs) {
      const requested = window.prompt("Save Vectora document as", fileName);
      if (requested === null) return { status: "cancelled", fileName: this.snapshot.fileName, usedFileSystemAccess: false };
      fileName = normalizeFileName(requested);
    } else {
      fileName = normalizeFileName(fileName);
    }
    download(source, fileName);
    // A browser download has no completion or cancellation signal. Keep the
    // document dirty and never authorize a destructive continuation merely
    // because the download was requested; the user may still cancel its Save
    // dialog after this function returns.
    return { status: "download-started", fileName, usedFileSystemAccess: false, savedRevision };
  }

  private publish(snapshot: PersistenceSnapshot): void {
    if (
      snapshot.dirty === this.snapshot.dirty &&
      snapshot.fileName === this.snapshot.fileName &&
      snapshot.savedAt === this.snapshot.savedAt
    ) return;
    this.snapshot = Object.freeze(snapshot);
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        console.error("Persistence listener failed after the save state changed.", error);
      }
    }
  }
}

export const filePersistence = new FilePersistence();
