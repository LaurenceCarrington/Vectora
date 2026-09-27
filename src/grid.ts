import paper from 'paper';
import { GRID_BASE_SPACING_MM, GRID_MAJOR_INTERVAL, GRID_MIN_SPACING_PX } from './units';

/** Thin out whole-millimetre lines at low zoom, never change document scale. */
export function gridSpacingMM(zoom: number): number {
  let spacing = GRID_BASE_SPACING_MM;
  while (spacing * zoom < GRID_MIN_SPACING_PX) {
    spacing *= 5;
    if (spacing * zoom >= GRID_MIN_SPACING_PX) break;
    spacing *= 2;
  }
  return spacing;
}

export class MillimetreGrid {
  readonly layer: paper.Layer;
  spacingMM = GRID_BASE_SPACING_MM;
  private lastView = '';
  private readonly colors: { minor: string; major: string };

  constructor() {
    this.layer = new paper.Layer({ name: 'Millimetre grid', guide: true, locked: true, data: { role: 'grid' } });
    const tokens = getComputedStyle(document.documentElement);
    this.colors = {
      minor: tokens.getPropertyValue('--color-grid-minor').trim(),
      major: tokens.getPropertyValue('--color-grid-major').trim(),
    };
  }

  update(view: paper.View): void {
    const bounds = view.bounds;
    const key = [bounds.x, bounds.y, bounds.width, bounds.height, view.zoom].join(',');
    if (key === this.lastView) return;
    this.lastView = key;
    this.spacingMM = gridSpacingMM(view.zoom);
    this.layer.removeChildren();
    for (const vertical of [true, false]) {
      const start = Math.ceil((vertical ? bounds.left : bounds.top) / this.spacingMM);
      const end = Math.floor((vertical ? bounds.right : bounds.bottom) / this.spacingMM);
      for (let index = start; index <= end; index++) {
        const position = index * this.spacingMM;
        const kind = index % GRID_MAJOR_INTERVAL === 0 ? 'major' : 'minor';
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
