import type { Entity, PolylineEntity } from "../src/document/types";
import polygonClipping from "polygon-clipping";
import { nestEntities } from "../src/cam/nestingEngine";
import { entityToClosedPath } from "../src/geometry/operations/pathConversion";
import { entitiesToPolygons } from "../src/geometry/operations/booleans";
import { signedPolygonArea } from "../src/geometry/topology";
import { documentModel } from "../src/document/DocumentModel";
import { executeCommand, history, undo, redo, ReplaceEntitySetCommand } from "../src/document/History";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function close(a: number, b: number, message: string) { assert(Math.abs(a - b) < 1e-7, `${message}: ${a} vs ${b}`); }
function throws(fn: () => unknown, message: string) { let failed = false; try { fn(); } catch { failed = true; } assert(failed, message); }
const layers = [{ id: "cut", name: "Cut", intent: "cut" as const, color: "#f00", visible: true, locked: false, order: 0 }];
function polygon(id: string, xy: number[][]): PolylineEntity {
  const points = xy.map(([x, y]) => ({ x: x!, y: y! }));
  return { id, type: "polyline", layerId: "cut", intent: "cut", points, closed: true, visible: true, locked: false,
    style: { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] },
    bbox: { minX: Math.min(...points.map((p) => p.x)), minY: Math.min(...points.map((p) => p.y)),
      maxX: Math.max(...points.map((p) => p.x)), maxY: Math.max(...points.map((p) => p.y)) } };
}
const rect = (id: string, x: number, y: number, w: number, h: number) => polygon(id, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
const options = { sheetWidth: 20, sheetHeight: 20, spacing: 0, margin: 0, rotations: [0], layers };

// Two complementary concave parts have overlapping envelopes but disjoint material.
const l = polygon("l", [[100, 100], [120, 100], [120, 106], [106, 106], [106, 120], [100, 120]]);
const square = rect("square", 200, 200, 14, 14);
const interlocked = nestEntities([l, square], options);
assert(interlocked.sheets.length === 1, "Concave void was replaced by an envelope.");
close(interlocked.utilization, 1, "Exact concave area utilization");
close(interlocked.entities[1]!.bbox.minX, 6, "Concavity X");
close(interlocked.entities[1]!.bbox.minY, 6, "Concavity Y");
const overlap = polygonClipping.intersection(entitiesToPolygons([interlocked.entities[0]!]), entitiesToPolygons([interlocked.entities[1]!]));
assert(overlap.length === 0, "Concave placements overlap.");

const outer = rect("outer", 100, 100, 40, 40);
const hole = rect("hole", 110, 110, 20, 20);
const insert = rect("insert", 200, 200, 16, 16);
const line: Entity = { ...rect("engraving", 0, 0, 1, 1), type: "line", intent: "engrave", start: { x: 102, y: 103 }, end: { x: 108, y: 103 },
  bbox: { minX: 102, minY: 103, maxX: 108, maxY: 103 } };
const withHole = nestEntities([outer, hole, insert, line], { ...options, sheetWidth: 41, sheetHeight: 41, spacing: 1, kerf: 1, margin: 0, rotations: [0], origin: { x: 5, y: 7 } });

assert(withHole.sheets.length === 1, "Part did not nest in an interior hole.");
close(withHole.usedArea, 1456, "Hole area and inserted material");
const positionedHole = withHole.entities[1]!;
const positionedInsert = withHole.entities[2]!;
assert(positionedInsert.bbox.minX >= positionedHole.bbox.minX + 2 - 1e-7 && positionedInsert.bbox.maxX <= positionedHole.bbox.maxX - 2 + 1e-7,
  "Hole spacing plus kerf X clearance failed.");
assert(positionedInsert.bbox.minY >= positionedHole.bbox.minY + 2 - 1e-7 && positionedInsert.bbox.maxY <= positionedHole.bbox.maxY - 2 + 1e-7,
  "Hole spacing plus kerf Y clearance failed.");
const parentPlacement = withHole.placements.find((p) => p.entityId === "outer")!;
for (const id of ["hole", "engraving"]) {
  const child = withHole.placements.find((p) => p.entityId === id)!;
  assert(child.partId === parentPlacement.partId && child.sheetIndex === parentPlacement.sheetIndex, "Child detached from parent.");
  close(child.translation.x, parentPlacement.translation.x, "Anchored translation X");
}
const nestedAgain = nestEntities(withHole.entities, { ...options, sheetWidth: 41, sheetHeight: 41, spacing: 1, kerf: 1 });
assert(nestedAgain.sheets[0]!.partIds.length === 2, "Repeated nesting merged an inserted part into its host compound.");

const decorated = nestEntities([outer, { ...hole, id: "closed-engraving", intent: "engrave" },
  { ...rect("closed-score", 112, 112, 4, 4), intent: "score" }], { ...options, sheetWidth: 40, sheetHeight: 40 });
close(decorated.usedArea, 1600, "Closed engraving and score must not remove material");
assert(decorated.placements.every((p) => p.partId === "outer"), "Decorative closed paths detached from their perimeter.");
const island = rect("island", 115, 115, 5, 5);
const withIsland = nestEntities([outer, hole, island], { ...options, sheetWidth: 40, sheetHeight: 40, rotations: [90] });
close(withIsland.usedArea, 1225, "Even/odd nested island area");
assert(withIsland.placements.every((p) => p.partId === "outer" && p.rotation === 90), "Rotated island separated from structural parent.");

const triangles = [polygon("triangle-a", [[100, 100], [120, 100], [100, 120]]), polygon("triangle-b", [[200, 200], [220, 200], [200, 220]])];
const triangular = nestEntities(triangles, { ...options, rotations: [0, 180] });
assert(triangular.sheets.length === 1, "Complementary rotated triangles did not share their envelopes.");
close(triangular.utilization, 1, "Triangle utilization");
const sloped = nestEntities(triangles, { ...options, sheetWidth: 22, sheetHeight: 22, spacing: 2, rotations: [0, 180] });
assert(sloped.sheets.length === 1, "Sloping-edge clearance prevented interlocking.");
const slopedSecond = sloped.entities[1]!;
close((slopedSecond.bbox.minX + slopedSecond.bbox.minY) / Math.SQRT2, 2, "Exact normal spacing between diagonal edges");
const diamond = polygon("diamond", [[10, 0], [20, 10], [10, 20], [0, 10]]);
const arbitrary = nestEntities([diamond], { sheetWidth: 15, sheetHeight: 15, spacing: 0, margin: 0, rotationStep: 45, layers });
assert(arbitrary.placements[0]!.rotation === 45, "Non-orthogonal rotation step was ignored.");
close(Math.abs(signedPolygonArea(entityToClosedPath(arbitrary.entities[0]!)!)), 200, "Rotation changed physical area");

const originals = [rect("sheet-a", 100, 0, 18, 18), rect("sheet-b", 150, 0, 18, 18), rect("sheet-c", 200, 0, 18, 18)];
const progress: number[] = [];
const multi = nestEntities(originals, { ...options, margin: 1, spacing: 2 }, (p) => progress.push(p.completed));
assert(multi.sheets.length === 3, "Overflow did not allocate additional stock.");
assert(progress.join(",") === "0,1,2,3", "Progress did not report all parts.");
for (const [i, sheet] of multi.sheets.entries()) {
  assert(sheet.sheetIndex === i && sheet.partIds.length === 1 && sheet.entityIds.length === 1, "Sheet grouping failed.");
  close(sheet.utilization, 0.81, "Per-sheet utilization");
  assert(sheet.usedBounds.minX >= sheet.sheetBounds.minX + 1 - 1e-7 && sheet.usedBounds.maxX <= sheet.sheetBounds.maxX - 1 + 1e-7, "Stock margin failed.");
}
const inchScale = 1 / 25.4;
const inchEntities = originals.map((entity) => polygon(entity.id, entity.points.map((p) => [p.x * inchScale, p.y * inchScale])));
const inches = nestEntities(inchEntities, { ...options, sheetWidth: 20 * inchScale, sheetHeight: 20 * inchScale, margin: inchScale, spacing: 2 * inchScale });
assert(inches.sheets.length === multi.sheets.length, "Unit scaling changed stock allocation.");
close(inches.utilization, multi.utilization, "Scale invariant utilization");
for (let i = 0; i < multi.entities.length; i++) close(inches.entities[i]!.bbox.minX / inchScale, multi.entities[i]!.bbox.minX, "Physical placement scaling");

// Single history entry restores the complete selection and its source geometry.
documentModel.replaceDocument({ id: "nest-smoke", version: 1, title: "Nesting", units: "mm", activeLayerId: "cut", layers, entities: originals });
history.clear();
executeCommand(new ReplaceEntitySetCommand(originals, multi.entities, "Nest selection"));
close(documentModel.getDocument().entities.get("sheet-c")!.bbox.minX, multi.entities[2]!.bbox.minX, "Execute multi-sheet command");
undo();
close(documentModel.getDocument().entities.get("sheet-c")!.bbox.minX, 200, "Undo whole layout");
redo();
close(documentModel.getDocument().entities.get("sheet-c")!.bbox.minX, multi.entities[2]!.bbox.minX, "Redo whole layout");

throws(() => nestEntities([rect("too-large", 0, 0, 21, 21)], options), "Oversized part accepted.");
throws(() => nestEntities([polygon("crossed", [[0, 0], [20, 20], [0, 20], [20, 0]])], options), "Self-crossing contour accepted.");
throws(() => nestEntities([l], { ...options, rotations: [] }), "Empty rotations accepted.");
throws(() => nestEntities([l], { ...options, rotationStep: 0 }), "Invalid rotation step accepted.");
throws(() => nestEntities([l], { ...options, searchStep: 0.00001 }), "Unbounded grid accepted.");
throws(() => nestEntities([l], { ...options, margin: 10 }), "Empty stock interior accepted.");
throws(() => nestEntities([l], { ...options, origin: { x: NaN, y: 0 } }), "Non-finite origin accepted.");
throws(() => nestEntities([line], options), "Unanchored engraving accepted.");
throws(() => nestEntities([l, l], options), "Duplicate entity IDs accepted.");
throws(() => nestEntities([{ ...l, locked: true }], options), "Locked entity accepted.");
console.log("Irregular nesting: concavity, hole/kerf clearance, anchored rotations, islands, arbitrary angles, multi-sheet utilization, unit scaling, progress, and undo/redo passed.");
