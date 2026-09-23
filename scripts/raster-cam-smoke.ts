import * as THREE from "three";
import type { CadDocument, Entity, ImageEntity, Point2D, RectangleEntity } from "../src/document/types";
import { calculateEntityBounds, documentModel } from "../src/document/DocumentModel";
import { DEFAULT_RASTER_SETTINGS, decodeRgba, ditherGrayscale, encodeRgba, generateRasterToolpath, imagePoint,
  processRasterPixels, rasterPowerMap, type RasterSettings } from "../src/cam/rasterCamEngine";
import { buildManufacturingPlan } from "../src/cam/processModel";
import { optimizeToolpaths } from "../src/cam/optimizer";
import { compileGcode, DEFAULT_GRBL_LASER_PROFILE, DEFAULT_MARLIN_LASER_PROFILE, machineDocumentTransform, validatePreflight } from "../src/cam/gcodeCompiler";
import { ToolpathSimulator } from "../src/cam/ToolpathSimulator";
import { parseVectoraDocument, serializeVectoraDocument } from "../src/io/filePersistence";
import { rotateEntities, translateEntities } from "../src/renderer/TransformOverlay";
import { createRasterSurfaceMesh } from "../src/3d/rasterSurface";
import { groupPreviewEntities } from "../src/3d/threeEngine";
import { drawRasterImage } from "../src/renderer/RasterOverlay";
import { UpdateEntitiesCommand, executeCommand, history } from "../src/document/History";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function close(a: number, b: number, message: string, tolerance = 1e-7): void { assert(Math.abs(a - b) <= tolerance, `${message}: ${a} != ${b}`); }
function same(a: Point2D, b: Point2D, message: string): void { close(a.x, b.x, message); close(a.y, b.y, message); }
function rejects(action: () => unknown, message: string): void { let rejected = false; try { action(); } catch { rejected = true; } assert(rejected, message); }
const settings = DEFAULT_RASTER_SETTINGS;
const source = [20,84,128,173,235, 240,180,120,70,10, 64,64,64,64,64, 192,192,192,192,192];
// Golden matrices calculated independently using exact rational arithmetic and the published kernels.
const golden = {
  "floyd-steinberg": [1,1,0,0,0, 0,0,1,1,1, 1,1,1,0,1, 0,0,0,0,0],
  "jarvis-judice-ninke": [1,1,0,0,0, 0,0,1,1,1, 1,1,1,1,1, 0,0,0,0,0],
  threshold: [1,1,0,0,0, 0,0,1,1,1, 1,1,1,1,1, 0,0,0,0,0],
};
for (const algorithm of ["floyd-steinberg", "jarvis-judice-ninke", "threshold"] as const) {
  const actual = [...ditherGrayscale(source, 5, 4, { ...settings, algorithm })].map((p) => p / 1000);
  assert(JSON.stringify(actual) === JSON.stringify(golden[algorithm]), `${algorithm} matrix differs from the reference`);
  const mean = ditherGrayscale(new Uint8Array(64 * 64).fill(128), 64, 64, { ...settings, algorithm });
  if (algorithm !== "threshold") close(mean.reduce((a, b) => a + b, 0) / mean.length / 1000, 127 / 255, "Diffusion lost average luminance", 0.025);
}
assert(source[0] === 20 && source[19] === 192, "Dithering mutated source pixels");
const multi = ditherGrayscale([0, 85, 170, 255], 4, 1, { ...settings, algorithm: "threshold", levels: 4, minPower: 100, maxPower: 1000 });
assert(JSON.stringify([...multi]) === "[1000,700,400,0]", "Multi-level min/max mapping or white-off semantics failed");
rejects(() => ditherGrayscale([NaN], 1, 1, settings), "NaN grayscale accepted");
rejects(() => ditherGrayscale([0], 1, 1, { ...settings, dpi: 0 }), "Zero DPI accepted");
rejects(() => ditherGrayscale([0], 1, 1, { ...settings, minPower: 1000 }), "Invalid min/max accepted");
const transparent = processRasterPixels({ width: 1, height: 1, data: [0,0,0,0] }, 1, 1, { ...settings, contrast: 0, threshold: 255 });
assert(transparent.powers[0] === 0, "Transparent pixels burned after contrast/diffusion");
const gray = processRasterPixels({ width: 3, height: 1, data: [255,0,0,255, 0,255,0,255, 0,0,255,255] }, 3, 1, settings);
assert(JSON.stringify([...gray.grayscale]) === "[54,182,18]", "8-bit luminance conversion incorrect");
const dim = { width: 1, height: 1, data: [64,64,64,255] };
assert(processRasterPixels(dim, 1, 1, { ...settings, gamma: 2 }).grayscale[0]! > processRasterPixels(dim, 1, 1, settings).grayscale[0]!, "Gamma did not lighten midtones");
assert(processRasterPixels(dim, 1, 1, { ...settings, contrast: 2 }).grayscale[0]! < 64, "Contrast did not deepen shadows");

