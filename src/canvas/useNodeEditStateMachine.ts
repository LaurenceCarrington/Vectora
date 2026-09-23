import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { calculateEntityBounds, documentModel } from "../document/DocumentModel";
import { UpdateEntitiesCommand, executeCommand } from "../document/History";
import type { BezierNodeType, Entity, Point2D, PolylineEntity, PolylineSegment } from "../document/types";
import {
  applyBezierNodeType,
  bridgeAfterNodeRemoval,
  clonePolylineSegments,
  evaluatePolylineSegment,
  getPolylineSegment,
  polylineSegmentCount,
} from "../geometry/bezier";
import { getAngleSnapDegrees, snapWorldPointToAngle } from "../geometry/Snapping";
import { pointHitsEntity } from "../geometry/HitTest";
import { entityToEditablePolyline } from "../geometry/operations/pathConversion";
import { useVectorStore } from "../store/useVectorStore";

const NODE_HIT_RADIUS_PX = 9;
const HANDLE_HIT_RADIUS_PX = 8;
const SEGMENT_HIT_RADIUS_PX = 7;

export interface NodeEditHandle {
  readonly segmentIndex: number;
  readonly control: "cp1" | "cp2";
  readonly anchorIndex: number;
  readonly point: Point2D;
}

export interface NodeEditRenderState {
  readonly entityId: string;
  readonly points: readonly Point2D[];
  readonly segments: readonly PolylineSegment[];
  readonly nodeTypes: readonly BezierNodeType[];
  readonly handles: readonly NodeEditHandle[];
  readonly closed: boolean;
  readonly selectedVertex: number | null;
  readonly selectedHandle: Pick<NodeEditHandle, "segmentIndex" | "control"> | null;
}

interface NodeEditRenderHost { nodeEdit: NodeEditRenderState | null }
interface NodeEditOptions {
  readonly screenToWorld: (clientX: number, clientY: number) => Point2D;
  readonly requestRender: () => void;
  readonly renderStateRef: MutableRefObject<NodeEditRenderHost>;
}

interface NodeEditSession {
  editTool: "select" | "node-edit";
  entity: PolylineEntity;
  points: Point2D[];
  segments: PolylineSegment[];
  nodeTypes: BezierNodeType[];
  selectedVertex: number | null;
  selectedHandle: NodeEditHandle | null;
  pointerId: number | null;
  dragBefore: PolylineEntity | null;
  dragChanged: boolean;
}

interface SegmentProjection {
  readonly segmentIndex: number;
  readonly point: Point2D;
  readonly distance: number;
  readonly amount: number;
}

function squaredDistance(left: Point2D, right: Point2D): number {
  const x = left.x - right.x;
  const y = left.y - right.y;
  return x * x + y * y;
}

function supportsNodeEditing(entity: Entity): boolean {
  return entity.type !== "text" && entity.type !== "dimension" && entity.type !== "leader";
}

function projectToLine(point: Point2D, start: Point2D, end: Point2D): Omit<SegmentProjection, "segmentIndex"> {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared <= Number.EPSILON
    ? 0
    : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  const projected = { x: start.x + dx * amount, y: start.y + dy * amount };
  return { point: projected, distance: Math.sqrt(squaredDistance(point, projected)), amount };
}

