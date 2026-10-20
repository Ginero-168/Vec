// Minimal PNG strip decoder / encoder used to stitch Illustrator's strip captures into one image.
// Only what imageCapture produces is needed: 8-bit RGBA or RGB, non-interlaced. zlib work runs on
// libuv's thread pool (async), and unfiltering is O(pixels) in plain JS on already-small strips.
import * as zlib from "zlib";
import { promisify } from "util";

const inflate = promisify(zlib.inflate);
const deflate = promisify(zlib.deflate);
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface Rgba { width: number; height: number; data: Buffer; }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export async function decodePng(file: Buffer): Promise<Rgba> {
  if (file.length < 8 || !file.subarray(0, 8).equals(SIGNATURE)) throw new Error("ไฟล์ภาพจาก Illustrator ไม่ใช่ PNG");
  let offset = 8, width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  const idat: Buffer[] = [];
  while (offset + 8 <= file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString("latin1", offset + 4, offset + 8);
    const body = file.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      depth = body.readUInt8(8); colorType = body.readUInt8(9); interlace = body.readUInt8(12);
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (depth !== 8 || channels === 0 || interlace !== 0) throw new Error("รูปแบบ PNG จาก Illustrator ไม่รองรับ (" + depth + "/" + colorType + ")");
  const raw = await inflate(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let previous = new Uint8Array(stride);
  let line = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const base = y * (stride + 1);
    const filter = raw[base];
    for (let x = 0; x < stride; x++) {
      const value = raw[base + 1 + x] as number;
      const left = x >= channels ? (line[x - channels] as number) : 0;
      const up = previous[x] as number;
      const upLeft = x >= channels ? (previous[x - channels] as number) : 0;
      line[x] = (filter === 0 ? value : filter === 1 ? value + left : filter === 2 ? value + up
        : filter === 3 ? value + ((left + up) >> 1) : value + paeth(left, up, upLeft)) & 0xff;
    }
    const row = y * width * 4;
    if (channels === 4) out.set(line, row);
    else for (let x = 0; x < width; x++) {
      out[row + x * 4] = line[x * 3] as number; out[row + x * 4 + 1] = line[x * 3 + 1] as number; out[row + x * 4 + 2] = line[x * 3 + 2] as number; out[row + x * 4 + 3] = 255;
    }
    const swap = previous; previous = line; line = swap;
  }
  return { width, height, data: out };
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c; }
  return table;
})();

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  let crc = -1;
  for (let i = 4; i < 8; i++) crc = (CRC_TABLE[(crc ^ (head[i] as number)) & 0xff] as number) ^ (crc >>> 8);
  for (let i = 0; i < body.length; i++) crc = (CRC_TABLE[(crc ^ (body[i] as number)) & 0xff] as number) ^ (crc >>> 8);
  const tail = Buffer.alloc(4);
  tail.writeInt32BE(crc ^ -1, 0);
  return Buffer.concat([head, body, tail]);
}

/** Stack strips top to bottom (all must share the first strip's width) and encode as RGBA PNG. */
export async function stitchPng(strips: readonly Rgba[]): Promise<{ png: Buffer; width: number; height: number }> {
  if (strips.length === 0) throw new Error("ไม่มีภาพจาก Illustrator");
  const width = (strips[0] as Rgba).width;
  const height = strips.reduce((sum, strip) => sum + strip.height, 0);
  const rowBytes = width * 4 + 1;
  const raw = Buffer.alloc(rowBytes * height);
  let y = 0;
  for (const strip of strips) {
    const copyWidth = Math.min(width, strip.width) * 4;
    for (let row = 0; row < strip.height; row++, y++) {
      strip.data.copy(raw, y * rowBytes + 1, row * strip.width * 4, row * strip.width * 4 + copyWidth);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  const compressed = await deflate(raw, { level: 1 });
  return { png: Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", compressed), chunk("IEND", Buffer.alloc(0))]), width, height };
}
