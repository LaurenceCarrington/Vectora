import { calculateEntityBounds } from "../document/DocumentModel";
import type {
  BezierNodeType,
  CadDocument,
  DocumentUnits,
  Entity,
  EntityStyle,
  Layer,
  ManufacturingIntent,
  Point2D,
  PolylineSegment,
} from "../document/types";
import { getPolylineSegment, polylineSegmentCount } from "../geometry/bezier";
import { entityToClosedPath } from "../geometry/operations/pathConversion";
import { formatDimensionText, getDimensionGeometry } from "../geometry/annotations";
import { vectoraRenderColors } from "../design/vectoraRenderColors";

export interface SvgImportResult {
  readonly title: string;
  readonly units: DocumentUnits;
  readonly layers: readonly Layer[];
  readonly entities: readonly Entity[];
}

export interface SvgExportOptions {
  readonly padding?: number;
  readonly pretty?: boolean;
}

type Matrix = readonly [number, number, number, number, number, number];
type SvgStyle = {
  readonly stroke: string | null;
  readonly fill: string | null;
  readonly strokeWidth: number;
  readonly dashArray: readonly number[];
  readonly visible: boolean;
};
type ParseContext = {
  readonly matrix: Matrix;
  readonly style: SvgStyle;
  readonly layerId: string;
};

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const SVG_ARC_TOLERANCE = 0.05;
const MAX_SVG_ARC_SEGMENTS = 4_096;
// SVG absolute lengths use CSS pixels; CAM pixels require separate calibration.
const SVG_PX_PER_MM = 96 / 25.4;
const LENGTH_TO_PX: Readonly<Record<string, number>> = {
  px: 1, mm: SVG_PX_PER_MM, cm: SVG_PX_PER_MM * 10,
  in: 96, pt: 96 / 72, pc: 16,
};

function svgLength(value: string | undefined): { value: number; unit: string } | null {
  const match = value?.trim().match(/^([-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?)\s*(mm|cm|in|px|pt|pc)?$/i);
  if (!match) return null;
  const length = Number(match[1]);
  return Number.isFinite(length) && length > 0 ? { value: length, unit: match[2]?.toLowerCase() ?? "px" } : null;
}

function svgViewport(attributes: Record<string, string>): { units: DocumentUnits; matrix: Matrix } {
  const width = svgLength(attributes.width);
  const height = svgLength(attributes.height);
  const lengthUnit = width?.unit ?? height?.unit ?? "px";
  const units: DocumentUnits = lengthUnit === "in" ? "in" : lengthUnit === "px" ? "px" : "mm";
  const pxPerUnit = LENGTH_TO_PX[units]!;
  const viewBox = attributes.viewbox?.trim().split(/[\s,]+/).map(Number);
  if (viewBox && (viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value)) ||
      viewBox[2]! <= 0 || viewBox[3]! <= 0)) throw new Error("SVG viewBox must contain four finite values with positive width and height.");
  if (!viewBox) return { units, matrix: [1 / pxPerUnit, 0, 0, 1 / pxPerUnit, 0, 0] };
  const [x, y, boxWidth, boxHeight] = viewBox as [number, number, number, number];
  const viewportWidth = width ? width.value * LENGTH_TO_PX[width.unit]! / pxPerUnit : boxWidth / pxPerUnit;
  const viewportHeight = height ? height.value * LENGTH_TO_PX[height.unit]! / pxPerUnit : boxHeight / pxPerUnit;
  let scaleX = viewportWidth / boxWidth;
  let scaleY = viewportHeight / boxHeight;
  let offsetX = 0;
  let offsetY = 0;
  const aspect = (attributes.preserveaspectratio ?? "xMidYMid meet").replace(/^defer\s+/, "").trim().split(/\s+/);
  if (aspect[0] !== "none") {
    const scale = aspect[1] === "slice" ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
    scaleX = scaleY = scale;
    const alignment = aspect[0] ?? "xMidYMid";
    offsetX = (viewportWidth - boxWidth * scale) * (alignment.includes("xMax") ? 1 : alignment.includes("xMid") ? 0.5 : 0);
    offsetY = (viewportHeight - boxHeight * scale) * (alignment.includes("YMax") ? 1 : alignment.includes("YMid") ? 0.5 : 0);
  }
  // Our exports record the CAD origin so native coordinates survive round trips.
  return { units, matrix: [scaleX, 0, 0, scaleY,
    offsetX - x * scaleX + finite(attributes["data-vectora-origin-x"]),
    offsetY - y * scaleY + finite(attributes["data-vectora-origin-y"])] };
}
const EMPTY_BOUNDS = { minX: 0, minY: 0, maxX: 0, maxY: 0 } as const;
const NUMBER_PATTERN = /[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi;
const DEFAULT_STYLE: SvgStyle = {
  stroke: "#000000",
  fill: null,
  strokeWidth: 1,
  dashArray: [],
  visible: true,
};
let importSequence = 0;

function nextEntityId(): string {
  importSequence += 1;
  return globalThis.crypto?.randomUUID?.() ?? `svg-${Date.now().toString(36)}-${importSequence}`;
}

function finite(value: string | undefined, fallback = 0): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function format(value: number): string {
  const normalized = Math.abs(value) < 1e-10 ? 0 : value;
  return Number.parseFloat(normalized.toFixed(6)).toString();
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function decodeXml(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|amp|quot|apos|lt|gt);/gi, (entity, decimal: string | undefined, hexadecimal: string | undefined) => {
    if (decimal || hexadecimal) {
      const codePoint = Number.parseInt(decimal ?? hexadecimal!, decimal ? 10 : 16);
      return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    }
    switch (entity.toLowerCase()) {
      case "&amp;": return "&";
      case "&quot;": return '"';
      case "&apos;": return "'";
      case "&lt;": return "<";
      case "&gt;": return ">";
      default: return entity;
    }
  });
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of source.matchAll(pattern)) {
    const name = match[1]?.toLowerCase();
    if (name) attributes[name] = decodeXml(match[2] ?? match[3] ?? "");
  }
  return attributes;
}

