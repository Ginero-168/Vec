import assert from "node:assert/strict";
import { test } from "node:test";
import { scoreSvg } from "./score.ts";
import { fitAppIconSquircle } from "./squircle.ts";
import { fittedPlan, styledTraceSvg, type PipelineSettings, type TracePlan } from "./trace-pipeline.ts";

type Point = { readonly x: number; readonly y: number };
type Cubic = { readonly p0: Point; readonly p1: Point; readonly p2: Point; readonly p3: Point };

// Apple HIG describes the system rounded-rectangle mask but publishes no equation.
// The synthetic reference is the Lamé curve |x/r|^5 + |y/r|^5 = 1.
const REFERENCE_EXPONENT = 5;

test("a raster traced at 256 pixels is fitted to the continuous-corner reference", () => {
  const { source, center, radius } = fitRasterFrame(256);
  const output = fitAppIconSquircle(source);
  assertFrameQuality(output, 256, center, radius, 0.25);
});

test("a raster traced at 64 pixels keeps subpixel mean frame error", () => {
  const { source, center, radius } = fitRasterFrame(64);
  const output = fitAppIconSquircle(source);
  assertFrameQuality(output, 64, center, radius, 0.5);
});

test("the Illustrator icon styling path applies the squircle fit after tracing", () => {
  const source = svgForPath(polylineSquircle(128, 64, 64, 48, REFERENCE_EXPONENT), 128);
  const plan: TracePlan = {
    width: 128,
    height: 128,
    droppedColor: null,
    plates: [{
      png: Buffer.alloc(0),
      scale: 1,
      originX: 0,
      originY: 0,
      borderColor: null,
      request: { preset: "icon", maxColors: 0, smoothness: 0, removeBackground: true, stacking: "stacked" }
    }]
  };
  const settings: PipelineSettings = {
    preset: "icon",
    maxColors: 0,
    smoothness: 0,
    corner: 0,
    removeBackground: true,
    stacking: "stacked"
  };
  const fitted = fittedPlan([source], plan, false, "icon");
  const output = styledTraceSvg(fitted, settings);
  assert.equal((output.match(/<path\b/gi) ?? []).length, 1);
  assert.equal((output.match(/C/g) ?? []).length, 8, output.slice(0, 300));
  assert.equal(output.includes("data-vec-squircle-fit"), false);
  assert.match(output, /Z(?:"|')/);
});

test("rounded rectangles, circles, and plain rectangles stay unchanged", () => {
  const decoys = [
    svgForPath(roundedRectangle(20, 20, 216, 216, 44), 256),
    svgForPath(circlePath(128, 128, 108), 256),
    svgForPath("M20,20 H236 V236 H20 Z", 256)
  ];
  for (const svg of decoys) assert.equal(fitAppIconSquircle(svg), svg);
});

test("a larger rectangular plate prevents fitting a smaller squircle detail", () => {
  const detail = polylineSquircle(128, 128, 128, 54, REFERENCE_EXPONENT);
  const svg = '<svg width="256" height="256" viewBox="0 0 256 256"><rect x="0" y="0" width="256" height="256" fill="#fff"/><path fill="#f00" d="' + detail + '"/></svg>';
  assert.equal(fitAppIconSquircle(svg), svg);
});

function assertFrameQuality(svg: string, size: number, center: Point, radius: number, meanLimit: number): void {
  const paths = [...svg.matchAll(/<path\b[^>]*>/gi)];
  assert.equal(paths.length, 1);
  const facts = scoreSvg(svg);
  assert.equal(facts.paths, 1);
  assert.ok(facts.anchors <= 12);
  const d = /\bd\s*=\s*(["'])([\s\S]*?)\1/i.exec(paths[0]?.[0] ?? "")?.[2];
  assert.ok(d !== undefined);
  const cubics = parseOutputPath(d);
  assert.equal(cubics.length, 8);
  assert.equal(/Z\s*$/i.test(d), true);
  assertControlsSymmetric(cubics, center);
  assertG2Joins(cubics);

  const boundary = Array.from({ length: 8192 }, (_, index) => squirclePoint(center, radius, REFERENCE_EXPONENT, 2 * Math.PI * index / 8192));
  const outputBoundary = cubics.flatMap((cubic) => Array.from({ length: 64 }, (_, index) => bezier(cubic, index / 64)));
  const errors = [
    ...outputBoundary.map((point) => distanceToPolyline(point, boundary)),
    ...boundary.map((point) => distanceToPolyline(point, outputBoundary))
  ];
  const mean = errors.reduce((sum, error) => sum + error, 0) / errors.length;
  const maximum = Math.max(...errors);
  assert.ok(mean <= meanLimit, `mean edge distance ${mean.toFixed(4)} exceeds ${meanLimit}`);
  assert.ok(maximum <= 1, `maximum edge distance ${maximum.toFixed(4)} exceeds 1px`);
  const iou = frameIoU(cubics, size, center, radius);
  assert.ok(iou >= 0.995, `IoU ${iou.toFixed(6)} is below 0.995 (mean ${mean.toFixed(4)}, max ${maximum.toFixed(4)})`);
}

function fitRasterFrame(size: number): { readonly source: string; readonly center: Point; readonly radius: number } {
  const center = { x: size / 2, y: size / 2 };
  const radius = size * 0.43;
  const raster = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = Math.abs((x + 0.5 - center.x) / radius);
      const ny = Math.abs((y + 0.5 - center.y) / radius);
      if (nx ** REFERENCE_EXPONENT + ny ** REFERENCE_EXPONENT <= 1) raster[y * size + x] = 1;
    }
  }
  const pathPoints: Point[] = [];
  const rays = size * 8;
  const contains = (x: number, y: number): boolean => {
    const px = Math.floor(x);
    const py = Math.floor(y);
    return px >= 0 && py >= 0 && px < size && py < size && raster[py * size + px] === 1;
  };
  for (let index = 0; index < rays; index += 1) {
    const angle = 2 * Math.PI * index / rays;
    let inside = 0;
    let outside = size;
    for (let step = 0; step < 18; step += 1) {
      const middle = (inside + outside) / 2;
      if (contains(center.x + middle * Math.cos(angle), center.y + middle * Math.sin(angle))) inside = middle;
      else outside = middle;
    }
    const edge = (inside + outside) / 2;
    pathPoints.push({ x: center.x + edge * Math.cos(angle), y: center.y + edge * Math.sin(angle) });
  }
  const d = "M" + format(pathPoints[0]?.x ?? center.x) + "," + format(pathPoints[0]?.y ?? center.y)
    + pathPoints.slice(1).map((point) => "L" + format(point.x) + "," + format(point.y)).join("") + "Z";
  return { source: svgForPath(d, size), center, radius };
}

function polylineSquircle(size: number, cx: number, cy: number, radius: number, exponent: number): string {
  const count = size * 4;
  const points = Array.from({ length: count }, (_, index) => squirclePoint({ x: cx, y: cy }, radius, exponent, 2 * Math.PI * index / count));
  return "M" + format(points[0]?.x ?? cx + radius) + "," + format(points[0]?.y ?? cy)
    + points.slice(1).map((point) => "L" + format(point.x) + "," + format(point.y)).join("") + "Z";
}

function squirclePoint(center: Point, radius: number, exponent: number, angle: number): Point {
  const power = 2 / exponent;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: center.x + radius * Math.sign(cosine) * Math.abs(cosine) ** power,
    y: center.y + radius * Math.sign(sine) * Math.abs(sine) ** power
  };
}

function roundedRectangle(x: number, y: number, width: number, height: number, radius: number): string {
  const k = radius * 0.5522847498;
  const right = x + width;
  const bottom = y + height;
  return "M" + format(x + radius) + "," + format(y)
    + "H" + format(right - radius)
    + "C" + format(right - radius + k) + "," + format(y) + " " + format(right) + "," + format(y + radius - k) + " " + format(right) + "," + format(y + radius)
    + "V" + format(bottom - radius)
    + "C" + format(right) + "," + format(bottom - radius + k) + " " + format(right - radius + k) + "," + format(bottom) + " " + format(right - radius) + "," + format(bottom)
    + "H" + format(x + radius)
    + "C" + format(x + radius - k) + "," + format(bottom) + " " + format(x) + "," + format(bottom - radius + k) + " " + format(x) + "," + format(bottom - radius)
    + "V" + format(y + radius)
    + "C" + format(x) + "," + format(y + radius - k) + " " + format(x + radius - k) + "," + format(y) + " " + format(x + radius) + "," + format(y) + "Z";
}

function circlePath(cx: number, cy: number, radius: number): string {
  const handle = radius * 0.5522847498;
  return "M" + format(cx + radius) + "," + format(cy)
    + "C" + format(cx + radius) + "," + format(cy + handle) + " " + format(cx + handle) + "," + format(cy + radius) + " " + format(cx) + "," + format(cy + radius)
    + "C" + format(cx - handle) + "," + format(cy + radius) + " " + format(cx - radius) + "," + format(cy + handle) + " " + format(cx - radius) + "," + format(cy)
    + "C" + format(cx - radius) + "," + format(cy - handle) + " " + format(cx - handle) + "," + format(cy - radius) + " " + format(cx) + "," + format(cy - radius)
    + "C" + format(cx + handle) + "," + format(cy - radius) + " " + format(cx + radius) + "," + format(cy - handle) + " " + format(cx + radius) + "," + format(cy) + "Z";
}

function svgForPath(d: string, size: number): string {
  return '<svg width="' + String(size) + '" height="' + String(size) + '" viewBox="0 0 ' + String(size) + ' ' + String(size) + '"><path fill="#336699" d="' + d + '"/></svg>';
}

function parseOutputPath(d: string): Cubic[] {
  const tokenPattern = /[MCZ]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/gi;
  const tokens = [...d.matchAll(tokenPattern)].map((match) => match[0] ?? "");
  assert.equal(tokens[0], "M");
  let index = 1;
  const readPoint = (): Point => {
    const x = Number(tokens[index]);
    const y = Number(tokens[index + 1]);
    index += 2;
    return { x, y };
  };
  let current = readPoint();
  const cubics: Cubic[] = [];
  while (index < tokens.length && tokens[index]?.toUpperCase() === "C") {
    index += 1;
    const cubic: Cubic = { p0: current, p1: readPoint(), p2: readPoint(), p3: readPoint() };
    cubics.push(cubic);
    current = cubic.p3;
  }
  assert.equal(tokens[index]?.toUpperCase(), "Z");
  return cubics;
}

function assertControlsSymmetric(cubics: readonly Cubic[], center: Point): void {
  const count = cubics.length;
  for (let index = 0; index < count; index += 1) {
    const horizontal = cubics[(count - 1 - index + count) % count];
    const vertical = cubics[(count / 2 - 1 - index + count) % count];
    const current = cubics[index];
    assert.ok(current !== undefined && horizontal !== undefined && vertical !== undefined);
    assertPointNear(reflectHorizontal(current.p0, center), horizontal.p3, 0.1);
    assertPointNear(reflectHorizontal(current.p1, center), horizontal.p2, 0.1);
    assertPointNear(reflectHorizontal(current.p2, center), horizontal.p1, 0.1);
    assertPointNear(reflectHorizontal(current.p3, center), horizontal.p0, 0.1);
    assertPointNear(reflectVertical(current.p0, center), vertical.p3, 0.1);
    assertPointNear(reflectVertical(current.p1, center), vertical.p2, 0.1);
    assertPointNear(reflectVertical(current.p2, center), vertical.p1, 0.1);
    assertPointNear(reflectVertical(current.p3, center), vertical.p0, 0.1);
  }
}

function assertG2Joins(cubics: readonly Cubic[]): void {
  for (let index = 0; index < cubics.length; index += 1) {
    const previous = cubics[index];
    const next = cubics[(index + 1) % cubics.length];
    assert.ok(previous !== undefined && next !== undefined);
    const incoming = { x: previous.p3.x - previous.p2.x, y: previous.p3.y - previous.p2.y };
    const outgoing = { x: next.p1.x - next.p0.x, y: next.p1.y - next.p0.y };
    const tangentCross = Math.abs(incoming.x * outgoing.y - incoming.y * outgoing.x) / (Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y));
    assert.ok(tangentCross <= 1e-6, `join ${index} has a tangent mismatch ${tangentCross}`);
    assert.ok(Math.abs(curvatureAtEnd(previous) - curvatureAtStart(next)) <= 1e-4, `join ${index} has a curvature mismatch`);
  }
}

