import * as fs from "fs";
import { deltaE76, oklabChroma, rgbToCieLab, rgbToOklab, type Lab } from "./color/oklab";
import { encodePng, decodePng } from "./color/png";
import { rasterizeShapes, rasterizeWindow } from "./color/raster";
import { DARK_SURROUND_L, renderRgba, segmentImage } from "./color/segment";
import { legacySegmentImage } from "./color/legacy-segment";
import { boundaryWobble, contourDeviationP95, measureSharedEdges, staircaseRatio, traceSegmentation } from "./color/trace";
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
  partner: segmentation.partner,
  source: data
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

const plate = coreDelta(541, 223, 305, 304, (color) => color.r > 20 && color.r < 90 && color.g < 24 && color.b < 24 && color.r > color.g + 15);
console.log("maroonCore", plate ? plate.label + " pixels " + plate.pixels + " src " + plate.src + " pal " + plate.pal + " dE " + plate.delta.toFixed(2) : "missing");

let blurDark = 0;
const blurSeen = new Uint8Array(width * height);
for (let start = 0; start < width * height; start++) {
  const label = segmentation.labels[start] ?? TRANSPARENT;
  if (label === TRANSPARENT || blurSeen[start]) continue;
  const stack = [start];
  blurSeen[start] = 1;
  const pixels: number[] = [];
  let inBand = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    pixels.push(current);
    const x = current % width;
    const y = (current - x) / width;
    if (y >= 540 || (x >= 1280 && y <= 180)) inBand++;
    const neighbors = [current - 1, current + 1, current - width, current + width];
    for (const next of neighbors) {
      if (next < 0 || next >= width * height || blurSeen[next]) continue;
      if ((segmentation.labels[next] ?? TRANSPARENT) !== label) continue;
      const nx = next % width;
      if (Math.abs(nx - x) + Math.abs(Math.floor(next / width) - y) !== 1) continue;
      blurSeen[next] = 1;
      stack.push(next);
    }
  }
  if (inBand < pixels.length * 0.8 || pixels.length < 6 || pixels.length > 5000) continue;
  const own = segmentation.palette[label];
  if (!own) continue;
  const ownL = rgbToOklab(own.r, own.g, own.b).l;
  let neighborL = ownL;
  let touches = 0;
  for (const pixel of pixels) {
    const x = pixel % width;
    const y = (pixel - x) / width;
    const neighbors = [pixel - 1, pixel + 1, pixel - width, pixel + width];
    for (const next of neighbors) {
      if (next < 0 || next >= width * height) continue;
      const nx = next % width;
      const ny = Math.floor(next / width);
      if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
      const other = segmentation.labels[next] ?? TRANSPARENT;
      if (other === TRANSPARENT || other === label) continue;
      const color = segmentation.palette[other];
      if (!color) continue;
      neighborL += rgbToOklab(color.r, color.g, color.b).l;
      touches++;
    }
  }
  if (touches === 0) continue;
  const gapL = neighborL / touches - ownL;
  if (gapL > DARK_SURROUND_L && oklabChroma(rgbToOklab(own.r, own.g, own.b)) < 0.04) {
    blurDark++;
    const x0 = pixels[0]! % width;
    const y0 = Math.floor(pixels[0]! / width);
    console.log("blur-dark", pixels.length, "at", x0, y0, "gap", gapL.toFixed(3), own.r + "," + own.g + "," + own.b);
  }
}
console.log("blurDarkComponents", blurDark, "threshold", DARK_SURROUND_L);

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
writeZoom(36, 160, 260, 64, "zoom-title.png");
writeCrop(120, 210, 340, 330, "crop-green.png");
writeCrop(500, 200, 820, 360, "crop-icons.png");
writeZoom(100, 280, 80, 200, "zoom-green-edge-400.png");
writeZoom(530, 210, 330, 330, "zoom-ai-400.png");
writeHeatmap("delta-heatmap.png");
console.log("wrote artifacts");