function multiply(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function parseTransform(source: string | undefined): Matrix {
  if (!source) return IDENTITY;
  let result: Matrix = IDENTITY;
  for (const match of source.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/gi)) {
    const name = match[1]?.toLowerCase();
    const values = [...(match[2] ?? "").matchAll(NUMBER_PATTERN)].map((item) => Number(item[0]));
    let transform: Matrix = IDENTITY;
    if (name === "matrix" && values.length >= 6) {
      transform = [values[0]!, values[1]!, values[2]!, values[3]!, values[4]!, values[5]!];
    } else if (name === "translate") {
      transform = [1, 0, 0, 1, values[0] ?? 0, values[1] ?? 0];
    } else if (name === "scale") {
      const x = values[0] ?? 1;
      transform = [x, 0, 0, values[1] ?? x, 0, 0];
    } else if (name === "rotate") {
      const angle = ((values[0] ?? 0) * Math.PI) / 180;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const rotation: Matrix = [cosine, sine, -sine, cosine, 0, 0];
      const centerX = values[1] ?? 0;
      const centerY = values[2] ?? 0;
      transform = values.length >= 3
        ? multiply(multiply([1, 0, 0, 1, centerX, centerY], rotation), [1, 0, 0, 1, -centerX, -centerY])
        : rotation;
    } else if (name === "skewx") {
      transform = [1, 0, Math.tan(((values[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    } else if (name === "skewy") {
      transform = [1, Math.tan(((values[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    }
    result = multiply(result, transform);
  }
  return result;
}

function transformSvgPoint(point: Point2D, matrix: Matrix): Point2D {
  return {
    x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
  };
}

function toWorldPoint(point: Point2D, matrix: Matrix): Point2D {
  const transformed = transformSvgPoint(point, matrix);
  return { x: transformed.x, y: -transformed.y };
}

function matrixScale(matrix: Matrix): number {
  return (Math.hypot(matrix[0], matrix[1]) + Math.hypot(matrix[2], matrix[3])) / 2;
}

/** Largest singular value of the affine matrix's 2D linear component. */
function matrixMaximumScale(matrix: Matrix): number {
  const [a, b, c, d] = matrix;
  const trace = a * a + b * b + c * c + d * d;
  const determinant = a * d - b * c;
  const discriminant = Math.max(0, trace * trace - 4 * determinant * determinant);
  return Math.sqrt(Math.max(0, (trace + Math.sqrt(discriminant)) / 2));
}

function isAxisAligned(matrix: Matrix): boolean {
  return Math.abs(matrix[1]) < 1e-9 && Math.abs(matrix[2]) < 1e-9;
}

function isUniform(matrix: Matrix): boolean {
  const first = Math.hypot(matrix[0], matrix[1]);
  const second = Math.hypot(matrix[2], matrix[3]);
  const dot = matrix[0] * matrix[2] + matrix[1] * matrix[3];
  return Math.abs(first - second) < 1e-7 && Math.abs(dot) < 1e-7;
}

function styleProperties(attributes: Record<string, string>): Record<string, string> {
  const inline: Record<string, string> = {};
  for (const declaration of (attributes.style ?? "").split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    inline[declaration.slice(0, separator).trim().toLowerCase()] = declaration.slice(separator + 1).trim();
  }
  return { ...inline, ...attributes };
}

function inheritStyle(parent: SvgStyle, attributes: Record<string, string>, matrix: Matrix): SvgStyle {
  const values = styleProperties(attributes);
  const stroke = values.stroke === "none" ? null : values.stroke ?? parent.stroke;
  const fill = values.fill === "none" ? null : values.fill ?? parent.fill;
  const dashSource = values["stroke-dasharray"];
  const dashArray = !dashSource || dashSource === "none"
    ? dashSource === "none" ? [] : parent.dashArray
    : [...dashSource.matchAll(NUMBER_PATTERN)].map((match) => Math.max(0, Number(match[0])));
  const hidden = values.display === "none" || values.visibility === "hidden";
  return {
    stroke,
    fill,
    strokeWidth: finite(values["stroke-width"], parent.strokeWidth) * matrixScale(matrix),
    dashArray,
    visible: parent.visible && !hidden,
  };
}

function entityStyle(style: SvgStyle): EntityStyle {
  return {
    strokeColor: style.stroke,
    strokeWidth: style.stroke ? Math.max(0, style.strokeWidth) : 0,
    fillColor: style.fill,
    dashArray: style.dashArray,
  };
}

function inferIntent(value: string | undefined): ManufacturingIntent {
  if (value?.toLowerCase().includes("pocket")) return "pocket";
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("engrave")) return "engrave";
  if (normalized.includes("score")) return "score";
  if (normalized.includes("construction")) return "construction";
  return "cut";
}

function safeLayerId(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "imported";
}

function parsePoints(value: string | undefined): readonly Point2D[] {
  const numbers = [...(value ?? "").matchAll(NUMBER_PATTERN)].map((match) => Number(match[0]));
  const points: Point2D[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    points.push({ x: numbers[index]!, y: numbers[index + 1]! });
  }
  return points;
}

function withBounds(entity: Entity): Entity {
  return { ...entity, bbox: calculateEntityBounds(entity) };
}

function commonEntity(layer: Layer, style: SvgStyle) {
  return {
    id: nextEntityId(),
    layerId: layer.id,
    intent: layer.intent,
    style: entityStyle(style),
    bbox: EMPTY_BOUNDS,
    visible: style.visible,
    locked: false,
  } as const;
}

function approximateCircle(center: Point2D, radius: number, matrix: Matrix, segments = 64): readonly Point2D[] {
  return Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return toWorldPoint({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius }, matrix);
  });
}

function approximateEllipse(
  center: Point2D,
  radiusX: number,
  radiusY: number,
  matrix: Matrix,
  segments = 64,
): readonly Point2D[] {
  return Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return toWorldPoint({
      x: center.x + Math.cos(angle) * radiusX,
      y: center.y + Math.sin(angle) * radiusY,
    }, matrix);
  });
}

function supportsNativeEllipse(matrix: Matrix): boolean {
  const xLength = Math.hypot(matrix[0], matrix[1]);
  const yLength = Math.hypot(matrix[2], matrix[3]);
  if (xLength <= Number.EPSILON || yLength <= Number.EPSILON) return false;
  const normalizedDot = (matrix[0] * matrix[2] + matrix[1] * matrix[3]) / (xLength * yLength);
  return Math.abs(normalizedDot) < 1e-7;
}

function appendQuadratic(
  points: Point2D[], segments: PolylineSegment[], nodeTypes: BezierNodeType[], _start: Point2D,
  control: Point2D, end: Point2D, matrix: Matrix,
): void {
  // Affine SVG transforms preserve Bézier degree exactly. Keeping one native
  // segment avoids presenting users with dozens of artificial edit nodes.
  segments.push({ type: "quadratic", cp1: toWorldPoint(control, matrix) });
  points.push(toWorldPoint(end, matrix));
  nodeTypes.push("corner");
}

function appendCubic(
  points: Point2D[], segments: PolylineSegment[], nodeTypes: BezierNodeType[], _start: Point2D,
  cp1: Point2D, cp2: Point2D, end: Point2D, matrix: Matrix,
): void {
  segments.push({
    type: "cubic",
    cp1: toWorldPoint(cp1, matrix),
    cp2: toWorldPoint(cp2, matrix),
  });
  points.push(toWorldPoint(end, matrix));
  nodeTypes.push("corner");
}

type ParsedSubpath = {
  points: Point2D[];
  segments: PolylineSegment[];
  nodeTypes: BezierNodeType[];
  closed: boolean;
};

function parsePathPoints(data: string, matrix: Matrix): ParsedSubpath[] {
  const tokens = data.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/g) ?? [];
  const subpaths: ParsedSubpath[] = [];
  let points: Point2D[] = [];
  let segments: PolylineSegment[] = [];
  let nodeTypes: BezierNodeType[] = [];
  let cursor = { x: 0, y: 0 };
  let subpathStart = cursor;
  let command = "";
  let previousCommand = "";
  let lastCubicControl: Point2D | null = null;
  let lastQuadraticControl: Point2D | null = null;
  let index = 0;
  let closed = false;
  const flush = () => {
    if (closed && points.length > 2) {
      const first = points[0]!;
      const last = points.at(-1)!;
      if (Math.abs(first.x - last.x) < 1e-10 && Math.abs(first.y - last.y) < 1e-10) {
        points.pop();
        nodeTypes.pop();
        segments.pop(); // Z contributes no edge when the preceding segment already closes.
      }
    }
    if (points.length > 0) subpaths.push({ points, segments, nodeTypes, closed });
    points = [];
    segments = [];
    nodeTypes = [];
    closed = false;
  };
  const number = () => Number(tokens[index++] ?? 0);
  while (index < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[index] ?? "")) command = tokens[index++] ?? "";
    if (!command) break;
    const relative = command === command.toLowerCase();
    const upper = command.toUpperCase();
    const arity = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }[upper];
    if (arity === undefined || tokens.slice(index, index + arity).length < arity ||
        tokens.slice(index, index + arity).some((token) => !Number.isFinite(Number(token)))) {
      throw new Error(`Invalid SVG path command ${command}.`);
    }
    if (upper === "M") flush();
    // Drawing after Z starts a fresh subpath at the closed contour's start.
    if (upper !== "M" && upper !== "Z" && points.length === 0) {
      points.push(toWorldPoint(cursor, matrix));
      nodeTypes.push("corner");
    }
    const point = (x: number, y: number): Point2D => relative ? { x: cursor.x + x, y: cursor.y + y } : { x, y };
    if (upper === "M" || upper === "L") {
      cursor = point(number(), number());
      if (upper === "M") subpathStart = cursor;
      if (points.length > 0 && (upper === "L" || !closed)) segments.push({ type: "line" });
      points.push(toWorldPoint(cursor, matrix));
      nodeTypes.push("corner");
      if (upper === "M") command = relative ? "l" : "L";
      lastCubicControl = null;
      lastQuadraticControl = null;
    } else if (upper === "H") {
      cursor = { x: relative ? cursor.x + number() : number(), y: cursor.y };
      if (points.length > 0) segments.push({ type: "line" });
      points.push(toWorldPoint(cursor, matrix));
      nodeTypes.push("corner");
      lastCubicControl = null;
      lastQuadraticControl = null;
    } else if (upper === "V") {
      cursor = { x: cursor.x, y: relative ? cursor.y + number() : number() };
      if (points.length > 0) segments.push({ type: "line" });
      points.push(toWorldPoint(cursor, matrix));
      nodeTypes.push("corner");
      lastCubicControl = null;
      lastQuadraticControl = null;
    } else if (upper === "C") {
      const start = cursor;
      const firstControl = point(number(), number());
      const secondControl = point(number(), number());
      const end = point(number(), number());
      appendCubic(points, segments, nodeTypes, start, firstControl, secondControl, end, matrix);
      cursor = end;
      lastCubicControl = secondControl;
      lastQuadraticControl = null;
    } else if (upper === "S") {
      const start = cursor;
      const firstControl = previousCommand === "C" || previousCommand === "S"
        ? {
            x: cursor.x * 2 - (lastCubicControl?.x ?? cursor.x),
            y: cursor.y * 2 - (lastCubicControl?.y ?? cursor.y),
          }
        : cursor;
      const secondControl = point(number(), number());
      const end = point(number(), number());
      if (points.length > 0) nodeTypes[points.length - 1] = "smooth";
      appendCubic(points, segments, nodeTypes, start, firstControl, secondControl, end, matrix);
      cursor = end;
      lastCubicControl = secondControl;
      lastQuadraticControl = null;
    } else if (upper === "Q") {
      const start = cursor;
      const control = point(number(), number());
      const end = point(number(), number());
      appendQuadratic(points, segments, nodeTypes, start, control, end, matrix);
      cursor = end;
      lastQuadraticControl = control;
      lastCubicControl = null;
    } else if (upper === "T") {
      const start = cursor;
      const control: Point2D = previousCommand === "Q" || previousCommand === "T"
        ? {
            x: cursor.x * 2 - (lastQuadraticControl?.x ?? cursor.x),
            y: cursor.y * 2 - (lastQuadraticControl?.y ?? cursor.y),
          }
        : cursor;
      const end = point(number(), number());
      if (points.length > 0) nodeTypes[points.length - 1] = "smooth";
      appendQuadratic(points, segments, nodeTypes, start, control, end, matrix);
      cursor = end;
      lastQuadraticControl = control;
      lastCubicControl = null;
    } else if (upper === "A") {
      const radiusX = number();
      const radiusY = number();
      const rotation = number();
      const largeArc = number();
      const sweep = number();
      const end = point(number(), number());
      const maximumScale = matrixMaximumScale(matrix);
      const localTolerance = maximumScale > 0 ? SVG_ARC_TOLERANCE / maximumScale : Number.POSITIVE_INFINITY;
      const samples = sampleSvgArc(cursor, end, radiusX, radiusY, rotation, largeArc !== 0, sweep !== 0, localTolerance);
      for (const sample of samples.slice(1)) {
        segments.push({ type: "line" });
        points.push(toWorldPoint(sample, matrix));
        nodeTypes.push("corner");
      }
      cursor = end;
      lastCubicControl = null;
      lastQuadraticControl = null;
    } else if (upper === "Z") {
      if (points.length > 1) segments.push({ type: "line" });
      cursor = subpathStart;
      closed = true;
      command = "";
      lastCubicControl = null;
      lastQuadraticControl = null;
      flush();
    } else {
      break;
    }
    previousCommand = upper;
  }
  flush();
  return subpaths;
}

function sampleSvgArc(
  start: Point2D,
  end: Point2D,
  rawRadiusX: number,
  rawRadiusY: number,
  rotationDegrees: number,
  largeArc: boolean,
  sweep: boolean,
  maximumError: number,
): readonly Point2D[] {
  let radiusX = Math.abs(rawRadiusX);
  let radiusY = Math.abs(rawRadiusY);
  if (radiusX === 0 || radiusY === 0) return [start, end];
  const rotation = (rotationDegrees * Math.PI) / 180;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const dx = (start.x - end.x) / 2;
  const dy = (start.y - end.y) / 2;
  const localX = cosine * dx + sine * dy;
  const localY = -sine * dx + cosine * dy;
  const lambda = (localX * localX) / (radiusX * radiusX) + (localY * localY) / (radiusY * radiusY);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    radiusX *= scale;
    radiusY *= scale;
  }
  const sign = largeArc === sweep ? -1 : 1;
  const numerator = Math.max(0,
    radiusX * radiusX * radiusY * radiusY -
    radiusX * radiusX * localY * localY -
    radiusY * radiusY * localX * localX,
  );
  const denominator = radiusX * radiusX * localY * localY + radiusY * radiusY * localX * localX;
  const coefficient = denominator === 0 ? 0 : sign * Math.sqrt(numerator / denominator);
  const centerLocalX = coefficient * ((radiusX * localY) / radiusY);
  const centerLocalY = coefficient * (-(radiusY * localX) / radiusX);
  const center = {
    x: cosine * centerLocalX - sine * centerLocalY + (start.x + end.x) / 2,
    y: sine * centerLocalX + cosine * centerLocalY + (start.y + end.y) / 2,
  };
  const angle = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const startVector = { x: (localX - centerLocalX) / radiusX, y: (localY - centerLocalY) / radiusY };
  const endVector = { x: (-localX - centerLocalX) / radiusX, y: (-localY - centerLocalY) / radiusY };
  const startAngle = angle(1, 0, startVector.x, startVector.y);
  let sweepAngle = angle(startVector.x, startVector.y, endVector.x, endVector.y);
  if (!sweep && sweepAngle > 0) sweepAngle -= Math.PI * 2;
  if (sweep && sweepAngle < 0) sweepAngle += Math.PI * 2;
  const maximumRadius = Math.max(radiusX, radiusY);
  const maximumAngle = maximumError >= maximumRadius * 2
    ? Math.PI * 2
    : 2 * Math.acos(Math.max(-1, Math.min(1, 1 - maximumError / maximumRadius)));
  const segments = Math.max(1, Math.ceil(Math.abs(sweepAngle) / Math.max(maximumAngle, Number.EPSILON)));
  if (segments > MAX_SVG_ARC_SEGMENTS) {
    throw new RangeError(`An SVG arc exceeds the supported ${MAX_SVG_ARC_SEGMENTS.toLocaleString()}-segment precision limit.`);
  }
  return Array.from({ length: segments + 1 }, (_, index) => {
    const theta = startAngle + sweepAngle * (index / segments);
    return {
      x: center.x + cosine * radiusX * Math.cos(theta) - sine * radiusY * Math.sin(theta),
      y: center.y + sine * radiusX * Math.cos(theta) + cosine * radiusY * Math.sin(theta),
    };
  });
}

