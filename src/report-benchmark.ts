import * as fs from "fs";
import { spawnSync } from "child_process";
import { guidedFilter } from "./color/denoise";
import { deltaE76, rgbToCieLab } from "./color/oklab";
import { decodePng, encodePng } from "./color/png";
import { rasterizeShapes, rasterizeWindow } from "./color/raster";
import { segmentImage } from "./color/segment";
import { boundaryWobble, staircaseRatio, traceSegmentation } from "./color/trace";
import { PRESETS, type PresetName } from "./color/presets";

type Row = {
  name: string;
  preset: string;
  nodes: number;
  deltaMean: number;
  deltaP95: number;
  wobble: number;
  staircase: number;
  ms: number;
  heapMb: number;
  rssMb: number;
  gradients: number;
  note: string;
};

function peakRssMb(): number {
  const status = fs.readFileSync("/proc/self/status", "utf8");
  const line = status.split("\n").find((entry) => entry.startsWith("VmHWM"));
  const kb = Number(line?.split(/\s+/)[1] ?? 0);
  return kb / 1024;
}

const outDir = "/opt/cursor/artifacts";
fs.mkdirSync(outDir + "/bench", { recursive: true });

function deltaStats(source: Uint8Array, rendered: Uint8Array): { mean: number; p95: number } {
  const values: number[] = [];
  const pixels = source.length / 4;
  for (let index = 0; index < pixels; index++) {
    const offset = index * 4;
    if ((source[offset + 3] ?? 0) < 128) continue;
    const origin = rgbToCieLab(source[offset] ?? 0, source[offset + 1] ?? 0, source[offset + 2] ?? 0);
    const paint = rgbToCieLab(rendered[offset] ?? 255, rendered[offset + 1] ?? 255, rendered[offset + 2] ?? 255);
    values.push(deltaE76(origin, paint));
  }
  values.sort((left, right) => left - right);
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const p95 = values[Math.min(values.length - 1, Math.floor(values.length * 0.95))] ?? 0;
  return { mean, p95 };
}

