import {generalPreferences} from './generalPreferences';
import {unitScale} from './canvasSize';
import {formatLength,displayDecimals} from './measurementDisplay';
/** Ruler marks use document millimetres; label density changes, never the scale. */
export function renderRuler(svg: SVGSVGElement, originMM: number, zoom: number, vertical: boolean): void {
  const length = vertical ? svg.clientHeight : svg.clientWidth;
  const thickness = vertical ? svg.clientWidth : svg.clientHeight;
  const key = [length, thickness, originMM, zoom,generalPreferences.value.units,generalPreferences.value.decimals].join(',');
  if (svg.dataset.view === key) return;
  svg.dataset.view = key;
  const scale=unitScale[generalPreferences.value.units];
  const target = 70 / zoom / scale;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const major = [1, 2, 5, 10].map(n => n * magnitude).find(n => n >= target)! * scale;
  const divisions = major * zoom / 10 >= 5 ? 10 : 5;
  const step = major / divisions;
  const first = Math.ceil(originMM / step);
  const last = Math.floor((originMM + length / zoom) / step);
  const marks: string[] = [];
  for (let index = first; index <= last; index++) {
    const value = index * step;
    const position = (value - originMM) * zoom;
    const labelled = index % divisions === 0;
    const tick = labelled ? 8 : index % 5 === 0 ? 5 : 3;
    const mmLabel=String(Number(value.toFixed(6))),label=formatLength(value,Math.max(displayDecimals(),Math.max(0,-Math.floor(Math.log10(major/scale)))));
    marks.push(vertical
      ? `<line data-mm="${mmLabel}" x1="${thickness - tick}" y1="${position}" x2="${thickness}" y2="${position}"/>`
      : `<line data-mm="${mmLabel}" x1="${position}" y1="0" x2="${position}" y2="${tick}"/>`);
    // Leave space for the complete label at either end of the strip.
    if (labelled && position > 14 && position < length - 14) {
      marks.push(vertical
        ? `<text transform="translate(10 ${position - 3}) rotate(-90)">${label}</text>`
        : `<text x="${position + 3}" y="16">${label}</text>`);
    }
  }
  svg.innerHTML = marks.join('');
}

export class CanvasRulers {
  constructor(private canvas: HTMLCanvasElement, private left: SVGSVGElement, private bottom: SVGSVGElement) {}

  update(bounds: { x: number; y: number }, zoom: number): void {
    const canvas = this.canvas.getBoundingClientRect();
    const left = this.left.getBoundingClientRect(), bottom = this.bottom.getBoundingClientRect();
    renderRuler(this.left, bounds.y + (left.top - canvas.top) / zoom, zoom, true);
    renderRuler(this.bottom, bounds.x + (bottom.left - canvas.left) / zoom, zoom, false);
  }
}
