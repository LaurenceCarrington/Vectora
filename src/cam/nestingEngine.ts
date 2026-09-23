import { validateClosedContour } from "./contourValidation";
import polygonClipping, { type MultiPolygon, type Ring } from "polygon-clipping";
import type { BoundingBox, Entity, Layer, Point2D } from "../document/types";
import { entityToClosedPath, entityToEditablePolyline, entityToPath } from "../geometry/operations/pathConversion";
import { assertSelectionEditable } from "../geometry/operations/operationSafety";
import { buildContourHierarchy, pointInClosedPath, signedPolygonArea, type ContourHierarchyNode } from "../geometry/topology";
import { getSelectionBounds, rotateEntities, translateEntities } from "../renderer/TransformOverlay";

export type NestingRotation = number;

/** All lengths and areas use document units and document units squared. */
export interface NestingOptions {
  readonly sheetWidth: number;
  readonly sheetHeight: number;
  readonly spacing?: number;
  readonly margin?: number;
  /** Additional clearance for the full cutting kerf. */
  readonly kerf?: number;
  readonly rotations?: readonly NestingRotation[];
  readonly rotationStep?: number;
  /** Grid fallback resolution in document units; contact candidates are independent of it. */
  readonly searchStep?: number;
  readonly curveTolerance?: number;
  readonly origin?: Point2D;
  readonly layers: readonly Pick<Layer, "id" | "name" | "locked">[];
}

export interface NestedPlacement {
  readonly entityId: string;
  readonly partId: string;
  readonly parentId: string | null;
  readonly sheetIndex: number;
  readonly rotation: NestingRotation;
  /** Rotate about this source-space center, then apply translation. */
  readonly rotationCenter: Point2D;
  readonly translation: Point2D;
  readonly bounds: BoundingBox;
}

export interface NestedSheet {
  readonly sheetIndex: number;
  readonly sheetBounds: BoundingBox;
  readonly usedBounds: BoundingBox;
  readonly entityIds: readonly string[];
  readonly partIds: readonly string[];
  readonly usedArea: number;
  /** Fraction of the full stock area, excluding holes and spacing. */
  readonly utilization: number;
}

export interface NestingResult {
  readonly entities: readonly Entity[];
  readonly placements: readonly NestedPlacement[];
  readonly sheets: readonly NestedSheet[];
  /** First stock sheet, retained for single-sheet callers. */
  readonly sheetBounds: BoundingBox;
  readonly usedBounds: BoundingBox;
  readonly usedArea: number;
  readonly utilization: number;
}

export interface NestingProgress {
  readonly completed: number;
  readonly total: number;
  readonly sheetCount: number;
}

interface Variant {
  readonly angle: number;
  readonly entities: readonly Entity[];
  readonly rotationCenter: Point2D;
  readonly normalization: Point2D;
  readonly polygons: MultiPolygon;
  readonly paths: readonly (readonly Point2D[])[];
  readonly width: number;
  readonly height: number;
}
interface Part {
  readonly id: string;
  readonly sourceIndex: number;
  readonly parents: ReadonlyMap<string, string | null>;
  readonly variants: readonly Variant[];
  readonly area: number;
}
interface Packed {
  readonly part: Part;
  readonly variant: Variant;
  readonly x: number;
  readonly y: number;
  readonly polygons: MultiPolygon;
  readonly paths: readonly (readonly Point2D[])[];
}
const EPSILON = 1e-9;

function compareNumbers(left: number, right: number): number {
  const difference = left - right;
  return Math.abs(difference) <= EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) ? 0 : difference;
}