const cleanStarted = performance.now();
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
const cleanMs = performance.now() - cleanStarted;
const cleanRaster = rasterizeShapes(cleaned.shapes, width, height);
const cleanDeltas: number[] = [];
for (let i = 0; i < width * height; i++) {
  if ((data[i * 4 + 3] ?? 0) < 128) continue;
  const origin = originalLabs[i];
  const alpha = cleanRaster[i * 4 + 3] ?? 0;
  const sample = rgbToCieLab(
    alpha ? (cleanRaster[i * 4] ?? 255) : 255,
    alpha ? (cleanRaster[i * 4 + 1] ?? 255) : 255,
    alpha ? (cleanRaster[i * 4 + 2] ?? 255) : 255
  );
  if (origin) cleanDeltas.push(deltaE76(origin, sample));
}
cleanDeltas.sort((a, b) => a - b);
const cleanMean = cleanDeltas.reduce((sum, value) => sum + value, 0) / Math.max(1, cleanDeltas.length);
const cleanP95 = cleanDeltas[Math.min(cleanDeltas.length - 1, Math.floor(cleanDeltas.length * 0.95))] ?? 0;
console.log(
  "cleanMs",
  cleanMs.toFixed(0),
  "nodes",
  cleaned.nodeCount,
  "subpaths",
  cleaned.subpathCount,
  "fromNodes",
  traced.nodeCount,
  "reduction",
  traced.nodeCount - cleaned.nodeCount,
  "mean",
  cleanMean.toFixed(2),
  "p95",
  cleanP95.toFixed(2)
);
const edgeOptions = {
  preset: "ui" as const,
  smooth: 0.5,
  originalLabels: segmentation.labels,
  coverage: segmentation.coverage,
  partner: segmentation.partner
};
const edgesOff = measureSharedEdges(segmentation, edgeOptions);
const edgesOn = measureSharedEdges(segmentation, { ...edgeOptions, cleanShapes: 0.55, cleanText: false });
console.log(
  "edgesOff",
  edgesOff.edges,
  "median",
  edgesOff.median.toFixed(2),
  "p90",
  edgesOff.p90.toFixed(2),
  "edgesOn",
  edgesOn.edges,
  "median",
  edgesOn.median.toFixed(2),
  "p90",
  edgesOn.p90.toFixed(2)
);
console.log("labelFringe", countFringe(segmentation.labels), "labelChecker", countChecker(segmentation.labels));
console.log(
  "staircaseOff",
  staircaseRatio(traced.shapes).toFixed(4),
  "staircaseOn",
  staircaseRatio(cleaned.shapes).toFixed(4),
  "wobbleOff",
  boundaryWobble(traced.shapes).toFixed(3),
  "wobbleOn",
  boundaryWobble(cleaned.shapes).toFixed(3),
  "deviationOff",
  contourDeviationP95(segmentation, data, traced.shapes).toFixed(3),
  "deviationOn",
  contourDeviationP95(segmentation, data, cleaned.shapes).toFixed(3)
);
writeCleanZoom(traced.shapes, cleaned.shapes, 118, 262, 64, 64, "zoom-squircle-clean-400.png");
writeCleanZoom(traced.shapes, cleaned.shapes, 200, 335, 150, 130, "zoom-a-clean-400.png");
writeCleanZoom(traced.shapes, cleaned.shapes, 660, 310, 140, 120, "zoom-star-clean-400.png");
writeCleanZoom(traced.shapes, cleaned.shapes, 730, 360, 140, 110, "zoom-ai-letters-clean-400.png");
writeCleanZoom(traced.shapes, cleaned.shapes, 174, 208, 64, 52, "zoom-next-clean-400.png");
console.log("wrote clean zooms");