export function nearestPolylineSegment(
  point: Point2D,
  points: readonly Point2D[],
  closed: boolean,
  segments?: readonly PolylineSegment[],
  curveTolerance = 0.25,
): SegmentProjection | null {
  const count = polylineSegmentCount(points, closed);
  if (count < 1) return null;
  let nearest: SegmentProjection | null = null;
  for (let index = 0; index < count; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    if (!start || !end) continue;
    const segment = getPolylineSegment(segments, index);
    if (segment.type === "line") {
      const projection = projectToLine(point, start, end);
      if (!nearest || projection.distance < nearest.distance) nearest = { segmentIndex: index, ...projection };
      continue;
    }
    const controlFlatness = segment.type === "quadratic"
      ? projectToLine(segment.cp1, start, end).distance
      : Math.max(projectToLine(segment.cp1, start, end).distance, projectToLine(segment.cp2, start, end).distance);
    const projectionSteps = Math.max(12, Math.min(96,
      Math.ceil(Math.sqrt(controlFlatness / Math.max(curveTolerance, 0.001)) * 8),
    ));
    let previous = start;
    for (let step = 1; step <= projectionSteps; step += 1) {
      const amount = step / projectionSteps;
      const current = evaluatePolylineSegment(start, end, segment, amount);
      const local = projectToLine(point, previous, current);
      const projectedAmount = (step - 1 + local.amount) / projectionSteps;
      if (!nearest || local.distance < nearest.distance) {
        nearest = { segmentIndex: index, point: local.point, distance: local.distance, amount: projectedAmount };
      }
      previous = current;
    }
  }
  return nearest;
}

function nearestVertex(point: Point2D, points: readonly Point2D[], tolerance: number): number | null {
  const toleranceSquared = tolerance * tolerance;
  let result: number | null = null;
  let distance = toleranceSquared;
  for (let index = 0; index < points.length; index += 1) {
    const candidate = points[index];
    if (!candidate) continue;
    const nextDistance = squaredDistance(point, candidate);
    if (nextDistance <= distance) { distance = nextDistance; result = index; }
  }
  return result;
}

function listHandles(
  points: readonly Point2D[],
  closed: boolean,
  segments: readonly PolylineSegment[],
  selectedVertex: number | null,
): NodeEditHandle[] {
  const handles: NodeEditHandle[] = [];
  if (selectedVertex === null) return handles;
  const count = polylineSegmentCount(points, closed);
  for (let segmentIndex = 0; segmentIndex < count; segmentIndex += 1) {
    const segment = getPolylineSegment(segments, segmentIndex);
    if (segment.type === "line") continue;
    if (selectedVertex === segmentIndex) {
      handles.push({ segmentIndex, control: "cp1", anchorIndex: segmentIndex, point: segment.cp1 });
    }
    if (segment.type === "cubic") {
      const anchorIndex: number = (segmentIndex + 1) % points.length;
      if (selectedVertex === anchorIndex) {
        handles.push({ segmentIndex, control: "cp2", anchorIndex, point: segment.cp2 });
      }
    }
  }
  return handles;
}

function nearestHandle(point: Point2D, handles: readonly NodeEditHandle[], tolerance: number): NodeEditHandle | null {
  const toleranceSquared = tolerance * tolerance;
  let nearest: NodeEditHandle | null = null;
  let distance = toleranceSquared;
  for (const handle of handles) {
    const nextDistance = squaredDistance(point, handle.point);
    if (nextDistance <= distance) { nearest = handle; distance = nextDistance; }
  }
  return nearest;
}

function clonePoint(point: Point2D): Point2D { return { x: point.x, y: point.y }; }
function lerp(left: Point2D, right: Point2D, amount: number): Point2D {
  return { x: left.x + (right.x - left.x) * amount, y: left.y + (right.y - left.y) * amount };
}

function splitSegment(session: NodeEditSession, segmentIndex: number, amount: number): number {
  const start = session.points[segmentIndex]!;
  const end = session.points[(segmentIndex + 1) % session.points.length]!;
  const segment = getPolylineSegment(session.segments, segmentIndex);
  const t = Math.max(0.001, Math.min(0.999, amount));
  const point = evaluatePolylineSegment(start, end, segment, t);
  let left: PolylineSegment = { type: "line" };
  let right: PolylineSegment = { type: "line" };
  if (segment.type === "quadratic") {
    const first = lerp(start, segment.cp1, t);
    const second = lerp(segment.cp1, end, t);
    left = { type: "quadratic", cp1: first };
    right = { type: "quadratic", cp1: second };
  } else if (segment.type === "cubic") {
    const first = lerp(start, segment.cp1, t);
    const middle = lerp(segment.cp1, segment.cp2, t);
    const last = lerp(segment.cp2, end, t);
    const leftMiddle = lerp(first, middle, t);
    const rightMiddle = lerp(middle, last, t);
    left = { type: "cubic", cp1: first, cp2: leftMiddle };
    right = { type: "cubic", cp1: rightMiddle, cp2: last };
  }
  const insertIndex = segmentIndex + 1;
  session.points.splice(insertIndex, 0, point);
  session.nodeTypes.splice(insertIndex, 0, "corner");
  session.segments.splice(segmentIndex, 1, left, right);
  return insertIndex;
}

