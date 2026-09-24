import type { BoundingBox, Entity, Point2D } from "../document/types";
import { calculateEntityBounds } from "../document/DocumentModel";
import { entityToPath } from "../geometry/operations/pathConversion";
import { calculateDimensionValue } from "../geometry/annotations";
import type { Viewport } from "../store/useVectorStore";
import { transformPolylineSegments } from "../geometry/bezier";
import { vectoraRenderColors } from "../design/vectoraRenderColors";

export type ScaleHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export type TransformHandle = ScaleHandle | "rotate";

const HANDLE_SIZE = 8;
const HANDLE_HIT_SIZE = 12;
const ROTATION_HANDLE_SIZE = 10;
const ROTATION_STEM_PX = 30;
const MIN_SCALE = 0.01;

export function getSelectionBounds(entities: readonly Entity[]): BoundingBox | null {
  if (entities.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const entity of entities) {
    minX = Math.min(minX, entity.bbox.minX);
    minY = Math.min(minY, entity.bbox.minY);
    maxX = Math.max(maxX, entity.bbox.maxX);
    maxY = Math.max(maxY, entity.bbox.maxY);
  }
  return { minX, minY, maxX, maxY };
}

function getHandlePoints(bounds: BoundingBox): Readonly<Record<ScaleHandle, Point2D>> {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return {
    nw: { x: bounds.minX, y: bounds.maxY },
    n: { x: centerX, y: bounds.maxY },
    ne: { x: bounds.maxX, y: bounds.maxY },
    e: { x: bounds.maxX, y: centerY },
    se: { x: bounds.maxX, y: bounds.minY },
    s: { x: centerX, y: bounds.minY },
    sw: { x: bounds.minX, y: bounds.minY },
    w: { x: bounds.minX, y: centerY },
  };
}

export function getScaleHandlePoint(bounds: BoundingBox, handle: ScaleHandle): Point2D {
  return getHandlePoints(bounds)[handle];
}

export function getRotationHandlePoint(bounds: BoundingBox, zoom: number): Point2D {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: bounds.maxY + ROTATION_STEM_PX / Math.max(zoom, Number.EPSILON),
  };
}

function worldToScreen(
  point: Point2D,
  width: number,
  height: number,
  viewport: Viewport,
): Point2D {
  return {
    x: width / 2 + viewport.x + point.x * viewport.zoom,
    y: height / 2 + viewport.y - point.y * viewport.zoom,
  };
}

export function drawTransformOverlay(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewport: Viewport,
  bounds: BoundingBox,
): void {
  const topLeft = worldToScreen({ x: bounds.minX, y: bounds.maxY }, width, height, viewport);
  const bottomRight = worldToScreen({ x: bounds.maxX, y: bounds.minY }, width, height, viewport);

  context.save();
  context.strokeStyle = vectoraRenderColors.ui.selection;
  context.lineWidth = 1;
  context.setLineDash([5, 4]);
  context.strokeRect(
    Math.round(topLeft.x) + 0.5,
    Math.round(topLeft.y) + 0.5,
    Math.round(bottomRight.x - topLeft.x),
    Math.round(bottomRight.y - topLeft.y),
  );

  context.setLineDash([]);
  context.fillStyle = vectoraRenderColors.ui.surface;
  for (const point of Object.values(getHandlePoints(bounds))) {
    const screen = worldToScreen(point, width, height, viewport);
    context.beginPath();
    context.rect(
      Math.round(screen.x - HANDLE_SIZE / 2) + 0.5,
      Math.round(screen.y - HANDLE_SIZE / 2) + 0.5,
      HANDLE_SIZE,
      HANDLE_SIZE,
    );
    context.fill();
    context.stroke();
  }

  const topCenter = worldToScreen({ x: (bounds.minX + bounds.maxX) / 2, y: bounds.maxY }, width, height, viewport);
  const rotationPoint = worldToScreen(getRotationHandlePoint(bounds, viewport.zoom), width, height, viewport);
  context.beginPath();
  context.moveTo(Math.round(topCenter.x) + 0.5, Math.round(topCenter.y) + 0.5);
  context.lineTo(Math.round(rotationPoint.x) + 0.5, Math.round(rotationPoint.y) + 0.5);
  context.stroke();
  context.beginPath();
  context.arc(
    Math.round(rotationPoint.x) + 0.5,
    Math.round(rotationPoint.y) + 0.5,
    ROTATION_HANDLE_SIZE / 2,
    0,
    Math.PI * 2,
  );
  context.fill();
  context.stroke();
  context.restore();
}