export function parseSvg(source: string): SvgImportResult {
  if (!/<svg\b/i.test(source)) throw new Error("The selected file is not a valid SVG document.");
  const entities: Entity[] = [];
  const layers = new Map<string, Layer>();
  const defaultLayer: Layer = {
    id: "imported",
    name: "Imported",
    intent: "cut",
    color: vectoraRenderColors.operation.cut,
    visible: true,
    locked: false,
    order: 0,
  };
  layers.set(defaultLayer.id, defaultLayer);
  const stack: ParseContext[] = [{ matrix: IDENTITY, style: DEFAULT_STYLE, layerId: defaultLayer.id }];
  let units: DocumentUnits = "px";
  let title = "Imported SVG";
  let rootSeen = false;
  let ignoredAnnotationDepth = 0;

  for (const match of source.matchAll(/<\s*(\/?)\s*([A-Za-z][\w:-]*)([^>]*)>/g)) {
    const closing = match[1] === "/";
    const tag = match[2]?.toLowerCase() ?? "";
    const tail = match[3] ?? "";
    const selfClosing = !closing && /\/\s*$/.test(tail);
    if (ignoredAnnotationDepth > 0) {
      if (closing && tag === "g") ignoredAnnotationDepth -= 1;
      else if (!closing && tag === "g" && !selfClosing) ignoredAnnotationDepth += 1;
      continue;
    }
    if (closing) {
      if ((tag === "g" || tag === "svg") && stack.length > 1) stack.pop();
      continue;
    }
    const attributes = parseAttributes(tail);
    const parent = stack.at(-1)!;
    const matrix = multiply(parent.matrix, parseTransform(attributes.transform));
    const style = inheritStyle(parent.style, attributes, parseTransform(attributes.transform));
    let layerId = parent.layerId;

    if (tag === "svg") {
      if (!rootSeen) {
        const viewport = svgViewport(attributes);
        units = viewport.units;
        if (!selfClosing) stack.push({ matrix: multiply(matrix, viewport.matrix), style, layerId });
        rootSeen = true;
      } else {
        if (!selfClosing) stack.push({ matrix, style, layerId });
      }
      continue;
    }
    if (!rootSeen) continue;
    if (tag === "title") continue;
    if (tag === "g") {
      const name = attributes["inkscape:label"] ?? attributes["data-name"] ?? attributes.id;
      if (name) {
        const baseId = safeLayerId(attributes.id ?? name);
        layerId = baseId;
        let suffix = 2;
        while (layers.has(layerId) && layers.get(layerId)?.name !== name) layerId = `${baseId}-${suffix++}`;
        if (!layers.has(layerId)) {
          const intent = inferIntent(attributes["data-vectora-intent"] ?? name);
          layers.set(layerId, {
            id: layerId,
            name,
            intent,
            color: style.stroke ?? "#64748b",
            visible: style.visible,
            locked: false,
            order: layers.size,
          });
        }
      }
      const annotationType = attributes["data-vectora-type"];
      if (annotationType === "dimension" || annotationType === "leader") {
        const layer = layers.get(layerId) ?? defaultLayer;
        const common = commonEntity(layer, style);
        if (annotationType === "dimension") {
          const dimensionKind = attributes["data-dimension-kind"];
          if (["linear", "aligned", "radial", "diameter"].includes(dimensionKind ?? "")) {
            const startPoint = toWorldPoint({ x: finite(attributes["data-start-x"]), y: finite(attributes["data-start-y"]) }, matrix);
            const endPoint = toWorldPoint({ x: finite(attributes["data-end-x"]), y: finite(attributes["data-end-y"]) }, matrix);
            const textPosition = toWorldPoint({ x: finite(attributes["data-text-x"]), y: finite(attributes["data-text-y"]) }, matrix);
            entities.push(withBounds({
              ...common,
              type: "dimension",
              dimensionKind: dimensionKind as "linear" | "aligned" | "radial" | "diameter",
              startPoint,
              endPoint,
              textPosition,
              value: Math.abs(finite(attributes["data-value"])),
              prefix: attributes["data-prefix"] ?? "",
              suffix: attributes["data-suffix"] ?? units,
              precision: Math.max(0, Math.round(finite(attributes["data-precision"], 2))),
              arrowSize: Math.max(0.25, finite(attributes["data-arrow-size"], 4)),
            }));
          }
        } else {
          entities.push(withBounds({
            ...common,
            type: "leader",
            arrowPoint: toWorldPoint({ x: finite(attributes["data-arrow-x"]), y: finite(attributes["data-arrow-y"]) }, matrix),
            elbowPoint: toWorldPoint({ x: finite(attributes["data-elbow-x"]), y: finite(attributes["data-elbow-y"]) }, matrix),
            textPosition: toWorldPoint({ x: finite(attributes["data-text-x"]), y: finite(attributes["data-text-y"]) }, matrix),
            text: attributes["data-text"] ?? "Note",
          }));
        }
        ignoredAnnotationDepth = selfClosing ? 0 : 1;
        continue;
      }
      if (!selfClosing) stack.push({ matrix, style, layerId });
      continue;
    }

    const layer = layers.get(layerId) ?? defaultLayer;
    const common = {
      ...commonEntity(layer, style),
      ...(attributes["data-vectora-compound-id"] ? { compoundId: attributes["data-vectora-compound-id"] } : {}),
    };
    let entity: Entity | null = null;
    if (tag === "text" && attributes["data-vectora-type"] === "text") {
      const origin = toWorldPoint({ x: finite(attributes.x), y: finite(attributes.y) }, matrix);
      entity = {
        ...common,
        type: "text",
        text: attributes["data-text"] ?? "Text",
        fontFamily: attributes["font-family"]?.split(",")[0]?.replace(/^['\"]|['\"]$/g, "").trim() || "Roboto",
        fontSize: Math.max(0.1, Math.abs(finite(attributes["font-size"], 24) * matrixScale(matrix))),
        x: origin.x,
        y: origin.y,
      };
    } else if (tag === "line") {
      entity = {
        ...common,
        type: "line",
        start: toWorldPoint({ x: finite(attributes.x1), y: finite(attributes.y1) }, matrix),
        end: toWorldPoint({ x: finite(attributes.x2), y: finite(attributes.y2) }, matrix),
      };
    } else if (tag === "rect") {
      const x = finite(attributes.x);
      const y = finite(attributes.y);
      const width = finite(attributes.width);
      const height = finite(attributes.height);
      if (isAxisAligned(matrix)) {
        const first = toWorldPoint({ x, y }, matrix);
        const opposite = toWorldPoint({ x: x + width, y: y + height }, matrix);
        entity = {
          ...common,
          type: "rectangle",
          origin: { x: Math.min(first.x, opposite.x), y: Math.min(first.y, opposite.y) },
          width: Math.abs(opposite.x - first.x),
          height: Math.abs(opposite.y - first.y),
          cornerRadius: Math.max(0, finite(attributes.rx)) * matrixScale(matrix),
        };
      } else {
        entity = {
          ...common,
          type: "polyline",
          points: [
            toWorldPoint({ x, y }, matrix),
            toWorldPoint({ x: x + width, y }, matrix),
            toWorldPoint({ x: x + width, y: y + height }, matrix),
            toWorldPoint({ x, y: y + height }, matrix),
          ],
          closed: true,
        };
      }
    } else if (tag === "circle") {
      const svgCenter = { x: finite(attributes.cx), y: finite(attributes.cy) };
      const radius = Math.abs(finite(attributes.r));
      if (isUniform(matrix)) {
        entity = {
          ...common,
          type: "circle",
          center: toWorldPoint(svgCenter, matrix),
          radius: radius * matrixScale(matrix),
        };
      } else {
        entity = { ...common, type: "polyline", points: approximateCircle(svgCenter, radius, matrix), closed: true };
      }
    } else if (tag === "ellipse") {
      const svgCenter = { x: finite(attributes.cx), y: finite(attributes.cy) };
      const radiusX = Math.abs(finite(attributes.rx));
      const radiusY = Math.abs(finite(attributes.ry));
      if (supportsNativeEllipse(matrix)) {
        const center = toWorldPoint(svgCenter, matrix);
        entity = {
          ...common,
          type: "ellipse",
          cx: center.x,
          cy: center.y,
          rx: radiusX * Math.hypot(matrix[0], matrix[1]),
          ry: radiusY * Math.hypot(matrix[2], matrix[3]),
          rotation: Math.atan2(-matrix[1], matrix[0]),
        };
      } else {
        entity = {
          ...common,
          type: "polyline",
          points: approximateEllipse(svgCenter, radiusX, radiusY, matrix),
          closed: true,
        };
      }
    } else if (tag === "polyline" || tag === "polygon") {
      entity = {
        ...common,
        type: "polyline",
        points: parsePoints(attributes.points).map((point) => toWorldPoint(point, matrix)),
        closed: tag === "polygon",
      };
    } else if (tag === "path") {
      if (attributes["data-vectora-type"] === "arc" && isUniform(matrix)) {
        const center = toWorldPoint({
          x: finite(attributes["data-center-x"]),
          y: finite(attributes["data-center-y"]),
        }, matrix);
        const start = toWorldPoint({
          x: finite(attributes["data-start-x"]),
          y: finite(attributes["data-start-y"]),
        }, matrix);
        const end = toWorldPoint({
          x: finite(attributes["data-end-x"]),
          y: finite(attributes["data-end-y"]),
        }, matrix);
        entity = {
          ...common,
          type: "arc",
          center,
          radius: Math.hypot(start.x - center.x, start.y - center.y),
          startAngle: Math.atan2(start.y - center.y, start.x - center.x),
          endAngle: Math.atan2(end.y - center.y, end.x - center.x),
          counterClockwise: attributes["data-counter-clockwise"] === "true",
        };
      } else {
        const subpaths = parsePathPoints(attributes.d ?? "", matrix);
        const compoundId = common.compoundId ?? nextEntityId();
        for (const parsed of subpaths) {
          if (parsed.points.length < 2) continue;
          entities.push(withBounds({
            ...commonEntity(layer, style),
            compoundId,
            type: "polyline",
            points: parsed.points,
            segments: parsed.segments,
            nodeTypes: parsed.nodeTypes,
            closed: parsed.closed,
          }));
        }
      }
    }
    if (entity) entities.push(withBounds(entity));
  }

  const titleMatch = source.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch?.[1]?.trim()) title = decodeXml(titleMatch[1].trim());
  const usedLayerIds = new Set(entities.map((entity) => entity.layerId));
  const usedLayers = [...layers.values()].filter((layer) => usedLayerIds.has(layer.id));
  return Object.freeze({
    title,
    units,
    layers: Object.freeze(usedLayers.length > 0 ? usedLayers : [defaultLayer]),
    entities: Object.freeze(entities),
  });
}

function styleAttributes(entity: Entity, layer: Layer): string {
  const stroke = entity.style.strokeColor ?? layer.color;
  const values = [
    `stroke="${escapeXml(stroke)}"`,
    `stroke-width="${format(entity.style.strokeWidth)}"`,
    `fill="${entity.style.fillColor ? escapeXml(entity.style.fillColor) : "none"}"`,
    "stroke-linecap=\"round\"",
    "stroke-linejoin=\"round\"",
  ];
  if (entity.compoundId) values.push(`data-vectora-compound-id="${escapeXml(entity.compoundId)}"`);
  if (entity.style.dashArray.length > 0) values.push(`stroke-dasharray="${entity.style.dashArray.map(format).join(" ")}"`);
  if (!entity.visible) values.push("visibility=\"hidden\"");
  return values.join(" ");
}

function entityToSvg(entity: Entity, layer: Layer, indent: string): string {
  const style = styleAttributes(entity, layer);
  switch (entity.type) {
    case "image": throw new Error("Bitmap images require native .vectora save or raster G-code output; this vector export cannot preserve them.");
    case "line":
      return `${indent}<line x1="${format(entity.start.x)}" y1="${format(-entity.start.y)}" x2="${format(entity.end.x)}" y2="${format(-entity.end.y)}" ${style} />`;
    case "polyline": {
      if (entity.segments?.some((segment) => segment.type !== "line")) {
        const first = entity.points[0];
        if (!first) return `${indent}<path d="" ${style} />`;
        const commands = [`M ${format(first.x)} ${format(-first.y)}`];
        const count = polylineSegmentCount(entity.points, entity.closed);
        for (let index = 0; index < count; index += 1) {
          const end = entity.points[(index + 1) % entity.points.length]!;
          const segment = getPolylineSegment(entity.segments, index);
          if (segment.type === "quadratic") {
            commands.push(`Q ${format(segment.cp1.x)} ${format(-segment.cp1.y)} ${format(end.x)} ${format(-end.y)}`);
          } else if (segment.type === "cubic") {
            commands.push(`C ${format(segment.cp1.x)} ${format(-segment.cp1.y)} ${format(segment.cp2.x)} ${format(-segment.cp2.y)} ${format(end.x)} ${format(-end.y)}`);
          } else {
            commands.push(`L ${format(end.x)} ${format(-end.y)}`);
          }
        }
        if (entity.closed) commands.push("Z");
        return `${indent}<path d="${commands.join(" ")}" ${style} />`;
      }
      const tag = entity.closed ? "polygon" : "polyline";
      const points = entity.points.map((point) => `${format(point.x)},${format(-point.y)}`).join(" ");
      return `${indent}<${tag} points="${points}" ${style} />`;
    }
    case "rectangle":
      return `${indent}<rect x="${format(entity.origin.x)}" y="${format(-(entity.origin.y + entity.height))}" width="${format(entity.width)}" height="${format(entity.height)}"${entity.cornerRadius > 0 ? ` rx="${format(entity.cornerRadius)}"` : ""} ${style} />`;
    case "circle":
      return `${indent}<circle cx="${format(entity.center.x)}" cy="${format(-entity.center.y)}" r="${format(entity.radius)}" ${style} />`;
    case "arc": {
      const start = {
        x: entity.center.x + Math.cos(entity.startAngle) * entity.radius,
        y: entity.center.y + Math.sin(entity.startAngle) * entity.radius,
      };
      const end = {
        x: entity.center.x + Math.cos(entity.endAngle) * entity.radius,
        y: entity.center.y + Math.sin(entity.endAngle) * entity.radius,
      };
      const normalized = (angle: number) => ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const sweep = entity.counterClockwise
        ? normalized(entity.startAngle - entity.endAngle)
        : normalized(entity.endAngle - entity.startAngle);
      const largeArc = sweep > Math.PI ? 1 : 0;
      const svgSweep = entity.counterClockwise ? 0 : 1;
      return `${indent}<path d="M ${format(start.x)} ${format(-start.y)} A ${format(entity.radius)} ${format(entity.radius)} 0 ${largeArc} ${svgSweep} ${format(end.x)} ${format(-end.y)}" data-vectora-type="arc" data-center-x="${format(entity.center.x)}" data-center-y="${format(-entity.center.y)}" data-start-x="${format(start.x)}" data-start-y="${format(-start.y)}" data-end-x="${format(end.x)}" data-end-y="${format(-end.y)}" data-counter-clockwise="${entity.counterClockwise}" ${style} />`;
    }
    case "ellipse":
      return `${indent}<ellipse cx="${format(entity.cx)}" cy="${format(-entity.cy)}" rx="${format(entity.rx)}" ry="${format(entity.ry)}" transform="rotate(${format((-entity.rotation * 180) / Math.PI)} ${format(entity.cx)} ${format(-entity.cy)})" ${style} />`;
    case "polygon":
    case "quadrant":
    case "semicircle":
    case "segment":
    case "star": {
      const points = entityToClosedPath(entity, { tolerance: 0.03 }) ?? [];
      const value = points.map((point) => `${format(point.x)},${format(-point.y)}`).join(" ");
      return `${indent}<polygon points="${value}" data-vectora-type="${entity.type}" ${style} />`;
    }
    case "cloud": {
      const first = entity.points[0];
      if (!first) return "";
      let cx = 0;
      let cy = 0;
      for (const point of entity.points) { cx += point.x; cy += point.y; }
      cx /= entity.points.length;
      cy /= entity.points.length;
      let data = `M ${format(first.x)} ${format(-first.y)}`;
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
        if (nx * (midX - cx) + ny * (midY - cy) < 0) { nx = -nx; ny = -ny; }
        const bulge = Math.min(entity.arcRadius, length / 2);
        data += ` Q ${format(midX + nx * bulge)} ${format(-(midY + ny * bulge))} ${format(end.x)} ${format(-end.y)}`;
      }
      return `${indent}<path d="${data} Z" data-vectora-type="cloud" ${style} />`;
    }
    case "text": {
      const fill = escapeXml(entity.style.fillColor ?? entity.style.strokeColor ?? layer.color);
      return `${indent}<text x="${format(entity.x)}" y="${format(-entity.y)}" font-family="${escapeXml(entity.fontFamily)}" font-size="${format(entity.fontSize)}" fill="${fill}" stroke="none"${entity.visible ? "" : " visibility=\"hidden\""} data-vectora-type="text" data-text="${escapeXml(entity.text)}">${escapeXml(entity.text)}</text>`;
    }
    case "dimension": {
      const geometry = getDimensionGeometry(entity);
      const stroke = escapeXml(entity.style.strokeColor ?? layer.color);
      const segments: string[] = [];
      if (geometry.extensionStart) segments.push(`<line x1="${format(geometry.extensionStart[0].x)}" y1="${format(-geometry.extensionStart[0].y)}" x2="${format(geometry.extensionStart[1].x)}" y2="${format(-geometry.extensionStart[1].y)}" />`);
      if (geometry.extensionEnd) segments.push(`<line x1="${format(geometry.extensionEnd[0].x)}" y1="${format(-geometry.extensionEnd[0].y)}" x2="${format(geometry.extensionEnd[1].x)}" y2="${format(-geometry.extensionEnd[1].y)}" />`);
      segments.push(`<line x1="${format(geometry.dimensionStart.x)}" y1="${format(-geometry.dimensionStart.y)}" x2="${format(geometry.dimensionEnd.x)}" y2="${format(-geometry.dimensionEnd.y)}" />`);
      for (const triangle of geometry.arrowheads) segments.push(`<polygon points="${triangle.map((point) => `${format(point.x)},${format(-point.y)}`).join(" ")}" fill="${stroke}" />`);
      const rotation = format((-geometry.textAngle * 180) / Math.PI);
      segments.push(`<text x="${format(entity.textPosition.x)}" y="${format(-entity.textPosition.y)}" text-anchor="middle" dominant-baseline="middle" font-family="JetBrains Mono, monospace" font-size="${format(entity.arrowSize * 2.7)}" transform="rotate(${rotation} ${format(entity.textPosition.x)} ${format(-entity.textPosition.y)})" fill="${stroke}" stroke="none">${escapeXml(formatDimensionText(entity))}</text>`);
      return `${indent}<g data-vectora-type="dimension" data-dimension-kind="${entity.dimensionKind}" data-start-x="${format(entity.startPoint.x)}" data-start-y="${format(-entity.startPoint.y)}" data-end-x="${format(entity.endPoint.x)}" data-end-y="${format(-entity.endPoint.y)}" data-text-x="${format(entity.textPosition.x)}" data-text-y="${format(-entity.textPosition.y)}" data-value="${format(entity.value)}" data-prefix="${escapeXml(entity.prefix)}" data-suffix="${escapeXml(entity.suffix)}" data-precision="${entity.precision}" data-arrow-size="${format(entity.arrowSize)}" ${style}>${segments.join("")}</g>`;
    }
    case "leader": {
      const stroke = escapeXml(entity.style.strokeColor ?? layer.color);
      const dx = entity.elbowPoint.x - entity.arrowPoint.x;
      const dy = entity.elbowPoint.y - entity.arrowPoint.y;
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length;
      const uy = dy / length;
      const nx = -uy;
      const ny = ux;
      const arrow = [
        entity.arrowPoint,
        { x: entity.arrowPoint.x + ux * 4 + nx * 1.52, y: entity.arrowPoint.y + uy * 4 + ny * 1.52 },
        { x: entity.arrowPoint.x + ux * 4 - nx * 1.52, y: entity.arrowPoint.y + uy * 4 - ny * 1.52 },
      ];
      return `${indent}<g data-vectora-type="leader" data-arrow-x="${format(entity.arrowPoint.x)}" data-arrow-y="${format(-entity.arrowPoint.y)}" data-elbow-x="${format(entity.elbowPoint.x)}" data-elbow-y="${format(-entity.elbowPoint.y)}" data-text-x="${format(entity.textPosition.x)}" data-text-y="${format(-entity.textPosition.y)}" data-text="${escapeXml(entity.text)}" ${style}><polyline points="${format(entity.arrowPoint.x)},${format(-entity.arrowPoint.y)} ${format(entity.elbowPoint.x)},${format(-entity.elbowPoint.y)} ${format(entity.textPosition.x)},${format(-entity.textPosition.y)}" fill="none"/><polygon points="${arrow.map((point) => `${format(point.x)},${format(-point.y)}`).join(" ")}" fill="${stroke}"/><text x="${format(entity.textPosition.x + 5)}" y="${format(-entity.textPosition.y)}" dominant-baseline="middle" font-family="JetBrains Mono, monospace" font-size="11" fill="${stroke}" stroke="none">${escapeXml(entity.text)}</text></g>`;
    }
  }
}