const balloon = makeStripeSample();
const balloonStarted = performance.now();
const balloonSegmentation = segmentImage(balloon.rgba, balloon.width, balloon.height, 8, { preset: "logo" });
const balloonTraced = traceSegmentation(balloonSegmentation, { preset: "logo", smooth: 1.2, upscale: 2 });
const balloonClean = traceSegmentation(balloonSegmentation, { preset: "logo", smooth: 1.2, upscale: 2, cleanShapes: 0.55 });
console.log(
  "balloonMs",
  (performance.now() - balloonStarted).toFixed(0),
  "colors",
  balloonSegmentation.palette.length,
  "paths",
  balloonTraced.pathCount,
  "nodes",
  balloonTraced.nodeCount,
  "cleanNodes",
  balloonClean.nodeCount,
  "cleanPaths",
  balloonClean.pathCount
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

function coreDelta(
  x0: number,
  y0: number,
  boxWidth: number,
  boxHeight: number,
  match: (color: { r: number; g: number; b: number }) => boolean
): { label: number; pixels: number; src: string; pal: string; delta: number } | null {
  const counts = new Map<number, number>();
  for (let y = y0; y < y0 + boxHeight && y < height; y++) {
    for (let x = x0; x < x0 + boxWidth && x < width; x++) {
      const label = segmentation.labels[y * width + x] ?? TRANSPARENT;
      if (label === TRANSPARENT) continue;
      const color = segmentation.palette[label];
      if (!color || !match(color)) continue;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  let label = -1;
  let pixels = 0;
  for (const [index, count] of counts) {
    if (count > pixels) {
      label = index;
      pixels = count;
    }
  }
  const color = segmentation.palette[label];
  if (!color || pixels < 30) return null;
  const samples: number[] = [];
  for (let y = y0 + 1; y < y0 + boxHeight - 1 && y < height - 1; y++) {
    for (let x = x0 + 1; x < x0 + boxWidth - 1 && x < width - 1; x++) {
      const index = y * width + x;
      if (segmentation.labels[index] !== label) continue;
      if (segmentation.labels[index - 1] !== label || segmentation.labels[index + 1] !== label) continue;
      if (segmentation.labels[index - width] !== label || segmentation.labels[index + width] !== label) continue;
      samples.push(index);
    }
  }
  if (samples.length < 20) return null;
  const channel = (shift: number) => {
    const values = samples.map((index) => data[index * 4 + shift] ?? 0).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] ?? 0;
  };
  const core = { r: channel(0), g: channel(1), b: channel(2) };
  return {
    label,
    pixels: samples.length,
    src: core.r + "," + core.g + "," + core.b,
    pal: color.r + "," + color.g + "," + color.b,
    delta: deltaE76(rgbToCieLab(core.r, core.g, core.b), rgbToCieLab(color.r, color.g, color.b))
  };
}

function heatColor(delta: number): [number, number, number] {
  const t = Math.min(1, Math.max(0, delta / 18));
  if (t < 0.35) {
    const u = t / 0.35;
    return [Math.round(30 + 210 * u), Math.round(150 + 40 * u), 48];
  }
  const u = (t - 0.35) / 0.65;
  return [220, Math.round(170 * (1 - u)), 36];
}

function writeHeatmap(name: string): void {
  const cell = 16;
  const image = new Uint8Array(width * height * 4);
  const worst: { x: number; y: number; delta: number; n: number }[] = [];
  for (let y0 = 0; y0 < height; y0 += cell) {
    for (let x0 = 0; x0 < width; x0 += cell) {
      let sum = 0;
      let n = 0;
      const y1 = Math.min(height, y0 + cell);
      const x1 = Math.min(width, x0 + cell);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const index = y * width + x;
          if ((data[index * 4 + 3] ?? 0) < 128) continue;
          const origin = originalLabs[index];
          const sample = renderedLabs[index];
          if (!origin || !sample) continue;
          sum += deltaE76(origin, sample);
          n++;
        }
      }
      const delta = n ? sum / n : 0;
      if (n > 0) worst.push({ x: x0, y: y0, delta, n });
      const [red, green, blue] = heatColor(delta);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const to = (y * width + x) * 4;
          image[to] = red;
          image[to + 1] = green;
          image[to + 2] = blue;
          image[to + 3] = 255;
        }
      }
    }
  }
  worst.sort((a, b) => b.delta - a.delta);
  console.log(
    "heatmapWorst",
    worst
      .slice(0, 6)
      .map((entry) => entry.x + "," + entry.y + " dE " + entry.delta.toFixed(1))
      .join(" | ")
  );
  fs.writeFileSync("/opt/cursor/artifacts/" + name, encodePng(width, height, image));
}

function countChecker(labels: Uint16Array): number {
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = y * width + x;
      const label = labels[index] ?? TRANSPARENT;
      if (label === TRANSPARENT) continue;
      const neighbors = [index - 1, index + 1, index - width, index + width];
      if (neighbors.every((neighbor) => (labels[neighbor] ?? TRANSPARENT) !== label)) count++;
    }
  }
  return count;
}

