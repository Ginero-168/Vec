import assert from "node:assert/strict";
import { test } from "node:test";
import { fitShapes, scoreSvg } from "./score.ts";
import { fittedPlan, styledTraceSvg, type PipelineSettings, type TracePlan } from "./trace-pipeline.ts";

const SIZE = 256;

test("the score fit snaps a measured G2 squircle to the 12-anchor template", () => {
  const fitted = fitShapes(svgForPath(referenceSquircle(16, 16, 224), SIZE));
  assert.match(fitted, /data-vec-shape="squircle"/);
  assert.equal((fitted.match(/C/g) ?? []).length, 8, fitted);
  assert.equal((fitted.match(/L/g) ?? []).length, 4);
  assert.equal(scoreSvg(fitted).anchors, 12);
});

test("the icon trace path keeps the squircle marker through styling", () => {
  const plan: TracePlan = {
    width: SIZE,
    height: SIZE,
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
  const source = svgForPath(referenceSquircle(16, 16, 224), SIZE);
  const fitted = fittedPlan([source], plan, false, "icon");
  const output = styledTraceSvg(fitted, settings);
  assert.match(output, /data-vec-shape="squircle"/);
  assert.equal(scoreSvg(output).anchors, 12);
});

test("circle, sharp rectangle, and circular rounded rectangle are not marked as squircles", () => {
  const decoys = [
    svgForPath(circlePath(128, 128, 108), SIZE),
    svgForPath("M16,16 H240 V240 H16 Z", SIZE),
    svgForPath(roundedRectangle(16, 16, 224, 224, 50.1088), SIZE)
  ];
  for (const svg of decoys) {
    const fitted = fitShapes(svg);
    assert.equal(/data-vec-shape\s*=\s*["']squircle["']/i.test(fitted), false, fitted);
  }
});

function referenceSquircle(x: number, y: number, side: number): string {
  const r = side * 0.2237;
  const a = r * 1.52866498;
  const p = r * 0.89648972;
  const m = r * 0.29214939;
  const right = x + side;
  const bottom = y + side;
  const start = point(x + a, y);
  const commands = [
    cubic(point(x + p, y), point(x + 2 * m, y), point(x + m, y + m)),
    cubic(point(x, y + 2 * m), point(x, y + p), point(x, y + a)),
    "L" + n(x) + "," + n(bottom - a),
    cubic(point(x, bottom - p), point(x, bottom - 2 * m), point(x + m, bottom - m)),
    cubic(point(x + 2 * m, bottom), point(x + p, bottom), point(x + a, bottom)),
    "L" + n(right - a) + "," + n(bottom),
    cubic(point(right - p, bottom), point(right - 2 * m, bottom), point(right - m, bottom - m)),
    cubic(point(right, bottom - 2 * m), point(right, bottom - p), point(right, bottom - a)),
    "L" + n(right) + "," + n(y + a),
    cubic(point(right, y + p), point(right, y + 2 * m), point(right - m, y + m)),
    cubic(point(right - 2 * m, y), point(right - p, y), point(right - a, y)),
    "L" + n(start.x) + "," + n(start.y) + "Z"
  ];
  return "M" + n(start.x) + "," + n(start.y) + commands.join("");
}

function roundedRectangle(x: number, y: number, width: number, height: number, radius: number): string {
  const k = radius * 0.5522847498;
  const right = x + width;
  const bottom = y + height;
  return "M" + n(x + radius) + "," + n(y)
    + "H" + n(right - radius)
    + "C" + n(right - radius + k) + "," + n(y) + " " + n(right) + "," + n(y + radius - k) + " " + n(right) + "," + n(y + radius)
    + "V" + n(bottom - radius)
    + "C" + n(right) + "," + n(bottom - radius + k) + " " + n(right - radius + k) + "," + n(bottom) + " " + n(right - radius) + "," + n(bottom)
    + "H" + n(x + radius)
    + "C" + n(x + radius - k) + "," + n(bottom) + " " + n(x) + "," + n(bottom - radius + k) + " " + n(x) + "," + n(bottom - radius)
    + "V" + n(y + radius)
    + "C" + n(x) + "," + n(y + radius - k) + " " + n(x + radius - k) + "," + n(y) + " " + n(x + radius) + "," + n(y) + "Z";
}

function circlePath(cx: number, cy: number, radius: number): string {
  const handle = radius * 0.5522847498;
  return "M" + n(cx + radius) + "," + n(cy)
    + "C" + n(cx + radius) + "," + n(cy + handle) + " " + n(cx + handle) + "," + n(cy + radius) + " " + n(cx) + "," + n(cy + radius)
    + "C" + n(cx - handle) + "," + n(cy + radius) + " " + n(cx - radius) + "," + n(cy + handle) + " " + n(cx - radius) + "," + n(cy)
    + "C" + n(cx - radius) + "," + n(cy - handle) + " " + n(cx - handle) + "," + n(cy - radius) + " " + n(cx) + "," + n(cy - radius)
    + "C" + n(cx + handle) + "," + n(cy - radius) + " " + n(cx + radius) + "," + n(cy - handle) + " " + n(cx + radius) + "," + n(cy) + "Z";
}

function svgForPath(d: string, size: number): string {
  return '<svg width="' + String(size) + '" height="' + String(size) + '" viewBox="0 0 ' + String(size) + ' ' + String(size) + '"><path fill="#336699" d="' + d + '"/></svg>';
}

function point(x: number, y: number): { readonly x: number; readonly y: number } {
  return { x, y };
}

function cubic(control1: { readonly x: number; readonly y: number }, control2: { readonly x: number; readonly y: number }, end: { readonly x: number; readonly y: number }): string {
  return "C" + n(control1.x) + "," + n(control1.y) + " " + n(control2.x) + "," + n(control2.y) + " " + n(end.x) + "," + n(end.y);
}

function n(value: number): string {
  return String(Math.round(value * 10000) / 10000);
}