export function exportSvg(document: Readonly<CadDocument>, options: SvgExportOptions = {}): string {
  const entities = [...document.entities.values()];
  const padding = Math.max(0, options.padding ?? 10);
  const pretty = options.pretty ?? true;
  const separator = pretty ? "\n" : "";
  const indent = pretty ? "  " : "";
  const entityIndent = pretty ? "    " : "";
  let minX = 0;
  let minY = 0;
  let maxX = 100;
  let maxY = 100;
  if (entities.length > 0) {
    minX = Infinity;
    minY = Infinity;
    maxX = -Infinity;
    maxY = -Infinity;
    for (const entity of entities) {
      minX = Math.min(minX, entity.bbox.minX);
      minY = Math.min(minY, entity.bbox.minY);
      maxX = Math.max(maxX, entity.bbox.maxX);
      maxY = Math.max(maxY, entity.bbox.maxY);
    }
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;
  }
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const layers = [...document.layers].sort((left, right) => left.order - right.order);
  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${format(width)}${document.units}" height="${format(height)}${document.units}" viewBox="${format(minX)} ${format(-maxY)} ${format(width)} ${format(height)}" data-vectora-origin-x="${format(minX)}" data-vectora-origin-y="${format(-maxY)}">`,
    `${indent}<title>${escapeXml(document.title)}</title>`,
  ];
  for (const layer of layers) {
    const layerEntities = entities.filter((entity) => entity.layerId === layer.id);
    if (layerEntities.length === 0) continue;
    lines.push(`${indent}<g id="${escapeXml(layer.id)}" data-name="${escapeXml(layer.name)}" data-vectora-intent="${layer.intent}" stroke="${escapeXml(layer.color)}"${layer.visible ? "" : " visibility=\"hidden\""}>`);
    for (const entity of layerEntities) lines.push(entityToSvg(entity, layer, entityIndent));
    lines.push(`${indent}</g>`);
  }
  lines.push("</svg>");
  return lines.join(separator);
}
