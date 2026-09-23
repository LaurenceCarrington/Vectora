/**
 * Local analytic lead construction: a circle's radius is perpendicular to its
 * tangent, arc length = radius * sweep (radians), and ramp run = drop / tan(angle).
 * Intersections use cross products and the line/circle quadratic equation.
 * These mathematical identities are not a port of a third-party CAM solver.
 * See legal/AUDIT.md for the scope and limits of the provenance review.
 */
import type { Point2D } from "../document/types";
import { pointInClosedPath, signedPolygonArea } from "../geometry/topology";
import { splitPathForHoldingTabs, type HoldingTabMarker, type HoldingTabOptions } from "./holdingTabs";
import type { ManufacturingToolpath } from "./processModel";

export type LeadType = "none" | "arc" | "line" | "ramp";
export interface LeadSettings {
  readonly leadType: LeadType;
  /** Physical millimetres. Arc length for arcs; minimum XY run for ramps. */
  readonly leadLength: number;
  /** Arc sweep or straight lead incidence angle relative to the contour tangent. */
  readonly leadAngle: number;
  /** Maximum downward slope in degrees. */
  readonly rampAngle: number;
}
export interface CutLeadOptions extends Partial<LeadSettings> {
  readonly leadIn?: LeadSettings;
  readonly leadOut?: LeadSettings;
}
export interface CutLeadSettings { readonly leadIn: LeadSettings; readonly leadOut: LeadSettings }
export const DEFAULT_LEAD_SETTINGS: Readonly<LeadSettings> = Object.freeze({ leadType: "none", leadLength: 3, leadAngle: 90, rampAngle: 3 });

export function validateLeadSettings(settings: LeadSettings, exit = false): void {
  if (!["none", "arc", "line", "ramp"].includes(settings.leadType)) throw new TypeError("Unknown lead type.");
  if (!Number.isFinite(settings.leadLength) || settings.leadLength < 0 || (settings.leadType !== "none" && settings.leadLength <= 0)) throw new RangeError("Lead length must be positive when enabled.");
  if (!Number.isFinite(settings.leadAngle) || settings.leadAngle <= 0 || settings.leadAngle > 180) throw new RangeError("Lead angle must be greater than 0° and at most 180°.");
  if ((settings.leadType === "line" || settings.leadType === "ramp") && settings.leadAngle > 90) throw new RangeError("Straight lead angle must be at most 90°.");
  if (!Number.isFinite(settings.rampAngle) || settings.rampAngle <= 0 || settings.rampAngle > 45) throw new RangeError("Ramp angle must be greater than 0° and at most 45°.");
  if (exit && settings.leadType === "ramp") throw new TypeError("Ramp is an entry operation; choose line or arc for lead-out.");
}

export function resolveCutLeadSettings(options: CutLeadOptions = {}): CutLeadSettings {
  const common = { leadType: options.leadType ?? "none", leadLength: options.leadLength ?? 3,
    leadAngle: options.leadAngle ?? 90, rampAngle: options.rampAngle ?? 3 };
  const leadIn = { ...(options.leadIn ?? common) };
  const leadOut = { ...(options.leadOut ?? { ...common, leadType: common.leadType === "ramp" ? "none" : common.leadType }) };
  validateLeadSettings(leadIn); validateLeadSettings(leadOut, true);
  return Object.freeze({ leadIn: Object.freeze(leadIn), leadOut: Object.freeze(leadOut) });
}

