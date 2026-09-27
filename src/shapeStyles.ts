import paper from 'paper';
import type { Shape } from './types';

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
