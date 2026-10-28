import assert from "node:assert/strict";
import { test } from "node:test";
import { expandPrimitives, fairPaths, fairTolerance, listAnchors, moveAnchor, paintDisc, paletteFromRaster, parseBatchFields, removeShape, sharpenCorners } from "./edit.ts";

function pathData(svg: string): string {
  const match = /\bd="([^"]*)"/.exec(svg);
  return match?.[1] ?? "";
}

function cubicCount(svg: string): number {
  return pathData(svg).split("C").length - 1;
}

test("fairing tolerance grows as the curve slider asks for smoother lines", () => {
  assert.equal(fairTolerance(0), 0.4);
  assert.equal(fairTolerance(2.4), 5.68);
  assert.equal(fairTolerance(3), 7);
});

test("pixel stairs collapse and a long square keeps its corners", () => {
  let stair = "M0,0";
  for (let step = 0; step < 12; step += 1) stair += " H" + String(step + 1) + " V" + String(step + 1);
  const faired = fairPaths('<svg><path d="' + stair + '"/></svg>', { smoothness: 2.4, cornerDegrees: 90 });
  assert.ok(cubicCount(faired) <= 3);
  const anchors = listAnchors(faired);
  assert.deepEqual(anchors[0], { pathIndex: 0, anchorIndex: 0, x: 0, y: 0 });
  assert.equal(anchors[anchors.length - 1]?.x, 12);
  assert.equal(anchors[anchors.length - 1]?.y, 12);

  const square = fairPaths('<svg><path d="M0,0 H100 V100 H0 Z" fill="#f00"/></svg>', { smoothness: 2.4, cornerDegrees: 35 });
  const corners = listAnchors(square).map((anchor) => [anchor.x, anchor.y]);
  assert.deepEqual(corners, [[0, 0], [100, 0], [100, 100], [0, 100]]);

  let coarse = "M0,0";
  for (let step = 0; step < 8; step += 1) coarse += " H" + String((step + 1) * 5) + " V" + String((step + 1) * 5);
  const collapsed = fairPaths('<svg><path d="' + coarse + '"/></svg>', { smoothness: 2.4, cornerDegrees: 35 });
  assert.ok(cubicCount(collapsed) <= 3);
  const ends = listAnchors(collapsed);
  assert.equal(ends[0]?.x, 0);
  assert.equal(ends[0]?.y, 0);
  assert.equal(ends[ends.length - 1]?.x, 40);
  assert.equal(ends[ends.length - 1]?.y, 40);

  const small = fairPaths('<svg><path d="M0,0 H20 V20 H0 Z" fill="#f00"/></svg>', { smoothness: 2.4, cornerDegrees: 35 });
  assert.deepEqual(listAnchors(small).map((anchor) => [anchor.x, anchor.y]), [[0, 0], [20, 0], [20, 20], [0, 20]]);
  const tiny = fairPaths('<svg><path d="M0,0 H6 V6 H0 Z" fill="#f00"/></svg>', { smoothness: 2.4, cornerDegrees: 35 });
  assert.deepEqual(listAnchors(tiny).map((anchor) => [anchor.x, anchor.y]), [[0, 0], [6, 0], [6, 6], [0, 6]]);

  let brief = "M0,0";
  for (let step = 0; step < 3; step += 1) brief += " H" + String((step + 1) * 5) + " V" + String((step + 1) * 5);
  const briefFair = fairPaths('<svg><path d="' + brief + '"/></svg>', { smoothness: 2.4, cornerDegrees: 90 });
  assert.ok(cubicCount(briefFair) <= 2);
  const briefEnds = listAnchors(briefFair);
  assert.equal(briefEnds[0]?.x, 0);
  assert.equal(briefEnds[briefEnds.length - 1]?.y, 15);

  const oneCorner = listAnchors(fairPaths('<svg><path d="M0,0 H10 V10"/></svg>', { smoothness: 2.4, cornerDegrees: 35 }));
  assert.equal(oneCorner.length, 3);
  assert.ok(Math.hypot((oneCorner[1]?.x ?? 0) - 10, oneCorner[1]?.y ?? 0) < 0.05);

  const rough = fairPaths('<svg><path d="' + brief + '"/></svg>', { smoothness: 0, cornerDegrees: 35 });
  assert.ok(cubicCount(rough) >= 6);

  let wide = "M0,0";
  for (let step = 0; step < 40; step += 1) wide += " H" + String(step + 1) + " V" + String(step % 2 === 0 ? 1 : 0);
  const jagged = listAnchors(fairPaths('<svg><path d="' + wide + '"/></svg>', { smoothness: 0, cornerDegrees: 90 }));
  const smoothed = listAnchors(fairPaths('<svg><path d="' + wide + '"/></svg>', { smoothness: 2.4, cornerDegrees: 90 }));
  assert.ok(jagged.length > 30);
  assert.ok(smoothed.length <= 4);
});