function positive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be greater than zero.`);
}
function nonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} cannot be negative.`);
}
function ring(path: readonly Point2D[]): Ring {
  return [...path, path[0]!].map(({ x, y }) => [x, y]);
}
function movePolygons(polygons: MultiPolygon, x: number, y: number): MultiPolygon {
  return polygons.map((polygon) => polygon.map((boundary) => boundary.map(([px, py]) => [px + x, py + y])));
}
function movePaths(paths: readonly (readonly Point2D[])[], x: number, y: number): readonly (readonly Point2D[])[] {
  return paths.map((path) => path.map((p) => ({ x: p.x + x, y: p.y + y })));
}
function polygonArea(polygons: MultiPolygon): number {
  return polygons.reduce((sum, polygon) => sum + polygon.reduce((area, boundary, index) =>
    area + (index === 0 ? 1 : -1) * Math.abs(signedPolygonArea(boundary.map(([x, y]) => ({ x, y })))), 0), 0);
}
function descendants(root: ContourHierarchyNode): ContourHierarchyNode[] {
  return [root, ...root.children.flatMap(descendants)];
}
function rotationsFor(options: NestingOptions): number[] {
  if (options.rotationStep !== undefined) {
    positive(options.rotationStep, "Rotation step");
    if (options.rotationStep > 360 || options.rotationStep < 1) throw new RangeError("Rotation step must be between 1 and 360 degrees.");
  }
  const angles = options.rotations ?? (options.rotationStep === undefined
    ? [0, 90, 180, 270]
    : Array.from({ length: Math.ceil(360 / options.rotationStep) }, (_, i) => i * options.rotationStep!));
  if (!angles.length || angles.some((angle) => !Number.isFinite(angle))) throw new RangeError("Choose at least one finite rotation angle.");
  return [...new Set(angles.map((angle) => ((angle % 360) + 360) % 360))];
}

function prepareParts(entities: readonly Entity[], angles: readonly number[], tolerance: number): Part[] {
  const flatten = { tolerance, maximumSegments: 2048 };
  // Closed engravings and scores are anchored details, not material voids.
  const profiles = entities.filter((entity) => entity.intent !== "engrave" && entity.intent !== "score" && entity.intent !== "pocket" && entityToClosedPath(entity, flatten));
  const operands = new Map<string, Entity[]>();
  for (const profile of profiles) {
    const path = entityToClosedPath(profile, flatten)!;
    const invalid = validateClosedContour(path);
    if (invalid) throw new RangeError(`Profile "${profile.id}" has an invalid contour: ${invalid}.`);
    // Persisted compounds distinguish a previously nested part from its host's hole.
    const key = profile.compoundId ? `compound:${profile.compoundId}` : "ungrouped";
    const operand = operands.get(key) ?? [];
    operand.push(profile); operands.set(key, operand);
  }
  const hierarchies = [...operands.values()].map((operand) => buildContourHierarchy(operand, flatten));
  const profileIds = new Set(profiles.map((profile) => profile.id));
  const groups = hierarchies.flatMap((hierarchy) => hierarchy.roots.map((root) => ({ root, nodes: descendants(root), details: [] as Entity[] })));
  // The shared hierarchy uses vertex containment; clipping also verifies concave edges.
  for (const hierarchy of hierarchies) for (const node of hierarchy.nodes) {
    if (!node.parentId) continue;
    const parent = hierarchy.byEntityId.get(node.parentId)!;
    if (polygonArea(polygonClipping.difference([[ring(node.path)]], [[ring(parent.path)]])) > EPSILON * EPSILON) {
      throw new RangeError(`Contour "${node.entityId}" crosses its parent perimeter.`);
    }
  }
  for (const detail of entities.filter((entity) => !profileIds.has(entity.id))) {
    const path = entityToPath(detail, flatten);
    if (!path) throw new TypeError(`Entity "${detail.id}" is not a nestable contour or anchored path.`);
    const owner = groups.filter(({ root }) => (!detail.compoundId || detail.compoundId === root.entity.compoundId) && path.points.every((p) => pointInClosedPath(p, root.path)))
      .sort((a, b) => a.root.absoluteArea - b.root.absoluteArea)[0];
    if (!owner) throw new TypeError(`Open or engraved path "${detail.id}" must lie inside a selected perimeter.`);
    owner.details.push(detail);
  }
  if (!groups.length) throw new RangeError("Select at least one closed material perimeter to nest.");
  return groups.map(({ root, nodes, details }): Part => {
    const members = [...nodes.map((node) => node.entity), ...details];
    const bounds = getSelectionBounds(members)!;
    const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    const parents = new Map(nodes.map((node) => [node.entityId, node.parentId]));
    details.forEach((entity) => parents.set(entity.id, root.entityId));
    const variants = angles.map((angle): Variant => {
      // Editable curves avoid tessellating rounded primitives during model mutation.
      const rotatable = members.map((entity) => {
        if (angle === 0 || (entity.type !== "rectangle" && entity.type !== "quadrant")) return entity;
        const polyline = entityToEditablePolyline(entity)!;
        return { ...entity, ...polyline };
      });
      const rotated = angle === 0 ? rotatable : rotateEntities(rotatable, center, angle * Math.PI / 180);
      const rotatedBounds = getSelectionBounds(rotated)!;
      const normalization = { x: -rotatedBounds.minX, y: -rotatedBounds.minY };
      const normalized = translateEntities(rotated, normalization);
      const byId = new Map(normalized.map((entity) => [entity.id, entity]));
      const polygons: MultiPolygon = nodes.filter((node) => node.kind === "outer").map((node) => [
        ring(entityToClosedPath(byId.get(node.entityId)!, flatten)!),
        ...node.holes.map((hole) => ring(entityToClosedPath(byId.get(hole.entityId)!, flatten)!)),
      ]);
      const paths = polygons.flatMap((polygon) => polygon.map((boundary) => boundary.slice(0, -1).map(([x, y]) => ({ x, y }))));
      return { angle, entities: normalized, rotationCenter: center, normalization, polygons, paths, width: rotatedBounds.maxX - rotatedBounds.minX, height: rotatedBounds.maxY - rotatedBounds.minY };
    });
    // Area is invariant under placement; parity includes nested islands.
    const area = nodes.reduce((sum, node) => sum + (node.kind === "outer" ? 1 : -1) * node.absoluteArea, 0);
    return { id: root.entityId, sourceIndex: entities.indexOf(root.entity), parents, variants, area };
  });
}