function removeVertex(session: NodeEditSession, vertexIndex: number): void {
  const oldPoints = session.points;
  const oldSegments = session.segments;
  const nextPoints = oldPoints.filter((_, index) => index !== vertexIndex);
  const nextSegments: PolylineSegment[] = [];
  const count = polylineSegmentCount(nextPoints, session.entity.closed);
  for (let index = 0; index < count; index += 1) {
    const newEnd = (index + 1) % nextPoints.length;
    const oldStart = index < vertexIndex ? index : index + 1;
    const oldEnd = newEnd < vertexIndex ? newEnd : newEnd + 1;
    if (oldEnd === (oldStart + 1) % oldPoints.length) {
      nextSegments.push(getPolylineSegment(oldSegments, oldStart));
    } else {
      const previous = oldPoints[oldStart];
      const removed = oldPoints[vertexIndex];
      const next = oldPoints[oldEnd];
      nextSegments.push(previous && removed && next
        ? bridgeAfterNodeRemoval(
            getPolylineSegment(oldSegments, oldStart),
            getPolylineSegment(oldSegments, vertexIndex),
            previous,
            removed,
            next,
          )
        : { type: "line" });
    }
  }
  session.points = nextPoints;
  session.segments = nextSegments;
  session.nodeTypes.splice(vertexIndex, 1);
}

function entitiesDiffer(left: PolylineEntity, right: PolylineEntity): boolean {
  return JSON.stringify([left.points, left.segments, left.nodeTypes]) !== JSON.stringify([right.points, right.segments, right.nodeTypes]);
}

