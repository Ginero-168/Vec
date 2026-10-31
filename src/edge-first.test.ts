import assert from "node:assert/strict";
import { test } from "node:test";
import { edgeFirstSvg } from "./edge-first.ts";

function image(width: number, height: number, at: (x: number, y: number) => readonly [number, number, number]): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) rgba.set([...at(x, y), 255], (y * width + x) * 4);
  return rgba;
}

test("an anti-aliased column puts the shared edge at its coverage, and both shapes use that one curve", () => {
  // 16x8: ink A (red) on columns 0-8, ink B (blue) on 9-15; column 8 is 30% B, so A covers 8.7 px of each row.
  const red = [200, 40, 40] as const, blue = [40, 40, 200] as const;
  const mix = red.map((value, channel) => Math.round(value * 0.7 + blue[channel]! * 0.3)) as unknown as readonly [number, number, number];
  const source = image(16, 8, (x) => (x < 8 ? red : x === 8 ? mix : blue));
  const labels = new Int32Array(16 * 8).map((_, at) => (at % 16 < 9 ? 0 : 1));
  const svg = edgeFirstSvg({ width: 16, height: 8, labels, inks: ["#c82828", "#2828c8"] }, source, false);
  const paths = svg.match(/<path [^>]*>/g) ?? [];
  assert.equal(paths.length, 2, svg);
  assert.ok(paths[0]!.includes('fill="#C82828"') && paths[1]!.includes('fill="#2828C8"'), "largest first: A, then B on top");
  assert.ok(/M8\.7,|[ C]8\.7,/.test(paths[1]!), paths[1]);
  assert.ok(!/(^|[^\d])9,/.test(paths[1]!.replace(/M16,|16,/g, "")), "the crack position (x = 9) is not kept: " + paths[1]);
});

test("a backdrop region is not drawn and an opaque image's backdrop is its border colour", () => {
  const white = [255, 255, 255] as const, ink = [20, 20, 20] as const;
  const source = image(12, 12, (x, y) => (x >= 3 && x < 9 && y >= 3 && y < 9 ? ink : white));
  const labels = new Int32Array(144).map((_, at) => { const x = at % 12, y = Math.floor(at / 12); return x >= 3 && x < 9 && y >= 3 && y < 9 ? 0 : -1; });
  const svg = edgeFirstSvg({ width: 12, height: 12, labels, inks: ["#141414"] }, source, false);
  const paths = svg.match(/<path [^>]*>/g) ?? [];
  assert.equal(paths.length, 1, svg);
  assert.ok(paths[0]!.includes("M3,3") || paths[0]!.includes("3,3"), paths[0]);
});

test("a narrow gap's edges each integrate only their own half of the gap", () => {
  // 64x16: red to x = 30.5, a white gap, blue from x = 33.5 (columns 30 and 33 are half covered). Each side's window
  // is capped at half the gap so neither edge reads the other's anti-aliasing.
  const red = [240, 80, 30] as const, blue = [0, 170, 240] as const, white = [255, 255, 255] as const;
  const half = (a: readonly number[]) => a.map((v, c) => Math.round((v + white[c]!) / 2)) as unknown as readonly [number, number, number];
  const source = image(64, 16, (x) => (x < 30 ? red : x === 30 ? half(red) : x < 33 ? white : x === 33 ? half(blue) : blue));
  const labels = new Int32Array(64 * 16).map((_, at) => { const x = at % 64; return x <= 30 ? 0 : x <= 32 ? 2 : 1; });
  const svg = edgeFirstSvg({ width: 64, height: 16, labels, inks: ["#f0501e", "#00aaf0", "#ffffff"] }, source, false);
  const xs = (fill: string) => [...(svg.match(new RegExp(`<path d="([^"]*)" fill="${fill}"`))?.[1] ?? "").matchAll(/(-?[\d.]+),(-?[\d.]+)/g)]
    .map((m) => [Number(m[1]), Number(m[2])] as const).filter(([x, y]) => y > 1 && y < 15 && x > 20 && x < 44).map(([x]) => x);
  const redEdge = xs("#F0501E"), blueEdge = xs("#00AAF0");
  assert.ok(redEdge.length > 0 && redEdge.every((x) => Math.abs(x - 30.5) < 0.05), svg);
  assert.ok(blueEdge.length > 0 && blueEdge.every((x) => Math.abs(x - 33.5) < 0.05), svg);
});

