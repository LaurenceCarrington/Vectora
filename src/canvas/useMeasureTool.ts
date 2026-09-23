import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import type { Point2D } from "../document/types";
import { resolveDraftingSnap, type SnapResult } from "../geometry/Snapping";
import { useVectorStore } from "../store/useVectorStore";

const DRAG_THRESHOLD_PX = 3;

export interface MeasureRenderState {
  readonly start: Point2D;
  readonly end: Point2D;
  readonly completed: boolean;
}

export interface MeasurementResult {
  readonly distance: number;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly angleDegrees: number;
}

export function calculateMeasurement(start: Point2D, end: Point2D): MeasurementResult {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  return {
    distance: Math.hypot(deltaX, deltaY),
    deltaX,
    deltaY,
    angleDegrees: Math.atan2(deltaY, deltaX) * 180 / Math.PI,
  };
}

interface MutableMeasureRenderTarget {
  measure: MeasureRenderState | null;
  activeSnap: SnapResult | null;
}

interface MeasureToolOptions {
  readonly screenToWorld: (clientX: number, clientY: number) => Point2D;
  readonly requestRender: () => void;
  readonly renderStateRef: MutableRefObject<MutableMeasureRenderTarget>;
}

interface MeasureOperation {
  start: Point2D;
  end: Point2D;
  startScreen: Point2D;
  pointerId: number | null;
  awaitingSecondClick: boolean;
  completed: boolean;
}

function resolveMeasurePoint(screenToWorld: MeasureToolOptions["screenToWorld"], clientX: number, clientY: number) {
  const point = screenToWorld(clientX, clientY);
  const state = useVectorStore.getState();
  return resolveDraftingSnap({ cursor: point, zoom: state.viewport.zoom });
}

export function useMeasureTool({ screenToWorld, requestRender, renderStateRef }: MeasureToolOptions) {
  const operationRef = useRef<MeasureOperation | null>(null);
  const activeTool = useVectorStore((state) => state.activeTool);

  const publish = useCallback(() => {
    const operation = operationRef.current;
    renderStateRef.current.measure = operation
      ? { start: operation.start, end: operation.end, completed: operation.completed }
      : null;
    requestRender();
  }, [renderStateRef, requestRender]);

  const clear = useCallback(() => {
    operationRef.current = null;
    renderStateRef.current.measure = null;
    renderStateRef.current.activeSnap = null;
    requestRender();
  }, [renderStateRef, requestRender]);

  useEffect(() => {
    if (activeTool !== "measure" && operationRef.current) clear();
  }, [activeTool, clear]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && operationRef.current) {
        event.preventDefault();
        clear();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clear]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || useVectorStore.getState().activeTool !== "measure") return false;
    const resolved = resolveMeasurePoint(screenToWorld, event.clientX, event.clientY);
    renderStateRef.current.activeSnap = resolved.snap;
    const current = operationRef.current;
    if (current?.awaitingSecondClick) {
      current.end = resolved.point;
      current.awaitingSecondClick = false;
      current.completed = true;
      current.pointerId = null;
      publish();
      event.preventDefault();
      return true;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    operationRef.current = {
      start: resolved.point,
      end: resolved.point,
      startScreen: { x: event.clientX, y: event.clientY },
      pointerId: event.pointerId,
      awaitingSecondClick: false,
      completed: false,
    };
    publish();
    event.preventDefault();
    return true;
  }, [publish, renderStateRef, screenToWorld]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (useVectorStore.getState().activeTool !== "measure") return false;
    const current = operationRef.current;
    if (!current || current.completed) return Boolean(current);
    if (current.pointerId !== null && current.pointerId !== event.pointerId) return false;
    const resolved = resolveMeasurePoint(screenToWorld, event.clientX, event.clientY);
    current.end = resolved.point;
    renderStateRef.current.activeSnap = resolved.snap;
    publish();
    return true;
  }, [publish, renderStateRef, screenToWorld]);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const current = operationRef.current;
    if (!current || current.pointerId !== event.pointerId) return false;
    const resolved = resolveMeasurePoint(screenToWorld, event.clientX, event.clientY);
    current.end = resolved.point;
    current.pointerId = null;
    const dragged = Math.hypot(
      event.clientX - current.startScreen.x,
      event.clientY - current.startScreen.y,
    ) >= DRAG_THRESHOLD_PX;
    current.awaitingSecondClick = !dragged;
    current.completed = dragged;
    renderStateRef.current.activeSnap = resolved.snap;
    publish();
    return true;
  }, [publish, renderStateRef, screenToWorld]);

  const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (operationRef.current?.pointerId !== event.pointerId) return false;
    clear();
    return true;
  }, [clear]);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, clear };
}
