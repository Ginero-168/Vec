import assert from "node:assert/strict";
import { test } from "node:test";
import { dropCanvasBackground, dropFill, fitShapes, groupPathsByFill, holeNote, scoreSvg, sealGaps, shapeNote } from "./score.ts";

const tracedLogo = `<?xml version="1.0" encoding="UTF-8"?>
<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="320" height="240">
<path d="M0,240c106.67,0,213.33,0,320,0c0-80,0-160,0-240C213.33,0,106.67,0,0,0C0,80,0,160,0,240ZM62,76c3.74-11.46,13.59-18.86,24-24c51.53-25.45,97.78,30.11,70.89,78.73c-4.48,8.11-13.9,14.32-21.89,18.27c-37.13,18.34-78.91-7-79.25-48.92C55.68,92.14,56.98,82.42,62,76ZM175,176c0-40.33,0-80.67,0-121c32,0,64,0,96,0c0,40.33,0,80.67,0,121c-32,0-64,0-96,0Zm-37,34c-6.9,2.16-27.66,2.95-34.62,.83C99.59,209.68,40.75,172.37,40,171c-.97-1.78-.1-8.74,0-11c4.95-.14,13.12-1.33,17.69,.05C63.7,161.87,72.38,169.44,78,173c18.93,11.97,39.88,27.66,60,37Z" fill="#FFFFFF"/>
<path d="M62,76c-5.02,6.42-6.32,16.14-6.25,24.08C56.09,142,97.87,167.34,135,149c7.99-3.95,17.41-10.16,21.89-18.27C183.78,82.11,137.53,26.55,86,52C75.59,57.14,65.74,64.54,62,76Z" fill="#D6363E"/>
<path d="M175,176c0-40.33,0-80.67,0-121c32,0,64,0,96,0c0,40.33,0,80.67,0,121c-32,0-64,0-96,0Z" fill="#2E66D6"/>
<path d="M138,210c-20.12-9.34-41.07-25.03-60-37c-5.62-3.56-14.3-11.13-20.31-12.95c-4.57-1.38-12.74-.19-17.69-.05c-.1,2.26-.97,9.22,0,11c.75,1.37,59.59,38.68,63.38,39.83c6.96,2.12,27.72,1.33,34.62-.83Z" fill="#F2B830"/>
</svg>`;

test("a closed rectangle is four anchors and no hole", () => {
  const facts = scoreSvg('<svg><path d="M0,0 H10 V10 H0 Z" fill="#000"/></svg>');
  assert.deepEqual(facts, { paths: 1, anchors: 4, holes: 0, colors: 1, palette: ["#000000"], circles: 0, ellipses: 0, rects: 0, roundRects: 0 });
});

test("an opposite winding ring inside a shape is one hole", () => {
  const facts = scoreSvg('<svg><path d="M0,0 H10 V10 H0 Z M2,2 V8 H8 V2 Z" fill="black"/></svg>');
  assert.equal(facts.holes, 1);
  assert.equal(facts.anchors, 8);
  assert.equal(holeNote(facts.holes), "มีรู 1 จุด");
});

test("a same-winding island is not a hole", () => {
  const facts = scoreSvg('<svg><path d="M0,0 H10 V10 H0 Z M2,2 H8 V8 H2 Z" fill="#abc"/></svg>');
  assert.equal(facts.holes, 0);
  assert.equal(facts.colors, 1);
  assert.equal(holeNote(0), null);
});

test("shorthand fills and style fills count as colors", () => {
  const facts = scoreSvg('<svg><path d="M0,0 H1 V1 Z" fill="#fff"/><path d="M2,2 H3 V3 Z" style="fill:#0F0;stroke:none"/></svg>');
  assert.equal(facts.paths, 2);
  assert.equal(facts.colors, 2);
  assert.deepEqual(facts.palette, ["#ffffff", "#00ff00"]);
});

test("the traced logo reports paths, anchors, holes, and colors", () => {
  const facts = scoreSvg(tracedLogo);
  assert.deepEqual(facts, {
    paths: 4,
    anchors: 34,
    holes: 3,
    colors: 4,
    palette: ["#ffffff", "#d6363e", "#2e66d6", "#f2b830"],
    circles: 0,
    ellipses: 0,
    rects: 0,
    roundRects: 0
  });
  assert.equal(holeNote(facts.holes), "มีรู 3 จุด");
});

