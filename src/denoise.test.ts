import assert from "node:assert/strict";
import { test } from "node:test";
import { denoiseJpegArtifacts } from "./denoise.ts";

function image(width: number, height: number, paint: (x: number, y: number) => readonly [number, number, number]): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const color = paint(x, y);
      rgba[offset] = color[0];
      rgba[offset + 1] = color[1];
      rgba[offset + 2] = color[2];
      rgba[offset + 3] = 255;
    }
  }
  return rgba;
}

function variance(rgba: Uint8Array, width: number, x0: number, y0: number, x1: number, y1: number, channel: number): number {
  const values: number[] = [];
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) values.push(rgba[(y * width + x) * 4 + channel] ?? 0);
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}

function jpegLikeNoise(base: Uint8Array, width: number, height: number): Uint8Array {
  const noisy = base.slice();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const blockOffset = (((Math.floor(x / 8) * 3 + Math.floor(y / 8) * 2) % 5) - 2) * 3;
      const texture = ((x * 17 + y * 29 + x * y * 3) % 7) - 3;
      const nearVerticalEdge = Math.abs(x - 40) <= 2;
      const ringing = nearVerticalEdge ? ((x + y) % 2 === 0 ? 5 : -5) : 0;
      for (let channel = 0; channel < 3; channel += 1) {
        const chromaNoise = channel === 1 ? -texture : channel === 2 ? texture : 0;
        noisy[offset + channel] = Math.max(0, Math.min(255, (base[offset + channel] ?? 0) + blockOffset + texture + chromaNoise + ringing));
      }
    }
  }
  return noisy;
}

test("JPEG-like block, chroma, and edge ringing noise is reduced without moving a sharp edge", () => {
  const width = 80;
  const height = 64;
  const clean = image(width, height, (x) => x < 40 ? [188, 176, 164] : [48, 104, 196]);
  const noisy = jpegLikeNoise(clean, width, height);
  const denoised = denoiseJpegArtifacts(noisy, width, height);

  for (let channel = 0; channel < 3; channel += 1) {
    const beforeVariance = variance(noisy, width, 8, 10, 31, 54, channel);
    const afterVariance = variance(denoised, width, 8, 10, 31, 54, channel);
    assert.ok(afterVariance < beforeVariance * 0.35, `channel ${channel} flat-region variance ${beforeVariance} -> ${afterVariance}`);
  }

  const row = 32;
  const edge = (x: number): number => denoised[(row * width + x) * 4] ?? 0;
  let crossing = 0;
  let largestGap = 0;
  for (let x = 36; x < 44; x += 1) {
    const gap = Math.abs(edge(x) - edge(x + 1));
    if (gap < largestGap) continue;
    largestGap = gap;
    crossing = x;
  }
  const midpoint = (188 + 48) / 2;
  const crossingPosition = crossing + ((edge(crossing) - midpoint) / (edge(crossing) - edge(crossing + 1)));
  assert.ok(Math.abs(crossingPosition - 39.5) <= 0.5, `edge crossing near x=${crossingPosition}`);
  assert.ok(Math.abs(edge(39) - edge(40)) >= 100, `edge contrast stayed sharp: ${edge(39)} -> ${edge(40)}`);
});

test("clean flat-color shapes are returned unchanged", () => {
  const clean = image(48, 48, (x, y) => x >= 12 && x < 36 && y >= 10 && y < 38 ? [32, 168, 214] : [242, 238, 226]);
  assert.equal(denoiseJpegArtifacts(clean, 48, 48), clean);
});

test("transparent rasters are left untouched", () => {
  const transparent = image(16, 16, () => [120, 120, 120]);
  transparent[3] = 0;
  assert.equal(denoiseJpegArtifacts(transparent, 16, 16), transparent);
});
