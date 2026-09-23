import { generateRasterToolpath, type RasterToolpath } from "./rasterCamEngine";
import { validateTool, type ToolDefinition } from "./toolStore";
import { mmPerUnit } from "./physicalUnits";
import type { PixelPhysicalScale } from "./gcodeCompiler";
import type {
  CadDocument,
  DocumentUnits,
  Entity,
  EntityId,
  ManufacturingIntent,
  Point2D,
} from "../document/types";
import { offsetPath } from "../geometry/operations/offset";
import { entityToPath, type CurveFlattenOptions } from "../geometry/operations/pathConversion";
import { buildContourHierarchy } from "../geometry/topology";
import { validateClosedContour } from "./contourValidation";
import { buildPocketHierarchy, generatePocketToolpaths, validatePocketSettings, type PocketSettings } from "./pocketingEngine";
import { linkPocketPaths } from "./optimizer";
import { resolveCutLeadSettings, type CutLeadOptions, type CutLeadSettings } from "./leadGeometry";
import { colorForManufacturingIntent, vectoraRenderColors } from "../design/vectoraRenderColors";
export { pointInClosedPath, signedPolygonArea } from "../geometry/topology";

export type ProcessType = "vector-cut" | "vector-engrave" | "raster-engrave" | "pocket";
export type ProfileKind = "outer" | "inner" | "open";
export type OffsetDirection = "outside" | "inside" | "on-line";

interface BaseProcess<TType extends ProcessType> {
  readonly tool?: ToolDefinition;
  readonly spindleRPM?: number;
  /** Vector milling depth and stepdown, in document units. */
  readonly depth?: number;
  readonly stepdown?: number;
  readonly id: string;
  readonly type: TType;
  readonly name: string;
  readonly enabled: boolean;
  /** Motion rate in document units per minute. */
  readonly feedRate: number;
  /** Controller power value, normally in the range 0–1000. */
  readonly power: number;
  readonly passes: number;
  readonly color: string;
}

export interface VectorCut extends BaseProcess<"vector-cut">, CutLeadOptions {
  /** Full physical kerf width. Toolpaths are offset by half this value. */
  readonly kerfWidth: number;
}

export interface VectorEngrave extends BaseProcess<"vector-engrave"> {
  readonly sourceIntent: "engrave" | "score";
}

export interface RasterEngrave extends BaseProcess<"raster-engrave"> {
  readonly dpi: number;
  readonly scanAngle: 0 | 90;
  readonly bidirectional: boolean;
}

export interface PocketProcess extends Omit<BaseProcess<"pocket">, "depth" | "stepdown">, PocketSettings {}
export type ManufacturingProcess = VectorCut | VectorEngrave | RasterEngrave | PocketProcess;

export interface ClassifiedProfile {
  readonly entityId: EntityId;
  readonly path: readonly Point2D[];
  readonly signedArea: number;
  readonly absoluteArea: number;
  readonly parentId: EntityId | null;
  readonly depth: number;
  readonly kind: "outer" | "inner";
  readonly offsetDirection: "outside" | "inside";
}

export interface ManufacturingToolpath {
  readonly tool?: ToolDefinition;
  readonly spindleRPM?: number;
  readonly depth?: number;
  readonly stepdown?: number;
  readonly id: string;
  readonly sourceEntityId: EntityId;
  readonly sourceLayerId?: string;
  readonly processId: string;
  readonly processType: ProcessType;
  readonly sourceIntent: ManufacturingIntent;
  readonly points: readonly Point2D[];
  readonly closed: boolean;
  readonly profileKind: ProfileKind;
  readonly offsetDirection: OffsetDirection;
  readonly nestingDepth: number;
  readonly parentEntityId: EntityId | null;
  readonly feedRate: number;
  readonly power: number;
  readonly passes: number;
  readonly color: string;
  readonly pocket?: PocketSettings;
  readonly raster?: RasterToolpath;
  readonly leads?: CutLeadSettings;
  /** Compensated cutter/kerf width in document units, used for lead clearance. */
  readonly cutKerfWidth?: number;
}

export interface ManufacturingPlan {
  readonly documentId: string;
  readonly documentVersion: number;
  readonly units: DocumentUnits;
  readonly processes: readonly ManufacturingProcess[];
  readonly profiles: readonly ClassifiedProfile[];
  readonly toolpaths: readonly ManufacturingToolpath[];
  /** Source errors survive even when kerf compensation produces no toolpaths. */
  readonly geometryErrors?: readonly PreflightIssue[];
}