export function useNodeEditStateMachine({ screenToWorld, requestRender, renderStateRef }: NodeEditOptions) {
  const sessionRef = useRef<NodeEditSession | null>(null);
  const candidatesRef = useRef<Entity[]>([]);
  const ownMutationRef = useRef(false);
  const activeTool = useVectorStore((state) => state.activeTool);

  const publish = useCallback(() => {
    const session = sessionRef.current;
    // Only the active node's handles are shown. Complex imported paths remain
    // readable and control-point hit testing stays O(adjacent handles).
    const handles = session
      ? listHandles(session.points, session.entity.closed, session.segments, session.selectedVertex)
      : [];
    renderStateRef.current.nodeEdit = session ? {
      entityId: session.entity.id,
      points: session.points,
      segments: session.segments,
      nodeTypes: session.nodeTypes,
      handles,
      closed: session.entity.closed,
      selectedVertex: session.selectedVertex,
      selectedHandle: session.selectedHandle,
    } : null;
    const selectedVertex = session?.selectedVertex;
    useVectorStore.getState().setNodeEditSelection(session && selectedVertex !== null && selectedVertex !== undefined
      ? { entityId: session.entity.id, vertexIndex: selectedVertex, nodeType: session.nodeTypes[selectedVertex] ?? "corner" }
      : null);
    requestRender();
  }, [renderStateRef, requestRender]);

  const buildEntity = useCallback((session: NodeEditSession): PolylineEntity => {
    const candidate: PolylineEntity = {
      ...session.entity,
      points: session.points.map(clonePoint),
      segments: session.segments,
      nodeTypes: session.nodeTypes,
    };
    return { ...candidate, bbox: calculateEntityBounds(candidate) };
  }, []);

  const replaceLive = useCallback((session: NodeEditSession): PolylineEntity => {
    const candidate = buildEntity(session);
    ownMutationRef.current = true;
    try {
      const [updated] = documentModel.replaceEntities([candidate]);
      session.entity = updated as PolylineEntity;
      return session.entity;
    } finally { ownMutationRef.current = false; }
  }, [buildEntity]);

  const commitImmediate = useCallback((session: NodeEditSession, before: PolylineEntity, label: string) => {
    const after = buildEntity(session);
    ownMutationRef.current = true;
    try {
      executeCommand(new UpdateEntitiesCommand([before], [after], label));
      session.entity = documentModel.getDocument().entities.get(before.id) as PolylineEntity;
    } finally { ownMutationRef.current = false; }
    publish();
  }, [buildEntity, publish]);

  const finish = useCallback((_commit = true) => {
    const session = sessionRef.current;
    if (!session) return;
    if (session.pointerId !== null && session.dragBefore && session.dragChanged) {
      ownMutationRef.current = true;
      try { documentModel.replaceEntities([session.dragBefore]); } finally { ownMutationRef.current = false; }
    }
    sessionRef.current = null;
    renderStateRef.current.nodeEdit = null;
    useVectorStore.getState().setNodeEditSelection(null);
    requestRender();
  }, [renderStateRef, requestRender]);

  const begin = useCallback((source: Entity): boolean => {
    let entity = source.type === "polyline" ? source : entityToEditablePolyline(source);
    if (!entity) return false;
    if (source.type !== "polyline") {
      ownMutationRef.current = true;
      try {
        executeCommand(new UpdateEntitiesCommand([source], [entity], "Convert to editable path"));
        const updated = documentModel.getDocument().entities.get(source.id);
        if (updated?.type !== "polyline") return false;
        entity = updated;
      } finally { ownMutationRef.current = false; }
    }
    const currentTool = useVectorStore.getState().activeTool;
    sessionRef.current = {
      editTool: currentTool === "node-edit" ? "node-edit" : "select",
      entity,
      points: entity.points.map(clonePoint),
      segments: clonePolylineSegments(entity),
      nodeTypes: entity.points.map((_, index) => entity.nodeTypes?.[index] ?? "corner"),
      selectedVertex: null, selectedHandle: null, pointerId: null, dragBefore: null, dragChanged: false,
    };
    documentModel.selectEntities([entity.id]);
    publish();
    return true;
  }, [publish]);

  useEffect(() => {
    const current = sessionRef.current;
    if ((activeTool !== "select" && activeTool !== "node-edit") || (current && current.editTool !== activeTool)) {
      finish(false);
    }
    if (activeTool !== "node-edit" || sessionRef.current) return;
    const selectedIds = [...documentModel.getDocument().selection];
    if (selectedIds.length !== 1) return;
    const selected = documentModel.getDocument().entities.get(selectedIds[0]!);
    const layer = selected ? documentModel.getLayer(selected.layerId) : undefined;
    if (selected && supportsNodeEditing(selected) && !selected.locked && !layer?.locked) begin(selected);
  }, [activeTool, begin, finish]);

  useEffect(() => documentModel.subscribe((document, change) => {
    const session = sessionRef.current;
    if (ownMutationRef.current) return;
    if (!session) {
      if (change.type !== "selection-changed" || useVectorStore.getState().activeTool !== "node-edit") return;
      const selectedIds = [...document.selection];
      if (selectedIds.length !== 1) return;
      const selected = document.entities.get(selectedIds[0]!);
      const layer = selected ? documentModel.getLayer(selected.layerId) : undefined;
      if (selected && supportsNodeEditing(selected) && !selected.locked && !layer?.locked) begin(selected);
      return;
    }
    const entityChanged =
      (change.type === "entity-updated" && change.entityId === session.entity.id) ||
      (change.type === "entities-updated" && change.entityIds.includes(session.entity.id)) ||
      (change.type === "entity-set-replaced" && (change.removedIds.includes(session.entity.id) || change.addedIds.includes(session.entity.id)));
    if (change.type === "document-replaced" || !document.entities.has(session.entity.id)
      || (change.type === "selection-changed" && !document.selection.has(session.entity.id))) finish(false);
    else if (entityChanged) {
      const updated = document.entities.get(session.entity.id);
      if (updated?.type !== "polyline") return finish(false);
      session.entity = updated;
      session.points = updated.points.map(clonePoint);
      session.segments = clonePolylineSegments(updated);
      session.nodeTypes = updated.points.map((_, index) => updated.nodeTypes?.[index] ?? "corner");
      publish();
    }
  }), [begin, finish, publish]);

  useEffect(() => useVectorStore.subscribe((state, previous) => {
    const selection = state.nodeEditSelection;
    if (!selection || selection.nodeType === previous.nodeEditSelection?.nodeType) return;
    const session = sessionRef.current;
    if (!session || selection.entityId !== session.entity.id || selection.vertexIndex !== session.selectedVertex) return;
    const before = session.entity;
    applyBezierNodeType(
      session.points,
      session.entity.closed,
      session.segments,
      session.nodeTypes,
      selection.vertexIndex,
      selection.nodeType,
    );
    commitImmediate(session, before, "Set node type");
  }), [commitImmediate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const focused = document.activeElement;
      if (
        focused?.tagName === "INPUT" || focused?.tagName === "TEXTAREA" ||
        focused?.tagName === "SELECT" ||
        (focused instanceof HTMLElement && focused.isContentEditable)
      ) return;
      const session = sessionRef.current;
      if (!session) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation(); finish(false); return;
      }
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      // While the node tool owns the path, Delete must never leak through to
      // the workspace-level entity deletion shortcut.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (session.selectedVertex === null) return;
      const minimum = session.entity.closed ? 3 : 2;
      if (session.points.length <= minimum) return;
      const before = session.entity;
      removeVertex(session, session.selectedVertex);
      session.selectedVertex = Math.min(session.selectedVertex, session.points.length - 1);
      session.selectedHandle = null;
      commitImmediate(session, before, "Delete node");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commitImmediate, finish]);

  const onDoubleClick = useCallback((event: ReactMouseEvent<HTMLCanvasElement>): boolean => {
    const currentTool = useVectorStore.getState().activeTool;
    if (currentTool !== "select" && currentTool !== "node-edit") return false;
    const world = screenToWorld(event.clientX, event.clientY);
    const tolerance = SEGMENT_HIT_RADIUS_PX / useVectorStore.getState().viewport.zoom;
    const session = sessionRef.current;
    if (session) {
      if (nearestVertex(world, session.points, tolerance) !== null) return true;
      const projection = nearestPolylineSegment(world, session.points, session.entity.closed, session.segments, tolerance / 2);
      if (!projection || projection.distance > tolerance) return true;
      const before = session.entity;
      session.selectedVertex = splitSegment(session, projection.segmentIndex, projection.amount);
      session.selectedHandle = null;
      commitImmediate(session, before, "Insert node");
      event.preventDefault();
      return true;
    }
    const candidates = documentModel.queryVisibleEntities({
      minX: world.x - tolerance, minY: world.y - tolerance, maxX: world.x + tolerance, maxY: world.y + tolerance,
    }, candidatesRef.current);
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const entity = candidates[index];
      const layer = entity ? documentModel.getLayer(entity.layerId) : undefined;
      if (entity && supportsNodeEditing(entity) && !entity.locked && !layer?.locked && pointHitsEntity(world, entity, tolerance)) {
        begin(entity); event.preventDefault(); return true;
      }
    }
    return false;
  }, [begin, commitImmediate, screenToWorld]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLCanvasElement>): boolean => {
    let session = sessionRef.current;
    if (!session) {
      if (event.button !== 0 || useVectorStore.getState().activeTool !== "node-edit") return false;
      const world = screenToWorld(event.clientX, event.clientY);
      const tolerance = SEGMENT_HIT_RADIUS_PX / useVectorStore.getState().viewport.zoom;
      const candidates = documentModel.queryVisibleEntities({
        minX: world.x - tolerance,
        minY: world.y - tolerance,
        maxX: world.x + tolerance,
        maxY: world.y + tolerance,
      }, candidatesRef.current);
      for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const entity = candidates[index];
        const layer = entity ? documentModel.getLayer(entity.layerId) : undefined;
        if (!entity || !supportsNodeEditing(entity) || entity.locked || layer?.locked || !pointHitsEntity(world, entity, tolerance)) continue;
        if (!begin(entity)) continue;
        session = sessionRef.current;
        if (session) session.selectedVertex = nearestVertex(world, session.points, NODE_HIT_RADIUS_PX / useVectorStore.getState().viewport.zoom);
        publish();
        event.preventDefault();
        return true;
      }
      documentModel.clearSelection();
      publish();
      event.preventDefault();
      return true;
    }
    if (event.button !== 0) return false;
    const world = screenToWorld(event.clientX, event.clientY);
    const zoom = useVectorStore.getState().viewport.zoom;
    const handle = nearestHandle(
      world,
      listHandles(session.points, session.entity.closed, session.segments, session.selectedVertex),
      HANDLE_HIT_RADIUS_PX / zoom,
    );
    const vertex = handle ? null : nearestVertex(world, session.points, NODE_HIT_RADIUS_PX / zoom);
    if (handle || vertex !== null) {
      session.selectedHandle = handle;
      session.selectedVertex = handle?.anchorIndex ?? vertex;
      session.pointerId = event.pointerId;
      session.dragBefore = session.entity;
      session.dragChanged = false;
      event.currentTarget.setPointerCapture(event.pointerId);
      publish(); event.preventDefault(); return true;
    }
    const segment = nearestPolylineSegment(world, session.points, session.entity.closed, session.segments, SEGMENT_HIT_RADIUS_PX / (zoom * 2));
    if (segment && segment.distance <= SEGMENT_HIT_RADIUS_PX / zoom) {
      session.selectedVertex = null; session.selectedHandle = null; publish(); event.preventDefault(); return true;
    }
    finish(false);
    if (useVectorStore.getState().activeTool === "node-edit") documentModel.clearSelection();
    event.preventDefault();
    return true;
  }, [begin, finish, publish, screenToWorld]);

  const moveOpposingHandle = (session: NodeEditSession, moved: NodeEditHandle, point: Point2D) => {
    const anchor = session.points[moved.anchorIndex];
    const nodeType = session.nodeTypes[moved.anchorIndex] ?? "corner";
    if (!anchor || nodeType === "corner") return;
    const outgoing = moved.control === "cp1";
    const oppositeIndex = outgoing ? moved.segmentIndex - 1 : moved.segmentIndex + 1;
    const wrappedIndex = session.entity.closed
      ? (oppositeIndex + session.segments.length) % session.segments.length
      : oppositeIndex;
    if (wrappedIndex < 0 || wrappedIndex >= session.segments.length) return;
    const opposite = session.segments[wrappedIndex];
    if (opposite?.type !== "cubic") return;
    const oppositeControl = outgoing ? "cp2" : "cp1";
    const old = opposite[oppositeControl];
    const dx = point.x - anchor.x;
    const dy = point.y - anchor.y;
    const movedLength = Math.hypot(dx, dy);
    const oppositeLength = nodeType === "symmetric" ? movedLength : Math.hypot(old.x - anchor.x, old.y - anchor.y);
    const scale = movedLength <= Number.EPSILON ? 0 : oppositeLength / movedLength;
    session.segments[wrappedIndex] = { ...opposite, [oppositeControl]: { x: anchor.x - dx * scale, y: anchor.y - dy * scale } };
  };

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLCanvasElement>): boolean => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId || session.selectedVertex === null) return false;
    let world = screenToWorld(event.clientX, event.clientY);
    const selectedHandle = session.selectedHandle;
    if (selectedHandle) {
      const anchor = session.points[selectedHandle.anchorIndex];
      if (event.shiftKey && anchor) {
        const dx = world.x - anchor.x;
        const dy = world.y - anchor.y;
        const radius = Math.hypot(dx, dy);
        const snapRadians = getAngleSnapDegrees() * Math.PI / 180;
        const angle = Math.round(Math.atan2(dy, dx) / snapRadians) * snapRadians;
        world = { x: anchor.x + Math.cos(angle) * radius, y: anchor.y + Math.sin(angle) * radius };
      }
      const segment = session.segments[selectedHandle.segmentIndex];
      if (!segment || segment.type === "line" || (selectedHandle.control === "cp2" && segment.type !== "cubic")) return true;
      session.segments[selectedHandle.segmentIndex] = { ...segment, [selectedHandle.control]: world } as PolylineSegment;
      if (event.altKey) session.nodeTypes[selectedHandle.anchorIndex] = "corner";
      else moveOpposingHandle(session, selectedHandle, world);
      session.selectedHandle = { ...selectedHandle, point: world };
    } else {
      const previous = session.points[session.selectedVertex];
      if (!previous) return true;
      const original = session.dragBefore?.points[session.selectedVertex];
      if (event.shiftKey && original) {
        const dx = world.x - original.x;
        const dy = world.y - original.y;
        world = useVectorStore.getState().preferences.drafting.gridStyle === "isometric"
          ? snapWorldPointToAngle(world, original)
          : Math.abs(dx) >= Math.abs(dy)
            ? { x: world.x, y: original.y }
            : { x: original.x, y: world.y };
      }
      const dx = world.x - previous.x;
      const dy = world.y - previous.y;
      session.points[session.selectedVertex] = world;
      const outgoing = session.segments[session.selectedVertex];
      if (outgoing && outgoing.type !== "line") {
        session.segments[session.selectedVertex] = { ...outgoing, cp1: { x: outgoing.cp1.x + dx, y: outgoing.cp1.y + dy } };
      }
      const incomingIndex = session.selectedVertex === 0
        ? (session.entity.closed ? session.segments.length - 1 : -1)
        : session.selectedVertex - 1;
      const incoming = incomingIndex >= 0 ? session.segments[incomingIndex] : undefined;
      if (incoming?.type === "cubic") {
        session.segments[incomingIndex] = { ...incoming, cp2: { x: incoming.cp2.x + dx, y: incoming.cp2.y + dy } };
      }
    }
    session.dragChanged = true;
    replaceLive(session);
    publish();
    return true;
  }, [publish, replaceLive, screenToWorld]);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLCanvasElement>): boolean => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return false;
    session.pointerId = null;
    const before = session.dragBefore;
    session.dragBefore = null;
    if (before && session.dragChanged && entitiesDiffer(before, session.entity)) {
      const after = session.entity;
      // Restore the command's before-state synchronously, then execute once.
      // RAF coalescing prevents a visual flash and lets TransformEntityCommand
      // update any dimensions attached to this path as part of the same undo.
      ownMutationRef.current = true;
      try {
        documentModel.replaceEntities([before]);
        executeCommand(new UpdateEntitiesCommand([before], [after], "Edit Bézier node"));
        session.entity = documentModel.getDocument().entities.get(before.id) as PolylineEntity;
      } finally { ownMutationRef.current = false; }
    }
    session.dragChanged = false;
    publish();
    return true;
  }, [publish]);

  const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLCanvasElement>): boolean => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return false;
    const before = session.dragBefore;
    session.pointerId = null; session.dragBefore = null; session.dragChanged = false;
    if (before) {
      ownMutationRef.current = true;
      try {
        documentModel.replaceEntities([before]);
        session.entity = before;
        session.points = before.points.map(clonePoint);
        session.segments = clonePolylineSegments(before);
        session.nodeTypes = before.points.map((_, index) => before.nodeTypes?.[index] ?? "corner");
        session.selectedHandle = null;
      } finally { ownMutationRef.current = false; }
    }
    publish();
    return true;
  }, [publish]);

  return { isActive: () => sessionRef.current !== null, onDoubleClick, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, finish };
}