function pointSegmentDistanceSquared(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
}
function cross(a: Point2D, b: Point2D, p: Point2D): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}
function segmentDistanceSquared(a: Point2D, b: Point2D, c: Point2D, d: Point2D): number {
  if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return 0;
  return Math.min(pointSegmentDistanceSquared(a, c, d), pointSegmentDistanceSquared(b, c, d),
    pointSegmentDistanceSquared(c, a, b), pointSegmentDistanceSquared(d, a, b));
}
function collides(variant: Variant, x: number, y: number, packed: readonly Packed[], clearance: number): boolean {
  let polygons: MultiPolygon | undefined;
  let paths: readonly (readonly Point2D[])[] | undefined;
  for (const item of packed) {
    if (x >= item.x + item.variant.width + clearance - EPSILON || x + variant.width + clearance <= item.x + EPSILON ||
        y >= item.y + item.variant.height + clearance - EPSILON || y + variant.height + clearance <= item.y + EPSILON) continue;
    polygons ??= movePolygons(variant.polygons, x, y);
    if (polygonArea(polygonClipping.intersection(polygons, item.polygons)) > EPSILON * EPSILON) return true;
    if (clearance === 0) continue;
    paths ??= movePaths(variant.paths, x, y);
    const threshold = Math.max(0, clearance - EPSILON) ** 2;
    for (const left of paths) for (const right of item.paths) {
      for (let i = 0; i < left.length; i++) for (let j = 0; j < right.length; j++) {
        const a = left[i]!;
        const b = left[(i + 1) % left.length]!;
        const c = right[j]!;
        const d = right[(j + 1) % right.length]!;
        if (Math.min(a.x, b.x) > Math.max(c.x, d.x) + clearance || Math.min(c.x, d.x) > Math.max(a.x, b.x) + clearance ||
            Math.min(a.y, b.y) > Math.max(c.y, d.y) + clearance || Math.min(c.y, d.y) > Math.max(a.y, b.y) + clearance) continue;
        if (segmentDistanceSquared(a, b, c, d) < threshold) return true;
      }
    }
  }
  return false;
}

