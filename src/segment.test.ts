import assert from "node:assert/strict";
import { test } from "node:test";
import { borderSpread, segmentRaster } from "./segment.ts";

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

function opaqueNonGrayColors(rgba: Uint8Array): number {
  const seen = new Set<string>();
  for (let index = 0; index < rgba.length; index += 4) {
    if ((rgba[index + 3] ?? 0) < 128) continue;
    const red = rgba[index] ?? 0;
    const green = rgba[index + 1] ?? 0;
    const blue = rgba[index + 2] ?? 0;
    if (red === green && green === blue) continue;
    seen.add(red + "," + green + "," + blue);
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

test("a large gray between white and brown stays gray", () => {
  const rgba = fill(48, 36, (x) => {
    if (x < 16) return [245, 245, 245, 255];
    if (x < 32) return [120, 120, 120, 255];
    return [40, 20, 15, 255];
  });
  const segmented = segmentRaster(rgba, 48, 36, { mode: "logo", maxColors: 6, removeBackground: false, snapBlends: true });
  const center = (18 * 48 + 24) * 4;
  const red = segmented[center] ?? 0;
  const green = segmented[center + 1] ?? 0;
  const blue = segmented[center + 2] ?? 0;
  assert.ok(Math.abs(red - 120) < 35 && Math.abs(green - 120) < 35 && Math.abs(blue - 120) < 35);
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

test("a flat border reports almost no spread and a split border reports a wide one", () => {
  const flat = fill(24, 24, () => [70, 140, 220, 255]);
  const split = fill(24, 24, (x) => (x < 12 ? [20, 20, 20, 255] : [230, 230, 230, 255]));
  assert.ok(borderSpread(flat, 24, 24) < 1);
  assert.ok(borderSpread(split, 24, 24) > 22);
});

test("a wider backdrop gate removes a border the default gate keeps", () => {
  const rgba = fill(36, 36, (x, y) => {
    const inside = x >= 8 && x < 28 && y >= 8 && y < 28;
    if (inside) return [214, 54, 62, 255];
    return x % 2 === 0 ? [20, 40, 80, 255] : [48, 68, 108, 255];
  });
  const kept = segmentRaster(rgba, 36, 36, { mode: "logo", maxColors: 4, removeBackground: true, backdropSpread: 22 });
  const cleared = segmentRaster(rgba, 36, 36, { mode: "logo", maxColors: 4, removeBackground: true, backdropSpread: 40 });
  assert.equal(kept[3], 255);
  assert.equal(cleared[3], 0);
});

test("speck area decides whether a small block survives", () => {
  const rgba = fill(40, 24, (x, y) => (x >= 10 && x < 16 && y >= 8 && y < 14 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  const merged = segmentRaster(rgba, 40, 24, { mode: "logo", maxColors: 4, removeBackground: false, speckArea: 80 });
  const kept = segmentRaster(rgba, 40, 24, { mode: "logo", maxColors: 4, removeBackground: false, speckArea: 1 });
  const dark = (pixels: Uint8Array): number => {
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) if ((pixels[index] ?? 255) < 40) count += 1;
    return count;
  };
  assert.equal(dark(merged), 0);
  assert.ok(dark(kept) >= 4);
});

test("poster mode keeps multiple flat colors", () => {
  const color = fill(24, 24, (x) => (x < 12 ? [220, 40, 40, 255] : [40, 80, 220, 255]));
  const poster = segmentRaster(color, 24, 24, { mode: "poster", maxColors: 8, removeBackground: false });
  assert.ok(opaqueColors(poster) <= 8);
  assert.ok(opaqueNonGrayColors(poster) >= 2);
});

test("a thin line survives", () => {
  const line = fill(40, 24, (x, y) => (y === 12 && x > 2 && x < 37 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  const kept = segmentRaster(line, 40, 24, { mode: "logo", maxColors: 0, removeBackground: false });
  let dark = 0;
  for (let index = 0; index < kept.length; index += 4) {
    if ((kept[index + 3] ?? 0) < 128) continue;
    if ((kept[index] ?? 255) < 40) dark += 1;
  }
  assert.ok(dark >= 20);
});
