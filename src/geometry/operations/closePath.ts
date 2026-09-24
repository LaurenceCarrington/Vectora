import type { Entity, PolylineEntity } from "../../document/types";
import { calculatePolylineBounds, clonePolylineSegments } from "../bezier";
import { joinPaths } from "./join";

/** Closes an open polyline without flattening or changing its existing Bézier segments. */
export function closePolyline(entity: PolylineEntity): PolylineEntity {
  if (entity.closed) return entity;
  if (entity.points.length < 3) {
    throw new RangeError("A polyline needs at least three vertices before it can be closed.");
  }
  const closed: PolylineEntity = {
    ...entity,
    closed: true,
    ...(entity.segments
      ? { segments: [...clonePolylineSegments(entity), { type: "line" as const }] }
      : {}),
  };
  return {
    ...closed,
    bbox: calculatePolylineBounds(closed),
  };
}

/** Joins selected open fragments before closing, so separate arcs are never
 * individually closed with a chord. Both ends of every resulting chain must meet. */
export function closeSelectedPaths(entities: readonly Entity[], tolerance = 0.1): readonly Entity[] {
  if (entities.length === 1 && entities[0]?.type === "polyline") {
    return [closePolyline(entities[0])];
  }
  if (entities.length < 2) {
    throw new RangeError("Select at least two open paths to make a closed outline.");
  }
  const joined = joinPaths(entities, tolerance);
  if (joined.length === entities.length || joined.some((entity) => entity.type !== "polyline" || !entity.closed)) {
    throw new RangeError("The selected paths do not form a closed loop. Align both endpoint pairs or adjust Join tolerance.");
  }
  return joined;
}
