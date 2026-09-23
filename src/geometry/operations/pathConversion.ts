import type { BezierNodeType, Entity, Point2D, PolylineEntity, PolylineSegment } from "../../document/types";
import { boundsFromPoints, createGeneratorId } from "../generators/common";
import { calculatePolylineBounds, clonePolylineSegments, flattenPolyline } from "../bezier";

export interface CurveFlattenOptions {
  readonly tolerance?: number;
  readonly minimumSegments?: number;
  readonly maximumSegments?: number;
}

export function curveSegments(radius: number, options: CurveFlattenOptions): number {
  const tolerance = Math.max(1e-6, options.tolerance ?? 0.02);
  const minimum = options.minimumSegments ?? 24;
  const maximum = options.maximumSegments ?? 2_048;
  if (radius <= tolerance) return minimum;
  const halfAngle = Math.acos(Math.max(-1, Math.min(1, 1 - tolerance / radius)));
  const count = halfAngle <= 1e-9 ? maximum : Math.ceil(Math.PI / halfAngle);
  return Math.max(minimum, Math.min(maximum, count));
}

function circlePoints(center: Point2D, radius: number, options: CurveFlattenOptions): readonly Point2D[] {
  const segments = curveSegments(radius, options);
  return Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };
  });
}

function ellipsePoints(entity: Extract<Entity, { type: "ellipse" }>, options: CurveFlattenOptions): readonly Point2D[] {
  const segments = curveSegments(Math.max(entity.rx, entity.ry), options);
  const cosRotation = Math.cos(entity.rotation);
  const sinRotation = Math.sin(entity.rotation);
  return Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    const localX = Math.cos(angle) * entity.rx;
    const localY = Math.sin(angle) * entity.ry;
    return {
      x: entity.cx + localX * cosRotation - localY * sinRotation,
      y: entity.cy + localX * sinRotation + localY * cosRotation,
    };
  });
}

function radialVertices(
  cx: number,
  cy: number,
  count: number,
  rotation: number,
  radiusAt: (index: number) => number,
): readonly Point2D[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = rotation + (index * Math.PI * 2) / count;
    const radius = radiusAt(index);
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });
}

function sectorPoints(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
  options: CurveFlattenOptions,
): readonly Point2D[] {
  const tau = Math.PI * 2;
  const sweep = ((endAngle - startAngle) % tau + tau) % tau || tau;
  const segments = Math.max(2, Math.ceil(curveSegments(radius, options) * sweep / tau));
  const points: Point2D[] = [{ x: cx, y: cy }];
  for (let index = 0; index <= segments; index += 1) {
    const angle = startAngle + sweep * (index / segments);
    points.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  }
  return points;
}

function cloudPoints(entity: Extract<Entity, { type: "cloud" }>): readonly Point2D[] {
  if (entity.points.length < 2) return entity.points;
  let centroidX = 0;
  let centroidY = 0;
  for (const point of entity.points) { centroidX += point.x; centroidY += point.y; }
  centroidX /= entity.points.length;
  centroidY /= entity.points.length;
  const result: Point2D[] = [];
  for (let index = 0; index < entity.points.length; index += 1) {
    const start = entity.points[index]!;
    const end = entity.points[(index + 1) % entity.points.length]!;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy) || 1;
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    let nx = -dy / length;
    let ny = dx / length;
    if (nx * (midX - centroidX) + ny * (midY - centroidY) < 0) { nx = -nx; ny = -ny; }
    const bulge = Math.min(entity.arcRadius, length / 2);
    const controlX = midX + nx * bulge;
    const controlY = midY + ny * bulge;
    const subdivisions = Math.max(4, Math.min(16, Math.ceil(length / Math.max(2, entity.arcRadius))));
    for (let step = 0; step < subdivisions; step += 1) {
      const t = step / subdivisions;
      const inverse = 1 - t;
      result.push({
        x: inverse * inverse * start.x + 2 * inverse * t * controlX + t * t * end.x,
        y: inverse * inverse * start.y + 2 * inverse * t * controlY + t * t * end.y,
      });
    }
  }
  return result;
}

