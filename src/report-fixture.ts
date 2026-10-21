import * as fs from "fs";
import { deltaE76, rgbToCieLab, type Lab } from "./color/oklab";
import { encodePng, decodePng } from "./color/png";
import { rasterizeShapes } from "./color/raster";
import { renderRgba, segmentImage } from "./color/segment";
import { legacySegmentImage } from "./color/legacy-segment";
import { traceSegmentation } from "./color/trace";
import { TRANSPARENT } from "./color/model";
import { makeStripeSample } from "./color/sample";

const sourcePath = process.argv[2] ?? "fixtures/user-test-original.png";
const decoded = decodePng(fs.readFileSync(sourcePath));
const { width, height, data } = decoded;
console.log("image", width, height, "bytes", data.length);

const uiColors = 12;
const segmentStarted = performance.now();
const segmentation = segmentImage(data, width, height, uiColors, { preset: "ui" });
const segmentMs = performance.now() - segmentStarted;
const traceStarted = performance.now();
const traced = traceSegmentation(segmentation, {
  preset: "ui",
  smooth: 0.5,
  originalLabels: segmentation.labels,
  coverage: segmentation.coverage,
  partner: segmentation.partner
});
const traceMs = performance.now() - traceStarted;
console.log("segmentMs", segmentMs.toFixed(0), "traceMs", traceMs.toFixed(0), "colors", segmentation.palette.length, "paths", traced.pathCount, "nodes", traced.nodeCount, "subpaths", traced.subpathCount);

const legacyStarted = performance.now();
const legacy = legacySegmentImage(data, width, height, uiColors);
const legacyMs = performance.now() - legacyStarted;
const legacyRgba = renderRgba(legacy);
console.log("legacyMs", legacyMs.toFixed(0), "legacyColors", legacy.palette.length);

const rasterStarted = performance.now();
const rendered = rasterizeShapes(traced.shapes, width, height);
const preview = rasterizeShapes(traced.shapes, width, height, 0.35);
const rasterMs = performance.now() - rasterStarted;
console.log("rasterMs", rasterMs.toFixed(0), "svgBytes", traced.svg.length);

const originalLabs = new Array<Lab>(width * height);
const renderedLabs = new Array<Lab>(width * height);
const legacyLabs = new Array<Lab>(width * height);
for (let i = 0; i < width * height; i++) {
  const offset = i * 4;
  originalLabs[i] = rgbToCieLab(data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0);
  const renderedAlpha = rendered[offset + 3] ?? 0;
  renderedLabs[i] = rgbToCieLab(
    renderedAlpha ? (rendered[offset] ?? 255) : 255,
    renderedAlpha ? (rendered[offset + 1] ?? 255) : 255,
    renderedAlpha ? (rendered[offset + 2] ?? 255) : 255
  );
  legacyLabs[i] = rgbToCieLab(legacyRgba[offset] ?? 255, legacyRgba[offset + 1] ?? 255, legacyRgba[offset + 2] ?? 255);
}

function summarize(name: string, labs: Lab[]): void {
  const deltas: number[] = [];
  const contrast: number[] = [];
  let uncovered = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if ((data[index * 4 + 3] ?? 0) < 128) continue;
      const origin = originalLabs[index];
      const sample = labs[index];
      if (!origin || !sample) continue;
      const delta = deltaE76(origin, sample);
      deltas.push(delta);
      if ((rendered[index * 4 + 3] ?? 0) === 0 && labs === renderedLabs) uncovered++;
      if (localContrast(x, y)) contrast.push(delta);
    }
  }
  deltas.sort((a, b) => a - b);
  contrast.sort((a, b) => a - b);
  const mean = deltas.reduce((sum, value) => sum + value, 0) / Math.max(1, deltas.length);
  const cmean = contrast.reduce((sum, value) => sum + value, 0) / Math.max(1, contrast.length);
  console.log(
    name,
    "mean",
    mean.toFixed(2),
    "p95",
    (deltas[Math.floor(deltas.length * 0.95)] ?? 0).toFixed(2),
    "contrastMean",
    cmean.toFixed(2),
    "contrastP95",
    (contrast[Math.floor(contrast.length * 0.95)] ?? 0).toFixed(2),
    "uncovered",
    uncovered
  );
}

