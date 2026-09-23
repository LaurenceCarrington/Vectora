import type { BezierNodeType, Entity, Point2D, PolylineEntity, PolylineSegment } from "../../document/types";
import { calculatePolylineBounds, getPolylineSegment, polylineSegmentCount } from "../bezier";
import { entityToEditablePolyline } from "./pathConversion";

let fragmentSequence = 0;

function nextFragmentId(): string {
  fragmentSequence += 1;
  return globalThis.crypto?.randomUUID?.() ?? `segment-${Date.now().toString(36)}-${fragmentSequence}`;
}

function clonePoint(point: Point2D): Point2D {
  return { x: point.x, y: point.y };
}

function cloneSegment(segment: PolylineSegment): PolylineSegment {
  if (segment.type === "line") return { type: "line" };
  if (segment.type === "quadratic") return { type: "quadratic", cp1: clonePoint(segment.cp1) };
  return { type: "cubic", cp1: clonePoint(segment.cp1), cp2: clonePoint(segment.cp2) };
}

function fragment(
  source: PolylineEntity,
  id: string,
  points: readonly Point2D[],
  segments: readonly PolylineSegment[],
  nodeTypes: readonly BezierNodeType[],
  name: string | undefined,
): PolylineEntity {
  const candidate: PolylineEntity = {
    id,
    ...(name ? { name } : {}),
    type: "polyline",
    layerId: source.layerId,
    intent: source.intent,
    // Canvas fills implicitly close open paths, so a fractured path must not
    // retain its old fill or the erased edge would appear to remain present.
    style: { ...source.style, fillColor: null, dashArray: [...source.style.dashArray] },
    bbox: source.bbox,
    visible: source.visible,
    locked: false,
    points: points.map(clonePoint),
    segments: segments.map(cloneSegment),
    nodeTypes: [...nodeTypes],
    closed: false,
  };
  return { ...candidate, bbox: calculatePolylineBounds(candidate) };
}

/**
 * Removes one topological segment. Curves are copied without flattening, so
 * control points on every retained quadratic/cubic segment remain exact.
 */
export function deleteSegment(entity: Entity, segmentIndex: number): Entity[] {
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0) return [entity];
  if (entity.type === "line" || entity.type === "arc") return segmentIndex === 0 ? [] : [entity];
  const editable = entityToEditablePolyline(entity);
  if (!editable) return [entity];
  const count = polylineSegmentCount(editable.points, editable.closed);
  if (segmentIndex >= count) return [entity];
  const segments = Array.from({ length: count }, (_, index) => getPolylineSegment(editable.segments, index));
  const nodeTypes = editable.points.map((_, index) => editable.nodeTypes?.[index] ?? "corner");

  if (editable.closed) {
    const startIndex = (segmentIndex + 1) % editable.points.length;
    const points = Array.from({ length: editable.points.length }, (_, offset) =>
      editable.points[(startIndex + offset) % editable.points.length]!,
    );
    const retainedSegments = Array.from({ length: count - 1 }, (_, offset) =>
      segments[(startIndex + offset) % count]!,
    );
    const retainedNodeTypes = Array.from({ length: editable.points.length }, (_, offset) =>
      nodeTypes[(startIndex + offset) % nodeTypes.length]!,
    );
    return [fragment(editable, entity.id, points, retainedSegments, retainedNodeTypes, entity.name)];
  }

  const leftPoints = editable.points.slice(0, segmentIndex + 1);
  const rightPoints = editable.points.slice(segmentIndex + 1);
  const parts: Array<{ points: readonly Point2D[]; segments: readonly PolylineSegment[]; nodes: readonly BezierNodeType[] }> = [];
  if (leftPoints.length >= 2) {
    parts.push({
      points: leftPoints,
      segments: segments.slice(0, segmentIndex),
      nodes: nodeTypes.slice(0, segmentIndex + 1),
    });
  }
  if (rightPoints.length >= 2) {
    parts.push({
      points: rightPoints,
      segments: segments.slice(segmentIndex + 1),
      nodes: nodeTypes.slice(segmentIndex + 1),
    });
  }
  return parts.map((part, index) => fragment(
    editable,
    index === 0 ? entity.id : nextFragmentId(),
    part.points,
    part.segments,
    part.nodes,
    parts.length > 1 && entity.name ? `${entity.name} ${index + 1}` : entity.name,
  ));
}