test("on a lossy source chroma error moves the edge between inks a quarter as much as luma error", () => {
  // 32x16: red to x = 12.25 on white (column 12 is 25% red). q60 JPEG codes chroma with one sample per four pixels
  // and a coarser quantiser, so near an edge it is the noisier measurement and the unmix weights it 1/4. A chroma
  // error on the pixels beside the edge then shifts it by well under the RGB unmix's shift.
  const red = [240, 80, 30], white = [255, 255, 255];
  const ycc = (p: readonly number[]) => [0.299 * p[0]! + 0.587 * p[1]! + 0.114 * p[2]!, -0.168736 * p[0]! - 0.331264 * p[1]! + 0.5 * p[2]!, 0.5 * p[0]! - 0.418688 * p[1]! - 0.081312 * p[2]!];
  const rgb = (q: readonly number[]) => [q[0]! + 1.402 * q[2]!, q[0]! - 0.344136 * q[1]! - 0.714136 * q[2]!, q[0]! + 1.772 * q[1]!];
  const cover = (x: number) => (x < 12 ? 1 : x === 12 ? 0.25 : 0);
  const edgeAt = (chromaError: number) => {
    const source = image(32, 16, (x) => {
      const q = ycc(red.map((v, c) => v * cover(x) + white[c]! * (1 - cover(x))));
      // The red pixels beside the edge drift toward white's chroma, as chroma bleed does.
      if (x === 10 || x === 11) { q[1] = q[1]! * (1 - chromaError); q[2] = q[2]! * (1 - chromaError); }
      return rgb(q).map((v) => Math.min(255, Math.max(0, Math.round(v)))) as unknown as readonly [number, number, number];
    });
    const labels = new Int32Array(32 * 16).map((_, i) => (i % 32 <= 12 ? 0 : 1));
    const svg = edgeFirstSvg({ width: 32, height: 16, labels, inks: ["#f0501e", "#ffffff"] }, source, true);
    const xs = [...(svg.match(/<path d="([^"]*)" fill="#F0501E"/)?.[1] ?? "").matchAll(/(-?[\d.]+),(-?[\d.]+)/g)]
      .map((m) => [Number(m[1]), Number(m[2])] as const).filter(([x, y]) => y > 2 && y < 14 && x > 4).map(([x]) => x);
    assert.ok(xs.length > 0, svg);
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };
  const exact = edgeAt(0), bled = edgeAt(0.3);
  assert.ok(Math.abs(exact - 12.25) < 0.05, String(exact));
  assert.ok(Math.abs(bled - exact) < 0.06, `${exact} -> ${bled}`);
});

test("a square corner whose anti-aliased pixel has the outside's label is sharpened onto both edges", () => {
  // 40x40: red square to 12.75 on white; the corner pixel (56% red) is labelled white, so the corner's first sample
  // sits a point before the bevel. The corner must land on both edges' lines (12.75, 12.75), not tilt one of them.
  const red = [241, 81, 27], white = [255, 255, 255], W = 40, e = 12.75;
  const cover = (x: number, y: number) => Math.max(0, Math.min(1, e - x)) * Math.max(0, Math.min(1, e - y));
  const source = image(W, W, (x, y) => red.map((v, c) => Math.round(v * cover(x, y) + white[c]! * (1 - cover(x, y)))) as unknown as readonly [number, number, number]);
  const labels = new Int32Array(W * W).map((_, i) => (cover(i % W, Math.floor(i / W)) >= 0.6 ? 0 : 1));
  const svg = edgeFirstSvg({ width: W, height: W, labels, inks: ["#f1511b", "#ffffff"] }, source, false);
  const d = svg.match(/<path d="([^"]*)" fill="#F1511B"/)?.[1] ?? "";
  const points = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
  assert.ok(points.every(([x, y]) => (Math.abs(x - e) < 0.02 || x < 12.7) && (Math.abs(y - e) < 0.02 || y < 12.7)), svg);
});