export interface PreflightIssue {
  readonly severity: "critical";
  readonly code: "out-of-bounds" | "degenerate-contour" | "self-intersection" | "invalid-machine" | "pixel-calibration" | "invalid-toolpath";
  readonly message: string;
  readonly entityId?: EntityId;
  readonly layerId?: string;
}

export interface PreflightReport {
  readonly hasCriticalErrors: boolean;
  readonly errors: readonly PreflightIssue[];
}

export interface ProcessModelOptions extends CurveFlattenOptions {
  readonly physicalScale?: PixelPhysicalScale;
  readonly processes?: readonly ManufacturingProcess[];
}

export interface DefaultProcessOptions extends CutLeadOptions {
  readonly tool?: ToolDefinition;
  readonly spindleRPM?: number;
  readonly vectorDepth?: number;
  readonly vectorStepdown?: number;
  readonly cutFeedRate?: number;
  readonly cutPower?: number;
  readonly cutPasses?: number;
  readonly kerfWidth?: number;
  readonly engraveFeedRate?: number;
  readonly engravePower?: number;
  readonly engravePasses?: number;
  readonly scoreFeedRate?: number;
  readonly scorePower?: number;
  readonly scorePasses?: number;
  readonly pocket?: PocketSettings & { readonly feedRate?: number; readonly power?: number };
}

const EPSILON = 1e-9;

function validateProcess(process: ManufacturingProcess): void {
  if (process.tool) validateTool(process.tool);
  if (process.spindleRPM !== undefined && (!Number.isFinite(process.spindleRPM) || process.spindleRPM <= 0)) throw new RangeError("Spindle rpm must be greater than zero.");
  if (process.depth !== undefined || process.stepdown !== undefined) {
    if (!Number.isFinite(process.depth) || !Number.isFinite(process.stepdown) || process.depth! <= 0 || process.stepdown! <= 0 || Math.ceil(process.depth! / process.stepdown!) > 5000) throw new RangeError("Invalid milling depth or stepdown (maximum 5000 depth passes).");
    if (process.tool && process.tool.type === "laser" && process.type !== "pocket") throw new RangeError("Lasers do not use milling depth passes.");
  }
  if (process.type === "vector-cut") resolveCutLeadSettings(process);
  if (process.type === "pocket") validatePocketSettings(process);
  if (!process.id.trim()) throw new TypeError("Manufacturing process ids cannot be empty.");
  if (!Number.isFinite(process.feedRate) || process.feedRate <= 0) {
    throw new RangeError(`${process.name} feed rate must be greater than zero.`);
  }
  if (!Number.isFinite(process.power) || process.power < 0) {
    throw new RangeError(`${process.name} power cannot be negative.`);
  }
  if (!Number.isInteger(process.passes) || process.passes < 1) {
    throw new RangeError(`${process.name} passes must be a positive integer.`);
  }
  if (process.type === "vector-cut" && (!Number.isFinite(process.kerfWidth) || process.kerfWidth < 0)) {
    throw new RangeError("Kerf width must be a finite, non-negative value.");
  }
}

export function createDefaultProcesses(options: DefaultProcessOptions = {}): readonly ManufacturingProcess[] {
  const processes: ManufacturingProcess[] = [
    {
      id: "vector-cut",
      type: "vector-cut",
      name: "Vector cut",
      enabled: true,
      feedRate: options.cutFeedRate ?? 900,
      power: options.cutPower ?? 1_000,
      passes: options.cutPasses ?? 1,
      color: vectoraRenderColors.operation.cut,
      kerfWidth: options.kerfWidth ?? 0.15,
      ...resolveCutLeadSettings(options),
    },
    {
      id: "vector-engrave",
      type: "vector-engrave",
      name: "Vector engrave",
      enabled: true,
      feedRate: options.engraveFeedRate ?? 2_400,
      power: options.engravePower ?? 350,
      passes: options.engravePasses ?? 1,
      color: vectoraRenderColors.operation.engrave,
      sourceIntent: "engrave",
    },
    {
      id: "vector-score",
      type: "vector-engrave",
      name: "Vector score",
      enabled: true,
      feedRate: options.scoreFeedRate ?? 1_800,
      power: options.scorePower ?? 220,
      passes: options.scorePasses ?? 1,
      color: vectoraRenderColors.operation.score,
      sourceIntent: "score",
    },
    {
      id: "raster-engrave",
      type: "raster-engrave",
      name: "Raster engrave",
      enabled: true,
      feedRate: 3_000,
      power: 300,
      passes: 1,
      color: vectoraRenderColors.operation.raster,
      dpi: 254,
      scanAngle: 0,
      bidirectional: true,
    },
  ];
  processes.push({ id: "pocket", type: "pocket", name: "Pocket", enabled: true,
    feedRate: options.pocket?.feedRate ?? 600, power: options.pocket?.power ?? 1000, passes: 1, color: vectoraRenderColors.operation.pocket,
    toolDiameter: 3, stepoverPct: 60, strategy: "concentric", depth: 1, stepdown: 0.5, ...options.pocket });
  return Object.freeze(processes.map((process) => {
    const next = process.type === "raster-engrave" ? process : {
      ...process,
      ...(options.tool ? { tool: validateTool(options.tool) } : {}),
      ...(options.spindleRPM !== undefined ? { spindleRPM: options.spindleRPM } : {}),
      ...(process.type !== "pocket" && options.vectorDepth !== undefined ? { depth: options.vectorDepth, stepdown: options.vectorStepdown! } : {}),
    };
    validateProcess(next);
    return Object.freeze(next);
  }));
}

