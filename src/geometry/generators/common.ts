import type {
  BoundingBox,
  EntityStyle,
  LayerId,
  ManufacturingIntent,
  Point2D,
} from "../../document/types";

export interface GeneratorEntityOptions {
  readonly layerId?: LayerId;
  readonly intent?: ManufacturingIntent;
  readonly style?: Partial<EntityStyle>;
  readonly idFactory?: (prefix: string, index: number) => string;
}

export const EMPTY_BOUNDS: BoundingBox = Object.freeze({
  minX: 0,
  minY: 0,
  maxX: 0,
  maxY: 0,
});

const DEFAULT_STYLE: EntityStyle = Object.freeze({
  strokeColor: null,
  strokeWidth: 1,
  fillColor: null,
  dashArray: Object.freeze([]),
});

let generatedSequence = 0;

export function assertPositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite number greater than zero.`);
  }
}

export function assertPoint(point: Point2D, name: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError(`${name} must contain finite coordinates.`);
  }
}

export function createGeneratorId(
  prefix: string,
  index: number,
  options: GeneratorEntityOptions,
): string {
  if (options.idFactory) return options.idFactory(prefix, index);
  generatedSequence += 1;
  return globalThis.crypto?.randomUUID?.() ??
    `${prefix}-${Date.now().toString(36)}-${generatedSequence.toString(36)}`;
}

export function generatorBase(
  prefix: string,
  index: number,
  options: GeneratorEntityOptions,
) {
  return {
    id: createGeneratorId(prefix, index, options),
    layerId: options.layerId ?? "cut",
    intent: options.intent ?? "cut",
    style: {
      ...DEFAULT_STYLE,
      ...options.style,
      dashArray: options.style?.dashArray ? [...options.style.dashArray] : [],
    },
    bbox: EMPTY_BOUNDS,
    visible: true,
    locked: false,
  } as const;
}

export function boundsFromPoints(points: readonly Point2D[]): BoundingBox {
  if (points.length === 0) return EMPTY_BOUNDS;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}