const layerId = documentModel.getActiveLayer().id;
function bitmap(id: string, width = 0.4, height = 0.2, raster: RasterSettings = { ...settings, algorithm: "threshold", overscan: 1 }): ImageEntity {
  const entity: ImageEntity = { id, type: "image", name: "Asymmetric test bitmap", layerId, intent: "raster", visible: true, locked: false,
    origin: { x: 10, y: 10 }, right: { x: 10 + width, y: 10 }, top: { x: 10, y: 10 + height },
    pixelWidth: 4, pixelHeight: 2, rgba: encodeRgba([0,255,255,0, 255,0,0,255].flatMap((v) => [v,v,v,255])), raster,
    bbox: { minX: 10, minY: 10, maxX: 10 + width, maxY: 10 + height }, style: { strokeColor: null, strokeWidth: 0, fillColor: null, dashArray: [] } };
  return entity;
}
const image = bitmap("photo");
assert(decodeRgba(image).length === 32, "Embedded RGBA did not round-trip");
rejects(() => decodeRgba({ ...image, rgba: "corrupt" }), "Invalid embedded pixel data accepted");
const map = rasterPowerMap(image, 1);
assert(map.width === 4 && map.height === 2, "254 DPI did not produce 0.1 mm pixels");
const raster = generateRasterToolpath(image, 1);
assert(raster.lines.length === 2, "Wrong scanline count");
close(raster.interval, 0.1, "Line interval scaling");
same(raster.lines[0]!.start, { x: 9, y: 10.15 }, "First line orientation / overscan");
same(raster.lines[1]!.start, { x: 11.4, y: 10.05 }, "Zigzag did not reverse second row");
assert(raster.lines.every((l) => l.runs[0]!.power === 0 && l.runs.at(-1)!.power === 0), "Overscan has burn power");
assert(raster.lines[0]!.runs.length === 5, "Consecutive white pixels were not merged");
close(raster.lines[0]!.runs[2]!.end.x, 10.3, "White run ends at wrong pixel edge");
const asymmetric = { ...image, rgba: encodeRgba([0,85,170,255, 0,85,170,255].flatMap((v) => [v,v,v,255])), raster: { ...image.raster, levels: 4 } };
const reversePowers = generateRasterToolpath(asymmetric, 1).lines[1]!.runs.slice(1, -1).map((run) => run.power);
assert(JSON.stringify(reversePowers) === "[0,333,667,1000]", "Reverse scan mirrored the power map instead of preserving image placement");
const forward = generateRasterToolpath({ ...image, raster: { ...image.raster, bidirectional: false } }, 1);
assert(forward.lines.every((l) => l.start.x === 9), "Unidirectional scan reversed a row");
const vertical = generateRasterToolpath({ ...image, raster: { ...image.raster, scanAngle: 90 } }, 1);
assert(vertical.lines.length === 4, "Vertical scan did not transpose traversal");
close(vertical.lines[0]!.start.x, 10.05, "Vertical cross-axis pixel center");
close(vertical.lines[0]!.start.y, 11.2, "Vertical first overscan");
close(vertical.lines[1]!.start.y, 9, "Vertical zigzag overscan");
for (const [units, factor] of [["mm", 1], ["in", 25.4], ["px", 0.25]] as const) {
  const scaled: ImageEntity = { ...image, origin: { x: 10 / factor, y: 10 / factor }, right: { x: 10.4 / factor, y: 10 / factor }, top: { x: 10 / factor, y: 10.2 / factor } };
  const generated = generateRasterToolpath(scaled, factor);
  close(generated.interval * factor, 0.1, `${units} physical interval`);
  same({ x: generated.lines[0]!.start.x * factor, y: generated.lines[0]!.start.y * factor }, raster.lines[0]!.start, `${units} physical overscan`);
}
const partial = bitmap("partial", 0.35, 0.15);
const partialMap = rasterPowerMap(partial, 1);
const partialRaster = generateRasterToolpath(partial, 1);
assert(partialMap.width === 4 && partialMap.height === 2, "Partial edge cells omitted");
close(partialMap.stepX, 0.1 / 0.35, "Preview cells were stretched to fit bitmap");
close(partialRaster.lines[1]!.start.y, 10.025, "Partial final row center incorrect");
const blank = { ...image, rgba: encodeRgba(new Uint8Array(32).fill(255)) };
assert(generateRasterToolpath(blank, 1).lines.length === 0, "All-white bitmap generated burn paths");
rejects(() => rasterPowerMap(bitmap("huge", 1000, 1000), 1), "Raster output budget not enforced");
rejects(() => rasterPowerMap({ ...image, right: image.origin }, 1), "Collapsed bitmap accepted");
rejects(() => rasterPowerMap({ ...image, top: { x: 10.1, y: 10.2 } }, 1), "Skewed bitmap accepted as orthogonal scan grid");