function curvatureAtStart(cubic: Cubic): number {
  const first = { x: cubic.p1.x - cubic.p0.x, y: cubic.p1.y - cubic.p0.y };
  const second = { x: cubic.p2.x - 2 * cubic.p1.x + cubic.p0.x, y: cubic.p2.y - 2 * cubic.p1.y + cubic.p0.y };
  return 2 * (first.x * second.y - first.y * second.x) / (3 * Math.hypot(first.x, first.y) ** 3);
}

function curvatureAtEnd(cubic: Cubic): number {
  const first = { x: cubic.p3.x - cubic.p2.x, y: cubic.p3.y - cubic.p2.y };
  const second = { x: cubic.p3.x - 2 * cubic.p2.x + cubic.p1.x, y: cubic.p3.y - 2 * cubic.p2.y + cubic.p1.y };
  return 2 * (first.x * second.y - first.y * second.x) / (3 * Math.hypot(first.x, first.y) ** 3);
}

function frameIoU(cubics: readonly Cubic[], size: number, center: Point, radius: number): number {
  const polygon = cubics.flatMap((cubic) => Array.from({ length: 32 }, (_, index) => bezier(cubic, index / 32)));
  let intersection = 0;
  let union = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const point = { x: x + 0.5, y: y + 0.5 };
      const truth = Math.abs((point.x - center.x) / radius) ** REFERENCE_EXPONENT + Math.abs((point.y - center.y) / radius) ** REFERENCE_EXPONENT <= 1;
      const output = pointInPolygon(point, polygon);
      if (truth || output) union += 1;
      if (truth && output) intersection += 1;
    }
  }
  return union === 0 ? 1 : intersection / union;
}