const pathsOf = (svg: string) => [...svg.matchAll(/<path d="([^"]*)" fill="(#[0-9A-F]{6})"/g)].map((m) => ({ d: m[1]!, fill: m[2]! }));

test("a 1 px diagonal hairline survives: its pixels touch only at corners, but together they are a line", () => {
  // 32x32 white with a grey 1 px diagonal from (4,4) to (27,27); each step is a 1 px region, below the speck size.
  const W = 32, grey = [90, 90, 90] as const, white = [255, 255, 255] as const;
  const on = (x: number, y: number) => x === y && x >= 4 && x < 28;
  const source = image(W, W, (x, y) => (on(x, y) ? grey : white));
  const labels = new Int32Array(W * W).map((_, at) => (on(at % W, Math.floor(at / W)) ? 0 : 1));
  const svg = edgeFirstSvg({ width: W, height: W, labels, inks: ["#5a5a5a", "#ffffff"] }, source, false);
  assert.ok(pathsOf(svg).some((p) => p.fill === "#5A5A5A"), svg);
});

test("a 2 px speck cluster stays speckle and joins its surround", () => {
  const W = 32, grey = [90, 90, 90] as const, white = [255, 255, 255] as const;
  const on = (x: number, y: number) => (x === 10 && y === 10) || (x === 11 && y === 11);
  const source = image(W, W, (x, y) => (on(x, y) ? grey : white));
  const labels = new Int32Array(W * W).map((_, at) => (on(at % W, Math.floor(at / W)) ? 0 : 1));
  const svg = edgeFirstSvg({ width: W, height: W, labels, inks: ["#5a5a5a", "#ffffff"] }, source, false);
  assert.ok(!pathsOf(svg).some((p) => p.fill === "#5A5A5A"), svg);
});

test("on a lossy source a long 1 px line of a near ink inside one region keeps its ink; edge ringing does not", () => {
  // 64x64 green L (rows 8-55) on white; a 1 px line of a near green (within the denoiser's range of L) at row 30, and
  // a strip of the same near ink at row 53, two rows inside L's lower edge (within one DCT block of it).
  const W = 64, L = [62, 176, 106] as const, B = [52, 166, 96] as const, white = [255, 255, 255] as const;
  const at = (x: number, y: number) => (y < 8 || y >= 56 || x < 4 || x >= 60 ? white : (y === 30 || y === 53) && x >= 8 && x < 56 ? B : L);
  const source = image(W, W, at);
  const labels = new Int32Array(W * W).map((_, i) => { const p = at(i % W, Math.floor(i / W)); return p === white ? 2 : p === B ? 1 : 0; });
  const svg = edgeFirstSvg({ width: W, height: W, labels, inks: ["#3eb06a", "#34a660", "#ffffff"] }, source, true);
  const line = pathsOf(svg).filter((p) => p.fill === "#34A660");
  assert.equal(line.length, 1, svg);
  const ys = [...line[0]!.d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[2]));
  assert.ok(ys.every((y) => y > 28 && y < 33), "only the row-30 line is kept: " + line[0]!.d);
});

test("an island the plates labelled apart, whose pixels are its surround's ink, joins the surround", () => {
  // 32x32: blue surround; a 3 px island labelled a paler blue whose source pixels are the surround's colour.
  const W = 32, blue = [114, 152, 255] as const, white = [255, 255, 255] as const;
  const island = (x: number, y: number) => y === 15 && x >= 14 && x < 17;
  const source = image(W, W, (x, y) => (x < 4 || x >= 28 || y < 4 || y >= 28 ? white : blue));
  const labels = new Int32Array(W * W).map((_, i) => { const x = i % W, y = Math.floor(i / W); return x < 4 || x >= 28 || y < 4 || y >= 28 ? 2 : island(x, y) ? 1 : 0; });
  const svg = edgeFirstSvg({ width: W, height: W, labels, inks: ["#7298ff", "#9aa4ff", "#ffffff"] }, source, false);
  const paths = pathsOf(svg);
  assert.ok(!paths.some((p) => p.fill === "#9AA4FF"), svg);
  assert.ok(paths.every((p) => (p.d.match(/M/g) ?? []).length === 1), "no hole is cut for it: " + svg);
});

