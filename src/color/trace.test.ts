import * as assert from "node:assert/strict";
import { test } from "node:test";
import { deltaE76, rgbToCieLab, rgbToOklab, oklabDistance } from "./oklab";
import { rasterizeShapes } from "./raster";
import { segmentImage } from "./segment";
import { traceSegmentation } from "./trace";
import { TRANSPARENT, type Rgb, type Segmentation } from "./model";

function paint(width: number, height: number, colorAt: (x: number, y: number) => Rgb | null): { rgba: Uint8Array; width: number; height: number } {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = colorAt(x, y);
      if (!color) continue;
      const offset = (y * width + x) * 4;
      rgba[offset] = color.r;
      rgba[offset + 1] = color.g;
      rgba[offset + 2] = color.b;
      rgba[offset + 3] = 255;
    }
  }
  return { rgba, width, height };
}

function segmentationFrom(width: number, height: number, labelAt: (x: number, y: number) => number, palette: readonly Rgb[]): Segmentation {
  const labels = new Uint16Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) labels[y * width + x] = labelAt(x, y);
  }
  return { width, height, labels, palette };
}

test("a flat rectangle traces to a four-corner path", () => {
  const segmentation = segmentationFrom(8, 6, (x, y) => (x >= 2 && x < 6 && y >= 1 && y < 4 ? 0 : TRANSPARENT), [{ r: 200, g: 40, b: 30 }]);
  const traced = traceSegmentation(segmentation, { smooth: 0, upscale: 1, cornerAngle: 0.6 });
  assert.equal(traced.pathCount, 1);
  assert.equal(traced.nodeCount, 4);
  const rendered = rasterizeShapes(traced.shapes, 8, 6);
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 8; x++) {
      const inside = x >= 2 && x < 6 && y >= 1 && y < 4;
      assert.equal(rendered[(y * 8 + x) * 4 + 3], inside ? 255 : 0);
    }
  }
});

test("adjacent regions share the smoothed edge", () => {
  const segmentation = segmentationFrom(6, 4, (x) => (x < 3 ? 0 : 1), [
    { r: 20, g: 20, b: 20 },
    { r: 230, g: 230, b: 230 }
  ]);
  const traced = traceSegmentation(segmentation, { smooth: 0, upscale: 1, cornerAngle: 0.5 });
  assert.equal(traced.pathCount, 2);
  const vertical = (shapeIndex: number) => {
    const hits: string[] = [];
    for (const subpath of traced.shapes[shapeIndex]?.subpaths ?? []) {
      let x = subpath.start.x;
      let y = subpath.start.y;
      const points = [{ x, y }];
      for (const command of subpath.commands) {
        x = command.x;
        y = command.y;
        points.push({ x, y });
      }
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        if (a && b && a.x === 3 && b.x === 3) hits.push(Math.min(a.y, b.y) + ":" + Math.max(a.y, b.y));
      }
    }
    return hits.sort().join(",");
  };
  assert.equal(vertical(0), vertical(1));
  assert.match(vertical(0), /0:4/);
});

test("a hole stays open and the inner color fills it", () => {
  const segmentation = segmentationFrom(7, 7, (x, y) => {
    if (x === 0 || y === 0 || x === 6 || y === 6) return TRANSPARENT;
    if (x >= 2 && x <= 4 && y >= 2 && y <= 4) return 1;
    return 0;
  }, [
    { r: 10, g: 80, b: 200 },
    { r: 240, g: 210, b: 40 }
  ]);
  const traced = traceSegmentation(segmentation, { smooth: 0, upscale: 1, cornerAngle: 0.4 });
  const rendered = rasterizeShapes(traced.shapes, 7, 7);
  assert.equal(rendered[(3 * 7 + 3) * 4 + 1], 210);
  assert.equal(rendered[(1 * 7 + 1) * 4 + 2], 200);
  assert.equal(rendered[(2 * 7 + 1) * 4 + 2], 200);
});

test("anti-aliased orange keeps the core color and a thin stroke survives", () => {
  const orange: Rgb = { r: 242, g: 120, b: 32 };
  const white: Rgb = { r: 248, g: 246, b: 242 };
  const black: Rgb = { r: 18, g: 18, b: 20 };
  const image = paint(48, 32, (x, y) => {
    if (x === 8 && y >= 6 && y < 26) return black;
    if ((x === 7 || x === 9) && y >= 6 && y < 26) return { r: 120, g: 120, b: 122 };
    if (x >= 20 && x < 40 && y >= 4 && y < 28) {
      if (x === 20 || x === 39) return { r: 250, g: 190, b: 140 };
      return orange;
    }
    return white;
  });
  const segmentation = segmentImage(image.rgba, image.width, image.height, 8, { preset: "ui" });
  const dark = segmentation.palette.filter((color) => rgbToOklab(color.r, color.g, color.b).l < 0.35);
  assert.ok(dark.length >= 1, "dark stroke stays in the palette");
  let strokeLabel = TRANSPARENT;
  for (let y = 6; y < 26; y++) {
    const label = segmentation.labels[y * image.width + 8] ?? TRANSPARENT;
    if (label === TRANSPARENT) continue;
    const color = segmentation.palette[label];
    if (color && rgbToOklab(color.r, color.g, color.b).l < 0.45) strokeLabel = label;
  }
  assert.notEqual(strokeLabel, TRANSPARENT);
  const orangeLabel = segmentation.labels[16 * image.width + 30] ?? TRANSPARENT;
  const kept = segmentation.palette[orangeLabel];
  assert.ok(kept);
  const delta = deltaE76(rgbToCieLab(kept.r, kept.g, kept.b), rgbToCieLab(orange.r, orange.g, orange.b));
  assert.ok(delta < 6, "core orange deltaE " + delta.toFixed(2));
  const traced = traceSegmentation(segmentation, { preset: "ui", smooth: 0.5, upscale: 2, originalLabels: segmentation.labels });
  const rendered = rasterizeShapes(traced.shapes, image.width, image.height);
  const center = rendered[(16 * image.width + 8) * 4] ?? 255;
  assert.ok(center < 80, "rasterized stroke stays dark");
  assert.ok(oklabDistance(rgbToOklab(orange.r, orange.g, orange.b), rgbToOklab(248, 220, 180)) > 0.05);
});
