import { useCallback, type PointerEvent as ReactPointerEvent } from "react";
import { documentModel } from "../document/DocumentModel";
import { UpdateEntitiesCommand, executeCommand } from "../document/History";
import type { Entity, Point2D } from "../document/types";
import { pointInClosedEntity } from "../geometry/HitTest";
import { useVectorStore } from "../store/useVectorStore";

interface FillToolOptions {
  readonly screenToWorld: (clientX: number, clientY: number) => Point2D;
  readonly requestRender: () => void;
}

/** Finds the uppermost visible, editable, closed shape containing a point. */
export function findFillTarget(point: Point2D, entities: readonly Entity[]): Entity | null {
  for (let index = entities.length - 1; index >= 0; index -= 1) {
    const entity = entities[index];
    if (!entity || !documentModel.canMutateEntity(entity)) continue;
    if (pointInClosedEntity(point, entity)) return entity;
  }
  return null;
}

export function useFillTool({ screenToWorld, requestRender }: FillToolOptions) {
  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLCanvasElement>): boolean => {
    const state = useVectorStore.getState();
    if (event.button !== 0 || state.activeTool !== "fill") return false;

    const point = screenToWorld(event.clientX, event.clientY);
    const target = findFillTarget(point, documentModel.getVisibleEntities());
    if (target && target.style.fillColor !== state.fillBucketColor) {
      executeCommand(new UpdateEntitiesCommand(
        [target],
        [{ ...target, style: { ...target.style, fillColor: state.fillBucketColor } }],
        "Fill shape",
      ));
      requestRender();
    }
    event.preventDefault();
    return true;
  }, [requestRender, screenToWorld]);

  const consumesPointer = useCallback(() => useVectorStore.getState().activeTool === "fill", []);
  return { onPointerDown, onPointerUp: consumesPointer, onPointerCancel: consumesPointer };
}
