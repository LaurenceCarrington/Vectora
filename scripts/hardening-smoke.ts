import { documentModel } from "../src/document/DocumentModel";
import type { CadDocument, Entity, Point2D, PolylineEntity } from "../src/document/types";
import { filePersistence, parseVectoraDocument, type SaveResult } from "../src/io/filePersistence";
import { FACTORY_MATERIAL_PRESETS, usePresetStore } from "../src/store/usePresetStore";
import { mmPerUnit } from "../src/cam/physicalUnits";
import { validateClosedContour } from "../src/cam/contourValidation";
import { buildManufacturingPlan, createDefaultProcesses } from "../src/cam/processModel";
import { optimizeToolpaths } from "../src/cam/optimizer";
import { compileGcode, DEFAULT_GRBL_LASER_PROFILE, PreflightValidationError, validatePreflight } from "../src/cam/gcodeCompiler";
import { EntitySpatialIndex } from "../src/geometry/SpatialIndex";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function near(value: number, expected: number, message: string) {
  assert(Math.abs(value - expected) < 1e-8, message);
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function edit() {
  const layer = documentModel.getDocument().layers[0]!;
  documentModel.updateLayer(layer.id, { name: `${layer.name} edited` });
}
function continueAfterSave(result: SaveResult) {
  if (filePersistence.canContinueAfterSave(result)) documentModel.resetDocument();
}

// Delay each asynchronous boundary and verify that only the captured revision reaches disk.
for (const stage of ["picker", "write", "close"] as const) {
  documentModel.resetDocument();
  filePersistence.markClean();
  edit();
  const original = documentModel.getDocument();
  const entered = deferred();
  const release = deferred();
  let source = "";
  const gate = async (boundary: string) => {
    if (stage === boundary) { entered.resolve(); await release.promise; }
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    showSaveFilePicker: async () => {
      await gate("picker");
      return { name: "race.vectora", createWritable: async () => ({
        write: async (blob: Blob) => { source = await blob.text(); await gate("write"); },
        close: async () => { await gate("close"); },
      }) };
    },
  } });
  const saving = filePersistence.save(true);
  await entered.promise;
  edit();
  const editedVersion = documentModel.getDocument().version;
  release.resolve();
  const result = await saving;
  assert(result.savedAt === filePersistence.getSnapshot().savedAt && !!result.savedRevision, "Committed save metadata was not returned.");
  assert(parseVectoraDocument(source).version === original.version, `${stage}: save snapshot changed during the wait.`);
  continueAfterSave(result);
  assert(filePersistence.isDirty(), `${stage}: additional edits were marked clean.`);
  assert(documentModel.getDocument().id === original.id && documentModel.getDocument().version === editedVersion, `${stage}: unsaved edits were replaced.`);
  const retry = await filePersistence.save();
  assert(filePersistence.canContinueAfterSave(retry), `${stage}: saving again did not permit continuation.`);
  // Also check a late edit after write completion, and a separately marked-clean document.
  edit();
  filePersistence.markClean();
  assert(!filePersistence.canContinueAfterSave(retry), "A later revision bypassed the continuation guard.");
}
Object.defineProperty(globalThis, "window", { configurable: true, value: {
  showSaveFilePicker: async () => { throw new DOMException("Cancelled", "AbortError"); },
} });
edit();
const cancelled = await filePersistence.save(true);
assert(cancelled.status === "cancelled" && !filePersistence.canContinueAfterSave(cancelled) && filePersistence.isDirty(), "Cancelled save permitted replacement.");
let downloadClicked = false;
Object.defineProperty(globalThis, "window", { configurable: true, value: {
  URL,
  setTimeout,
  document: undefined,
} });
Object.defineProperty(globalThis, "document", { configurable: true, value: {
  createElement: () => ({
    href: "",
    download: "",
    click: () => { downloadClicked = true; },
  }),
} });
const downloadFallback = await filePersistence.save(false);
assert(downloadClicked && downloadFallback.status === "download-started", "Download fallback was not reported as unconfirmed.");
assert(filePersistence.isDirty() && !filePersistence.canContinueAfterSave(downloadFallback),
  "An unconfirmed browser download permitted document replacement.");
Object.defineProperty(globalThis, "window", { configurable: true, value: {
  showSaveFilePicker: async () => ({ name: "failed.vectora", createWritable: async () => ({
    write: async () => { throw new Error("Disk full"); }, close: async () => {},
  }) }),
} });
let failed = false;
try { await filePersistence.save(true); } catch { failed = true; }
assert(failed && filePersistence.isDirty(), "Failed write marked the document clean.");
Object.defineProperty(globalThis, "window", { configurable: true, value: {
  showSaveFilePicker: async () => ({ name: "clean.vectora", createWritable: async () => ({ write: async () => {}, close: async () => {} }) }),
} });
const cleanSave = await filePersistence.save(true);
documentModel.selectEntities([]);
assert(filePersistence.canContinueAfterSave(cleanSave), "Selection-only change blocked continuation.");
const previousId = documentModel.getDocument().id;
continueAfterSave(cleanSave);
assert(documentModel.getDocument().id !== previousId, "A clean save did not execute the pending reset.");
Reflect.deleteProperty(globalThis, "window");