function roundedRectanglePoints(
  entity: Extract<Entity, { type: "rectangle" }>,
  options: CurveFlattenOptions,
): readonly Point2D[] {
  const radius = Math.min(
    Math.max(0, entity.cornerRadius),
    Math.abs(entity.width) / 2,
    Math.abs(entity.height) / 2,
  );
  const left = entity.origin.x;
  const bottom = entity.origin.y;
  const right = left + entity.width;
  const top = bottom + entity.height;
  if (radius <= 1e-9) {
    return [
      { x: left, y: bottom },
      { x: right, y: bottom },
      { x: right, y: top },
      { x: left, y: top },
    ];
  }
  const perCorner = Math.max(3, Math.ceil(curveSegments(radius, options) / 4));
  const points: Point2D[] = [];
  for (const [center, startAngle] of [
    [{ x: right - radius, y: bottom + radius }, -Math.PI / 2],
    [{ x: right - radius, y: top - radius }, 0],
    [{ x: left + radius, y: top - radius }, Math.PI / 2],
    [{ x: left + radius, y: bottom + radius }, Math.PI],
  ] as const) {
    for (let index = 0; index <= perCorner; index += 1) {
      const angle = startAngle + (index / perCorner) * (Math.PI / 2);
      points.push({
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      });
    }
  }
  return points;
}

export function entityToClosedPath(
  entity: Entity,
  options: CurveFlattenOptions = {},
): readonly Point2D[] | null {
  switch (entity.type) {
    case "polyline":
      return entity.closed && entity.points.length >= 3 ? flattenPolyline(entity) : null;
    case "rectangle":
      return roundedRectanglePoints(entity, options);
    case "circle":
      return entity.radius > 0 ? circlePoints(entity.center, entity.radius, options) : null;
    case "ellipse":
      return entity.rx > 0 && entity.ry > 0 ? ellipsePoints(entity, options) : null;
    case "polygon":
      return radialVertices(entity.cx, entity.cy, entity.sides, entity.rotation, () => entity.radius);
    case "quadrant": {
      const start = (entity.quadrantIndex - 1) * Math.PI / 2;
      return sectorPoints(entity.cx, entity.cy, entity.radius, start, start + Math.PI / 2, options);
    }
    case "semicircle":
      return sectorPoints(entity.cx, entity.cy, entity.radius, entity.startAngle, entity.startAngle + Math.PI, options);
    case "segment":
      return sectorPoints(entity.cx, entity.cy, entity.radius, entity.startAngle, entity.endAngle, options);
    case "star":
      return radialVertices(entity.cx, entity.cy, entity.points * 2, entity.rotation, (index) => index % 2 === 0 ? entity.outerRadius : entity.innerRadius);
    case "cloud":
      return entity.points.length >= 3 ? cloudPoints(entity) : null;
    case "line":
    case "arc":
    case "image":
    case "text":
    case "dimension":
    case "leader":
      return null;
  }
}

export function entityToOpenPath(
  entity: Entity,
  options: CurveFlattenOptions = {},
): readonly Point2D[] | null {
  if (entity.type === "line") return [entity.start, entity.end];
  if (entity.type === "polyline" && !entity.closed && entity.points.length >= 2) return flattenPolyline(entity);
  if (entity.type === "arc" && entity.radius > 0) {
    const tau = Math.PI * 2;
    const normalize = (angle: number) => ((angle % tau) + tau) % tau;
    const sweep = entity.counterClockwise
      ? normalize(entity.startAngle - entity.endAngle)
      : normalize(entity.endAngle - entity.startAngle);
    const fullCircleSegments = curveSegments(entity.radius, options);
    const segments = Math.max(2, Math.ceil(fullCircleSegments * sweep / tau));
    const direction = entity.counterClockwise ? -1 : 1;
    return Array.from({ length: segments + 1 }, (_, index) => {
      const angle = entity.startAngle + direction * sweep * (index / segments);
      return {
        x: entity.center.x + Math.cos(angle) * entity.radius,
        y: entity.center.y + Math.sin(angle) * entity.radius,
      };
    });
  }
  if (entity.type === "text" || entity.type === "dimension" || entity.type === "leader") return null;
  return null;
}

