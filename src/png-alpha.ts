import * as zlib from "zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  CRC_TABLE[index] = value;
}

export type PunchedPng = {
  readonly png: Buffer;
  readonly droppedColor: string | null;
};

export function punchTransparency(png: Buffer): PunchedPng {
  const image = readRgbaPng(png);
  if (image === null) return { png, droppedColor: null };
  const used = new Set<number>();
  let transparent = 0;
  for (let index = 0; index < image.rgba.length; index += 4) {
    const alpha = image.rgba[index + 3] ?? 255;
    if (alpha < 128) {
      transparent += 1;
      continue;
    }
    const red = image.rgba[index] ?? 0;
    const green = image.rgba[index + 1] ?? 0;
    const blue = image.rgba[index + 2] ?? 0;
    used.add((red << 16) | (green << 8) | blue);
  }
  if (transparent === 0) return { png, droppedColor: null };
  const sentinel = unusedColor(used);
  const next = new Uint8Array(image.rgba);
  for (let index = 0; index < next.length; index += 4) {
    const alpha = next[index + 3] ?? 255;
    if (alpha < 128) {
      next[index] = (sentinel >> 16) & 255;
      next[index + 1] = (sentinel >> 8) & 255;
      next[index + 2] = sentinel & 255;
    }
    next[index + 3] = 255;
  }
  return { png: encodeRgbaPng(image.width, image.height, next), droppedColor: hex(sentinel) };
}

export function encodeRgbaPng(width: number, height: number, rgba: Uint8Array): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + stride);
    raw[row] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, row + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

export function readRgbaPng(png: Buffer): { readonly width: number; readonly height: number; readonly rgba: Uint8Array } | null {
  if (png.length < 8 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;
  const idat: Buffer[] = [];
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (data.length < length) return null;
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? -1;
      interlace = data[12] ?? 0;
    } else if (type === "PLTE") palette = Buffer.from(data);
    else if (type === "tRNS") transparency = Buffer.from(data);
    else if (type === "IDAT") idat.push(Buffer.from(data));
    else if (type === "IEND") break;
  }
  if (!(width > 0) || !(height > 0) || bitDepth !== 8 || interlace !== 0 || idat.length === 0) return null;
  const channels = channelsOf(colorType);
  if (channels === null) return null;
  let inflated: Buffer;
  try {
    inflated = zlib.inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  const stride = width * channels;
  if (inflated.length !== height * (1 + stride)) return null;
  const bytes = unfilter(inflated, width, height, channels);
  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const source = pixel * channels;
    const target = pixel * 4;
    if (colorType === 6) {
      rgba[target] = bytes[source] ?? 0;
      rgba[target + 1] = bytes[source + 1] ?? 0;
      rgba[target + 2] = bytes[source + 2] ?? 0;
      rgba[target + 3] = bytes[source + 3] ?? 255;
    } else if (colorType === 2) {
      rgba[target] = bytes[source] ?? 0;
      rgba[target + 1] = bytes[source + 1] ?? 0;
      rgba[target + 2] = bytes[source + 2] ?? 0;
      rgba[target + 3] = matchesTransparency(transparency, rgba[target] ?? 0, rgba[target + 1] ?? 0, rgba[target + 2] ?? 0) ? 0 : 255;
    } else if (colorType === 0) {
      const gray = bytes[source] ?? 0;
      rgba[target] = gray;
      rgba[target + 1] = gray;
      rgba[target + 2] = gray;
      rgba[target + 3] = transparency !== null && transparency.length >= 2 && transparency.readUInt16BE(0) === gray ? 0 : 255;
    } else if (colorType === 4) {
      const gray = bytes[source] ?? 0;
      rgba[target] = gray;
      rgba[target + 1] = gray;
      rgba[target + 2] = gray;
      rgba[target + 3] = bytes[source + 1] ?? 255;
    } else if (colorType === 3 && palette !== null) {
      const index = bytes[source] ?? 0;
      rgba[target] = palette[index * 3] ?? 0;
      rgba[target + 1] = palette[index * 3 + 1] ?? 0;
      rgba[target + 2] = palette[index * 3 + 2] ?? 0;
      rgba[target + 3] = transparency?.[index] ?? 255;
    } else {
      return null;
    }
  }
  return { width, height, rgba };
}

function channelsOf(colorType: number): number | null {
  if (colorType === 0 || colorType === 3) return 1;
  if (colorType === 2) return 3;
  if (colorType === 4) return 2;
  if (colorType === 6) return 4;
  return null;
}

function matchesTransparency(transparency: Buffer | null, red: number, green: number, blue: number): boolean {
  if (transparency === null || transparency.length < 6) return false;
  return transparency[0] === 0 && transparency[1] === red && transparency[2] === 0 && transparency[3] === green && transparency[4] === 0 && transparency[5] === blue;
}

function unfilter(data: Buffer, width: number, height: number, channels: number): Uint8Array {
  const stride = width * channels;
  const out = new Uint8Array(height * stride);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = data[offset] ?? 0;
    offset += 1;
    for (let x = 0; x < stride; x += 1) {
      const raw = data[offset] ?? 0;
      offset += 1;
      const left = x >= channels ? out[y * stride + x - channels] ?? 0 : 0;
      const up = y > 0 ? out[(y - 1) * stride + x] ?? 0 : 0;
      const upLeft = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] ?? 0 : 0;
      let value = raw;
      if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + Math.floor((left + up) / 2);
      else if (filter === 4) value = raw + paeth(left, up, upLeft);
      out[y * stride + x] = value & 255;
    }
  }
  return out;
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const diagonal = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= diagonal) return left;
  if (upDistance <= diagonal) return up;
  return upLeft;
}

function unusedColor(used: Set<number>): number {
  const candidates = [0xff00ff, 0x00ff00, 0xff00aa, 0x00ffff, 0xffff00];
  for (const color of candidates) if (!used.has(color)) return color;
  for (let color = 0; color < 16777216; color += 97) if (!used.has(color)) return color;
  return 0xff00ff;
}

function hex(color: number): string {
  return "#" + color.toString(16).padStart(6, "0");
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 255] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, checksum]);
}