interface LeadBase { readonly start: Point2D; readonly end: Point2D }
export interface LineLead extends LeadBase { readonly kind: "line" }
export interface ArcLead extends LeadBase { readonly kind: "arc"; readonly center: Point2D; readonly clockwise: boolean; readonly sweep: number }
export interface RampLead extends LeadBase { readonly kind: "ramp"; readonly startZ: number; readonly endZ: number; readonly angle: number }
export type LeadMotion = LineLead | ArcLead | RampLead;
/** Retain the fully checked XY approach while reducing the Z drop on early passes. */
export function rampForDepth(ramp: RampLead, depth: number): RampLead {
  return { ...ramp, endZ: ramp.startZ - depth,
    angle: Math.atan2(depth, Math.hypot(ramp.end.x - ramp.start.x, ramp.end.y - ramp.start.y)) * 180 / Math.PI };
}
const EPS = 1e-8;
const TAU = Math.PI * 2;
const distance = (a: Point2D, b: Point2D) => Math.hypot(b.x - a.x, b.y - a.y);
const point = (x: number, y: number): Point2D => Object.freeze({ x, y });
const cross = (a: Point2D, b: Point2D) => a.x * b.y - a.y * b.x;

/** Pure world-unit lead geometry. side=+1 is left of travel, -1 is right. */
export function createLead(
  anchor: Point2D, tangent: Point2D, side: 1 | -1, settings: LeadSettings,
  unitsPerMm = 1, exit = false,
): LineLead | ArcLead | null {
  validateLeadSettings(settings, exit);
  if (settings.leadType === "none") return null;
  if (settings.leadType === "ramp") throw new TypeError("Use createRampEntry for a 3D ramp.");
  const magnitude = Math.hypot(tangent.x, tangent.y);
  if (!Number.isFinite(magnitude) || magnitude <= EPS || !Number.isFinite(unitsPerMm) || unitsPerMm <= 0) throw new RangeError("Lead tangent and unit scale must be finite and nonzero.");
  if (![anchor.x, anchor.y].every(Number.isFinite)) throw new TypeError("Lead anchor must be finite.");
  const tx = tangent.x / magnitude, ty = tangent.y / magnitude;
  const nx = -ty * side, ny = tx * side;
  const length = settings.leadLength * unitsPerMm;
  const angle = settings.leadAngle * Math.PI / 180;
  if (settings.leadType === "line") {
    const sign = exit ? 1 : -1;
    const outer = point(anchor.x + length * (sign * tx * Math.cos(angle) + nx * Math.sin(angle)),
      anchor.y + length * (sign * ty * Math.cos(angle) + ny * Math.sin(angle)));
    return Object.freeze({ kind: "line", start: exit ? anchor : outer, end: exit ? outer : anchor });
  }
  const radius = length / angle;
  const center = point(anchor.x + nx * radius, anchor.y + ny * radius);
  const turn = side * angle * (exit ? 1 : -1);
  const rx = anchor.x - center.x, ry = anchor.y - center.y;
  const outer = point(center.x + rx * Math.cos(turn) - ry * Math.sin(turn), center.y + rx * Math.sin(turn) + ry * Math.cos(turn));
  return Object.freeze({ kind: "arc", start: exit ? anchor : outer, end: exit ? outer : anchor, center, clockwise: side === -1, sweep: angle });
}

/** Z values are in the same world units as XY. Length is a minimum, angle a maximum. */
export function createRampEntry(anchor: Point2D, approach: Point2D, surfaceZ: number, workZ: number, minimumRun: number, rampAngle: number): RampLead {
  const magnitude = Math.hypot(approach.x, approach.y);
  if (![anchor.x, anchor.y, magnitude, surfaceZ, workZ, minimumRun, rampAngle].every(Number.isFinite) || magnitude <= EPS || minimumRun <= 0 || workZ >= surfaceZ || rampAngle <= 0 || rampAngle > 45) {
    throw new RangeError("Ramp needs a finite approach, positive length, work Z below stock surface, and an angle in (0°, 45°].");
  }
  const drop = surfaceZ - workZ;
  const run = Math.max(minimumRun, drop / Math.tan(rampAngle * Math.PI / 180));
  return Object.freeze({ kind: "ramp", start: point(anchor.x - approach.x / magnitude * run, anchor.y - approach.y / magnitude * run),
    end: anchor, startZ: surfaceZ, endZ: workZ, angle: Math.atan2(drop, run) * 180 / Math.PI });
}

