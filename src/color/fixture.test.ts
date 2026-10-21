import * as assert from "node:assert/strict";
import * as fs from "fs";
import { test } from "node:test";
import { TRANSPARENT } from "./model";
import { deltaE76, rgbToCieLab, type Lab } from "./oklab";
import { decodePng } from "./png";
import { rasterizeShapes } from "./raster";
import { segmentImage } from "./segment";
import { traceSegmentation } from "./trace";

const decoded = decodePng(fs.readFileSync("fixtures/user-test-original.png"));
const { width, height, data } = decoded;
const segmentation = segmentImage(data, width, height, 12, { preset: "ui" });
const traced = traceSegmentation(segmentation, {
  preset: "ui",
  smooth: 0.5,
  originalLabels: segmentation.labels,
  coverage: segmentation.coverage,
  partner: segmentation.partner
});
const rendered = rasterizeShapes(traced.shapes, width, height);

function sourceLab(index: number): Lab {
  const offset = index * 4;
  return rgbToCieLab(data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0);
}

function renderedLab(index: number): Lab {
  const offset = index * 4;
  return rgbToCieLab(rendered[offset] ?? 255, rendered[offset + 1] ?? 255, rendered[offset + 2] ?? 255);
}

function isTitleBar(index: number): boolean {
  const x = index % width;
  const y = (index - x) / width;
  if (y < 36 || y > 124 || x < 32 || x + 32 >= width) return false;
  const offset = index * 4;
  const r = data[offset] ?? 0;
  const g = data[offset + 1] ?? 0;
  const b = data[offset + 2] ?? 0;
  return Math.abs(r - 84) <= 12 && Math.abs(g - 84) <= 12 && Math.abs(b - 84) <= 12 && Math.abs(r - g) < 10 && Math.abs(g - b) < 10;
}

test("the dark title bar stays its own gray", () => {
  const pixels: number[] = [];
  for (let index = 0; index < width * height; index++) if (isTitleBar(index)) pixels.push(index);
  assert.ok(pixels.length > width * 40, "title bar area " + pixels.length);
  const counts = new Map<number, number>();
  for (const index of pixels) {
    const label = segmentation.labels[index] ?? TRANSPARENT;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  let label = TRANSPARENT;
  let covered = 0;
  for (const [candidate, count] of counts) {
    if (count > covered) {
      label = candidate;
      covered = count;
    }
  }
  assert.ok(covered / pixels.length > 0.9, "title bar coverage " + (covered / pixels.length).toFixed(3));
  const swatch = segmentation.palette[label];
  assert.ok(swatch);
  let sumL = 0;
  let sumA = 0;
  let sumB = 0;
  let close = 0;
  for (const index of pixels) {
    const origin = sourceLab(index);
    const sample = renderedLab(index);
    sumL += origin.l;
    sumA += origin.a;
    sumB += origin.b;
    if (deltaE76(origin, sample) < 5) close++;
  }
  const mean = { l: sumL / pixels.length, a: sumA / pixels.length, b: sumB / pixels.length };
  const swatchDelta = deltaE76(mean, rgbToCieLab(swatch.r, swatch.g, swatch.b));
  assert.ok(swatchDelta < 5, "title bar swatch deltaE " + swatchDelta.toFixed(2));
  assert.ok(close / pixels.length > 0.9, "title bar pixels within dE 5: " + (close / pixels.length).toFixed(3));
  const background = segmentation.labels[160 * width + 400] ?? TRANSPARENT;
  assert.notEqual(label, background);
});

test("Selection and Next keep their dark shapes", () => {
  const selection = maskIoU(92, 204, 84, 56);
  const next = maskIoU(174, 204, 62, 56);
  assert.ok(selection.original > 200, "Selection dark pixels " + selection.original);
  assert.ok(next.original > 80, "Next dark pixels " + next.original);
  assert.ok(selection.iou >= 0.8, "Selection IoU " + selection.iou.toFixed(3));
  assert.ok(next.iou >= 0.8, "Next IoU " + next.iou.toFixed(3));
});

test("large flat regions keep a mean color within delta E 6", () => {
  const seen = new Uint8Array(width * height);
  const failures: string[] = [];
  const minimum = width * height * 0.005;
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || (data[start * 4 + 3] ?? 0) < 128) continue;
    const seedR = data[start * 4] ?? 0;
    const seedG = data[start * 4 + 1] ?? 0;
    const seedB = data[start * 4 + 2] ?? 0;
    const stack = [start];
    seen[start] = 1;
    let count = 0;
    let originL = 0;
    let originA = 0;
    let originB = 0;
    let sampleL = 0;
    let sampleA = 0;
    let sampleB = 0;
    let minX = width;
    let minY = height;
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      count++;
      const origin = sourceLab(current);
      const sample = renderedLab(current);
      originL += origin.l;
      originA += origin.a;
      originB += origin.b;
      sampleL += sample.l;
      sampleA += sample.a;
      sampleB += sample.b;
      const x = current % width;
      const y = (current - x) / width;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      const neighbors = [current - 1, current + 1, current - width, current + width];
      for (const next of neighbors) {
        if (next < 0 || next >= seen.length || seen[next]) continue;
        const nx = next % width;
        if (Math.abs(nx - x) + Math.abs(Math.floor(next / width) - y) !== 1) continue;
        const offset = next * 4;
        if (
          Math.abs((data[offset] ?? 0) - seedR) > 4 ||
          Math.abs((data[offset + 1] ?? 0) - seedG) > 4 ||
          Math.abs((data[offset + 2] ?? 0) - seedB) > 4
        ) {
          continue;
        }
        seen[next] = 1;
        stack.push(next);
      }
    }
    if (count < minimum) continue;
    const delta = deltaE76(
      { l: originL / count, a: originA / count, b: originB / count },
      { l: sampleL / count, a: sampleA / count, b: sampleB / count }
    );
    if (delta >= 6) failures.push(minX + "," + minY + " n=" + count + " dE " + delta.toFixed(2));
  }
  assert.deepEqual(failures, []);
});

