import type { BoundingBox, Entity, Layer } from "../src/document/types";

let nativePathBuilds = 0;
class MockPath2D {
  constructor() { nativePathBuilds += 1; }
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
  rect(): void {}
  roundRect(): void {}
  arc(): void {}
}
Object.defineProperty(globalThis, "Path2D", { configurable: true, value: MockPath2D });

const [{ documentModel }, { pathCache }, { findObjectSnap }] = await Promise.all([
  import("../src/document/DocumentModel"),
  import("../src/renderer/PathCache"),
  import("../src/geometry/Snapping"),
]);

const layer: Layer = {
  id: "benchmark",
  name: "Benchmark",
  intent: "cut",
  color: "#3b82f6",
  visible: true,
  locked: false,
  order: 0,
};
const style = {
  strokeColor: null,
  strokeWidth: 1,
  fillColor: null,
  dashArray: [] as readonly number[],
};
const entities: Entity[] = [];
for (let index = 0; index < 10_000; index += 1) {
  const column = index % 100;
  const row = Math.floor(index / 100);
  const x = column * 28;
  const y = row * 28;
  if (index % 3 === 0) {
    entities.push({
      id: `circle-${index}`,
      type: "circle",
      layerId: layer.id,
      intent: "cut",
      style,
      center: { x: x + 7, y: y + 7 },
      radius: 7,
      bbox: { minX: x, minY: y, maxX: x + 14, maxY: y + 14 },
      visible: true,
      locked: false,
    });
  } else {
    entities.push({
      id: `line-${index}`,
      type: "line",
      layerId: layer.id,
      intent: "cut",
      style,
      start: { x, y },
      end: { x: x + 18, y: y + 18 },
      bbox: { minX: x, minY: y, maxX: x + 18, maxY: y + 18 },
      visible: true,
      locked: false,
    });
  }
}

documentModel.replaceDocument({ title: "10k benchmark", units: "mm", layers: [layer], entities });
pathCache.prepareAll(documentModel.getDocument().entities.values());
if (nativePathBuilds !== entities.length) {
  throw new Error(`Expected ${entities.length} initial paths, built ${nativePathBuilds}.`);
}

const viewportBounds = { minX: 0, minY: 0, maxX: 1_440, maxY: 900 } satisfies BoundingBox;
const visibleScratch: Entity[] = [];
const frameTimes: number[] = [];
let queriedEntities = 0;

// Warm JIT and retained spatial-query storage before sampling.
for (let index = 0; index < 80; index += 1) {
  documentModel.queryVisibleEntities(viewportBounds, visibleScratch);
  findObjectSnap({ cursor: { x: index * 13, y: index * 11 }, zoom: 1 });
}

for (let frame = 0; frame < 600; frame += 1) {
  const started = performance.now();
  const offsetX = (frame * 7) % 1_300;
  const offsetY = (frame * 5) % 1_700;
  viewportBounds.minX = offsetX;
  viewportBounds.minY = offsetY;
  viewportBounds.maxX = offsetX + 1_440;
  viewportBounds.maxY = offsetY + 900;
  const visible = documentModel.queryVisibleEntities(viewportBounds, visibleScratch);
  queriedEntities += visible.length;
  for (const entity of visible) {
    if (!pathCache.peek(entity)) throw new Error(`Uncached render path for ${entity.id}.`);
  }
  // Five coalesced high-frequency cursor samples per conceptual frame.
  for (let sample = 0; sample < 5; sample += 1) {
    findObjectSnap({
      cursor: { x: offsetX + 120 + sample * 41, y: offsetY + 80 + sample * 37 },
      zoom: 1,
    });
  }
  frameTimes.push(performance.now() - started);
}

if (nativePathBuilds !== entities.length) {
  throw new Error("A cached path was rebuilt during the render/query benchmark.");
}

frameTimes.sort((left, right) => left - right);
const averageMs = frameTimes.reduce((sum, duration) => sum + duration, 0) / frameTimes.length;
const p95Ms = frameTimes[Math.floor(frameTimes.length * 0.95)] ?? Infinity;
const maxMs = frameTimes.at(-1) ?? Infinity;
if (averageMs >= 16 || p95Ms >= 16) {
  throw new Error(`Performance target missed: average=${averageMs.toFixed(2)}ms p95=${p95Ms.toFixed(2)}ms.`);
}

console.log(JSON.stringify({
  entities: entities.length,
  frames: frameTimes.length,
  cursorQueriesPerFrame: 5,
  averageVisibleEntities: Math.round(queriedEntities / frameTimes.length),
  cachedPathBuilds: nativePathBuilds,
  averageMs: Number(averageMs.toFixed(3)),
  p95Ms: Number(p95Ms.toFixed(3)),
  maxMs: Number(maxMs.toFixed(3)),
  targetMs: 16,
}, null, 2));
