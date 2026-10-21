import * as assert from "node:assert/strict";
import * as fs from "fs";
import { test } from "node:test";
import { TRANSPARENT } from "./model";
import { deltaE76, rgbToCieLab, type Lab } from "./oklab";
import { decodePng } from "./png";
import { buildGlyphIndex } from "./glyph";
import { measureGlyphBox } from "./glyph-quality";
import { rasterizeShapes } from "./raster";
import { segmentImage } from "./segment";
import { boundaryWobble, contourDeviationP95, staircaseRatio, traceSegmentation } from "./trace";

const decoded = decodePng(fs.readFileSync("fixtures/user-test-original.png"));
const { width, height, data } = decoded;
const segmentation = segmentImage(data, width, height, 12, { preset: "ui" });
const traced = traceSegmentation(segmentation, {
  preset: "ui",
  smooth: 0.5,
  originalLabels: segmentation.labels,
  coverage: segmentation.coverage,
  partner: segmentation.partner,
  source: data
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

test("edge pixels stay on the two local cores", () => {
  const fringe = countFringe(segmentation.labels, width, height);
  assert.ok(fringe < 100, "fringe pixels " + fringe);
});

test("the label map has no checkerboard", () => {
  const checkerboard = countCheckerboard(segmentation.labels, width, height);
  assert.ok(checkerboard < 12, "checkerboard pixels " + checkerboard);
});

test("shared edges are not pixel staircases", () => {
  const ratio = staircaseRatio(traced.shapes);
  assert.ok(ratio < 0.04, "staircase ratio " + ratio.toFixed(4));
});

test("traced boundaries stay on the source half-coverage contour", () => {
  const deviation = contourDeviationP95(segmentation, data, traced.shapes);
  assert.ok(deviation < 0.6, "iso deviation p95 " + deviation.toFixed(3));
});

test("Next and Selection read as clean glyphs", () => {
  const glyphs = buildGlyphIndex(data, segmentation.labels, segmentation.palette, width, height);
  const boxes = [
    { name: "Selection", x: 92, y: 204, w: 84, h: 56 },
    { name: "Next", x: 174, y: 204, w: 62, h: 56 }
  ];
  for (const box of boxes) {
    const pair = glyphs.pairInBox(box.x, box.y, box.w, box.h);
    assert.ok(pair, box.name + " has no thin text component");
    if (!pair) continue;
    const quality = measureGlyphBox(traced.shapes, data, width, height, box.x, box.y, box.w, box.h, pair.ink, pair.bg);
    assert.ok(quality.iou >= 0.9, box.name + " IoU " + quality.iou.toFixed(3));
    assert.ok(quality.hausdorffP95 <= 0.5, box.name + " boundary p95 " + quality.hausdorffP95.toFixed(3));
    assert.equal(quality.spikes, 0, box.name + " spikes " + quality.spikes);
    assert.equal(quality.cracks, 0, box.name + " cracks " + quality.cracks);
  }
});

test("smooth edges do not wobble once per pixel", () => {
  const off = boundaryWobble(traced.shapes);
  const cleaned = traceSegmentation(segmentation, {
    preset: "ui",
    smooth: 0.5,
    cleanShapes: 0.55,
    cleanText: false,
    originalLabels: segmentation.labels,
    coverage: segmentation.coverage,
    partner: segmentation.partner,
    source: data
  });
  const on = boundaryWobble(cleaned.shapes);
  assert.ok(off < 0.5, "wobble off " + off.toFixed(3));
  assert.ok(on < 0.5, "wobble on " + on.toFixed(3));
  assert.ok(on < off * 0.8, "wobble on " + on.toFixed(3) + " off " + off.toFixed(3));
});

test("the black a is one region", () => {
  const mask = blackAMask(data, width, height);
  assert.ok(mask.length > 400, "black a pixels " + mask.length);
  const counts = new Map<number, number>();
  for (const index of mask) {
    const label = segmentation.labels[index] ?? TRANSPARENT;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  const top = ranked[0];
  const second = ranked[1];
  assert.ok(top);
  assert.ok(top[1] / mask.length >= 0.95, "modal coverage " + (top[1] / mask.length).toFixed(3) + " labels " + ranked.length);
  if (second) assert.ok(second[1] / mask.length < 0.04, "second label share " + (second[1] / mask.length).toFixed(3));
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

function countCheckerboard(labels: Uint16Array, imageWidth: number, imageHeight: number): number {
  let count = 0;
  for (let y = 1; y < imageHeight - 1; y++) {
    for (let x = 1; x < imageWidth - 1; x++) {
      const index = y * imageWidth + x;
      const label = labels[index] ?? TRANSPARENT;
      if (label === TRANSPARENT) continue;
      const neighbors = [index - 1, index + 1, index - imageWidth, index + imageWidth];
      let foreign = 0;
      for (const neighbor of neighbors) {
        const other = labels[neighbor] ?? TRANSPARENT;
        if (other !== label) foreign++;
      }
      if (foreign === 4) count++;
    }
  }
  return count;
}

function countFringe(labels: Uint16Array, imageWidth: number, imageHeight: number): number {
  const core = new Uint8Array(labels.length);
  for (let y = 1; y < imageHeight - 1; y++) {
    for (let x = 1; x < imageWidth - 1; x++) {
      const index = y * imageWidth + x;
      const label = labels[index] ?? TRANSPARENT;
      if (label === TRANSPARENT) continue;
      if (
        labels[index - 1] === label &&
        labels[index + 1] === label &&
        labels[index - imageWidth] === label &&
        labels[index + imageWidth] === label
      ) {
        core[index] = 1;
      }
    }
  }
  const totals = new Map<number, number>();
  const cores = new Map<number, number>();
  let fringe = 0;
  for (let y = 0; y < imageHeight; y++) {
    for (let x = 0; x < imageWidth; x++) {
      const index = y * imageWidth + x;
      if (core[index]) continue;
      const label = labels[index] ?? TRANSPARENT;
      if (label === TRANSPARENT) continue;
      let boundary = false;
      if (x > 0 && (labels[index - 1] ?? TRANSPARENT) !== label) boundary = true;
      if (x + 1 < imageWidth && (labels[index + 1] ?? TRANSPARENT) !== label) boundary = true;
      if (y > 0 && (labels[index - imageWidth] ?? TRANSPARENT) !== label) boundary = true;
      if (y + 1 < imageHeight && (labels[index + imageWidth] ?? TRANSPARENT) !== label) boundary = true;
      if (!boundary) continue;
      totals.clear();
      cores.clear();
      for (let oy = -2; oy <= 2; oy++) {
        const yy = y + oy;
        if (yy < 0 || yy >= imageHeight) continue;
        for (let ox = -2; ox <= 2; ox++) {
          const xx = x + ox;
          if (xx < 0 || xx >= imageWidth) continue;
          const neighborIndex = yy * imageWidth + xx;
          const neighbor = labels[neighborIndex] ?? TRANSPARENT;
          if (neighbor === TRANSPARENT) continue;
          totals.set(neighbor, (totals.get(neighbor) ?? 0) + 1);
          if (core[neighborIndex]) cores.set(neighbor, (cores.get(neighbor) ?? 0) + 1);
        }
      }
      const ranked = [...cores.entries()].filter((entry) => entry[1] > 0).sort((left, right) => right[1] - left[1] || (totals.get(right[0]) ?? 0) - (totals.get(left[0]) ?? 0));
      const first = ranked[0];
      const second = ranked[1];
      if (!first || !second) continue;
      if (label !== first[0] && label !== second[0]) fringe++;
    }
  }
  return fringe;
}

function blackAMask(rgba: Uint8Array, imageWidth: number, imageHeight: number): number[] {
  let minX = imageWidth;
  let minY = imageHeight;
  let maxX = 0;
  let maxY = 0;
  let green = 0;
  for (let y = 0; y < imageHeight; y++) {
    for (let x = 0; x < imageWidth; x++) {
      const offset = (y * imageWidth + x) * 4;
      const red = rgba[offset] ?? 0;
      const greenChannel = rgba[offset + 1] ?? 0;
      const blue = rgba[offset + 2] ?? 0;
      if (greenChannel > 90 && greenChannel > red + 25 && greenChannel > blue + 15) {
        green++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (green < 1000) return [];
  const pixels: number[] = [];
  const x0 = minX + 18;
  const y0 = minY + 28;
  const x1 = maxX - 18;
  const y1 = maxY - 18;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const offset = (y * imageWidth + x) * 4;
      const red = rgba[offset] ?? 255;
      const greenChannel = rgba[offset + 1] ?? 255;
      const blue = rgba[offset + 2] ?? 255;
      const luma = 0.2126 * red + 0.7152 * greenChannel + 0.0722 * blue;
      if (luma < 42 && greenChannel < 80) pixels.push(y * imageWidth + x);
    }
  }
  return pixels;
}

function isDark(rgba: Uint8Array, index: number): boolean {
  return Math.max(rgba[index * 4] ?? 255, rgba[index * 4 + 1] ?? 255, rgba[index * 4 + 2] ?? 255) < 70;
}

function isRenderedDark(index: number): boolean {
  const offset = index * 4;
  if ((rendered[offset + 3] ?? 0) < 128) return false;
  return Math.max(rendered[offset] ?? 255, rendered[offset + 1] ?? 255, rendered[offset + 2] ?? 255) < 110;
}
