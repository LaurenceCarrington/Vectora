import type { Entity, EntityStyle, Layer, LineEntity, PolylineEntity, RectangleEntity } from "../src/document/types";

class MockPath2D {
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
  rect(): void {}
  roundRect(): void {}
  arc(): void {}
  ellipse(): void {}
  quadraticCurveTo(): void {}
}
Object.defineProperty(globalThis, "Path2D", { configurable: true, value: MockPath2D });

const [documentModule, historyModule, transformModule, nodeModule, svgModule, bezierModule] = await Promise.all([
  import("../src/document/DocumentModel"),
  import("../src/document/History"),
  import("../src/renderer/TransformOverlay"),
  import("../src/canvas/useNodeEditStateMachine"),
  import("../src/io/svgParser"),
  import("../src/geometry/bezier"),
]);

const { calculateEntityBounds, documentModel } = documentModule;
const { UpdateEntitiesCommand, executeCommand, history, redo, undo } = historyModule;
const { getRotationHandlePoint, getSelectionBounds, hitTestTransformHandle, rotateEntities, scaleEntities } = transformModule;
const { nearestPolylineSegment } = nodeModule;
const { parseSvg } = svgModule;
const { applyBezierNodeType, evaluatePolylineSegment, getPolylineSegment } = bezierModule;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function close(actual: number, expected: number, message: string, tolerance = 1e-7): void {
  assert(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, received ${actual}`);
}

const style: EntityStyle = {
  strokeColor: null,
  strokeWidth: 1,
  fillColor: null,
  dashArray: [],
};

const activeLayer = (): Layer => documentModel.getActiveLayer();

function line(id: string): LineEntity {
  const layer = activeLayer();
  const entity: LineEntity = {
    id,
    type: "line",
    layerId: layer.id,
    intent: layer.intent,
    style,
    bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    visible: true,
    locked: false,
    start: { x: 0, y: 0 },
    end: { x: 20, y: 0 },
  };
  return { ...entity, bbox: calculateEntityBounds(entity) };
}

function rectangle(id: string): RectangleEntity {
  const layer = activeLayer();
  const entity: RectangleEntity = {
    id,
    type: "rectangle",
    layerId: layer.id,
    intent: layer.intent,
    style,
    bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    visible: true,
    locked: false,
    origin: { x: 0, y: 0 },
    width: 40,
    height: 20,
    cornerRadius: 0,
  };
  return { ...entity, bbox: calculateEntityBounds(entity) };
}

documentModel.resetDocument();
history.clear();

const sourceLine = line("phase-2-line");
const lineBounds = getSelectionBounds([sourceLine]);
assert(lineBounds, "Line selection bounds are missing.");
const rotatedLine = rotateEntities([sourceLine], { x: 10, y: 0 }, Math.PI / 2)[0];
assert(rotatedLine?.type === "line", "Rotating a line changed its entity type.");
close(rotatedLine.start.x, 10, "Rotated line start x");
close(rotatedLine.start.y, -10, "Rotated line start y");
close(rotatedLine.end.x, 10, "Rotated line end x");
close(rotatedLine.end.y, 10, "Rotated line end y");

documentModel.addEntity(sourceLine);
executeCommand(new UpdateEntitiesCommand([sourceLine], [rotatedLine], "Rotate"));
assert(documentModel.getDocument().entities.get(sourceLine.id)?.bbox.maxY === rotatedLine.bbox.maxY, "Rotation command did not apply.");
undo();
assert(documentModel.getDocument().entities.get(sourceLine.id)?.bbox.maxX === sourceLine.bbox.maxX, "Rotation undo failed.");
redo();
assert(documentModel.getDocument().entities.get(sourceLine.id)?.bbox.maxY === rotatedLine.bbox.maxY, "Rotation redo failed.");

const sourceRectangle = rectangle("phase-2-rectangle");
const rectangleBounds = getSelectionBounds([sourceRectangle]);
assert(rectangleBounds, "Rectangle selection bounds are missing.");
const rotationHandle = getRotationHandlePoint(rectangleBounds, 2);
assert(hitTestTransformHandle(rotationHandle, rectangleBounds, 2) === "rotate", "Rotation handle hit testing failed.");
const scaled = scaleEntities(
  [sourceRectangle],
  rectangleBounds,
  "ne",
  { x: rectangleBounds.maxX * 2, y: rectangleBounds.maxY * 3 },
  true,
)[0];
assert(scaled?.type === "rectangle", "Scaling a rectangle changed its entity type.");
close(scaled.width / scaled.height, sourceRectangle.width / sourceRectangle.height, "Shift corner scale did not preserve aspect ratio");

const rotatedRectangle = rotateEntities([sourceRectangle], { x: 20, y: 10 }, Math.PI / 4)[0];
assert(rotatedRectangle?.type === "polyline" && rotatedRectangle.closed, "Rotated rectangle was not safely promoted to a closed polyline.");
assert(rotatedRectangle.points.length >= 4, "Rotated rectangle lost its boundary vertices.");
documentModel.addEntity(sourceRectangle);
const laterLine = line("phase-2-later-line");
documentModel.addEntity(laterLine);
executeCommand(new UpdateEntitiesCommand([sourceRectangle], [rotatedRectangle], "Rotate"));
assert(documentModel.getDocument().entities.get(sourceRectangle.id)?.type === "polyline", "Type-changing rotation command failed.");
const orderedIds = documentModel.getVisibleEntities().map((entity) => entity.id);
assert(orderedIds.indexOf(sourceRectangle.id) < orderedIds.indexOf(laterLine.id), "Same-ID transform changed entity z-order.");
undo();
assert(documentModel.getDocument().entities.get(sourceRectangle.id)?.type === "rectangle", "Type-changing rotation undo failed.");
redo();
assert(documentModel.getDocument().entities.get(sourceRectangle.id)?.type === "polyline", "Type-changing rotation redo failed.");

const editablePolyline: PolylineEntity = {
  id: "phase-2-polyline",
  type: "polyline",
  layerId: activeLayer().id,
  intent: activeLayer().intent,
  style,
  bbox: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
  visible: true,
  locked: false,
  points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }],
  closed: false,
};
const projection = nearestPolylineSegment({ x: 7, y: 3 }, editablePolyline.points, false);
assert(projection?.segmentIndex === 0, "Node insertion selected the wrong segment.");
close(projection.point.x, 7, "Node insertion projection x");
close(projection.point.y, 0, "Node insertion projection y");

const imported = parseSvg(`
  <svg xmlns="http://www.w3.org/2000/svg" width="200px" height="100px">
    <ellipse cx="50" cy="40" rx="20" ry="10" transform="rotate(30 50 40)" />
    <path d="M 0 50 C 10 0 30 0 40 50 S 70 100 80 50 Q 90 10 100 50 T 120 50" />
    <ellipse cx="150" cy="40" rx="12" ry="8" transform="skewX(20)" />
  </svg>
`);
const nativeEllipse = imported.entities[0];
assert(nativeEllipse?.type === "ellipse", "Orthogonally transformed SVG ellipse did not remain native.");
close(nativeEllipse.rx, 20, "Imported ellipse x radius");
close(nativeEllipse.ry, 10, "Imported ellipse y radius");
close(Math.abs(nativeEllipse.rotation), Math.PI / 6, "Imported ellipse rotation");
const importedCurve = imported.entities[1];
assert(importedCurve?.type === "polyline", "SVG Bezier path was not imported as an editable polyline.");
assert(importedCurve.points.length === 5, "SVG import created artificial edit nodes instead of native curve anchors.");
assert(importedCurve.segments?.map((segment) => segment.type).join(",") === "cubic,cubic,quadratic,quadratic",
  "SVG C/S/Q/T commands did not preserve their native segment types.");
assert(importedCurve.nodeTypes?.[1] === "smooth" && importedCurve.nodeTypes[3] === "smooth",
  "SVG smooth C/S and Q/T joins were not exposed as smooth edit nodes.");
const firstCurveSegment = getPolylineSegment(importedCurve.segments, 0);
const firstCurveMidpoint = evaluatePolylineSegment(importedCurve.points[0], importedCurve.points[1], firstCurveSegment, 0.5);
const linearMidpointY = ((importedCurve.points[0]?.y ?? 0) + (importedCurve.points[1]?.y ?? 0)) / 2;
assert(Math.abs(firstCurveMidpoint.y - linearMidpointY) > 1, "Native Bezier segment lost its curvature.");

const straightSegments = [{ type: "line" as const }, { type: "line" as const }];
const straightNodeTypes = ["corner", "corner", "corner"] as ("corner" | "smooth" | "symmetric")[];
applyBezierNodeType(
  [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 5 }],
  false,
  straightSegments,
  straightNodeTypes,
  1,
  "symmetric",
);
assert(straightSegments[0]?.type === "cubic" && straightSegments[1]?.type === "cubic",
  "Changing a node to symmetric did not create editable paired handles.");
if (straightSegments[0]?.type === "cubic" && straightSegments[1]?.type === "cubic") {
  const anchor = { x: 10, y: 0 };
  const incoming = straightSegments[0].cp2;
  const outgoing = straightSegments[1].cp1;
  close(Math.hypot(anchor.x - incoming.x, anchor.y - incoming.y),
    Math.hypot(outgoing.x - anchor.x, outgoing.y - anchor.y), "Symmetric handle lengths");
  close((incoming.x - anchor.x) * (outgoing.y - anchor.y) - (incoming.y - anchor.y) * (outgoing.x - anchor.x),
    0, "Symmetric handles are not collinear");
}
const skewedEllipse = imported.entities[2];
assert(skewedEllipse?.type === "polyline" && skewedEllipse.closed, "Skewed SVG ellipse did not fall back to a closed sampled path.");
assert(skewedEllipse.points.length === 64, "Skewed ellipse fallback has an unexpected sample count.");

const entityTypes = imported.entities.map((entity: Entity) => entity.type).join(", ");
assert(entityTypes === "ellipse, polyline, polyline", `Unexpected SVG import order/types: ${entityTypes}`);

history.clear();
documentModel.resetDocument();
console.log("Phase 2 transforms, adaptive node editing, native SVG Beziers, and ellipse import checks passed.");
