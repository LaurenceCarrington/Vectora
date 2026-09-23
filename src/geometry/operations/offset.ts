import {
  EndType,
  JoinType,
  inflatePathsD,
  type PathD,
  type PathsD,
} from "clipper2-ts";
import type { DocumentUnits, Entity, Point2D, PolylineEntity } from "../../document/types";
import { entityToClosedPath, entityToOpenPath, pathToEntity, type CurveFlattenOptions } from "./pathConversion";
import { assertSelectionEditable, type OperationLayerContext } from "./operationSafety";

export type OffsetJoinStyle = "square" | "round" | "miter";
export type OffsetEndStyle = "butt" | "square" | "round" | "joined";

export interface OffsetPathOptions {
  readonly closed?: boolean;
  readonly joinStyle?: OffsetJoinStyle;
  readonly endStyle?: OffsetEndStyle;
  readonly miterLimit?: number;
  readonly arcTolerance?: number;
  readonly precision?: number;
}

export interface KerfCompensationOptions extends CurveFlattenOptions, OperationLayerContext {
  /** Radial toolpath offset in document units. Positive values expand profiles. */
  readonly distance?: number;
  /** Used when distance is omitted. Defaults to 0.15 mm. */
  readonly distanceMillimetres?: number;
  readonly units: DocumentUnits;
  /** Raster scale used for px documents. Defaults to CSS's 96 dpi conversion. */
  readonly pixelsPerMillimetre?: number;
  readonly joinStyle?: OffsetJoinStyle;
  readonly miterLimit?: number;
  readonly arcTolerance?: number;
  readonly precision?: number;
}

export const DEFAULT_KERF_MILLIMETRES = 0.15;
export const CSS_PIXELS_PER_MILLIMETRE = 96 / 25.4;

export function millimetresToDocumentUnits(
  millimetres: number,
  units: DocumentUnits,
  pixelsPerMillimetre = CSS_PIXELS_PER_MILLIMETRE,
): number {
  if (!Number.isFinite(millimetres)) throw new TypeError("Millimetres must be finite.");
  if (!Number.isFinite(pixelsPerMillimetre) || pixelsPerMillimetre <= 0) {
    throw new RangeError("Pixels per millimetre must be greater than zero.");
  }
  if (units === "in") return millimetres / 25.4;
  if (units === "px") return millimetres * pixelsPerMillimetre;
  return millimetres;
}

function joinType(style: OffsetJoinStyle): JoinType {
  if (style === "round") return JoinType.Round;
  if (style === "square") return JoinType.Square;
  return JoinType.Miter;
}

function endType(style: OffsetEndStyle): EndType {
  if (style === "round") return EndType.Round;
  if (style === "square") return EndType.Square;
  if (style === "joined") return EndType.Joined;
  return EndType.Butt;
}

function validatePath(path: readonly Point2D[], closed: boolean): void {
  const minimum = closed ? 3 : 2;
  if (path.length < minimum) throw new RangeError(`An offset path requires at least ${minimum} points.`);
  for (const point of path) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new TypeError("Offset paths must contain finite coordinates.");
    }
  }
}

export function offsetPath(
  path: readonly Point2D[],
  distance: number,
  options: OffsetPathOptions = {},
): readonly (readonly Point2D[])[] {
  if (!Number.isFinite(distance) || Math.abs(distance) < 1e-12) {
    throw new RangeError("Offset distance must be a finite, non-zero number.");
  }
  const closed = options.closed ?? true;
  validatePath(path, closed);
  const precision = options.precision ?? 6;
  if (!Number.isInteger(precision) || precision < 0 || precision > 8) {
    throw new RangeError("Clipper precision must be an integer between 0 and 8.");
  }
  const input: PathsD = [path.map((point) => ({ x: point.x, y: point.y })) as PathD];
  const result = inflatePathsD(
    input,
    distance,
    joinType(options.joinStyle ?? "miter"),
    closed ? EndType.Polygon : endType(options.endStyle ?? "butt"),
    options.miterLimit ?? 2,
    precision,
    options.arcTolerance ?? 0,
  );
  return result
    .filter((candidate) => candidate.length >= 3)
    .map((candidate) => candidate.map((point) => ({ x: point.x, y: point.y })));
}

export function offsetEntity(
  entity: Entity,
  distance: number,
  options: OffsetPathOptions & CurveFlattenOptions = {},
): readonly PolylineEntity[] {
  const closedPath = entityToClosedPath(entity, options);
  const openPath = closedPath ? null : entityToOpenPath(entity);
  if (!closedPath && !openPath) {
    throw new TypeError(`A ${entity.type} entity cannot be offset as a complete path.`);
  }
  const paths = offsetPath(closedPath ?? openPath!, distance, {
    ...options,
    closed: Boolean(closedPath),
  });
  return paths.map((path, index) => pathToEntity(path, entity, "offset", index));
}

export function applyKerfCompensation(
  entities: readonly Entity[],
  options: KerfCompensationOptions,
): readonly PolylineEntity[] {
  if (entities.length === 0) throw new RangeError("Select at least one closed entity to apply kerf compensation.");
  assertSelectionEditable(entities, options.layers);
  const distance = options.distance ?? millimetresToDocumentUnits(
    options.distanceMillimetres ?? DEFAULT_KERF_MILLIMETRES,
    options.units,
    options.pixelsPerMillimetre,
  );
  if (!Number.isFinite(distance) || Math.abs(distance) < 1e-12) {
    throw new RangeError("Kerf compensation must be a finite, non-zero distance.");
  }
  const results: PolylineEntity[] = [];
  for (const entity of entities) {
    const path = entityToClosedPath(entity, options);
    if (!path) throw new TypeError(`Kerf compensation requires closed paths; ${entity.type} is open.`);
    const offset = offsetPath(path, distance, {
      closed: true,
      joinStyle: options.joinStyle ?? "round",
      ...(options.miterLimit === undefined ? {} : { miterLimit: options.miterLimit }),
      ...(options.arcTolerance === undefined ? {} : { arcTolerance: options.arcTolerance }),
      ...(options.precision === undefined ? {} : { precision: options.precision }),
    });
    const firstResultIndex = results.length;
    offset.forEach((candidate, index) => results.push(pathToEntity(candidate, entity, "kerf", firstResultIndex + index)));
  }
  return results;
}
