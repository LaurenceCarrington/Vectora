import type { CadDocument, EntityStyle, Layer, LineEntity } from "../src/document/types";

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

const [documentModule, creationModule, annotationModule, historyModule, pathModule, svgModule, dxfModule, persistenceModule, hitModule, measureModule] = await Promise.all([
  import("../src/document/DocumentModel"),
  import("../src/canvas/useCreationStateMachine"),
  import("../src/geometry/annotations"),
  import("../src/document/History"),
  import("../src/renderer/PathCache"),
  import("../src/io/svgParser"),
  import("../src/io/dxfSerializer"),
  import("../src/io/filePersistence"),
  import("../src/geometry/HitTest"),
  import("../src/canvas/useMeasureTool"),
]);

const { documentModel } = documentModule;
const { createDimensionEntity, createLeaderEntity } = creationModule;
const { createDimensionReference, formatDimensionText } = annotationModule;
const { executeCommand, history, TransformEntityCommand, undo, redo } = historyModule;
const { pathCache } = pathModule;
const { exportSvg, parseSvg } = svgModule;
const { exportDxf, parseDxf } = dxfModule;
const { parseVectoraDocument, serializeVectoraDocument } = persistenceModule;
const { pointHitsEntity } = hitModule;
const { calculateMeasurement } = measureModule;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function close(actual: number, expected: number, message: string, tolerance = 1e-6): void {
  assert(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, received ${actual}`);
}

const layer: Layer = { id: "annotations", name: "Annotations", intent: "construction", color: "#475569", visible: true, locked: false, order: 0 };
const style: EntityStyle = { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] };
const line: LineEntity = {
  id: "measured-line",
  type: "line",
  layerId: layer.id,
  intent: "construction",
  style,
  bbox: { minX: 0, minY: 0, maxX: 100, maxY: 0 },
  visible: true,
  locked: false,
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 },
};
documentModel.replaceDocument({
  id: "annotations-smoke",
  version: 1,
  title: "Annotations smoke",
  units: "mm",
  activeLayerId: layer.id,
  layers: [layer],
  entities: [line],
});
history.clear();

const startReference = createDimensionReference(line, line.start, "endpoint");
const endReference = createDimensionReference(line, line.end, "endpoint");
assert(startReference && endReference, "Line endpoint references were not created.");
const dimension = createDimensionEntity(
  "line-dimension",
  "aligned",
  line.start,
  line.end,
  { x: 50, y: 18 },
  layer.id,
  { start: startReference, end: endReference },
);
const leader = createLeaderEntity("leader", { x: 20, y: 0 }, { x: 30, y: 15 }, { x: 48, y: 15 }, layer.id, "CUT EDGE");
assert(dimension && leader, "Annotation factories did not create entities.");
assert(formatDimensionText(dimension) === "100.00mm", "Dimension text formatting is incorrect.");
documentModel.addEntity(dimension);
documentModel.addEntity(leader);
assert(pathCache.prepare(dimension), "Dimension Path2D was not prepared.");
assert(pathCache.prepare(leader), "Leader Path2D was not prepared.");
assert(pointHitsEntity({ x: 50, y: 18 }, dimension, 2), "Dimension hit testing missed its text position.");

const movedLine: LineEntity = {
  ...line,
  start: { x: 25, y: 12 },
  end: { x: 125, y: 12 },
  bbox: { minX: 25, minY: 12, maxX: 125, maxY: 12 },
};
executeCommand(new TransformEntityCommand([line], [movedLine], "Move measured line"));
let rebound = documentModel.getDocument().entities.get(dimension.id);
assert(rebound?.type === "dimension", "Bound dimension disappeared after source transform.");
close(rebound.startPoint.x, 25, "Bound start x");
close(rebound.startPoint.y, 12, "Bound start y");
close(rebound.endPoint.x, 125, "Bound end x");
close(rebound.value, 100, "Bound dimension value");
close(rebound.textPosition.x, 75, "Bound text x");
close(rebound.textPosition.y, 30, "Bound text y");
undo();
rebound = documentModel.getDocument().entities.get(dimension.id);
assert(rebound?.type === "dimension", "Undo removed the bound dimension.");
close(rebound.startPoint.x, 0, "Undo bound start x");
close(rebound.startPoint.y, 0, "Undo bound start y");
redo();
rebound = documentModel.getDocument().entities.get(dimension.id);
assert(rebound?.type === "dimension" && rebound.startPoint.x === 25, "Redo did not restore the bound annotation.");

const snapshot = documentModel.getDocument() as CadDocument;
const svg = exportSvg(snapshot);
assert(svg.includes('data-vectora-type="dimension"') && svg.includes('data-vectora-type="leader"'), "SVG export omitted annotation groups.");
const svgRoundTrip = parseSvg(svg);
assert(svgRoundTrip.entities.some((entity) => entity.type === "dimension"), "SVG import did not restore a dimension.");
assert(svgRoundTrip.entities.some((entity) => entity.type === "leader"), "SVG import did not restore a leader.");

const dxf = exportDxf(snapshot);
assert(dxf.includes("\nDIMENSION\n") && dxf.includes("\nLEADER\n"), "DXF export omitted native annotation records.");
const dxfRoundTrip = parseDxf(dxf);
assert(dxfRoundTrip.entities.some((entity) => entity.type === "dimension"), "DXF import did not restore a dimension.");
assert(dxfRoundTrip.entities.some((entity) => entity.type === "leader"), "DXF import did not restore a leader.");

const nativeRoundTrip = parseVectoraDocument(serializeVectoraDocument(snapshot));
const nativeDimension = nativeRoundTrip.entities.find((entity) => entity.type === "dimension");
assert(nativeDimension?.type === "dimension" && nativeDimension.references?.start?.entityId === line.id, "Native persistence lost dimension bindings.");

const measurement = calculateMeasurement({ x: 0, y: 0 }, { x: 3, y: 4 });
close(measurement.distance, 5, "Measure distance");
close(measurement.deltaX, 3, "Measure delta x");
close(measurement.deltaY, 4, "Measure delta y");
close(measurement.angleDegrees, 53.13010235415598, "Measure angle");

history.clear();
documentModel.resetDocument();
console.log("Dimension/leader creation, cache, hit testing, parametric transform history, SVG/DXF, and native persistence checks passed.");
