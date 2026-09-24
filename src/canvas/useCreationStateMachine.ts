import {
  useCallback,
  useEffect,
  useRef,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { calculateEntityBounds, documentModel } from "../document/DocumentModel";
import {
  AddEntityCommand,
  TransformEntityCommand,
  executeCommand,
} from "../document/History";
import type {
  BoundingBox,
  DimensionAnchorReference,
  DimensionEntity,
  DimensionKind,
  Entity,
  LeaderEntity,
  Point2D,
  TextEntity,
} from "../document/types";
import { entityIntersectsBox, normalizeBox, pointHitsEntity } from "../geometry/HitTest";
import {
  getAngleSnapDegrees,
  isGridSnapEnabled,
  resolveDraftingSnap,
  snapWorldDeltaToGrid,
  type SnapResult,
} from "../geometry/Snapping";
import { calculateDimensionValue, createDimensionReference } from "../geometry/annotations";
import {
  getSelectionBounds,
  getScaleHandlePoint,
  hitTestTransformHandle,
  pointInsideSelection,
  rotateEntities,
  scaleEntities,
  translateEntities,
  type ScaleHandle,
  type TransformHandle,
} from "../renderer/TransformOverlay";
import { useVectorStore, type ToolId } from "../store/useVectorStore";
import { simplifyOpen } from "../vectorizer/autoTracer";
import type { NodeEditRenderState } from "./useNodeEditStateMachine";
import type { MeasureRenderState } from "./useMeasureTool";
import type { SegmentErasePreview } from "./useEraserStateMachine";

const DRAWING_TOOLS = new Set<ToolId>([
  "line", "rectangle", "circle", "arc", "ellipse", "polygon",
]);
const DRAG_THRESHOLD_PX = 3;
const TOUCH_DRAG_THRESHOLD_PX = 7;
const TOUCH_ENTITY_HIT_RADIUS_PX = 18;
const TOUCH_HANDLE_HIT_RADIUS_PX = 22;
const EMPTY_BOUNDS: BoundingBox = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
let entitySequence = 0;

export interface MarqueePreview {
  readonly start: Point2D;
  readonly current: Point2D;
}

export interface CanvasInteractionRenderState {
  previewEntity: Entity | null;
  generatorPreview: readonly Entity[];
  transformPreview: readonly Entity[] | null;
  marquee: MarqueePreview | null;
  activeSnap: SnapResult | null;
  nodeEdit: NodeEditRenderState | null;
  measure: MeasureRenderState | null;
  erasePreview: SegmentErasePreview | null;
}

type CreationOperation = {
  kind: "creation";
  entityId: string;
  layerId: string;
  tool: ToolId;
  origin: Point2D;
  current: Point2D;
  pointerId: number | null;
  startScreen: Point2D;
  dragged: boolean;
  awaitingSecondClick: boolean;
};

type PolylineOperation = {
  kind: "polyline";
  entityId: string;
  layerId: string;
  points: Point2D[];
  hover: Point2D;
};

type FreehandOperation = {
  kind: "freehand";
  entityId: string;
  layerId: string;
  pointerId: number;
  canvas: HTMLCanvasElement;
  startScreen: Point2D;
  points: Point2D[];
  zoom: number;
  dragged: boolean;
};

type DimensionOperation = {
  kind: "dimension";
  entityId: string;
  layerId: string;
  dimensionKind: "linear" | "aligned";
  stage: "end" | "placement";
  startPoint: Point2D;
  endPoint: Point2D;
  textPosition: Point2D;
  startReference?: DimensionAnchorReference;
  endReference?: DimensionAnchorReference;
};

type LeaderOperation = {
  kind: "leader";
  entityId: string;
  layerId: string;
  stage: "elbow" | "text";
  arrowPoint: Point2D;
  elbowPoint: Point2D;
  textPosition: Point2D;
};

type MarqueeOperation = {
  kind: "marquee";
  pointerId: number;
  start: Point2D;
  current: Point2D;
  startScreen: Point2D;
  additive: boolean;
};

type TransformOperation = {
  kind: "move" | "scale" | "rotate";
  pointerId: number;
  origin: Point2D;
  startScreen: Point2D;
  before: readonly Entity[];
  excludedEntityIds: ReadonlySet<string>;
  latest: readonly Entity[];
  originalBounds: BoundingBox;
  handle: TransformHandle | null;
  handleOffset: Point2D;
  rotationCenter: Point2D;
  rotationStartAngle: number;
  changed: boolean;
};

type PointerOperation = CreationOperation | PolylineOperation | FreehandOperation | DimensionOperation | LeaderOperation | MarqueeOperation | TransformOperation;

interface CreationStateMachineOptions {
  readonly screenToWorld: (clientX: number, clientY: number) => Point2D;
  readonly requestRender: () => void;
  readonly renderStateRef: MutableRefObject<CanvasInteractionRenderState>;
}

function createEntityId(): string {
  entitySequence += 1;
  return globalThis.crypto?.randomUUID?.() ?? `entity-${Date.now().toString(36)}-${entitySequence}`;
}

function resolvedWorldPoint(
  screenToWorld: CreationStateMachineOptions["screenToWorld"],
  x: number,
  y: number,
  excludeEntityIds?: ReadonlySet<string>,
  angleOrigin?: Point2D,
): { readonly point: Point2D; readonly snap: SnapResult | null } {
  const rawPoint = screenToWorld(x, y);
  return resolveDraftingSnap({
    cursor: rawPoint,
    zoom: useVectorStore.getState().viewport.zoom,
    ...(excludeEntityIds ? { excludeEntityIds } : {}),
    ...(angleOrigin ? { angleOrigin } : {}),
  });
}

function drawingAngleOrigin(current: PointerOperation | null, shiftKey: boolean): Point2D | undefined {
  if (!shiftKey || useVectorStore.getState().preferences.drafting.gridStyle !== "isometric") return undefined;
  if (current?.kind === "polyline") return current.points.at(-1);
  if (current?.kind === "creation") return current.origin;
  return undefined;
}

function activeDrawingLayer(layerId?: string) {
  const layer = layerId ? documentModel.getLayer(layerId) : documentModel.getActiveLayer();
  if (!layer) return null;
  return layer.visible && !layer.locked ? layer : null;
}

function annotationStyle() {
  return { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] } as const;
}