export function entityToPath(
  entity: Entity,
  options: CurveFlattenOptions = {},
): { readonly points: readonly Point2D[]; readonly closed: boolean } | null {
  const closed = entityToClosedPath(entity, options);
  if (closed) return { points: closed, closed: true };
  const open = entityToOpenPath(entity, options);
  return open ? { points: open, closed: false } : null;
}

export function pathToEntity(
  points: readonly Point2D[],
  template: Entity,
  prefix: string,
  index: number,
): PolylineEntity {
  const clonedPoints = points.map((point) => ({ x: point.x, y: point.y }));
  return {
    id: createGeneratorId(prefix, index, {}),
    type: "polyline",
    layerId: template.layerId,
    intent: template.intent,
    style: { ...template.style, dashArray: [...template.style.dashArray] },
    bbox: boundsFromPoints(clonedPoints),
    visible: template.visible,
    locked: false,
    points: clonedPoints,
    closed: true,
  };
}

interface EditablePathGeometry {
  readonly points: readonly Point2D[];
  readonly segments: readonly PolylineSegment[];
  readonly nodeTypes: readonly BezierNodeType[];
  readonly closed: boolean;
}

function lineGeometry(points: readonly Point2D[], closed: boolean): EditablePathGeometry {
  const segmentCount = Math.max(0, closed ? points.length : points.length - 1);
  return {
    points: points.map((point) => ({ ...point })),
    segments: Array.from({ length: segmentCount }, () => ({ type: "line" as const })),
    nodeTypes: points.map(() => "corner" as const),
    closed,
  };
}

function arcGeometry(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
  counterClockwise: boolean,
): EditablePathGeometry | null {
  if (!(radius > 0)) return null;
  const tau = Math.PI * 2;
  const direction = counterClockwise ? -1 : 1;
  let sweep = direction * (endAngle - startAngle);
  sweep = ((sweep % tau) + tau) % tau;
  if (sweep <= 1e-10) return null;
  const signedSweep = sweep * direction;
  const count = Math.max(1, Math.ceil(sweep / (Math.PI / 2)));
  const delta = signedSweep / count;
  const points: Point2D[] = [];
  const segments: PolylineSegment[] = [];
  const nodeTypes: BezierNodeType[] = [];
  for (let index = 0; index <= count; index += 1) {
    const angle = startAngle + delta * index;
    points.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
    nodeTypes.push(index > 0 && index < count ? "smooth" : "corner");
    if (index === count) continue;
    const nextAngle = angle + delta;
    const kappa = (4 / 3) * Math.tan(delta / 4) * radius;
    segments.push({
      type: "cubic",
      cp1: { x: cx + Math.cos(angle) * radius - Math.sin(angle) * kappa, y: cy + Math.sin(angle) * radius + Math.cos(angle) * kappa },
      cp2: { x: cx + Math.cos(nextAngle) * radius + Math.sin(nextAngle) * kappa, y: cy + Math.sin(nextAngle) * radius - Math.cos(nextAngle) * kappa },
    });
  }
  return { points, segments, nodeTypes, closed: false };
}