function localContrast(x: number, y: number): boolean {
  const index = y * width + x;
  const r = data[index * 4] ?? 0;
  const g = data[index * 4 + 1] ?? 0;
  const b = data[index * 4 + 2] ?? 0;
  const neighbors = [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1]
  ];
  for (const [nx, ny] of neighbors) {
    if (nx === undefined || ny === undefined || nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    const other = (ny * width + nx) * 4;
    if (Math.max(Math.abs(r - (data[other] ?? 0)), Math.abs(g - (data[other + 1] ?? 0)), Math.abs(b - (data[other + 2] ?? 0))) > 48) return true;
  }
  return false;
}

summarize("new", renderedLabs);
summarize("legacy", legacyLabs);

const paletteLine = segmentation.palette
  .map((color, index) => {
    let count = 0;
    for (let i = 0; i < segmentation.labels.length; i++) if (segmentation.labels[i] === index) count++;
    return index + " " + color.r + "," + color.g + "," + color.b + " n=" + count;
  })
  .join(" | ");
console.log("palette", paletteLine);

function dark(index: number): boolean {
  return Math.max(data[index * 4] ?? 255, data[index * 4 + 1] ?? 255, data[index * 4 + 2] ?? 255) < 70;
}
function renderedDark(index: number): boolean {
  if ((rendered[index * 4 + 3] ?? 0) < 128) return false;
  return Math.max(rendered[index * 4] ?? 255, rendered[index * 4 + 1] ?? 255, rendered[index * 4 + 2] ?? 255) < 110;
}

let darkKept = 0;
let darkTotal = 0;
const seen = new Uint8Array(width * height);
for (let start = 0; start < width * height; start++) {
  if (!dark(start) || seen[start]) continue;
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
      if (next < 0 || next >= width * height || seen[next] || !dark(next)) continue;
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
  darkTotal++;
  let hit = 0;
  for (const pixel of pixels) if (renderedDark(pixel)) hit++;
  if (hit >= Math.max(2, pixels.length * 0.35)) darkKept++;
  else console.log("lost-dark", pixels.length, "box", minX, minY, spanX, spanY, "hit", hit);
}
console.log("darkComponents", darkKept + "/" + darkTotal);

let whiteKept = 0;
let whiteTotal = 0;
const seenWhite = new Uint8Array(width * height);
for (let start = 0; start < width * height; start++) {
  if (!nearWhite(data, start) || seenWhite[start]) continue;
  const stack = [start];
  seenWhite[start] = 1;
  const pixels: number[] = [];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    pixels.push(current);
    const x = current % width;
    const neighbors = [current - 1, current + 1, current - width, current + width];
    for (const next of neighbors) {
      if (next < 0 || next >= width * height || seenWhite[next] || !nearWhite(data, next)) continue;
      const nx = next % width;
      if (Math.abs(nx - x) > 1) continue;
      seenWhite[next] = 1;
      stack.push(next);
    }
  }
  if (pixels.length < 6 || pixels.length > 80) continue;
  let rim = 0;
  let rimDarker = 0;
  for (const pixel of pixels) {
    const x = pixel % width;
    const y = (pixel - x) / width;
    const around = [pixel - 1, pixel + 1, pixel - width, pixel + width];
    for (const next of around) {
      if (next < 0 || next >= width * height || nearWhite(data, next)) continue;
      const nx = next % width;
      if (Math.abs(nx - x) > 1) continue;
      rim++;
      const brightness = (data[next * 4] ?? 0) + (data[next * 4 + 1] ?? 0) + (data[next * 4 + 2] ?? 0);
      if (brightness < 640) rimDarker++;
    }
  }
  if (rim < 4 || rimDarker < rim * 0.5) continue;
  whiteTotal++;
  let hit = 0;
  for (const pixel of pixels) if (nearWhite(rendered, pixel)) hit++;
  const x0 = pixels[0]! % width;
  const y0 = Math.floor(pixels[0]! / width);
  if (hit >= Math.max(2, pixels.length * 0.3)) whiteKept++;
  else console.log("lost-white", pixels.length, "at", x0, y0, "hit", hit);
}
console.log("whiteDots", whiteKept + "/" + whiteTotal);