function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const current = polygon[index];
    const before = polygon[previous];
    if (current === undefined || before === undefined) continue;
    const crosses = (current.y > point.y) !== (before.y > point.y)
      && point.x < ((before.x - current.x) * (point.y - current.y)) / (before.y - current.y) + current.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function distanceToPolyline(point: Point, polyline: readonly Point[]): number {
  let best = Infinity;
  for (let index = 0; index < polyline.length; index += 1) {
    const start = polyline[index];
    const end = polyline[(index + 1) % polyline.length];
    if (start === undefined || end === undefined) continue;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const projection = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
    best = Math.min(best, Math.hypot(point.x - (start.x + projection * dx), point.y - (start.y + projection * dy)));
  }
  return best;
}

function reflectHorizontal(point: Point, center: Point): Point {
  return { x: point.x, y: 2 * center.y - point.y };
}

function reflectVertical(point: Point, center: Point): Point {
  return { x: 2 * center.x - point.x, y: point.y };
}

function assertPointNear(actual: Point, expected: Point, limit: number): void {
  assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) <= limit);
}

function bezier(cubic: Cubic, t: number): Point {
  const u = 1 - t;
  return {
    x: u ** 3 * cubic.p0.x + 3 * u * u * t * cubic.p1.x + 3 * u * t * t * cubic.p2.x + t ** 3 * cubic.p3.x,
    y: u ** 3 * cubic.p0.y + 3 * u * u * t * cubic.p1.y + 3 * u * t * t * cubic.p2.y + t ** 3 * cubic.p3.y
  };
}

function format(value: number): string {
  return String(Math.round(value * 10000) / 10000);
}