export function hitTestTransformHandle(
  point: Point2D,
  bounds: BoundingBox,
  zoom: number,
  touchRadiusPx?: number,
): TransformHandle | null {
  if (touchRadiusPx !== undefined) {
    const handles = getHandlePoints(bounds);
    const candidates: readonly [TransformHandle, Point2D][] = [
      ["rotate", getRotationHandlePoint(bounds, zoom)],
      ...Object.entries(handles) as [ScaleHandle, Point2D][],
    ];
    let nearest: TransformHandle | null = null;
    let distance = touchRadiusPx / zoom;
    for (const [handle, candidate] of candidates) {
      const next = Math.hypot(point.x - candidate.x, point.y - candidate.y);
      if (next < distance) { nearest = handle; distance = next; }
    }
    return nearest;
  }
  const tolerance = HANDLE_HIT_SIZE / (2 * zoom);
  const rotationPoint = getRotationHandlePoint(bounds, zoom);
  if (Math.hypot(point.x - rotationPoint.x, point.y - rotationPoint.y) <= tolerance) {
    return "rotate";
  }
  const handles = getHandlePoints(bounds);
  const order: readonly ScaleHandle[] = ["nw", "ne", "se", "sw", "n", "e", "s", "w"];
  for (const handle of order) {
    const candidate = handles[handle];
    if (
      Math.abs(point.x - candidate.x) <= tolerance &&
      Math.abs(point.y - candidate.y) <= tolerance
    ) return handle;
  }
  return null;
}

export function pointInsideSelection(point: Point2D, bounds: BoundingBox): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

export function translateEntities(
  entities: readonly Entity[],
  delta: Point2D,
): readonly Entity[] {
  return entities.map((entity) => mapEntityPoints(entity, (point) => ({
    x: point.x + delta.x,
    y: point.y + delta.y,
  })));
}

export function scaleEntities(
  entities: readonly Entity[],
  originalBounds: BoundingBox,
  handle: ScaleHandle,
  pointer: Point2D,
  preserveAspectRatio = false,
): readonly Entity[] {
  const width = Math.max(originalBounds.maxX - originalBounds.minX, Number.EPSILON);
  const height = Math.max(originalBounds.maxY - originalBounds.minY, Number.EPSILON);
  let anchorX = originalBounds.minX;
  let anchorY = originalBounds.minY;
  let scaleX = 1;
  let scaleY = 1;

  if (handle.includes("e")) {
    anchorX = originalBounds.minX;
    scaleX = Math.max(MIN_SCALE, (pointer.x - anchorX) / width);
  } else if (handle.includes("w")) {
    anchorX = originalBounds.maxX;
    scaleX = Math.max(MIN_SCALE, (anchorX - pointer.x) / width);
  }

  if (handle.includes("n")) {
    anchorY = originalBounds.minY;
    scaleY = Math.max(MIN_SCALE, (pointer.y - anchorY) / height);
  } else if (handle.includes("s")) {
    anchorY = originalBounds.maxY;
    scaleY = Math.max(MIN_SCALE, (anchorY - pointer.y) / height);
  }

  if (preserveAspectRatio && handle.length === 2) {
    // Follow the axis that has moved furthest from the original size. This keeps
    // the dragged corner responsive while constraining the result to one scale.
    const uniformScale = Math.max(
      MIN_SCALE,
      Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY,
    );
    scaleX = uniformScale;
    scaleY = uniformScale;
  }

  const transformPoint = (point: Point2D): Point2D => ({
    x: anchorX + (point.x - anchorX) * scaleX,
    y: anchorY + (point.y - anchorY) * scaleY,
  });
  return entities.map((entity) => mapEntityPoints(entity, transformPoint, scaleX, scaleY, handle));
}

