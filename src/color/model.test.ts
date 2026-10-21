import * as assert from "node:assert/strict";
import { test } from "node:test";
import { ColorDocument, TRANSPARENT, sameRgb, type Rgb, type Segmentation } from "./model";
import { decodePng, encodePng } from "./png";
import { SAMPLE_CREAM, SAMPLE_FRINGE, SAMPLE_ORANGE, SAMPLE_SPECKLE, makeStripeSample } from "./sample";
import { countSvgFills, segmentImage, segmentationToSvg } from "./segment";

function solid(width: number, height: number, paint: (x: number, y: number) => number, palette: readonly Rgb[]): Segmentation {
  const labels = new Uint16Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) labels[y * width + x] = paint(x, y);
  }
  return { width, height, labels, palette };
}

const RED: Rgb = { r: 200, g: 30, b: 20 };
const BLUE: Rgb = { r: 20, g: 40, b: 180 };
const LIGHT: Rgb = { r: 240, g: 140, b: 90 };
const GREEN: Rgb = { r: 20, g: 140, b: 60 };

test("zap merges a speckle into the nearer neighbor and leaves the target color", () => {
  const segmentation = solid(9, 9, (x, y) => (x === 2 && y === 4 ? 2 : x < 6 ? 0 : 1), [RED, BLUE, LIGHT]);
  const doc = ColorDocument.fromSegmentation(segmentation);
  assert.equal(doc.colorCount(), 3);
  const result = doc.zap(2, 4);
  assert.equal(result.ok, true);
  assert.equal(doc.colorCount(), 2);
  assert.equal(doc.labels[4 * 9 + 2], 0);
  assert.ok(sameRgb(doc.palette[0]!, RED));
  assert.ok(doc.palette.every((color) => !sameRgb(color, LIGHT)));
});

test("zap refuses a compact region and does not change pixels", () => {
  const segmentation = solid(30, 20, (x) => (x < 15 ? 0 : 1), [RED, BLUE]);
  const doc = ColorDocument.fromSegmentation(segmentation);
  const before = doc.labels.slice();
  const result = doc.zap(1, 1);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /ต่อเนื่อง/);
  assert.deepEqual(doc.labels, before);
  assert.equal(doc.dirty(), false);
  assert.equal(doc.canUndo(), false);
});

test("zap splits a thin fringe into its line and merges that piece", () => {
  const width = 60;
  const segmentation = solid(width, 8, (_x, y) => (y < 3 ? 0 : y === 3 ? 2 : 1), [RED, BLUE, LIGHT]);
  const doc = ColorDocument.fromSegmentation(segmentation);
  const result = doc.zap(0, 3);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.detail, /→/);
  for (let x = 0; x < width; x++) assert.equal(doc.labels[3 * width + x], 0);
  assert.ok(doc.palette.some((color) => sameRgb(color, RED)));
  assert.equal(doc.colorCount(), 2);
});

test("zap thresholds are tunable", () => {
  const segmentation = solid(20, 20, (x, y) => (x >= 6 && x < 14 && y >= 6 && y < 14 ? 1 : 0), [RED, BLUE]);
  const strict = ColorDocument.fromSegmentation(segmentation);
  strict.setThresholds({ maxSpeckleArea: 40, minBoundaryRatio: 1, maxThinWidth: 1 });
  const refused = strict.zap(6, 6);
  assert.equal(refused.ok, false);

  const loose = ColorDocument.fromSegmentation(segmentation);
  loose.setThresholds({ maxSpeckleArea: 80 });
  const accepted = loose.zap(6, 6);
  assert.equal(accepted.ok, true);
  assert.equal(loose.colorCount(), 1);
  assert.ok(sameRgb(loose.palette[0]!, RED));
});

test("fill recolors only the 4-connected region", () => {
  const segmentation = solid(3, 3, (x, y) => (y === 2 ? 0 : x === 0 && y === 0 ? 0 : 1), [RED, BLUE]);
  const doc = ColorDocument.fromSegmentation(segmentation);
  doc.setActive(1);
  const result = doc.fill(0, 2);
  assert.equal(result.ok, true);
  assert.equal(doc.labels[2 * 3 + 0], 1);
  assert.equal(doc.labels[2 * 3 + 1], 1);
  assert.equal(doc.labels[2 * 3 + 2], 1);
  assert.equal(doc.labels[0], 0, "diagonal pixel of the same color stays");
  assert.equal(doc.colorCount(), 2);
});

