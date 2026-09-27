import paper from 'paper';
import { GRID_BASE_SPACING_MM, GRID_MAJOR_INTERVAL, GRID_MIN_SPACING_PX } from './units';

const STORAGE_KEY = 'vectora.gridSpacingMM';
function validSpacing(value: number): boolean {
  return Number.isFinite(value) && value >= 0.1 && value <= 1000;
}

export class MillimetreGrid {
  readonly layer: paper.Layer;
  spacingMM = GRID_BASE_SPACING_MM;
  private lastView = '';
  private colors: { minor: string; major: string };

  constructor() {
    try {
      const saved = Number(localStorage.getItem(STORAGE_KEY));
      if (validSpacing(saved)) this.spacingMM = saved;
    } catch { /* Storage may be unavailable. */ }
    this.layer = new paper.Layer({ name: 'Millimetre grid', guide: true, locked: true, data: { role: 'grid' } });
    const tokens = getComputedStyle(document.documentElement);
    this.colors = {
      minor: tokens.getPropertyValue('--color-grid-minor').trim(),
      major: tokens.getPropertyValue('--color-grid-major').trim(),
    };
  }

  refreshColors(): void {
    const tokens = getComputedStyle(document.documentElement);
    this.colors = { minor: tokens.getPropertyValue('--color-grid-minor').trim(), major: tokens.getPropertyValue('--color-grid-major').trim() };
    this.lastView = '';
  }

  setSpacingMM(value: number): void {
    if (!validSpacing(value)) throw new Error('Enter a grid size from 0.1 to 1000 mm.');
    this.spacingMM = value;
    try { localStorage.setItem(STORAGE_KEY, String(value)); } catch { /* Keep the session preference. */ }
  }

  update(view: paper.View): void {
    const bounds = view.bounds;
    const key = [bounds.x, bounds.y, bounds.width, bounds.height, view.zoom, this.spacingMM].join(',');
    if (key === this.lastView) return;
    this.lastView = key;
    this.layer.removeChildren();
    // Hide subpixel detail instead of changing the document interval or snap spacing.
    const stride = this.spacingMM * view.zoom >= GRID_MIN_SPACING_PX ? 1 : GRID_MAJOR_INTERVAL;
    const renderedSpacing = this.spacingMM * stride;
    if (renderedSpacing * view.zoom < GRID_MIN_SPACING_PX) return;
    for (const vertical of [true, false]) {
      const start = Math.ceil((vertical ? bounds.left : bounds.top) / renderedSpacing);
      const end = Math.floor((vertical ? bounds.right : bounds.bottom) / renderedSpacing);
      for (let index = start; index <= end; index++) {
        const position = index * renderedSpacing;
        const kind = (index * stride) % GRID_MAJOR_INTERVAL === 0 ? 'major' : 'minor';
        const from = vertical ? new paper.Point(position, bounds.top) : new paper.Point(bounds.left, position);
        const to = vertical ? new paper.Point(position, bounds.bottom) : new paper.Point(bounds.right, position);
        const line = new paper.Path({
          insert: false, segments: [from, to],
          strokeColor: this.colors[kind], strokeWidth: 1,
          strokeScaling: false, guide: true, data: { role: 'grid' },
        });
        this.layer.addChild(line);
      }
    }
  }
}
