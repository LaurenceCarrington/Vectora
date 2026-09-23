import { ClipperD, ClipType, EndType, FillRule, JoinType, differenceD, inflatePathsD, unionD, type PathsD } from "clipper2-ts";
import type { Entity, Point2D } from "../document/types";
import { entityToClosedPath } from "../geometry/operations/pathConversion";
import { buildContourHierarchy, pointInClosedPath, signedPolygonArea } from "../geometry/topology";
import { validateClosedContour } from "./contourValidation";

export type PocketStrategy = "concentric" | "linear";
export interface PocketSettings {
  /** Diameter and depth distances are in document units in a manufacturing plan. */
  readonly toolDiameter: number;
  /** Percentage, e.g. 60 means 0.6 * toolDiameter. */
  readonly stepoverPct?: number;
  readonly strategy: PocketStrategy;
  readonly depth: number;
  readonly stepdown: number;
}
/** Plan generation adds Z settings; the standalone XY generator only needs the cutter and pattern. */
export type PocketGeometryOptions = Pick<PocketSettings, "toolDiameter" | "stepoverPct" | "strategy"> & Partial<Pick<PocketSettings, "depth" | "stepdown">>;
export interface PocketPath { readonly points: readonly Point2D[]; readonly closed: boolean }
export interface PocketResult {
  readonly paths: readonly PocketPath[];
  /** Cutter-center region: positive shells and negative island boundaries. */
  readonly clearance: PathsD;
  readonly iterations: number;
  readonly stepover: number;
}
const PRECISION = 6;
const EPS = 1e-6;
const MAX_PASSES = 5000;
const MAX_POINTS = 250000;

/** Pocket contours plus enclosed cut contours (imported holes) share parity. */
export function buildPocketHierarchy(entities: readonly Entity[]) {
  const pockets = entities.filter((entity) => entity.intent === "pocket");
  if (!pockets.length) return buildContourHierarchy([]);
  const options = { tolerance: 0.01, maximumSegments: 2048 };
  const candidates = buildContourHierarchy(entities.filter((entity) => entity.intent === "pocket" || entity.intent === "cut"), options);
  const enclosedCuts = candidates.nodes.filter((node) => {
    if (node.entity.intent !== "cut") return false;
    let parent = node.parentId ? candidates.byEntityId.get(node.parentId) : undefined;
    while (parent) {
      if (parent.entity.intent === "pocket") return true;
      parent = parent.parentId ? candidates.byEntityId.get(parent.parentId) : undefined;
    }
    return false;
  }).map((node) => node.entity);
  const boundaries = [...pockets, ...enclosedCuts];
  validatePocketContours(boundaries);
  return buildContourHierarchy(boundaries, options);
}

export function validatePocketSettings(settings: PocketSettings): void {
  for (const [name, value] of [["Tool diameter", settings.toolDiameter], ["Pocket depth", settings.depth], ["Stepdown", settings.stepdown]] as const) {
    if (!Number.isFinite(value) || value < 0.00001) throw new RangeError(`${name} must be at least 0.00001 units.`);
  }
  const pct = settings.stepoverPct ?? 60;
  if (!Number.isFinite(pct) || pct < 1 || pct > 80) throw new RangeError("Pocket stepover must be between 1% and 80%.");
  if (settings.strategy !== "concentric" && settings.strategy !== "linear") throw new TypeError("Unknown pocket strategy.");
  if (settings.toolDiameter * pct / 100 < 0.00001) throw new RangeError("Pocket stepover is below the geometry precision.");
  if (Math.ceil(settings.depth / settings.stepdown) > MAX_PASSES) throw new RangeError("Pocket exceeds 5000 depth passes.");
}

export function orientPocketPath(path: readonly Point2D[], positive: boolean): Point2D[] {
  const copy = path.map((p) => ({ x: p.x, y: p.y }));
  return (signedPolygonArea(copy) > 0) === positive ? copy : copy.reverse();
}