/** Convert a physical tool recipe once at the CAM boundary. Explicit user edits
 * can override these defaults before createDefaultProcesses is called. */
export function toolProcessDefaults(tool: ToolDefinition, physicalFactor = 1): DefaultProcessOptions {
  validateTool(tool);
  if (!Number.isFinite(physicalFactor) || physicalFactor <= 0) throw new RangeError("Physical scale must be positive.");
  const base = { tool, cutFeedRate: tool.recommendedFeed / physicalFactor, engraveFeedRate: tool.recommendedFeed / physicalFactor,
    scoreFeedRate: tool.recommendedFeed / physicalFactor, kerfWidth: tool.diameter / physicalFactor };
  if (tool.type === "laser") return base;
  return { ...base, spindleRPM: tool.recommendedRPM, vectorDepth: tool.maxStepdown / physicalFactor, vectorStepdown: tool.maxStepdown / physicalFactor,
    pocket: { toolDiameter: tool.diameter / physicalFactor, stepoverPct: tool.defaultStepover * 100,
      depth: tool.maxStepdown / physicalFactor, stepdown: tool.maxStepdown / physicalFactor, strategy: "concentric", feedRate: tool.recommendedFeed / physicalFactor } };
}

function toolpathParameters(process: ManufacturingProcess) {
  return { ...(process.tool ? { tool: process.tool } : {}), ...(process.spindleRPM !== undefined ? { spindleRPM: process.spindleRPM } : {}),
    ...(process.depth !== undefined ? { depth: process.depth, stepdown: process.stepdown! } : {}) };
}

export function classifyClosedProfiles(
  entities: readonly Entity[],
  options: CurveFlattenOptions = {},
): readonly ClassifiedProfile[] {
  const hierarchy = buildContourHierarchy(entities, options);
  return Object.freeze(hierarchy.nodes.map((node) => {
    return Object.freeze({
      entityId: node.entityId,
      path: node.path,
      signedArea: node.signedArea,
      absoluteArea: node.absoluteArea,
      parentId: node.parentId,
      depth: node.depth,
      kind: node.kind,
      offsetDirection: node.kind === "inner" ? "inside" : "outside",
    });
  }));
}

function processForIntent(
  intent: ManufacturingIntent,
  processes: readonly ManufacturingProcess[],
): ManufacturingProcess | null {
  if (intent === "raster") return processes.find((process) => process.type === "raster-engrave" && process.enabled) ?? null;
  if (intent === "cut") return processes.find((process) => process.type === "vector-cut" && process.enabled) ?? null;
  if (intent === "pocket") return processes.find((process) => process.type === "pocket" && process.enabled) ?? null;
  if (intent === "engrave" || intent === "score") {
    return processes.find(
      (process) => process.type === "vector-engrave" && process.sourceIntent === intent && process.enabled,
    ) ?? null;
  }
  return null;
}

function freezePoints(points: readonly Point2D[]): readonly Point2D[] {
  return Object.freeze(points.map((point) => Object.freeze({ x: point.x, y: point.y })));
}

function manufacturingPath(entity: Entity, options: ProcessModelOptions) {
  const converted = entityToPath(entity, options);
  if (!converted?.closed || entity.type === "polyline") return converted;
  // Analytic shapes can emit duplicate tangent vertices (e.g. a capsule's
  // maximum corner radius). Those are tessellation artifacts, not corrupt CAD nodes.
  const points: Point2D[] = [];
  for (const point of converted.points) {
    const previous = points.at(-1);
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > EPSILON) points.push(point);
  }
  if (points.length > 1 && Math.hypot(points[0]!.x - points.at(-1)!.x, points[0]!.y - points.at(-1)!.y) <= EPSILON) points.pop();
  return { ...converted, points };
}

