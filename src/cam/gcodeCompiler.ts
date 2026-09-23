import type { BoundingBox, DocumentUnits, Point2D } from "../document/types";
import type { OptimizedManufacturingPlan } from "./optimizer";
import { splitPathForHoldingTabs, type HoldingTabOptions } from "./holdingTabs";
import type { ManufacturingPlan, PreflightIssue, PreflightReport } from "./processModel";
import { validateClosedContour } from "./contourValidation";
import { validatePocketSettings } from "./pocketingEngine";
import { rampForDepth, leadExtrema, prepareCutPath, type LeadMotion, type PreparedCut } from "./leadGeometry";
import { validateTool } from "./toolStore";
export type { PreflightReport } from "./processModel";

export type GcodeDialect = "grbl" | "marlin";
export type MachineMode = "laser" | "spindle";
export type OriginAlignment = "document" | "lower-left" | "center";

export interface MachineProfile {
  readonly name: string;
  readonly dialect: GcodeDialect;
  readonly mode: MachineMode;
  readonly units: Exclude<DocumentUnits, "px">;
  /** Positive XY travel envelope, in machine units, from (0, 0). */
  readonly bedWidth: number;
  readonly bedHeight: number;
  /** Overrides per-process feed rates, in machine units per minute, when supplied. */
  readonly feedRate?: number;
  readonly rapidFeedRate: number;
  readonly maxPower: number;
  readonly originAlignment: OriginAlignment;
  readonly origin: Point2D;
  readonly safeZ: number;
  readonly workZ: number;
  /** Stock surface in machine units; defaults to 0 for ramps. */
  readonly stockSurfaceZ?: number;
  readonly plungeRate: number;
  readonly laserOnCommand: "M3" | "M4";
  readonly decimalPlaces: number;
  readonly returnToOrigin: boolean;
}

export interface GcodeCompileOptions {
  readonly holdingTabs?: HoldingTabOptions | false;
  readonly physicalScale?: PixelPhysicalScale;
}

/** Physical calibration for documents whose coordinates are stored in CSS pixels. */
export interface PixelPhysicalScale {
  readonly pxPerMm: number;
}

export class PixelCalibrationRequiredError extends Error {
  constructor(message = "Pixel documents require a valid physical scale before CAM output can be generated.") {
    super(message);
    this.name = "PixelCalibrationRequiredError";
  }
}

export const DEFAULT_GRBL_LASER_PROFILE: Readonly<MachineProfile> = Object.freeze({
  name: "GRBL laser",
  dialect: "grbl",
  mode: "laser",
  units: "mm",
  bedWidth: 300,
  bedHeight: 200,
  rapidFeedRate: 6_000,
  maxPower: 1_000,
  originAlignment: "lower-left",
  origin: Object.freeze({ x: 0, y: 0 }),
  safeZ: 5,
  workZ: 0,
  plungeRate: 300,
  laserOnCommand: "M4",
  decimalPlaces: 3,
  returnToOrigin: true,
});

export const DEFAULT_MARLIN_LASER_PROFILE: Readonly<MachineProfile> = Object.freeze({
  ...DEFAULT_GRBL_LASER_PROFILE,
  name: "Marlin laser",
  dialect: "marlin",
  laserOnCommand: "M3",
});

const EPSILON = 1e-9;