for (let label = 0; label < segmentation.palette.length; label++) {
  const color = segmentation.palette[label];
  if (!color || color.r < 180 || color.r < color.g || color.b > color.g) continue;
  const samples: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = y * width + x;
      if (segmentation.labels[index] !== label) continue;
      if (segmentation.labels[index - 1] !== label || segmentation.labels[index + 1] !== label) continue;
      if (segmentation.labels[index - width] !== label || segmentation.labels[index + width] !== label) continue;
      samples.push(index);
    }
  }
  if (samples.length < 30) continue;
  const channel = (shift: number) => {
    const values = samples.map((index) => data[index * 4 + shift] ?? 0).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] ?? 0;
  };
  const core = { r: channel(0), g: channel(1), b: channel(2) };
  const delta = deltaE76(rgbToCieLab(core.r, core.g, core.b), rgbToCieLab(color.r, color.g, color.b));
  console.log("orangeCore", label, "pixels", samples.length, "src", core.r + "," + core.g + "," + core.b, "pal", color.r + "," + color.g + "," + color.b, "dE", delta.toFixed(2));
}

fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
fs.writeFileSync("/tmp/trace-result.svg", traced.svg);
const gap = 8;
const sheet = new Uint8Array((width * 2 + gap) * height * 4);
paintSheet(sheet, data, 0, width * 2 + gap, width, height);
paintSheet(sheet, preview, width + gap, width * 2 + gap, width, height);
fs.writeFileSync("/opt/cursor/artifacts/trace-compare.png", encodePng(width * 2 + gap, height, sheet));
const legacySheet = new Uint8Array(width * height * 4);
legacySheet.set(legacyRgba);
fs.writeFileSync("/opt/cursor/artifacts/trace-legacy.png", encodePng(width, height, legacySheet));
fs.writeFileSync("/opt/cursor/artifacts/trace-result.png", encodePng(width, height, preview));
writeCrop(180, 70, 520, 160, "trace-crop-title.png");
writeCrop(180, 250, 980, 220, "trace-crop-icons.png");
console.log("wrote artifacts");

const balloon = makeStripeSample();
const balloonStarted = performance.now();
const balloonSegmentation = segmentImage(balloon.rgba, balloon.width, balloon.height, 8, { preset: "logo" });
const balloonTraced = traceSegmentation(balloonSegmentation, { preset: "logo", smooth: 1.2, upscale: 2 });
console.log(
  "balloonMs",
  (performance.now() - balloonStarted).toFixed(0),
  "colors",
  balloonSegmentation.palette.length,
  "paths",
  balloonTraced.pathCount,
  "nodes",
  balloonTraced.nodeCount
);

function nearWhite(rgba: Uint8Array, index: number): boolean {
  if ((rgba[index * 4 + 3] ?? 0) < 128) return false;
  return (rgba[index * 4] ?? 0) > 236 && (rgba[index * 4 + 1] ?? 0) > 236 && (rgba[index * 4 + 2] ?? 0) > 236;
}

function paintSheet(target: Uint8Array, source: Uint8Array, originX: number, sheetWidth: number, sourceWidth: number, sourceHeight: number): void {
  for (let y = 0; y < sourceHeight; y++) {
    for (let x = 0; x < sourceWidth; x++) {
      const from = (y * sourceWidth + x) * 4;
      const to = (y * sheetWidth + originX + x) * 4;
      target[to] = source[from] ?? 0;
      target[to + 1] = source[from + 1] ?? 0;
      target[to + 2] = source[from + 2] ?? 0;
      target[to + 3] = 255;
    }
  }
}

function writeCrop(x0: number, y0: number, cropWidth: number, cropHeight: number, name: string): void {
  const crop = new Uint8Array(cropWidth * 2 * cropHeight * 4);
  for (let y = 0; y < cropHeight; y++) {
    for (let x = 0; x < cropWidth; x++) {
      const sx = Math.min(width - 1, x0 + x);
      const sy = Math.min(height - 1, y0 + y);
      const from = (sy * width + sx) * 4;
      const left = (y * cropWidth * 2 + x) * 4;
      const right = (y * cropWidth * 2 + cropWidth + x) * 4;
      crop[left] = data[from] ?? 0;
      crop[left + 1] = data[from + 1] ?? 0;
      crop[left + 2] = data[from + 2] ?? 0;
      crop[left + 3] = 255;
      crop[right] = preview[from] ?? 0;
      crop[right + 1] = preview[from + 1] ?? 0;
      crop[right + 2] = preview[from + 2] ?? 0;
      crop[right + 3] = 255;
    }
  }
  fs.writeFileSync("/opt/cursor/artifacts/" + name, encodePng(cropWidth * 2, cropHeight, crop));
}
