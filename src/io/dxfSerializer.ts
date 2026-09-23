import { calculateEntityBounds } from "../document/DocumentModel";
import type {
  CadDocument,
  DocumentUnits,
  Entity,
  Layer,
  ManufacturingIntent,
  Point2D,
  PolylineEntity,
} from "../document/types";
import { flattenPolyline, getPolylineSegment, polylineSegmentCount, segmentAsCubic, transformPolylineSegments } from "../geometry/bezier";
import { entityToClosedPath } from "../geometry/operations/pathConversion";
import { calculateDimensionValue, formatDimensionText, getDimensionGeometry } from "../geometry/annotations";

import { bulgeToArc, splineToBezier } from "./dxfGeometry";

export interface DxfImportResult {
  readonly warnings: readonly string[];
  readonly title: string;
  readonly units: DocumentUnits;
  readonly layers: readonly Layer[];
  readonly entities: readonly Entity[];
}

export interface DxfExportOptions {
  readonly version?: "R12" | "R14";
  readonly onWarning?: (message: string) => void;
  /** Export assembly metadata, compound operands and imported INSERT groups as blocks. */
  readonly blocks?: boolean;
}

type DxfPair = { readonly code: number; readonly value: string };
type DxfBlock = { readonly type: string; readonly pairs: readonly DxfPair[] };

const EMPTY_BOUNDS = { minX: 0, minY: 0, maxX: 0, maxY: 0 } as const;
const ACI_HEX: Readonly<Record<number, string>> = {
  1: "#ff0000",
  2: "#ffff00",
  3: "#00ff00",
  4: "#00ffff",
  5: "#0000ff",
  6: "#ff00ff",
  7: "#ffffff",
  8: "#808080",
  9: "#c0c0c0",
};
let dxfSequence = 0;

function nextEntityId(): string {
  dxfSequence += 1;
  return globalThis.crypto?.randomUUID?.() ?? `dxf-${Date.now().toString(36)}-${dxfSequence}`;
}

function format(value: number): string {
  if (!Number.isFinite(value)) throw new Error("DXF export encountered a non-finite coordinate.");
  return Object.is(value, -0) ? "0" : value.toString();
}

function pair(code: number, value: string | number): string {
  return `${code}\n${value}\n`;
}

