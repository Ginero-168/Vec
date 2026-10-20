import { inflateSync, deflateSync } from "zlib";

export type DecodedPng = { readonly width: number; readonly height: number; readonly data: Uint8Array };

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Decode an 8-bit non-interlaced RGB or RGBA PNG into straight RGBA. */
export function decodePng(buffer: Buffer): DecodedPng {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error("ไฟล์ไม่ใช่ PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  const idat: Buffer[] = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > buffer.length) throw new Error("PNG ขาดส่วนข้อมูล");
    const chunk = buffer.subarray(start, end);
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8] ?? 0;
      colorType = chunk[9] ?? -1;
      const interlace = chunk[12] ?? 0;
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error("รองรับ PNG 8-bit RGB หรือ RGBA เท่านั้น");
      if (interlace !== 0) throw new Error("ไม่รองรับ PNG แบบ interlaced");
      if (width < 1 || height < 1 || width > 8000 || height > 8000) throw new Error("ขนาด PNG ไม่เหมาะกับงานแก้สีในพาเนล");
    } else if (type === "IDAT") {
      idat.push(chunk);
    } else if (type === "IEND") {
      break;
    }
    offset = end + 4;
  }
  if (width === 0 || idat.length === 0) throw new Error("PNG ไม่มีภาพ");
  const bpp = colorType === 6 ? 4 : 3;
  const inflated = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const expected = height * (stride + 1);
  if (inflated.length < expected) throw new Error("ข้อมูลพิกเซลใน PNG ไม่ครบ");
  const raw = unfilter(inflated, width, height, bpp);
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const source = i * bpp;
    const target = i * 4;
    if (bpp === 4) {
      data[target] = raw[source] ?? 0;
      data[target + 1] = raw[source + 1] ?? 0;
      data[target + 2] = raw[source + 2] ?? 0;
      data[target + 3] = raw[source + 3] ?? 0;
    } else {
      data[target] = raw[source] ?? 0;
      data[target + 1] = raw[source + 1] ?? 0;
      data[target + 2] = raw[source + 2] ?? 0;
      data[target + 3] = 255;
    }
  }
  return { width, height, data };
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (rgba.length < width * height * 4) throw new Error("ข้อมูลภาพสั้นกว่าขนาดที่ระบุ");
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    raw[row] = 0;
    for (let x = 0; x < stride; x++) raw[row + 1 + x] = rgba[y * stride + x] ?? 0;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function unfilter(scanlines: Buffer, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp;
  const out = new Uint8Array(height * stride);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    const filter = scanlines[offset] ?? 0;
    offset++;
    const rowStart = y * stride;
    const prevStart = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const raw = scanlines[offset] ?? 0;
      offset++;
      const left = x >= bpp ? (out[rowStart + x - bpp] ?? 0) : 0;
      const up = y > 0 ? (out[prevStart + x] ?? 0) : 0;
      const upLeft = y > 0 && x >= bpp ? (out[prevStart + x - bpp] ?? 0) : 0;
      let value = raw;
      if (filter === 1) value = (raw + left) & 255;
      else if (filter === 2) value = (raw + up) & 255;
      else if (filter === 3) value = (raw + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) value = (raw + paeth(left, up, upLeft)) & 255;
      else if (filter !== 0) throw new Error("PNG filter ไม่รู้จัก");
      out[rowStart + x] = value;
    }
  }
  return out;
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpLeft = Math.abs(estimate - upLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left;
  if (distanceUp <= distanceUpLeft) return up;
  return upLeft;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    const mixed = CRC_TABLE[(crc ^ (buffer[i] ?? 0)) & 255] ?? 0;
    crc = mixed ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