const preset = usePresetStore.getState().applyPreset(FACTORY_MATERIAL_PRESETS[0]!.id);
assert(preset.cut?.feedRateUnit === "mm/min", "Factory preset lacks explicit physical feed units.");
const rateMm = preset.cut!.feedRate;
near(rateMm / mmPerUnit("in"), 35.43307086614173, "900 mm/min was not converted to inches/min.");
for (const units of ["mm", "in", "px"] as const) {
  const calibration = { pxPerMm: 4 };
  const factor = mmPerUnit(units, calibration);
  const nativeRate = rateMm / factor;
  const custom = usePresetStore.getState().addPreset({ name: `Round trip ${units}`, thicknessMm: 3, kerfMm: 0.15,
    cut: { feedRate: nativeRate * factor, power: 1_000, passes: 1 } });
  near(custom.cut!.feedRate, 900, `${units}: custom preset stored a native-unit feed.`);
  assert(custom.cut!.feedRateUnit === "mm/min", "Custom preset lacks explicit physical units.");
  usePresetStore.getState().deletePreset(custom.id);
}

const square: readonly Point2D[] = [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 10, y: 30 }];
assert(!validateClosedContour(square), "Valid contour rejected.");
assert(!validateClosedContour([...square, square[0]!]), "Explicit closing vertex rejected.");
assert(!validateClosedContour([...square].reverse()), "Reversed contour rejected.");
assert(!validateClosedContour([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 5, y: 5 }, { x: 0, y: 10 }]), "Simple concave loop rejected.");
const corruptLoops = [
  [{ x: 10, y: 10 }, { x: 30, y: 30 }, { x: 10, y: 30 }, { x: 30, y: 10 }], // zero-area bowtie
  [{ x: 0, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }, { x: 30, y: 0 }], // nonzero-area crossing
  [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }],
  [square[0]!, square[0]!, ...square.slice(1)],
  [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], // retracing
  [square[0]!, square[1]!, square[2]!, square[0]!, square[3]!], // nonadjacent touch
  [square[0]!, { x: NaN, y: 0 }, square[2]!],
];
function loop(points: readonly Point2D[], id = "loop"): PolylineEntity {
  return { id, layerId: "cut", type: "polyline", intent: "cut", closed: true, points, visible: true, locked: false,
    style: { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] },
    bbox: { minX: 0, minY: 0, maxX: 30, maxY: 30 } };
}
function planFor(entities: readonly Entity[], units: CadDocument["units"] = "mm", kerfWidth = 0) {
  const document: CadDocument = { ...documentModel.getDocument(), units, entities: new Map(entities.map((e) => [e.id, e])) };
  return buildManufacturingPlan(document, { processes: createDefaultProcesses({ kerfWidth,
    cutFeedRate: rateMm / mmPerUnit(units, { pxPerMm: 4 }) }) });
}
const profile = { ...DEFAULT_GRBL_LASER_PROFILE, bedWidth: 40, bedHeight: 40, originAlignment: "document" as const };
for (const points of corruptLoops) {
  assert(!!validateClosedContour(points), "Corrupt contour passed validation.");
  const plan = planFor([loop(points, "bad-loop")], "mm", 0.15);
  const report = validatePreflight(plan, profile);
  assert(report.hasCriticalErrors && report.errors.some((e) => e.entityId === "bad-loop" && e.layerId === "cut"), "Source error or offending IDs lost during kerf offset.");
  let rejected = false;
  try { compileGcode(optimizeToolpaths(plan), profile); } catch (error) { rejected = error instanceof PreflightValidationError; }
  assert(rejected, "Compiler bypassed corrupt-loop preflight.");
}
assert(validatePreflight(planFor([loop(square)]), profile).hasCriticalErrors === false, "Safe job rejected.");
const safePlan = planFor([loop(square)]);
const tinyFeedPlan = { ...safePlan, toolpaths: safePlan.toolpaths.map((path) => ({ ...path, feedRate: 0.0004 })) };
assert(validatePreflight(tinyFeedPlan, profile).errors.some((error) => error.message.includes("Feed rate")), "A feed that serializes to zero passed preflight.");
assert(validatePreflight(safePlan, { ...profile, rapidFeedRate: 0.0004 }).errors.some((error) => error.code === "invalid-machine"), "A rapid feed that serializes to zero passed preflight.");
const collapsedPlan = { ...safePlan, toolpaths: safePlan.toolpaths.map((path) => ({ ...path, closed: false,
  points: [{ x: 10, y: 10 }, { x: 10.0004, y: 10.0004 }] })) };