function ellipseGeometry(entity: Extract<Entity, { type: "ellipse" }>): EditablePathGeometry | null {
  if (!(entity.rx > 0) || !(entity.ry > 0)) return null;
  const points: Point2D[] = [];
  const segments: PolylineSegment[] = [];
  const cosine = Math.cos(entity.rotation);
  const sine = Math.sin(entity.rotation);
  const at = (angle: number): Point2D => {
    const x = Math.cos(angle) * entity.rx;
    const y = Math.sin(angle) * entity.ry;
    return { x: entity.cx + x * cosine - y * sine, y: entity.cy + x * sine + y * cosine };
  };
  const derivative = (angle: number): Point2D => {
    const x = -Math.sin(angle) * entity.rx;
    const y = Math.cos(angle) * entity.ry;
    return { x: x * cosine - y * sine, y: x * sine + y * cosine };
  };
  const delta = Math.PI / 2;
  const kappa = (4 / 3) * Math.tan(delta / 4);
  for (let index = 0; index < 4; index += 1) {
    const angle = index * delta;
    const nextAngle = angle + delta;
    const start = at(angle);
    const end = at(nextAngle);
    const startTangent = derivative(angle);
    const endTangent = derivative(nextAngle);
    points.push(start);
    segments.push({
      type: "cubic",
      cp1: { x: start.x + startTangent.x * kappa, y: start.y + startTangent.y * kappa },
      cp2: { x: end.x - endTangent.x * kappa, y: end.y - endTangent.y * kappa },
    });
  }
  return { points, segments, nodeTypes: points.map(() => "symmetric"), closed: true };
}

function circleGeometry(entity: Extract<Entity, { type: "circle" }>): EditablePathGeometry | null {
  return ellipseGeometry({
    ...entity,
    type: "ellipse",
    cx: entity.center.x,
    cy: entity.center.y,
    rx: entity.radius,
    ry: entity.radius,
    rotation: 0,
  });
}

function roundedRectangleGeometry(entity: Extract<Entity, { type: "rectangle" }>): EditablePathGeometry {
  const left = Math.min(entity.origin.x, entity.origin.x + entity.width);
  const right = Math.max(entity.origin.x, entity.origin.x + entity.width);
  const bottom = Math.min(entity.origin.y, entity.origin.y + entity.height);
  const top = Math.max(entity.origin.y, entity.origin.y + entity.height);
  const radius = Math.min(Math.max(0, entity.cornerRadius), (right - left) / 2, (top - bottom) / 2);
  if (radius <= 1e-10) return lineGeometry([
    { x: left, y: bottom }, { x: right, y: bottom }, { x: right, y: top }, { x: left, y: top },
  ], true);
  const kappa = (4 / 3) * Math.tan(Math.PI / 8) * radius;
  const points: Point2D[] = [
    { x: left + radius, y: bottom }, { x: right - radius, y: bottom },
    { x: right, y: bottom + radius }, { x: right, y: top - radius },
    { x: right - radius, y: top }, { x: left + radius, y: top },
    { x: left, y: top - radius }, { x: left, y: bottom + radius },
  ];
  const segments: PolylineSegment[] = [
    { type: "line" },
    { type: "cubic", cp1: { x: right - radius + kappa, y: bottom }, cp2: { x: right, y: bottom + radius - kappa } },
    { type: "line" },
    { type: "cubic", cp1: { x: right, y: top - radius + kappa }, cp2: { x: right - radius + kappa, y: top } },
    { type: "line" },
    { type: "cubic", cp1: { x: left + radius - kappa, y: top }, cp2: { x: left, y: top - radius + kappa } },
    { type: "line" },
    { type: "cubic", cp1: { x: left, y: bottom + radius - kappa }, cp2: { x: left + radius - kappa, y: bottom } },
  ];
  return { points, segments, nodeTypes: points.map(() => "corner"), closed: true };
}

function sectorGeometry(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
): EditablePathGeometry | null {
  const arc = arcGeometry(cx, cy, radius, startAngle, endAngle, false);
  if (!arc) return null;
  const points = [{ x: cx, y: cy }, ...arc.points];
  return {
    points,
    segments: [{ type: "line" }, ...arc.segments, { type: "line" }],
    nodeTypes: points.map((_, index) => index > 1 && index < points.length - 1 ? "smooth" : "corner"),
    closed: true,
  };
}

