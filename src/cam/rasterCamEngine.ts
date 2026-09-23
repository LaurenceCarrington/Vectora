/**
 * Vectora's local raster processing and scanline implementation.
 * Mathematical references (not incorporated third-party source code):
 * R. W. Floyd and L. Steinberg, "An Adaptive Algorithm for Spatial Greyscale",
 * Proceedings of the Society for Information Display 17(2), 75–77 (1976).
 * J. F. Jarvis, C. N. Judice and W. H. Ninke, "A survey of techniques for the
 * display of continuous tone pictures on bilevel displays", 5(1), 13–40 (1976),
 * https://doi.org/10.1016/S0146-664X(76)80003-2.
 * These citations credit the methods; they do not designate the papers public
 * domain or certify source provenance. See legal/AUDIT.md for evidence limits.
 */
import type { ImageEntity, Point2D } from "../document/types";

export type DitherAlgorithm = "floyd-steinberg" | "jarvis-judice-ninke" | "threshold";
export interface RasterSettings {
  readonly algorithm: DitherAlgorithm;
  readonly dpi: number;
  readonly overscan: number;
  readonly scanAngle: 0 | 90;
  readonly bidirectional: boolean;
  readonly minPower: number;
  readonly maxPower: number;
  readonly levels: number;
  /** Multiplicative contrast about mid-gray; gamma > 1 lightens. */
  readonly contrast: number;
  readonly gamma: number;
  readonly threshold: number;
  /** Physical mm/min. */
  readonly feedRate: number;
}
export const DEFAULT_RASTER_SETTINGS: Readonly<RasterSettings> = Object.freeze({
  algorithm: "floyd-steinberg", dpi: 254, overscan: 3, scanAngle: 0, bidirectional: true,
  minPower: 0, maxPower: 1000, levels: 2, contrast: 1, gamma: 1, threshold: 128, feedRate: 3000,
});
export const MAX_RASTER_PIXELS = 1_000_000;
export const MAX_SOURCE_PIXELS = 4_194_304;
export interface RasterPixels { readonly width: number; readonly height: number; readonly data: ArrayLike<number> }
export interface PowerMap { readonly width: number; readonly height: number; readonly powers: Uint16Array; readonly grayscale: Uint8Array; readonly stepX: number; readonly stepY: number }
export interface RasterRun { readonly end: Point2D; readonly power: number }
export interface RasterScanline { readonly start: Point2D; readonly runs: readonly RasterRun[] }
export interface RasterToolpath { readonly lines: readonly RasterScanline[]; readonly interval: number; readonly maxPower: number }

export function validateRasterSettings(s: RasterSettings): void {
  if (!["floyd-steinberg", "jarvis-judice-ninke", "threshold"].includes(s.algorithm)) throw new TypeError("Unknown raster algorithm.");
  if (![s.dpi, s.overscan, s.minPower, s.maxPower, s.levels, s.contrast, s.gamma, s.threshold, s.feedRate].every(Number.isFinite)) throw new TypeError("Raster settings must be finite.");
  if (s.dpi <= 0 || s.dpi > 2540 || s.overscan < 0 || s.feedRate <= 0 || s.gamma <= 0 || s.contrast < 0 || s.contrast > 10) throw new RangeError("Invalid raster spacing, overscan, feed, gamma or contrast.");
  if (!Number.isInteger(s.levels) || s.levels < 2 || s.levels > 256 || !Number.isInteger(s.minPower) || !Number.isInteger(s.maxPower) || s.minPower < 0 || s.maxPower <= s.minPower || s.maxPower > 65535) throw new RangeError("Raster requires 2–256 levels and integer S values with 0 ≤ min < max ≤ 65535.");
  if (s.threshold < 0 || s.threshold > 255 || ![0, 90].includes(s.scanAngle) || typeof s.bidirectional !== "boolean") throw new RangeError("Invalid raster threshold or scan direction.");
}

export function encodeRgba(data: ArrayLike<number>): string {
  let binary = "";
  for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...Array.from({ length: Math.min(8192, data.length - i) }, (_, j) => data[i + j]!));
  return btoa(binary);
}
export function decodeRgba(image: Pick<ImageEntity, "pixelWidth" | "pixelHeight" | "rgba">): Uint8ClampedArray {
  const count = image.pixelWidth * image.pixelHeight;
  if (!Number.isInteger(image.pixelWidth) || !Number.isInteger(image.pixelHeight) || image.pixelWidth < 1 || image.pixelHeight < 1 || count > MAX_SOURCE_PIXELS) throw new RangeError("Bitmap source exceeds 2048² pixels or has invalid dimensions.");
  if (typeof image.rgba !== "string" || image.rgba.length !== 4 * Math.ceil(count * 4 / 3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.rgba)) throw new TypeError("Invalid bitmap RGBA encoding.");
  const binary = atob(image.rgba);
  if (binary.length !== count * 4) throw new RangeError("Bitmap RGBA length does not match its dimensions.");
  return Uint8ClampedArray.from(binary, (c) => c.charCodeAt(0));
}

