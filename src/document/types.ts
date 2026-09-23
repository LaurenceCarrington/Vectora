import type { RasterSettings } from "../cam/rasterCamEngine";
export type EntityId = string;
export type LayerId = string;

export type ManufacturingIntent = "cut" | "engrave" | "score" | "pocket" | "raster" | "construction";
export type DocumentUnits = "mm" | "in" | "px";
export type PreviewMaterialKind = "wood" | "clear-acrylic" | "dark-acrylic" | "cardboard" | "aluminum";
export type BoxPanelName = "front" | "back" | "left" | "right" | "top" | "bottom";
export type EntityType =
  | "image"
  | "line"
  | "polyline"
  | "rectangle"
  | "circle"
  | "arc"
  | "ellipse"
  | "polygon"
  | "quadrant"
  | "semicircle"
  | "segment"
  | "star"
  | "cloud"
  | "text"
  | "dimension"
  | "leader";

export type DimensionKind = "linear" | "aligned" | "radial" | "diameter";

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export type BezierNodeType = "corner" | "smooth" | "symmetric";

/** Segment i joins points[i] to points[i + 1] (wrapping for a closed path). */
export type PolylineSegment =
  | { readonly type: "line" }
  | { readonly type: "quadratic"; readonly cp1: Point2D }
  | { readonly type: "cubic"; readonly cp1: Point2D; readonly cp2: Point2D };

export interface BoundingBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface EntityStyle {
  /** Null delegates stroke colour to the owning layer. */
  readonly strokeColor: string | null;
  /** Visual stroke width in CSS pixels. */
  readonly strokeWidth: number;
  /** Null means that the path is not filled. */
  readonly fillColor: string | null;
  /** Visual dash and gap lengths in CSS pixels. */
  readonly dashArray: readonly number[];
}

export interface BoxPanelMetadata {
  readonly kind: "box-panel";
  readonly assemblyId: string;
  readonly panel: BoxPanelName;
  /** Dimensions use the owning document's coordinate units. */
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly materialThickness: number;
}

export type EntityMetadata = BoxPanelMetadata;

export interface BaseEntity<TType extends EntityType = EntityType> {
  readonly id: EntityId;
  /** User-facing tree label. The document boundary supplies a type-based default. */
  readonly name?: string;
  readonly type: TType;
  readonly layerId: LayerId;
  readonly intent: ManufacturingIntent;
  readonly style: EntityStyle;
  readonly bbox: BoundingBox;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly metadata?: EntityMetadata;
  /** Related shells, holes and islands form one Boolean operand. */
  readonly compoundId?: string;
  /** DXF INSERT membership; independent of Boolean compound operands. */
  readonly dxfGroup?: string;
}

export interface LineEntity extends BaseEntity<"line"> {
  readonly start: Point2D;
  readonly end: Point2D;
}

export interface PolylineEntity extends BaseEntity<"polyline"> {
  readonly points: readonly Point2D[];
  readonly closed: boolean;
  /** Omitted entries are straight segments, preserving older Vectora files. */
  readonly segments?: readonly PolylineSegment[];
  /** Omitted entries use the independent-handle corner behaviour. */
  readonly nodeTypes?: readonly BezierNodeType[];
}

export interface RectangleEntity extends BaseEntity<"rectangle"> {
  /** Bottom-left corner in world coordinates. */
  readonly origin: Point2D;
  readonly width: number;
  readonly height: number;
  readonly cornerRadius: number;
}

export interface CircleEntity extends BaseEntity<"circle"> {
  readonly center: Point2D;
  readonly radius: number;
}

export interface ArcEntity extends BaseEntity<"arc"> {
  readonly center: Point2D;
  readonly radius: number;
  /** Angles are expressed in radians. */
  readonly startAngle: number;
  readonly endAngle: number;
  readonly counterClockwise: boolean;
}

export interface EllipseEntity extends BaseEntity<"ellipse"> {
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly rotation: number;
}

export interface PolygonEntity extends BaseEntity<"polygon"> {
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
  readonly sides: number;
  readonly rotation: number;
}

