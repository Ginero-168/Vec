import * as fs from "fs";
import * as path from "path";
import { decode as decodeJpeg } from "jpeg-js";
import { PNG } from "pngjs";
import { ASPECT_TOLERANCE, MAX_DECODE_PIXELS, MAX_TRACE_PIXELS } from "./limits";

export class ImagePrepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImagePrepError";
  }
}

export type RasterSize = { readonly width: number; readonly height: number };

export type PreparedImage = {
  readonly width: number;
  readonly height: number;
  readonly resized: boolean;
};

type Decoded = { readonly width: number; readonly height: number; readonly data: Uint8Array };

function byteAt(data: Uint8Array, index: number): number {
  return data[index] ?? 0;
}

export function aspectMismatch(pixelWidth: number, pixelHeight: number, widthPt: number, heightPt: number): boolean {
  if (pixelWidth <= 0 || pixelHeight <= 0 || widthPt <= 0 || heightPt <= 0) return true;
  const fileAspect = pixelWidth / pixelHeight;
  const placedAspect = widthPt / heightPt;
  return Math.abs(fileAspect - placedAspect) / fileAspect > ASPECT_TOLERANCE;
}

export async function readRasterSize(filePath: string): Promise<RasterSize | null> {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const stat = await handle.stat();
    const length = Math.min(stat.size, 2 * 1024 * 1024);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return sizeFromBuffer(buffer);
  } finally {
    await handle.close();
  }
}

export function sizeFromBuffer(buffer: Buffer): RasterSize | null {
  if (isPng(buffer)) {
    if (buffer.length < 24) return null;
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (isJpeg(buffer)) return jpegSize(buffer);
  return null;
}

export async function prepareTracePng(sourcePath: string, destPath: string, maxPixels = MAX_TRACE_PIXELS, maxDecodePixels = MAX_DECODE_PIXELS): Promise<PreparedImage> {
  const header = await readRasterSize(sourcePath);
  if (header && header.width * header.height > maxDecodePixels) {
    throw new ImagePrepError("ภาพใหญ่เกินงบถอดรหัสในพาเนล");
  }
  const buffer = await fs.promises.readFile(sourcePath);
  const decoded = decodeRaster(buffer);
  const sourcePixels = decoded.width * decoded.height;
  if (sourcePixels > maxDecodePixels) throw new ImagePrepError("ภาพใหญ่เกินงบถอดรหัสในพาเนล");
  const fitted = fit(decoded, maxPixels);
  const sameFile = pathKey(sourcePath) === pathKey(destPath);
  if (!fitted.resized && isPng(buffer)) {
    if (!sameFile) await fs.promises.writeFile(destPath, buffer);
    return { width: decoded.width, height: decoded.height, resized: false };
  }
  const png = new PNG({ width: fitted.width, height: fitted.height });
  Buffer.from(fitted.data).copy(png.data);
  await fs.promises.writeFile(destPath, PNG.sync.write(png));
  return { width: fitted.width, height: fitted.height, resized: fitted.resized };
}

function pathKey(filePath: string): string {
  return path.resolve(filePath);
}

function decodeRaster(buffer: Buffer): Decoded {
  try {
    if (isPng(buffer)) {
      const png = PNG.sync.read(buffer);
      return { width: png.width, height: png.height, data: png.data };
    }
    if (isJpeg(buffer)) {
      const image = decodeJpeg(buffer, { useTArray: true, formatAsRGBA: true, tolerantDecoding: true });
      return { width: image.width, height: image.height, data: image.data };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ImagePrepError("ถอดรหัสภาพไม่สำเร็จ: " + message);
  }
  throw new ImagePrepError("ถอดรหัสภาพไม่สำเร็จ");
}

function fit(decoded: Decoded, maxPixels: number): Decoded & { readonly resized: boolean } {
  const pixels = decoded.width * decoded.height;
  if (pixels <= maxPixels || pixels <= 0) return { ...decoded, resized: false };
  const scale = Math.sqrt(maxPixels / pixels);
  const width = Math.max(1, Math.floor(decoded.width * scale));
  const height = Math.max(1, Math.floor(decoded.height * scale));
  return { width, height, data: downscale(decoded, width, height), resized: true };
}

function downscale(source: Decoded, width: number, height: number): Uint8Array {
  const dest = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor((y * source.height) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * source.height) / height));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor((x * source.width) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * source.width) / width));
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let count = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const index = (yy * source.width + xx) * 4;
          const covered = byteAt(source.data, index + 3) / 255;
          red += byteAt(source.data, index) * covered;
          green += byteAt(source.data, index + 1) * covered;
          blue += byteAt(source.data, index + 2) * covered;
          alpha += byteAt(source.data, index + 3);
          count += 1;
        }
      }
      const offset = (y * width + x) * 4;
      const outAlpha = count > 0 ? alpha / count : 0;
      const restore = outAlpha === 0 ? 0 : 255 / outAlpha;
      dest[offset] = clampByte((red / count) * restore);
      dest[offset + 1] = clampByte((green / count) * restore);
      dest[offset + 2] = clampByte((blue / count) * restore);
      dest[offset + 3] = clampByte(outAlpha);
    }
  }
  return dest;
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function isPng(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer[0] === 137 && buffer[1] === 80 && buffer[2] === 78 && buffer[3] === 71;
}

function isJpeg(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8;
}

function jpegSize(buffer: Buffer): RasterSize | null {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1] ?? 0;
    if (isStartOfFrame(marker)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    if (marker === 0xd8 || marker === 0xd9) return null;
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

export async function stitchStripPngs(stripPaths: readonly string[], destPath: string): Promise<PreparedImage> {
  if (stripPaths.length === 0) throw new ImagePrepError("ไม่มีภาพจาก Illustrator");
  const strips: Decoded[] = [];
  for (const stripPath of stripPaths) {
    strips.push(decodeRaster(await fs.promises.readFile(stripPath)));
  }
  const first = strips[0];
  if (!first) throw new ImagePrepError("ไม่มีภาพจาก Illustrator");
  const width = first.width;
  const height = strips.reduce((sum, strip) => sum + strip.height, 0);
  const data = new Uint8Array(width * height * 4);
  let row = 0;
  for (const strip of strips) {
    const copyWidth = Math.min(width, strip.width);
    for (let y = 0; y < strip.height; y += 1) {
      const sourceStart = y * strip.width * 4;
      data.set(strip.data.subarray(sourceStart, sourceStart + copyWidth * 4), (row + y) * width * 4);
    }
    row += strip.height;
  }
  const png = new PNG({ width, height });
  Buffer.from(data).copy(png.data);
  await fs.promises.writeFile(destPath, PNG.sync.write(png));
  return { width, height, resized: false };
}

function isStartOfFrame(marker: number): boolean {
  if (marker >= 0xc0 && marker <= 0xc3) return true;
  if (marker >= 0xc5 && marker <= 0xc7) return true;
  if (marker >= 0xc9 && marker <= 0xcb) return true;
  return marker >= 0xcd && marker <= 0xcf;
}
