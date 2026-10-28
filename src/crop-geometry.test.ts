import assert from "node:assert/strict";
import test from "node:test";
import {
  CROP_SUGGEST_PIXELS,
  clampCropRect,
  cropRectToArtboardBounds,
  cropRgba,
  estimateRgbaBytes,
  formatRasterMegapixels,
  moveCropRect,
  requiresCropChoice,
  thumbnailRectToSourcePixels
} from "./crop-geometry.ts";

test("crop suggestion uses a strict 3,145,728 pixel boundary and formats megapixels", () => {
  assert.equal(estimateRgbaBytes({ width: 1240, height: 980 }), 1240 * 980 * 4);
  assert.equal(requiresCropChoice({ width: 3_145_727, height: 1 }), false);
  assert.equal(requiresCropChoice({ width: 3_145_728, height: 1 }), false);
  assert.equal(requiresCropChoice({ width: 3_145_729, height: 1 }), true);
  assert.equal(CROP_SUGGEST_PIXELS, 3_145_728);
  assert.equal(formatRasterMegapixels({ width: 3_145_728, height: 1 }), "3.1");
  assert.equal(formatRasterMegapixels({ width: 40, height: 40 }), "<0.1");
});

test("thumbnail rectangles map to clamped integer source pixels", () => {
  assert.deepEqual(
    thumbnailRectToSourcePixels({ x: 10, y: 5, width: 40, height: 20 }, { width: 100, height: 50 }, { width: 1000, height: 500 }),
    { x: 100, y: 50, width: 400, height: 200 }
  );
  assert.deepEqual(clampCropRect({ x: 8.2, y: -3, width: 9, height: 6.2 }, { width: 10, height: 8 }), { x: 8, y: 0, width: 2, height: 4 });
  assert.deepEqual(moveCropRect({ x: 7, y: 5, width: 3, height: 3 }, 8, -8, { width: 10, height: 8 }), { x: 7, y: 0, width: 3, height: 3 });
});

test("crop offsets map to artboard points using source bounds scaling", () => {
  assert.deepEqual(
    cropRectToArtboardBounds([100, 200, 300, 160], { width: 10, height: 8 }, { x: 2, y: 1, width: 5, height: 4 }),
    [140, 195, 240, 175]
  );
});

test("RGBA crop copies only the selected rectangle rows", () => {
  const sourceSize = { width: 3, height: 2 };
  const rgba = Uint8Array.from({ length: 3 * 2 * 4 }, (_, index) => index);
  assert.deepEqual(
    cropRgba(rgba, sourceSize, { x: 1, y: 0, width: 2, height: 2 }),
    Uint8Array.from([4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 18, 19, 20, 21, 22, 23])
  );
});