test("small dark components all survive", () => {
  let kept = 0;
  let total = 0;
  const seen = new Uint8Array(width * height);
  for (let start = 0; start < width * height; start++) {
    if (!isDark(data, start) || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    const pixels: number[] = [];
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      pixels.push(current);
      const x = current % width;
      const y = (current - x) / width;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      const neighbors = [current - 1, current + 1, current - width, current + width];
      for (const next of neighbors) {
        if (next < 0 || next >= width * height || seen[next] || !isDark(data, next)) continue;
        const nx = next % width;
        if (Math.abs(nx - x) + Math.abs((next - nx) / width - y) !== 1) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    if (pixels.length < 8 || pixels.length > 800) continue;
    const spanX = maxX - minX + 1;
    const spanY = maxY - minY + 1;
    if (spanX > 80 && spanY > 40) continue;
    total++;
    let hit = 0;
    for (const pixel of pixels) if (isRenderedDark(pixel)) hit++;
    if (hit >= Math.max(2, pixels.length * 0.35)) kept++;
  }
  assert.equal(kept, total);
  assert.equal(total, 30);
});

function maskIoU(x0: number, y0: number, boxWidth: number, boxHeight: number): { iou: number; original: number } {
  let original = 0;
  let vector = 0;
  let intersection = 0;
  for (let y = y0; y < y0 + boxHeight; y++) {
    for (let x = x0; x < x0 + boxWidth; x++) {
      const offset = (y * width + x) * 4;
      const sourceDark = Math.max(data[offset] ?? 255, data[offset + 1] ?? 255, data[offset + 2] ?? 255) < 150;
      const renderedDark = Math.max(rendered[offset] ?? 255, rendered[offset + 1] ?? 255, rendered[offset + 2] ?? 255) < 150;
      if (sourceDark) original++;
      if (renderedDark) vector++;
      if (sourceDark && renderedDark) intersection++;
    }
  }
  const union = original + vector - intersection;
  return { iou: union === 0 ? 0 : intersection / union, original };
}

function isDark(rgba: Uint8Array, index: number): boolean {
  return Math.max(rgba[index * 4] ?? 255, rgba[index * 4 + 1] ?? 255, rgba[index * 4 + 2] ?? 255) < 70;
}

function isRenderedDark(index: number): boolean {
  const offset = index * 4;
  if ((rendered[offset + 3] ?? 0) < 128) return false;
  return Math.max(rendered[offset] ?? 255, rendered[offset + 1] ?? 255, rendered[offset + 2] ?? 255) < 110;
}