export function buildManufacturingPlan(
  document: Readonly<CadDocument>,
  options: ProcessModelOptions = {},
): ManufacturingPlan {
  const processes = options.processes ?? createDefaultProcesses();
  processes.forEach(validateProcess);
  const processIds = new Set<string>();
  for (const process of processes) {
    if (processIds.has(process.id)) throw new Error(`Duplicate process id "${process.id}".`);
    processIds.add(process.id);
  }
  const layerById = new Map(document.layers.map((layer) => [layer.id, layer]));
  const visibleEntities = [...document.entities.values()].filter(
    (entity) => entity.visible && layerById.get(entity.layerId)?.visible && entity.intent !== "construction",
  );
  const cutEntities = visibleEntities.filter((entity) => entity.intent === "cut");
  const geometryErrors: PreflightIssue[] = [];
  const invalidEntities = new Set<EntityId>();
  for (const entity of visibleEntities) {
    if (!processForIntent(entity.intent, processes)) continue;
    if (entity.type === "image" || entity.intent === "raster") continue;
    const converted = manufacturingPath(entity, options);
    const closedSource = entity.type === "polyline" ? entity.closed :
      !["line", "arc", "text", "dimension", "leader"].includes(entity.type);
    const code = converted?.closed ? validateClosedContour(converted.points) :
      !converted && closedSource ? "degenerate-contour" : null;
    if (!code) continue;
    invalidEntities.add(entity.id);
    geometryErrors.push(Object.freeze({ severity: "critical", code, entityId: entity.id, layerId: entity.layerId,
      message: `${code === "self-intersection" ? "Self-crossing" : "Degenerate"} closed contour (layer ${entity.layerId}, entity ${entity.id}).` }));
  }
  const profiles = classifyClosedProfiles(cutEntities.filter((entity) => !invalidEntities.has(entity.id)), options);
  const profileByEntity = new Map(profiles.map((profile) => [profile.entityId, profile]));
  const toolpaths: ManufacturingToolpath[] = [];
  const pocketEntities = visibleEntities.filter((entity) => entity.intent === "pocket" && processForIntent(entity.intent, processes));
  let pocketHierarchy = buildContourHierarchy([]);
  try {
    pocketHierarchy = buildPocketHierarchy([...pocketEntities, ...cutEntities.filter((entity) => !invalidEntities.has(entity.id))]);
  } catch (error) {
    pocketEntities.forEach((entity) => invalidEntities.add(entity.id));
    geometryErrors.push({ severity: "critical", code: "invalid-toolpath", message: error instanceof Error ? error.message : "Invalid pocket boundaries." });
  }

  for (const entity of visibleEntities) {
    if (invalidEntities.has(entity.id)) continue;
    const process = processForIntent(entity.intent, processes);
    if (!process) continue;
    if (entity.type === "image" || process.type === "raster-engrave") {
      try {
        if (entity.type !== "image" || process.type !== "raster-engrave") throw new Error("Bitmap images require the Raster engrave operation, and Raster engrave requires a bitmap image.");
        const physicalFactor = mmPerUnit(document.units, options.physicalScale);
        const raster = generateRasterToolpath(entity, physicalFactor);
        if (raster.lines.length) toolpaths.push(Object.freeze({ id: `${process.id}:${entity.id}`, sourceEntityId: entity.id,
          sourceLayerId: entity.layerId, processId: process.id, processType: "raster-engrave", sourceIntent: "raster",
          points: freezePoints(raster.lines.flatMap((line) => [line.start, line.runs.at(-1)!.end])), closed: false,
          profileKind: "open", offsetDirection: "on-line", nestingDepth: 0, parentEntityId: null,
          feedRate: entity.raster.feedRate / physicalFactor, power: entity.raster.maxPower, passes: process.passes, color: vectoraRenderColors.operation.raster, raster }));
      } catch (error) {
        geometryErrors.push({ severity: "critical", code: "invalid-toolpath", entityId: entity.id, layerId: entity.layerId,
          message: error instanceof Error ? error.message : "Raster generation failed." });
      }
      continue;
    }
    if (process.type === "pocket") {
      const node = pocketHierarchy.byEntityId.get(entity.id);
      if (!node || node.parentId) continue;
      const descendants = pocketHierarchy.nodes.filter((candidate) => {
        let parent = candidate.parentId;
        while (parent) {
          if (parent === entity.id) return true;
          parent = pocketHierarchy.byEntityId.get(parent)?.parentId ?? null;
        }
        return false;
      }).map((candidate) => candidate.entity);
      try {
        const generated = generatePocketToolpaths(entity, process, descendants);
        linkPocketPaths(generated.paths, generated.clearance).forEach((points, index) => {
          toolpaths.push(Object.freeze({ id: `${process.id}:${entity.id}:${index}`, sourceEntityId: entity.id,
            sourceLayerId: entity.layerId, processId: process.id, processType: "pocket", sourceIntent: "pocket",
            points: freezePoints(points), closed: false, profileKind: "inner", offsetDirection: "inside", nestingDepth: 0,
            parentEntityId: null, feedRate: process.feedRate, power: process.power, ...toolpathParameters(process),
            passes: Math.ceil(process.depth / process.stepdown), color: vectoraRenderColors.operation.pocket,
            pocket: Object.freeze({ toolDiameter: process.toolDiameter, stepoverPct: process.stepoverPct ?? 60,
              strategy: process.strategy, depth: process.depth, stepdown: process.stepdown }),
          }));
        });
      } catch (error) {
        geometryErrors.push({ severity: "critical", code: "invalid-toolpath", entityId: entity.id, layerId: entity.layerId,
          message: error instanceof Error ? error.message : "Pocket generation failed." });
      }
      continue;
    }
    const converted = manufacturingPath(entity, options);
    if (!converted) continue;
    const profile = profileByEntity.get(entity.id);
    let outputPaths: readonly (readonly Point2D[])[] = [converted.points];
    let wasOffset = false;
    let offsetDirection: OffsetDirection = "on-line";
    if (process.type === "vector-cut" && converted.closed && profile && process.kerfWidth > EPSILON) {
      offsetDirection = profile.offsetDirection;
      const distance = (process.kerfWidth / 2) * (offsetDirection === "inside" ? -1 : 1);
      try {
        outputPaths = offsetPath(converted.points, distance, {
          closed: true,
          joinStyle: "round",
          precision: 6,
        });
      } catch {
        geometryErrors.push(Object.freeze({ severity: "critical", code: "degenerate-contour", entityId: entity.id, layerId: entity.layerId,
          message: `Kerf offset failed (layer ${entity.layerId}, entity ${entity.id}).` }));
        continue;
      }
      wasOffset = true;
      if (outputPaths.length === 0) {
        geometryErrors.push(Object.freeze({ severity: "critical", code: "degenerate-contour", entityId: entity.id, layerId: entity.layerId,
          message: `Kerf offset removed the closed contour (layer ${entity.layerId}, entity ${entity.id}).` }));
      }
    } else if (process.type === "vector-cut" && profile) {
      offsetDirection = profile.offsetDirection;
    }
    const layer = layerById.get(entity.layerId);
    outputPaths.forEach((points, pathIndex) => {
      if (points.length < 2) {
        geometryErrors.push(Object.freeze({ severity: "critical", code: "invalid-toolpath", entityId: entity.id, layerId: entity.layerId,
          message: `Toolpath has insufficient coordinates (layer ${entity.layerId}, entity ${entity.id}).` }));
        return;
      }
      toolpaths.push(Object.freeze({
        id: `${process.id}:${entity.id}:${pathIndex}`,
        sourceEntityId: entity.id,
        sourceLayerId: entity.layerId,
        processId: process.id,
        processType: process.type,
        ...toolpathParameters(process),
        sourceIntent: entity.intent,
        points: freezePoints(points),
        closed: converted.closed || wasOffset,
        profileKind: profile?.kind ?? "open",
        offsetDirection,
        nestingDepth: profile?.depth ?? 0,
        parentEntityId: profile?.parentId ?? null,
        feedRate: process.feedRate,
        power: process.power,
        passes: process.depth !== undefined ? Math.ceil(process.depth / process.stepdown!) : process.passes,
        color: process.color || layer?.color || colorForManufacturingIntent(entity.intent),
        ...(process.type === "vector-cut" ? { leads: resolveCutLeadSettings(process), cutKerfWidth: process.kerfWidth } : {}),
      }));
    });
  }
  return Object.freeze({
    documentId: document.id,
    documentVersion: document.version,
    units: document.units,
    processes: Object.freeze(processes.map((process) => Object.freeze({ ...process }))),
    profiles,
    toolpaths: Object.freeze(toolpaths),
    geometryErrors: Object.freeze(geometryErrors),
  });
}
