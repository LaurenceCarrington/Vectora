import { calculateEntityBounds } from "../../document/DocumentModel";
import type { Entity, Point2D } from "../../document/types";

export type FlipAxis = "horizontal" | "vertical";

/** Reflects a complete selection around the centre of its combined bounds. */
export function flipSelection(entities: readonly Entity[], axis: FlipAxis): Entity[] {
  if (entities.length === 0) throw new Error("Select at least one object to flip.");
  const bounds = entities.reduce((result, entity) => ({
    minX: Math.min(result.minX, entity.bbox.minX), minY: Math.min(result.minY, entity.bbox.minY),
    maxX: Math.max(result.maxX, entity.bbox.maxX), maxY: Math.max(result.maxY, entity.bbox.maxY),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  if (!Object.values(bounds).every(Number.isFinite)) throw new Error("The selection has invalid bounds and cannot be flipped.");
  const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  const point = (value: Point2D): Point2D => axis === "horizontal"
    ? { ...value, x: 2 * center.x - value.x }
    : { ...value, y: 2 * center.y - value.y };
  const angle = (value: number): number => axis === "horizontal" ? Math.PI - value : -value;
  const finish = (entity: Entity, updates: Partial<Entity>): Entity => {
    const next = { ...entity, ...updates } as Entity;
    return { ...next, bbox: calculateEntityBounds(next) } as Entity;
  };

  return entities.map((entity) => {
    switch (entity.type) {
      case "line": return finish(entity, { start: point(entity.start), end: point(entity.end) });
      case "polyline": return finish(entity, {
        points: entity.points.map(point),
        ...(entity.segments ? { segments: entity.segments.map((segment) => segment.type === "line" ? segment
          : segment.type === "quadratic" ? { ...segment, cp1: point(segment.cp1) }
            : { ...segment, cp1: point(segment.cp1), cp2: point(segment.cp2) }) } : {}),
      });
      case "image": return finish(entity, { origin: point(entity.origin), right: point(entity.right), top: point(entity.top) });
      case "rectangle": {
        const reflected = point(entity.origin);
        return finish(entity, { origin: {
          x: axis === "horizontal" ? reflected.x - entity.width : entity.origin.x,
          y: axis === "vertical" ? reflected.y - entity.height : entity.origin.y,
        } });
      }
      case "circle": return finish(entity, { center: point(entity.center) });
      case "arc": return finish(entity, {
        center: point(entity.center), startAngle: angle(entity.startAngle), endAngle: angle(entity.endAngle),
        counterClockwise: !entity.counterClockwise,
      });
      case "ellipse": return finish(entity, { cx: point({ x: entity.cx, y: entity.cy }).x, cy: point({ x: entity.cx, y: entity.cy }).y, rotation: angle(entity.rotation) });
      case "polygon": return finish(entity, { cx: point({ x: entity.cx, y: entity.cy }).x, cy: point({ x: entity.cx, y: entity.cy }).y, rotation: angle(entity.rotation) });
      case "quadrant": {
        const reflectedIndex = axis === "horizontal"
          ? [2, 1, 4, 3][entity.quadrantIndex - 1]!
          : [4, 3, 2, 1][entity.quadrantIndex - 1]!;
        const centerPoint = point({ x: entity.cx, y: entity.cy });
        return finish(entity, { cx: centerPoint.x, cy: centerPoint.y, quadrantIndex: reflectedIndex as 1 | 2 | 3 | 4 });
      }
      case "semicircle": {
        const centerPoint = point({ x: entity.cx, y: entity.cy });
        return finish(entity, { cx: centerPoint.x, cy: centerPoint.y, startAngle: angle(entity.startAngle + Math.PI) });
      }
      case "segment": {
        const centerPoint = point({ x: entity.cx, y: entity.cy });
        return finish(entity, { cx: centerPoint.x, cy: centerPoint.y, startAngle: angle(entity.endAngle), endAngle: angle(entity.startAngle) });
      }
      case "star": {
        const centerPoint = point({ x: entity.cx, y: entity.cy });
        return finish(entity, { cx: centerPoint.x, cy: centerPoint.y, rotation: angle(entity.rotation) });
      }
      case "cloud": return finish(entity, { points: entity.points.map(point) });
      case "text": {
        const anchor = point({ x: entity.x, y: entity.y });
        return finish(entity, {
          x: anchor.x, y: anchor.y,
          flipHorizontal: axis === "horizontal" ? !entity.flipHorizontal : Boolean(entity.flipHorizontal),
          flipVertical: axis === "vertical" ? !entity.flipVertical : Boolean(entity.flipVertical),
        });
      }
      case "dimension": return finish(entity, {
        startPoint: point(entity.startPoint), endPoint: point(entity.endPoint), textPosition: point(entity.textPosition),
      });
      case "leader": return finish(entity, {
        arrowPoint: point(entity.arrowPoint), elbowPoint: point(entity.elbowPoint), textPosition: point(entity.textPosition),
      });
    }
  });
}