export function createDimensionEntity(
  id: string,
  dimensionKind: DimensionKind,
  startPoint: Point2D,
  endPoint: Point2D,
  textPosition: Point2D,
  layerId?: string,
  references?: DimensionEntity["references"],
): DimensionEntity | null {
  const layer = activeDrawingLayer(layerId);
  if (!layer || Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y) < Number.EPSILON) return null;
  const entity: DimensionEntity = {
    id,
    type: "dimension",
    layerId: layer.id,
    intent: "construction",
    style: annotationStyle(),
    bbox: EMPTY_BOUNDS,
    visible: true,
    locked: false,
    dimensionKind,
    startPoint: { ...startPoint },
    endPoint: { ...endPoint },
    textPosition: { ...textPosition },
    value: calculateDimensionValue(dimensionKind, startPoint, endPoint, textPosition),
    prefix: dimensionKind === "radial" ? "R" : dimensionKind === "diameter" ? "∅" : "",
    suffix: documentModel.getDocument().units,
    precision: useVectorStore.getState().preferences.drafting.decimalPrecision,
    arrowSize: 4,
    ...(references && (references.start || references.end) ? { references } : {}),
  };
  return { ...entity, bbox: calculateEntityBounds(entity) };
}

export function createLeaderEntity(
  id: string,
  arrowPoint: Point2D,
  elbowPoint: Point2D,
  textPosition: Point2D,
  layerId?: string,
  text = "Note",
): LeaderEntity | null {
  const layer = activeDrawingLayer(layerId);
  if (!layer) return null;
  const entity: LeaderEntity = {
    id,
    type: "leader",
    layerId: layer.id,
    intent: "construction",
    style: annotationStyle(),
    bbox: EMPTY_BOUNDS,
    visible: true,
    locked: false,
    arrowPoint: { ...arrowPoint },
    elbowPoint: { ...elbowPoint },
    textPosition: { ...textPosition },
    text,
  };
  return { ...entity, bbox: calculateEntityBounds(entity) };
}

export function createTextEntity(
  id: string,
  origin: Point2D,
  layerId?: string,
  text = "Text",
): TextEntity | null {
  const layer = activeDrawingLayer(layerId);
  if (!layer) return null;
  const entity: TextEntity = {
    id,
    name: "Text",
    type: "text",
    layerId: layer.id,
    intent: layer.intent,
    style: { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] },
    bbox: EMPTY_BOUNDS,
    visible: true,
    locked: false,
    text,
    fontFamily: "Roboto",
    fontSize: 24,
    x: origin.x,
    y: origin.y,
  };
  return { ...entity, bbox: calculateEntityBounds(entity) };
}

function referenceFromSnap(snap: SnapResult | null, point: Point2D): DimensionAnchorReference | undefined {
  const id = snap?.entityIds[0];
  return id ? createDimensionReference(documentModel.getDocument().entities.get(id), point, snap.type) : undefined;
}

