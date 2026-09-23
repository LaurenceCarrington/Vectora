import { exportDxf, parseDxf } from "../src/io/dxfSerializer";
import { exportSvg, parseSvg } from "../src/io/svgParser";
import { findObjectSnap } from "../src/geometry/Snapping";
import type { CadDocument, Entity, Layer } from "../src/document/types";

const layer: Layer = {
  id: "cut",
  name: "Cut path",
  intent: "cut",
  color: "#ff0000",
  visible: true,
  locked: false,
  order: 0,
};
const style = { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] } as const;
const entities: Entity[] = [
  { id: "horizontal", type: "line", layerId: layer.id, intent: "cut", style, visible: true, locked: false, bbox: { minX: 0, minY: 0, maxX: 100, maxY: 0 }, start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
  { id: "vertical", type: "line", layerId: layer.id, intent: "cut", style, visible: true, locked: false, bbox: { minX: 50, minY: -50, maxX: 50, maxY: 50 }, start: { x: 50, y: -50 }, end: { x: 50, y: 50 } },
  { id: "circle", type: "circle", layerId: layer.id, intent: "cut", style, visible: true, locked: false, bbox: { minX: 175, minY: -25, maxX: 225, maxY: 25 }, center: { x: 200, y: 0 }, radius: 25 },
  { id: "circle-line", type: "line", layerId: layer.id, intent: "cut", style, visible: true, locked: false, bbox: { minX: 160, minY: 0, maxX: 240, maxY: 0 }, start: { x: 160, y: 0 }, end: { x: 240, y: 0 } },
  { id: "rectangle", type: "rectangle", layerId: layer.id, intent: "cut", style, visible: true, locked: false, bbox: { minX: 0, minY: 80, maxX: 40, maxY: 110 }, origin: { x: 0, y: 80 }, width: 40, height: 30, cornerRadius: 0 },
  { id: "arc", type: "arc", layerId: layer.id, intent: "cut", style, visible: true, locked: false, bbox: { minX: 280, minY: 0, maxX: 300, maxY: 20 }, center: { x: 280, y: 0 }, radius: 20, startAngle: 0, endAngle: Math.PI / 2, counterClockwise: false },
];
const document: CadDocument = {
  id: "smoke",
  version: 1,
  title: "Milestone 3 smoke",
  units: "mm",
  activeLayerId: layer.id,
  layers: [layer],
  entities: new Map(entities.map((entity) => [entity.id, entity])),
  selection: new Set(),
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(findObjectSnap({ cursor: { x: 1, y: 1 }, zoom: 1, entities })?.type === "endpoint", "Endpoint snap failed.");
assert(findObjectSnap({ cursor: { x: 50, y: 1 }, zoom: 1, entities })?.type === "intersection", "Line intersection snap failed.");
assert(findObjectSnap({ cursor: { x: 200, y: 1 }, zoom: 1, entities, excludeEntityIds: new Set(["circle-line"]) })?.type === "center", "Center snap failed.");
const circleIntersection = findObjectSnap({ cursor: { x: 175, y: 1 }, zoom: 1, entities });
assert(circleIntersection?.type === "intersection", "Line-circle intersection snap failed.");

const svg = exportSvg(document);
const svgImport = parseSvg(svg);
assert(svgImport.entities.length === entities.length, "SVG round-trip changed entity count.");
assert(svgImport.entities.some((entity) => entity.type === "arc"), "SVG round-trip lost arc geometry.");
assert(svgImport.units === "mm", "SVG round-trip lost document units.");

const dxf = exportDxf(document);
const dxfImport = parseDxf(dxf);
assert(dxfImport.entities.length === entities.length, "DXF round-trip changed entity count.");
assert(dxfImport.entities.some((entity) => entity.type === "arc"), "DXF round-trip lost arc geometry.");
assert(dxfImport.units === "mm", "DXF round-trip lost document units.");
const dxfR12Import = parseDxf(exportDxf(document, { version: "R12" }));
assert(dxfR12Import.entities.length === entities.length, "DXF R12 round-trip changed entity count.");

console.log("Milestone 3 snapping and SVG/DXF round-trip checks passed.");