/** Samples only candidate generation; collision checks always retain every vertex. */
function contactVertices(paths: readonly (readonly Point2D[])[]): Point2D[] {
  return paths.flatMap((path) => {
    const stride = Math.max(1, Math.ceil(path.length / 32));
    return path.filter((_, i) => i % stride === 0);
  });
}
function candidates(variant: Variant, packed: readonly Packed[], width: number, height: number, clearance: number): Point2D[] {
  const points = new Map<string, Point2D>();
  const add = (x: number, y: number) => {
    if (x < -EPSILON || y < -EPSILON || x + variant.width > width + EPSILON || y + variant.height > height + EPSILON) return;
    const p = { x: Math.max(0, x), y: Math.max(0, y) };
    points.set(`${p.x.toPrecision(12)},${p.y.toPrecision(12)}`, p);
  };
  add(0, 0);
  add(width - variant.width, 0);
  add(0, height - variant.height);
  const moving = contactVertices(variant.paths);
  for (const item of packed) {
    // Axis contacts also cover straight edge interiors and rectangular stock.
    const xs = [0, item.x, item.x + item.variant.width + clearance, item.x - variant.width - clearance];
    const ys = [0, item.y, item.y + item.variant.height + clearance, item.y - variant.height - clearance];
    for (const x of xs) for (const y of ys) add(x, y);
    const fixed = contactVertices(item.paths);
    // Vertex differences are configuration-space contacts (A + -B).
    for (const a of fixed) for (const b of moving) {
      const x = a.x - b.x;
      const y = a.y - b.y;
      add(x, y);
      if (clearance > 0) {
        for (const [dx, dy] of [[clearance, 0], [-clearance, 0], [0, clearance], [0, -clearance],
          [clearance, clearance], [-clearance, clearance], [clearance, -clearance], [-clearance, -clearance]]) add(x + dx!, y + dy!);
      }
    }
    // Offset edge-normal contacts capture clearance between sloping edges.
    if (clearance > 0) for (const path of item.paths) {
      const stride = Math.max(1, Math.ceil(path.length / 32));
      for (let i = 0; i < path.length; i += stride) {
        const a = path[i]!;
        const b = path[(i + 1) % path.length]!;
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length === 0) continue;
        const nx = -(b.y - a.y) / length * clearance;
        const ny = (b.x - a.x) / length * clearance;
        for (const p of moving) { add(a.x - p.x + nx, a.y - p.y + ny); add(a.x - p.x - nx, a.y - p.y - ny); }
      }
    }
  }
  return [...points.values()].sort((a, b) => a.y - b.y || a.x - b.x);
}
function findPlacement(part: Part, packed: readonly Packed[], width: number, height: number, clearance: number, step: number): Packed | null {
  let best: { variant: Variant; point: Point2D } | null = null;
  for (const variant of part.variants) {
    if (variant.width > width + EPSILON || variant.height > height + EPSILON) continue;
    for (const point of candidates(variant, packed, width, height, clearance)) {
      if (best && (point.y > best.point.y + EPSILON || (Math.abs(point.y - best.point.y) <= EPSILON && point.x >= best.point.x - EPSILON))) break;
      if (!collides(variant, point.x, point.y, packed, clearance)) { best = { variant, point }; break; }
    }
  }
  // Grid fallback searches concavities and voids not represented by sampled contacts.
  if (!best) for (const variant of part.variants) {
    const maxX = width - variant.width;
    const maxY = height - variant.height;
    if (maxX < -EPSILON || maxY < -EPSILON) continue;
    const nx = Math.ceil(Math.max(0, maxX) / step);
    const ny = Math.ceil(Math.max(0, maxY) / step);
    for (let iy = 0; iy <= ny && !best; iy++) for (let ix = 0; ix <= nx; ix++) {
      const x = Math.min(ix * step, maxX);
      const y = Math.min(iy * step, maxY);
      if (!collides(variant, x, y, packed, clearance)) { best = { variant, point: { x, y } }; break; }
    }
    if (best) break;
  }
  if (!best) return null;
  const { variant, point: { x, y } } = best;
  return { part, variant, x, y, polygons: movePolygons(variant.polygons, x, y), paths: movePaths(variant.paths, x, y) };
}

/** Deterministic first-fit decreasing polygon nesting with exact polygon collision validation.
 * Concave shells and holes are clipped directly; no convex-envelope approximation is used.
 * Contact/grid search is heuristic and can allocate stock before a global optimum is found.
 */