function layerName(layer: Layer): string {
  return (layer.name.trim() || layer.id).replace(/[<>/\\":;?*|=,]/g, "-");
}

function degrees(radians: number): number {
  const value = (radians * 180) / Math.PI;
  return ((value % 360) + 360) % 360;
}

function lineEntity(layer: string, start: Point2D, end: Point2D): string {
  return pair(0, "LINE") + pair(8, layer) + pair(10, format(start.x)) + pair(20, format(start.y)) +
    pair(30, 0) + pair(11, format(end.x)) + pair(21, format(end.y)) + pair(31, 0);
}

function polylineEntity(
  layer: string,
  points: readonly Point2D[],
  closed: boolean,
  version: "R12" | "R14",
): string {
  if (version === "R12") {
    let result = pair(0, "POLYLINE") + pair(8, layer) + pair(66, 1) + pair(70, closed ? 1 : 0);
    for (const point of points) {
      result += pair(0, "VERTEX") + pair(8, layer) + pair(10, format(point.x)) +
        pair(20, format(point.y)) + pair(30, 0);
    }
    return result + pair(0, "SEQEND") + pair(8, layer);
  }
  let result = pair(0, "LWPOLYLINE") + pair(8, layer) + pair(90, points.length) + pair(70, closed ? 1 : 0);
  for (const point of points) result += pair(10, format(point.x)) + pair(20, format(point.y));
  return result;
}

function safeDxfText(value: string): string {
  return value.replace(/[\r\n]+/g, " ").slice(0, 255);
}

function dimensionEntity(entity: Extract<Entity, { type: "dimension" }>, layer: string): string {
  const typeCode = entity.dimensionKind === "linear" ? 0
    : entity.dimensionKind === "aligned" ? 1
      : entity.dimensionKind === "diameter" ? 3 : 4;
  const geometry = getDimensionGeometry(entity);
  const definition = typeCode === 4 ? entity.startPoint : typeCode === 3
    ? { x: 2 * entity.startPoint.x - entity.endPoint.x, y: 2 * entity.startPoint.y - entity.endPoint.y }
    : geometry.dimensionEnd;
  return pair(0, "DIMENSION") + pair(8, layer) + pair(2, `*D_${entity.id}`) +
    pair(10, format(definition.x)) + pair(20, format(definition.y)) + pair(30, 0) +
    pair(11, format(entity.textPosition.x)) + pair(21, format(entity.textPosition.y)) + pair(31, 0) +
    pair(13, format(entity.startPoint.x)) + pair(23, format(entity.startPoint.y)) + pair(33, 0) +
    pair(14, format(entity.endPoint.x)) + pair(24, format(entity.endPoint.y)) + pair(34, 0) +
    pair(15, format(entity.endPoint.x)) + pair(25, format(entity.endPoint.y)) + pair(35, 0) +
    pair(50, format(degrees(geometry.textAngle))) + pair(40, 0) +
    pair(42, format(entity.value)) + pair(70, typeCode | 32 | 128) + pair(1, "<>") +
    pair(3, `VD_${entity.id}`) + pair(1001, "VECTORA") +
    pair(1000, safeDxfText(entity.prefix)) + pair(1000, safeDxfText(entity.suffix)) + pair(1070, entity.precision);
}

function leaderEntity(entity: Extract<Entity, { type: "leader" }>, layer: string): string {
  return pair(0, "LEADER") + pair(8, layer) + pair(3, "STANDARD") + pair(71, 1) +
    pair(72, 0) + pair(73, 3) + pair(76, 3) +
    pair(10, format(entity.arrowPoint.x)) + pair(20, format(entity.arrowPoint.y)) + pair(30, 0) +
    pair(10, format(entity.elbowPoint.x)) + pair(20, format(entity.elbowPoint.y)) + pair(30, 0) +
    pair(10, format(entity.textPosition.x)) + pair(20, format(entity.textPosition.y)) + pair(30, 0) +
    pair(1001, "VECTORA") + pair(1000, safeDxfText(entity.text));
}

function entityToDxf(entity: Entity, dxfLayerName: string, version: "R12" | "R14"): string {
  switch (entity.type) {
    case "image": throw new Error("Bitmap images require native .vectora save or raster G-code output; this vector export cannot preserve them.");
    case "line":
      return lineEntity(dxfLayerName, entity.start, entity.end);
    case "polyline":
      return version === "R14" && entity.segments?.some(s => s.type !== "line")
        ? splineEntity(entity, dxfLayerName)
        : polylineEntity(dxfLayerName, flattenPolyline(entity), entity.closed, version);
    case "rectangle": {
      const x = entity.origin.x;
      const y = entity.origin.y;
      return polylineEntity(dxfLayerName, [
        { x, y },
        { x: x + entity.width, y },
        { x: x + entity.width, y: y + entity.height },
        { x, y: y + entity.height },
      ], true, version);
    }
    case "circle":
      return pair(0, "CIRCLE") + pair(8, dxfLayerName) + pair(10, format(entity.center.x)) +
        pair(20, format(entity.center.y)) + pair(30, 0) + pair(40, format(entity.radius));
    case "arc": {
      // DXF ARC always travels counter-clockwise. Vectora's counterClockwise
      // flag follows Canvas arc semantics, so decreasing arcs swap endpoints.
      const start = entity.counterClockwise ? entity.endAngle : entity.startAngle;
      const end = entity.counterClockwise ? entity.startAngle : entity.endAngle;
      return pair(0, "ARC") + pair(8, dxfLayerName) + pair(10, format(entity.center.x)) +
        pair(20, format(entity.center.y)) + pair(30, 0) + pair(40, format(entity.radius)) +
        pair(50, format(degrees(start))) + pair(51, format(degrees(end)));
    }
    case "text":
      return pair(0, "TEXT") + pair(8, dxfLayerName) +
        pair(10, format(entity.x)) + pair(20, format(entity.y)) + pair(30, 0) +
        pair(40, format(entity.fontSize)) + pair(1, safeDxfText(entity.text)) +
        pair(7, safeDxfText(entity.fontFamily));
    case "dimension":
      return dimensionEntity(entity, dxfLayerName);
    case "leader":
      return leaderEntity(entity, dxfLayerName);
    case "ellipse":
    case "polygon":
    case "quadrant":
    case "semicircle":
    case "segment":
    case "star":
    case "cloud": {
      const points = entityToClosedPath(entity, { tolerance: 0.05 });
      return points ? polylineEntity(dxfLayerName, points, true, version) : "";
    }
  }
}

function parsePairs(source: string, warn?: (message: string) => void): readonly DxfPair[] {
  const lines = source.replace(/\r/g, "").split("\n");
  const pairs: DxfPair[] = [];
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const rawCode = lines[index]?.trim() ?? "";
    const code = Number(rawCode);
    if (!/^\d+$/.test(rawCode) || !Number.isInteger(code) || code > 1071) {
      warn?.("Invalid DXF group-code lines were skipped. Repair or re-export the ASCII DXF and verify the imported geometry.");
      continue;
    }
    const value = lines[index + 1] ?? "";
    pairs.push({ code, value: [1, 3, 1000].includes(code) ? value : value.trim() });
  }
  return pairs;
}

function blocksFromPairs(pairs: readonly DxfPair[]): readonly DxfBlock[] {
  const blocks: DxfBlock[] = [];
  let current: { type: string; pairs: DxfPair[] } | null = null;
  for (const item of pairs) {
    if (item.code === 0) {
      if (current) blocks.push(current);
      current = { type: item.value.toUpperCase(), pairs: [] };
    } else if (current) current.pairs.push(item);
  }
  if (current) blocks.push(current);
  return blocks;
}

function first(block: DxfBlock, code: number, fallback = ""): string {
  return block.pairs.find((item) => item.code === code)?.value ?? fallback;
}

function numeric(block: DxfBlock, code: number, fallback = 0): number {
  const raw = first(block, code);
  if (raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Invalid numeric group ${code}; repair the record in the source CAD application.`);
  return value;
}

function intentFromAci(index: number, name: string): ManufacturingIntent {
  const normalized = name.toLowerCase();
  if (normalized.includes("engrave") || index === 5) return "engrave";
  if (normalized.includes("score") || index === 3) return "score";
  if (normalized.includes("construction") || index === 8) return "construction";
  return "cut";
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "imported";
}

function parseLayerBlocks(blocks: readonly DxfBlock[]): Map<string, Layer> {
  const layers = new Map<string, Layer>();
  for (const block of blocks) {
    if (block.type !== "LAYER") continue;
    const name = first(block, 2, "Imported");
    const signedAci = numeric(block, 62, 7);
    const aci = Math.abs(signedAci);
    const baseId = safeId(name);
    let id = baseId;
    let suffix = 2;
    while ([...layers.values()].some((layer) => layer.id === id)) id = `${baseId}-${suffix++}`;
    layers.set(name, {
      id,
      name,
      intent: intentFromAci(aci, name),
      color: ACI_HEX[aci] ?? "#64748b",
      visible: signedAci >= 0,
      locked: false,
      order: layers.size,
    });
  }
  return layers;
}

function ensureLayer(layers: Map<string, Layer>, name: string): Layer {
  const existing = layers.get(name);
  if (existing) return existing;
  const baseId = safeId(name);
  let id = baseId;
  let suffix = 2;
  while ([...layers.values()].some((layer) => layer.id === id)) id = `${baseId}-${suffix++}`;
  const layer: Layer = {
    id,
    name,
    intent: intentFromAci(7, name),
    color: "#64748b",
    visible: true,
    locked: false,
    order: layers.size,
  };
  layers.set(name, layer);
  return layer;
}

function common(layer: Layer) {
  return {
    id: nextEntityId(),
    layerId: layer.id,
    intent: layer.intent,
    style: { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] },
    bbox: EMPTY_BOUNDS,
    visible: true,
    locked: false,
  } as const;
}

function withBounds(entity: Entity): Entity {
  return { ...entity, bbox: calculateEntityBounds(entity) };
}

function splineEntity(entity: PolylineEntity, layer: string): string {
  const count = polylineSegmentCount(entity.points, entity.closed);
  if (!count) return "";
  const controls: Point2D[] = [entity.points[0]!];
  const knots = [0, 0, 0, 0];
  for (let i = 0; i < count; i++) {
    const end = entity.points[(i + 1) % entity.points.length]!;
    const cubic = segmentAsCubic(getPolylineSegment(entity.segments, i), entity.points[i]!, end);
    controls.push(cubic.cp1, cubic.cp2, end);
    knots.push(i + 1, i + 1, i + 1);
  }
  knots.push(count);
  return pair(0, "SPLINE") + pair(8, layer) + pair(70, entity.closed ? 9 : 8) + pair(71, 3) +
    pair(72, knots.length) + pair(73, controls.length) + pair(74, 0) +
    knots.map(k => pair(40, format(k))).join("") +
    controls.map(p => pair(10, format(p.x)) + pair(20, format(p.y)) + pair(30, 0)).join("");
}

function aciColor(aci: number): string {
  if (ACI_HEX[aci]) return ACI_HEX[aci]!;
  if (aci >= 250) return ["#333333", "#505050", "#696969", "#828282", "#bebebe", "#ffffff"][aci - 250] ?? "#ffffff";
  // Standard ACI wheel: 24 hues, five brightness levels, each with a tint.
  const hue = Math.floor((aci - 10) / 10) / 4;
  const shade = (aci - 10) % 10;
  const v = [255, 165, 127, 76, 38][Math.floor(shade / 2)] ?? 255;
  const low = shade % 2 ? v / 2 : 0;
  const x = low + (v - low) * (1 - Math.abs(hue % 2 - 1));
  const rgb = hue < 1 ? [v, x, low] : hue < 2 ? [x, v, low] : hue < 3 ? [low, v, x]
    : hue < 4 ? [low, x, v] : hue < 5 ? [x, low, v] : [v, low, x];
  return `#${rgb.map(n => Math.floor(n).toString(16).padStart(2, "0")).join("")}`;
}

function nearestAci(color: string): number {
  if (!/^#[\da-f]{6}$/i.test(color)) return 7;
  const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
  let best = 7;
  let distance = Infinity;
  for (let i = 1; i <= 255; i++) {
    const candidate = aciColor(i);
    const d = [1, 3, 5].reduce((sum, offset, j) => sum + (parseInt(candidate.slice(offset, offset + 2), 16) - rgb[j]!) ** 2, 0);
    if (d < distance) { distance = d; best = i; }
  }
  return best;
}

function xdata(block: DxfBlock, app: string): readonly DxfPair[] {
  const start = block.pairs.findIndex(p => p.code === 1001 && p.value === app);
  if (start < 0) return [];
  const end = block.pairs.findIndex((p, i) => i > start && p.code === 1001);
  return block.pairs.slice(start + 1, end < 0 ? undefined : end);
}

function storedIntent(block: DxfBlock, fallback: ManufacturingIntent): ManufacturingIntent {
  const value = xdata(block, "VECTORA_STYLE").find(p => p.code === 1000)?.value;
  return value === "cut" || value === "engrave" || value === "score" || value === "pocket" || value === "construction" ? value : fallback;
}

/** Adds handles, owners and R14 subclass markers in the required record order. */
function finishDxf(source: string, version: "R12" | "R14"): string {
  if (version === "R12") return source;
  const records = blocksFromPairs(parsePairs(source));
  let handle = 0x100;
  const handles = new Map<DxfBlock, string>();
  for (const r of records) if (!["SECTION", "ENDSEC", "EOF", "ENDTAB"].includes(r.type)) handles.set(r, (handle++).toString(16).toUpperCase());
  const blockHandles = new Map(records.filter(r => r.type === "BLOCK_RECORD").map(r => [first(r, 2), handles.get(r)!]));
  const styleHandle = handles.get(records.find(r => r.type === "STYLE")!);
  const subclasses: Record<string, string> = { LINE: "AcDbLine", CIRCLE: "AcDbCircle", ARC: "AcDbCircle", LWPOLYLINE: "AcDbPolyline", SPLINE: "AcDbSpline", TEXT: "AcDbText", LEADER: "AcDbLeader", INSERT: "AcDbBlockReference", SOLID: "AcDbTrace", BLOCK: "AcDbBlockBegin", ENDBLK: "AcDbBlockEnd" };
  const tableClasses: Record<string, string> = { LAYER: "AcDbLayerTableRecord", LTYPE: "AcDbLinetypeTableRecord", STYLE: "AcDbTextStyleTableRecord", APPID: "AcDbRegAppTableRecord", DIMSTYLE: "AcDbDimStyleTableRecord", BLOCK_RECORD: "AcDbBlockTableRecord" };
  let section = "";
  let tableHandle = "0";
  let owner = blockHandles.get("*Model_Space") ?? "0";
  return records.map(r => {
    if (r.type === "SECTION") section = first(r, 2);
    if (r.type === "TABLE") tableHandle = handles.get(r)!;
    if (r.type === "BLOCK") owner = blockHandles.get(first(r, 2)) ?? "0";
    if (section === "ENTITIES") owner = blockHandles.get("*Model_Space") ?? "0";
    let result = pair(0, r.type);
    if (!handles.has(r)) return result + r.pairs.map(p => pair(p.code, p.value)).join("");
    result += pair(r.type === "DIMSTYLE" ? 105 : 5, handles.get(r)!);
    if (r.type === "TABLE") return pair(0, "TABLE") + pair(2, first(r, 2)) + pair(5, handles.get(r)!) + pair(330, 0) + pair(100, "AcDbSymbolTable") + pair(70, numeric(r, 70)) + (first(r, 2) === "DIMSTYLE" ? pair(100, "AcDbDimStyleTable") : "");
    if (section === "TABLES") return result + pair(330, tableHandle) + pair(100, "AcDbSymbolTableRecord") + pair(100, tableClasses[r.type] ?? "AcDbSymbolTableRecord") + r.pairs.map(p => pair(p.code, p.value)).join("") + (r.type === "DIMSTYLE" && styleHandle ? pair(340, styleHandle) : "");
    result += pair(330, owner) + pair(100, "AcDbEntity");
    const commonCodes = new Set([8, 6, 62, 60, 48]);
    const commonPairs = r.pairs.filter(p => commonCodes.has(p.code));
    result += commonPairs.map(p => pair(p.code, p.value)).join("");
    const rest = r.pairs.filter(p => !commonCodes.has(p.code));
    if (r.type === "DIMENSION") {
      const type = numeric(r, 70) & 7;
      const specialized = new Set([13, 23, 33, 14, 24, 34, 15, 25, 35, 50, 40]);
      result += pair(100, "AcDbDimension");
      result += rest.filter(p => !specialized.has(p.code) && p.code < 1000).map(p => pair(p.code, p.value)).join("");
      result += pair(100, type === 3 ? "AcDbDiametricDimension" : type === 4 ? "AcDbRadialDimension" : "AcDbAlignedDimension");
      result += rest.filter(p => specialized.has(p.code) && (type >= 3 ? [15, 25, 35, 40].includes(p.code) : [13, 23, 33, 14, 24, 34, 50].includes(p.code))).map(p => pair(p.code, p.value)).join("");
      if (type === 0) result += pair(100, "AcDbRotatedDimension");
      return result + rest.filter(p => p.code >= 1000).map(p => pair(p.code, p.value)).join("");
    }
    result += pair(100, subclasses[r.type] ?? "AcDbEntity");
    for (const p of rest) {
      if (r.type === "ARC" && p.code === 50) result += pair(100, "AcDbArc");
      if (r.type === "TEXT" && p.code === 1001) result += pair(100, "AcDbText");
      result += pair(p.code, p.value);
    }
    if (r.type === "TEXT" && !rest.some(p => p.code === 1001)) result += pair(100, "AcDbText");
    return result;
  }).join("");
}

export function exportDxf(document: Readonly<CadDocument>, options: DxfExportOptions = {}): string {
  const version = options.version ?? "R14";
  const layers = [...document.layers].sort((a, b) => a.order - b.order);
  const names = new Map<string, string>();
  const used = new Set<string>();
  for (const layer of layers) {
    const root = safeDxfText(layerName(layer));
    let name = root; let n = 2;
    while (used.has(name.toUpperCase())) name = `${root.slice(0, 240)}_${n++}`;
    used.add(name.toUpperCase()); names.set(layer.id, name);
  }
  const lineTypes = new Map<string, readonly number[]>([["CONTINUOUS", []]]);
  for (const layer of layers) if (layer.dxfLineType) lineTypes.set(layer.dxfLineType, layer.dxfDashPattern ?? []);
  const styleNames = new Map<string, string>();
  const visible = [...document.entities.values()].filter(e => e.visible).map((e, i) => e.type === "dimension" ? { ...e, id: `${i + 1}` } : e);
  for (const e of visible) {
    if (e.style.dashArray.length) {
      const key = JSON.stringify(e.style.dashArray);
      if (!styleNames.has(key)) {
        let name = `VECTORA_DASH_${styleNames.size + 1}`;
        while (lineTypes.has(name)) name += "_";
        styleNames.set(key, name);
        lineTypes.set(name, e.style.dashArray.map((d, i) => i % 2 ? -d : d));
      }
    }
  }
  const wrapBlock = (name: string, content: string) => pair(0, "BLOCK") + pair(8, "0") + pair(2, name) + pair(70, name.startsWith("*D") ? 1 : 0) + pair(10, 0) + pair(20, 0) + pair(30, 0) + pair(3, name) + pair(1, "") + content + pair(0, "ENDBLK") + pair(8, "0");
  const definitions = new Map<string, string>([["*Model_Space", ""], ["*Paper_Space", ""]]);
  const groups = new Map<string, { name: string; entities: Entity[] }>();
  const standalone: Entity[] = [];
  for (const e of visible) {
    const group = options.blocks === false ? undefined : e.metadata?.assemblyId ?? e.dxfGroup ?? e.compoundId;
    if (group) {
      let entry = groups.get(group);
      if (!entry) { entry = { name: `VECTORA_${groups.size + 1}_${safeId(group).slice(0, 100)}`, entities: [] }; groups.set(group, entry); }
      entry.entities.push(e);
    } else standalone.push(e);
  }
  const emit = (e: Entity) => {
    if (version === "R12" && e.type === "polyline" && e.segments?.some(s => s.type !== "line")) options.onWarning?.("R12 export approximates Bézier curves with line segments. Choose R14 to retain native SPLINEs.");
    const layer = names.get(e.layerId) ?? "0";
    const aci = e.style.strokeColor ? nearestAci(e.style.strokeColor) : 256;
    const ltype = e.style.dashArray.length ? styleNames.get(JSON.stringify(e.style.dashArray))! : "CONTINUOUS";
    const raw = entityToDxf(e, layer, version);
    // Style belongs on the parent record, before any subclass geometry/XDATA.
    const firstEnd = raw.indexOf("\n", raw.indexOf("\n") + 1) + 1;
    if (!raw) return "";
    const custom = pair(1001, "VECTORA_STYLE") + pair(1000, e.intent) + pair(1000, e.style.strokeColor ?? "") + pair(1040, format(e.style.strokeWidth));
    if (version === "R12" && raw.startsWith("0\nPOLYLINE\n")) {
      const vertex = raw.indexOf("0\nVERTEX\n");
      return raw.slice(0, firstEnd) + pair(62, aci) + pair(6, ltype) + raw.slice(firstEnd, vertex) + custom + raw.slice(vertex);
    }
    return raw.slice(0, firstEnd) + pair(62, aci) + pair(6, ltype) + raw.slice(firstEnd) + custom;
  };
  for (const { name, entities } of groups.values()) definitions.set(name, entities.map(emit).join(""));
  const dimensions = visible.filter((e): e is Extract<Entity, { type: "dimension" }> => e.type === "dimension");
  for (const d of dimensions) {
    const g = getDimensionGeometry(d);
    let content = lineEntity("0", g.dimensionStart, g.dimensionEnd);
    for (const extension of [g.extensionStart, g.extensionEnd]) if (extension) content += lineEntity("0", extension[0], extension[1]);
    for (const triangle of g.arrowheads) content += pair(0, "SOLID") + pair(8, "0") + [triangle[0], triangle[1], triangle[2], triangle[2]].map((p, i) => pair(10 + i, format(p!.x)) + pair(20 + i, format(p!.y)) + pair(30 + i, 0)).join("");
    content += pair(0, "TEXT") + pair(8, "0") + pair(10, format(d.textPosition.x)) + pair(20, format(d.textPosition.y)) + pair(30, 0) + pair(40, format(d.arrowSize)) + pair(1, safeDxfText(formatDimensionText(d))) + pair(7, "STANDARD") + pair(50, format(degrees(g.textAngle))) + pair(72, 1) + pair(11, format(d.textPosition.x)) + pair(21, format(d.textPosition.y)) + pair(31, 0);
    definitions.set(`*D_${d.id}`, content);
  }
  const units = document.units === "mm" ? 4 : document.units === "in" ? 1 : 0;
  let output = pair(0, "SECTION") + pair(2, "HEADER") + pair(9, "$ACADVER") + pair(1, version === "R14" ? "AC1014" : "AC1009") + pair(9, "$INSUNITS") + pair(70, units) + pair(9, "$MEASUREMENT") + pair(70, document.units === "in" ? 0 : 1) + pair(9, "$DIMASZ") + pair(40, 4) + pair(9, "$DIMTXT") + pair(40, 4) + pair(9, "$DIMDEC") + pair(70, 2) + pair(9, "$LUNITS") + pair(70, 2) + pair(9, "$LUPREC") + pair(70, 8) + pair(0, "ENDSEC");
  output += pair(0, "SECTION") + pair(2, "TABLES");
  const table = (name: string, rows: readonly string[]) => pair(0, "TABLE") + pair(2, name) + pair(70, rows.length) + rows.join("") + pair(0, "ENDTAB");
  output += table("LTYPE", [...lineTypes].map(([name, pattern]) => pair(0, "LTYPE") + pair(2, safeDxfText(name)) + pair(70, 0) + pair(3, "") + pair(72, 65) + pair(73, pattern.length) + pair(40, format(pattern.reduce((s, d) => s + Math.abs(d), 0))) + pattern.map(d => pair(49, format(d)) + (version === "R14" ? pair(74, 0) : "")).join("")));
  const layerRows = layers.map(l => pair(0, "LAYER") + pair(2, names.get(l.id)!) + pair(70, l.locked ? 4 : 0) + pair(62, (l.visible ? 1 : -1) * (l.dxfAci && aciColor(l.dxfAci).toLowerCase() === l.color.toLowerCase() ? l.dxfAci : nearestAci(l.color))) + pair(6, safeDxfText(l.dxfLineType ?? "CONTINUOUS")) + pair(1001, "VECTORA_STYLE") + pair(1000, l.intent) + pair(1000, l.color));
  if (!used.has("0")) layerRows.unshift(pair(0, "LAYER") + pair(2, "0") + pair(70, 0) + pair(62, 7) + pair(6, "CONTINUOUS"));
  output += table("LAYER", layerRows);
  const fonts = new Set(["STANDARD", ...visible.filter(e => e.type === "text").map(e => safeDxfText(e.fontFamily))]);
  output += table("STYLE", [...fonts].map(name => pair(0, "STYLE") + pair(2, name) + pair(70, 0) + pair(40, 0) + pair(41, 1) + pair(50, 0) + pair(71, 0) + pair(42, 4) + pair(3, "txt") + pair(4, "")));
  output += table("APPID", ["VECTORA", "VECTORA_STYLE"].map(name => pair(0, "APPID") + pair(2, name) + pair(70, 0)));
  const dimstyle = (name: string, size: number, precision: number, post = "<>") => pair(0, "DIMSTYLE") + pair(2, name) + pair(70, 0) + pair(3, safeDxfText(post)) + pair(40, 1) + pair(41, format(size)) + pair(42, 0) + pair(44, format(size * 0.55)) + pair(140, format(size)) + pair(144, 1) + pair(147, format(size * 0.25)) + pair(77, 0) + pair(78, 0) + pair(271, precision) + pair(277, 2);
  output += table("DIMSTYLE", [dimstyle("STANDARD", 4, 2), ...dimensions.map(d => dimstyle(`VD_${d.id}`, d.arrowSize, d.precision, `${d.prefix}<>${d.suffix}`))]);
  if (version === "R14") output += table("BLOCK_RECORD", [...definitions.keys()].map(name => pair(0, "BLOCK_RECORD") + pair(2, name)));
  output += pair(0, "ENDSEC") + pair(0, "SECTION") + pair(2, "BLOCKS");
  for (const [name, content] of definitions) output += wrapBlock(name, content);
  output += pair(0, "ENDSEC") + pair(0, "SECTION") + pair(2, "ENTITIES") + standalone.map(emit).join("");
  for (const { name } of groups.values()) output += pair(0, "INSERT") + pair(8, "0") + pair(2, name) + pair(10, 0) + pair(20, 0) + pair(30, 0) + pair(41, 1) + pair(42, 1) + pair(43, 1) + pair(50, 0);
  return finishDxf(output + pair(0, "ENDSEC") + pair(0, "EOF"), version);
}

export interface DxfImportOptions {
  /** Omit to retain inches/mm; other physical DXF units normalize to mm. */
  readonly units?: DocumentUnits;
}

type Matrix = readonly [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
function pointAt(m: Matrix, p: Point2D): Point2D { return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }; }
function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}

function transformImported(entity: Entity, m: Matrix, warn: (message: string) => void): Entity {
  const p = (point: Point2D) => pointAt(m, point);
  const sx = Math.hypot(m[0], m[1]);
  const sy = Math.hypot(m[2], m[3]);
  const uniform = Math.abs(sx - sy) <= 1e-10 * Math.max(sx, sy) && Math.abs(m[0] * m[2] + m[1] * m[3]) <= 1e-10 * sx * sy;
  const mirrored = m[0] * m[3] - m[1] * m[2] < 0;
  switch (entity.type) {
    case "line": return { ...entity, start: p(entity.start), end: p(entity.end) };
    case "polyline": return { ...entity, points: entity.points.map(p), ...(entity.segments ? { segments: transformPolylineSegments(entity.segments, p)! } : {}) };
    case "circle": {
      if (uniform) return { ...entity, center: p(entity.center), radius: entity.radius * sx };
      const a = m[0] ** 2 + m[2] ** 2; const b = m[0] * m[1] + m[2] * m[3]; const d = m[1] ** 2 + m[3] ** 2;
      const delta = Math.hypot(a - d, 2 * b);
      const c = p(entity.center);
      return { ...entity, type: "ellipse", cx: c.x, cy: c.y, rx: entity.radius * Math.sqrt((a + d + delta) / 2), ry: entity.radius * Math.sqrt(Math.max(0, (a + d - delta) / 2)), rotation: Math.atan2(2 * b, a - d) / 2 };
    }
    case "arc": {
      if (uniform) {
        const angle = (a: number) => Math.atan2(m[1] * Math.cos(a) + m[3] * Math.sin(a), m[0] * Math.cos(a) + m[2] * Math.sin(a));
        return { ...entity, center: p(entity.center), radius: entity.radius * sx, startAngle: angle(entity.startAngle), endAngle: angle(entity.endAngle), counterClockwise: mirrored ? !entity.counterClockwise : entity.counterClockwise };
      }
      warn("Nonuniformly scaled circular arcs were converted to cubic Bézier approximations (at most 45° per segment). Use uniform INSERT scales to retain exact circles.");
      let sweep = entity.endAngle - entity.startAngle;
      if (entity.counterClockwise) { while (sweep >= 0) sweep -= 2 * Math.PI; }
      else { while (sweep <= 0) sweep += 2 * Math.PI; }
      const count = Math.ceil(Math.abs(sweep) / (Math.PI / 4));
      const points: Point2D[] = [];
      const segments: NonNullable<PolylineEntity["segments"]>[number][] = [];
      const at = (a: number) => ({ x: entity.center.x + entity.radius * Math.cos(a), y: entity.center.y + entity.radius * Math.sin(a) });
      for (let i = 0; i < count; i++) {
        const a = entity.startAngle + sweep * i / count; const b = a + sweep / count;
        const s = at(a); const e = at(b); const k = 4 / 3 * Math.tan((b - a) / 4) * entity.radius;
        if (i === 0) points.push(p(s));
        points.push(p(e)); segments.push({ type: "cubic", cp1: p({ x: s.x - k * Math.sin(a), y: s.y + k * Math.cos(a) }), cp2: p({ x: e.x + k * Math.sin(b), y: e.y - k * Math.cos(b) }) });
      }
      return { ...entity, type: "polyline", points, segments, closed: false };
    }
    case "text": {
      if (!uniform || Math.abs(m[1]) > 1e-10 || m[0] < 0) warn("Rotated or stretched TEXT was imported as editable horizontal text. Convert text to paths in the source CAD application to preserve its appearance.");
      const origin = p({ x: entity.x, y: entity.y });
      return { ...entity, x: origin.x, y: origin.y, fontSize: entity.fontSize * sy };
    }
    case "dimension": {
      if (!uniform) warn("A dimension inside a nonuniform INSERT was remeasured. Verify its annotation in the source drawing.");
      const startPoint = p(entity.startPoint); const endPoint = p(entity.endPoint); const textPosition = p(entity.textPosition);
      return { ...entity, startPoint, endPoint, textPosition, arrowSize: entity.arrowSize * sx, value: uniform ? entity.value * sx : calculateDimensionValue(entity.dimensionKind, startPoint, endPoint, textPosition) };
    }
    case "leader": return { ...entity, arrowPoint: p(entity.arrowPoint), elbowPoint: p(entity.elbowPoint), textPosition: p(entity.textPosition) };
    default: return entity;
  }
}

interface Vertex extends Point2D { readonly bulge: number }
function vertices(block: DxfBlock): Vertex[] {
  const result: Vertex[] = [];
  let current: DxfPair[] = [];
  const flush = () => {
    if (!current.length) return;
    const r = { type: "VERTEX", pairs: current };
    if (!current.some(p => p.code === 20)) throw new Error("Polyline vertex is missing its Y coordinate.");
    result.push({ x: numeric(r, 10), y: numeric(r, 20), bulge: numeric(r, 42) });
  };
  for (const item of block.pairs) {
    if (item.code === 1001) break;
    if (item.code === 10) { flush(); current = [item]; }
    else if (current.length) current.push(item);
  }
  flush(); return result;
}

// Millimetres per DXF drawing unit, including US survey variants.
const UNIT_MM: Readonly<Record<number, number>> = { 1: 25.4, 2: 304.8, 3: 1609344, 4: 1, 5: 10, 6: 1000, 7: 1e6, 8: 0.0000254, 9: 0.0254, 10: 914.4, 11: 1e-7, 12: 1e-6, 13: 0.001, 14: 100, 15: 1e4, 16: 1e5, 17: 1e12, 18: 149597870700000, 19: 9.4607304725808e18, 20: 3.0856775814913673e19, 21: 1200000 / 3937, 22: 100000 / 3937, 23: 3600000 / 3937, 24: 6336000000 / 3937 };

export function parseDxf(source: string, options: DxfImportOptions = {}): DxfImportResult {
  const warnings = new Set<string>();
  const warn = (message: string) => { if (warnings.size < 100) warnings.add(message); };
  const layers = new Map<string, Layer>();
  const entities: Entity[] = [];
  let units: DocumentUnits = options.units ?? "px";
  const result = (): DxfImportResult => {
    if (!layers.size) ensureLayer(layers, "Imported");
    return Object.freeze({ title: "Imported DXF", units, layers: Object.freeze([...layers.values()]), entities: Object.freeze(entities), warnings: Object.freeze([...warnings]) });
  };
  if (/^\uFEFF?AutoCAD Binary DXF/i.test(source)) {
    warn("Binary DXF is not supported. Save as ASCII DXF (R14) in your CAD application, then import again."); return result();
  }
  const pairs = parsePairs(source.replace(/^\uFEFF/, ""), warn);
  const records = blocksFromPairs(pairs);
  const tables: DxfBlock[] = []; const model: DxfBlock[] = []; const header: DxfPair[] = [];
  const definitions = new Map<string, { base: Point2D; records: DxfBlock[] }>();
  let section = ""; let definition: { base: Point2D; records: DxfBlock[] } | undefined; let hasEntities = false;
  for (const r of records) {
    if (r.type === "SECTION") { section = first(r, 2).toUpperCase(); if (section === "HEADER") header.push(...r.pairs); if (section === "ENTITIES") hasEntities = true; continue; }
    if (r.type === "ENDSEC") { section = ""; definition = undefined; continue; }
    if (section === "TABLES") tables.push(r);
    if (section === "ENTITIES") model.push(r);
    if (section === "BLOCKS") {
      if (r.type === "BLOCK") {
        try { definition = { base: { x: numeric(r, 10), y: numeric(r, 20) }, records: [] }; definitions.set(first(r, 2).toUpperCase(), definition); }
        catch { warn("A BLOCK has an invalid base point; repair it in the source drawing."); definition = undefined; }
      } else if (r.type === "ENDBLK") definition = undefined;
      else definition?.records.push(r);
    }
  }
  if (!hasEntities) { warn("No DXF ENTITIES section was found. Save the drawing as ASCII DXF (R14) and try again."); return result(); }
  if (!records.some(r => r.type === "EOF")) warn("DXF is missing its EOF marker; the file may be truncated. Verify the imported geometry.");
  const unitIndex = header.findIndex(p => p.code === 9 && p.value === "$INSUNITS");
  const unitCode = unitIndex < 0 ? 0 : Number(header[unitIndex + 1]?.value);
  units = options.units ?? (unitCode === 1 ? "in" : UNIT_MM[unitCode] ? "mm" : "px");
  const mm = UNIT_MM[unitCode];
  if (!mm && unitCode !== 0) warn(`Unknown $INSUNITS code ${unitCode}; coordinates were retained without scaling. Set the drawing units in the source CAD application.`);
  if (unitCode === 0 && options.units && options.units !== "px") warn(`Unitless DXF: coordinates were assumed to be ${options.units}. Verify the source drawing scale.`);
  if (units === "px" && mm) warn("Physical DXF units were converted to pixels at 96 DPI.");
  const scale = mm ? mm / (units === "in" ? 25.4 : units === "px" ? 25.4 / 96 : 1) : 1;
  const headerNumber = (name: string, fallback: number) => {
    const index = header.findIndex(p => p.code === 9 && p.value === name);
    const value = index >= 0 ? Number(header[index + 1]?.value) : fallback;
    return Number.isFinite(value) ? value : fallback;
  };
  const globalLineScale = headerNumber("$LTSCALE", 1);
  const ltypes = new Map<string, readonly number[]>([["CONTINUOUS", []]]);
  for (const r of tables.filter(r => r.type === "LTYPE")) {
    const pattern = r.pairs.filter(p => p.code === 49).map(p => Number(p.value));
    if (pattern.every(Number.isFinite)) ltypes.set(first(r, 2).toUpperCase(), pattern.map(v => v * scale * (globalLineScale > 0 ? globalLineScale : 1)));
    if (r.pairs.some(p => p.code === 74 && Number(p.value) !== 0)) warn("Complex linetypes were imported as simple dash patterns. Convert embedded text/shapes to geometry in the source CAD application if needed.");
  }
  for (const r of tables.filter(r => r.type === "LAYER")) {
    try {
      const parsed = [...parseLayerBlocks([r]).values()][0]!;
      const name = first(r, 2, "Imported");
      const aci = Math.abs(numeric(r, 62, 7));
      if (!Number.isInteger(aci) || aci < 1 || aci > 255) throw new Error("Layer ACI must be between 1 and 255.");
      const id = ensureLayer(layers, name).id;
      const lineType = first(r, 6, "CONTINUOUS");
      const savedColor = xdata(r, "VECTORA_STYLE").filter(p => p.code === 1000)[1]?.value;
      const color = savedColor && nearestAci(savedColor) === aci ? savedColor : aciColor(aci);
      layers.set(name, { ...parsed, id, order: layers.size - 1, color, dxfAci: aci, dxfLineType: lineType, dxfDashPattern: ltypes.get(lineType.toUpperCase()) ?? [], locked: (numeric(r, 70) & 4) !== 0, visible: numeric(r, 62, 7) >= 0 && (numeric(r, 70) & 1) === 0, intent: storedIntent(r, parsed.intent) });
    } catch (error) { warn(`Skipped LAYER: ${error instanceof Error ? error.message : "invalid record"}`); }
  }
  const dimstyles = new Map(tables.filter(r => r.type === "DIMSTYLE").map(r => [first(r, 2).toUpperCase(), r]));
  const defaultDimensionStyle: DxfBlock = { type: "DIMSTYLE", pairs: [
    { code: 41, value: String(headerNumber("$DIMASZ", 4)) },
    { code: 40, value: String(headerNumber("$DIMSCALE", 1)) },
    { code: 271, value: String(headerNumber("$DIMDEC", 2)) },
    { code: 144, value: String(headerNumber("$DIMLFAC", 1)) },
  ] };
  let expansionCount = 0;
  const visit = (items: readonly DxfBlock[], matrix: Matrix, inheritedLayer = "0", group?: string, stack: readonly string[] = [], inheritedColor: string | null = null, inheritedPattern: readonly number[] = []) => {
    for (let index = 0; index < items.length; index++) {
      if (++expansionCount > 100000) { warn("DXF import stopped at 100,000 expanded records. Split large assemblies into smaller DXF files."); return; }
      const r = items[index]!;
      if (["SEQEND", "ATTRIB"].includes(r.type)) { if (r.type === "ATTRIB") warn("INSERT attributes were skipped. Explode attributes to TEXT in the source CAD application."); continue; }
      try {
        if (numeric(r, 67) === 1) { warn("Paper-space entities were skipped. Export the model-space drawing for manufacturing."); continue; }
        if (r.pairs.some(p => [30, 31, 32, 33, 34, 35, 38].includes(p.code) && Number(p.value) !== 0)) {
          warn("Nonzero Z coordinates were projected onto the XY plane. Export a planar drawing to retain its geometry.");
        }
        if (numeric(r, 210) !== 0 || numeric(r, 220) !== 0 || ![1, -1].includes(numeric(r, 230, 1))) throw new Error("Tilted 3D extrusion planes are unsupported; project the drawing onto the XY plane before export.");
        const ocs = numeric(r, 230, 1) === -1 && ["ARC", "CIRCLE", "LWPOLYLINE", "POLYLINE", "INSERT", "TEXT"].includes(r.type) ? multiply(matrix, [-1, 0, 0, 1, 0, 0]) : matrix;
        const originalLayer = first(r, 8, "0");
        const layerName = originalLayer === "0" ? inheritedLayer : originalLayer;
        const layer = ensureLayer(layers, layerName);
        const aci = numeric(r, 62, 256);
        if (!Number.isInteger(aci) || Math.abs(aci) > 256) throw new Error("Entity ACI must be between 0 and 256.");
        const strings = xdata(r, "VECTORA_STYLE").filter(p => p.code === 1000).map(p => p.value);
        const savedColor = strings[1];
        const strokeColor = aci === 0 ? inheritedColor : aci === 256 ? null : savedColor && nearestAci(savedColor) === Math.abs(aci) ? savedColor : aciColor(Math.abs(aci));
        const ltype = first(r, 6, "BYLAYER").toUpperCase();
        const pattern = ltype === "BYBLOCK" ? inheritedPattern : ltype === "BYLAYER" ? layer.dxfDashPattern ?? [] : ltypes.get(ltype) ?? [];
        if (!["BYBLOCK", "BYLAYER"].includes(ltype) && !ltypes.has(ltype)) warn(`Linetype ${ltype} has no definition; imported as continuous. Include its LTYPE table when exporting.`);
        const width = xdata(r, "VECTORA_STYLE").find(p => p.code === 1040)?.value;
        const lineScale = numeric(r, 48, 1);
        if (lineScale <= 0) throw new Error("Linetype scale must be positive.");
        const base = { ...common(layer), ...(group ? { dxfGroup: group } : {}), intent: storedIntent(r, layer.intent), visible: numeric(r, 60) === 0 && aci >= 0,
          style: { strokeColor, strokeWidth: width !== undefined && Number.isFinite(Number(width)) && Number(width) >= 0 ? Number(width) : 1, fillColor: null, dashArray: pattern.map(d => Math.abs(d) * lineScale) } };
        const p = (code: number): Point2D => ({ x: numeric(r, code), y: numeric(r, code + 10) });
        const add = (entity: Entity, transform = ocs) => {
          const transformed = withBounds(transformImported(entity, transform, warn));
          if (!Object.values(transformed.bbox).every(Number.isFinite)) throw new Error("Geometry has non-finite bounds; repair the source entity.");
          entities.push(transformed);
        };
        if (r.type === "INSERT") {
          const name = first(r, 2).toUpperCase(); const block = definitions.get(name);
          if (!block) throw new Error(`BLOCK ${name} is missing; include its definition when exporting.`);
          if (stack.includes(name) || stack.length >= 32) throw new Error(`Cyclic or excessively nested BLOCK ${name}; explode the assembly in the source drawing.`);
          const sx = numeric(r, 41, 1); const sy = numeric(r, 42, 1);
          if (sx === 0 || sy === 0) throw new Error("INSERT has a zero scale.");
          const angle = numeric(r, 50) * Math.PI / 180; const c = Math.cos(angle); const s = Math.sin(angle);
          const columns = numeric(r, 70, 1); const rows = numeric(r, 71, 1);
          if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1 || columns * rows > 10000) throw new Error("INSERT array is invalid or too large; split the array in the source drawing.");
          for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
            if (expansionCount > 100000) return;
            const dx = col * numeric(r, 44); const dy = row * numeric(r, 45);
            const local: Matrix = [c * sx, s * sx, -s * sy, c * sy, numeric(r, 10) + c * dx - s * dy - c * sx * block.base.x + s * sy * block.base.y, numeric(r, 20) + s * dx + c * dy - s * sx * block.base.x - c * sy * block.base.y];
            visit(block.records, multiply(ocs, local), layerName, group ?? `${name}-${nextEntityId()}`, [...stack, name], strokeColor ?? layer.color, pattern);
          }
        } else if (r.type === "LINE") add({ ...base, type: "line", start: p(10), end: p(11) }, matrix);
        else if (r.type === "CIRCLE" || r.type === "ARC") {
          const radius = numeric(r, 40);
          if (radius <= 0) throw new Error("Circle/arc radius must be positive.");
          if (r.type === "CIRCLE") add({ ...base, type: "circle", center: p(10), radius });
          else add({ ...base, type: "arc", center: p(10), radius, startAngle: numeric(r, 50) * Math.PI / 180, endAngle: numeric(r, 51) * Math.PI / 180, counterClockwise: false });
        } else if (r.type === "TEXT") {
          if (numeric(r, 50) !== 0 || numeric(r, 41, 1) !== 1) warn("Rotated or stretched TEXT was imported as editable horizontal text. Convert text to paths in the source CAD application to preserve its appearance.");
          add({ ...base, type: "text", x: numeric(r, 10), y: numeric(r, 20), text: first(r, 1, "Text"), fontSize: Math.max(0.001, numeric(r, 40, 4)), fontFamily: first(r, 7, "STANDARD") });
        } else if (r.type === "SPLINE") {
          const points = vertices(r);
          const knots = r.pairs.filter(p => p.code === 40).map(p => Number(p.value));
          const weights = r.pairs.filter(p => p.code === 41).map(p => Number(p.value));
          if (weights.length && (weights.length !== points.length || weights.some(w => !Number.isFinite(w) || w <= 0 || w !== weights[0]))) throw new Error("Rational SPLINE weights cannot be represented losslessly by native Béziers. Export non-rational cubic splines or circular arcs from the source CAD application.");
          if (numeric(r, 72, knots.length) !== knots.length || numeric(r, 73, points.length) !== points.length) throw new Error("SPLINE knot/control counts do not match the record.");
          for (const path of splineToBezier(points, knots, numeric(r, 71), (numeric(r, 70) & 3) !== 0)) add({ ...base, id: nextEntityId(), type: "polyline", ...path }, matrix);
        } else if (r.type === "LWPOLYLINE" || r.type === "POLYLINE") {
          let points: Vertex[];
          if (r.type === "POLYLINE") {
            points = [];
            while (items[index + 1]?.type === "VERTEX") { const v = items[++index]!; points.push({ x: numeric(v, 10), y: numeric(v, 20), bulge: numeric(v, 42) }); }
            if (items[index + 1]?.type === "SEQEND") index++; else warn("POLYLINE is missing SEQEND; verify the imported contour.");
            if ((numeric(r, 70) & (2 | 4 | 8 | 16 | 64)) !== 0) throw new Error("Fitted, 3D or mesh POLYLINEs are unsupported; export planar SPLINEs or 2D polylines.");
          } else {
            points = vertices(r);
            if (numeric(r, 90, points.length) !== points.length) throw new Error("LWPOLYLINE vertex count does not match its record.");
          }
          if (points.length < 2) throw new Error("Polyline needs at least two vertices.");
          const closed = (numeric(r, 70) & 1) !== 0;
          const count = closed ? points.length : points.length - 1;
          if (!points.slice(0, count).some(v => v.bulge !== 0)) add({ ...base, type: "polyline", points: points.map(v => ({ x: v.x, y: v.y })), closed });
          else {
            const dxfGroup = group ?? `bulge-${nextEntityId()}`;
            // Compute every segment first so one bad bulge cannot leave a partial contour.
            const segments: Entity[] = [];
            for (let i = 0; i < count; i++) {
              const start = points[i]!; const end = points[(i + 1) % points.length]!;
              const segmentBase = { ...base, id: nextEntityId(), dxfGroup };
              segments.push(start.bulge === 0 ? { ...segmentBase, type: "line", start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } } : { ...segmentBase, type: "arc", ...bulgeToArc(start, end, start.bulge) });
            }
            for (const segment of segments) add(segment);
          }
        } else if (r.type === "DIMENSION") {
          const kind = numeric(r, 70) & 7;
          if (![0, 1, 3, 4].includes(kind)) throw new Error("Angular and ordinate DIMENSIONs are unsupported; explode them to annotation geometry before export.");
          const dimensionKind = kind === 0 ? "linear" : kind === 1 ? "aligned" : kind === 3 ? "diameter" : "radial";
          const endPoint = kind >= 3 ? p(15) : p(14);
          const opposite = p(10);
          const startPoint = kind === 3 ? { x: (opposite.x + endPoint.x) / 2, y: (opposite.y + endPoint.y) / 2 } : kind === 4 ? opposite : p(13);
          const textPosition = { x: numeric(r, 11, opposite.x), y: numeric(r, 21, opposite.y) };
          const style = dimstyles.get(first(r, 3, "STANDARD").toUpperCase()) ?? defaultDimensionStyle;
          const extended = xdata(r, "VECTORA"); const strings = extended.filter(p => p.code === 1000).map(p => p.value);
          const post = first(style, 3, "<>").split("<>");
          const originalSuffix = strings[1] ?? post[1] ?? "";
          const sourceSuffix = ({ 1: "in", 2: "ft", 4: "mm", 5: "cm", 6: "m" } as Readonly<Record<number, string>>)[unitCode];
          const suffix = scale !== 1 && originalSuffix === sourceSuffix ? units : originalSuffix;
          const precision = Number(extended.find(p => p.code === 1070)?.value ?? numeric(style, 271, 2));
          const override = first(r, 1, "<>");
          if (override !== "<>" && override !== "") warn("A dimension has a text override; Vectora recalculates dimension text. Verify the annotation against the original drawing.");
          add({ ...base, type: "dimension", dimensionKind, startPoint, endPoint, textPosition, value: Math.abs(numeric(r, 42, calculateDimensionValue(dimensionKind, startPoint, endPoint, textPosition)) * numeric(style, 144, 1)), prefix: strings[0] ?? (post[0] || (kind === 4 ? "R" : kind === 3 ? "∅" : "")), suffix, precision: Math.max(0, Math.min(8, Math.round(precision) || 0)), arrowSize: Math.max(0.001, numeric(style, 41, 4) * numeric(style, 40, 1)) }, matrix);
        } else if (r.type === "LEADER") {
          const points = vertices(r);
          if (points.length < 2) throw new Error("LEADER needs at least two vertices.");
          if (points.length > 3) warn("LEADER has more than three vertices; intermediate bends were omitted. Explode the leader to preserve all bends.");
          add({ ...base, type: "leader", arrowPoint: points[0]!, elbowPoint: points[1]!, textPosition: points.at(-1)!, text: xdata(r, "VECTORA").find(p => p.code === 1000)?.value ?? "Note" }, matrix);
        } else warn(`Skipped unsupported DXF entity ${r.type}. Convert it to LINE, ARC, 2D POLYLINE or cubic SPLINE in the source CAD application.`);
      } catch (error) { warn(`Skipped ${r.type}: ${error instanceof Error ? error.message : "invalid record"}`); }
    }
  };
  visit(model, multiply(IDENTITY, [scale, 0, 0, scale, 0, 0]));
  return result();
}