export function createDrawingEntity(
  id: string,
  tool: ToolId,
  origin: Point2D,
  current: Point2D,
  layerId?: string,
): Entity | null {
  const layer = activeDrawingLayer(layerId);
  if (!layer) return null;

  const common = {
    id,
    layerId: layer.id,
    intent: layer.intent,
    style: {
      strokeColor: null,
      strokeWidth: 1,
      fillColor: null,
      dashArray: [],
    },
    bbox: EMPTY_BOUNDS,
    visible: true,
    locked: false,
  } as const;

  let entity: Entity;
  switch (tool) {
    case "line":
      if (Math.hypot(current.x - origin.x, current.y - origin.y) < Number.EPSILON) return null;
      entity = { ...common, type: "line", start: origin, end: current };
      break;
    case "rectangle": {
      const width = current.x - origin.x;
      const height = current.y - origin.y;
      if (Math.abs(width) < Number.EPSILON || Math.abs(height) < Number.EPSILON) return null;
      entity = {
        ...common,
        type: "rectangle",
        origin: { x: Math.min(origin.x, current.x), y: Math.min(origin.y, current.y) },
        width: Math.abs(width),
        height: Math.abs(height),
        cornerRadius: 0,
      };
      break;
    }
    case "circle": {
      const radius = Math.hypot(current.x - origin.x, current.y - origin.y);
      if (radius < Number.EPSILON) return null;
      entity = { ...common, type: "circle", center: origin, radius };
      break;
    }
    case "arc": {
      const radius = Math.hypot(current.x - origin.x, current.y - origin.y);
      if (radius < Number.EPSILON) return null;
      let endAngle = Math.atan2(current.y - origin.y, current.x - origin.x);
      if (Math.abs(endAngle) < 0.01) endAngle = Math.PI / 2;
      entity = {
        ...common,
        type: "arc",
        center: origin,
        radius,
        startAngle: 0,
        endAngle,
        counterClockwise: false,
      };
      break;
    }
    case "ellipse": {
      const rx = Math.abs(current.x - origin.x);
      const draggedY = Math.abs(current.y - origin.y);
      const ry = draggedY > Number.EPSILON ? draggedY : rx * 0.65;
      if (rx < Number.EPSILON || ry < Number.EPSILON) return null;
      entity = { ...common, type: "ellipse", cx: origin.x, cy: origin.y, rx, ry, rotation: 0 };
      break;
    }
    case "polygon": {
      const radius = Math.hypot(current.x - origin.x, current.y - origin.y);
      if (radius < Number.EPSILON) return null;
      entity = {
        ...common,
        type: "polygon",
        cx: origin.x,
        cy: origin.y,
        radius,
        sides: 5,
        rotation: Math.atan2(current.y - origin.y, current.x - origin.x),
      };
      break;
    }
    default:
      return null;
  }
  return { ...entity, bbox: calculateEntityBounds(entity) };
}

export function createPolylineEntity(
  id: string,
  committedPoints: readonly Point2D[],
  hover?: Point2D,
  layerId?: string,
): Entity | null {
  const layer = activeDrawingLayer(layerId);
  if (!layer) return null;
  const points = committedPoints.map((point) => ({ x: point.x, y: point.y }));
  const last = points.at(-1);
  if (hover && (!last || Math.hypot(hover.x - last.x, hover.y - last.y) > Number.EPSILON)) {
    points.push({ x: hover.x, y: hover.y });
  }
  if (points.length < 2) return null;
  const entity: Entity = {
    id,
    type: "polyline",
    layerId: layer.id,
    intent: layer.intent,
    style: { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] },
    bbox: EMPTY_BOUNDS,
    visible: true,
    locked: false,
    points,
    closed: false,
  };
  return { ...entity, bbox: calculateEntityBounds(entity) };
}

function selectedEntities(): readonly Entity[] {
  const document = documentModel.getDocument();
  return [...document.selection]
    .map((id) => document.entities.get(id))
    .filter((entity): entity is Entity => Boolean(entity));
}

function selectionIsEditable(entities: readonly Entity[]): boolean {
  const document = documentModel.getDocument();
  const layers = new Map(document.layers.map((layer) => [layer.id, layer]));
  return entities.length > 0 && entities.every((entity) => !entity.locked && !layers.get(entity.layerId)?.locked);
}

function topEntityAtPoint(point: Point2D, tolerance: number, candidates: Entity[]): Entity | null {
  const entities = documentModel.queryVisibleEntities({
    minX: point.x - tolerance,
    minY: point.y - tolerance,
    maxX: point.x + tolerance,
    maxY: point.y + tolerance,
  }, candidates);
  for (let index = entities.length - 1; index >= 0; index -= 1) {
    const entity = entities[index];
    if (entity && pointHitsEntity(point, entity, tolerance)) return entity;
  }
  return null;
}

function screenDistance(start: Point2D, event: ReactPointerEvent<HTMLCanvasElement>): number {
  return Math.hypot(event.clientX - start.x, event.clientY - start.y);
}