export function rotateEntities(
  entities: readonly Entity[],
  center: Point2D,
  angle: number,
): readonly Entity[] {
  if (Math.abs(angle) < Number.EPSILON) return entities;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const rotatePoint = (point: Point2D): Point2D => {
    const x = point.x - center.x;
    const y = point.y - center.y;
    return {
      x: center.x + x * cosine - y * sine,
      y: center.y + x * sine + y * cosine,
    };
  };
  return entities.map((entity) => rotateEntity(entity, rotatePoint, angle));
}

function rotateEntity(
  entity: Entity,
  rotatePoint: (point: Point2D) => Point2D,
  angle: number,
): Entity {
  let transformed: Entity;
  switch (entity.type) {
    case "image":
      transformed = { ...entity, origin: rotatePoint(entity.origin), right: rotatePoint(entity.right), top: rotatePoint(entity.top) };
      break;
    case "line":
      transformed = { ...entity, start: rotatePoint(entity.start), end: rotatePoint(entity.end) };
      break;
    case "polyline":
      transformed = {
        ...entity,
        points: entity.points.map(rotatePoint),
        ...(entity.segments ? { segments: transformPolylineSegments(entity.segments, rotatePoint)! } : {}),
      };
      break;
    case "rectangle":
    case "quadrant": {
      const path = entityToPath(entity, { tolerance: 0.05, minimumSegments: 16, maximumSegments: 256 });
      if (!path) return entity;
      transformed = {
        id: entity.id,
        type: "polyline",
        layerId: entity.layerId,
        intent: entity.intent,
        style: entity.style,
        bbox: entity.bbox,
        visible: entity.visible,
        locked: entity.locked,
        points: path.points.map(rotatePoint),
        closed: path.closed,
      };
      break;
    }
    case "circle":
      transformed = { ...entity, center: rotatePoint(entity.center) };
      break;
    case "arc":
      transformed = {
        ...entity,
        center: rotatePoint(entity.center),
        startAngle: entity.startAngle + angle,
        endAngle: entity.endAngle + angle,
      };
      break;
    case "ellipse": {
      const center = rotatePoint({ x: entity.cx, y: entity.cy });
      transformed = { ...entity, cx: center.x, cy: center.y, rotation: entity.rotation + angle };
      break;
    }
    case "polygon":
    case "star": {
      const center = rotatePoint({ x: entity.cx, y: entity.cy });
      transformed = { ...entity, cx: center.x, cy: center.y, rotation: entity.rotation + angle };
      break;
    }
    case "semicircle": {
      const center = rotatePoint({ x: entity.cx, y: entity.cy });
      transformed = { ...entity, cx: center.x, cy: center.y, startAngle: entity.startAngle + angle };
      break;
    }
    case "segment": {
      const center = rotatePoint({ x: entity.cx, y: entity.cy });
      transformed = {
        ...entity,
        cx: center.x,
        cy: center.y,
        startAngle: entity.startAngle + angle,
        endAngle: entity.endAngle + angle,
      };
      break;
    }
    case "cloud":
      transformed = { ...entity, points: entity.points.map(rotatePoint) };
      break;
    case "text": {
      const origin = rotatePoint({ x: entity.x, y: entity.y });
      transformed = { ...entity, x: origin.x, y: origin.y };
      break;
    }
    case "dimension": {
      const startPoint = rotatePoint(entity.startPoint);
      const endPoint = rotatePoint(entity.endPoint);
      const textPosition = rotatePoint(entity.textPosition);
      transformed = {
        ...entity,
        startPoint,
        endPoint,
        textPosition,
        value: calculateDimensionValue(entity.dimensionKind, startPoint, endPoint, textPosition),
      };
      break;
    }
    case "leader":
      transformed = {
        ...entity,
        arrowPoint: rotatePoint(entity.arrowPoint),
        elbowPoint: rotatePoint(entity.elbowPoint),
        textPosition: rotatePoint(entity.textPosition),
      };
      break;
  }
  return { ...transformed, bbox: calculateEntityBounds(transformed) };
}