const documentFor = (entities: readonly Entity[], units: CadDocument["units"] = "mm"): CadDocument => ({ ...documentModel.getDocument(), units, entities: new Map(entities.map((e) => [e.id, e])) });
const boundary: RectangleEntity = { ...image, id: "cut", type: "rectangle", intent: "cut", origin: { x: 5, y: 5 }, width: 10, height: 10, cornerRadius: 0, bbox: { minX: 5, minY: 5, maxX: 15, maxY: 15 } };
const plan = optimizeToolpaths(buildManufacturingPlan(documentFor([image, boundary])), { startPosition: { x: 20, y: 20 } });
assert(plan.toolpaths[0]!.raster, "Raster was not ordered before release cuts");
same(plan.toolpaths[0]!.points[0]!, raster.lines[0]!.start, "Optimizer reversed scanline powers");
const profile = { ...DEFAULT_GRBL_LASER_PROFILE, originAlignment: "document" as const, returnToOrigin: false };
const rasterPlan = optimizeToolpaths(buildManufacturingPlan(documentFor([image])));
const code = compileGcode(rasterPlan, profile);
assert(code.includes("G0 X9 Y10.15 S0\nM4 S0\nG1 X10 Y10.15 S0 F3000"), "Missing first overscan or unsafe power on positioning");
assert(code.includes("G1 X10.1 Y10.15 S1000 F3000") && code.includes("G1 X10.3 Y10.15 S0 F3000"), "Pixel-run modulation is shifted");
assert(code.includes("G1 X11.4 Y10.15 S0 F3000\nM5"), "Missing off exit overscan");
assert(!/^\$32=/m.test(code), "Compiler unexpectedly changed persistent firmware configuration");
const m3Code = compileGcode(rasterPlan, { ...profile, laserOnCommand: "M3" });
assert(m3Code.includes("M3 S0"), "Constant-power laser mode missing");
assert(validatePreflight(rasterPlan, { ...profile, mode: "spindle" }).hasCriticalErrors, "Raster accepted a spindle profile");
assert(validatePreflight(rasterPlan, DEFAULT_MARLIN_LASER_PROFILE).hasCriticalErrors, "Unconfigured Marlin inline-power behavior was assumed");
assert(validatePreflight(rasterPlan, { ...profile, maxPower: 500 }).hasCriticalErrors, "Raster S exceeded machine maximum");
assert(validatePreflight(rasterPlan, { ...profile, bedWidth: 10.5 }).hasCriticalErrors, "Overscan outside bed accepted");
const unsafeRaster = { ...rasterPlan, toolpaths: rasterPlan.toolpaths.map((path) => ({ ...path, raster: { ...path.raster!, lines: path.raster!.lines.map((line, index) => index === 0 ? { ...line, runs: line.runs.map((run, i) => i === 0 ? { ...run, power: 1000 } : run) } : line) } })) };
assert(validatePreflight(unsafeRaster, profile).hasCriticalErrors, "Preflight allowed laser power during the entry overscan");
const pixelPlan = optimizeToolpaths(buildManufacturingPlan(documentFor([image], "px")));
assert(pixelPlan.geometryErrors?.length, "Uncalibrated pixel raster was accepted");
const calibrated = optimizeToolpaths(buildManufacturingPlan(documentFor([image], "px"), { physicalScale: { pxPerMm: 4 } }));
assert(!validatePreflight(calibrated, profile, { physicalScale: { pxPerMm: 4 } }).hasCriticalErrors, "Calibrated pixel raster rejected");
const inchCode = compileGcode(rasterPlan, { ...profile, units: "in", bedWidth: 20, bedHeight: 20 });
assert(inchCode.includes("G20") && inchCode.includes("X0.35433"), "Inch output did not convert overscan");
const alignment = machineDocumentTransform(rasterPlan, DEFAULT_GRBL_LASER_PROFILE);
close(alignment.offsetX, -9, "Job-origin alignment omitted overscan");