/** Reject touching/crossing contours before containment classification. */
export function validatePocketContours(entities: readonly Entity[]): void {
  const paths = entities.map((entity) => {
    let path = entityToClosedPath(entity, { tolerance: 0.01, maximumSegments: 2048 });
    // Analytic rounded primitives can emit duplicate tangent vertices; retain
    // strict validation for authored polyline nodes but remove those artifacts.
    if (path && entity.type !== "polyline") {
      path = path.filter((point, index, points) => index === 0 || Math.hypot(point.x - points[index - 1]!.x, point.y - points[index - 1]!.y) > EPS);
      if (path.length > 1 && Math.hypot(path[0]!.x - path.at(-1)!.x, path[0]!.y - path.at(-1)!.y) <= EPS) path = path.slice(0, -1);
    }
    if (!path || validateClosedContour(path)) throw new TypeError(`Pocket boundary ${entity.id} must be a simple, non-degenerate closed contour.`);
    return path;
  });
  for (let i = 0; i < paths.length; i += 1) {
    for (let j = i + 1; j < paths.length; j += 1) {
      for (let a = 0; a < paths[i]!.length; a += 1) {
        const p = paths[i]![a]!; const q = paths[i]![(a + 1) % paths[i]!.length]!;
        for (let b = 0; b < paths[j]!.length; b += 1) {
          const r = paths[j]![b]!; const s = paths[j]![(b + 1) % paths[j]!.length]!;
          if (Math.max(p.x, q.x) < Math.min(r.x, s.x) - EPS || Math.max(r.x, s.x) < Math.min(p.x, q.x) - EPS ||
            Math.max(p.y, q.y) < Math.min(r.y, s.y) - EPS || Math.max(r.y, s.y) < Math.min(p.y, q.y) - EPS) continue;
          const cross = (u: Point2D, v: Point2D, w: Point2D) => (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x);
          if (cross(p, q, r) * cross(p, q, s) <= EPS && cross(r, s, p) * cross(r, s, q) <= EPS) {
            throw new TypeError("Pocket contours must not cross or touch. Separate the boundary and islands.");
          }
        }
      }
    }
  }
}

function clipLines(lines: PathsD, region: PathsD): PathsD {
  const clipper = new ClipperD(PRECISION);
  clipper.addOpenSubjectPaths(lines);
  clipper.addClipPaths(region);
  const result: PathsD = [];
  if (!clipper.execute(ClipType.Intersection, FillRule.NonZero, [], result)) throw new Error("Pocket line clipping failed.");
  return result;
}

/** A complete connector must remain in the cutter-center region, including islands. */
export function pocketLinkIsClear(a: Point2D, b: Point2D, region: PathsD): boolean {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length <= EPS) return true;
  const clipped = clipLines([[{ ...a }, { ...b }]], region);
  return clipped.length === 1 && Math.abs(Math.hypot(clipped[0]![0]!.x - clipped[0]!.at(-1)!.x,
    clipped[0]![0]!.y - clipped[0]!.at(-1)!.y) - length) <= EPS * 3;
}

function hatch(region: PathsD, stepover: number): PocketPath[] {
  const vertices = region.flat();
  if (!vertices.length) return [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of vertices) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const rows = Math.max(1, Math.ceil((maxY - minY) / stepover));
  if (rows > MAX_PASSES) throw new RangeError("Pocket exceeds 5000 raster rows. Increase the cutter or stepover.");
  const result: PocketPath[] = [];
  for (let row = 0; row < rows; row += 1) {
    const y = minY + (row + 0.5) * (maxY - minY) / rows;
    const spans = clipLines([[{ x: minX - 1, y }, { x: maxX + 1, y }]], region)
      .map((points) => points.sort((a, b) => a.x - b.x)).sort((a, b) => a[0]!.x - b[0]!.x);
    if (row % 2) { spans.reverse(); spans.forEach((span) => span.reverse()); }
    result.push(...spans.filter((points) => points.length >= 2).map((points) => ({ points, closed: false })));
  }
  return result;
}

