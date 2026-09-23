import type { BoundingBox, Entity, EntityId, Point2D } from "../document/types";
import { entityToClosedPath, type CurveFlattenOptions } from "./operations/pathConversion";

export type ContourKind = "outer" | "inner";

export interface ContourHierarchyNode {
  readonly entity: Entity;
  readonly entityId: EntityId;
  readonly path: readonly Point2D[];
  readonly bbox: Readonly<BoundingBox>;
  readonly signedArea: number;
  readonly absoluteArea: number;
  readonly parentId: EntityId | null;
  readonly depth: number;
  /** Even depths are material perimeters; odd depths are void boundaries. */
  readonly kind: ContourKind;
  /** Immediate descendants. Their parity is always opposite to this node. */
  readonly children: readonly ContourHierarchyNode[];
  /** Immediate hole boundaries belonging to an even-depth solid boundary. */
  readonly holes: readonly ContourHierarchyNode[];
}

export interface ContourHierarchy {
  /** Every valid, non-degenerate closed contour in input order. */
  readonly nodes: readonly ContourHierarchyNode[];
  /** Contours with no containing parent. */
  readonly roots: readonly ContourHierarchyNode[];
  /** Every even-depth material boundary, including islands inside holes. */
  readonly solidBoundaries: readonly ContourHierarchyNode[];
  readonly byEntityId: ReadonlyMap<EntityId, ContourHierarchyNode>;
}

interface Candidate {
  readonly entity: Entity;
  readonly entityId: EntityId;
  readonly path: readonly Point2D[];
  readonly bbox: Readonly<BoundingBox>;
  readonly signedArea: number;
  readonly absoluteArea: number;
  readonly inputIndex: number;
}

interface MutableNode {
  readonly entity: Entity;
  readonly entityId: EntityId;
  readonly path: readonly Point2D[];
  readonly bbox: Readonly<BoundingBox>;
  readonly signedArea: number;
  readonly absoluteArea: number;
  readonly parentId: EntityId | null;
  readonly depth: number;
  readonly kind: ContourKind;
  children: ContourHierarchyNode[];
  holes: ContourHierarchyNode[];
}

const EPSILON = 1e-9;
const BOUNDARY_EPSILON = 1e-8;

export function signedPolygonArea(path: readonly Point2D[]): number {
  let twiceArea = 0;
  for (let index = 0; index < path.length; index += 1) {
    const current = path[index];
    const next = path[(index + 1) % path.length];
    if (current && next) twiceArea += current.x * next.y - next.x * current.y;
  }
  return twiceArea / 2;
}

function pointOnSegment(point: Point2D, start: Point2D, end: Point2D): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const cross = (point.x - start.x) * dy - (point.y - start.y) * dx;
  const scale = Math.max(1, Math.abs(dx), Math.abs(dy));
  if (Math.abs(cross) > BOUNDARY_EPSILON * scale) return false;
  const dot = (point.x - start.x) * dx + (point.y - start.y) * dy;
  const lengthSquared = dx * dx + dy * dy;
  return dot >= -EPSILON && dot <= lengthSquared + EPSILON;
}

/** Boundary points count as contained, matching CAD profile classification semantics. */
export function pointInClosedPath(point: Point2D, path: readonly Point2D[]): boolean {
  let inside = false;
  for (let current = 0, previous = path.length - 1; current < path.length; previous = current++) {
    const a = path[current];
    const b = path[previous];
    if (!a || !b) continue;
    if (pointOnSegment(point, a, b)) return true;
    const crosses = a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pathBounds(path: readonly Point2D[]): Readonly<BoundingBox> {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of path) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return Object.freeze({ minX, minY, maxX, maxY });
}

function boundsContain(outer: BoundingBox, inner: BoundingBox): boolean {
  return outer.minX <= inner.minX + EPSILON &&
    outer.minY <= inner.minY + EPSILON &&
    outer.maxX >= inner.maxX - EPSILON &&
    outer.maxY >= inner.maxY - EPSILON;
}

function representativePoint(path: readonly Point2D[]): Point2D {
  const first = path[0]!;
  let averageX = 0;
  let averageY = 0;
  for (const point of path) {
    averageX += point.x / path.length;
    averageY += point.y / path.length;
  }
  // Move a very small distance away from the first boundary vertex. The full
  // vertex containment check below remains authoritative for concave paths.
  return {
    x: first.x + (averageX - first.x) * 1e-7,
    y: first.y + (averageY - first.y) * 1e-7,
  };
}

function freezePath(path: readonly Point2D[]): readonly Point2D[] {
  const points: Point2D[] = [];
  for (const point of path) {
    const previous = points.at(-1);
    if (previous && Math.abs(previous.x - point.x) <= EPSILON && Math.abs(previous.y - point.y) <= EPSILON) {
      continue;
    }
    points.push(Object.freeze({ x: point.x, y: point.y }));
  }
  if (points.length > 2) {
    const first = points[0]!;
    const last = points.at(-1)!;
    if (Math.abs(first.x - last.x) <= EPSILON && Math.abs(first.y - last.y) <= EPSILON) points.pop();
  }
  return Object.freeze(points);
}

function containsCandidate(outer: Candidate, inner: Candidate): boolean {
  if (outer.absoluteArea <= inner.absoluteArea + EPSILON) return false;
  if (!boundsContain(outer.bbox, inner.bbox)) return false;
  if (!pointInClosedPath(representativePoint(inner.path), outer.path)) return false;
  return inner.path.every((vertex) => pointInClosedPath(vertex, outer.path));
}

function firstAreaGreaterThan(candidates: readonly Candidate[], threshold: number): number {
  let low = 0;
  let high = candidates.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (candidates[middle]!.absoluteArea <= threshold) low = middle + 1;
    else high = middle;
  }
  return low;
}