test("a full-canvas plate is removed and the mark is grouped by fill", () => {
  const cleaned = groupPathsByFill(dropCanvasBackground(tracedLogo, "#ffffff"));
  const facts = scoreSvg(cleaned);
  assert.equal(facts.paths, 3);
  assert.equal(facts.holes, 0);
  assert.deepEqual(facts.palette, ["#d6363e", "#2e66d6", "#f2b830"]);
  assert.equal(cleaned.includes("#FFFFFF"), false);
  assert.equal(cleaned.includes('id="color-d6363e"'), true);
  assert.equal(cleaned.includes('id="color-2e66d6"'), true);
  assert.equal(cleaned.includes('id="color-f2b830"'), true);
});

test("the only path is kept even when it covers the canvas", () => {
  const svg = '<svg width="10" height="10"><path d="M0,0 H10 V10 H0 Z" fill="#fff"/></svg>';
  assert.equal(dropCanvasBackground(svg), svg);
});

test("shapes that do not cover the canvas stay put", () => {
  const svg = '<svg width="100" height="100"><path d="M0,0 H10 V10 H0 Z" fill="#fff"/><path d="M20,20 H30 V30 H20 Z" fill="#000"/></svg>';
  assert.equal(dropCanvasBackground(svg, "#ffffff"), svg);
});

test("a green disc that spans a white canvas is kept and the white plate is removed", () => {
  const svg = '<svg width="24" height="24"><rect x="0" y="0" width="24" height="24" fill="#ffffff"/><circle cx="12" cy="12" r="12" fill="#1ed760"/></svg>';
  const dropped = dropCanvasBackground(svg, "#ffffff");
  assert.equal(dropped.toLowerCase().includes("#ffffff"), false);
  assert.equal(dropped.toLowerCase().includes("#1ed760"), true);
  assert.equal(dropCanvasBackground(svg, null), svg);
});

test("a tight icon body is kept unless it touches several edges in the border color", () => {
  const body = '<svg width="64" height="64"><path d="M2,2 H62 V62 H2 Z" fill="#b6f27a"/><path d="M20,20 H30 V40 H20 Z" fill="#222222"/></svg>';
  assert.equal(dropCanvasBackground(body, "#222222"), body);
  const plate = '<svg width="64" height="64"><path d="M0,0 H64 V64 H0 Z" fill="#222222"/><path d="M20,20 H30 V40 H20 Z" fill="#b6f27a"/></svg>';
  const dropped = dropCanvasBackground(plate, "#222222");
  assert.equal(dropped.includes("#222222"), false);
  assert.equal(dropped.includes("#b6f27a"), true);
  const fullBleed = '<svg width="64" height="64"><path d="M0,0 H64 V64 H0 Z" fill="#b6f27a"/><path d="M20,20 H30 V40 H20 Z" fill="#111111"/></svg>';
  assert.equal(dropCanvasBackground(fullBleed, "#222222").includes("#b6f27a"), true);
});

test("overlapping stacked fills are not regrouped", () => {
  const svg = '<svg width="10" height="10"><path d="M0,0 H10 V10 H0 Z" fill="#ff0000"/><path d="M2,2 H8 V8 H2 Z" fill="#00ff00"/></svg>';
  assert.equal(groupPathsByFill(svg), svg);
});

test("separate shapes of the same fill share one group in paint order", () => {
  const svg = '<svg width="100" height="20"><path d="M0,0 H10 V10 H0 Z" fill="#ff0000"/><path d="M40,0 H50 V10 H40 Z" fill="#00ff00"/><path d="M12,0 H22 V10 H12 Z" fill="#ff0000"/></svg>';
  const grouped = groupPathsByFill(svg);
  assert.equal(grouped.includes("<g"), true);
  const red = /<g id="color-ff0000">([\s\S]*?)<\/g>/.exec(grouped);
  assert.equal(red?.[1]?.includes("M0,0"), true);
  assert.equal(red?.[1]?.includes("M12,0"), true);
  assert.equal(grouped.indexOf("color-ff0000") < grouped.indexOf("color-00ff00"), true);
});

function circlePath(cx: number, cy: number, radius: number): string {
  const handle = radius * 0.5522847498;
  const n = (value: number): string => String(Math.round(value * 100) / 100);
  return "M" + n(cx + radius) + "," + n(cy)
    + "C" + n(cx + radius) + "," + n(cy + handle) + " " + n(cx + handle) + "," + n(cy + radius) + " " + n(cx) + "," + n(cy + radius)
    + "C" + n(cx - handle) + "," + n(cy + radius) + " " + n(cx - radius) + "," + n(cy + handle) + " " + n(cx - radius) + "," + n(cy)
    + "C" + n(cx - radius) + "," + n(cy - handle) + " " + n(cx - handle) + "," + n(cy - radius) + " " + n(cx) + "," + n(cy - radius)
    + "C" + n(cx + handle) + "," + n(cy - radius) + " " + n(cx + radius) + "," + n(cy - handle) + " " + n(cx + radius) + "," + n(cy) + "Z";
}