test("a shallow kink is kept only when the corner slider is high", () => {
  const radians = (15 * Math.PI) / 180;
  const kink = "M0,0 L8,0 L" + String(8 + 8 * Math.cos(radians)) + "," + String(8 * Math.sin(radians));
  const wrap = (corner: number): string => '<svg><path d="' + kink + '"/></svg>';
  const kept = listAnchors(fairPaths(wrap(80), { smoothness: 2.4, cornerDegrees: 80 }));
  const smoothed = listAnchors(fairPaths(wrap(20), { smoothness: 2.4, cornerDegrees: 20 }));
  assert.equal(kept.length, 3);
  assert.ok(Math.hypot((kept[1]?.x ?? 0) - 8, kept[1]?.y ?? 0) < 0.05);
  assert.equal(smoothed.length, 2);
});

test("a wide curve stays curved and unsupported commands stay untouched", () => {
  const steps: string[] = ["M40,0"];
  for (let step = 1; step <= 18; step += 1) {
    const angle = (Math.PI * step) / 18;
    steps.push("L" + (40 * Math.cos(angle)).toFixed(3) + "," + (40 * Math.sin(angle)).toFixed(3));
  }
  const faired = fairPaths('<svg><path d="' + steps.join(" ") + '"/></svg>', { smoothness: 2.4, cornerDegrees: 35 });
  assert.ok(cubicCount(faired) >= 1);
  assert.ok(cubicCount(faired) <= 8);
  assert.ok(listAnchors(faired).some((anchor) => anchor.y > 30));
  const arc = '<svg><path d="M0,0 A10,10 0 0 1 10,10"/></svg>';
  assert.equal(fairPaths(arc, { smoothness: 3, cornerDegrees: 0 }), arc);
  const circle = '<svg><circle cx="4" cy="4" r="3"/></svg>';
  assert.equal(fairPaths(circle, { smoothness: 3, cornerDegrees: 0 }), circle);
});

test("dragging an anchor moves that joint and both attached handles", () => {
  const svg = '<svg><path d="M0,0 C10,0 20,0 30,0 C40,0 50,0 60,0"/></svg>';
  const moved = moveAnchor(svg, 0, 1, 30, 10);
  assert.match(pathData(moved), /C10,0 20,10 30,10C40,10 50,0 60,0/);
  assert.equal(moveAnchor(svg, 3, 0, 1, 1), svg);
});

test("one shape can be removed while the last shape stays", () => {
  const svg = '<svg><path d="M0,0 H2 V2 Z"/><rect x="5" y="5" width="4" height="4"/></svg>';
  const removed = removeShape(svg, 0);
  assert.equal(removed.includes("path"), false);
  assert.equal(removed.includes("<rect"), true);
  assert.equal(removeShape(removed, 0), removed);
});

test("a rect becomes a path and a disc recolors only pixels inside its radius", () => {
  const expanded = expandPrimitives('<svg><rect x="1" y="2" width="10" height="4" fill="#abc"/></svg>');
  assert.match(expanded, /<path d="M1,2H11V6H1Z" fill="#abc"\/>/);
  const rgba = new Uint8Array(8 * 8 * 4);
  const painted = paintDisc(rgba, 8, 8, 4, 4, 1.5, "#336699");
  assert.equal(painted[4 * 8 * 4 + 4 * 4], 0x33);
  assert.equal(painted[4 * 8 * 4 + 4 * 4 + 3], 255);
  assert.equal(painted[0], 0);
  assert.equal(paletteFromRaster(painted)?.includes("#336699"), true);
  const many = new Uint8Array(40 * 4);
  for (let index = 0; index < 40; index += 1) {
    many[index * 4] = index;
    many[index * 4 + 3] = 255;
  }
  assert.equal(paletteFromRaster(many), null);
});

test("a batch list accepts at most twelve rasters", () => {
  const list = parseBatchFields(["Poster", "file:/tmp/a.ai", "1", "abc", "Logo", "PlacedItem", "0", "0", "40", "20", "0"]);
  assert.equal(list.documentIdentity, "file:/tmp/a.ai");
  assert.equal(list.items[0]?.uuid, "abc");
  assert.deepEqual(list.items[0]?.bounds, [0, 40, 20, 0]);
  assert.throws(() => parseBatchFields(["Poster", "file:/tmp/a.ai", "13"]), /12/);
});

test("sharpenCorners turns a traced fillet into a sharp corner but keeps a real round corner", () => {
  const fillet = '<svg viewBox="0 0 20 20"><path d="M0,0L9.6,0C9.85,0 10,0.15 10,0.4L10,10L0,10Z" fill="#000"/></svg>';
  const sharp = pathData(sharpenCorners(fillet));
  assert.ok(!sharp.includes("9.6,0") && !sharp.includes("10,0.4"), sharp);
  assert.ok(/(^|[^\d.])10,0([^.\d]|$)/.test(sharp), "the sides meet at the vertex: " + sharp);
  const round = '<svg viewBox="0 0 20 20"><path d="M0,0L6,0C8.2,0 10,1.8 10,4L10,10L0,10Z" fill="#000"/></svg>';
  assert.ok(pathData(sharpenCorners(round)).includes("C8.2,0 10,1.8 10,4"), "a 4px round corner stays round");
});