function cloudGeometry(entity: Extract<Entity, { type: "cloud" }>): EditablePathGeometry | null {
  if (entity.points.length < 2) return null;
  let centroidX = 0;
  let centroidY = 0;
  for (const point of entity.points) { centroidX += point.x; centroidY += point.y; }
  centroidX /= entity.points.length;
  centroidY /= entity.points.length;
  const segments: PolylineSegment[] = [];
  for (let index = 0; index < entity.points.length; index += 1) {
    const start = entity.points[index]!;
    const end = entity.points[(index + 1) % entity.points.length]!;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy) || 1;
    const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    let nx = -dy / length;
    let ny = dx / length;
    if (nx * (middle.x - centroidX) + ny * (middle.y - centroidY) < 0) { nx = -nx; ny = -ny; }
    const bulge = Math.min(entity.arcRadius, length / 2);
    segments.push({ type: "quadratic", cp1: { x: middle.x + nx * bulge, y: middle.y + ny * bulge } });
  }
  return {
    points: entity.points.map((point) => ({ ...point })),
    segments,
    nodeTypes: entity.points.map(() => "corner"),
    closed: true,
  };
}

/** Converts every node-editable primitive into a compact curve-enabled polyline. */
export function entityToEditablePolyline(entity: Entity): PolylineEntity | null {
  let geometry: EditablePathGeometry | null;
  switch (entity.type) {
    case "polyline":
      geometry = {
        points: entity.points.map((point) => ({ ...point })),
        segments: clonePolylineSegments(entity),
        nodeTypes: entity.points.map((_, index) => entity.nodeTypes?.[index] ?? "corner"),
        closed: entity.closed,
      };
      break;
    case "line": geometry = lineGeometry([entity.start, entity.end], false); break;
    case "rectangle": geometry = roundedRectangleGeometry(entity); break;
    case "circle": geometry = circleGeometry(entity); break;
    case "arc": geometry = arcGeometry(entity.center.x, entity.center.y, entity.radius, entity.startAngle, entity.endAngle, entity.counterClockwise); break;
    case "ellipse": geometry = ellipseGeometry(entity); break;
    case "polygon": geometry = lineGeometry(radialVertices(entity.cx, entity.cy, entity.sides, entity.rotation, () => entity.radius), true); break;
    case "quadrant": {
      const start = (entity.quadrantIndex - 1) * Math.PI / 2;
      geometry = sectorGeometry(entity.cx, entity.cy, entity.radius, start, start + Math.PI / 2);
      break;
    }
    case "semicircle": geometry = sectorGeometry(entity.cx, entity.cy, entity.radius, entity.startAngle, entity.startAngle + Math.PI); break;
    case "segment": geometry = sectorGeometry(entity.cx, entity.cy, entity.radius, entity.startAngle, entity.endAngle); break;
    case "star": geometry = lineGeometry(radialVertices(entity.cx, entity.cy, entity.points * 2, entity.rotation, (index) => index % 2 === 0 ? entity.outerRadius : entity.innerRadius), true); break;
    case "cloud": geometry = cloudGeometry(entity); break;
    case "image":
    case "text":
    case "dimension":
    case "leader":
      return null;
  }
  if (!geometry || geometry.points.length < 2) return null;
  const candidate: PolylineEntity = {
    id: entity.id,
    ...(entity.name ? { name: entity.name } : {}),
    type: "polyline",
    layerId: entity.layerId,
    intent: entity.intent,
    style: { ...entity.style, dashArray: [...entity.style.dashArray] },
    bbox: entity.bbox,
    visible: entity.visible,
    locked: entity.locked,
    ...(entity.metadata ? { metadata: entity.metadata } : {}),
    points: geometry.points,
    segments: geometry.segments,
    nodeTypes: geometry.nodeTypes,
    closed: geometry.closed,
  };
  return { ...candidate, bbox: calculatePolylineBounds(candidate) };
}