export function leadPointAt(motion: LeadMotion, t: number): Point2D {
  if (t <= 0) return motion.start;
  if (t >= 1) return motion.end;
  if (motion.kind !== "arc") return point(motion.start.x + (motion.end.x - motion.start.x) * t, motion.start.y + (motion.end.y - motion.start.y) * t);
  const angle = Math.atan2(motion.start.y - motion.center.y, motion.start.x - motion.center.x) + (motion.clockwise ? -1 : 1) * motion.sweep * t;
  const radius = distance(motion.start, motion.center);
  return point(motion.center.x + Math.cos(angle) * radius, motion.center.y + Math.sin(angle) * radius);
}

function angleOnArc(motion: ArcLead, p: Point2D): boolean {
  const start = Math.atan2(motion.start.y - motion.center.y, motion.start.x - motion.center.x);
  const angle = Math.atan2(p.y - motion.center.y, p.x - motion.center.x);
  const sweep = ((motion.clockwise ? start - angle : angle - start) % TAU + TAU) % TAU;
  return sweep <= motion.sweep + EPS || distance(p, motion.start) <= EPS;
}

/** Include cardinal extrema so preflight checks the entire G2/G3 curve. */
export function leadExtrema(motion: LeadMotion): readonly Point2D[] {
  const result = [motion.start, motion.end];
  if (motion.kind === "arc") {
    const radius = distance(motion.start, motion.center);
    for (let i = 0; i < 4; i += 1) {
      const p = point(motion.center.x + radius * Math.cos(i * Math.PI / 2), motion.center.y + radius * Math.sin(i * Math.PI / 2));
      if (angleOnArc(motion, p)) result.push(p);
    }
  }
  return result;
}

/** Polyline approximation for preview/proximity; the compiler retains analytic arcs. */
export function sampleLead(motion: LeadMotion, tolerance = 0.001): readonly Point2D[] {
  let count = 1;
  if (motion.kind === "arc") {
    const radius = distance(motion.start, motion.center);
    const angle = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tolerance / radius)));
    count = Math.max(2, Math.ceil(motion.sweep / Math.max(angle, 1e-6)));
    if (count > 4096) throw new RangeError("Lead arc exceeds the 4096-segment preview limit.");
  }
  return Array.from({ length: count + 1 }, (_, i) => leadPointAt(motion, i / count));
}

function lineIntersections(a: Point2D, b: Point2D, c: Point2D, d: Point2D): Point2D[] {
  const u = { x: b.x - a.x, y: b.y - a.y }, v = { x: d.x - c.x, y: d.y - c.y }, w = { x: c.x - a.x, y: c.y - a.y };
  const denominator = cross(u, v);
  if (Math.abs(denominator) <= EPS) {
    if (Math.abs(cross(w, u)) > EPS) return [];
    const length2 = u.x * u.x + u.y * u.y;
    if (length2 <= EPS * EPS) return [];
    const t0 = (w.x * u.x + w.y * u.y) / length2;
    const t1 = ((d.x - a.x) * u.x + (d.y - a.y) * u.y) / length2;
    const low = Math.max(0, Math.min(t0, t1)), high = Math.min(1, Math.max(t0, t1));
    if (low > high + EPS) return [];
    return [point(a.x + u.x * low, a.y + u.y * low), point(a.x + u.x * high, a.y + u.y * high)];
  }
  const t = cross(w, v) / denominator, s = cross(w, u) / denominator;
  return t >= -EPS && t <= 1 + EPS && s >= -EPS && s <= 1 + EPS ? [point(a.x + u.x * t, a.y + u.y * t)] : [];
}

