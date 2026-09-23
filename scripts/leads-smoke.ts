import type { Entity, Point2D, PolylineEntity } from "../src/document/types";
import { documentModel } from "../src/document/DocumentModel";
import { buildManufacturingPlan, createDefaultProcesses, type ManufacturingToolpath } from "../src/cam/processModel";
import { optimizeToolpaths, pathLength } from "../src/cam/optimizer";
import { createLead, createRampEntry, DEFAULT_LEAD_SETTINGS, leadExtrema, leadHitsContour, leadPointAt, prepareCutPath,
  resolveCutLeadSettings, sampleLead, type ArcLead, type LeadSettings } from "../src/cam/leadGeometry";
import { compileGcode, DEFAULT_GRBL_LASER_PROFILE, DEFAULT_MARLIN_LASER_PROFILE, machineDocumentTransform, preparePlanCutMotions, validatePreflight } from "../src/cam/gcodeCompiler";
import { splitPathForHoldingTabs } from "../src/cam/holdingTabs";
import { ToolpathSimulator } from "../src/cam/ToolpathSimulator";
import { drawLeadMarkers } from "../src/renderer/LeadOverlay";
import { usePresetStore } from "../src/store/usePresetStore";
import { vectoraRenderColors } from "../src/design/vectoraRenderColors";

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function close(actual: number, expected: number, message: string, tolerance = 1e-6): void {
  assert(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} != ${expected}`);
}
function same(a: Point2D, b: Point2D, message: string): void { close(a.x, b.x, `${message} X`); close(a.y, b.y, `${message} Y`); }
function rejects(fn: () => unknown, message: string): void { let failed = false; try { fn(); } catch { failed = true; } assert(failed, message); }
const length = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y);
const arcSettings: LeadSettings = { ...DEFAULT_LEAD_SETTINGS, leadType: "arc", leadLength: 3, leadAngle: 90 };
for (const side of [-1, 1] as const) for (const sweep of [45, 90, 135]) for (const angle of [0, 0.7, 2.2, -1.4]) {
  const anchor = { x: -13.5, y: 8.2 }, tangent = { x: Math.cos(angle), y: Math.sin(angle) };
  for (const exit of [false, true]) {
    const motion = createLead(anchor, tangent, side, { ...arcSettings, leadAngle: sweep }, 1, exit) as ArcLead;
    const radius = 3 / (sweep * Math.PI / 180);
    close(length(motion.start, motion.center), radius, "Arc start radius");
    close(length(motion.end, motion.center), radius, "Arc end radius");
    close(motion.sweep * radius, 3, "Configured arc length");
    const radial = { x: anchor.x - motion.center.x, y: anchor.y - motion.center.y };
    const derivative = motion.clockwise ? { x: radial.y, y: -radial.x } : { x: -radial.y, y: radial.x };
    close((derivative.x * tangent.x + derivative.y * tangent.y) / radius, 1, "Lead is not tangent in travel direction");
    const middle = leadPointAt(motion, 0.5);
    assert(((middle.x - anchor.x) * -tangent.y + (middle.y - anchor.y) * tangent.x) * side > 0, "Arc went to material side");
  }
}
const straight = createLead({ x: 0, y: 0 }, { x: 1, y: 0 }, -1, { ...arcSettings, leadType: "line", leadAngle: 45 })!;
close(straight.start.x, -3 / Math.sqrt(2), "Straight entry direction");
close(straight.start.y, -3 / Math.sqrt(2), "Straight entry scrap side");
const ramp = createRampEntry({ x: 10, y: 20 }, { x: 1, y: 0 }, 0, -2, 10, 5);
close(length(ramp.start, ramp.end), 2 / Math.tan(5 * Math.PI / 180), "Ramp run");
close(ramp.angle, 5, "Ramp slope");
close(createRampEntry({ x: 0, y: 0 }, { x: 1, y: 1 }, 1, -1, 40, 5).angle, Math.atan2(2, 40) * 180 / Math.PI, "Minimum ramp length");
rejects(() => createRampEntry({ x: 0, y: 0 }, { x: 1, y: 0 }, 0, -1, 2, 0), "Zero ramp angle accepted");
rejects(() => resolveCutLeadSettings({ leadOut: { ...arcSettings, leadType: "ramp" } }), "Ramp exit accepted");
rejects(() => resolveCutLeadSettings({ leadType: "arc", leadLength: -1 }), "Negative lead accepted");

const layerId = documentModel.getActiveLayer().id;
const rect = (id: string, x: number, y: number, w: number, h: number, reverse = false): PolylineEntity => ({
  id, type: "polyline", layerId, intent: "cut", visible: true, locked: false, closed: true,
  points: (reverse ? [{ x, y }, { x, y: y + h }, { x: x + w, y: y + h }, { x: x + w, y }]
    : [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]),
  bbox: { minX: x, minY: y, maxX: x + w, maxY: y + h },
  style: { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] },
});
const documentFor = (entities: readonly Entity[], units: "mm" | "in" | "px" = "mm") => ({ ...documentModel.getDocument(), units,
  entities: new Map(entities.map((entity) => [entity.id, entity])) });
const outer = rect("outer", 20, 20, 80, 60), hole = rect("hole", 45, 40, 20, 20, true);
const plan = optimizeToolpaths(buildManufacturingPlan(documentFor([outer, hole]), {
  processes: createDefaultProcesses({ kerfWidth: 0.2, leadIn: arcSettings, leadOut: arcSettings }),
}));
const tabs = { tabWidth: 2, tabCount: 4 };
const prepared = preparePlanCutMotions(plan, DEFAULT_GRBL_LASER_PROFILE, { holdingTabs: tabs });
for (const toolpath of plan.toolpaths) {
  const cut = prepared.get(toolpath.id)!;
  assert(cut.leadIn?.kind === "arc" && cut.leadOut?.kind === "arc", "Arc extensions missing");
  const original = splitPathForHoldingTabs(toolpath.points, tabs);
  assert(JSON.stringify(cut.tabs) === JSON.stringify(original.tabs), "Lead placement moved holding tabs");
  close(cut.spans.reduce((sum, span) => sum + pathLength(span.points), 0), pathLength(toolpath.points, true), "Reseaming changed contour length");
  assert(JSON.stringify(cut.spans.filter((span) => !span.cutting).map((span) => span.points)) === JSON.stringify(original.spans.filter((span) => !span.cutting).map((span) => span.points)), "Tab-off spans changed");
  same(cut.leadIn.end, cut.spans[0]!.points[0]!, "Lead-in join");
  same(cut.leadOut.start, cut.spans.at(-1)!.points.at(-1)!, "Lead-out join");
  for (let i = 1; i < cut.spans.length; i += 1) same(cut.spans[i - 1]!.points.at(-1)!, cut.spans[i]!.points[0]!, "Span continuity");
  for (const tab of cut.tabs) {
    assert(!leadHitsContour(cut.leadIn, tab.points, false) && !leadHitsContour(cut.leadOut, tab.points, false), "Lead crosses a tab");
  }
  const mid = leadPointAt(cut.leadIn, 0.5);
  if (toolpath.profileKind === "inner") assert(mid.x > 45 && mid.x < 65 && mid.y > 40 && mid.y < 60, "Hole lead leaves the void");
  else assert(mid.x < 20 || mid.x > 100 || mid.y < 20 || mid.y > 80, "Outer lead enters finished stock");
}

const neighbor = [{ x: -1, y: -3 }, { x: -1, y: 1 }];
const crossing = createLead({ x: 0, y: 0 }, { x: 1, y: 0 }, -1, arcSettings)!;
assert(leadHitsContour(crossing, neighbor, false), "Analytic arc/neighbor collision missed");
const tiny = optimizeToolpaths(buildManufacturingPlan(documentFor([rect("tiny", 0, 0, 2, 2)]), { processes: createDefaultProcesses({ kerfWidth: 0 }) })).toolpaths[0]!;
const enclosingObstacle: ManufacturingToolpath = { ...tiny, id: "obstacle", points: rect("obstacle", -0.1, -0.1, 2.2, 2.2).points };
rejects(() => prepareCutPath({ ...tiny, leads: resolveCutLeadSettings({ leadType: "line", leadLength: 1 }) },
  { unitsPerMm: 1, mode: "laser", surfaceZ: 0, workZ: 0, neighbors: [enclosingObstacle] }), "Placement crossed an adjacent contour at every candidate seam");
rejects(() => prepareCutPath({ ...tiny, profileKind: "inner", leads: resolveCutLeadSettings({ leadType: "arc", leadLength: 100 }) },
  { unitsPerMm: 1, mode: "laser", surfaceZ: 0, workZ: 0, neighbors: [] }), "Impossible hole lead silently accepted");
const open: ManufacturingToolpath = { ...tiny, closed: false, profileKind: "open", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
  leads: resolveCutLeadSettings({ leadType: "line", leadLength: 2 }) };
const openPrepared = prepareCutPath(open, { unitsPerMm: 1, mode: "laser", surfaceZ: 0, workZ: 0, neighbors: [] });
same(openPrepared.entry, { x: -2, y: 0 }, "Open entry extension"); same(openPrepared.exit, { x: 12, y: 0 }, "Open exit extension");

const gcode = compileGcode(plan, DEFAULT_GRBL_LASER_PROFILE, { holdingTabs: tabs });
assert(gcode.includes("G17\nG91.1") && /G[23] X/.test(gcode), "Analytic XY arc output missing");
let x = 0, y = 0, arcs = 0;
for (const line of gcode.split("\n")) {
  if (!/^G[0123] /.test(line)) continue;
  const words = Object.fromEntries([...line.matchAll(/([XYZIJ])(-?\d+(?:\.\d+)?)/g)].map((m) => [m[1]!, Number(m[2])]));
  if (/^G[23] /.test(line)) {
    const cx = x + words.I!, cy = y + words.J!;
    close(Math.hypot(x - cx, y - cy), Math.hypot(words.X! - cx, words.Y! - cy), "Serialized arc radius mismatch", 0.001);
    arcs += 1;
  }
  x = words.X ?? x; y = words.Y ?? y;
}
assert(arcs === 4 && gcode.includes("M5\nG1"), "Missing lead arcs or laser-off tab traversal");
const marlinCode = compileGcode(plan, DEFAULT_MARLIN_LASER_PROFILE, { holdingTabs: tabs });
assert(/G[23] X[^\n]+ I[^\n]+ J/.test(marlinCode) && !marlinCode.includes("G91.1"), "Marlin arc serialization used unsupported center-mode setup");
const transform = machineDocumentTransform(plan, DEFAULT_GRBL_LASER_PROFILE, undefined, { holdingTabs: tabs });
const first = prepared.get(plan.toolpaths[0]!.id)!.entry;
const firstG0 = gcode.split("\n").find((line) => line.startsWith("G0 X"))!;
close(Number(firstG0.match(/X(-?[\d.]+)/)![1]), first.x + transform.offsetX, "Live transform differs from lead-aware compiler", 0.0001);

const rampPlan = optimizeToolpaths(buildManufacturingPlan(documentFor([outer]), { processes: createDefaultProcesses({ kerfWidth: 0,
  leadIn: { ...arcSettings, leadType: "ramp", leadLength: 10, rampAngle: 5 }, leadOut: DEFAULT_LEAD_SETTINGS }) }));
const spindle = { ...DEFAULT_GRBL_LASER_PROFILE, mode: "spindle" as const, workZ: -2, stockSurfaceZ: 0 };
const rampCode = compileGcode(rampPlan, spindle);
assert(/G1 X[^\n]+ Y[^\n]+ Z-2 F/.test(rampCode), "Ramp did not emit simultaneous XYZ feed");
assert(!rampCode.includes("G1 Z-2 "), "Ramp still plunges vertically into material");
assert(validatePreflight(rampPlan, DEFAULT_GRBL_LASER_PROFILE).hasCriticalErrors, "Laser accepted ramp");
assert(validatePreflight(rampPlan, { ...spindle, safeZ: -1 }).hasCriticalErrors, "Unsafe ramp clearance accepted");

const wideArcPlan = optimizeToolpaths(buildManufacturingPlan(documentFor([rect("wide-arc", 10, 300, 80, 30)]), { processes: createDefaultProcesses({ kerfWidth: 0,
  leadIn: DEFAULT_LEAD_SETTINGS, leadOut: { ...arcSettings, leadLength: 200, leadAngle: 135 } }) }));
const documentOrigin = { ...DEFAULT_GRBL_LASER_PROFILE, originAlignment: "document" as const, bedWidth: 120, bedHeight: 600 };
const wideArc = preparePlanCutMotions(wideArcPlan, documentOrigin).values().next().value!.leadOut!;
assert(wideArc.start.x < 120 && wideArc.end.x < 120 && leadExtrema(wideArc).some((p) => p.x > 120), "Arc-extrema fixture invalid");
assert(validatePreflight(wideArcPlan, documentOrigin).hasCriticalErrors, "Preflight checked arc endpoints only");

for (const [units, unitsPerMm] of [["mm", 1], ["in", 1 / 25.4], ["px", 4]] as const) {
  const scaled = rect("unit-lead", 10 * unitsPerMm, 10 * unitsPerMm, 60 * unitsPerMm, 40 * unitsPerMm);
  const unitPlan = optimizeToolpaths(buildManufacturingPlan(documentFor([scaled], units), { processes: createDefaultProcesses({ kerfWidth: 0, leadType: "arc", leadLength: 3 }) }));
  const options = units === "px" ? { physicalScale: { pxPerMm: 4 } } : {};
  const entry = preparePlanCutMotions(unitPlan, DEFAULT_GRBL_LASER_PROFILE, options).values().next().value!.leadIn as ArcLead;
  close(length(entry.start, entry.center) * entry.sweep / unitsPerMm, 3, "Lead length unit contract");
  assert(compileGcode(unitPlan, DEFAULT_GRBL_LASER_PROFILE, options).includes("G2"), "Scaled lead missing");
}

const simulator = new ToolpathSimulator();
simulator.setPlan(plan, { machineProfile: DEFAULT_GRBL_LASER_PROFILE, holdingTabs: tabs });
assert(simulator.getLeadMarkers().length === 4, "Entry/exit overlay markers missing");
assert(simulator.getSegments().some((s) => s.role === "lead-in" && s.color === vectoraRenderColors.toolpath.leadIn) && simulator.getSegments().some((s) => s.role === "lead-out" && s.color === vectoraRenderColors.toolpath.leadOut), "Overlay lead colors missing");
assert(simulator.getSegments().some((s) => s.role === "tab-gap" && s.kind === "rapid"), "Simulator cut across tab gaps");
for (const marker of simulator.getLeadMarkers()) {
  const cut = prepared.get(marker.toolpathId)!;
  const expected = marker.role === "lead-in" ? cut.leadIn! : cut.leadOut!;
  same(marker.points[0]!, expected.start, "Preview/compiler lead start"); same(marker.points.at(-1)!, expected.end, "Preview/compiler lead end");
}
const colors: string[] = [];
const context = { fillStyle: "", save() {}, restore() {}, setLineDash() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, arc() {}, stroke() {},
  fill(this: { fillStyle: string }) { colors.push(this.fillStyle); } } as unknown as CanvasRenderingContext2D;
drawLeadMarkers(context, simulator.getLeadMarkers(), 2);
assert(colors.includes(vectoraRenderColors.toolpath.leadIn) && colors.includes(vectoraRenderColors.toolpath.leadOut), "Canvas marker renderer omitted entry/exit colors");
simulator.setPlan(rampPlan, { machineProfile: spindle });
const rampSegment = simulator.getSegments().find((s) => s.role === "ramp")!;
assert(rampSegment.startZ === 0 && rampSegment.endZ === -2, "Simulator lost ramp Z");
close(rampSegment.distance, Math.hypot(length(rampSegment.start, rampSegment.end), 2), "Ramp simulation distance");
const slowSpindle = { ...spindle, feedRate: 120 };
simulator.setPlan(rampPlan, { machineProfile: slowSpindle });
close(simulator.getSegments().find((s) => s.role === "ramp")!.feedRate, 120, "Simulator ignored machine feed override");
assert(/G1 X[^\n]+ Z-2 F120/.test(compileGcode(rampPlan, slowSpindle)), "Compiler ignored ramp feed override");
const inchSpindle = { ...spindle, units: "in" as const, workZ: -2 / 25.4, safeZ: 5 / 25.4, plungeRate: 300 / 25.4,
  bedWidth: 300 / 25.4, bedHeight: 200 / 25.4, decimalPlaces: 5 };
const inchRamp = preparePlanCutMotions(rampPlan, inchSpindle).values().next().value!.leadIn!;
assert(inchRamp.kind === "ramp", "Inch profile lost ramp entry");
close(inchRamp.angle, 5, "Inch conversion changed ramp slope");
assert(/G1 X[^\n]+ Z-0.07874 F/.test(compileGcode(rampPlan, inchSpindle)), "Inch output has wrong ramp depth");
simulator.setPlan(null);
simulator.setPlan(plan);
simulator.dispose();
assert(simulator.getLeadMarkers().length === 0 && simulator.getSegments().length === 0, "Simulator disposal retained geometry markers.");
const preset = usePresetStore.getState().addPreset({ name: "Lead test", thicknessMm: 3, kerfMm: 0.2,
  cut: { feedRate: 600, power: 800, passes: 1, leadIn: arcSettings, leadOut: { ...arcSettings, leadType: "line", leadAngle: 45 }, cutDepth: 2 } });
assert(preset.cut?.leadIn?.leadType === "arc" && preset.cut?.leadOut?.leadAngle === 45 && preset.cut.cutDepth === 2, "Preset discarded lead configuration");
assert(Object.isFrozen(preset.cut.leadIn), "Preset lead settings are mutable");
assert(sampleLead(crossing).length > 2, "Arc preview was reduced to a chord");
console.log("Leads passed: tangent arcs, scrap sides, independent exits, tab preservation, collision rejection, ramp slope/XYZ output, analytic G2/G3, arc bounds, units, preset persistence and shared canvas/simulator geometry.");