function assertProfile(profile: MachineProfile): void {
  if (!profile.name.trim()) throw new TypeError("Machine profile name cannot be empty.");
  if (profile.dialect !== "grbl" && profile.dialect !== "marlin") throw new TypeError("Machine dialect must be GRBL or Marlin.");
  if (profile.mode !== "laser" && profile.mode !== "spindle") throw new TypeError("Machine mode must be laser or spindle.");
  if (profile.units !== "mm" && profile.units !== "in") throw new TypeError("Machine units must be millimetres or inches.");
  if (profile.originAlignment !== "document" && profile.originAlignment !== "lower-left" && profile.originAlignment !== "center") {
    throw new TypeError("Machine origin alignment is not supported.");
  }
  if (profile.laserOnCommand !== "M3" && profile.laserOnCommand !== "M4") throw new TypeError("Laser-on command must be M3 or M4.");
  if (profile.stockSurfaceZ !== undefined && !Number.isFinite(profile.stockSurfaceZ)) throw new TypeError("Stock surface Z must be finite.");
  const positive = [
    [profile.rapidFeedRate, "Rapid feed rate"],
    [profile.maxPower, "Maximum power"],
    [profile.plungeRate, "Plunge rate"],
    [profile.bedWidth, "Bed width"],
    [profile.bedHeight, "Bed height"],
  ] as const;
  for (const [value, label] of positive) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be greater than zero.`);
  }
  if (profile.feedRate !== undefined && (!Number.isFinite(profile.feedRate) || profile.feedRate <= 0)) {
    throw new RangeError("Feed rate override must be greater than zero.");
  }
  if (!Number.isInteger(profile.decimalPlaces) || profile.decimalPlaces < 0 || profile.decimalPlaces > 6) {
    throw new RangeError("Decimal places must be an integer from 0 to 6.");
  }
  for (const [value, label] of [
    [profile.origin.x, "Origin X"],
    [profile.origin.y, "Origin Y"],
    [profile.safeZ, "Safe Z"],
    [profile.workZ, "Work Z"],
  ] as const) {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite.`);
  }
}

export function documentToMachineScale(
  source: DocumentUnits,
  target: MachineProfile["units"],
  physicalScale?: PixelPhysicalScale,
): number {
  if (source === "px") {
    const pxPerMm = physicalScale?.pxPerMm;
    if (pxPerMm === undefined || !Number.isFinite(pxPerMm) || pxPerMm <= 0) {
      throw new PixelCalibrationRequiredError();
    }
    return target === "mm" ? 1 / pxPerMm : 1 / (pxPerMm * 25.4);
  }
  if (source === target) return 1;
  return source === "in" ? 25.4 : 1 / 25.4;
}

function planBounds(plan: ManufacturingPlan, scale: number, prepared?: ReadonlyMap<string, PreparedCut>): BoundingBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const toolpath of plan.toolpaths) {
    const cut = prepared?.get(toolpath.id);
    const leads = [cut?.leadIn, cut?.leadOut].flatMap((motion) => motion ? leadExtrema(motion) : []);
    for (const point of [...toolpath.points, ...leads]) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      minX = Math.min(minX, point.x * scale);
      minY = Math.min(minY, point.y * scale);
      maxX = Math.max(maxX, point.x * scale);
      maxY = Math.max(maxY, point.y * scale);
    }
  }
  return Number.isFinite(minX)
    ? { minX, minY, maxX, maxY }
    : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

function coordinateOffset(
  bounds: BoundingBox,
  profile: MachineProfile,
): Point2D {
  switch (profile.originAlignment) {
    case "lower-left":
      return { x: profile.origin.x - bounds.minX, y: profile.origin.y - bounds.minY };
    case "center":
      return {
        x: profile.origin.x - (bounds.minX + bounds.maxX) / 2,
        y: profile.origin.y - (bounds.minY + bounds.maxY) / 2,
      };
    case "document":
      return profile.origin;
  }
}

/** The compiler's exact XY transform, in mm, for mapping live work position to the drawing. */
export function machineDocumentTransform(plan: ManufacturingPlan, profile: MachineProfile, physicalScale?: PixelPhysicalScale, options: Pick<GcodeCompileOptions, "holdingTabs"> = {}) {
  const scale = documentToMachineScale(plan.units, profile.units, physicalScale);
  const prepared = preparePlanCutMotions(plan, profile, { ...options, ...(physicalScale ? { physicalScale } : {}) });
  const offset = coordinateOffset(planBounds(plan, scale, prepared), profile);
  const factor = profile.units === "in" ? 25.4 : 1;
  return {
    documentId: plan.documentId, documentVersion: plan.documentVersion,
    mmPerUnit: scale * factor, offsetX: offset.x * factor, offsetY: offset.y * factor,
  };
}