function intersections(motion: LeadMotion, a: Point2D, b: Point2D): Point2D[] {
  if (motion.kind !== "arc") return lineIntersections(motion.start, motion.end, a, b);
  const dx = b.x - a.x, dy = b.y - a.y, px = a.x - motion.center.x, py = a.y - motion.center.y;
  const A = dx * dx + dy * dy;
  if (A <= EPS * EPS) return [];
  const B = 2 * (px * dx + py * dy), C = px * px + py * py - distance(motion.start, motion.center) ** 2;
  const discriminant = B * B - 4 * A * C;
  if (discriminant < -EPS * A) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  return [(-B - root) / (2 * A), (-B + root) / (2 * A)].filter((t) => t >= -EPS && t <= 1 + EPS)
    .map((t) => point(a.x + dx * t, a.y + dy * t)).filter((p) => angleOnArc(motion, p));
}

function pointSegmentDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

export function leadHitsContour(motion: LeadMotion, points: readonly Point2D[], closed: boolean, allowedContact?: Point2D, clearance = 0): boolean {
  const samples = clearance > 0 ? sampleLead(motion, Math.min(0.0001, clearance / 10)) : [];
  const edges = closed ? points.length : points.length - 1;
  for (let i = 0; i < edges; i += 1) {
    const a = points[i]!, b = points[(i + 1) % points.length]!;
    if (intersections(motion, a, b).some((p) => !allowedContact || distance(p, allowedContact) > 1e-6)) return true;
    if (clearance > 0) {
      for (let j = 1; j < samples.length; j += 1) {
        const c = samples[j - 1]!, d = samples[j]!;
        const near = lineIntersections(c, d, a, b).length ? 0
          : Math.min(pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b), pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d));
        if (near < clearance + Math.min(0.0001, clearance / 10)) return true;
      }
    }
  }
  return false;
}

export interface CutSpan { readonly points: readonly Point2D[]; readonly cutting: boolean }
export interface PreparedCut {
  readonly spans: readonly CutSpan[];
  readonly tabs: readonly HoldingTabMarker[];
  readonly leadIn: LeadMotion | null;
  readonly leadOut: LeadMotion | null;
  readonly entry: Point2D;
  readonly exit: Point2D;
}
export interface CutPreparationOptions {
  readonly unitsPerMm: number;
  readonly mode: "laser" | "spindle";
  /** Z in document units. */
  readonly surfaceZ: number;
  readonly workZ: number;
  readonly holdingTabs?: HoldingTabOptions | false;
  readonly neighbors: readonly ManufacturingToolpath[];
}

