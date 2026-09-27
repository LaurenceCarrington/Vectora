import paper from 'paper';
import type { Shape } from './types';

export function artworkColor():string {
  return getComputedStyle(document.documentElement).getPropertyValue('--layer-artwork').trim();
}

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

const neutralArtwork = (color: paper.Color | null): boolean => !!color && color.alpha === 1 &&
  (color.toCSS(true).toUpperCase() === '#FFFFFF' || color.toCSS(true).toUpperCase() === '#383838');

/** Default neutral artwork follows the workspace theme; explicit region colours do not. */
export function applyArtworkTheme(item: paper.Item, colour = artworkColor()): void {
  const visit = (child: paper.Item): void => {
    if (neutralArtwork(child.strokeColor) && child.strokeColor!.toCSS(true).toUpperCase() !== colour.toUpperCase()) child.strokeColor = new paper.Color(colour);
    if (!item.data.regionFill && neutralArtwork(child.fillColor) && child.fillColor!.toCSS(true).toUpperCase() !== colour.toUpperCase()) child.fillColor = new paper.Color(colour);
    child.children?.forEach(visit);
  };
  visit(item);
}

/** Theme-only neutral colour changes must not dirty documents or enter undo history. */
export function artworkSnapshot(item: paper.Item): string {
  const json = JSON.parse(item.exportJSON({precision:12}));
  const visit = (value: any): void => {
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      if (key === 'data') continue;
      const color = value[key];
      if ((key === 'strokeColor' || (key === 'fillColor' && !item.data.regionFill)) && Array.isArray(color) && color.length === 3 &&
        (color.every((n: number) => Math.abs(n - 1) < 1e-10) || color.every((n: number) => Math.abs(n - 56 / 255) < 1e-10))) value[key] = [1,1,1];
      else visit(color);
    }
  };
  visit(json);return JSON.stringify(json);
}
