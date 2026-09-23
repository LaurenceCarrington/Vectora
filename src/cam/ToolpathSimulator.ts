import { rampForDepth } from "./leadGeometry";
import { sampleLead, type LeadMotion } from "./leadGeometry";
import type { Point2D } from "../document/types";
import { distanceBetween, type OptimizedManufacturingPlan } from "./optimizer";
import {
  documentToMachineScale,
  DEFAULT_GRBL_LASER_PROFILE,
  preparePlanCutMotions,
  machineDocumentTransform,
  type MachineProfile,
  type PixelPhysicalScale,
} from "./gcodeCompiler";
import {
  type HoldingTabMarker,
  type HoldingTabOptions,
} from "./holdingTabs";
import { vectoraRenderColors } from "../design/vectoraRenderColors";

export type SimulationStatus = "idle" | "paused" | "playing" | "complete";
export type SimulationSpeed = 1 | 2 | 5;
export type MotionKind = "rapid" | "cut";

export interface MotionSegment {
  readonly id: string;
  readonly kind: MotionKind;
  readonly start: Point2D;
  readonly end: Point2D;
  /** Physical machine coordinates; start/end remain document coordinates for canvas alignment. */
  readonly machineStart: Point2D;
  readonly machineEnd: Point2D;
  readonly startTime: number;
  readonly endTime: number;
  readonly duration: number;
  readonly distance: number;
  readonly feedRate: number;
  readonly color: string;
  readonly toolpathId: string;
  readonly pass: number;
  readonly role?: "lead-in" | "lead-out" | "ramp" | "tab-gap" | "raster-off" | "raster-burn";
  /** Ramp endpoint heights in document units. */
  readonly startZ?: number;
  readonly endZ?: number;
}

export interface SimulatorSnapshot {
  readonly status: SimulationStatus;
  readonly speed: SimulationSpeed;
  readonly currentTime: number;
  readonly duration: number;
  readonly progress: number;
  readonly currentPoint: Point2D | null;
  readonly currentSegmentIndex: number;
  readonly headStyle: MachineHeadStyle;
}

export type MachineHeadStyle = "laser" | "spindle";

export interface SimulatorPlanOptions {
  readonly rapidFeedRate?: number;
  readonly headStyle?: MachineHeadStyle;
  readonly machineUnits?: MachineProfile["units"];
  readonly physicalScale?: PixelPhysicalScale;
  readonly holdingTabs?: HoldingTabOptions | false;
  readonly showHoldingTabs?: boolean;
  readonly machineProfile?: MachineProfile;
}

export interface SimulatorHoldingTabMarker extends HoldingTabMarker {
  readonly toolpathId: string;
  readonly color: string;
}

export interface SimulatorLeadMarker {
  readonly toolpathId: string;
  readonly role: "lead-in" | "lead-out";
  readonly points: readonly Point2D[];
}

export type SimulatorListener = () => void;

const EPSILON = 1e-9;

function freezePoint(point: Point2D): Point2D {
  return Object.freeze({ x: point.x, y: point.y });
}