function mapEntityPoints(
  entity: Entity,
  transformPoint: (point: Point2D) => Point2D,
  scaleX = 1,
  scaleY = 1,
  handle?: ScaleHandle,
): Entity {
  let transformed: Entity;
  switch (entity.type) {
    case "image":
      transformed = { ...entity, origin: transformPoint(entity.origin), right: transformPoint(entity.right), top: transformPoint(entity.top) };
      break;
    case "line":
      transformed = { ...entity, start: transformPoint(entity.start), end: transformPoint(entity.end) };
      break;
    case "polyline":
      transformed = {
        ...entity,
        points: entity.points.map(transformPoint),
        ...(entity.segments ? { segments: transformPolylineSegments(entity.segments, transformPoint)! } : {}),
      };
      break;
    case "rectangle":
      transformed = {
        ...entity,
        origin: transformPoint(entity.origin),
        width: entity.width * scaleX,
        height: entity.height * scaleY,
        cornerRadius: entity.cornerRadius * Math.min(Math.abs(scaleX), Math.abs(scaleY)),
      };
      break;
    case "circle": {
      const uniformScale = getUniformScale(scaleX, scaleY, handle);
      transformed = {
        ...entity,
        center: transformPoint(entity.center),
        radius: entity.radius * uniformScale,
      };
      break;
    }
    case "arc": {
      const uniformScale = getUniformScale(scaleX, scaleY, handle);
      transformed = {
        ...entity,
        center: transformPoint(entity.center),
        radius: entity.radius * uniformScale,
      };
      break;
    }
    case "ellipse":
      transformed = {
        ...entity,
        ...pointToCenter(transformPoint({ x: entity.cx, y: entity.cy })),
        rx: entity.rx * Math.abs(scaleX),
        ry: entity.ry * Math.abs(scaleY),
      };
      break;
    case "polygon":
    case "quadrant":
    case "semicircle":
    case "segment": {
      const center = transformPoint({ x: entity.cx, y: entity.cy });
      transformed = {
        ...entity,
        cx: center.x,
        cy: center.y,
        radius: entity.radius * getUniformScale(scaleX, scaleY, handle),
      };
      break;
    }
    case "star": {
      const center = transformPoint({ x: entity.cx, y: entity.cy });
      const uniformScale = getUniformScale(scaleX, scaleY, handle);
      transformed = {
        ...entity,
        cx: center.x,
        cy: center.y,
        innerRadius: entity.innerRadius * uniformScale,
        outerRadius: entity.outerRadius * uniformScale,
      };
      break;
    }
    case "cloud":
      transformed = {
        ...entity,
        points: entity.points.map(transformPoint),
        arcRadius: entity.arcRadius * getUniformScale(scaleX, scaleY, handle),
      };
      break;
    case "text": {
      const origin = transformPoint({ x: entity.x, y: entity.y });
      transformed = {
        ...entity,
        x: origin.x,
        y: origin.y,
        fontSize: entity.fontSize * getUniformScale(scaleX, scaleY, handle),
      };
      break;
    }
    case "dimension": {
      const startPoint = transformPoint(entity.startPoint);
      const endPoint = transformPoint(entity.endPoint);
      const textPosition = transformPoint(entity.textPosition);
      transformed = {
        ...entity,
        startPoint,
        endPoint,
        textPosition,
        value: calculateDimensionValue(entity.dimensionKind, startPoint, endPoint, textPosition),
        arrowSize: entity.arrowSize * getUniformScale(scaleX, scaleY, handle),
      };
      break;
    }
    case "leader":
      transformed = {
        ...entity,
        arrowPoint: transformPoint(entity.arrowPoint),
        elbowPoint: transformPoint(entity.elbowPoint),
        textPosition: transformPoint(entity.textPosition),
      };
      break;
  }
  return { ...transformed, bbox: calculateEntityBounds(transformed) };
}

function pointToCenter(point: Point2D): { readonly cx: number; readonly cy: number } {
  return { cx: point.x, cy: point.y };
}

function getUniformScale(scaleX: number, scaleY: number, handle?: ScaleHandle): number {
  if (handle === "e" || handle === "w") return Math.abs(scaleX);
  if (handle === "n" || handle === "s") return Math.abs(scaleY);
  return Math.min(Math.abs(scaleX), Math.abs(scaleY));
}
