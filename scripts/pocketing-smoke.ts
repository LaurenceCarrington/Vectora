import * as THREE from "three";
import type { Entity, Point2D, RectangleEntity } from "../src/document/types";
import { documentModel } from "../src/document/DocumentModel";
import { generatePocketToolpaths, pocketLinkIsClear, type PocketSettings } from "../src/cam/pocketingEngine";
import { linkPocketPaths, optimizeToolpaths } from "../src/cam/optimizer";
import { buildManufacturingPlan, createDefaultProcesses } from "../src/cam/processModel";
import { compileGcode, DEFAULT_GRBL_LASER_PROFILE, validatePreflight } from "../src/cam/gcodeCompiler";
import { buildContourHierarchy } from "../src/geometry/topology";
import { createPocketedContourMesh } from "../src/3d/pocketMesh";
import { parseVectoraDocument, serializeVectoraDocument } from "../src/io/filePersistence";
import { usePresetStore } from "../src/store/usePresetStore";
import { vectoraRenderColors } from "../src/design/vectoraRenderColors";

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function close(actual: number, expected: number, message: string, tolerance = 1e-5): void {
  assert(Math.abs(actual - expected) < tolerance, `${message}: ${actual} != ${expected}`);
}
function rejects(action: () => unknown, message: string): void {
  let threw = false; try { action(); } catch { threw = true; } assert(threw, message);
}
const layerId = documentModel.getActiveLayer().id;
const rect = (id: string, x: number, y: number, width: number, height: number): RectangleEntity => ({
  id, type: "rectangle", layerId, intent: "pocket", visible: true, locked: false,
  origin: { x, y }, width, height, cornerRadius: 0,
  style: { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] },
  bbox: { minX: x, minY: y, maxX: x + width, maxY: y + height },
});
const boundary = rect("pocket", 20, 20, 60, 40);
const island = rect("island", 43, 32, 12, 10);
const settings: PocketSettings = { toolDiameter: 4, stepoverPct: 60, strategy: "concentric", depth: 1.2, stepdown: 0.5 };
close(generatePocketToolpaths(boundary, { toolDiameter: 4, strategy: "linear" }).stepover, 2.4, "Default 60% stepover");
const segmentDistance = (p: Point2D, a: Point2D, b: Point2D): number => {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
let generatedPoints = 0;
for (const strategy of ["concentric", "linear"] as const) {
  for (const stepoverPct of [50, 60, 80]) {
    const generated = generatePocketToolpaths(boundary, { ...settings, strategy, stepoverPct }, [island]);
    assert(generated.iterations < 100 && generated.paths.length > 1, "Offsets failed to terminate with usable paths");
    const chains = linkPocketPaths(generated.paths, generated.clearance);
    assert(chains.length < generated.paths.length, "No passes were linked");
    const segments: [Point2D, Point2D][] = [];
    for (const chain of chains) for (let i = 1; i < chain.length; i += 1) segments.push([chain[i - 1]!, chain[i]!]);
    generatedPoints += segments.length;
    // Test the cutter envelope, not just whether the center misses an island.
    for (const [a, b] of segments) {
      for (let i = 0; i <= 20; i += 1) {
        const x = a.x + (b.x - a.x) * i / 20; const y = a.y + (b.y - a.y) * i / 20;
        assert(x >= 22 - 1e-5 && x <= 78 + 1e-5 && y >= 22 - 1e-5 && y <= 58 + 1e-5, "Cutter crossed the outer boundary");
        const islandDistance = Math.hypot(Math.max(43 - x, 0, x - 55), Math.max(32 - y, 0, y - 42));
        assert(islandDistance >= 2 - 1e-5, "Cutter or a feed link crossed an island");
      }
    }
    // Every sampled reachable interior point must be swept by the cutter.
    for (let x = 22.4; x < 78; x += 0.9) for (let y = 22.4; y < 58; y += 0.9) {
      if (x >= 41 && x <= 57 && y >= 30 && y <= 44) continue;
      const distance = Math.min(...segments.map(([a, b]) => segmentDistance({ x, y }, a, b)));
      assert(distance <= 2.01, `${strategy} left an interior ridge near (${x}, ${y}), distance ${distance}`);
    }
    assert(!pocketLinkIsClear({ x: 40, y: 37 }, { x: 60, y: 37 }, generated.clearance), "Island-crossing link accepted");
  }
}

const innerPocket = rect("island-pocket", 46, 35, 6, 4);
assert(generatePocketToolpaths({ ...rect("capsule", 0, 0, 20, 10), cornerRadius: 5 }, settings).paths.length > 0,
  "Rounded primitive tangent vertices prevented pocketing");
const nested = generatePocketToolpaths(boundary, { ...settings, toolDiameter: 1 }, [island, innerPocket]);
assert(nested.paths.some((path) => path.points.some((p) => p.x > 46 && p.x < 52 && p.y > 35 && p.y < 39)), "Even-depth nested region was lost");
const concave: Entity = { ...boundary, id: "concave", type: "polyline", closed: true,
  points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 12 }, { x: 24, y: 12 },
    { x: 24, y: 28 }, { x: 40, y: 28 }, { x: 40, y: 40 }, { x: 0, y: 40 }],
  bbox: { minX: 0, minY: 0, maxX: 40, maxY: 40 } };