test("an island whose own pixels are its own ink is a dot and stays", () => {
  const W = 32, blue = [114, 152, 255] as const, pale = [154, 164, 255] as const, white = [255, 255, 255] as const;
  const island = (x: number, y: number) => y === 15 && x >= 14 && x < 17;
  const source = image(W, W, (x, y) => (x < 4 || x >= 28 || y < 4 || y >= 28 ? white : island(x, y) ? pale : blue));
  const labels = new Int32Array(W * W).map((_, i) => { const x = i % W, y = Math.floor(i / W); return x < 4 || x >= 28 || y < 4 || y >= 28 ? 2 : island(x, y) ? 1 : 0; });
  const svg = edgeFirstSvg({ width: W, height: W, labels, inks: ["#7298ff", "#9aa4ff", "#ffffff"] }, source, false);
  assert.ok(pathsOf(svg).some((p) => p.fill === "#9AA4FF"), svg);
});

test("a shape on a framed page integrates its edge against the page inside the frame, not the frame", () => {
  // 40x40 opaque: a 2 px grey frame (the border colour), a white page inside it (undrawn backdrop), and a red square
  // to x = 20.25 (column 20 is 25% red over white). The square's edge is placed against white.
  const W = 40, grey = [128, 128, 128], white = [255, 255, 255], red = [240, 80, 30];
  const frame = (x: number, y: number) => x < 2 || y < 2 || x >= W - 2 || y >= W - 2;
  const cover = (x: number, y: number) => (y >= 10 && y < 30 ? (x >= 10 && x < 20 ? 1 : x === 20 ? 0.25 : 0) : 0);
  const source = image(W, W, (x, y) => (frame(x, y) ? grey : red.map((v, c) => Math.round(v * cover(x, y) + white[c]! * (1 - cover(x, y))))) as unknown as readonly [number, number, number]);
  const labels = new Int32Array(W * W).map((_, i) => { const x = i % W, y = Math.floor(i / W); return frame(x, y) ? 1 : cover(x, y) >= 0.5 ? 0 : -1; });
  const svg = edgeFirstSvg({ width: W, height: W, labels, inks: ["#f0501e", "#808080"] }, source, false);
  const red_ = pathsOf(svg).find((p) => p.fill === "#F0501E")!;
  const xs = [...red_.d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]).filter(([x, y]) => x > 15 && y > 12 && y < 28).map(([x]) => x!);
  assert.ok(xs.length > 0 && xs.every((x) => Math.abs(x - 20.25) < 0.05), red_.d);
});

test("a boundary between two bands of a gradient is fitted to its points' own uncertainty", () => {
  // 64x64: a diagonal gradient (blue 60 -> 160 along x + y) posterised into two bands whose inks are the band centres'
  // colours, labelled apart along x + y = 63 with up to 2 px of stair noise. The band edge is no edge: its windows'
  // ends carry a third of the other ink, so every point is that uncertain, and a fit within the clean edge
  // tolerance (45 segments here) follows the stair noise.
  const W = 64, b = (s: number) => Math.round(60 + (100 * s) / 126);
  const source = image(W, W, (x, y) => [40, 120, b(x + y)]);
  const labels = new Int32Array(W * W).map((_, i) => { const x = i % W, y = Math.floor(i / W); return x + y + ((x * 7 + y * 3) % 5) - 2 < 63 ? 0 : 1; });
  const hex = (v: number) => "#2878" + v.toString(16).padStart(2, "0");
  const svg = edgeFirstSvg({ width: W, height: W, labels, inks: [hex(b(32)), hex(b(94))] }, source, false);
  const band = pathsOf(svg).find((p) => p.fill === hex(b(32)).toUpperCase())!;
  assert.ok((band.d.match(/[CL]/g) ?? []).length < 40, band.d);
});