function countFringe(labels: Uint16Array): number {
  const core = new Uint8Array(labels.length);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = y * width + x;
      const label = labels[index] ?? TRANSPARENT;
      if (
        label !== TRANSPARENT &&
        labels[index - 1] === label &&
        labels[index + 1] === label &&
        labels[index - width] === label &&
        labels[index + width] === label
      ) {
        core[index] = 1;
      }
    }
  }
  let fringe = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (core[index]) continue;
      const label = labels[index] ?? TRANSPARENT;
      if (label === TRANSPARENT) continue;
      let boundary = false;
      for (const neighbor of [index - 1, index + 1, index - width, index + width]) {
        if (neighbor < 0 || neighbor >= labels.length) continue;
        if (Math.abs((neighbor % width) - x) > 1) continue;
        if ((labels[neighbor] ?? TRANSPARENT) !== label) boundary = true;
      }
      if (!boundary) continue;
      const cores = new Map<number, number>();
      for (let oy = -2; oy <= 2; oy++) {
        const yy = y + oy;
        if (yy < 0 || yy >= height) continue;
        for (let ox = -2; ox <= 2; ox++) {
          const xx = x + ox;
          if (xx < 0 || xx >= width) continue;
          const neighborIndex = yy * width + xx;
          const neighbor = labels[neighborIndex] ?? TRANSPARENT;
          if (neighbor !== TRANSPARENT && core[neighborIndex]) cores.set(neighbor, (cores.get(neighbor) ?? 0) + 1);
        }
      }
      const ranked = [...cores.entries()].sort((left, right) => right[1] - left[1]);
      const first = ranked[0];
      const second = ranked[1];
      if (first && second && label !== first[0] && label !== second[0]) fringe++;
    }
  }
  return fringe;
}

function writeCleanZoom(
  before: typeof traced.shapes,
  after: typeof traced.shapes,
  x0: number,
  y0: number,
  cropWidth: number,
  cropHeight: number,
  name: string
): void {
  const scale = 4;
  const cleanOff = rasterizeWindow(before, x0, y0, cropWidth, cropHeight, scale);
  const cleanOn = rasterizeWindow(after, x0, y0, cropWidth, cropHeight, scale);
  const zoomedWidth = Math.max(1, Math.round(cropWidth * scale));
  const zoomedHeight = Math.max(1, Math.round(cropHeight * scale));
  const panels = 3;
  const image = new Uint8Array(zoomedWidth * panels * zoomedHeight * 4);
  for (let y = 0; y < zoomedHeight; y++) {
    for (let x = 0; x < zoomedWidth; x++) {
      const sx = Math.min(width - 1, x0 + Math.floor(x / scale));
      const sy = Math.min(height - 1, y0 + Math.floor(y / scale));
      const source = (sy * width + sx) * 4;
      const vector = (y * zoomedWidth + x) * 4;
      const row = y * zoomedWidth * panels;
      for (let panel = 0; panel < panels; panel++) {
        const sample = panel === 0 ? data : panel === 1 ? cleanOff : cleanOn;
        const from = panel === 0 ? source : vector;
        const to = (row + panel * zoomedWidth + x) * 4;
        image[to] = sample[from] ?? 0;
        image[to + 1] = sample[from + 1] ?? 0;
        image[to + 2] = sample[from + 2] ?? 0;
        image[to + 3] = 255;
      }
    }
  }
  fs.writeFileSync("/opt/cursor/artifacts/" + name, encodePng(zoomedWidth * panels, zoomedHeight, image));
}

function writeZoom(x0: number, y0: number, cropWidth: number, cropHeight: number, name: string): void {
  const scale = 4;
  const zoomedWidth = cropWidth * scale;
  const zoomedHeight = cropHeight * scale;
  const vector = rasterizeWindow(traced.shapes, x0, y0, cropWidth, cropHeight, scale);
  const image = new Uint8Array(zoomedWidth * 2 * zoomedHeight * 4);
  for (let y = 0; y < zoomedHeight; y++) {
    for (let x = 0; x < zoomedWidth; x++) {
      const sx = Math.min(width - 1, x0 + Math.floor(x / scale));
      const sy = Math.min(height - 1, y0 + Math.floor(y / scale));
      const from = (sy * width + sx) * 4;
      const left = (y * zoomedWidth * 2 + x) * 4;
      const right = (y * zoomedWidth * 2 + zoomedWidth + x) * 4;
      image[left] = data[from] ?? 0;
      image[left + 1] = data[from + 1] ?? 0;
      image[left + 2] = data[from + 2] ?? 0;
      image[left + 3] = 255;
      image[right] = vector[(y * zoomedWidth + x) * 4] ?? 0;
      image[right + 1] = vector[(y * zoomedWidth + x) * 4 + 1] ?? 0;
      image[right + 2] = vector[(y * zoomedWidth + x) * 4 + 2] ?? 0;
      image[right + 3] = 255;
    }
  }
  fs.writeFileSync("/opt/cursor/artifacts/" + name, encodePng(zoomedWidth * 2, zoomedHeight, image));
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
