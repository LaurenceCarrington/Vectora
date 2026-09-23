import type { Entity, Point2D, PolylineEntity } from "../../document/types";
import { boundsFromPoints } from "../generators/common";
import { entityToOpenPath } from "./pathConversion";

interface PathFragment {
  readonly entity: Entity;
  readonly points: readonly Point2D[];
  readonly inputIndex: number;
}

interface PathChain {
  readonly fragments: PathFragment[];
  points: Point2D[];
}

type ConnectionKind = "append-forward" | "append-reverse" | "prepend-forward" | "prepend-reverse";

interface Connection {
  readonly fragmentIndex: number;
  readonly kind: ConnectionKind;
  readonly distanceSquared: number;
}

const JOINABLE_TYPES = new Set<Entity["type"]>(["line", "arc", "polyline"]);

export function isJoinableOpenPath(entity: Entity): boolean {
  return JOINABLE_TYPES.has(entity.type) && entityToOpenPath(entity) !== null;
}

function squaredDistance(left: Point2D, right: Point2D): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

function clonePoints(points: readonly Point2D[]): Point2D[] {
  return points.map((point) => ({ x: point.x, y: point.y }));
}

function groupKey(entity: Entity): string {
  // A joined entity can only own one layer and manufacturing intent. Keeping
  // these partitions separate prevents a weld from silently changing either.
  return `${entity.layerId}\u0000${entity.intent}`;
}

function bestConnection(
  chain: PathChain,
  fragments: readonly PathFragment[],
  unused: ReadonlySet<number>,
  toleranceSquared: number,
): Connection | null {
  const chainStart = chain.points[0]!;
  const chainEnd = chain.points.at(-1)!;
  let best: Connection | null = null;
  const consider = (fragmentIndex: number, kind: ConnectionKind, distanceSquared: number): void => {
    if (distanceSquared > toleranceSquared) return;
    if (!best || distanceSquared < best.distanceSquared - Number.EPSILON ||
      (Math.abs(distanceSquared - best.distanceSquared) <= Number.EPSILON && fragmentIndex < best.fragmentIndex)) {
      best = { fragmentIndex, kind, distanceSquared };
    }
  };

  for (const fragmentIndex of unused) {
    const points = fragments[fragmentIndex]!.points;
    const start = points[0]!;
    const end = points.at(-1)!;
    consider(fragmentIndex, "append-forward", squaredDistance(chainEnd, start));
    consider(fragmentIndex, "append-reverse", squaredDistance(chainEnd, end));
    consider(fragmentIndex, "prepend-forward", squaredDistance(chainStart, end));
    consider(fragmentIndex, "prepend-reverse", squaredDistance(chainStart, start));
  }
  return best;
}

function connect(chain: PathChain, fragment: PathFragment, kind: ConnectionKind): void {
  const incoming = clonePoints(fragment.points);
  if (kind === "append-reverse" || kind === "prepend-reverse") incoming.reverse();

  if (kind === "append-forward" || kind === "append-reverse") {
    // The existing endpoint is authoritative, welding small import gaps without
    // moving geometry that was already part of the chain.
    incoming[0] = { ...chain.points.at(-1)! };
    chain.points.push(...incoming.slice(1));
    chain.fragments.push(fragment);
    return;
  }

  incoming[incoming.length - 1] = { ...chain.points[0]! };
  chain.points = [...incoming.slice(0, -1), ...chain.points];
  chain.fragments.unshift(fragment);
}

function hasThreeDistinctVertices(points: readonly Point2D[], toleranceSquared: number): boolean {
  const distinct: Point2D[] = [];
  for (const point of points) {
    if (distinct.every((candidate) => squaredDistance(candidate, point) > toleranceSquared)) {
      distinct.push(point);
      if (distinct.length === 3) return true;
    }
  }
  return false;
}

function chainEntity(chain: PathChain, toleranceSquared: number): Entity {
  if (chain.fragments.length === 1) return chain.fragments[0]!.entity;
  const primary = chain.fragments.reduce((current, candidate) =>
    candidate.inputIndex < current.inputIndex ? candidate : current,
  );
  const points = clonePoints(chain.points);
  const endpointsMeet = squaredDistance(points[0]!, points.at(-1)!) <= toleranceSquared;
  const closed = endpointsMeet && hasThreeDistinctVertices(points, toleranceSquared);
  if (closed) points.pop();

  const result: PolylineEntity = {
    id: primary.entity.id,
    name: primary.entity.name ?? "Joined Path",
    type: "polyline",
    layerId: primary.entity.layerId,
    intent: primary.entity.intent,
    style: {
      ...primary.entity.style,
      dashArray: [...primary.entity.style.dashArray],
    },
    bbox: boundsFromPoints(points),
    visible: primary.entity.visible,
    locked: false,
    points,
    closed,
  };
  return result;
}

/**
 * Welds compatible open line, arc, and polyline endpoints into deterministic
 * chains. Layer and intent boundaries are never crossed. Unconnected fragments
 * are returned unchanged so the operation is lossless.
 */
export function joinPaths(entities: readonly Entity[], tolerance = 0.1): readonly Entity[] {
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new RangeError("Join tolerance must be a finite, non-negative number.");
  }
  if (entities.length === 0) return Object.freeze([]);
  const unsupported = entities.find((entity) => !isJoinableOpenPath(entity));
  if (unsupported) {
    throw new TypeError(`Join requires open lines, arcs, or polylines; ${unsupported.type} is not eligible.`);
  }
  const locked = entities.find((entity) => entity.locked);
  if (locked) throw new Error(`Entity "${locked.id}" is locked.`);

  const groups = new Map<string, PathFragment[]>();
  entities.forEach((entity, inputIndex) => {
    const points = entityToOpenPath(entity, { tolerance: Math.max(0.001, tolerance / 4) });
    if (!points || points.length < 2) return;
    const fragment: PathFragment = { entity, points, inputIndex };
    const key = groupKey(entity);
    const group = groups.get(key);
    if (group) group.push(fragment);
    else groups.set(key, [fragment]);
  });

  const toleranceSquared = tolerance * tolerance;
  const results: { readonly entity: Entity; readonly inputIndex: number }[] = [];
  for (const fragments of groups.values()) {
    const unused = new Set(fragments.map((_, index) => index));
    while (unused.size > 0) {
      const seedIndex = unused.values().next().value as number;
      unused.delete(seedIndex);
      const seed = fragments[seedIndex]!;
      const chain: PathChain = { fragments: [seed], points: clonePoints(seed.points) };
      for (;;) {
        const match = bestConnection(chain, fragments, unused, toleranceSquared);
        if (!match) break;
        unused.delete(match.fragmentIndex);
        connect(chain, fragments[match.fragmentIndex]!, match.kind);
      }
      results.push({
        entity: chainEntity(chain, toleranceSquared),
        inputIndex: chain.fragments.reduce((minimum, fragment) => Math.min(minimum, fragment.inputIndex), Infinity),
      });
    }
  }

  return Object.freeze(
    results
      .sort((left, right) => left.inputIndex - right.inputIndex)
      .map(({ entity }) => entity),
  );
}