export function nestEntities(entities: readonly Entity[], options: NestingOptions, onProgress?: (progress: NestingProgress) => void): NestingResult {
  if (!entities.length) throw new RangeError("Select at least one closed entity to nest.");
  if (new Set(entities.map((entity) => entity.id)).size !== entities.length) throw new TypeError("Duplicate nesting entity IDs.");
  assertSelectionEditable(entities, options.layers);
  positive(options.sheetWidth, "Sheet width"); positive(options.sheetHeight, "Sheet height");
  const spacing = options.spacing ?? 3;
  const margin = options.margin ?? 3;
  const kerf = options.kerf ?? 0;
  nonNegative(spacing, "Part spacing"); nonNegative(margin, "Sheet margin"); nonNegative(kerf, "Kerf");
  const inset = margin + kerf / 2;
  const width = options.sheetWidth - 2 * inset;
  const height = options.sheetHeight - 2 * inset;
  if (width <= 0 || height <= 0) throw new RangeError("Sheet margins and kerf leave no usable nesting area.");
  const step = options.searchStep ?? Math.min(width, height) / 128;
  const tolerance = options.curveTolerance ?? Math.min(width, height) / 10000;
  positive(step, "Search step"); positive(tolerance, "Curve tolerance");
  if (Math.ceil(width / step) * Math.ceil(height / step) > 1_000_000) throw new RangeError("Search step creates more than one million grid positions; increase it.");
  const origin = options.origin ?? { x: 0, y: 0 };
  if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y)) throw new RangeError("Sheet origin must be finite.");
  const parts = prepareParts(entities, rotationsFor(options), tolerance);
  for (const part of parts) {
    if (!part.variants.some((v) => v.width <= width + EPSILON && v.height <= height + EPSILON)) {
      throw new RangeError(`Part "${part.id}" is larger than the usable stock in every allowed rotation.`);
    }
  }
  // Large envelopes first ensures void-bearing parts are available to smaller parts.
  const ordered = [...parts].sort((a, b) =>
    compareNumbers(b.variants[0]!.width * b.variants[0]!.height, a.variants[0]!.width * a.variants[0]!.height) || compareNumbers(b.area, a.area) || a.sourceIndex - b.sourceIndex);
  const stock: Packed[][] = [];
  onProgress?.({ completed: 0, total: parts.length, sheetCount: 0 });
  for (const [index, part] of ordered.entries()) {
    let placed = false;
    for (const sheet of stock) {
      const placement = findPlacement(part, sheet, width, height, spacing + kerf, step);
      if (placement) { sheet.push(placement); placed = true; break; }
    }
    if (!placed) stock.push([findPlacement(part, [], width, height, spacing + kerf, step)!]);
    onProgress?.({ completed: index + 1, total: parts.length, sheetCount: stock.length });
  }
  const after = new Map<string, Entity>();
  const placements: NestedPlacement[] = [];
  const sheets: NestedSheet[] = [];
  const sheetGap = Math.max(spacing + kerf, 2 * margin);
  for (const [sheetIndex, sheet] of stock.entries()) {
    const sheetX = origin.x + sheetIndex * (options.sheetWidth + sheetGap);
    const sheetEntities: Entity[] = [];
    for (const item of sheet) {
      const translation = { x: sheetX + inset + item.x, y: origin.y + inset + item.y };
      const moved = translateEntities(item.variant.entities, translation);
      for (const movedEntity of moved) {
        const entity = { ...movedEntity, compoundId: `nest:${item.part.id}` };
        after.set(entity.id, entity); sheetEntities.push(entity);
        placements.push({ entityId: entity.id, partId: item.part.id, parentId: item.part.parents.get(entity.id) ?? null,
          sheetIndex, rotation: item.variant.angle, rotationCenter: item.variant.rotationCenter,
          translation: { x: translation.x + item.variant.normalization.x, y: translation.y + item.variant.normalization.y }, bounds: entity.bbox });
      }
    }
    const usedArea = sheet.reduce((sum, item) => sum + item.part.area, 0);
    sheets.push({ sheetIndex, sheetBounds: { minX: sheetX, minY: origin.y, maxX: sheetX + options.sheetWidth, maxY: origin.y + options.sheetHeight },
      usedBounds: getSelectionBounds(sheetEntities)!, entityIds: sheetEntities.map((entity) => entity.id), partIds: sheet.map((item) => item.part.id),
      usedArea, utilization: usedArea / (options.sheetWidth * options.sheetHeight) });
  }
  const output = entities.map((entity) => after.get(entity.id)!);
  const usedArea = sheets.reduce((sum, sheet) => sum + sheet.usedArea, 0);
  return { entities: output, placements, sheets, sheetBounds: sheets[0]!.sheetBounds, usedBounds: getSelectionBounds(output)!,
    usedArea, utilization: usedArea / (sheets.length * options.sheetWidth * options.sheetHeight) };
}
