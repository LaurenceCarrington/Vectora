import { ToolpathSimulator } from "../src/cam/ToolpathSimulator";
import { compileGcode, DEFAULT_GRBL_LASER_PROFILE } from "../src/cam/gcodeCompiler";
import { optimizeToolpaths } from "../src/cam/optimizer";
import { buildManufacturingPlan, createDefaultProcesses } from "../src/cam/processModel";
import type { CadDocument, Entity, Layer, LineEntity, RectangleEntity } from "../src/document/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const layers: readonly Layer[] = [
  { id: "cut", name: "Cut", intent: "cut", color: "#ef4444", visible: true, locked: false, order: 0 },
  { id: "engrave", name: "Engrave", intent: "engrave", color: "#3b82f6", visible: true, locked: false, order: 1 },
];
const style = { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] } as const;
const rectangle = (id: string, x: number, y: number, width: number, height: number): RectangleEntity => ({
  id,
  type: "rectangle",
  layerId: "cut",
  intent: "cut",
  style,
  visible: true,
  locked: false,
  origin: { x, y },
  width,
  height,
  cornerRadius: 0,
  bbox: { minX: x, minY: y, maxX: x + width, maxY: y + height },
});
const engraving: LineEntity = {
  id: "mark",
  type: "line",
  layerId: "engrave",
  intent: "engrave",
  style,
  visible: true,
  locked: false,
  start: { x: 10, y: 10 },
  end: { x: 20, y: 10 },
  bbox: { minX: 10, minY: 10, maxX: 20, maxY: 10 },
};
const outer = rectangle("outer", 0, 0, 100, 80);
const hole = rectangle("hole", 30, 25, 20, 20);
const island = rectangle("island", 36, 31, 5, 5);
const entities = new Map<string, Entity>([[outer.id, outer], [hole.id, hole], [island.id, island], [engraving.id, engraving]]);
const document: CadDocument = {
  id: "cam-smoke",
  version: 1,
  title: "CAM smoke",
  units: "mm",
  activeLayerId: "cut",
  layers,
  entities,
  selection: new Set(),
};

const processes = createDefaultProcesses({ kerfWidth: 0, cutFeedRate: 800, cutPower: 900 });
const plan = buildManufacturingPlan(document, { processes });
const outerProfile = plan.profiles.find((profile) => profile.entityId === outer.id);
const holeProfile = plan.profiles.find((profile) => profile.entityId === hole.id);
const islandProfile = plan.profiles.find((profile) => profile.entityId === island.id);
assert(outerProfile?.kind === "outer" && outerProfile.depth === 0, "Outer profile classification failed.");
assert(holeProfile?.kind === "inner" && holeProfile.depth === 1, "Inner profile classification failed.");
assert(holeProfile.offsetDirection === "inside", "Hole kerf side should be inside.");
assert(
  islandProfile?.kind === "outer" && islandProfile.depth === 2 && islandProfile.parentId === hole.id,
  "Nested material island classification failed.",
);

const compensated = buildManufacturingPlan(document, {
  processes: createDefaultProcesses({ kerfWidth: 0.2 }),
});
const compensatedOuter = compensated.toolpaths.find((path) => path.sourceEntityId === outer.id)!;
const compensatedHole = compensated.toolpaths.find((path) => path.sourceEntityId === hole.id)!;
const outerMinX = Math.min(...compensatedOuter.points.map((point) => point.x));
const holeMinX = Math.min(...compensatedHole.points.map((point) => point.x));
assert(outerMinX < -0.09, "Outside kerf did not expand the perimeter.");
assert(holeMinX > 30.09, "Inside kerf did not contract the hole.");

const optimized = optimizeToolpaths(plan);
assert(optimized.toolpaths[0]?.sourceEntityId === engraving.id, "Engraving should run before profile cuts.");
const cuts = optimized.toolpaths.filter((toolpath) => toolpath.processType === "vector-cut");
assert(cuts[0]?.sourceEntityId === island.id, "Deepest nested profile must run first.");
assert(cuts[1]?.sourceEntityId === hole.id, "Inner cut must run before the outer perimeter.");
assert(cuts[2]?.sourceEntityId === outer.id, "Outer perimeter must be the final profile cut.");

