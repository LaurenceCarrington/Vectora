import paper from 'paper';
import type { Shape } from './types';

/** Fill metadata also identifies regions transferred by older versions that cleared the style. */
export function hasFilledArea(item: Shape): boolean {
  return !!item.fillColor || !!item.data.regionFill || item.data.rasterTrace?.mode === 'fill';
}

/** Converted artwork and generated outlines share the same cut-line appearance. */
export function applyCutlineStyle(item: Shape): void {
  const color = getComputedStyle(document.documentElement).getPropertyValue('--color-cutline').trim();
  if (item.data.text) {
    item.fillColor = new paper.Color(color);
    item.strokeColor = null;
    return;
  }
  item.strokeColor = new paper.Color(color);
  item.strokeWidth = 1.5;
  item.strokeScaling = false;
  // Resolve Paper's lazy color values before clearing them.
  if (item.fillColor) item.fillColor = null;
}
