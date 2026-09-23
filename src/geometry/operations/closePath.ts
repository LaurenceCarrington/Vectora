import type { PolylineEntity } from "../../document/types";
import { calculatePolylineBounds, clonePolylineSegments } from "../bezier";

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