function depthFor(
  entityId: EntityId,
  parentById: ReadonlyMap<EntityId, EntityId | null>,
  depthById: Map<EntityId, number>,
): number {
  const cached = depthById.get(entityId);
  if (cached !== undefined) return cached;
  const chain: EntityId[] = [];
  const visited = new Set<EntityId>();
  let currentId: EntityId | null = entityId;
  let depth = -1;
  while (currentId) {
    const knownDepth = depthById.get(currentId);
    if (knownDepth !== undefined) {
      depth = knownDepth;
      break;
    }
    if (visited.has(currentId)) throw new Error("Cyclic contour containment detected.");
    visited.add(currentId);
    chain.push(currentId);
    currentId = parentById.get(currentId) ?? null;
  }
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    depth += 1;
    depthById.set(chain[index]!, depth);
  }
  return depthById.get(entityId)!;
}

/**
 * Builds one deterministic even/odd containment graph for CAM and 3D output.
 * The smallest-area valid container becomes the direct parent. Bounding-box
 * rejection happens before point-in-polygon work, preserving the previous CAM
 * behavior while avoiding expensive checks for spatially unrelated contours.
 */
export function buildContourHierarchy(
  entities: readonly Entity[],
  options: CurveFlattenOptions = {},
): ContourHierarchy {
  const seenIds = new Set<EntityId>();
  const candidates: Candidate[] = [];

  entities.forEach((entity, inputIndex) => {
    if (seenIds.has(entity.id)) throw new Error(`Duplicate contour entity id "${entity.id}".`);
    seenIds.add(entity.id);
    const converted = entityToClosedPath(entity, options);
    if (!converted) return;
    const path = freezePath(converted);
    if (path.length < 3) return;
    const signedArea = signedPolygonArea(path);
    if (!Number.isFinite(signedArea) || Math.abs(signedArea) <= EPSILON) return;
    candidates.push(Object.freeze({
      entity,
      entityId: entity.id,
      path,
      bbox: pathBounds(path),
      signedArea,
      absoluteArea: Math.abs(signedArea),
      inputIndex,
    }));
  });

  // Ascending area lets each contour select the first/smallest valid parent.
  const byArea = [...candidates].sort(
    (left, right) => left.absoluteArea - right.absoluteArea || left.inputIndex - right.inputIndex,
  );
  const parentById = new Map<EntityId, EntityId | null>();
  for (let index = 0; index < byArea.length; index += 1) {
    const candidate = byArea[index]!;
    let parentId: EntityId | null = null;
    // Skip the complete equal/smaller-area range. This makes the common case of
    // many similarly sized, disjoint parts O(n log n) rather than O(n²).
    const firstLarger = firstAreaGreaterThan(byArea, candidate.absoluteArea + EPSILON);
    for (let parentIndex = firstLarger; parentIndex < byArea.length; parentIndex += 1) {
      const possibleParent = byArea[parentIndex]!;
      if (!containsCandidate(possibleParent, candidate)) continue;
      parentId = possibleParent.entityId;
      break;
    }
    parentById.set(candidate.entityId, parentId);
  }

  const mutableById = new Map<EntityId, MutableNode>();
  const depthById = new Map<EntityId, number>();
  for (const candidate of candidates) {
    const depth = depthFor(candidate.entityId, parentById, depthById);
    mutableById.set(candidate.entityId, {
      entity: candidate.entity,
      entityId: candidate.entityId,
      path: candidate.path,
      bbox: candidate.bbox,
      signedArea: candidate.signedArea,
      absoluteArea: candidate.absoluteArea,
      parentId: parentById.get(candidate.entityId) ?? null,
      depth,
      kind: depth % 2 === 0 ? "outer" : "inner",
      children: [],
      holes: [],
    });
  }

  for (const node of mutableById.values()) {
    if (!node.parentId) continue;
    const parent = mutableById.get(node.parentId);
    if (!parent) throw new Error(`Contour parent "${node.parentId}" does not exist.`);
    parent.children.push(node);
  }
  for (const node of mutableById.values()) {
    if (node.kind === "outer") node.holes = node.children.filter((child) => child.kind === "inner");
  }

  const nodes = candidates.map((candidate) => mutableById.get(candidate.entityId)!);
  // Freeze child arrays only after all parent links have been established.
  for (const node of nodes) {
    node.children = Object.freeze([...node.children]) as ContourHierarchyNode[];
    node.holes = Object.freeze([...node.holes]) as ContourHierarchyNode[];
    Object.freeze(node);
  }
  const immutableNodes = Object.freeze(nodes as ContourHierarchyNode[]);
  const roots = Object.freeze(immutableNodes.filter((node) => node.parentId === null));
  const solidBoundaries = Object.freeze(immutableNodes.filter((node) => node.kind === "outer"));
  const byEntityId = new Map<EntityId, ContourHierarchyNode>(
    immutableNodes.map((node) => [node.entityId, node]),
  );

  return Object.freeze({
    nodes: immutableNodes,
    roots,
    solidBoundaries,
    byEntityId,
  });
}