test("a traced circle and rectangle become real shapes with fewer anchors", () => {
  const svg = '<svg width="220" height="120"><path d="' + circlePath(60, 60, 40) + '" fill="#e11d48"/><path d="M120,20 H200 V80 H120 Z" fill="#2563eb"/></svg>';
  const fitted = fitShapes(svg);
  assert.match(fitted, /<circle /);
  assert.match(fitted, /<rect /);
  const facts = scoreSvg(fitted);
  assert.equal(facts.circles, 1);
  assert.equal(facts.rects, 1);
  assert.equal(facts.paths, 2);
  assert.equal(facts.anchors, 8);
  assert.equal(shapeNote(facts), "วงกลม 1 · สี่เหลี่ยม 1");
  const circle = /<circle\b[^>]*r="([^"]+)"/.exec(fitted);
  assert.ok(Math.abs(Number(circle?.[1]) - 40) < 0.6);
});

test("a wide oval becomes an ellipse", () => {
  const kx = 50 * 0.5522847498;
  const ky = 24 * 0.5522847498;
  const n = (value: number): string => String(Math.round(value * 100) / 100);
  const d = "M" + n(130) + "," + n(40)
    + "C" + n(130) + "," + n(40 + ky) + " " + n(80 + kx) + "," + n(64) + " " + n(80) + "," + n(64)
    + "C" + n(80 - kx) + "," + n(64) + " " + n(30) + "," + n(40 + ky) + " " + n(30) + "," + n(40)
    + "C" + n(30) + "," + n(40 - ky) + " " + n(80 - kx) + "," + n(16) + " " + n(80) + "," + n(16)
    + "C" + n(80 + kx) + "," + n(16) + " " + n(130) + "," + n(40 - ky) + " " + n(130) + "," + n(40) + "Z";
  const fitted = fitShapes('<svg width="160" height="80"><path d="' + d + '" fill="#16a34a"/></svg>');
  assert.match(fitted, /<ellipse /);
  assert.equal(scoreSvg(fitted).ellipses, 1);
});

function roundRectPath(x: number, y: number, width: number, height: number, radius: number): string {
  const k = radius * 0.5522847498;
  const n = (value: number): string => String(Math.round(value * 100) / 100);
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
    + "C" + n(x) + "," + n(y + radius - k) + " " + n(x + radius - k) + "," + n(y) + " " + n(x + radius) + "," + n(y)
    + "Z";
}

test("a rounded rectangle becomes a rect with corner radii", () => {
  const fitted = fitShapes('<svg width="120" height="80"><path d="' + roundRectPath(10, 8, 100, 60, 12) + '" fill="#d6363e"/></svg>');
  assert.match(fitted, /<rect /);
  assert.equal(fitted.includes("<path"), false);
  const facts = scoreSvg(fitted);
  assert.equal(facts.rects, 1);
  assert.equal(facts.roundRects, 1);
  assert.equal(shapeNote(facts), "สี่เหลี่ยมมุมมน 1");
  const radius = /rx="([^"]+)"/.exec(fitted);
  assert.ok(Math.abs(Number(radius?.[1]) - 12) < 1);
});

test("an L-shaped path is left as a path", () => {
  const svg = '<svg width="80" height="80"><path d="M5,5 H40 V20 H20 V50 H5 Z" fill="#111"/></svg>';
  const fitted = fitShapes(svg);
  assert.equal(fitted.includes("<path"), true);
  assert.equal(fitted.includes("<rect"), false);
  assert.equal(fitted.includes("<ellipse"), false);
  assert.equal(fitted.includes("<circle"), false);
});

test("gap strokes use the shape fill and a punched color can be removed", () => {
  const sealed = sealGaps('<svg><circle cx="1" cy="2" r="3" fill="#abc"/></svg>');
  assert.match(sealed, /stroke="#abc"/);
  assert.match(sealed, /stroke-width="0.8"/);
  assert.match(sealGaps('<svg><path d="M0,0 H2 V2 Z" fill="#abc"/></svg>', 2), /stroke-width="2"/);
  const svg = '<svg width="20" height="20"><rect x="0" y="0" width="20" height="20" fill="#ff00ff"/><circle cx="5" cy="5" r="2" fill="#111"/></svg>';
  const dropped = dropFill(svg, "#ff00ff");
  assert.equal(dropped.includes("#ff00ff"), false);
  assert.equal(dropped.includes("<circle"), true);
});
