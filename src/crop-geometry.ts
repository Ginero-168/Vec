export const CROP_SUGGEST_PIXELS = 3_145_728;

export type RasterSize = { readonly width: number; readonly height: number };
export type PixelPoint = { readonly x: number; readonly y: number };
export type PixelRect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
export type ArtboardBounds = readonly [number, number, number, number];

export function estimateRgbaBytes(size: RasterSize): number {
  assertRasterSize(size);
  const bytes = size.width * size.height * 4;
  if (!Number.isSafeInteger(bytes)) throw new RangeError("RGBA byte size exceeds safe integer range");
  return bytes;
}

export function requiresCropChoice(size: RasterSize): boolean {
  assertRasterSize(size);
  return size.width * size.height > CROP_SUGGEST_PIXELS;
}

export function formatRasterMegapixels(size: RasterSize): string {
  assertRasterSize(size);
  const megapixels = size.width * size.height / 1_000_000;
  return megapixels > 0 && megapixels < 0.1 ? "<0.1" : megapixels.toFixed(1);
}

export function thumbnailPointToSourcePixels(
  point: PixelPoint,
  thumbnailSize: RasterSize,
  sourceSize: RasterSize
): PixelPoint {
  assertRasterSize(thumbnailSize);
  assertRasterSize(sourceSize);
  return {
    x: clamp(point.x / thumbnailSize.width * sourceSize.width, 0, sourceSize.width),
    y: clamp(point.y / thumbnailSize.height * sourceSize.height, 0, sourceSize.height)
  };
}

export function thumbnailRectToSourcePixels(
  rect: PixelRect,
  thumbnailSize: RasterSize,
  sourceSize: RasterSize
): PixelRect {
  const start = thumbnailPointToSourcePixels({ x: rect.x, y: rect.y }, thumbnailSize, sourceSize);
  const end = thumbnailPointToSourcePixels({ x: rect.x + rect.width, y: rect.y + rect.height }, thumbnailSize, sourceSize);
  return clampCropRect({ x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y }, sourceSize);
}

export function clampCropRect(rect: PixelRect, sourceSize: RasterSize): PixelRect {
  assertRasterSize(sourceSize);
  const rawRight = rect.x + rect.width;
  const rawBottom = rect.y + rect.height;
  const left = clamp(Math.floor(Math.min(rect.x, rawRight)), 0, sourceSize.width - 1);
  const top = clamp(Math.floor(Math.min(rect.y, rawBottom)), 0, sourceSize.height - 1);
  const right = clamp(Math.ceil(Math.max(rect.x, rawRight)), left + 1, sourceSize.width);
  const bottom = clamp(Math.ceil(Math.max(rect.y, rawBottom)), top + 1, sourceSize.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function moveCropRect(rect: PixelRect, dx: number, dy: number, sourceSize: RasterSize): PixelRect {
  assertRasterSize(sourceSize);
  const width = Math.min(Math.max(1, Math.round(rect.width)), sourceSize.width);
  const height = Math.min(Math.max(1, Math.round(rect.height)), sourceSize.height);
  const x = clamp(Math.round(rect.x + dx), 0, sourceSize.width - width);
  const y = clamp(Math.round(rect.y + dy), 0, sourceSize.height - height);
  return { x, y, width, height };
}

export function cropRectToArtboardBounds(
  sourceBounds: ArtboardBounds,
  sourceSize: RasterSize,
  cropRect: PixelRect
): ArtboardBounds {
  assertRasterSize(sourceSize);
  const rect = clampCropRect(cropRect, sourceSize);
  const [left, top, right, bottom] = sourceBounds;
  const pointsPerPixelX = (right - left) / sourceSize.width;
  const pointsPerPixelY = (top - bottom) / sourceSize.height;
  return [
    left + rect.x * pointsPerPixelX,
    top - rect.y * pointsPerPixelY,
    left + (rect.x + rect.width) * pointsPerPixelX,
    top - (rect.y + rect.height) * pointsPerPixelY
  ];
}

export function cropRgba(rgba: Uint8Array, sourceSize: RasterSize, cropRect: PixelRect): Uint8Array {
  assertRasterSize(sourceSize);
  if (rgba.length !== estimateRgbaBytes(sourceSize)) throw new RangeError("RGBA data does not match raster size");
  const rect = clampCropRect(cropRect, sourceSize);
  const cropped = new Uint8Array(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y += 1) {
    const sourceStart = ((rect.y + y) * sourceSize.width + rect.x) * 4;
    const targetStart = y * rect.width * 4;
    cropped.set(rgba.subarray(sourceStart, sourceStart + rect.width * 4), targetStart);
  }
  return cropped;
}

function assertRasterSize(size: RasterSize): void {
  if (!Number.isSafeInteger(size.width) || size.width < 1 || !Number.isSafeInteger(size.height) || size.height < 1) {
    throw new RangeError("Raster dimensions must be positive safe integers");
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