test("a pencil stroke is one undo step", () => {
  const segmentation = solid(4, 2, () => 0, [RED, BLUE]);
  const doc = ColorDocument.fromSegmentation(segmentation);
  doc.setActive(1);
  const stroke = { pushed: false };
  doc.pencil(0, 0, stroke);
  doc.pencil(1, 0, stroke);
  doc.pencil(2, 0, stroke);
  doc.endPencil(stroke);
  assert.equal(doc.labels[0], 1);
  assert.equal(doc.labels[2], 1);
  assert.equal(doc.canUndo(), true);
  assert.equal(doc.undo(), true);
  assert.equal(doc.labels[0], 0);
  assert.equal(doc.labels[2], 0);
  assert.equal(doc.redo(), true);
  assert.equal(doc.labels[1], 1);
});

test("merge keeps the color the user dropped onto, not the larger one", () => {
  const segmentation = solid(5, 2, (x) => (x === 0 ? 1 : 0), [RED, BLUE]);
  const doc = ColorDocument.fromSegmentation(segmentation);
  assert.equal(doc.colorCount(), 2);
  const before = doc.counts();
  assert.ok((before[0] ?? 0) > (before[1] ?? 0));
  const result = doc.merge(0, 1);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.detail, /2 → 1/);
  assert.equal(doc.colorCount(), 1);
  assert.ok(sameRgb(doc.palette[0]!, BLUE));
  for (let i = 0; i < doc.labels.length; i++) assert.equal(doc.labels[i], 0);
});

test("collapse keeps the representative even when it is the smaller color", () => {
  const segmentation = solid(6, 2, (x) => (x === 0 ? 2 : x === 1 ? 1 : 0), [RED, BLUE, GREEN]);
  const doc = ColorDocument.fromSegmentation(segmentation);
  const result = doc.collapse([0, 1, 2], 2);
  assert.equal(result.ok, true);
  assert.equal(doc.colorCount(), 1);
  assert.ok(sameRgb(doc.palette[0]!, GREEN));
  assert.equal(doc.dirty(), true);
});

test("undo, redo, and revert share one history", () => {
  const segmentation = solid(9, 9, (x, y) => (x === 2 && y === 4 ? 2 : x < 6 ? 0 : 1), [RED, BLUE, LIGHT]);
  const doc = ColorDocument.fromSegmentation(segmentation);
  const original = doc.labels.slice();
  assert.equal(doc.zap(2, 4).ok, true);
  assert.equal(doc.undo(), true);
  assert.deepEqual(doc.labels, original);
  assert.equal(doc.colorCount(), 3);
  assert.equal(doc.redo(), true);
  assert.equal(doc.labels[4 * 9 + 2], 0);
  assert.equal(doc.revert(), true);
  assert.deepEqual(doc.labels, original);
  assert.equal(doc.dirty(), false);
  assert.equal(doc.undo(), true);
  assert.equal(doc.labels[4 * 9 + 2], 0);
  assert.equal(doc.colorCount(), 2);
});

test("color count matches colors that still have pixels", () => {
  const segmentation = solid(3, 1, (x) => x, [RED, BLUE, GREEN]);
  const doc = ColorDocument.fromSegmentation(segmentation);
  doc.setActive(0);
  doc.fill(1, 0);
  doc.setActive(0);
  const stroke = { pushed: false };
  doc.pencil(2, 0, stroke);
  doc.endPencil(stroke);
  assert.equal(doc.colorCount(), 1);
  assert.equal(doc.palette.length, doc.counts().filter((count) => count > 0).length);
});

test("png round trip and exact segmentation keep flat colors", () => {
  const rgba = new Uint8Array(2 * 2 * 4);
  const pixels = [RED, BLUE, RED, GREEN];
  pixels.forEach((color, index) => {
    rgba[index * 4] = color.r;
    rgba[index * 4 + 1] = color.g;
    rgba[index * 4 + 2] = color.b;
    rgba[index * 4 + 3] = 255;
  });
  const decoded = decodePng(encodePng(2, 2, rgba));
  assert.equal(decoded.width, 2);
  assert.deepEqual(decoded.data, rgba);
  const segmentation = segmentImage(decoded.data, 2, 2, 8);
  assert.equal(segmentation.palette.length, 3);
  const svg = segmentationToSvg(segmentation);
  assert.equal(countSvgFills(svg), 3);
});