export interface QuadrantEntity extends BaseEntity<"quadrant"> {
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
  readonly quadrantIndex: 1 | 2 | 3 | 4;
}

export interface SemicircleEntity extends BaseEntity<"semicircle"> {
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
  readonly startAngle: number;
}

export interface SegmentEntity extends BaseEntity<"segment"> {
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
  readonly startAngle: number;
  readonly endAngle: number;
}

export interface StarEntity extends BaseEntity<"star"> {
  readonly cx: number;
  readonly cy: number;
  readonly innerRadius: number;
  readonly outerRadius: number;
  readonly points: number;
  readonly rotation: number;
}

export interface CloudEntity extends BaseEntity<"cloud"> {
  readonly points: readonly Point2D[];
  readonly arcRadius: number;
}

/** Editable live text. Convert to paths before using it as CAM geometry. */
export interface TextEntity extends BaseEntity<"text"> {
  readonly text: string;
  readonly fontFamily: string;
  /** Font size in the document's active coordinate units. */
  readonly fontSize: number;
  /** Left-aligned baseline origin in world coordinates. */
  readonly x: number;
  readonly y: number;
}

export interface DimensionAnchorReference {
  readonly entityId: EntityId;
  readonly mode: "center" | "path";
  /** Normalized distance around the source path when mode is `path`. */
  readonly parameter: number;
}

export interface DimensionEntity extends BaseEntity<"dimension"> {
  readonly dimensionKind: DimensionKind;
  readonly startPoint: Point2D;
  readonly endPoint: Point2D;
  readonly textPosition: Point2D;
  readonly value: number;
  readonly prefix: string;
  readonly suffix: string;
  readonly precision: number;
  readonly arrowSize: number;
  /** Optional parametric bindings back to measured geometry. */
  readonly references?: {
    readonly start?: DimensionAnchorReference;
    readonly end?: DimensionAnchorReference;
  };
}

export interface LeaderEntity extends BaseEntity<"leader"> {
  readonly arrowPoint: Point2D;
  readonly elbowPoint: Point2D;
  readonly textPosition: Point2D;
  readonly text: string;
}

/** Embedded RGBA bitmap, with three world-space corners defining its placement. */
export interface ImageEntity extends BaseEntity<"image"> {
  readonly origin: Point2D;
  readonly right: Point2D;
  readonly top: Point2D;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly rgba: string;
  readonly raster: RasterSettings;
}

export type Entity =
  | ImageEntity
  | LineEntity
  | PolylineEntity
  | RectangleEntity
  | CircleEntity
  | ArcEntity
  | EllipseEntity
  | PolygonEntity
  | QuadrantEntity
  | SemicircleEntity
  | SegmentEntity
  | StarEntity
  | CloudEntity
  | TextEntity
  | DimensionEntity
  | LeaderEntity;

type EntityPatch<TEntity extends Entity> = Partial<
  Omit<TEntity, "id" | "type" | "style" | "bbox">
> & {
  readonly style?: Partial<EntityStyle>;
};

/** A discriminated union of legal patches for every entity type. */
export type EntityUpdate = {
  [TType in EntityType]: EntityPatch<Extract<Entity, { type: TType }>>;
}[EntityType];

export interface Layer {
  readonly id: LayerId;
  readonly name: string;
  readonly intent: ManufacturingIntent;
  readonly color: string;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly order: number;
  /** Original indexed CAD colour and simple linetype definition. */
  readonly dxfAci?: number;
  readonly dxfLineType?: string;
  readonly dxfDashPattern?: readonly number[];
  readonly material?: {
    readonly kind: PreviewMaterialKind;
    /** Physical preview thickness in millimetres. */
    readonly thicknessMm: number;
  };
}

export interface CadDocument {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly units: DocumentUnits;
  /** Optional finite drawing area. Geometry remains editable outside it. */
  readonly workArea?: WorkArea;
  readonly activeLayerId: LayerId;
  readonly layers: readonly Layer[];
  readonly entities: ReadonlyMap<EntityId, Entity>;
  readonly selection: ReadonlySet<EntityId>;
}

export interface WorkArea {
  readonly enabled: boolean;
  readonly width: number;
  readonly height: number;
}
