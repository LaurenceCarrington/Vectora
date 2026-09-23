import type { BoundingBox, Entity, LineEntity, Point2D, PolylineEntity } from "../../document/types";
import {
  assertPositive,
  boundsFromPoints,
  generatorBase,
  type GeneratorEntityOptions,
} from "./common";

export type LivingHingePattern = "straight" | "lattice" | "wave";

export interface LivingHingeOptions extends GeneratorEntityOptions {
  readonly bounds: BoundingBox;
  readonly pattern: LivingHingePattern;
  readonly spacing: number;
  readonly cutLength: number;
  readonly edgeInset?: number;
}

const MAX_HINGE_ENTITIES = 20_000;

function validateBounds(bounds: BoundingBox): void {
  if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)) {
    throw new TypeError("Living-hinge bounds must contain finite coordinates.");
  }
  if (bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) {
    throw new RangeError("Living-hinge bounds must have positive width and height.");
  }
}

function clippedSegment(
  center: Point2D,
  direction: Point2D,
  length: number,
  bounds: BoundingBox,
): readonly [Point2D, Point2D] | null {
  const half = length / 2;
  let start = { x: center.x - direction.x * half, y: center.y - direction.y * half };
  let end = { x: center.x + direction.x * half, y: center.y + direction.y * half };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [
    [-dx, start.x - bounds.minX],
    [dx, bounds.maxX - start.x],
    [-dy, start.y - bounds.minY],
    [dy, bounds.maxY - start.y],
  ] as const) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null;
      continue;
    }
    const ratio = q / p;
    if (p < 0) t0 = Math.max(t0, ratio);
    else t1 = Math.min(t1, ratio);
    if (t0 > t1) return null;
  }
  start = { x: start.x + t0 * dx, y: start.y + t0 * dy };
  end = { x: start.x + (t1 - t0) * dx, y: start.y + (t1 - t0) * dy };
  return [start, end];
}

function makeLine(
  start: Point2D,
  end: Point2D,
  index: number,
  options: LivingHingeOptions,
): LineEntity {
  return {
    ...generatorBase("hinge", index, options),
    name: `${options.pattern[0]!.toUpperCase()}${options.pattern.slice(1)} Living Hinge Cut`,
    type: "line",
    start,
    end,
    bbox: boundsFromPoints([start, end]),
  };
}

function makeWave(
  x: number,
  startY: number,
  length: number,
  index: number,
  options: LivingHingeOptions,
): PolylineEntity {
  const samples = Math.max(12, Math.ceil(length / Math.max(options.spacing / 3, 0.25)));
  const amplitude = Math.min(options.spacing * 0.32, (options.bounds.maxX - options.bounds.minX) * 0.04);
  const points = Array.from({ length: samples + 1 }, (_, sample) => {
    const progress = sample / samples;
    return {
      x: x + Math.sin(progress * Math.PI * 2) * amplitude,
      y: startY + progress * length,
    };
  });
  return {
    ...generatorBase("hinge-wave", index, options),
    name: "Wave Living Hinge Cut",
    type: "polyline",
    points,
    closed: false,
    bbox: boundsFromPoints(points),
  };
}

export function generateLivingHinge(options: LivingHingeOptions): readonly Entity[] {
  validateBounds(options.bounds);
  assertPositive(options.spacing, "Pattern spacing");
  assertPositive(options.cutLength, "Cut length");
  if (options.edgeInset !== undefined && (!Number.isFinite(options.edgeInset) || options.edgeInset < 0)) {
    throw new RangeError("Edge inset must be a finite number of zero or greater.");
  }
  const { bounds, spacing, cutLength } = options;
  const entities: Entity[] = [];
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const inset = Math.min(options.edgeInset ?? spacing / 2, width / 4, height / 4);

  if (options.pattern === "lattice") {
    const directionLength = Math.SQRT1_2;
    let row = 0;
    for (let y = bounds.minY + inset; y <= bounds.maxY - inset; y += spacing, row += 1) {
      let column = 0;
      for (let x = bounds.minX + inset; x <= bounds.maxX - inset; x += spacing, column += 1) {
        const slope = (row + column) % 2 === 0 ? 1 : -1;
        const segment = clippedSegment(
          { x, y },
          { x: directionLength, y: directionLength * slope },
          cutLength,
          bounds,
        );
        if (segment) entities.push(makeLine(segment[0], segment[1], entities.length, options));
        if (entities.length > MAX_HINGE_ENTITIES) throw new RangeError("Living-hinge pattern exceeds the 20,000-entity safety limit.");
      }
    }
    return entities;
  }

  let column = 0;
  for (let x = bounds.minX + inset; x <= bounds.maxX - inset; x += spacing, column += 1) {
    const period = cutLength + spacing;
    const offset = column % 2 === 0 ? 0 : period / 2;
    for (let y = bounds.minY + inset - offset; y < bounds.maxY - inset; y += period) {
      const startY = Math.max(bounds.minY + inset, y);
      const endY = Math.min(bounds.maxY - inset, y + cutLength);
      if (endY - startY <= 1e-9) continue;
      entities.push(options.pattern === "wave"
        ? makeWave(x, startY, endY - startY, entities.length, options)
        : makeLine({ x, y: startY }, { x, y: endY }, entities.length, options));
      if (entities.length > MAX_HINGE_ENTITIES) throw new RangeError("Living-hinge pattern exceeds the 20,000-entity safety limit.");
    }
  }
  return entities;
}