function formatNumber(value: number, decimals: number): string {
  const normalized = Math.abs(value) <= EPSILON ? 0 : value;
  return normalized.toFixed(decimals).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function comment(value: string): string {
  return `; ${value.replace(/[\r\n]+/g, " ")}`;
}

function outputPrecision(plan: ManufacturingPlan, profile: MachineProfile): number {
  const arcs = plan.toolpaths.some((path) => path.leads?.leadIn.leadType === "arc" || path.leads?.leadOut.leadType === "arc");
  return arcs || plan.toolpaths.some((path) => path.raster) ? Math.max(profile.decimalPlaces, profile.units === "in" ? 5 : 4) : profile.decimalPlaces;
}

/** One late preparation step shared by compiler, preflight, simulator and live-head transform. */
export function preparePlanCutMotions(plan: ManufacturingPlan, profile: MachineProfile, options: GcodeCompileOptions = {}): ReadonlyMap<string, PreparedCut> {
  const scale = documentToMachineScale(plan.units, profile.units, options.physicalScale);
  const unitsPerMm = (profile.units === "in" ? 1 / 25.4 : 1) / scale;
  const result = new Map<string, PreparedCut>();
  for (const toolpath of plan.toolpaths) {
    if (toolpath.processType !== "vector-cut") continue;
    result.set(toolpath.id, prepareCutPath(toolpath, { unitsPerMm, mode: profile.mode,
      surfaceZ: (profile.stockSurfaceZ ?? 0) / scale, workZ: toolpath.depth !== undefined ? (profile.stockSurfaceZ ?? 0) / scale - toolpath.depth : profile.workZ / scale,
      ...(options.holdingTabs ? { holdingTabs: options.holdingTabs } : {}), neighbors: plan.toolpaths.filter((path) => !path.raster) }));
  }
  return result;
}

export class PreflightValidationError extends Error {
  constructor(readonly report: PreflightReport) {
    super(report.errors.map((error) => error.message).join("\n"));
    this.name = "PreflightValidationError";
  }
}

/** Validate source loops and actual machine-space coordinates using the compiler's transform.
 * Bed boundary coordinates are permitted; no tolerance permits travel beyond the envelope.
 */
export function validatePreflight(
  plan: ManufacturingPlan,
  machineProfile: MachineProfile,
  options: GcodeCompileOptions = {},
): PreflightReport {
  const errors: PreflightIssue[] = [...(plan.geometryErrors ?? [])];
  const toolIds = new Set(plan.toolpaths.flatMap(path => path.tool ? [path.tool.id] : []));
  if (toolIds.size > 1) errors.push({ severity: "critical", code: "invalid-toolpath", message: "Use one mounted cutter per program; automatic tool changes are not configured." });
  let scale = 1;
  try {
    assertProfile(machineProfile);
    scale = documentToMachineScale(plan.units, machineProfile.units, options.physicalScale);
  } catch (error) {
    errors.push({ severity: "critical", code: error instanceof PixelCalibrationRequiredError ? "pixel-calibration" : "invalid-machine",
      message: error instanceof Error ? error.message : "Invalid machine profile." });
    return Object.freeze({ hasCriticalErrors: true, errors: Object.freeze(errors) });
  }
  let prepared: ReadonlyMap<string, PreparedCut> = new Map();
  try { prepared = preparePlanCutMotions(plan, machineProfile, options); }
  catch (error) { errors.push({ severity: "critical", code: "invalid-toolpath", message: error instanceof Error ? error.message : "Lead preparation failed." }); }
  const decimals = outputPrecision(plan, machineProfile);
  const profileFeeds: Array<readonly [number, string]> = [[machineProfile.rapidFeedRate, "Rapid feed rate"]];
  if (machineProfile.mode === "spindle") profileFeeds.push([machineProfile.plungeRate, "Plunge rate"]);
  if (machineProfile.feedRate !== undefined) profileFeeds.push([machineProfile.feedRate, "Feed rate override"]);
  const unresolvedProfileFeed = profileFeeds.find(([feed]) => Number(formatNumber(feed, decimals)) <= 0);
  if (unresolvedProfileFeed) {
    errors.push({ severity: "critical", code: "invalid-machine", message: `${unresolvedProfileFeed[1]} is below the controller output precision.` });
  }
  const offset = coordinateOffset(planBounds(plan, scale, prepared), machineProfile);
  const outside = (p: Point2D) => !Number.isFinite(p.x) || !Number.isFinite(p.y) ||
    p.x < 0 || p.y < 0 || p.x > machineProfile.bedWidth || p.y > machineProfile.bedHeight;
  for (const toolpath of plan.toolpaths) {
    const ids = { entityId: toolpath.sourceEntityId, ...(toolpath.sourceLayerId ? { layerId: toolpath.sourceLayerId } : {}) };
    const label = `layer ${toolpath.sourceLayerId ?? "unknown"}, entity ${toolpath.sourceEntityId}`;
    const effectiveFeed = machineProfile.feedRate ?? toolpath.feedRate * scale;
    if (!Number.isFinite(effectiveFeed) || effectiveFeed <= 0 || Number(formatNumber(effectiveFeed, decimals)) <= 0) {
      errors.push({ severity: "critical", code: "invalid-toolpath", ...ids, message: `Feed rate is invalid or below controller output precision (${label}).` });
    }
    try {
      if (toolpath.tool) {
        validateTool(toolpath.tool);
        if ((toolpath.tool.type === "laser") !== (machineProfile.mode === "laser")) throw new Error("Selected tool does not match the machine mode.");
        if (toolpath.tool.type !== "laser" && toolpath.spindleRPM === undefined) throw new Error("The selected cutter requires a spindle speed.");
        const stepdownMm = (toolpath.pocket?.stepdown ?? toolpath.stepdown ?? (machineProfile.mode === "spindle" ? Math.max(0, (machineProfile.stockSurfaceZ ?? 0) - machineProfile.workZ) / scale : 0)) * scale * (machineProfile.units === "in" ? 25.4 : 1);
        if (stepdownMm > toolpath.tool.maxStepdown + EPSILON) throw new Error("Stepdown exceeds the selected cutter's maximum.");
      }
      if (toolpath.spindleRPM !== undefined && (!Number.isFinite(toolpath.spindleRPM) || toolpath.spindleRPM <= 0 || toolpath.spindleRPM > 1_000_000)) throw new Error("Spindle rpm must be between 1 and 1,000,000.");
      if (toolpath.depth !== undefined || toolpath.stepdown !== undefined) {
        if (machineProfile.mode !== "spindle" || !Number.isFinite(toolpath.depth) || !Number.isFinite(toolpath.stepdown) || toolpath.depth! <= 0 || toolpath.stepdown! <= 0 || toolpath.passes !== Math.ceil(toolpath.depth! / toolpath.stepdown!) || toolpath.passes > 5000) throw new Error("Invalid milling depth passes.");
        if (machineProfile.safeZ <= (machineProfile.stockSurfaceZ ?? 0) || Number(formatNumber(toolpath.stepdown! * scale, decimals)) <= 0) throw new Error("Milling requires safe Z above stock and a resolvable stepdown.");
      }
    } catch (error) { errors.push({ severity: "critical", code: "invalid-toolpath", ...ids, message: error instanceof Error ? error.message : "Invalid cutter parameters." }); }
    if (toolpath.processType === "raster-engrave") {
      if (machineProfile.mode !== "laser" || machineProfile.dialect !== "grbl") errors.push({ severity: "critical", code: "invalid-machine", ...ids,
        message: "Direct raster output requires a GRBL laser profile with laser mode ($32=1)." });
      const raster = toolpath.raster;
      if (!raster || !Number.isInteger(raster.maxPower) || raster.maxPower <= 0 || raster.maxPower > machineProfile.maxPower || !Number.isFinite(raster.interval) || raster.interval * scale < 2 * 10 ** -decimals || !raster.lines.length) errors.push({ severity: "critical", code: "invalid-toolpath", ...ids,
        message: "Raster data is missing, power exceeds the machine S maximum, or its interval is below output precision." });
      const outsideRaster = (point: Point2D) => {
        const p = { x: point.x * scale + offset.x, y: point.y * scale + offset.y };
        return outside(p) || outside({ x: Number(formatNumber(p.x, decimals)), y: Number(formatNumber(p.y, decimals)) });
      };
      if (raster?.lines.some((line) => outsideRaster(line.start) || !line.runs.length || line.runs[0]?.power !== 0 || line.runs.at(-1)?.power !== 0 ||
        line.runs.some((run) => !Number.isInteger(run.power) || run.power < 0 || run.power > raster.maxPower || outsideRaster(run.end)))) {
        errors.push({ severity: "critical", code: "invalid-toolpath", ...ids, message: "Invalid raster power, missing laser-off overscan, or scanline exceeds machine bed." });
      }
    }
    if (toolpath.processType === "pocket") {
      try {
        if (!toolpath.pocket) throw new Error("Pocket toolpath is missing cutter and depth settings.");
        validatePocketSettings(toolpath.pocket);
        if (toolpath.passes !== Math.ceil(toolpath.pocket.depth / toolpath.pocket.stepdown)) throw new Error("Pocket depth pass count is inconsistent.");
        if (machineProfile.mode !== "spindle") throw new Error("Pocket requires spindle mode.");
        if (machineProfile.safeZ <= (machineProfile.stockSurfaceZ ?? machineProfile.workZ)) throw new Error("Pocket safe Z must be above the stock surface (work Z).");
        if (Number(formatNumber(toolpath.pocket.stepdown * scale, machineProfile.decimalPlaces)) <= 0) throw new Error("Pocket stepdown is below the controller output precision.");
      } catch (error) {
        errors.push({ severity: "critical", code: "invalid-toolpath", ...ids, message: error instanceof Error ? error.message : "Invalid pocket settings." });
      }
    }
    if (toolpath.points.length < 2 || toolpath.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
      errors.push({ severity: "critical", code: "invalid-toolpath", ...ids, message: `Invalid toolpath coordinates (${label}).` });
      continue;
    }
    const code = toolpath.closed ? validateClosedContour(toolpath.points) : null;
    if (code) errors.push({ severity: "critical", code, ...ids, message: `Corrupt closed toolpath: ${code} (${label}).` });
    if (!toolpath.raster) {
      const roundedPoints = toolpath.points.map((point) => ({
        x: Number(formatNumber(point.x * scale + offset.x, decimals)),
        y: Number(formatNumber(point.y * scale + offset.y, decimals)),
      }));
      const unique = new Set(roundedPoints.map((point) => `${point.x},${point.y}`));
      const minimumUniquePoints = toolpath.closed ? 3 : 2;
      if (unique.size < minimumUniquePoints) {
        errors.push({ severity: "critical", code: "invalid-toolpath", ...ids,
          message: `Toolpath collapses below controller coordinate precision (${label}).` });
      }
    }
    const cut = prepared.get(toolpath.id);
    const motions = [cut?.leadIn, cut?.leadOut].filter((motion): motion is LeadMotion => Boolean(motion));
    for (const motion of motions) {
      const start = { x: Number(formatNumber(motion.start.x * scale + offset.x, decimals)), y: Number(formatNumber(motion.start.y * scale + offset.y, decimals)) };
      const end = { x: Number(formatNumber(motion.end.x * scale + offset.x, decimals)), y: Number(formatNumber(motion.end.y * scale + offset.y, decimals)) };
      if (start.x === end.x && start.y === end.y) errors.push({ severity: "critical", code: "invalid-toolpath", ...ids, message: `Lead is below controller coordinate precision (${label}).` });
      if (motion.kind === "ramp" && (!Number.isFinite(machineProfile.stockSurfaceZ ?? 0) || machineProfile.safeZ <= (machineProfile.stockSurfaceZ ?? 0))) {
        errors.push({ severity: "critical", code: "invalid-machine", ...ids, message: "Ramp safe Z must be above the stock surface." });
      }
    }
    if ([...toolpath.points, ...motions.flatMap(leadExtrema)].some((p) => {
      const machine = { x: p.x * scale + offset.x, y: p.y * scale + offset.y };
      const rounded = { x: Number(formatNumber(machine.x, decimals)), y: Number(formatNumber(machine.y, decimals)) };
      return outside(machine) || outside(rounded);
    })) errors.push({ severity: "critical", code: "out-of-bounds", ...ids,
      message: `Toolpath exceeds the ${machineProfile.bedWidth} × ${machineProfile.bedHeight} ${machineProfile.units} bed (${label}).` });
  }
  if (machineProfile.returnToOrigin && outside(machineProfile.origin)) {
    errors.push({ severity: "critical", code: "out-of-bounds", message: "Return-to-origin move exceeds the machine bed." });
  }
  return Object.freeze({ hasCriticalErrors: errors.length > 0, errors: Object.freeze(errors.map((error) => Object.freeze(error))) });
}

/** Compile an optimized manufacturing plan into deterministic absolute G-code. */
export function compileGcode(
  plan: OptimizedManufacturingPlan,
  profile: MachineProfile = DEFAULT_GRBL_LASER_PROFILE,
  options: GcodeCompileOptions = {},
): string {
  assertProfile(profile);
  const scale = documentToMachineScale(plan.units, profile.units, options.physicalScale);
  const preflight = validatePreflight(plan, profile, options);
  if (preflight.hasCriticalErrors) throw new PreflightValidationError(preflight);
  const prepared = preparePlanCutMotions(plan, profile, options);
  const bounds = planBounds(plan, scale, prepared);
  const offset = coordinateOffset(bounds, profile);
  const decimals = outputPrecision(plan, profile);
  const number = (value: number) => formatNumber(value, decimals);
  const machinePoint = (point: Point2D): Point2D => ({
    x: point.x * scale + offset.x,
    y: point.y * scale + offset.y,
  });
  const lines: string[] = [
    comment(`Vectora CAM · ${profile.name}`),
    comment(`Document ${plan.documentId} · version ${plan.documentVersion}`),
    comment(`${plan.toolpaths.length} optimized toolpaths`),
    profile.units === "mm" ? "G21" : "G20",
    "G90",
    "G94",
    "M5",
  ];
  if (plan.toolpaths.some((path) => path.leads?.leadIn.leadType === "arc" || path.leads?.leadOut.leadType === "arc")) {
    if (profile.dialect === "grbl") lines.push("G17", "G91.1");
  }

  const emitLead = (motion: LeadMotion | null | undefined, feed: number): void => {
    if (!motion) return;
    const end = machinePoint(motion.end);
    if (motion.kind === "arc") {
      lines.push(`${motion.clockwise ? "G2" : "G3"} X${number(end.x)} Y${number(end.y)} I${number((motion.center.x - motion.start.x) * scale)} J${number((motion.center.y - motion.start.y) * scale)} F${number(feed)}`);
    } else if (motion.kind === "ramp") {
      const rampFeed = Math.min(feed, profile.plungeRate / Math.sin(motion.angle * Math.PI / 180));
      lines.push(`G1 X${number(end.x)} Y${number(end.y)} Z${number(motion.endZ * scale)} F${number(rampFeed)}`);
    } else lines.push(`G1 X${number(end.x)} Y${number(end.y)} F${number(feed)}`);
  };

  if (profile.mode === "spindle") lines.push(`G0 Z${number(profile.safeZ)}`);

  for (const toolpath of plan.toolpaths) {
    if (toolpath.raster) {
      const feed = profile.feedRate ?? toolpath.feedRate * scale;
      lines.push(comment(`${toolpath.sequenceIndex + 1}. Raster engraving · GRBL laser mode $32=1 required`));
      for (let pass = 0; pass < toolpath.passes; pass += 1) {
        for (const scanline of toolpath.raster.lines) {
          const start = machinePoint(scanline.start);
          lines.push("M5", `G0 X${number(start.x)} Y${number(start.y)} S0`, `${profile.laserOnCommand} S0`);
          let cursor = scanline.start;
          for (const run of scanline.runs) {
            if (Math.hypot(run.end.x - cursor.x, run.end.y - cursor.y) > EPSILON) {
              const end = machinePoint(run.end);
              lines.push(`G1 X${number(end.x)} Y${number(end.y)} S${number(run.power)} F${number(feed)}`);
            }
            cursor = run.end;
          }
          lines.push("M5");
        }
      }
      continue;
    }
    const cut = prepared.get(toolpath.id);
    const first = machinePoint(cut?.entry ?? toolpath.points[0]!);
    const feedRate = profile.feedRate ?? toolpath.feedRate * scale;
    const power = Math.max(0, Math.min(profile.maxPower, toolpath.power * profile.maxPower / 1_000));
    lines.push(comment(
      `${toolpath.sequenceIndex + 1}. ${toolpath.processType} · ${toolpath.profileKind} · ${toolpath.offsetDirection}`,
    ));
    if (toolpath.tool) lines.push(comment(`Tool: ${toolpath.tool.name} · diameter ${toolpath.tool.diameter} mm`));
    const holdingTabs =
      profile.mode === "laser" && toolpath.processType === "vector-cut" && toolpath.closed && options.holdingTabs
        ? splitPathForHoldingTabs(toolpath.points, options.holdingTabs)
        : null;
    if (holdingTabs) lines.push(comment(`Holding tabs · ${holdingTabs.tabCount} × ${number(holdingTabs.tabWidth * scale)} ${profile.units}`));

    for (let pass = 0; pass < toolpath.passes; pass += 1) {
      if (toolpath.passes > 1) lines.push(comment(`Pass ${pass + 1}/${toolpath.passes}`));
      if (profile.mode === "spindle") lines.push(`G0 Z${number(profile.safeZ)}`);
      lines.push(`G0 X${number(first.x)} Y${number(first.y)}`);

      if (profile.mode === "spindle") {
        lines.push(`M3 S${number(toolpath.spindleRPM ?? power)}`);
        const workZ = toolpath.pocket
          ? (profile.stockSurfaceZ ?? profile.workZ) - Math.min(toolpath.pocket.depth, (pass + 1) * toolpath.pocket.stepdown) * scale
          : toolpath.depth !== undefined ? (profile.stockSurfaceZ ?? 0) - Math.min(toolpath.depth, (pass + 1) * toolpath.stepdown!) * scale : profile.workZ;
        lines.push(`G1 Z${number(cut?.leadIn?.kind === "ramp" ? cut.leadIn.startZ * scale : workZ)} F${number(profile.plungeRate)}`);
      } else if (!holdingTabs || holdingTabs.spans[0]?.cutting !== false) {
        lines.push(`${profile.laserOnCommand} S${number(power)}`);
      }

      const entry = cut?.leadIn;
      emitLead(entry?.kind === "ramp" && toolpath.depth !== undefined
        ? rampForDepth(entry, Math.min(toolpath.depth, (pass + 1) * toolpath.stepdown!)) : entry, feedRate);
      if (cut) {
        let laserEnabled = true;
        for (const span of cut.spans) {
          if (profile.mode === "laser" && span.cutting !== laserEnabled) {
            lines.push(span.cutting ? `${profile.laserOnCommand} S${number(power)}` : "M5");
            laserEnabled = span.cutting;
          }
          for (let index = 1; index < span.points.length; index += 1) {
            const p = machinePoint(span.points[index]!);
            lines.push(`G1 X${number(p.x)} Y${number(p.y)} F${number(feedRate)}`);
          }
        }
        emitLead(cut.leadOut, feedRate);
      } else if (holdingTabs) {
        let laserEnabled = holdingTabs.spans[0]?.cutting === true;
        for (const span of holdingTabs.spans) {
          if (span.cutting !== laserEnabled) {
            lines.push(span.cutting ? `${profile.laserOnCommand} S${number(power)}` : "M5");
            laserEnabled = span.cutting;
          }
          for (let index = 1; index < span.points.length; index += 1) {
            const point = machinePoint(span.points[index]!);
            lines.push(`G1 X${number(point.x)} Y${number(point.y)} F${number(feedRate)}`);
          }
        }
      } else {
        for (let index = 1; index < toolpath.points.length; index += 1) {
          const point = machinePoint(toolpath.points[index]!);
          lines.push(`G1 X${number(point.x)} Y${number(point.y)} F${number(feedRate)}`);
        }
        if (toolpath.closed) {
          lines.push(`G1 X${number(first.x)} Y${number(first.y)} F${number(feedRate)}`);
        }
      }
      lines.push("M5");
      if (profile.mode === "spindle") lines.push(`G0 Z${number(profile.safeZ)}`);
    }
  }

  lines.push("M5");
  if (profile.mode === "spindle") lines.push(`G0 Z${number(profile.safeZ)}`);
  if (profile.returnToOrigin) {
    lines.push(`G0 X${number(profile.origin.x)} Y${number(profile.origin.y)}`);
  }
  lines.push(comment("End of Vectora program"));
  return `${lines.join("\n")}\n`;
}