function speckCount(labels: Uint16Array, width: number): number {
  const seen = new Uint8Array(labels.length);
  const height = labels.length / width;
  const stack: number[] = [];
  let specks = 0;
  for (let start = 0; start < labels.length; start++) {
    if (seen[start]) continue;
    const label = labels[start] ?? 0;
    stack.push(start);
    seen[start] = 1;
    let count = 0;
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      count++;
      const x = current % width;
      const y = (current - x) / width;
      const nexts = [x > 0 ? current - 1 : -1, x + 1 < width ? current + 1 : -1, y > 0 ? current - width : -1, y + 1 < height ? current + width : -1];
      for (const next of nexts) {
        if (next < 0 || seen[next] || (labels[next] ?? -1) !== label) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    if (count > 0 && count < 20) specks++;
  }
  return specks;
}

function run(name: string, file: string, preset: PresetName, options: { prefilter?: boolean; gradients?: boolean; note?: string } = {}) {
  const decoded = decodePng(fs.readFileSync(file));
  const source = options.prefilter ? guidedFilter(decoded.data, decoded.width, decoded.height) : decoded.data;
  const before = process.memoryUsage();
  const started = performance.now();
  const segmentation = segmentImage(source, decoded.width, decoded.height, PRESETS[preset].maxColors, { preset });
  const traced = traceSegmentation(segmentation, {
    preset,
    source,
    gradients: options.gradients,
    coverage: segmentation.coverage,
    partner: segmentation.partner
  });
  const ms = performance.now() - started;
  const after = process.memoryUsage();
  const compare = options.prefilter ? source : decoded.data;
  const rendered = rasterizeShapes(traced.shapes, decoded.width, decoded.height);
  const delta = deltaStats(compare, rendered);
  fs.writeFileSync(outDir + "/bench/" + name + ".png", encodePng(decoded.width, decoded.height, rendered));
  fs.writeFileSync(outDir + "/bench/" + name + "-src.png", encodePng(decoded.width, decoded.height, compare));
  const row: Row = {
    name,
    preset,
    nodes: traced.nodeCount,
    deltaMean: delta.mean,
    deltaP95: delta.p95,
    wobble: boundaryWobble(traced.shapes),
    staircase: staircaseRatio(traced.shapes),
    ms,
  heapMb: Math.max(0, after.heapUsed - before.heapUsed) / (1024 * 1024),
  rssMb: peakRssMb(),
    gradients: traced.shapes.filter((shape) => shape.gradient).length,
    note: options.note ?? ""
  };
  process.stdout.write(name + " nodes " + traced.nodeCount + " dE " + delta.mean.toFixed(2) + "/" + delta.p95.toFixed(2) + " " + ms.toFixed(0) + "ms grads " + row.gradients + "\n");
  return { row, traced, segmentation, width: decoded.width, height: decoded.height, source: decoded.data, rendered };
}

const rows: Row[] = [];
rows.push(run("logo-flat", "fixtures/logo-flat.png", "logo", { note: "gradients off" }).row);
rows.push(run("cartoon-line", "fixtures/cartoon-line.png", "illustration", { note: "gradients default on" }).row);
rows.push(run("anime-ink", "fixtures/anime-ink.png", "illustration", { note: "gradients default on" }).row);
rows.push(run("photo-scene", "fixtures/photo-scene.png", "photo", { prefilter: true, note: "gradients and prefilter on" }).row);
rows.push(run("pixel-icon", "fixtures/pixel-icon.png", "icon", { note: "gradients off" }).row);
const jpegOff = run("jpeg-off", "fixtures/jpeg-blocks.png", "photo", { prefilter: false, gradients: false, note: "filter off" });
const jpegOn = run("jpeg-on", "fixtures/jpeg-blocks.png", "photo", { prefilter: true, gradients: false, note: "filter on" });
rows.push(jpegOff.row);
rows.push(jpegOn.row);
const specks = { off: speckCount(jpegOff.segmentation.labels, jpegOff.width), on: speckCount(jpegOn.segmentation.labels, jpegOn.width) };
process.stdout.write("jpeg specks off " + specks.off + " on " + specks.on + "\n");

const screen = run("screen-ui", "fixtures/user-test-original.png", "ui", { note: "cold, gradients off" });
rows.push(screen.row);
const warm = run("screen-ui-warm", "fixtures/user-test-original.png", "ui", { note: "warm, gradients off" });
rows.push(warm.row);
const graded = run("screen-gradients", "fixtures/user-test-original.png", "ui", { gradients: true, note: "gradients on" });
rows.push(graded.row);

function cropPair(name: string, x: number, y: number, w: number, h: number): void {
  const before = rasterizeWindow(screen.traced.shapes, x, y, w, h, 2);
  const after = rasterizeWindow(graded.traced.shapes, x, y, w, h, 2);
  const width = Math.max(1, Math.round(w * 2));
  const height = Math.max(1, Math.round(h * 2));
  const sheet = new Uint8Array(width * 2 * height * 4);
  for (let rowIndex = 0; rowIndex < height; rowIndex++) {
    sheet.set(before.subarray(rowIndex * width * 4, (rowIndex + 1) * width * 4), rowIndex * width * 2 * 4);
    sheet.set(after.subarray(rowIndex * width * 4, (rowIndex + 1) * width * 4), rowIndex * width * 2 * 4 + width * 4);
  }
  fs.writeFileSync(outDir + "/" + name + ".png", encodePng(width * 2, height, sheet));
}

cropPair("gradient-band", 0, 560, screen.width, 89);
cropPair("gradient-a", 200, 335, 150, 130);
cropPair("gradient-icon", 112, 254, 80, 84);

let flatSum = 0;
let gradSum = 0;
let gradCount = 0;
for (let index = 0; index < screen.width * screen.height; index += 2) {
  const label = graded.segmentation.labels[index] ?? 65535;
  const color = graded.segmentation.palette[label];
  if (!color) continue;
  const hit = graded.traced.shapes.some((shape) => shape.gradient && shape.color.r === color.r && shape.color.g === color.g && shape.color.b === color.b);
  if (!hit) continue;
  const offset = index * 4;
  const origin = rgbToCieLab(screen.source[offset] ?? 0, screen.source[offset + 1] ?? 0, screen.source[offset + 2] ?? 0);
  const flat = rgbToCieLab(screen.rendered[offset] ?? 0, screen.rendered[offset + 1] ?? 0, screen.rendered[offset + 2] ?? 0);
  const painted = rgbToCieLab(graded.rendered[offset] ?? 0, graded.rendered[offset + 1] ?? 0, graded.rendered[offset + 2] ?? 0);
  flatSum += deltaE76(origin, flat);
  gradSum += deltaE76(origin, painted);
  gradCount++;
}
const gradientDelta = { count: gradCount, flat: flatSum / Math.max(1, gradCount), graded: gradSum / Math.max(1, gradCount) };
process.stdout.write("gradient region n " + gradCount + " flat " + gradientDelta.flat.toFixed(2) + " graded " + gradientDelta.graded.toFixed(2) + "\n");
process.stdout.write("nodes off " + screen.row.nodes + " on " + graded.row.nodes + "\n");

fs.writeFileSync(outDir + "/benchmark.json", JSON.stringify({ rows, specks, gradientDelta }, null, 2));
const sheet = spawnSync("python3", ["scripts/contact-sheet.py", outDir], { encoding: "utf8" });
process.stdout.write(sheet.stdout || "");
if (sheet.status !== 0) process.stderr.write(sheet.stderr || "contact sheet failed\n");
