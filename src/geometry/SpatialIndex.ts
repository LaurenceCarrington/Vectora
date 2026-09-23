import type { BoundingBox, Entity, EntityId } from "../document/types";

const DEFAULT_CELL_SIZE = 256;
const DEFAULT_MAX_CELLS_PER_ENTITY = 1_024;

interface CellRange {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly overflow: boolean;
}

function assertFiniteBounds(bounds: BoundingBox): void {
  if (
    !Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY) ||
    !Number.isFinite(bounds.maxX) || !Number.isFinite(bounds.maxY)
  ) {
    throw new TypeError("Spatial-index bounds must contain finite coordinates.");
  }
}

function boxesIntersect(left: BoundingBox, right: BoundingBox): boolean {
  return !(
    left.maxX < right.minX ||
    left.minX > right.maxX ||
    left.maxY < right.minY ||
    left.minY > right.maxY
  );
}

/**
 * Incremental world-space spatial hash for coarse entity rejection.
 *
 * Buckets use nested numeric maps to avoid allocating string cell keys during
 * pointer queries. Query scratch collections are retained between calls, so a
 * steady cursor/pan workload does not create a new Set for every event.
 */
export class EntitySpatialIndex {
  private readonly columns = new Map<number, Map<number, Entity[]>>();
  private readonly ranges = new Map<EntityId, CellRange>();
  private readonly overflow: Entity[] = [];
  private readonly seen = new Set<EntityId>();

  constructor(
    private readonly cellSize = DEFAULT_CELL_SIZE,
    private readonly maxCellsPerEntity = DEFAULT_MAX_CELLS_PER_ENTITY,
  ) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new RangeError("Spatial-index cell size must be a positive finite number.");
    }
    if (!Number.isSafeInteger(maxCellsPerEntity) || maxCellsPerEntity < 1) {
      throw new RangeError("Spatial-index cell limit must be a positive safe integer.");
    }
  }

  rebuild(entities: Iterable<Entity>): void {
    this.clear();
    for (const entity of entities) this.insert(entity);
  }

  clear(): void {
    this.columns.clear();
    this.ranges.clear();
    this.overflow.length = 0;
    this.seen.clear();
  }

  insert(entity: Entity): void {
    if (this.ranges.has(entity.id)) this.remove(entity.id);
    const range = this.toCellRange(entity.bbox);
    this.ranges.set(entity.id, range);
    if (range.overflow) {
      this.overflow.push(entity);
      return;
    }
    for (let x = range.minX; x <= range.maxX; x += 1) {
      let column = this.columns.get(x);
      if (!column) {
        column = new Map<number, Entity[]>();
        this.columns.set(x, column);
      }
      for (let y = range.minY; y <= range.maxY; y += 1) {
        const bucket = column.get(y);
        if (bucket) bucket.push(entity);
        else column.set(y, [entity]);
      }
    }
  }

  update(previous: Entity, next: Entity): void {
    this.remove(previous.id);
    this.insert(next);
  }

  remove(id: EntityId): void {
    const range = this.ranges.get(id);
    if (!range) return;
    this.ranges.delete(id);
    if (range.overflow) {
      const index = this.overflow.findIndex((entity) => entity.id === id);
      if (index >= 0) this.overflow.splice(index, 1);
      return;
    }
    for (let x = range.minX; x <= range.maxX; x += 1) {
      const column = this.columns.get(x);
      if (!column) continue;
      for (let y = range.minY; y <= range.maxY; y += 1) {
        const bucket = column.get(y);
        if (!bucket) continue;
        const index = bucket.findIndex((entity) => entity.id === id);
        if (index >= 0) bucket.splice(index, 1);
        if (bucket.length === 0) column.delete(y);
      }
      if (column.size === 0) this.columns.delete(x);
    }
  }

  query(bounds: BoundingBox, target: Entity[]): Entity[] {
    target.length = 0;
    this.seen.clear();
    assertFiniteBounds(bounds);
    const normalized = {
      minX: Math.min(bounds.minX, bounds.maxX),
      minY: Math.min(bounds.minY, bounds.maxY),
      maxX: Math.max(bounds.minX, bounds.maxX),
      maxY: Math.max(bounds.minY, bounds.maxY),
    };
    const range = this.toCellRange(normalized);
    if (range.overflow) {
      for (const column of this.columns.values()) {
        for (const bucket of column.values()) {
          for (const entity of bucket) this.collect(entity, normalized, target);
        }
      }
      for (const entity of this.overflow) this.collect(entity, normalized, target);
      return target;
    }
    const { minX, minY, maxX, maxY } = range;
    for (let x = minX; x <= maxX; x += 1) {
      const column = this.columns.get(x);
      if (!column) continue;
      for (let y = minY; y <= maxY; y += 1) {
        const bucket = column.get(y);
        if (!bucket) continue;
        for (const entity of bucket) this.collect(entity, normalized, target);
      }
    }
    for (const entity of this.overflow) this.collect(entity, normalized, target);
    return target;
  }

  private collect(entity: Entity, bounds: BoundingBox, target: Entity[]): void {
    if (this.seen.has(entity.id) || !boxesIntersect(entity.bbox, bounds)) return;
    this.seen.add(entity.id);
    target.push(entity);
  }

  private toCellRange(bounds: BoundingBox): CellRange {
    assertFiniteBounds(bounds);
    const firstX = Math.floor(bounds.minX / this.cellSize);
    const firstY = Math.floor(bounds.minY / this.cellSize);
    const secondX = Math.floor(bounds.maxX / this.cellSize);
    const secondY = Math.floor(bounds.maxY / this.cellSize);
    // Normalizing both endpoints guarantees that a degenerate box occupies at
    // least one cell on each axis and that neither insertion loop is skipped.
    const minX = Math.min(firstX, secondX);
    const minY = Math.min(firstY, secondY);
    const maxX = Math.max(firstX, secondX);
    const maxY = Math.max(firstY, secondY);
    const cellCountX = Math.max(1, maxX - minX + 1);
    const cellCountY = Math.max(1, maxY - minY + 1);
    const cellCount = cellCountX * cellCountY;
    // Beyond the safe-integer range, `cell += 1` may not change the value and
    // a bucket loop would never terminate. Large queries are cheaper and safer
    // as a bounded scan of the buckets that actually exist.
    const unsafeCoordinates = ![minX, minY, maxX, maxY].every(Number.isSafeInteger);
    return {
      minX,
      minY,
      maxX,
      maxY,
      overflow: unsafeCoordinates || !Number.isSafeInteger(cellCount) || cellCount > this.maxCellsPerEntity,
    };
  }
}
