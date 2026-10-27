import assert from "node:assert/strict";
import { test } from "node:test";
import type { RGB } from "./color.ts";
import { traceSharedBoundary } from "./shared-boundary.ts";
import { encodeRgbaPng } from "./png-alpha.ts";
import { traceRaster } from "./trace-pipeline.ts";
import { presetDefaults } from "./trace.ts";

test("two regions reuse one boundary and a 50% ramp moves it", () => {
  const width = 8;
  const height = 4;
  const labels = new Uint8Array(width * height);
  const source = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      labels[y * width + x] = x < 4 ? 0 : 1;
      const red = x < 2 ? 255 : x === 2 ? 210 : x === 3 ? 170 : x === 4 ? 40 : 0;
      const blue = x < 2 ? 0 : x === 2 ? 20 : x === 3 ? 50 : x === 4 ? 230 : 255;
      const offset = (y * width + x) * 4;
      source[offset] = red;
      source[offset + 1] = 0;
      source[offset + 2] = blue;
      source[offset + 3] = 255;
    }
  }
  const svg = traceSharedBoundary({
    labels,
    labelWidth: width,
    labelHeight: height,
    colors: [rgb(220, 0, 0), rgb(0, 0, 220)],
    source,
    sourceWidth: width,
    sourceHeight: height,
    scale: 1,
    tolerance: 0.2,
    cornerDegrees: 40
  });
  const paths = pathFills(svg);
  assert.equal(paths.length, 2);
  const right = new Set(coordinates(paths[1]?.d ?? "").map((point) => point.x.toFixed(3) + "," + point.y.toFixed(3)));
  const shared = coordinates(paths[0]?.d ?? "").filter((point) => right.has(point.x.toFixed(3) + "," + point.y.toFixed(3)) && point.y > 0.2 && point.y < height - 0.2);
  assert.ok(shared.length >= 2);
  const mid = shared.reduce((sum, point) => sum + point.x, 0) / shared.length;
  assert.ok(mid > 3.2 && mid < 3.6, "boundary x " + mid.toFixed(3));
});

test("three colors meet at one vertex", () => {
  const width = 4;
  const height = 4;
  const labels = new Uint8Array([0, 0, 1, 1, 0, 0, 1, 1, 2, 2, 1, 1, 2, 2, 1, 1]);
  const source = new Uint8Array(width * height * 4);
  const paints = [rgb(200, 30, 30), rgb(30, 30, 200), rgb(30, 180, 40)];
  for (let index = 0; index < labels.length; index += 1) {
    const color = paints[labels[index] ?? 0] ?? rgb(0, 0, 0);
    source[index * 4] = color.r;
    source[index * 4 + 1] = color.g;
    source[index * 4 + 2] = color.b;
    source[index * 4 + 3] = 255;
  }
  const svg = traceSharedBoundary({
    labels,
    labelWidth: width,
    labelHeight: height,
    colors: paints,
    source,
    sourceWidth: width,
    sourceHeight: height,
    scale: 1,
    tolerance: 0.15,
    cornerDegrees: 50
  });
  const paths = pathFills(svg);
  assert.equal(new Set(paths.map((path) => path.fill)).size, 3);
  const sets = paths.map((path) => new Set(coordinates(path.d).map((point) => point.x.toFixed(3) + "," + point.y.toFixed(3))));
  const first = sets[0] ?? new Set<string>();
  const common = [...first].filter((point) => sets.every((set) => set.has(point)));
  assert.ok(common.length >= 1);
});

test("a stripe that touches three edges is not dropped as the backdrop", () => {
  const width = 8;
  const height = 8;
  const labels = new Uint8Array(width * height);
  const source = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const label = y < 3 ? 0 : 1;
      labels[y * width + x] = label;
      const color = label === 0 ? rgb(220, 32, 40) : rgb(32, 90, 180);
      const offset = (y * width + x) * 4;
      source[offset] = color.r;
      source[offset + 1] = color.g;
      source[offset + 2] = color.b;
      source[offset + 3] = 255;
    }
  }
  const svg = traceSharedBoundary({
    labels,
    labelWidth: width,
    labelHeight: height,
    colors: [rgb(220, 32, 40), rgb(32, 90, 180)],
    source,
    sourceWidth: width,
    sourceHeight: height,
    scale: 1,
    omitFill: "#dc2028",
    tolerance: 0.2,
    cornerDegrees: 40
  });
  const fills = new Set(pathFills(svg).map((path) => path.fill));
  assert.ok(fills.has("#dc2028"));
  assert.ok(fills.has("#205ab4"));
});