/** Generate a cutter-compensated pocket, with optional nested island entities. */
export function generatePocketToolpaths(boundary: Entity, settings: PocketGeometryOptions, islands: readonly Entity[] = []): PocketResult {
  validatePocketSettings({ depth: 1, stepdown: 0.5, ...settings });
  validatePocketContours([boundary, ...islands]);
  const hierarchy = buildContourHierarchy([boundary, ...islands], { tolerance: 0.01, maximumSegments: 2048 });
  if (hierarchy.roots.length !== 1 || hierarchy.roots[0]!.entityId !== boundary.id) throw new TypeError("Pocket islands must lie strictly inside their boundary.");
  const source = unionD(hierarchy.nodes.map((node) => orientPocketPath(node.path, node.depth % 2 === 0)), [], FillRule.NonZero, PRECISION);
  const stepover = settings.toolDiameter * (settings.stepoverPct ?? 60) / 100;
  const arcTolerance = Math.max(EPS * 4, Math.min(0.001, settings.toolDiameter * 0.0001));
  // Expand clearance slightly to account for round-offset chord approximation.
  const radius = settings.toolDiameter / 2 + arcTolerance * 2;
  const offset = (distance: number) => inflatePathsD(source, -distance, JoinType.Round, EndType.Polygon, 2, PRECISION, arcTolerance);
  const clearance = offset(radius);
  if (!clearance.length) throw new RangeError(`Cutter does not fit pocket ${boundary.id}. Use a smaller diameter.`);
  const paths: PocketPath[] = [];
  let iterations = 1;
  if (settings.strategy === "linear") {
    // Finish the perimeter as well as the hatch so boundary strips are cleared.
    paths.push(...clearance.map((points) => ({ points, closed: true })), ...hatch(clearance, stepover));
  } else {
    let current = clearance;
    for (let index = 0; current.length; index += 1) {
      if (index >= MAX_PASSES) throw new RangeError("Pocket exceeds 5000 inward offsets.");
      iterations = index + 1;
      paths.push(...current.map((points) => ({ points, closed: true })));
      const next = offset(radius + (index + 1) * stepover);
      // Clear each collapsing component's final core; stopping at the last
      // ring alone can leave a central ridge when stepover exceeds the radius.
      for (const shell of current.filter((path) => signedPolygonArea(path) > 0)) {
        if (next.some((path) => signedPolygonArea(path) > 0 && pointInClosedPath(path[0]!, shell))) continue;
        const component = current.filter((path) => path === shell || (signedPolygonArea(path) < 0 && pointInClosedPath(path[0]!, shell)));
        paths.push(...hatch(component, stepover));
      }
      if (paths.reduce((total, path) => total + path.points.length, 0) > MAX_POINTS) throw new RangeError("Pocket exceeds 250000 path vertices.");
      current = next;
    }
  }
  if (settings.strategy === "concentric") {
    // Offset fronts can merge beside islands or split at narrow necks before
    // their remaining slivers are swept. Measure the swept cutter region and
    // finish those residual areas, rather than assuming empty offsets mean
    // complete coverage. All cleanup centerlines remain in clearance.
    const strokes = paths.map((path) => path.closed ? [...path.points, path.points[0]!] : [...path.points]);
    const swept = inflatePathsD(strokes, settings.toolDiameter / 2 - arcTolerance * 2,
      JoinType.Round, EndType.Round, 2, PRECISION, arcTolerance);
    const residual = differenceD(clearance, swept, FillRule.NonZero, PRECISION);
    if (residual.length) {
      paths.push(...residual.map((points) => ({ points, closed: true })), ...hatch(residual, stepover));
    }
  }
  if (paths.reduce((total, path) => total + path.points.length, 0) > MAX_POINTS) throw new RangeError("Pocket exceeds 250000 path vertices.");
  return { paths, clearance, iterations, stepover };
}
