import * as assert from "node:assert/strict";
import * as fs from "fs";
import { test } from "node:test";
import { guidedFilter } from "./denoise";
import { deltaE76, rgbToCieLab } from "./oklab";
import { decodePng } from "./png";
import { rasterizeShapes } from "./raster";
import { segmentImage } from "./segment";
import { traceSegmentation } from "./trace";

function rampImage(): { rgba: Uint8Array; width: number; height: number } {
  const width = 96;
  const height = 64;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const t = x / (width - 1);
      if (y < 40) {
        rgba[offset] = Math.round(32 + t * 200);
        rgba[offset + 1] = Math.round(48 + t * 140);
        rgba[offset + 2] = Math.round(64 + t * 40);
      } else {
        rgba[offset] = 200;
        rgba[offset + 1] = 48;
        rgba[offset + 2] = 48;
      }
      rgba[offset + 3] = 255;
    }
  }
  return { rgba, width, height };
}

function meanDelta(source: Uint8Array, rendered: Uint8Array, mask: (index: number) => boolean): number {
  let sum = 0;
  let count = 0;
  for (let index = 0; index < source.length / 4; index++) {
    if (!mask(index)) continue;
    const a = index * 4;
    const origin = rgbToCieLab(source[a] ?? 0, source[a + 1] ?? 0, source[a + 2] ?? 0);
    const paint = rgbToCieLab(rendered[a] ?? 0, rendered[a + 1] ?? 0, rendered[a + 2] ?? 0);
    sum += deltaE76(origin, paint);
    count++;
  }
  return count === 0 ? Infinity : sum / count;
}

test("a photo preset paints a smooth ramp as a gradient and leaves the flat plate flat", () => {
  const image = rampImage();
  const segmentation = segmentImage(image.rgba, image.width, image.height, 8, { preset: "photo" });
  const flat = traceSegmentation(segmentation, { preset: "photo", smooth: 1.2, source: image.rgba, gradients: false });
  const graded = traceSegmentation(segmentation, { preset: "photo", smooth: 1.2, source: image.rgba });
  assert.ok(graded.shapes.some((shape) => shape.gradient), "photo preset finds a ramp");
  assert.equal(flat.nodeCount, graded.nodeCount);
  assert.equal(flat.subpathCount, graded.subpathCount);
  const ramp = (index: number) => {
    const y = Math.floor(index / image.width);
    return y >= 4 && y < 36;
  };
  const flatDelta = meanDelta(image.rgba, rasterizeShapes(flat.shapes, image.width, image.height), ramp);
  const gradedDelta = meanDelta(image.rgba, rasterizeShapes(graded.shapes, image.width, image.height), ramp);
  assert.ok(gradedDelta < flatDelta * 0.55, "ramp ΔE " + gradedDelta.toFixed(2) + " vs " + flatDelta.toFixed(2));
  const plate = (index: number) => Math.floor(index / image.width) >= 48;
  const plateFlat = meanDelta(image.rgba, rasterizeShapes(flat.shapes, image.width, image.height), plate);
  const plateGraded = meanDelta(image.rgba, rasterizeShapes(graded.shapes, image.width, image.height), plate);
  assert.ok(plateGraded < plateFlat + 1.5, "flat plate stayed flat " + plateGraded.toFixed(2));
  assert.match(graded.svg, /gradientUnits="userSpaceOnUse"/);
});

test("a photo scene keeps a radial sun brighter than the sky beside it", () => {
  const decoded = decodePng(fs.readFileSync("fixtures/photo-scene.png"));
  const filtered = guidedFilter(decoded.data, decoded.width, decoded.height);
  const segmentation = segmentImage(filtered, decoded.width, decoded.height, 24, { preset: "photo" });
  const traced = traceSegmentation(segmentation, { preset: "photo", source: filtered, coverage: segmentation.coverage, partner: segmentation.partner });
  assert.ok(traced.shapes.some((shape) => shape.gradient?.kind === "radial"));
  const rendered = rasterizeShapes(traced.shapes, decoded.width, decoded.height);
  const luma = (x: number, y: number) => {
    const offset = (y * decoded.width + x) * 4;
    return 0.2126 * (rendered[offset] ?? 0) + 0.7152 * (rendered[offset + 1] ?? 0) + 0.0722 * (rendered[offset + 2] ?? 0);
  };
  assert.ok(luma(260, 72) > luma(180, 72) + 20, "sun " + luma(260, 72).toFixed(0) + " sky " + luma(180, 72).toFixed(0));
});

test("a logo preset keeps a ramp as flat fills until gradients are asked for", () => {
  const image = rampImage();
  const segmentation = segmentImage(image.rgba, image.width, image.height, 8, { preset: "logo" });
  const traced = traceSegmentation(segmentation, { preset: "logo", smooth: 1.2, source: image.rgba });
  assert.equal(traced.shapes.some((shape) => shape.gradient), false);
  assert.doesNotMatch(traced.svg, /linearGradient|radialGradient/);
});

test("the screenshot's soft ramps drop ΔE without new boundaries", () => {
  const decoded = decodePng(fs.readFileSync("fixtures/user-test-original.png"));
  const segmentation = segmentImage(decoded.data, decoded.width, decoded.height, 12, { preset: "ui" });
  const flat = traceSegmentation(segmentation, {
    preset: "ui",
    smooth: 0.5,
    source: decoded.data,
    gradients: false,
    coverage: segmentation.coverage,
    partner: segmentation.partner
  });
  const graded = traceSegmentation(segmentation, {
    preset: "ui",
    smooth: 0.5,
    source: decoded.data,
    gradients: true,
    coverage: segmentation.coverage,
    partner: segmentation.partner
  });
  assert.equal(flat.nodeCount, graded.nodeCount);
  assert.equal(flat.subpathCount, graded.subpathCount);
  assert.equal(flat.pathCount, graded.pathCount);
  const flatPaint = rasterizeShapes(flat.shapes, decoded.width, decoded.height);
  const gradedPaint = rasterizeShapes(graded.shapes, decoded.width, decoded.height);
  const box = (x0: number, y0: number, w: number, h: number) => (index: number) => {
    const x = index % decoded.width;
    const y = (index - x) / decoded.width;
    return x >= x0 && x < x0 + w && y >= y0 && y < y0 + h;
  };
  const regions: Array<[string, number, number, number, number]> = [
    ["band", 0, 560, decoded.width, 89],
    ["a", 200, 335, 150, 130],
    ["icon", 112, 254, 80, 84]
  ];
  for (const [name, x, y, w, h] of regions) {
    const flatDelta = meanDelta(decoded.data, flatPaint, box(x, y, w, h));
    const gradedDelta = meanDelta(decoded.data, gradedPaint, box(x, y, w, h));
    assert.ok(gradedDelta < flatDelta * 0.8, name + " ΔE " + gradedDelta.toFixed(2) + " vs " + flatDelta.toFixed(2));
  }
  const title = meanDelta(decoded.data, gradedPaint, box(80, 36, 1400, 48));
  const titleFlat = meanDelta(decoded.data, flatPaint, box(80, 36, 1400, 48));
  assert.ok(title <= titleFlat + 0.4, "title bar stayed gray " + title.toFixed(2) + " vs " + titleFlat.toFixed(2));
});