test("a hole reuses the inner region's curve", () => {
  const width = 6;
  const height = 6;
  const labels = new Uint8Array(width * height);
  const source = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inner = x >= 2 && x <= 3 && y >= 2 && y <= 3;
      labels[y * width + x] = inner ? 1 : 0;
      const offset = (y * width + x) * 4;
      source[offset] = inner ? 20 : 220;
      source[offset + 1] = inner ? 20 : 40;
      source[offset + 2] = inner ? 20 : 40;
      source[offset + 3] = 255;
    }
  }
  const svg = traceSharedBoundary({
    labels,
    labelWidth: width,
    labelHeight: height,
    colors: [rgb(220, 40, 40), rgb(20, 20, 20)],
    source,
    sourceWidth: width,
    sourceHeight: height,
    scale: 1,
    tolerance: 0.15,
    cornerDegrees: 40
  });
  const paths = pathFills(svg);
  const outer = paths.find((path) => path.fill === "#dc2828");
  const inner = paths.find((path) => path.fill === "#141414");
  assert.ok(outer !== undefined && inner !== undefined);
  assert.ok((outer?.d.match(/Z/g) ?? []).length >= 2);
  for (const point of coordinates(inner?.d ?? "")) {
    assert.ok((outer?.d ?? "").includes(point.x.toFixed(3).replace(/\.?0+$/, "") === "" ? String(point.x) : formatLike(point.x)));
  }
  const innerPoints = coordinates(inner?.d ?? "");
  assert.ok(innerPoints.length >= 4);
  assert.ok(innerPoints.every((point) => (outer?.d ?? "").includes(String(point.x)) && (outer?.d ?? "").includes(String(point.y))));
});

test("logo tracing does not call VTracer and keeps the shared edge", () => {
  const width = 16;
  const height = 12;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const left = x < 8;
      rgba[offset] = left ? 210 : 20;
      rgba[offset + 1] = 30;
      rgba[offset + 2] = left ? 30 : 200;
      rgba[offset + 3] = 255;
    }
  }
  const settings = { preset: "logo" as const, ...presetDefaults("logo"), removeBackground: false };
  const svg = traceRaster(encodeRgbaPng(width, height, rgba), settings, () => {
    throw new Error("vtracer");
  });
  assert.ok(svg !== null);
  const paths = pathFills(svg ?? "");
  assert.ok(paths.length >= 2);
  assert.ok(sharedNumbers(paths[0]?.d ?? "", paths[1]?.d ?? "").length >= 4);
});

function rgb(r: number, g: number, b: number): RGB {
  return { r, g, b };
}

function pathFills(svg: string): { readonly fill: string; readonly d: string }[] {
  const found: { fill: string; d: string }[] = [];
  for (const match of svg.matchAll(/<path\b[^>]*\/>/g)) {
    const tag = match[0] ?? "";
    const fill = /fill="([^"]+)"/.exec(tag)?.[1] ?? "";
    const d = /d="([^"]+)"/.exec(tag)?.[1] ?? "";
    found.push({ fill, d });
  }
  return found;
}

function coordinates(data: string): { readonly x: number; readonly y: number }[] {
  const numbers = data.match(/[-+]?(?:\d*\.\d+|\d+)/g)?.map(Number) ?? [];
  const points: { x: number; y: number }[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) points.push({ x: numbers[index] ?? 0, y: numbers[index + 1] ?? 0 });
  return points;
}

function sharedNumbers(left: string, right: string): number[] {
  const rightText = right;
  return (left.match(/[-+]?(?:\d*\.\d+|\d+)/g) ?? []).map(Number).filter((value) => rightText.includes(String(value)));
}

function formatLike(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded);
}