const gcode = compileGcode(optimized, DEFAULT_GRBL_LASER_PROFILE);
assert(gcode.includes("G21\nG90\nG94\nM5"), "G-code safety header is incomplete.");
assert(gcode.includes("M4 S"), "Laser power command is missing.");
assert(gcode.includes("G0 X") && gcode.includes("G1 X"), "Rapid or cutting motion is missing.");
assert(gcode.endsWith("; End of Vectora program\n"), "G-code output is not deterministic or terminated.");

const simulator = new ToolpathSimulator();
simulator.setPlan(optimized, { rapidFeedRate: 6_000 });
assert(simulator.getSegments().some((segment) => segment.kind === "rapid"), "Simulation has no rapid moves.");
assert(simulator.getSegments().some((segment) => segment.kind === "cut"), "Simulation has no cutting moves.");
assert(simulator.getSnapshot().duration > 0, "Simulation duration was not calculated.");
simulator.seek(0.5);
assert(Math.abs(simulator.getSnapshot().progress - 0.5) < 1e-9, "Simulation scrubbing failed.");
assert(simulator.getSnapshot().currentPoint !== null, "Simulation head position was not interpolated.");
simulator.setSpeed(5);
assert(simulator.getSnapshot().speed === 5, "Simulation speed change failed.");
simulator.dispose();

const pixelDocument: CadDocument = {
  ...document,
  id: "cam-pixel-smoke",
  units: "px",
};
const pixelPlan = optimizeToolpaths(buildManufacturingPlan(pixelDocument, { processes }));
let compilerRejectedUncalibratedPixels = false;
try {
  compileGcode(pixelPlan, DEFAULT_GRBL_LASER_PROFILE);
} catch {
  compilerRejectedUncalibratedPixels = true;
}
assert(compilerRejectedUncalibratedPixels, "The G-code compiler accepted an uncalibrated pixel document.");
const pxPerMm = 96 / 25.4;
const calibratedGcode = compileGcode(pixelPlan, {
  ...DEFAULT_GRBL_LASER_PROFILE,
  originAlignment: "document",
  returnToOrigin: false,
}, { physicalScale: { pxPerMm } });
assert(calibratedGcode.includes("X26.458"), "Pixel coordinates were not converted with the supplied physical scale.");

const pixelSimulator = new ToolpathSimulator();
let simulatorRejectedUncalibratedPixels = false;
try {
  pixelSimulator.setPlan(pixelPlan);
} catch {
  simulatorRejectedUncalibratedPixels = true;
}
assert(simulatorRejectedUncalibratedPixels, "The simulator accepted an uncalibrated pixel document.");
pixelSimulator.setPlan(pixelPlan, {
  machineUnits: "mm",
  physicalScale: { pxPerMm },
  holdingTabs: { tabWidth: 2, tabCount: 4 },
});
const pixelOuterToolpath = pixelPlan.toolpaths.find((toolpath) => toolpath.sourceEntityId === outer.id);
const calibratedContour = pixelSimulator.getSegments().filter((segment) => (
  (segment.kind === "cut" || segment.role === "tab-gap") && segment.toolpathId === pixelOuterToolpath?.id
));
assert(calibratedContour.some((segment) => segment.kind === "cut"), "The calibrated pixel simulation has no cutting segment.");
assert(calibratedContour.some((segment) => segment.role === "tab-gap"), "The calibrated simulation did not split laser-off tab gaps.");
// Tabs divide edges into feed spans; the full 100 x 80 px contour still measures 360 px.
const calibratedPerimeter = calibratedContour.reduce((sum, segment) => sum + segment.distance, 0);
assert(Math.abs(calibratedPerimeter - 360 / pxPerMm) < 1e-6, "The simulator did not convert pixel distance to millimetres.");
const firstEdge = calibratedContour.filter((segment) => Math.abs(segment.start.y) < 1e-9 && Math.abs(segment.end.y) < 1e-9);
assert(Math.abs(firstEdge.reduce((sum, segment) => sum + segment.distance, 0) - 26.4583333333) < 1e-6,
  "Splitting the first edge at tabs changed its calibrated length.");
assert(pixelSimulator.getHoldingTabMarkers().length > 0, "The simulator did not expose holding-tab canvas markers.");
pixelSimulator.dispose();

console.log("Milestone 5 profile, optimizer, G-code, and simulator checks passed.");