function buildSegments(
  plan: OptimizedManufacturingPlan,
  rapidFeedRate: number,
  machineUnits: MachineProfile["units"],
  options: SimulatorPlanOptions,
): { readonly segments: readonly MotionSegment[]; readonly leads: readonly SimulatorLeadMarker[]; readonly tabs: readonly SimulatorHoldingTabMarker[] } {
  if (!Number.isFinite(rapidFeedRate) || rapidFeedRate <= 0) {
    throw new RangeError("Rapid feed rate must be greater than zero.");
  }
  const segments: MotionSegment[] = [];
  const coordinateScale = documentToMachineScale(plan.units, machineUnits, options.physicalScale);
  const profile = options.machineProfile ?? { ...DEFAULT_GRBL_LASER_PROFILE, units: machineUnits, mode: options.headStyle ?? "laser" };
  const compileOptions = { ...(options.holdingTabs ? { holdingTabs: options.holdingTabs } : {}), ...(options.physicalScale ? { physicalScale: options.physicalScale } : {}) };
  const prepared = preparePlanCutMotions(plan, profile, compileOptions);
  const transform = options.machineProfile ? machineDocumentTransform(plan, profile, options.physicalScale, compileOptions) : null;
  const physicalFactor = machineUnits === "in" ? 25.4 : 1;
  const offset = { x: (transform?.offsetX ?? 0) / physicalFactor, y: (transform?.offsetY ?? 0) / physicalFactor };
  const leads: SimulatorLeadMarker[] = [];
  const tabs: SimulatorHoldingTabMarker[] = [];
  const unitsPerMm = (machineUnits === "in" ? 1 / 25.4 : 1) / coordinateScale;
  let cursor = plan.startPosition;
  let elapsed = 0;

  const addSegment = (
    kind: MotionKind,
    start: Point2D,
    end: Point2D,
    feedRate: number,
    color: string,
    toolpathId: string,
    pass: number,
    role?: MotionSegment["role"],
    startZ?: number,
    endZ?: number,
  ) => {
    const documentDistance = Math.hypot(distanceBetween(start, end), (endZ ?? 0) - (startZ ?? 0));
    if (documentDistance <= EPSILON) return;
    const machineDistance = documentDistance * coordinateScale;
    const machineFeedRate = kind === "rapid" && role !== "tab-gap" && role !== "raster-off" ? feedRate : feedRate * coordinateScale;
    const duration = machineDistance / machineFeedRate * 60;
    segments.push(Object.freeze({
      id: `${toolpathId}:${pass}:${kind}:${segments.length}`,
      kind,
      start: freezePoint(start),
      end: freezePoint(end),
      machineStart: freezePoint({ x: start.x * coordinateScale + offset.x, y: start.y * coordinateScale + offset.y }),
      machineEnd: freezePoint({ x: end.x * coordinateScale + offset.x, y: end.y * coordinateScale + offset.y }),
      startTime: elapsed,
      endTime: elapsed + duration,
      duration,
      distance: machineDistance,
      feedRate: machineFeedRate,
      color,
      toolpathId,
      pass,
      ...(role ? { role } : {}),
      ...(startZ === undefined ? {} : { startZ }),
      ...(endZ === undefined ? {} : { endZ }),
    }));
    elapsed += duration;
  };

  for (const toolpath of plan.toolpaths) {
    if (toolpath.raster) {
      const feed = profile.feedRate === undefined ? toolpath.feedRate : profile.feedRate / coordinateScale;
      for (let pass = 1; pass <= toolpath.passes; pass += 1) for (const line of toolpath.raster.lines) {
        addSegment("rapid", cursor, line.start, rapidFeedRate, vectoraRenderColors.toolpath.rapid, toolpath.id, pass);
        cursor = line.start;
        for (const run of line.runs) {
          addSegment(run.power > 0 ? "cut" : "rapid", cursor, run.end, feed, run.power > 0 ? vectoraRenderColors.operation.raster : vectoraRenderColors.toolpath.rapid, toolpath.id, pass, run.power > 0 ? "raster-burn" : "raster-off");
          cursor = run.end;
        }
      }
      continue;
    }
    const cut = prepared.get(toolpath.id);
    const cutFeed = profile.feedRate === undefined ? toolpath.feedRate : profile.feedRate / coordinateScale;
    const start = cut?.entry ?? toolpath.points[0]!;
    for (const tab of cut?.tabs ?? []) tabs.push(Object.freeze({ ...tab, toolpathId: toolpath.id, color: vectoraRenderColors.toolpath.holdingTab }));
    for (const [role, motion] of [["lead-in", cut?.leadIn], ["lead-out", cut?.leadOut]] as const) {
      if (motion) leads.push(Object.freeze({ toolpathId: toolpath.id, role, points: sampleLead(motion, 0.001 * unitsPerMm) }));
    }
    const addLead = (motion: LeadMotion | null | undefined, role: "lead-in" | "lead-out", pass: number) => {
      if (!motion) return;
      const points = sampleLead(motion, 0.001 * unitsPerMm);
      const ramp = motion.kind === "ramp" ? motion : null;
      const feed = ramp ? Math.min(cutFeed, profile.plungeRate / coordinateScale / Math.sin(ramp.angle * Math.PI / 180)) : cutFeed;
      for (let i = 1; i < points.length; i += 1) {
        addSegment("cut", points[i - 1]!, points[i]!, feed, role === "lead-in" ? vectoraRenderColors.toolpath.leadIn : vectoraRenderColors.toolpath.leadOut, toolpath.id, pass,
          ramp ? "ramp" : role, ramp?.startZ, ramp?.endZ);
      }
    };
    for (let pass = 0; pass < toolpath.passes; pass += 1) {
      addSegment("rapid", cursor, start, rapidFeedRate, vectoraRenderColors.toolpath.rapid, toolpath.id, pass + 1);
      addLead(cut?.leadIn?.kind === "ramp" && toolpath.depth !== undefined
        ? rampForDepth(cut.leadIn, Math.min(toolpath.depth, (pass + 1) * toolpath.stepdown!)) : cut?.leadIn, "lead-in", pass + 1);
      if (cut) {
        for (const span of cut.spans) for (let index = 1; index < span.points.length; index += 1) {
          addSegment(span.cutting ? "cut" : "rapid", span.points[index - 1]!, span.points[index]!, cutFeed,
            span.cutting ? toolpath.color : vectoraRenderColors.toolpath.holdingTab, toolpath.id, pass + 1, span.cutting ? undefined : "tab-gap");
        }
        addLead(cut.leadOut, "lead-out", pass + 1);
        cursor = cut.exit;
      } else {
        for (let index = 1; index < toolpath.points.length; index += 1) {
          addSegment("cut", toolpath.points[index - 1]!, toolpath.points[index]!, cutFeed, toolpath.color, toolpath.id, pass + 1);
        }
        if (toolpath.closed) addSegment("cut", toolpath.points.at(-1)!, start, cutFeed, toolpath.color, toolpath.id, pass + 1);
        cursor = toolpath.closed ? start : toolpath.points.at(-1)!;
      }
    }
  }
  return { segments: Object.freeze(segments), leads: Object.freeze(leads), tabs: Object.freeze(tabs) };
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function requestFrame(callback: FrameRequestCallback): number {
  if (typeof globalThis.requestAnimationFrame === "function") {
    return globalThis.requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(() => callback(now()), 16);
}

function cancelFrame(handle: number): void {
  if (typeof globalThis.cancelAnimationFrame === "function") globalThis.cancelAnimationFrame(handle);
  else globalThis.clearTimeout(handle);
}

export class ToolpathSimulator {
  private segments: readonly MotionSegment[] = Object.freeze([]);
  private holdingTabMarkers: readonly SimulatorHoldingTabMarker[] = Object.freeze([]);
  private showHoldingTabs = true;
  private leadMarkers: readonly SimulatorLeadMarker[] = Object.freeze([]);
  getLeadMarkers(): readonly SimulatorLeadMarker[] { return this.leadMarkers; }
  private listeners = new Set<SimulatorListener>();
  private frameHandle: number | null = null;
  private lastFrameTime = 0;
  private snapshot: SimulatorSnapshot = Object.freeze({
    status: "idle",
    speed: 1,
    currentTime: 0,
    duration: 0,
    progress: 0,
    currentPoint: null,
    currentSegmentIndex: -1,
    headStyle: "laser",
  });

  getSnapshot = (): SimulatorSnapshot => this.snapshot;

  getSegments(): readonly MotionSegment[] {
    return this.segments;
  }

  getHoldingTabMarkers(): readonly SimulatorHoldingTabMarker[] {
    return this.holdingTabMarkers;
  }

  getShowHoldingTabs(): boolean {
    return this.showHoldingTabs;
  }

  subscribe = (listener: SimulatorListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setPlan(plan: OptimizedManufacturingPlan | null, options: SimulatorPlanOptions = {}): void {
    this.stopFrame();
    const machineUnits = options.machineProfile?.units ?? options.machineUnits ?? (plan?.units === "in" ? "in" : "mm");
    const nextSegments = plan
      ? buildSegments(plan, options.rapidFeedRate ?? 6_000, machineUnits, options)
      : { segments: Object.freeze([]), leads: Object.freeze([]), tabs: Object.freeze([]) };
    this.segments = nextSegments.segments;
    this.leadMarkers = nextSegments.leads;
    this.holdingTabMarkers = nextSegments.tabs;
    this.showHoldingTabs = options.showHoldingTabs ?? true;
    const duration = this.segments.at(-1)?.endTime ?? 0;
    this.snapshot = Object.freeze({
      status: plan ? "paused" : "idle",
      speed: this.snapshot.speed,
      currentTime: 0,
      duration,
      progress: 0,
      currentPoint: plan ? freezePoint(plan.startPosition) : null,
      currentSegmentIndex: -1,
      headStyle: options.machineProfile?.mode ?? options.headStyle ?? "laser",
    });
    this.emit();
  }

  setShowHoldingTabs(show: boolean): void {
    if (show === this.showHoldingTabs) return;
    this.showHoldingTabs = show;
    this.emit();
  }

  play(): void {
    if (this.segments.length === 0 || this.snapshot.status === "playing") return;
    if (this.snapshot.status === "complete") this.updateTime(0, "paused");
    this.lastFrameTime = now();
    this.snapshot = Object.freeze({ ...this.snapshot, status: "playing" });
    this.emit();
    this.frameHandle = requestFrame(this.tick);
  }

  pause(): void {
    if (this.snapshot.status !== "playing") return;
    this.stopFrame();
    this.snapshot = Object.freeze({ ...this.snapshot, status: "paused" });
    this.emit();
  }

  toggle(): void {
    if (this.snapshot.status === "playing") this.pause();
    else this.play();
  }

  setSpeed(speed: SimulationSpeed): void {
    if (speed !== 1 && speed !== 2 && speed !== 5) throw new RangeError("Simulation speed must be 1×, 2×, or 5×.");
    if (speed === this.snapshot.speed) return;
    this.snapshot = Object.freeze({ ...this.snapshot, speed });
    this.emit();
  }

  seek(progress: number): void {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
    const status = clamped >= 1 && this.snapshot.duration > 0
      ? "complete"
      : this.snapshot.status === "playing" ? "playing" : "paused";
    this.updateTime(this.snapshot.duration * clamped, status);
    if (status === "complete") this.stopFrame();
    else if (status === "playing") this.lastFrameTime = now();
  }

  dispose(): void {
    this.stopFrame();
    this.listeners.clear();
    this.segments = Object.freeze([]);
    this.holdingTabMarkers = Object.freeze([]);
    this.leadMarkers = Object.freeze([]);
  }

  private tick = (timestamp: number): void => {
    this.frameHandle = null;
    if (this.snapshot.status !== "playing") return;
    const deltaSeconds = Math.max(0, timestamp - this.lastFrameTime) / 1_000 * this.snapshot.speed;
    this.lastFrameTime = timestamp;
    const nextTime = Math.min(this.snapshot.duration, this.snapshot.currentTime + deltaSeconds);
    const complete = nextTime >= this.snapshot.duration - EPSILON;
    this.updateTime(nextTime, complete ? "complete" : "playing");
    if (!complete) this.frameHandle = requestFrame(this.tick);
  };

  private updateTime(currentTime: number, status: SimulationStatus): void {
    const duration = this.snapshot.duration;
    const clampedTime = Math.max(0, Math.min(duration, currentTime));
    let segmentIndex = -1;
    let currentPoint = this.snapshot.currentPoint;
    if (this.segments.length > 0) {
      let low = 0;
      let high = this.segments.length - 1;
      while (low <= high) {
        const middle = (low + high) >>> 1;
        if (this.segments[middle]!.endTime < clampedTime) low = middle + 1;
        else high = middle - 1;
      }
      segmentIndex = Math.min(low, this.segments.length - 1);
      const segment = this.segments[segmentIndex]!;
      const local = segment.duration <= EPSILON
        ? 1
        : Math.max(0, Math.min(1, (clampedTime - segment.startTime) / segment.duration));
      currentPoint = freezePoint({
        x: segment.start.x + (segment.end.x - segment.start.x) * local,
        y: segment.start.y + (segment.end.y - segment.start.y) * local,
      });
    }
    this.snapshot = Object.freeze({
      ...this.snapshot,
      status,
      currentTime: clampedTime,
      progress: duration <= EPSILON ? 0 : clampedTime / duration,
      currentPoint,
      currentSegmentIndex: segmentIndex,
    });
    this.emit();
  }

  private stopFrame(): void {
    if (this.frameHandle === null) return;
    cancelFrame(this.frameHandle);
    this.frameHandle = null;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const toolpathSimulator = new ToolpathSimulator();
