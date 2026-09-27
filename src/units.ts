/** All geometry is in millimetres. Only the view uses CSS pixels. */
export const geometrySettings = { flattenToleranceMM: 0.05 };
export const NUMERIC_EPSILON_MM = 0.000001;
export const CLIPPER_PRECISION = 5;
export const OFFSET_ARC_TOLERANCE_MM = 0.01;
export const MAX_COORDINATE_MM = 1_000_000;
export const MIN_DIMENSION_MM = 0.001;
export const GRID_BASE_SPACING_MM = 10;
export const GRID_MAJOR_INTERVAL = 5;
export const GRID_MIN_SPACING_PX = 2;
export const BASE_ZOOM = 96 / 25.4;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 100;
export function validNumber(value: number): boolean { return Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE_MM; }
export function validDimension(value: number): boolean { return validNumber(value) && value >= MIN_DIMENSION_MM; }
export function setFlattenTolerance(value: number): void {
  if (!Number.isFinite(value) || value < 0.001 || value > 0.5) throw new Error('Curve tolerance must be between 0.001 and 0.5 mm.');
  geometrySettings.flattenToleranceMM = value;
}

/** Round a document coordinate/distance to the origin-aligned configured grid. */
export function snapMM(value: number, spacingMM: number): number {
  return Math.round(value / spacingMM) * spacingMM;
}