/** Called after compensation/optimization. Split tabs first, then choose a seam without moving any tab. */
export function prepareCutPath(toolpath: ManufacturingToolpath, options: CutPreparationOptions): PreparedCut {
  const settings = toolpath.leads ?? resolveCutLeadSettings();
  validateLeadSettings(settings.leadIn); validateLeadSettings(settings.leadOut, true);
  const source = toolpath.points;
  const split = options.mode === "laser" && toolpath.closed && options.holdingTabs ? splitPathForHoldingTabs(source, options.holdingTabs) : null;
  const spans: readonly CutSpan[] = split?.spans ?? [{ cutting: true, points: toolpath.closed ? [...source, source[0]!] : source }];
  const tabs = split?.tabs ?? [];
  const active = settings.leadIn.leadType !== "none" || settings.leadOut.leadType !== "none";
  if (!active) return { spans, tabs, leadIn: null, leadOut: null, entry: source[0]!, exit: toolpath.closed ? source[0]! : source.at(-1)! };
  if (settings.leadIn.leadType === "ramp" && options.mode !== "spindle") throw new Error("Ramp entry requires spindle mode.");
  if (!toolpath.closed && (settings.leadIn.leadType === "arc" || settings.leadOut.leadType === "arc")) throw new Error("Arc leads require a closed cut contour to determine the scrap side; use line or ramp for an open path.");
  const winding = signedPolygonArea(source) >= 0 ? 1 : -1;
  const side = (toolpath.profileKind === "inner" ? winding : -winding) as 1 | -1;
  const clearance = (toolpath.cutKerfWidth ?? 0) / 2;

  const make = (anchor: Point2D, tangent: Point2D, config: LeadSettings, exit: boolean): LeadMotion | null => {
    if (config.leadType === "none") return null;
    const magnitude = Math.hypot(tangent.x, tangent.y);
    const t = point(tangent.x / magnitude, tangent.y / magnitude);
    const angle = (toolpath.closed ? config.leadAngle : 0) * Math.PI / 180;
    if (config.leadType === "ramp") {
      const approach = point(t.x * Math.cos(angle) + t.y * side * Math.sin(angle), t.y * Math.cos(angle) - t.x * side * Math.sin(angle));
      return createRampEntry(anchor, approach, options.surfaceZ, options.workZ, config.leadLength * options.unitsPerMm, config.rampAngle);
    }
    if (!toolpath.closed) {
      const sign = exit ? 1 : -1, length = config.leadLength * options.unitsPerMm;
      const end = point(anchor.x + sign * t.x * length, anchor.y + sign * t.y * length);
      return { kind: "line", start: exit ? anchor : end, end: exit ? end : anchor };
    }
    return createLead(anchor, t, side, config, options.unitsPerMm, exit);
  };

  const clear = (motion: LeadMotion | null, anchor: Point2D): boolean => {
    if (!motion) return true;
    if (leadHitsContour(motion, source, toolpath.closed, anchor)) return false;
    if (toolpath.closed && pointInClosedPath(leadPointAt(motion, 0.5), source) !== (toolpath.profileKind === "inner")) return false;
    if (tabs.some((tab) => leadHitsContour(motion, tab.points, false, undefined, clearance))) return false;
    return !options.neighbors.some((neighbor) => neighbor.id !== toolpath.id &&
      leadHitsContour(motion, neighbor.points, neighbor.closed, undefined, clearance + (neighbor.cutKerfWidth ?? 0) / 2));
  };

  if (!toolpath.closed) {
    const entry = source[0]!, exit = source.at(-1)!;
    const leadIn = make(entry, point(source[1]!.x - entry.x, source[1]!.y - entry.y), settings.leadIn, false);
    const previous = source.at(-2)!;
    const leadOut = make(exit, point(exit.x - previous.x, exit.y - previous.y), settings.leadOut, true);
    if (!clear(leadIn, entry) || !clear(leadOut, exit)) throw new Error(`Lead collides with an adjacent contour (${toolpath.sourceEntityId}).`);
    return { spans, tabs, leadIn, leadOut, entry: leadIn?.start ?? entry, exit: leadOut?.end ?? exit };
  }
  let tried = 0;
  for (let s = 0; s < spans.length; s += 1) {
    const span = spans[s]!;
    if (!span.cutting) continue;
    for (let i = 1; i < span.points.length; i += 1) {
      const a = span.points[i - 1]!, b = span.points[i]!;
      if (distance(a, b) <= EPS) continue;
      for (const fraction of [0.5, 0.25, 0.75]) {
        if (++tried > 4096) throw new Error("Lead placement exceeded 4096 seam candidates. Reduce lead size or simplify the contour.");
        const anchor = point(a.x + (b.x - a.x) * fraction, a.y + (b.y - a.y) * fraction);
        const tangent = point(b.x - a.x, b.y - a.y);
        const leadIn = make(anchor, tangent, settings.leadIn, false), leadOut = make(anchor, tangent, settings.leadOut, true);
        if (!clear(leadIn, anchor) || !clear(leadOut, anchor)) continue;
        const rotated = [
          { cutting: true, points: [anchor, ...span.points.slice(i)] }, ...spans.slice(s + 1), ...spans.slice(0, s),
          { cutting: true, points: [...span.points.slice(0, i), anchor] },
        ];
        return { spans: rotated, tabs, leadIn, leadOut, entry: leadIn?.start ?? anchor, exit: leadOut?.end ?? anchor };
      }
    }
  }
  throw new Error(`No lead entry fits clear of the finished contour, tabs and adjacent paths (${toolpath.sourceEntityId}). Reduce lead length/angle or change the layout.`);
}