const simulator = new ToolpathSimulator();
simulator.setPlan(rasterPlan, { machineProfile: profile });
assert(simulator.getSegments().some((s) => s.role === "raster-off" && s.feedRate === 3000), "Overscan simulated at rapid feed or with laser on");
close(simulator.getSegments().filter((s) => s.kind === "cut").reduce((sum, s) => sum + s.distance, 0), 0.4, "Simulated black length differs from pixel map");
simulator.dispose();

const serialized = serializeVectoraDocument(documentFor([image]));
const restored = parseVectoraDocument(serialized).entities[0]!;
assert(restored.type === "image" && restored.rgba === image.rgba && restored.raster.algorithm === "threshold", "Native save lost pixels/settings");
const corrupt = JSON.parse(serialized); corrupt.document.entities[0].rgba = "broken";
rejects(() => parseVectoraDocument(JSON.stringify(corrupt)), "Native parser accepted corrupt raster payload");
const translated = translateEntities([image], { x: 2, y: -3 })[0]! as ImageEntity;
same(translated.origin, { x: 12, y: 7 }, "Image movement failed");
const rotated = rotateEntities([image], image.origin, Math.PI / 2)[0]! as ImageEntity;
same(imagePoint(rotated, 1, 1), { x: 10, y: 10.4 }, "Image rotation lost placement");
assert(rotated.rgba === image.rgba && rotated.type === "image", "Image transform converted to vectors");
same(generateRasterToolpath(rotated, 1).lines[0]!.start, { x: 9.85, y: 9 }, "Rotated raster did not rotate scan/overscan");
const bounds = calculateEntityBounds(rotated);
close(bounds.minX, 9.8, "Rotated image bounds wrong");
documentModel.addEntity(image);
executeCommand(new UpdateEntitiesCommand([image], [{ ...image, raster: { ...image.raster, gamma: 2 } }], "Raster gamma"));
history.undo();
assert((documentModel.getDocument().entities.get(image.id) as ImageEntity).raster.gamma === 1, "Raster settings undo failed");
documentModel.removeEntity(image.id);

const mesh = createRasterSurfaceMesh(partial, 3, 1, { x: 10, y: 10 });
const material = mesh.material as THREE.MeshStandardMaterial;
const texture = material.map as THREE.DataTexture;
const textureData = texture.image.data as Uint8Array;
assert(textureData[3] === 255 && textureData[7] === 0, "3D char map differs from first black/white pixels");
close(mesh.geometry.getAttribute("position").getZ(0), 3.015, "Raster surface changed stock depth", 1e-6);
close(mesh.geometry.getAttribute("uv").getX(1), 0.875, "3D preview stretched partial cells");
close(mesh.geometry.getAttribute("uv").getY(2), 0, "3D texture rows were inverted");
assert(groupPreviewEntities([image]).raster.length === 1, "3D grouping omitted bitmap");
texture.dispose(); material.dispose(); mesh.geometry.dispose();

const savedDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
let previewBytes: Uint8ClampedArray = new Uint8ClampedArray();
Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => ({ width: 0, height: 0, getContext: () => ({
  createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  putImageData: (data: { data: Uint8ClampedArray }) => { previewBytes = data.data; },
}) }) } });
try {
  let matrix: number[] = [], extent: number[] = [];
  const ctx = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, transform: (...values: number[]) => { matrix = values; },
    drawImage: (_canvas: unknown, ...values: number[]) => { extent = values; } } as unknown as CanvasRenderingContext2D;
  drawRasterImage(ctx, partial, 1);
  assert(previewBytes[0] === 0 && previewBytes[4] === 255, "Canvas dither pixels do not match CAM");
  close(matrix[3]!, -0.15, "Canvas did not map top-down rows to world Y");
  close(extent[2]!, 0.4 / 0.35, "Canvas stretched partial cells instead of clipping");
} finally {
  if (savedDocument) Object.defineProperty(globalThis, "document", savedDocument); else Reflect.deleteProperty(globalThis, "document");
}
console.log("Raster CAM passed: reference dithering matrices, levels/alpha/gamma, scan order, exact intervals, overscan/S0, units, preflight, optimizer/simulator, native persistence/undo, transforms, canvas and 3D char map.");
