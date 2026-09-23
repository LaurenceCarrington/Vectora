import { parse, type Font, type PathCommand } from "opentype.js";
import robotoFontUrl from "typeface-roboto/files/roboto-latin-400.woff?url";
import loraFontUrl from "typeface-lora/files/lora-latin-400.woff?url";
import robotoMonoFontUrl from "typeface-roboto-mono/files/roboto-mono-latin-400.woff?url";
import { calculateEntityBounds } from "../../document/DocumentModel";
import type { Point2D, PolylineEntity, TextEntity } from "../../document/types";

export const TEXT_FONT_FAMILIES = ["Roboto", "Lora", "Roboto Mono"] as const;
export type TextFontFamily = typeof TEXT_FONT_FAMILIES[number];

const FONT_URLS: Readonly<Record<TextFontFamily, string>> = Object.freeze({
  Roboto: robotoFontUrl,
  Lora: loraFontUrl,
  "Roboto Mono": robotoMonoFontUrl,
});
const fontCache = new Map<TextFontFamily, Promise<Font>>();
let contourSequence = 0;

export interface TextToPathOptions {
  /** Maximum curve-to-polyline deviation target in document units. */
  readonly curveTolerance?: number;
  /** Test/advanced caller injection; skips bundled-font loading. */
  readonly font?: Font;
}

function supportedFamily(fontFamily: string): TextFontFamily {
  return (TEXT_FONT_FAMILIES as readonly string[]).includes(fontFamily)
    ? fontFamily as TextFontFamily
    : "Roboto";
}

async function loadBundledFont(family: TextFontFamily): Promise<Font> {
  const existing = fontCache.get(family);
  if (existing) return existing;
  const loading = fetch(FONT_URLS[family])
    .then(async (response) => {
      if (!response.ok) throw new Error(`Could not load ${family} (${response.status}).`);
      return parse(await response.arrayBuffer());
    })
    .catch((error: unknown) => {
      fontCache.delete(family);
      throw error;
    });
  fontCache.set(family, loading);
  return loading;
}

function samePoint(left: Point2D, right: Point2D, epsilon = 1e-7): boolean {
  return Math.hypot(left.x - right.x, left.y - right.y) <= epsilon;
}

function signedArea(points: readonly Point2D[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function cubicPoint(start: Point2D, control1: Point2D, control2: Point2D, end: Point2D, t: number): Point2D {
  const inverse = 1 - t;
  const a = inverse * inverse * inverse;
  const b = 3 * inverse * inverse * t;
  const c = 3 * inverse * t * t;
  const d = t * t * t;
  return {
    x: a * start.x + b * control1.x + c * control2.x + d * end.x,
    y: a * start.y + b * control1.y + c * control2.y + d * end.y,
  };
}

function quadraticPoint(start: Point2D, control: Point2D, end: Point2D, t: number): Point2D {
  const inverse = 1 - t;
  return {
    x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
    y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y,
  };
}

function subdivisionCount(points: readonly Point2D[], tolerance: number): number {
  let controlLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    controlLength += Math.hypot(points[index]!.x - points[index - 1]!.x, points[index]!.y - points[index - 1]!.y);
  }
  return Math.max(4, Math.min(64, Math.ceil(Math.sqrt(controlLength / tolerance) * 2)));
}

function flattenCommands(
  commands: readonly PathCommand[],
  origin: Point2D,
  tolerance: number,
): readonly (readonly Point2D[])[] {
  const contours: Point2D[][] = [];
  let current: Point2D[] = [];
  let cursor: Point2D | null = null;
  const worldPoint = (x: number, y: number): Point2D => ({ x: origin.x + x, y: origin.y - y });
  const finishContour = (closed: boolean): void => {
    if (!closed || current.length < 3) {
      current = [];
      cursor = null;
      return;
    }
    if (samePoint(current[0]!, current.at(-1)!)) current.pop();
    if (current.length >= 3 && Math.abs(signedArea(current)) > 1e-9) contours.push(current);
    current = [];
    cursor = null;
  };

  for (const command of commands) {
    switch (command.type) {
      case "M":
        // Some OpenType implementations delimit glyph contours with a new M
        // rather than emitting Z. Font outlines are closed by definition, so
        // the previous contour is safely sealed at this boundary.
        if (current.length > 0) finishContour(true);
        cursor = worldPoint(command.x, command.y);
        current = [cursor];
        break;
      case "L": {
        const end = worldPoint(command.x, command.y);
        if (!cursor) current.push(end);
        else if (!samePoint(cursor, end)) current.push(end);
        cursor = end;
        break;
      }
      case "Q": {
        const start = cursor;
        const control = worldPoint(command.x1, command.y1);
        const end = worldPoint(command.x, command.y);
        if (!start) {
          current.push(end);
          cursor = end;
          break;
        }
        const count = subdivisionCount([start, control, end], tolerance);
        for (let step = 1; step <= count; step += 1) current.push(quadraticPoint(start, control, end, step / count));
        cursor = end;
        break;
      }
      case "C": {
        const start = cursor;
        const control1 = worldPoint(command.x1, command.y1);
        const control2 = worldPoint(command.x2, command.y2);
        const end = worldPoint(command.x, command.y);
        if (!start) {
          current.push(end);
          cursor = end;
          break;
        }
        const count = subdivisionCount([start, control1, control2, end], tolerance);
        for (let step = 1; step <= count; step += 1) current.push(cubicPoint(start, control1, control2, end, step / count));
        cursor = end;
        break;
      }
      case "Z":
        finishContour(true);
        break;
    }
  }
  if (current.length > 0) finishContour(true);
  return contours;
}

/**
 * Destructively-convertible text outline. Each glyph boundary (including
 * counters such as the centre of O) becomes its own closed entity; the shared
 * topology engine reconstructs hole relationships from containment.
 */
export async function convertTextToPaths(
  entity: TextEntity,
  options: TextToPathOptions = {},
): Promise<PolylineEntity[]> {
  if (!entity.text.length) return [];
  const font = options.font ?? await loadBundledFont(supportedFamily(entity.fontFamily));
  const tolerance = Math.max(0.001, options.curveTolerance ?? Math.max(0.01, entity.fontSize / 1_000));
  const commands = font.getPath(entity.text, 0, 0, entity.fontSize).commands;
  const contours = flattenCommands(commands, { x: entity.x, y: entity.y }, tolerance);

  return contours.map((points, index) => {
    const candidate: PolylineEntity = {
      id: `text-path-${Date.now().toString(36)}-${(contourSequence += 1).toString(36)}`,
      name: `${entity.name?.trim() || "Text"} contour ${index + 1}`,
      type: "polyline",
      layerId: entity.layerId,
      intent: entity.intent,
      style: {
        ...entity.style,
        fillColor: null,
        dashArray: [...entity.style.dashArray],
      },
      bbox: entity.bbox,
      visible: entity.visible,
      locked: false,
      points: points.map((point) => ({ x: point.x, y: point.y })),
      closed: true,
    };
    return { ...candidate, bbox: calculateEntityBounds(candidate) };
  });
}