test("sample stripes: zap removes speckle remnants and reports the true count", () => {
  const image = makeStripeSample();
  const segmentation = segmentImage(image.rgba, image.width, image.height, 8);
  const doc = ColorDocument.fromSegmentation(segmentation);
  const before = doc.colorCount();
  assert.equal(before, 4, "orange, cream, fringe, and speckle stay distinct");
  const orange = doc.palette.findIndex((color) => sameRgb(color, SAMPLE_ORANGE));
  const speckle = doc.palette.findIndex((color) => sameRgb(color, SAMPLE_SPECKLE));
  const fringe = doc.palette.findIndex((color) => sameRgb(color, SAMPLE_FRINGE));
  const cream = doc.palette.findIndex((color) => sameRgb(color, SAMPLE_CREAM));
  assert.ok(orange >= 0 && speckle >= 0 && fringe >= 0 && cream >= 0);
  let speckleAt: { x: number; y: number } | null = null;
  for (let y = 0; y < doc.height; y++) {
    for (let x = 0; x < doc.width; x++) {
      if (doc.labels[y * doc.width + x] === speckle) {
        speckleAt = { x, y };
        break;
      }
    }
    if (speckleAt) break;
  }
  if (!speckleAt) throw new Error("ไม่พบจุด speckle");
  const countsBefore = doc.counts();
  const refused = doc.zap(60, 64);
  assert.equal(refused.ok, false);
  assert.equal(doc.colorCount(), before);
  const zapped = doc.zap(speckleAt.x, speckleAt.y);
  assert.equal(zapped.ok, true);
  if (!zapped.ok) return;
  const afterSpeckle = doc.colorCount();
  assert.ok(afterSpeckle < before);
  assert.ok(doc.palette.some((color) => sameRgb(color, SAMPLE_ORANGE)));
  assert.ok(doc.palette.every((color) => !sameRgb(color, SAMPLE_SPECKLE)));
  const fringeLeft = doc.palette.findIndex((color) => sameRgb(color, SAMPLE_FRINGE));
  let fringePixel: { x: number; y: number } | null = null;
  for (let i = 0; i < doc.labels.length; i++) {
    if (doc.labels[i] === fringeLeft) {
      fringePixel = { x: i % doc.width, y: Math.floor(i / doc.width) };
      break;
    }
  }
  if (!fringePixel) throw new Error("ไม่พบเส้นขอบหลัง Zap");
  assert.equal(doc.zap(fringePixel.x, fringePixel.y).ok, true);
  const afterBoth = doc.colorCount();
  assert.equal(afterBoth, before - 2);
  const fringeDoc = ColorDocument.fromSegmentation(segmentation);
  let fringeAt: { x: number; y: number } | null = null;
  for (let i = 0; i < fringeDoc.labels.length; i++) {
    if (fringeDoc.labels[i] === fringe) {
      fringeAt = { x: i % fringeDoc.width, y: Math.floor(i / fringeDoc.width) };
      break;
    }
  }
  if (!fringeAt) throw new Error("ไม่พบเส้นขอบ");
  assert.equal(fringeDoc.zap(fringeAt.x, fringeAt.y).ok, true);
  assert.ok(fringeDoc.palette.every((color) => !sameRgb(color, SAMPLE_FRINGE)));
  console.log(
    "SAMPLE colors before=" +
      before +
      " afterSpeckleZap=" +
      afterSpeckle +
      " afterFringeZap=" +
      fringeDoc.colorCount() +
      " afterBoth=" +
      afterBoth +
      " specklePixels=" +
      countsBefore[speckle] +
      " orangePixels=" +
      countsBefore[orange]
  );
});

test("zap refuses a high-contrast stroke so text is not deleted", () => {
  const black: Rgb = { r: 15, g: 15, b: 18 };
  const white: Rgb = { r: 245, g: 245, b: 242 };
  const segmentation = solid(40, 16, (_x, y) => (y === 8 ? 1 : 0), [white, black]);
  const doc = ColorDocument.fromSegmentation(segmentation);
  const before = doc.labels.slice();
  const result = doc.zap(3, 8);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /คมชัด/);
  assert.deepEqual(doc.labels, before);
  assert.equal(doc.dirty(), false);
});

test("smooth marks a shared boundary and undo restores it", () => {
  const segmentation = solid(16, 12, (x, y) => (x >= 3 && x < 12 && y >= 2 && y < 9 ? 0 : 1), [RED, BLUE]);
  const doc = ColorDocument.fromSegmentation(segmentation);
  const marked = doc.smoothAt(3, 5, null);
  assert.equal(marked.ok, true);
  if (!marked.ok) return;
  assert.equal(marked.changed, true);
  assert.equal(doc.dirty(), true);
  const mask = doc.segmentation().smoothMask;
  assert.ok(mask && mask.some((value) => value > 0));
  assert.equal(doc.undo(), true);
  assert.equal(doc.segmentation().smoothMask, undefined);
  assert.equal(doc.dirty(), false);
  assert.equal(doc.redo(), true);
  assert.ok(doc.segmentation().smoothMask?.some((value) => value > 0));
  const again = doc.smoothLasso(2, 1, 13, 10);
  assert.equal(again.ok, true);
  assert.equal(doc.revert(), true);
  assert.equal(doc.dirty(), false);
});
