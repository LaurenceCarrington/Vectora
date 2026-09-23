import { traceBinaryImage, traceResultToPolylineEntities } from "../src/vectorizer/autoTracer";
import { preprocessImageData } from "../src/vectorizer/imagePreprocess";
import { documentModel } from "../src/document/DocumentModel";
import { AddLayerWithEntitiesCommand, history } from "../src/document/History";
import type { Layer } from "../src/document/types";
import { pointInClosedEntity } from "../src/geometry/HitTest";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class TestImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

Object.defineProperty(globalThis, "ImageData", { value: TestImageData, configurable: true });

const width = 12;
const height = 10;
const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
const setBlack = (x: number, y: number) => {
  const offset = (y * width + x) * 4;
  rgba[offset] = 0;
  rgba[offset + 1] = 0;
  rgba[offset + 2] = 0;
  rgba[offset + 3] = 255;
};
for (let y = 2; y <= 7; y += 1) {
  for (let x = 2; x <= 9; x += 1) {
    if (x >= 5 && x <= 6 && y >= 4 && y <= 5) continue;
    setBlack(x, y);
  }
}
setBlack(0, 0);

const source = new TestImageData(rgba, width, height) as unknown as ImageData;
const processed = preprocessImageData(source, { threshold: 128, despeckleSize: 2 });
assert(processed.mask[0] === 0, "Despeckle did not remove an isolated foreground pixel.");
assert(processed.foregroundPixels === 44, "Foreground pixel count is incorrect after despeckling.");

const traced = traceBinaryImage(processed.mask, width, height, {
  simplifyTolerance: 0.25,
  curveFitting: 0.5,
  cornerSensitivity: 0,
  minimumPathArea: 1,
});
assert(traced.loops.length === 2, `Expected an outer path and one hole, received ${traced.loops.length}.`);
assert(traced.loops.filter((loop) => loop.isHole).length === 1, "Hole winding was not detected.");
assert(traced.loops.every((loop) => loop.points.length >= 4), "A traced loop contains too few points.");
assert(traced.loops.some((loop) => loop.commands.some((command) => command.type === "cubic")), "Curve fitting produced no cubic segments.");

const layer: Layer = {
  id: "vectorizer-smoke-layer",
  name: "Traced Image",
  intent: "engrave",
  color: "#2563eb",
  visible: true,
  locked: false,
  order: 99,
};
const entities = traceResultToPolylineEntities(traced, { layerId: layer.id, scale: 0.25 });
assert(entities.length === 2 && entities.every((entity) => entity.closed), "Trace entities were not constructed correctly.");

const filled = traceResultToPolylineEntities(
  { ...traced, mode: "fill" },
  { layerId: layer.id, scale: 0.25, strokeWidth: 0, fillColor: "#7c3aed" },
);
assert(filled.length === 1 && filled[0]?.closed, "Fill trace did not produce one closed filled shape.");
assert(filled.every((entity) => entity.style.fillColor === "#7c3aed" && entity.style.strokeWidth === 0),
  "Fill trace entities were not imported as fill-only geometry.");
assert(pointInClosedEntity({ x: -0.75, y: 0.5 }, filled[0]!), "Fill trace lost foreground material.");
assert(!pointInClosedEntity({ x: 0, y: 0 }, filled[0]!), "Fill trace filled an interior counter instead of retaining its hole.");

history.clear();
history.executeCommand(new AddLayerWithEntitiesCommand(layer, entities));
assert(documentModel.getDocument().layers.some((candidate) => candidate.id === layer.id), "Trace layer was not inserted.");
assert(entities.every((entity) => documentModel.getDocument().entities.has(entity.id)), "Trace entities were not inserted.");
assert(history.undo(), "Trace insertion could not be undone.");
assert(!documentModel.getDocument().layers.some((candidate) => candidate.id === layer.id), "Undo did not remove the trace layer.");
assert(entities.every((entity) => !documentModel.getDocument().entities.has(entity.id)), "Undo did not remove trace entities.");
assert(history.redo(), "Trace insertion could not be redone.");

const benchmarkSize = 1_024;
const benchmarkMask = new Uint8Array(benchmarkSize * benchmarkSize);
const radiusSquared = 360 ** 2;
for (let y = 0; y < benchmarkSize; y += 1) {
  for (let x = 0; x < benchmarkSize; x += 1) {
    if ((x - 512) ** 2 + (y - 512) ** 2 <= radiusSquared) benchmarkMask[y * benchmarkSize + x] = 1;
  }
}
const benchmarkStartedAt = performance.now();
const benchmarkTrace = traceBinaryImage(benchmarkMask, benchmarkSize, benchmarkSize);
const benchmarkElapsedMs = performance.now() - benchmarkStartedAt;
assert(benchmarkTrace.loops.length === 1, "Large-image benchmark contour extraction failed.");
assert(benchmarkElapsedMs < 1_000, `Large-image tracing exceeded one second (${Math.round(benchmarkElapsedMs)} ms).`);

console.log(`Vectorizer preprocessing, contour, fill, curve, entity, and history checks passed; 1024px trace ${Math.round(benchmarkElapsedMs)} ms.`);