const circle: Entity = { ...boundary, id: "circle", type: "circle", center: { x: -10, y: -20 }, radius: 12,
  bbox: { minX: -22, minY: -32, maxX: 2, maxY: -8 } };
const splitPocket: Entity = { ...concave, id: "split-pocket",
  points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 9 }, { x: 30, y: 9 }, { x: 30, y: 0 },
    { x: 50, y: 0 }, { x: 50, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 11 }, { x: 20, y: 11 },
    { x: 20, y: 20 }, { x: 0, y: 20 }], bbox: { minX: 0, minY: 0, maxX: 50, maxY: 20 } };
for (const strategy of ["linear", "concentric"] as const) {
  const split = generatePocketToolpaths(splitPocket, { ...settings, strategy });
  const chains = linkPocketPaths(split.paths, split.clearance);
  assert(chains.length >= 2, "Disconnected cutter regions were merged");
  assert(chains.every((chain) => chain.every((p) => p.x < 25) || chain.every((p) => p.x > 25)), "Feed chain crossed an inaccessible neck");
}
for (const strategy of ["linear", "concentric"] as const) {
  const circular = generatePocketToolpaths(circle, { ...settings, strategy });
  assert(circular.paths.length > 0 && circular.paths.every((path) => path.points.every((p) => Math.hypot(p.x + 10, p.y + 20) <= 10.001)), "Curved pocket lost cutter clearance");
}
for (const strategy of ["linear", "concentric"] as const) {
  const generated = generatePocketToolpaths(concave, { ...settings, strategy });
  for (const chain of linkPocketPaths(generated.paths, generated.clearance)) for (let i = 1; i < chain.length; i += 1) {
    const a = chain[i - 1]!; const b = chain[i]!;
    for (let sample = 0; sample <= 20; sample += 1) {
      const x = a.x + (b.x - a.x) * sample / 20; const y = a.y + (b.y - a.y) * sample / 20;
      assert(!(x > 24 && y > 12 && y < 28), "Concave pocket link crossed exterior");
    }
  }
}
rejects(() => generatePocketToolpaths(rect("too-small", 0, 0, 2, 2), settings), "Oversized cutter accepted");
rejects(() => generatePocketToolpaths({ ...concave, closed: false } as Entity, settings), "Open pocket accepted");
rejects(() => generatePocketToolpaths(boundary, settings, [rect("crossing", 70, 30, 20, 10)]), "Crossing island accepted");
for (const bad of [{ toolDiameter: 0 }, { stepoverPct: 0 }, { stepoverPct: 90 }, { depth: NaN }, { stepdown: 0 }]) {
  rejects(() => generatePocketToolpaths(boundary, { ...settings, ...bad }), "Invalid settings accepted");
}

const stock = { ...rect("stock", 0, 0, 100, 80), intent: "cut" as const };
const document = { ...documentModel.getDocument(), units: "mm" as const, entities: new Map([stock, boundary, island].map((e) => [e.id, e])) };
const plan = optimizeToolpaths(buildManufacturingPlan(document, { processes: createDefaultProcesses({ kerfWidth: 0, pocket: settings }) }));
assert(!plan.geometryErrors?.length, "Valid pocket plan has geometry errors");
assert(plan.toolpaths[0]?.processType === "pocket" && plan.toolpaths.at(-1)?.processType === "vector-cut", "Pocket runs after stock detaches");
const pocketPaths = plan.toolpaths.filter((path) => path.processType === "pocket");
assert(pocketPaths.every((path) => path.passes === 3 && path.color === vectoraRenderColors.operation.pocket), "Pocket pass count/overlay color mismatch");
assert(pocketPaths.every((path) => path.sourceEntityId === boundary.id), "Island generated as an independent pocket");
const importedHolePlan = buildManufacturingPlan({ ...document, entities: new Map([stock, boundary, { ...island, intent: "cut" as const }].map((e) => [e.id, e])) },
  { processes: createDefaultProcesses({ kerfWidth: 0, pocket: settings }) });
