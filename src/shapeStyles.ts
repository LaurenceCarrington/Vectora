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
  if(item.data.customColour)return;
  const visit = (child: paper.Item): void => {
    if (neutralArtwork(child.strokeColor) && child.strokeColor!.toCSS(true).toUpperCase() !== colour.toUpperCase()) child.strokeColor = new paper.Color(colour);
    if (!item.data.regionFill && neutralArtwork(child.fillColor) && child.fillColor!.toCSS(true).toUpperCase() !== colour.toUpperCase()) child.fillColor = new paper.Color(colour);
    child.children?.forEach(visit);
  };
  visit(item);
}

/** Theme-only neutral colour changes must not dirty documents or enter undo history. */
export function artworkSnapshot(item: paper.Item,preserveNeutral=false): string {
  // Work on Paper's exported value directly rather than stringify/parse every path.
  const json:any=item.exportJSON({precision:12,asString:false});
  // Paper assigns new global gradient IDs when restoring history. Canonical local
  // references keep an unchanged drawing equal to its saved/undo snapshot.
  if(json[0]?.[0]==='dictionary'){
    const dictionary=json[0][1],ids=new Map(Object.keys(dictionary).map((key,index)=>[key,`#${index+1}`]));
    const rewrite=(value:any):void=>{if(Array.isArray(value)){if(value.length===1&&ids.has(value[0]))value[0]=ids.get(value[0]);else value.forEach(rewrite);}else if(value&&typeof value==='object')for(const key of Object.keys(value))if(key!=='data')rewrite(value[key]);};
    rewrite(json);json[0][1]=Object.fromEntries(Object.entries(dictionary).map(([key,value])=>[ids.get(key),value]));
  }
  if(item.data.customColour||preserveNeutral)return JSON.stringify(json);
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
