import type { ImageEntity } from "../document/types";
import { decodeRgba, rasterPowerMap } from "../cam/rasterCamEngine";

const cache = new WeakMap<ImageEntity, { factor: number; canvas: HTMLCanvasElement; scaleX: number; scaleY: number }>();
/** Cached image pixels are drawn in image coordinates, with top-down rows mapped to world Y. */
export function drawRasterImage(context: CanvasRenderingContext2D, image: ImageEntity, physicalFactor: number): void {
  let prepared = cache.get(image);
  if (!prepared || prepared.factor !== physicalFactor) {
    let width = image.pixelWidth, height = image.pixelHeight;
    let rgba: Uint8ClampedArray;
    let scaleX = 1, scaleY = 1;
    try {
      if (image.intent !== "raster") throw new Error("Source preview");
      const map = rasterPowerMap(image, physicalFactor);
      width = map.width; height = map.height;
      scaleX = map.width * map.stepX; scaleY = map.height * map.stepY;
      rgba = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < map.powers.length; i += 1) {
        const shade = Math.round(255 * (1 - map.powers[i]! / image.raster.maxPower));
        rgba.set([shade, shade, shade, 255], i * 4);
      }
    } catch {
      // An uncalibrated or invalid CAM configuration still displays the original bitmap.
      rgba = decodeRgba(image);
    }
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const data = ctx.createImageData(width, height); data.data.set(rgba); ctx.putImageData(data, 0, 0);
    prepared = { factor: physicalFactor, canvas, scaleX, scaleY }; cache.set(image, prepared);
  }
  context.save();
  context.transform(image.right.x - image.origin.x, image.right.y - image.origin.y,
    image.origin.x - image.top.x, image.origin.y - image.top.y, image.top.x, image.top.y);
  context.imageSmoothingEnabled = image.intent !== "raster";
  context.beginPath(); context.rect(0, 0, 1, 1); context.clip();
  context.drawImage(prepared.canvas, 0, 0, prepared.scaleX, prepared.scaleY);
  context.restore();
}