const importedPocketPaths = importedHolePlan.toolpaths.filter((path) => path.processType === "pocket");
assert(importedPocketPaths.length === pocketPaths.length, "Enclosed cut contour was not preserved as an island");
assert(importedPocketPaths.every((path) => path.points.every((p) => !(p.x > 43 && p.x < 55 && p.y > 32 && p.y < 42))), "Imported cut island was cleared");
const machine = { ...DEFAULT_GRBL_LASER_PROFILE, mode: "spindle" as const, originAlignment: "document" as const };
const gcode = compileGcode(plan, machine);
for (const depth of ["-0.5", "-1", "-1.2"]) assert(gcode.includes(`G1 Z${depth} F300`), `Missing depth pass ${depth}`);
assert(gcode.includes("G0 Z5\nG0 X"), "Missing retract before traverse");
assert(validatePreflight(plan, DEFAULT_GRBL_LASER_PROFILE).hasCriticalErrors, "Laser mode accepted milling pockets");
assert(validatePreflight(plan, { ...machine, safeZ: 0 }).hasCriticalErrors, "Unsafe pocket retract accepted");
const inchGcode = compileGcode(plan, { ...machine, units: "in", bedWidth: 12, bedHeight: 8, safeZ: 5 / 25.4, plungeRate: 300 / 25.4 });
assert(inchGcode.includes("G1 Z-0.047"), "Pocket depth was not converted into machine inches");
const inchBoundary = rect("inch-pocket", 0, 0, 60 / 25.4, 40 / 25.4);
const inchPocket = generatePocketToolpaths(inchBoundary, { ...settings, toolDiameter: 4 / 25.4, depth: 1.2 / 25.4, stepdown: 0.5 / 25.4 });
assert(inchPocket.paths.length > 0, "Pocket generation failed in fractional document units");
const badPlan = buildManufacturingPlan({ ...document, entities: new Map([["bad", { ...concave, id: "bad", closed: false } as Entity]]) });
assert(badPlan.geometryErrors?.length && !badPlan.toolpaths.length, "Invalid pocket silently disappeared from preflight");

const decoded = parseVectoraDocument(serializeVectoraDocument(document));
assert(decoded.entities.some((entity) => entity.id === boundary.id && entity.intent === "pocket"), "Pocket intent did not survive native save");
const preset = usePresetStore.getState().addPreset({ name: "Pocket test", thicknessMm: 3, kerfMm: 0,
  pocket: { feedRate: 600, power: 1000, passes: 3, toolDiameter: 4, stepover: 60, strategy: "linear", depth: 1.2, stepdown: 0.5 } });
assert(preset.pocket?.stepover === 60 && preset.pocket?.depth === 1.2, "Preset discarded pocket settings");

const stockNode = buildContourHierarchy([stock]).roots[0]!;
const pocketNodes = buildContourHierarchy([boundary, island]).nodes;
const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const mesh = createPocketedContourMesh(stockNode, pocketNodes, 3, 1, [material, material]);
mesh.updateMatrixWorld(true);
const heightAt = (x: number, y: number): number => new THREE.Raycaster(new THREE.Vector3(x - 50, y - 40, 10), new THREE.Vector3(0, 0, -1))
  .intersectObject(mesh)[0]!.point.z;
close(heightAt(30, 30), 2, "Pocket floor is not recessed");
close(heightAt(48, 37), 3, "Island was removed in preview");
close(heightAt(10, 10), 3, "Stock top changed outside pocket");
const vertices = mesh.geometry.getAttribute("position");
let volume = 0;
for (let i = 0; i < vertices.count; i += 3) {
  const a = new THREE.Vector3().fromBufferAttribute(vertices, i);
  const b = new THREE.Vector3().fromBufferAttribute(vertices, i + 1);
  const c = new THREE.Vector3().fromBufferAttribute(vertices, i + 2);
  volume += a.dot(b.cross(c)) / 6;
}
close(volume, 100 * 80 * 3 - (60 * 40 - 12 * 10), "Recess mesh volume/winding", 0.01);
rejects(() => createPocketedContourMesh(stockNode, pocketNodes, 3, 4, [material, material]), "Preview accepted depth beyond stock");
mesh.geometry.dispose(); material.dispose();
console.log(`Pocketing passed: ${generatedPoints} segments, both strategies, cutter/island clearance, continuity, center coverage, topology, depth G-code, native/preset persistence and recessed mesh volume.`);
