import type { CadDocument, EntityStyle, Layer, RectangleEntity } from "../src/document/types";

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

const [centerlineModule, nestingModule, tabModule, documentModule, historyModule, processModule, optimizerModule, compilerModule] = await Promise.all([
  import("../src/vectorizer/centerlineTracer"),
  import("../src/cam/nestingEngine"),
  import("../src/cam/holdingTabs"),
  import("../src/document/DocumentModel"),
  import("../src/document/History"),
  import("../src/cam/processModel"),
  import("../src/cam/optimizer"),
  import("../src/cam/gcodeCompiler"),
]);

const { centerlineResultToPolylineEntities, thinBinaryMask, traceCenterlines } = centerlineModule;
const { nestEntities } = nestingModule;
const { splitPathForHoldingTabs } = tabModule;
const { documentModel } = documentModule;
const { executeCommand, history, redo, undo, UpdateEntitiesCommand } = historyModule;
const { buildManufacturingPlan, createDefaultProcesses } = processModule;
const { optimizeToolpaths } = optimizerModule;
const { compileGcode, DEFAULT_GRBL_LASER_PROFILE } = compilerModule;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function close(actual: number, expected: number, message: string, tolerance = 1e-7): void {
  assert(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, received ${actual}`);
}

const width = 25;
const height = 25;
const thickCross = new Uint8Array(width * height);
for (let y = 3; y <= 21; y += 1) {
  for (let x = 10; x <= 14; x += 1) thickCross[y * width + x] = 1;
}
for (let y = 10; y <= 14; y += 1) {
  for (let x = 3; x <= 21; x += 1) thickCross[y * width + x] = 1;
}
const sourcePixels = thickCross.reduce((sum, value) => sum + value, 0);
const thinned = thinBinaryMask(thickCross, width, height);
assert(thinned.foregroundPixels > 0, "Zhang-Suen thinning removed the entire source drawing.");
assert(thinned.foregroundPixels < sourcePixels / 2, "Zhang-Suen thinning did not reduce the thick source strokes.");
const centerlines = traceCenterlines(thickCross, width, height, {
  simplifyTolerance: 0.2,
  minimumPathLength: 1,
});
assert(centerlines.mode === "centerline", "Centerline result has the wrong trace mode.");
assert(centerlines.paths.length >= 4, "The cross skeleton was not separated into ordered branches.");
assert(centerlines.paths.every((path) => !path.closed && path.points.length >= 2), "Centerline output must contain open polylines.");
const centerlineEntities = centerlineResultToPolylineEntities(centerlines, { layerId: "score", scale: 0.5 });
assert(centerlineEntities.length === centerlines.paths.length, "Centerline paths were lost during entity conversion.");
assert(centerlineEntities.every((entity) => entity.intent === "score" && !entity.closed), "Centerlines should default to open score entities.");

const benchmarkSize = 512;
const benchmarkMask = new Uint8Array(benchmarkSize * benchmarkSize);
for (let y = 24; y < benchmarkSize - 24; y += 1) {
  for (let x = benchmarkSize / 2 - 5; x <= benchmarkSize / 2 + 5; x += 1) benchmarkMask[y * benchmarkSize + x] = 1;
}
for (let y = benchmarkSize / 2 - 5; y <= benchmarkSize / 2 + 5; y += 1) {
  for (let x = 24; x < benchmarkSize - 24; x += 1) benchmarkMask[y * benchmarkSize + x] = 1;
}
const centerlineStartedAt = performance.now();
const benchmarkCenterline = traceCenterlines(benchmarkMask, benchmarkSize, benchmarkSize);
const centerlineElapsedMs = performance.now() - centerlineStartedAt;
assert(benchmarkCenterline.paths.length >= 4, "The 512px centerline benchmark did not produce usable paths.");
assert(centerlineElapsedMs < 1_000, `The 512px centerline benchmark exceeded one second (${centerlineElapsedMs.toFixed(1)} ms).`);

const style: EntityStyle = { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] };
const rectangle = (id: string, x: number, y: number, rectWidth: number, rectHeight: number, layerId = "layer-cut"): RectangleEntity => ({
  id,
  type: "rectangle",
  layerId,
  intent: "cut",
  style,
  visible: true,
  locked: false,
  origin: { x, y },
  width: rectWidth,
  height: rectHeight,
  cornerRadius: 0,
  bbox: { minX: x, minY: y, maxX: x + rectWidth, maxY: y + rectHeight },
});

const sourceParts = [
  rectangle("nest-a", 100, 100, 30, 20),
  rectangle("nest-b", 180, 100, 25, 15),
  rectangle("nest-c", 230, 100, 18, 12),
];
const nested = nestEntities(sourceParts, {
  sheetWidth: 70,
  sheetHeight: 55,
  spacing: 3,
  margin: 2,
  rotations: [0, 90, 180, 270],
  layers: [{ id: "layer-cut", name: "Cut", locked: false }],
});
assert(nested.entities.length === sourceParts.length, "Nesting lost a selected profile.");
assert(nested.placements.length === sourceParts.length, "Nesting did not report every placement.");
for (const entity of nested.entities) {
  assert(entity.bbox.minX >= 2 - 1e-7 && entity.bbox.minY >= 2 - 1e-7, "A nested profile crossed the sheet margin.");
  assert(entity.bbox.maxX <= 68 + 1e-7 && entity.bbox.maxY <= 53 + 1e-7, "A nested profile crossed the sheet boundary.");
}
for (let left = 0; left < nested.entities.length; left += 1) {
  for (let right = left + 1; right < nested.entities.length; right += 1) {
    const a = nested.entities[left]!.bbox;
    const b = nested.entities[right]!.bbox;
    const separated = a.maxX + 3 <= b.minX + 1e-7 || b.maxX + 3 <= a.minX + 1e-7 ||
      a.maxY + 3 <= b.minY + 1e-7 || b.maxY + 3 <= a.minY + 1e-7;
    assert(separated, "Nested rectangular envelopes do not preserve the requested part spacing.");
  }
}

documentModel.replaceDocument({
  id: "phase-3-nesting",
  version: 1,
  title: "Phase 3 nesting",
  units: "mm",
  activeLayerId: "layer-cut",
  layers: [{ id: "layer-cut", name: "Cut", intent: "cut", color: "#ef4444", visible: true, locked: false, order: 0 }],
  entities: sourceParts,
});
history.clear();
executeCommand(new UpdateEntitiesCommand(sourceParts, nested.entities, "Nest selection"));
close(documentModel.getDocument().entities.get("nest-a")!.bbox.minX, nested.entities[0]!.bbox.minX, "Nesting history execute");
undo();
close(documentModel.getDocument().entities.get("nest-a")!.bbox.minX, sourceParts[0]!.bbox.minX, "Nesting history undo");
redo();
close(documentModel.getDocument().entities.get("nest-a")!.bbox.minX, nested.entities[0]!.bbox.minX, "Nesting history redo");

const tabbedPath = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }, { x: 0, y: 20 }];
const split = splitPathForHoldingTabs(tabbedPath, { tabWidth: 2, tabCount: 4 });
assert(split.tabCount === 4, "Holding-tab count changed during splitting.");
assert(split.tabs.length === 4, "Holding-tab visual markers were not exported for every configured tab.");
assert(split.tabs.every((tab) => tab.points.length >= 2), "A holding-tab marker has no drawable world-space path.");
assert(split.tabs.every((tab) => tab.bounds.minX <= tab.bounds.maxX && tab.bounds.minY <= tab.bounds.maxY), "A holding-tab marker has invalid bounds.");
assert(split.spans.some((span) => span.cutting) && split.spans.some((span) => !span.cutting), "Holding tabs did not create alternating cut and gap spans.");
const gapLength = split.spans.filter((span) => !span.cutting).reduce((sum, span) => sum + span.endDistance - span.startDistance, 0);
close(gapLength, 8, "Holding-tab suppressed perimeter", 1e-6);

const layers: readonly Layer[] = [{ id: "layer-cut", name: "Cut", intent: "cut", color: "#ef4444", visible: true, locked: false, order: 0 }];
const camPart = rectangle("tabbed-cut", 0, 0, 30, 20);
const camDocument: CadDocument = {
  id: "phase-3-cam",
  version: 1,
  title: "Phase 3 tabs",
  units: "mm",
  activeLayerId: "layer-cut",
  layers,
  entities: new Map([[camPart.id, camPart]]),
  selection: new Set(),
};
const plan = optimizeToolpaths(buildManufacturingPlan(camDocument, {
  processes: createDefaultProcesses({ kerfWidth: 0, cutFeedRate: 800, cutPower: 900 }),
}));
const plainGcode = compileGcode(plan, DEFAULT_GRBL_LASER_PROFILE);
const tabbedGcode = compileGcode(plan, DEFAULT_GRBL_LASER_PROFILE, { holdingTabs: { tabWidth: 2, tabCount: 4 } });
assert(tabbedGcode.includes("Holding tabs · 4 × 2 mm"), "Compiled G-code does not describe the configured tabs.");
assert(tabbedGcode.split("\nM5\n").length > plainGcode.split("\nM5\n").length, "Tabbed G-code does not switch the laser off at bridge gaps.");
assert(tabbedGcode.split("\nM4 S").length > plainGcode.split("\nM4 S").length, "Tabbed G-code does not restore laser power after bridge gaps.");

history.clear();
documentModel.resetDocument();
console.log(`Phase 3 centerline thinning, ordered skeletons, reversible nesting, holding-tab splitting, and tabbed G-code checks passed; 512px centerline ${Math.round(centerlineElapsedMs)} ms.`);