assert(validatePreflight(collapsedPlan, profile).errors.some((error) => error.message.includes("collapses below")), "A path that collapses at controller precision passed preflight.");
const base = loop(square);
const circle: Entity = { ...base, type: "circle", center: { x: 20, y: 20 }, radius: 10 };
assert(!validatePreflight(planFor([circle]), profile).hasCriticalErrors, "Valid circle rejected.");
for (const cornerRadius of [2, 10]) {
  const rounded: Entity = { ...base, type: "rectangle", origin: { x: 10, y: 10 }, width: 20, height: 20, cornerRadius };
  assert(!validatePreflight(planFor([rounded]), profile).hasCriticalErrors, "Valid rounded rectangle rejected at tangent joins.");
}
const crossingBed = loop(square.map((p) => ({ x: p.x + 25, y: p.y })), "over-bed");
assert(validatePreflight(planFor([crossingBed]), profile).errors.some((e) => e.code === "out-of-bounds" && e.entityId === "over-bed"), "Document origin ignored bed bounds.");
assert(!validatePreflight(planFor([crossingBed]), { ...profile, originAlignment: "lower-left" }).hasCriticalErrors, "Lower-left alignment was not applied before bounds check.");
assert(!validatePreflight(planFor([crossingBed]), { ...profile, originAlignment: "center", origin: { x: 20, y: 20 } }).hasCriticalErrors, "Center alignment was not applied before bounds check.");
assert(validatePreflight(planFor([loop(square)]), { ...profile, originAlignment: "center" }).hasCriticalErrors, "Negative centered travel passed preflight.");
const atEdge = loop([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }]);
assert(!validatePreflight(planFor([atEdge]), profile).hasCriticalErrors, "Exact bed boundary rejected.");
assert(validatePreflight(planFor([atEdge], "mm", 0.2), profile).hasCriticalErrors, "Kerf expansion beyond bed passed preflight.");
assert(validatePreflight(planFor([atEdge], "mm", 0.2), { ...profile, originAlignment: "lower-left" }).hasCriticalErrors, "Oversized offset job passed lower-left preflight.");
assert(validatePreflight(planFor([loop(square)]), { ...profile, bedWidth: 0 }).hasCriticalErrors, "Invalid bed dimensions passed preflight.");
assert(validatePreflight(planFor([loop(square)]), { ...profile, origin: { x: -50, y: 0 } }).hasCriticalErrors, "Negative origin travel passed preflight.");
const inchPlan = planFor([loop(square.map((p) => ({ x: p.x / 25.4, y: p.y / 25.4 })))], "in");
assert(!validatePreflight(inchPlan, profile).hasCriticalErrors, "Inch document bounds were not converted to mm.");
assert(compileGcode(optimizeToolpaths(inchPlan), profile).includes("F900"), "Physical preset feed changed during inch G-code output.");
const inchMachine = { ...profile, units: "in" as const, bedWidth: 40 / 25.4, bedHeight: 40 / 25.4 };
assert(!validatePreflight(planFor([loop(square)]), inchMachine).hasCriticalErrors, "Millimetre document bounds were not converted to inch machine units.");
const pixelPlan = planFor([loop(square)], "px");
assert(validatePreflight(pixelPlan, profile).errors.some((e) => e.code === "pixel-calibration"), "Uncalibrated pixels passed preflight.");
assert(!validatePreflight(pixelPlan, profile, { physicalScale: { pxPerMm: 4 } }).hasCriticalErrors, "Calibrated pixels failed preflight.");
assert(compileGcode(optimizeToolpaths(pixelPlan), profile, { physicalScale: { pxPerMm: 4 } }).includes("F900"), "Calibrated pixel preset feed changed during G-code output.");

const spatial = new EntitySpatialIndex();
const remote = { ...loop(square, "remote"), points: square.map((point) => ({ x: point.x + Number.MAX_VALUE / 2, y: point.y })),
  bbox: { minX: Number.MAX_VALUE / 2, minY: 0, maxX: Number.MAX_VALUE / 2, maxY: 1 } };
spatial.insert(remote);
assert(spatial.query(remote.bbox, []).some((entity) => entity.id === remote.id), "Unsafe cell coordinates did not use the bounded overflow path.");
const local = loop(square, "local");
spatial.insert(local);
assert(spatial.query({ minX: -Number.MAX_VALUE, minY: -Number.MAX_VALUE, maxX: Number.MAX_VALUE, maxY: Number.MAX_VALUE }, []).length === 2,
  "A huge spatial query did not fall back to a bounded bucket scan.");
console.log("Save continuation races, physical preset feeds, source-loop integrity, machine bed/origin/kerf bounds, and compiler enforcement checks passed.");
