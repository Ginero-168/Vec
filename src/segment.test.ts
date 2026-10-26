import assert from "node:assert/strict";
import { test } from "node:test";
import { segmentRaster } from "./segment.ts";

function fill(width: number, height: number, paint: (x: number, y: number) => readonly [number, number, number, number]): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = paint(x, y);
      const offset = (y * width + x) * 4;
      rgba[offset] = color[0];
      rgba[offset + 1] = color[1];
      rgba[offset + 2] = color[2];
      rgba[offset + 3] = color[3];
    }
  }
  return rgba;
}

function opaqueColors(rgba: Uint8Array): number {
  const seen = new Set<string>();
  for (let index = 0; index < rgba.length; index += 4) {
    if ((rgba[index + 3] ?? 0) < 128) continue;
    seen.add((rgba[index] ?? 0) + "," + (rgba[index + 1] ?? 0) + "," + (rgba[index + 2] ?? 0));
  }
  return seen.size;
}

test("an anti-aliased edge snaps to the two flat colors", () => {
  const rgba = fill(48, 48, (x, y) => {
    const side = x - y;
    if (side <= -2) return [255, 255, 255, 255];
    if (side >= 2) return [30, 90, 200, 255];
    const mix = (side + 2) / 4;
    return [Math.round(255 * (1 - mix) + 30 * mix), Math.round(255 * (1 - mix) + 90 * mix), Math.round(255 * (1 - mix) + 200 * mix), 255];
  });
  const segmented = segmentRaster(rgba, 48, 48, { mode: "logo", maxColors: 0, removeBackground: false });
  assert.ok(opaqueColors(segmented) <= 2);
  assert.equal(segmented[3], 255);
});

test("a third solid color stays while blends collapse", () => {
  const rgba = fill(48, 36, (x, y) => {
    if (x < 16) return [214, 54, 62, 255];
    if (x < 32) return [46, 102, 214, 255];
    return [242, 184, 48, 255];
  });
  const segmented = segmentRaster(rgba, 48, 36, { mode: "logo", maxColors: 0, removeBackground: false });
  assert.equal(opaqueColors(segmented), 3);
});

test("a flat border color is removed and the subject stays", () => {
  const rgba = fill(40, 40, (x, y) => (x >= 10 && x < 30 && y >= 10 && y < 30 ? [214, 54, 62, 255] : [70, 140, 220, 255]));
  const segmented = segmentRaster(rgba, 40, 40, { mode: "logo", maxColors: 0, removeBackground: true });
  assert.equal(segmented[3], 0);
  const center = (20 * 40 + 20) * 4;
  assert.equal(segmented[center + 3], 255);
  assert.ok((segmented[center] ?? 0) > 180);
});

test("a full-bleed gradient is not treated as a flat backdrop", () => {
  const rgba = fill(32, 32, (x, y) => [x * 8, y * 8, 80, 255]);
  const segmented = segmentRaster(rgba, 32, 32, { mode: "photo", maxColors: 8, removeBackground: true });
  let opaque = 0;
  for (let index = 3; index < segmented.length; index += 4) if ((segmented[index] ?? 0) === 255) opaque += 1;
  assert.ok(opaque > 32 * 32 * 0.9);
});

test("poster mode keeps gray tones and a thin line survives", () => {
  const color = fill(24, 24, (x) => (x < 12 ? [220, 40, 40, 255] : [40, 80, 220, 255]));
  const poster = segmentRaster(color, 24, 24, { mode: "poster", maxColors: 8, removeBackground: false });
  assert.ok(opaqueColors(poster) <= 8);
  assert.equal(poster[0], poster[1]);
  assert.equal(poster[1], poster[2]);

  const line = fill(40, 24, (x, y) => (y === 12 && x > 2 && x < 37 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  const kept = segmentRaster(line, 40, 24, { mode: "logo", maxColors: 0, removeBackground: false });
  let dark = 0;
  for (let index = 0; index < kept.length; index += 4) {
    if ((kept[index + 3] ?? 0) < 128) continue;
    if ((kept[index] ?? 255) < 40) dark += 1;
  }
  assert.ok(dark >= 20);
});