export function imageCorners(image: Pick<ImageEntity, "origin" | "right" | "top">): readonly Point2D[] {
  return [image.origin, image.right, { x: image.right.x + image.top.x - image.origin.x, y: image.right.y + image.top.y - image.origin.y }, image.top];
}
export function imagePoint(image: Pick<ImageEntity, "origin" | "right" | "top">, u: number, v: number): Point2D {
  // v is image row order, from top to bottom; document Y points upward.
  return { x: image.origin.x + u * (image.right.x - image.origin.x) + (1 - v) * (image.top.x - image.origin.x),
    y: image.origin.y + u * (image.right.y - image.origin.y) + (1 - v) * (image.top.y - image.origin.y) };
}

// Each tuple is [column offset, row offset, error fraction]; each kernel sums
// to one. Out-of-image neighbours are discarded, without renormalization.
const FS = [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]] as const;
const JJN = [[1, 0, 7 / 48], [2, 0, 5 / 48], [-2, 1, 3 / 48], [-1, 1, 5 / 48], [0, 1, 7 / 48], [1, 1, 5 / 48], [2, 1, 3 / 48],
  [-2, 2, 1 / 48], [-1, 2, 3 / 48], [0, 2, 5 / 48], [1, 2, 3 / 48], [2, 2, 1 / 48]] as const;
const clamp = (v: number) => Math.max(0, Math.min(255, v));

/** Immutable input; diffuse luminance error left-to-right using the published kernels. */
export function ditherGrayscale(gray: ArrayLike<number>, width: number, height: number, settings: RasterSettings, offMask?: ArrayLike<number>): Uint16Array {
  validateRasterSettings(settings);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > MAX_RASTER_PIXELS || gray.length !== width * height) throw new RangeError("Invalid raster matrix dimensions (maximum 1 million pixels).");
  if (offMask && offMask.length !== gray.length) throw new RangeError("Invalid transparency mask.");
  const work = Float64Array.from(gray);
  if (work.some((v) => !Number.isFinite(v) || v < 0 || v > 255)) throw new RangeError("Greyscale samples must be between 0 and 255.");
  const output = new Uint16Array(work.length);
  const kernel = settings.algorithm === "threshold" ? [] : settings.algorithm === "floyd-steinberg" ? FS : JJN;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const i = y * width + x;
    if (offMask?.[i]) continue;
    const value = clamp(work[i]!);
    const quantized = settings.levels === 2 ? (value < settings.threshold ? 0 : 255) : Math.round(value / 255 * (settings.levels - 1)) * 255 / (settings.levels - 1);
    const darkness = 1 - quantized / 255;
    output[i] = darkness <= 0 ? 0 : Math.round(settings.minPower + darkness * (settings.maxPower - settings.minPower));
    const error = work[i]! - quantized;
    for (const [dx, dy, weight] of kernel) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < width && ny < height) work[ny * width + nx]! += error * weight;
    }
  }
  return output;
}

export function processRasterPixels(source: RasterPixels, width: number, height: number, settings: RasterSettings, stepX = 1 / width, stepY = 1 / height): PowerMap {
  validateRasterSettings(settings);
  if (!Number.isInteger(source.width) || !Number.isInteger(source.height) || source.width < 1 || source.height < 1 || source.width * source.height > MAX_SOURCE_PIXELS || source.data.length !== source.width * source.height * 4) throw new RangeError("Invalid RGBA source.");
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > MAX_RASTER_PIXELS) throw new RangeError("Raster exceeds 1 million output pixels. Reduce image size or DPI.");
  if (![stepX, stepY].every((v) => Number.isFinite(v) && v > 0)) throw new RangeError("Raster sampling steps must be positive and finite.");
  for (let i = 0; i < source.data.length; i += 1) if (!Number.isFinite(source.data[i]) || source.data[i]! < 0 || source.data[i]! > 255) throw new RangeError("RGBA samples must be in [0,255].");
  const luminance = new Float64Array(source.width * source.height);
  for (let i = 0; i < luminance.length; i += 1) {
    const a = source.data[i * 4 + 3]! / 255;
    luminance[i] = (0.2126 * source.data[i * 4]! + 0.7152 * source.data[i * 4 + 1]! + 0.0722 * source.data[i * 4 + 2]!) * a + 255 * (1 - a);
  }
  const grayscale = new Uint8Array(width * height);
  const offMask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const sx = Math.max(0, Math.min(source.width - 1, (x * stepX + Math.min(1, (x + 1) * stepX)) / 2 * source.width - 0.5));
    const sy = Math.max(0, Math.min(source.height - 1, (y * stepY + Math.min(1, (y + 1) * stepY)) / 2 * source.height - 0.5));
    const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
    const at = (xx: number, yy: number) => luminance[Math.min(source.height - 1, yy) * source.width + Math.min(source.width - 1, xx)]!;
    const alphaAt = (xx: number, yy: number) => source.data[(Math.min(source.height - 1, yy) * source.width + Math.min(source.width - 1, xx)) * 4 + 3]!;
    const alpha = (alphaAt(ix, iy) * (1 - fx) + alphaAt(ix + 1, iy) * fx) * (1 - fy) + (alphaAt(ix, iy + 1) * (1 - fx) + alphaAt(ix + 1, iy + 1) * fx) * fy;
    offMask[y * width + x] = alpha <= 0 ? 1 : 0;
    const value = (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
    grayscale[y * width + x] = Math.round(255 * (clamp((value - 127.5) * settings.contrast + 127.5) / 255) ** (1 / settings.gamma));
  }
  return { width, height, grayscale, stepX, stepY, powers: ditherGrayscale(grayscale, width, height, settings, offMask) };
}