function dragThreshold(event: ReactPointerEvent<HTMLCanvasElement>): number {
  return event.pointerType === "touch" ? TOUCH_DRAG_THRESHOLD_PX : DRAG_THRESHOLD_PX;
}

export function useCreationStateMachine({
  screenToWorld,
  requestRender,
  renderStateRef,
}: CreationStateMachineOptions) {
  const operation = useRef<PointerOperation | null>(null);
  const hitCandidates = useRef<Entity[]>([]);
  const marqueeCandidates = useRef<Entity[]>([]);
  const activeTool = useVectorStore((state) => state.activeTool);

  const resetInteraction = useCallback((_restoreTransform: boolean) => {
    const previous = operation.current;
    operation.current = null;
    if (previous?.kind === "freehand" && previous.canvas.hasPointerCapture(previous.pointerId)) {
      previous.canvas.releasePointerCapture(previous.pointerId);
    }
    renderStateRef.current.previewEntity = null;
    renderStateRef.current.transformPreview = null;
    renderStateRef.current.marquee = null;
    renderStateRef.current.activeSnap = null;
    requestRender();
  }, [operation, renderStateRef, requestRender]);

  const finishPolyline = useCallback(() => {
    const current = operation.current;
    if (current?.kind !== "polyline") return;
    const entity = createPolylineEntity(current.entityId, current.points, undefined, current.layerId);
    if (entity) executeCommand(new AddEntityCommand(entity));
    resetInteraction(false);
  }, [resetInteraction]);

  useEffect(() => {
    const current = operation.current;
    if (!current) return;
    if (current.kind === "creation" && current.tool !== activeTool) resetInteraction(false);
    else if (current.kind === "polyline" && activeTool !== "pen") finishPolyline();
    else if (current.kind === "freehand" && activeTool !== "freehand") resetInteraction(false);
    else if (current.kind === "dimension" && activeTool !== "dimension" && activeTool !== "linear-dimension") resetInteraction(false);
    else if (current.kind === "leader" && activeTool !== "leader") resetInteraction(false);
    else if (
      current.kind !== "creation" && current.kind !== "polyline" && current.kind !== "freehand" &&
      current.kind !== "dimension" && current.kind !== "leader" &&
      activeTool !== "select"
    ) resetInteraction(true);
  }, [activeTool, finishPolyline, resetInteraction]);

  useEffect(() => {
    // A view change or interrupted pointer must never connect two unrelated parts of a stroke.
    const cancelFreehand = () => {
      if (operation.current?.kind === "freehand") resetInteraction(false);
    };
    const unsubscribe = useVectorStore.subscribe((state, previous) => {
      if (state.activeTool !== "freehand" || state.temporaryPanActive || state.canvasPanning ||
          state.viewport.x !== previous.viewport.x || state.viewport.y !== previous.viewport.y ||
          state.viewport.zoom !== previous.viewport.zoom) cancelFreehand();
    });
    window.addEventListener("blur", cancelFreehand);
    return () => {
      unsubscribe();
      window.removeEventListener("blur", cancelFreehand);
    };
  }, [resetInteraction]);

  useEffect(() => documentModel.subscribe((_document, change) => {
    if (change.type === "document-replaced") resetInteraction(false);
  }), [resetInteraction]);

  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      const current = operation.current;
      if (!current) return;
      if (current.kind === "polyline" && (event.key === "Enter" || event.key === "Escape")) {
        event.preventDefault();
        finishPolyline();
      } else if (event.key === "Escape") {
        resetInteraction(true);
      }
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [finishPolyline, resetInteraction]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return false;
    const vectorState = useVectorStore.getState();
    if (vectorState.temporaryPanActive) return false;
    const tool = vectorState.activeTool;
    const rawWorld = screenToWorld(event.clientX, event.clientY);
    const current = operation.current;
    const annotationTool = tool === "dimension" || tool === "linear-dimension" || tool === "leader";
    const resolved = DRAWING_TOOLS.has(tool) || tool === "pen" || tool === "text" || annotationTool
      ? resolvedWorldPoint(screenToWorld, event.clientX, event.clientY, undefined, drawingAngleOrigin(current, event.shiftKey))
      : null;
    const world = resolved?.point ?? rawWorld;
    renderStateRef.current.activeSnap = resolved?.snap ?? null;

    if (tool === "dimension" || tool === "linear-dimension") {
      const dimensionKind = tool === "linear-dimension" ? "linear" : "aligned";
      if (current?.kind === "dimension" && current.dimensionKind === dimensionKind) {
        if (current.stage === "end") {
          current.endPoint = world;
          const endReference = referenceFromSnap(resolved?.snap ?? null, world);
          if (endReference) current.endReference = endReference;
          current.stage = "placement";
          current.textPosition = {
            x: (current.startPoint.x + world.x) / 2,
            y: (current.startPoint.y + world.y) / 2 + 16 / vectorState.viewport.zoom,
          };
        } else {
          const entity = createDimensionEntity(
            current.entityId,
            current.dimensionKind,
            current.startPoint,
            current.endPoint,
            world,
            current.layerId,
            {
              ...(current.startReference ? { start: current.startReference } : {}),
              ...(current.endReference ? { end: current.endReference } : {}),
            },
          );
          if (entity) executeCommand(new AddEntityCommand(entity));
          resetInteraction(false);
          event.preventDefault();
          return true;
        }
        renderStateRef.current.previewEntity = createDimensionEntity(
          current.entityId,
          current.dimensionKind,
          current.startPoint,
          current.endPoint,
          current.textPosition,
          current.layerId,
        );
      } else {
        const layer = activeDrawingLayer();
        if (!layer) return true;
        const startReference = referenceFromSnap(resolved?.snap ?? null, world);
        operation.current = {
          kind: "dimension",
          entityId: createEntityId(),
          layerId: layer.id,
          dimensionKind,
          stage: "end",
          startPoint: world,
          endPoint: world,
          textPosition: world,
          ...(startReference ? { startReference } : {}),
        };
        renderStateRef.current.previewEntity = null;
      }
      requestRender();
      event.preventDefault();
      return true;
    }

    if (tool === "radial-dimension" || tool === "diameter-dimension") {
      const tolerance = (event.pointerType === "touch" ? TOUCH_ENTITY_HIT_RADIUS_PX : 8) / vectorState.viewport.zoom;
      const hit = topEntityAtPoint(rawWorld, tolerance, hitCandidates.current);
      if (hit?.type === "circle" || hit?.type === "arc") {
        const angle = Math.atan2(rawWorld.y - hit.center.y, rawWorld.x - hit.center.x);
        const endPoint = {
          x: hit.center.x + Math.cos(angle) * hit.radius,
          y: hit.center.y + Math.sin(angle) * hit.radius,
        };
        const textPosition = {
          x: hit.center.x + Math.cos(angle) * (hit.radius + 22 / vectorState.viewport.zoom),
          y: hit.center.y + Math.sin(angle) * (hit.radius + 22 / vectorState.viewport.zoom),
        };
        const pathReference = createDimensionReference(hit, endPoint, "endpoint");
        const centerReference = createDimensionReference(hit, hit.center, "center");
        const entity = createDimensionEntity(
          createEntityId(),
          tool === "radial-dimension" ? "radial" : "diameter",
          hit.center,
          endPoint,
          textPosition,
          undefined,
          {
            ...(centerReference ? { start: centerReference } : {}),
            ...(pathReference ? { end: pathReference } : {}),
          },
        );
        if (entity) executeCommand(new AddEntityCommand(entity));
      }
      renderStateRef.current.activeSnap = null;
      requestRender();
      event.preventDefault();
      return true;
    }

    if (tool === "leader") {
      if (current?.kind === "leader") {
        if (current.stage === "elbow") {
          current.elbowPoint = world;
          current.textPosition = world;
          current.stage = "text";
        } else {
          const entity = createLeaderEntity(current.entityId, current.arrowPoint, current.elbowPoint, world, current.layerId);
          if (entity) executeCommand(new AddEntityCommand(entity));
          resetInteraction(false);
          event.preventDefault();
          return true;
        }
        renderStateRef.current.previewEntity = createLeaderEntity(
          current.entityId, current.arrowPoint, current.elbowPoint, current.textPosition, current.layerId,
        );
      } else {
        const layer = activeDrawingLayer();
        if (!layer) return true;
        operation.current = {
          kind: "leader",
          entityId: createEntityId(),
          layerId: layer.id,
          stage: "elbow",
          arrowPoint: world,
          elbowPoint: world,
          textPosition: world,
        };
        renderStateRef.current.previewEntity = null;
      }
      requestRender();
      event.preventDefault();
      return true;
    }

    if (tool === "freehand") {
      if (current?.kind === "freehand" || !event.isPrimary) return true;
      const layer = activeDrawingLayer();
      if (!layer) return true;
      event.currentTarget.setPointerCapture(event.pointerId);
      operation.current = {
        kind: "freehand",
        entityId: createEntityId(),
        layerId: layer.id,
        pointerId: event.pointerId,
        canvas: event.currentTarget,
        startScreen: { x: event.clientX, y: event.clientY },
        points: [rawWorld],
        zoom: vectorState.viewport.zoom,
        dragged: false,
      };
      renderStateRef.current.previewEntity = null;
      requestRender();
      event.preventDefault();
      return true;
    }

    if (tool === "text") {
      const entity = createTextEntity(createEntityId(), world);
      if (entity) executeCommand(new AddEntityCommand(entity));
      renderStateRef.current.activeSnap = null;
      requestRender();
      event.preventDefault();
      return true;
    }

    if (tool === "pen") {
      if (current?.kind === "polyline") {
        const last = current.points.at(-1);
        if (!last || Math.hypot(world.x - last.x, world.y - last.y) > Number.EPSILON) {
          current.points.push({ x: world.x, y: world.y });
        }
        current.hover = world;
        if (event.detail >= 2) finishPolyline();
        else {
          renderStateRef.current.previewEntity = createPolylineEntity(
            current.entityId,
            current.points,
            current.hover,
            current.layerId,
          );
          requestRender();
        }
      } else {
        const layer = activeDrawingLayer();
        if (!layer) return true;
        operation.current = {
          kind: "polyline",
          entityId: createEntityId(),
          layerId: layer.id,
          points: [{ x: world.x, y: world.y }],
          hover: world,
        };
        renderStateRef.current.previewEntity = null;
        requestRender();
      }
      event.preventDefault();
      return true;
    }

    if (current?.kind === "creation" && current.awaitingSecondClick && current.tool === tool) {
      const entity = createDrawingEntity(current.entityId, tool, current.origin, world, current.layerId);
      if (entity) executeCommand(new AddEntityCommand(entity));
      resetInteraction(false);
      event.preventDefault();
      return true;
    }

    if (DRAWING_TOOLS.has(tool)) {
      const layer = activeDrawingLayer();
      if (!layer) return true;
      event.currentTarget.setPointerCapture(event.pointerId);
      const next: CreationOperation = {
        kind: "creation",
        entityId: createEntityId(),
        layerId: layer.id,
        tool,
        origin: world,
        current: world,
        pointerId: event.pointerId,
        startScreen: { x: event.clientX, y: event.clientY },
        dragged: false,
        awaitingSecondClick: false,
      };
      operation.current = next;
      renderStateRef.current.previewEntity = null;
      requestRender();
      event.preventDefault();
      return true;
    }

    if (tool !== "select") return false;

    const selected = selectedEntities();
    const bounds = getSelectionBounds(selected);
    if (bounds && selectionIsEditable(selected)) {
      const handle = hitTestTransformHandle(
        world,
        bounds,
        vectorState.viewport.zoom,
        event.pointerType === "touch" ? TOUCH_HANDLE_HIT_RADIUS_PX : undefined,
      );
      if (handle || pointInsideSelection(world, bounds)) {
        const handlePoint = handle && handle !== "rotate" ? getScaleHandlePoint(bounds, handle) : null;
        event.currentTarget.setPointerCapture(event.pointerId);
        operation.current = {
          kind: handle === "rotate" ? "rotate" : handle ? "scale" : "move",
          pointerId: event.pointerId,
          origin: world,
          startScreen: { x: event.clientX, y: event.clientY },
          before: selected,
          excludedEntityIds: new Set(selected.map((entity) => entity.id)),
          latest: selected,
          originalBounds: bounds,
          handle,
          handleOffset: handlePoint
            ? { x: world.x - handlePoint.x, y: world.y - handlePoint.y }
            : { x: 0, y: 0 },
          rotationCenter: {
            x: (bounds.minX + bounds.maxX) / 2,
            y: (bounds.minY + bounds.maxY) / 2,
          },
          rotationStartAngle: Math.atan2(
            world.y - (bounds.minY + bounds.maxY) / 2,
            world.x - (bounds.minX + bounds.maxX) / 2,
          ),
          changed: false,
        };
        event.preventDefault();
        return true;
      }
    }

    const tolerance = (event.pointerType === "touch" ? TOUCH_ENTITY_HIT_RADIUS_PX : 6) / vectorState.viewport.zoom;
    const hit = topEntityAtPoint(world, tolerance, hitCandidates.current);
    if (hit) {
      const selection = documentModel.getDocument().selection;
      if (event.shiftKey) {
        const next = new Set(selection);
        if (next.has(hit.id)) next.delete(hit.id);
        else next.add(hit.id);
        documentModel.selectEntities([...next]);
        requestRender();
        return true;
      }
      if (!selection.has(hit.id)) documentModel.selectEntities([hit.id]);
      const nextSelected = selectedEntities();
      const nextBounds = getSelectionBounds(nextSelected);
      if (nextBounds && selectionIsEditable(nextSelected)) {
        event.currentTarget.setPointerCapture(event.pointerId);
        operation.current = {
          kind: "move",
          pointerId: event.pointerId,
          origin: world,
          startScreen: { x: event.clientX, y: event.clientY },
          before: nextSelected,
          excludedEntityIds: new Set(nextSelected.map((entity) => entity.id)),
          latest: nextSelected,
          originalBounds: nextBounds,
          handle: null,
          handleOffset: { x: 0, y: 0 },
          rotationCenter: {
            x: (nextBounds.minX + nextBounds.maxX) / 2,
            y: (nextBounds.minY + nextBounds.maxY) / 2,
          },
          rotationStartAngle: 0,
          changed: false,
        };
      }
      event.preventDefault();
      return true;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    operation.current = {
      kind: "marquee",
      pointerId: event.pointerId,
      start: world,
      current: world,
      startScreen: { x: event.clientX, y: event.clientY },
      additive: event.shiftKey,
    };
    renderStateRef.current.marquee = { start: world, current: world };
    requestRender();
    event.preventDefault();
    return true;
  }, [finishPolyline, operation, renderStateRef, requestRender, resetInteraction, screenToWorld]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (useVectorStore.getState().temporaryPanActive) return false;
    const current = operation.current;
    if (!current) return false;
    if (current.kind === "freehand") {
      if (current.pointerId !== event.pointerId) return true;
      // Use raw, unsnapped samples, including pen samples coalesced by the browser.
      const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
      for (const sample of [...samples, event]) {
        const point = screenToWorld(sample.clientX, sample.clientY);
        const last = current.points.at(-1)!;
        if (Math.hypot(point.x - last.x, point.y - last.y) * current.zoom >= 1) {
          current.points.push(point);
        }
        if (Math.hypot(sample.clientX - current.startScreen.x, sample.clientY - current.startScreen.y) >= dragThreshold(event)) {
          current.dragged = true;
        }
      }
      renderStateRef.current.activeSnap = null;
      renderStateRef.current.previewEntity = current.dragged
        ? createPolylineEntity(current.entityId, current.points, undefined, current.layerId)
        : null;
      requestRender();
      return true;
    }
    const rawWorld = screenToWorld(event.clientX, event.clientY);
    const snapMoveToGrid = current.kind === "move"
      && isGridSnapEnabled();
    let resolved: { readonly point: Point2D; readonly snap: SnapResult | null } | null = null;
    switch (current.kind) {
      case "creation":
      case "polyline":
      case "dimension":
      case "leader":
        // Drawing always resolves the absolute cursor coordinate. It must not
        // inherit any selection-move anchor or displacement calculations.
        resolved = resolvedWorldPoint(screenToWorld, event.clientX, event.clientY, undefined, drawingAngleOrigin(current, event.shiftKey));
        break;
      case "scale":
        resolved = resolvedWorldPoint(
          screenToWorld,
          event.clientX,
          event.clientY,
          current.excludedEntityIds,
        );
        break;
      case "move":
        // With Grid Snap enabled the move branch below quantizes only the
        // pointer displacement. Without it, retain normal OSNAP behaviour.
        if (!snapMoveToGrid) {
          resolved = resolvedWorldPoint(
            screenToWorld,
            event.clientX,
            event.clientY,
            current.excludedEntityIds,
          );
        }
        break;
      case "marquee":
      case "rotate":
        break;
    }
    const world = resolved?.point ?? rawWorld;
    renderStateRef.current.activeSnap = resolved?.snap ?? null;

    if (current.kind === "dimension") {
      if (current.stage === "end") current.endPoint = world;
      else current.textPosition = world;
      renderStateRef.current.previewEntity = createDimensionEntity(
        current.entityId,
        current.dimensionKind,
        current.startPoint,
        current.endPoint,
        current.textPosition,
        current.layerId,
      );
      requestRender();
      return true;
    }

    if (current.kind === "leader") {
      if (current.stage === "elbow") {
        current.elbowPoint = world;
        current.textPosition = world;
      } else current.textPosition = world;
      renderStateRef.current.previewEntity = createLeaderEntity(
        current.entityId, current.arrowPoint, current.elbowPoint, current.textPosition, current.layerId,
      );
      requestRender();
      return true;
    }

    if (current.kind === "polyline") {
      current.hover = world;
      renderStateRef.current.previewEntity = createPolylineEntity(
        current.entityId,
        current.points,
        world,
        current.layerId,
      );
      requestRender();
      return true;
    }

    if (current.kind === "creation") {
      if (current.pointerId !== null && current.pointerId !== event.pointerId) return false;
      current.current = world;
      if (!current.awaitingSecondClick && screenDistance(current.startScreen, event) >= dragThreshold(event)) {
        current.dragged = true;
      }
      const preview = createDrawingEntity(current.entityId, current.tool, current.origin, world, current.layerId);
      renderStateRef.current.previewEntity = preview;
      requestRender();
      return true;
    }

    if (current.pointerId !== event.pointerId) return false;
    if (current.kind === "marquee") {
      current.current = world;
      renderStateRef.current.marquee = { start: current.start, current: world };
      requestRender();
      return true;
    }

    if (!current.changed && screenDistance(current.startScreen, event) < dragThreshold(event)) return true;
    current.changed = true;
    const transformed = current.kind === "move"
      ? translateEntities(
          current.before,
          snapMoveToGrid
            ? snapWorldDeltaToGrid({
                x: rawWorld.x - current.origin.x,
                y: rawWorld.y - current.origin.y,
              })
            : {
                x: world.x - current.origin.x,
                y: world.y - current.origin.y,
              },
        )
      : current.kind === "rotate"
        ? (() => {
            let angle = Math.atan2(
              world.y - current.rotationCenter.y,
              world.x - current.rotationCenter.x,
            ) - current.rotationStartAngle;
            if (event.shiftKey) {
              const increment = getAngleSnapDegrees() * Math.PI / 180;
              angle = Math.round(angle / increment) * increment;
            }
            return rotateEntities(current.before, current.rotationCenter, angle);
          })()
        : scaleEntities(
            current.before,
            current.originalBounds,
            current.handle as ScaleHandle,
            { x: world.x - current.handleOffset.x, y: world.y - current.handleOffset.y },
            event.shiftKey,
          );
    current.latest = transformed;
    renderStateRef.current.transformPreview = transformed;
    requestRender();
    return true;
  }, [operation, renderStateRef, requestRender, screenToWorld]);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const current = operation.current;
    if (!current) return false;

    if (current.kind === "freehand") {
      if (current.pointerId !== event.pointerId) return true;
      const end = screenToWorld(event.clientX, event.clientY);
      const last = current.points.at(-1)!;
      if (Math.hypot(end.x - last.x, end.y - last.y) > Number.EPSILON) current.points.push(end);
      if (current.dragged || screenDistance(current.startScreen, event) >= dragThreshold(event)) {
        // Keep the original endpoints and bends while removing sub-pixel sampling noise.
        const points = simplifyOpen(current.points, 0.75 / current.zoom);
        const entity = createPolylineEntity(current.entityId, points, undefined, current.layerId);
        if (entity) executeCommand(new AddEntityCommand({ ...entity, name: "Freehand" }));
      }
      resetInteraction(false);
      return true;
    }

    if (current.kind === "polyline") return true;
    if (current.kind === "dimension" || current.kind === "leader") return true;
    if (current.kind === "creation") {
      if (current.pointerId !== event.pointerId) return false;
      const resolved = resolvedWorldPoint(screenToWorld, event.clientX, event.clientY, undefined, drawingAngleOrigin(current, event.shiftKey));
      const world = resolved.point;
      renderStateRef.current.activeSnap = resolved.snap;
      current.current = world;
      if (screenDistance(current.startScreen, event) >= dragThreshold(event)) current.dragged = true;
      if (current.dragged) {
        const entity = createDrawingEntity(current.entityId, current.tool, current.origin, world, current.layerId);
        if (entity) executeCommand(new AddEntityCommand(entity));
        resetInteraction(false);
      } else {
        current.pointerId = null;
        current.awaitingSecondClick = true;
        const preview = createDrawingEntity(current.entityId, current.tool, current.origin, world, current.layerId);
        renderStateRef.current.previewEntity = preview;
        requestRender();
      }
      return true;
    }

    if (current.pointerId !== event.pointerId) return false;
    if (current.kind === "marquee") {
      current.current = screenToWorld(event.clientX, event.clientY);
      if (screenDistance(current.startScreen, event) < dragThreshold(event)) {
        if (!current.additive) documentModel.clearSelection();
      } else {
        const box = normalizeBox(current.start, current.current);
        const candidates = documentModel.queryVisibleEntities(box, marqueeCandidates.current);
        const matches: string[] = [];
        for (const entity of candidates) {
          if (entityIntersectsBox(entity, box)) matches.push(entity.id);
        }
        const ids = current.additive
          ? [...new Set([...documentModel.getDocument().selection, ...matches])]
          : matches;
        documentModel.selectEntities(ids);
      }
      resetInteraction(false);
      return true;
    }

    if (current.kind === "move" || current.kind === "scale" || current.kind === "rotate") {
      // A touch release can carry the final position without an intervening move.
      onPointerMove(event);
    }
    if (current.changed) {
      executeCommand(
        new TransformEntityCommand(
          current.before,
          current.latest,
          current.kind === "move" ? "Move" : current.kind === "scale" ? "Scale" : "Rotate",
        ),
      );
    }
    resetInteraction(false);
    return true;
  }, [onPointerMove, operation, renderStateRef, requestRender, resetInteraction, screenToWorld]);

  const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const current = operation.current;
    if (current && "pointerId" in current && current.pointerId === event.pointerId) {
      resetInteraction(true);
      return true;
    }
    return false;
  }, [operation, resetInteraction]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    cancelInteraction: () => resetInteraction(true),
  };
}
