import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import { documentModel } from "../document/DocumentModel";
import { ReplaceEntitySetCommand, executeCommand } from "../document/History";
import type { Entity, Point2D, PolylineEntity } from "../document/types";
import { hitTestEntitySegment } from "../geometry/HitTest";
import { entityToEditablePolyline } from "../geometry/operations/pathConversion";
import { deleteSegment } from "../geometry/operations/segmentErase";
import { useVectorStore } from "../store/useVectorStore";

const ERASE_PICK_RADIUS_PX = 8;

export interface SegmentErasePreview {
  readonly source: Entity;
  readonly editable: PolylineEntity | null;
  readonly segmentIndex: number;
}

interface EraserRenderHost { erasePreview: SegmentErasePreview | null }

interface EraserOptions {
  readonly screenToWorld: (clientX: number, clientY: number) => Point2D;
  readonly requestRender: () => void;
  readonly renderStateRef: MutableRefObject<EraserRenderHost>;
}

export function useEraserStateMachine({ screenToWorld, requestRender, renderStateRef }: EraserOptions) {
  const candidatesRef = useRef<Entity[]>([]);

  const clearPreview = useCallback(() => {
    if (!renderStateRef.current.erasePreview) return;
    renderStateRef.current.erasePreview = null;
    requestRender();
  }, [renderStateRef, requestRender]);

  const findSegment = useCallback((point: Point2D): SegmentErasePreview | null => {
    const zoom = useVectorStore.getState().viewport.zoom;
    const tolerance = ERASE_PICK_RADIUS_PX / zoom;
    const candidates = documentModel.queryVisibleEntities({
      minX: point.x - tolerance,
      minY: point.y - tolerance,
      maxX: point.x + tolerance,
      maxY: point.y + tolerance,
    }, candidatesRef.current);
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const entity = candidates[index];
      if (!entity || entity.locked || documentModel.getLayer(entity.layerId)?.locked) continue;
      const hit = hitTestEntitySegment(point, entity, tolerance);
      if (!hit) continue;
      return {
        source: entity,
        editable: entity.type === "line" || entity.type === "arc" ? null : entityToEditablePolyline(entity),
        segmentIndex: hit.segmentIndex,
      };
    }
    return null;
  }, []);

  useEffect(() => useVectorStore.subscribe((state, previous) => {
    if (
      (state.activeTool !== previous.activeTool && state.activeTool !== "erase") ||
      (!previous.temporaryPanActive && state.temporaryPanActive)
    ) clearPreview();
  }), [clearPreview]);

  useEffect(() => documentModel.subscribe((document) => {
    const preview = renderStateRef.current.erasePreview;
    if (preview && document.entities.get(preview.source.id) !== preview.source) clearPreview();
  }), [clearPreview, renderStateRef]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLCanvasElement>): boolean => {
    if (useVectorStore.getState().activeTool !== "erase") return false;
    const next = findSegment(screenToWorld(event.clientX, event.clientY));
    const previous = renderStateRef.current.erasePreview;
    if (
      previous?.source === next?.source &&
      previous?.segmentIndex === next?.segmentIndex
    ) return true;
    renderStateRef.current.erasePreview = next;
    requestRender();
    return true;
  }, [findSegment, renderStateRef, requestRender, screenToWorld]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLCanvasElement>): boolean => {
    if (event.button !== 0 || useVectorStore.getState().activeTool !== "erase") return false;
    const hit = findSegment(screenToWorld(event.clientX, event.clientY));
    if (hit) {
      const replacements = deleteSegment(hit.source, hit.segmentIndex);
      executeCommand(new ReplaceEntitySetCommand([hit.source], replacements, "Erase segment"));
      renderStateRef.current.erasePreview = null;
      requestRender();
    }
    event.preventDefault();
    return true;
  }, [findSegment, renderStateRef, requestRender, screenToWorld]);

  const onPointerUp = useCallback((_event: ReactPointerEvent<HTMLCanvasElement>): boolean =>
    useVectorStore.getState().activeTool === "erase", []);
  const onPointerCancel = onPointerUp;

  return { onPointerMove, onPointerDown, onPointerUp, onPointerCancel, onPointerLeave: clearPreview };
}
