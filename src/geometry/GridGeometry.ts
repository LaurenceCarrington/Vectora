/** All three families use gridSpacing as their perpendicular line spacing. */
export const ISOMETRIC_GRID_ANGLES = [Math.PI / 2, Math.PI / 6, Math.PI * 5 / 6] as const;

/** Vertices are (column * spacing, (2 * row + column) * spacing / sqrt(3)). */
export const ISOMETRIC_ROW_HEIGHT_RATIO = 1 / Math.sqrt(3);
