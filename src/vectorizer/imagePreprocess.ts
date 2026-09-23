export interface ImagePreprocessOptions {
  /** Black/white cutoff in the inclusive range 0–255. */
  readonly threshold?: number;
  /** Additive brightness adjustment in the range -100–100. */
  readonly brightness?: number;
  /** Contrast adjustment in the range -100–100. */
  readonly contrast?: number;
  readonly invert?: boolean;
  /** Remove connected black components containing fewer than this many pixels. */
  readonly despeckleSize?: number;
}

export interface PreprocessedImage {
  readonly width: number;
  readonly height: number;
  /** One byte per pixel: 1 is foreground/black and 0 is background/white. */
  readonly mask: Uint8Array;
  readonly imageData: ImageData;
  readonly foregroundPixels: number;
}

export interface DecodeRasterOptions {
  /** Large images are downsampled before tracing to keep interaction responsive. */
  readonly maximumDimension?: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function assertImageData(imageData: ImageData): void {
  if (!Number.isInteger(imageData.width) || !Number.isInteger(imageData.height) || imageData.width < 1 || imageData.height < 1) {
    throw new RangeError("ImageData must have positive integer dimensions.");
  }
  if (imageData.data.length !== imageData.width * imageData.height * 4) {
    throw new RangeError("ImageData has an invalid RGBA buffer length.");
  }
}

function removeSmallForegroundComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  minimumSize: number,
): void {
  if (minimumSize <= 1) return;
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const neighbours = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ] as const;

  for (let seed = 0; seed < mask.length; seed += 1) {
    if (mask[seed] !== 1 || visited[seed] === 1) continue;
    let head = 0;
    let tail = 1;
    queue[0] = seed;
    visited[seed] = 1;
    while (head < tail) {
      const index = queue[head++]!;
      const x = index % width;
      const y = Math.floor(index / width);
      for (const [offsetX, offsetY] of neighbours) {
        const nextX = x + offsetX;
        const nextY = y + offsetY;
        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
        const next = nextY * width + nextX;
        if (mask[next] !== 1 || visited[next] === 1) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    if (tail < minimumSize) {
      for (let index = 0; index < tail; index += 1) mask[queue[index]!] = 0;
    }
  }
}

export function preprocessImageData(
  source: ImageData,
  options: ImagePreprocessOptions = {},
): PreprocessedImage {
  assertImageData(source);
  const threshold = clamp(Math.round(options.threshold ?? 128), 0, 255);
  const brightness = clamp(options.brightness ?? 0, -100, 100) * 2.55;
  const contrast = clamp(options.contrast ?? 0, -100, 100) * 2.55;
  const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const invert = options.invert ?? false;
  const minimumComponentSize = Math.max(0, Math.round(options.despeckleSize ?? 0));
  const mask = new Uint8Array(source.width * source.height);

  for (let pixel = 0, rgba = 0; pixel < mask.length; pixel += 1, rgba += 4) {
    const alpha = source.data[rgba + 3]! / 255;
    const red = source.data[rgba]! * alpha + 255 * (1 - alpha);
    const green = source.data[rgba + 1]! * alpha + 255 * (1 - alpha);
    const blue = source.data[rgba + 2]! * alpha + 255 * (1 - alpha);
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    const adjusted = clamp(contrastFactor * (luminance - 128) + 128 + brightness, 0, 255);
    const foreground = adjusted < threshold;
    mask[pixel] = (invert ? !foreground : foreground) ? 1 : 0;
  }

  removeSmallForegroundComponents(mask, source.width, source.height, minimumComponentSize);
  const rgba = new Uint8ClampedArray(mask.length * 4);
  let foregroundPixels = 0;
  for (let pixel = 0, offset = 0; pixel < mask.length; pixel += 1, offset += 4) {
    const value = mask[pixel] === 1 ? 0 : 255;
    if (value === 0) foregroundPixels += 1;
    rgba[offset] = value;
    rgba[offset + 1] = value;
    rgba[offset + 2] = value;
    rgba[offset + 3] = 255;
  }
  return Object.freeze({
    width: source.width,
    height: source.height,
    mask,
    imageData: new ImageData(rgba, source.width, source.height),
    foregroundPixels,
  });
}

function imageElementToImageData(image: HTMLImageElement): ImageData {
  if (!image.naturalWidth || !image.naturalHeight) throw new Error("The image has not finished loading.");
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("A 2D canvas context is required to preprocess images.");
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

export function preprocessImage(
  source: HTMLImageElement | ImageData,
  options: ImagePreprocessOptions = {},
): PreprocessedImage {
  return preprocessImageData("data" in source ? source : imageElementToImageData(source), options);
}

export async function decodeRasterFile(
  file: Blob,
  options: DecodeRasterOptions = {},
): Promise<ImageData> {
  const maximumDimension = Math.max(64, Math.round(options.maximumDimension ?? 1_600));
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maximumDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement("canvas"), { width, height });
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("A 2D canvas context is required to decode images.");
    context.drawImage(bitmap, 0, 0, width, height);
    return context.getImageData(0, 0, width, height);
  } finally {
    bitmap.close();
  }
}