const cache = new WeakMap<ImageEntity, { mmPerUnit: number; map: PowerMap }>();
export function rasterPowerMap(image: ImageEntity, mmPerUnit: number): PowerMap {
  if (!Number.isFinite(mmPerUnit) || mmPerUnit <= 0) throw new RangeError("Raster requires physical document calibration.");
  const previous = cache.get(image);
  if (previous?.mmPerUnit === mmPerUnit) return previous.map;
  validateRasterSettings(image.raster);
  const ux = image.right.x - image.origin.x, uy = image.right.y - image.origin.y;
  const vx = image.top.x - image.origin.x, vy = image.top.y - image.origin.y;
  const w = Math.hypot(ux, uy), h = Math.hypot(vx, vy);
  if (![w, h].every(Number.isFinite) || w <= 0 || h <= 0 || Math.abs(ux * vy - uy * vx) < w * h * 1e-8) throw new RangeError("Raster image has collapsed dimensions.");
  if (Math.abs(ux * vx + uy * vy) > w * h * 1e-6) throw new RangeError("Skewed raster images must be restored to perpendicular axes before engraving.");
  const interval = 25.4 / image.raster.dpi;
  const map = processRasterPixels({ width: image.pixelWidth, height: image.pixelHeight, data: decodeRgba(image) },
    Math.max(1, Math.ceil(w * mmPerUnit / interval - 1e-9)), Math.max(1, Math.ceil(h * mmPerUnit / interval - 1e-9)), image.raster, interval / (w * mmPerUnit), interval / (h * mmPerUnit));
  cache.set(image, { mmPerUnit, map });
  return map;
}

const toolpathCache = new WeakMap<ImageEntity, { factor: number; raster: RasterToolpath }>();

/** Consecutive equal powers are merged; raster ordering is part of the machining contract. */
export function generateRasterToolpath(image: ImageEntity, mmPerUnit: number): RasterToolpath {
  const previous = toolpathCache.get(image);
  if (previous?.factor === mmPerUnit) return previous.raster;
  const map = rasterPowerMap(image, mmPerUnit), s = image.raster;
  const width = Math.hypot(image.right.x - image.origin.x, image.right.y - image.origin.y);
  const height = Math.hypot(image.top.x - image.origin.x, image.top.y - image.origin.y);
  const interval = 25.4 / s.dpi / mmPerUnit, vertical = s.scanAngle === 90;
  const count = vertical ? map.width : map.height, samples = vertical ? map.height : map.width;
  const scanSize = vertical ? height : width, crossSize = vertical ? width : height;
  const lines: RasterScanline[] = [];
  let runCount = 0;
  for (let line = 0; line < count; line += 1) {
    const reverse = s.bidirectional && line % 2 === 1;
    const cross = (line * interval + Math.min(crossSize, (line + 1) * interval)) / 2 / crossSize;
    const position = (along: number) => vertical ? imagePoint(image, cross, along / scanSize) : imagePoint(image, along / scanSize, cross);
    const powers = Array.from({ length: samples }, (_, k) => map.powers[vertical ? k * map.width + line : line * map.width + k]!);
    if (!powers.some((p) => p > 0)) continue;
    const overscan = s.overscan / mmPerUnit;
    const start = position(reverse ? scanSize + overscan : -overscan);
    const runs: RasterRun[] = [{ end: position(reverse ? scanSize : 0), power: 0 }];
    for (let step = 0; step < samples; step += 1) {
      const k = reverse ? samples - 1 - step : step;
      const end = position(reverse ? k * interval : Math.min(scanSize, (k + 1) * interval));
      const power = powers[k]!;
      if (runs.length > 1 && runs.at(-1)!.power === power) runs[runs.length - 1] = { end, power };
      else runs.push({ end, power });
    }
    runs.push({ end: position(reverse ? -overscan : scanSize + overscan), power: 0 });
    runCount += runs.length;
    if (runCount > 500_000) throw new RangeError("Raster exceeds 500,000 power runs. Reduce DPI or image size.");
    lines.push(Object.freeze({ start: Object.freeze(start), runs: Object.freeze(runs.map((run) => Object.freeze({ ...run, end: Object.freeze(run.end) }))) }));
  }
  const raster = Object.freeze({ lines: Object.freeze(lines), interval, maxPower: s.maxPower });
  toolpathCache.set(image, { factor: mmPerUnit, raster });
  return raster;
}
