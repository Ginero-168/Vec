import * as assert from "node:assert/strict";
import { test } from "node:test";
import { deltaE76, rgbToCieLab, rgbToOklab, oklabDistance } from "./oklab";
import { rasterizeShapes } from "./raster";
import { DARK_SURROUND_L, segmentImage } from "./segment";
import { traceSegmentation } from "./trace";
import { TRANSPARENT, type Rgb, type Segmentation } from "./model";

function paint(width: number, height: number, colorAt: (x: number, y: number) => Rgb | null): { rgba: Uint8Array; width: number; height: number } {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = colorAt(x, y);
      if (!color) continue;
      const offset = (y * width + x) * 4;
      rgba[offset] = color.r;
      rgba[offset + 1] = color.g;
      rgba[offset + 2] = color.b;
      rgba[offset + 3] = 255;
    }
  }
  return { rgba, width, height };
}

function segmentationFrom(width: number, height: number, labelAt: (x: number, y: number) => number, palette: readonly Rgb[]): Segmentation {
  const labels = new Uint16Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) labels[y * width + x] = labelAt(x, y);
  }
  return { width, height, labels, palette };
}

test("a flat rectangle traces to a four-corner path", () => {
  const segmentation = segmentationFrom(8, 6, (x, y) => (x >= 2 && x < 6 && y >= 1 && y < 4 ? 0 : TRANSPARENT), [{ r: 200, g: 40, b: 30 }]);
  const traced = traceSegmentation(segmentation, { smooth: 0, upscale: 1, cornerAngle: 0.6 });
  assert.equal(traced.pathCount, 1);
  assert.equal(traced.nodeCount, 4);
  const rendered = rasterizeShapes(traced.shapes, 8, 6);
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 8; x++) {
      const inside = x >= 2 && x < 6 && y >= 1 && y < 4;
      assert.equal(rendered[(y * 8 + x) * 4 + 3], inside ? 255 : 0);
    }
  }
});

test("adjacent regions share the smoothed edge", () => {
  const segmentation = segmentationFrom(6, 4, (x) => (x < 3 ? 0 : 1), [
    { r: 20, g: 20, b: 20 },
    { r: 230, g: 230, b: 230 }
  ]);
  const traced = traceSegmentation(segmentation, { smooth: 0, upscale: 1, cornerAngle: 0.5 });
  assert.equal(traced.pathCount, 2);
  const vertical = (shapeIndex: number) => {
    const hits: string[] = [];
    for (const subpath of traced.shapes[shapeIndex]?.subpaths ?? []) {
      let x = subpath.start.x;
      let y = subpath.start.y;
      const points = [{ x, y }];
      for (const command of subpath.commands) {
        x = command.x;
        y = command.y;
        points.push({ x, y });
      }
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        if (a && b && a.x === 3 && b.x === 3) hits.push(Math.min(a.y, b.y) + ":" + Math.max(a.y, b.y));
      }
    }
    return hits.sort().join(",");
  };
  assert.equal(vertical(0), vertical(1));
  assert.match(vertical(0), /0:4/);
});

test("a hole stays open and the inner color fills it", () => {
  const segmentation = segmentationFrom(7, 7, (x, y) => {
    if (x === 0 || y === 0 || x === 6 || y === 6) return TRANSPARENT;
    if (x >= 2 && x <= 4 && y >= 2 && y <= 4) return 1;
    return 0;
  }, [
    { r: 10, g: 80, b: 200 },
    { r: 240, g: 210, b: 40 }
  ]);
  const traced = traceSegmentation(segmentation, { smooth: 0, upscale: 1, cornerAngle: 0.4 });
  const rendered = rasterizeShapes(traced.shapes, 7, 7);
  assert.equal(rendered[(3 * 7 + 3) * 4 + 1], 210);
  assert.equal(rendered[(1 * 7 + 1) * 4 + 2], 200);
  assert.equal(rendered[(2 * 7 + 1) * 4 + 2], 200);
});

test("anti-aliased orange keeps the core color and a thin stroke survives", () => {
  const orange: Rgb = { r: 242, g: 120, b: 32 };
  const white: Rgb = { r: 248, g: 246, b: 242 };
  const black: Rgb = { r: 18, g: 18, b: 20 };
  const image = paint(48, 32, (x, y) => {
    if (x === 8 && y >= 6 && y < 26) return black;
    if ((x === 7 || x === 9) && y >= 6 && y < 26) return { r: 120, g: 120, b: 122 };
    if (x >= 20 && x < 40 && y >= 4 && y < 28) {
      if (x === 20 || x === 39) return { r: 250, g: 190, b: 140 };
      return orange;
    }
    return white;
  });
  const segmentation = segmentImage(image.rgba, image.width, image.height, 8, { preset: "ui" });
  const dark = segmentation.palette.filter((color) => rgbToOklab(color.r, color.g, color.b).l < 0.35);
  assert.ok(dark.length >= 1, "dark stroke stays in the palette");
  let strokeLabel = TRANSPARENT;
  for (let y = 6; y < 26; y++) {
    const label = segmentation.labels[y * image.width + 8] ?? TRANSPARENT;
    if (label === TRANSPARENT) continue;
    const color = segmentation.palette[label];
    if (color && rgbToOklab(color.r, color.g, color.b).l < 0.45) strokeLabel = label;
  }
  assert.notEqual(strokeLabel, TRANSPARENT);
  const orangeLabel = segmentation.labels[16 * image.width + 30] ?? TRANSPARENT;
  const kept = segmentation.palette[orangeLabel];
  assert.ok(kept);
  const delta = deltaE76(rgbToCieLab(kept.r, kept.g, kept.b), rgbToCieLab(orange.r, orange.g, orange.b));
  assert.ok(delta < 6, "core orange deltaE " + delta.toFixed(2));
  const traced = traceSegmentation(segmentation, { preset: "ui", smooth: 0.5, upscale: 2, originalLabels: segmentation.labels });
  const rendered = rasterizeShapes(traced.shapes, image.width, image.height);
  const center = rendered[(16 * image.width + 8) * 4] ?? 255;
  assert.ok(center < 80, "rasterized stroke stays dark");
  assert.ok(oklabDistance(rgbToOklab(orange.r, orange.g, orange.b), rgbToOklab(248, 220, 180)) > 0.05);
});

test("a dark maroon plate stays separate from black", () => {
  const maroon: Rgb = { r: 50, g: 0, b: 0 };
  const black: Rgb = { r: 4, g: 4, b: 4 };
  const image = paint(96, 72, (x, y) => {
    if (x >= 12 && x < 52 && y >= 8 && y < 48) {
      if (x === 12 || y === 8 || x === 51 || y === 47) return { r: 30, g: 6, b: 4 };
      return maroon;
    }
    if (y >= 58 && y <= 60 && x >= 6 && x < 88) return black;
    const n = (x * 13 + y * 9) % 17;
    return { r: 108 + n, g: 104 + (n % 5), b: 116 + (n % 7) };
  });
  const segmentation = segmentImage(image.rgba, image.width, image.height, 6, { preset: "ui" });
  const plate = segmentation.labels[28 * image.width + 32] ?? TRANSPARENT;
  const ink = segmentation.labels[59 * image.width + 40] ?? TRANSPARENT;
  const plateColor = segmentation.palette[plate];
  const inkColor = segmentation.palette[ink];
  assert.ok(plateColor && inkColor);
  assert.notEqual(plate, ink);
  const delta = deltaE76(rgbToCieLab(plateColor.r, plateColor.g, plateColor.b), rgbToCieLab(maroon.r, maroon.g, maroon.b));
  assert.ok(delta < 8, "maroon swatch deltaE " + delta.toFixed(2));
  assert.ok(rgbToOklab(inkColor.r, inkColor.g, inkColor.b).l < 0.2, "text ink stays dark");
  assert.ok(oklabChroma(rgbToOklab(plateColor.r, plateColor.g, plateColor.b)) > 0.03);
});

test("a low-contrast blur does not keep a darker component", () => {
  const image = paint(72, 48, (x, y) => {
    const base = 96 + Math.round((x / 71) * 36);
    if (x >= 22 && x < 31 && y >= 14 && y < 23) return { r: 18, g: 16, b: 20 };
    if (y === 40 && x >= 4 && x < 64) return { r: 6, g: 6, b: 6 };
    return { r: base, g: base - 1, b: base + 3 };
  });
  const segmentation = segmentImage(image.rgba, image.width, image.height, 6, { preset: "ui" });
  const seen = new Uint8Array(image.width * image.height);
  for (let start = 0; start < seen.length; start++) {
    const label = segmentation.labels[start] ?? TRANSPARENT;
    if (label === TRANSPARENT || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    const pixels: number[] = [];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      pixels.push(current);
      const x = current % image.width;
      const y = (current - x) / image.width;
      if (y >= 36) continue;
      const neighbors = [current - 1, current + 1, current - image.width, current + image.width];
      for (const next of neighbors) {
        if (next < 0 || next >= seen.length || seen[next]) continue;
        if ((segmentation.labels[next] ?? TRANSPARENT) !== label) continue;
        const nx = next % image.width;
        if (Math.abs(nx - x) + Math.abs(Math.floor(next / image.width) - y) !== 1) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    const upper = pixels.filter((pixel) => Math.floor(pixel / image.width) < 36);
    if (upper.length < 4) continue;
    const componentL = medianChannel(
      upper.map((pixel) => rgbToOklab(image.rgba[pixel * 4] ?? 0, image.rgba[pixel * 4 + 1] ?? 0, image.rgba[pixel * 4 + 2] ?? 0).l)
    );
    const ring: number[] = [];
    for (const pixel of upper) {
      const x = pixel % image.width;
      const y = Math.floor(pixel / image.width);
      const neighbors = [pixel - 1, pixel + 1, pixel - image.width, pixel + image.width];
      for (const next of neighbors) {
        if (next < 0 || next >= seen.length) continue;
        const nx = next % image.width;
        const ny = Math.floor(next / image.width);
        if (ny >= 36 || Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
        if (upper.includes(next)) continue;
        ring.push(rgbToOklab(image.rgba[next * 4] ?? 0, image.rgba[next * 4 + 1] ?? 0, image.rgba[next * 4 + 2] ?? 0).l);
      }
    }
    if (ring.length < 4) continue;
    const gap = medianChannel(ring) - componentL;
    assert.ok(gap <= DARK_SURROUND_L, "darker than surround by " + gap.toFixed(3));
  }
  const stroke = segmentation.palette[segmentation.labels[40 * image.width + 20] ?? TRANSPARENT];
  assert.ok(stroke);
  assert.ok(rgbToOklab(stroke.r, stroke.g, stroke.b).l < 0.25, "the dark stroke stays");
});

test("thin fringes on a green square are reassigned", () => {
  const green: Rgb = { r: 170, g: 239, b: 114 };
  const purple: Rgb = { r: 118, g: 114, b: 129 };
  const image = paint(48, 48, (x, y) => {
    const inside = x >= 12 && x < 36 && y >= 12 && y < 36;
    if (y >= 23 && y <= 24 && x >= 16 && x < 34) return { r: 8, g: 8, b: 8 };
    if (x >= 14 && x < 34 && y >= 14 && y < 34) return green;
    if (inside && (y === 12 || y === 35)) return { r: 248, g: 248, b: 246 };
    if (inside && (x === 12 || x === 35 || x === 13 || x === 34)) return { r: 206, g: 242, b: 168 };
    if (inside) return green;
    return purple;
  });
  const segmentation = segmentImage(image.rgba, image.width, image.height, 4, { preset: "ui" });
  const swatchAt = (x: number, y: number) => segmentation.palette[segmentation.labels[y * image.width + x] ?? TRANSPARENT];
  for (const [x, y] of [
    [18, 12],
    [18, 35],
    [12, 24],
    [35, 20]
  ] as const) {
    const color = swatchAt(x, y);
    assert.ok(color);
    const lab = rgbToOklab(color.r, color.g, color.b);
    assert.ok(!(lab.l > 0.85 && oklabChroma(lab) < 0.05), "white sliver at " + x + "," + y + " " + color.r + "," + color.g + "," + color.b);
  }
  const core = swatchAt(24, 20);
  const fringe = swatchAt(12, 22);
  assert.ok(core && fringe);
  const fringeDelta = deltaE76(rgbToCieLab(core.r, core.g, core.b), rgbToCieLab(fringe.r, fringe.g, fringe.b));
  const fringeToPurple = deltaE76(rgbToCieLab(purple.r, purple.g, purple.b), rgbToCieLab(fringe.r, fringe.g, fringe.b));
  assert.ok(fringeDelta < 12 || fringeToPurple < 12, "fringe stayed a third color dE " + fringeDelta.toFixed(1));
  const ink = swatchAt(22, 23);
  assert.ok(ink);
  assert.ok(rgbToOklab(ink.r, ink.g, ink.b).l < 0.25, "the dark mark inside the square stays");
});

test("a one-pixel stair on a long edge is smoothed", () => {
  const segmentation = segmentationFrom(20, 30, (x, y) => {
    if (y < 2 || y >= 28 || x >= 16) return TRANSPARENT;
    const inset = y >= 10 && y < 18 ? 5 : 4;
    return x >= inset ? 0 : TRANSPARENT;
  }, [{ r: 20, g: 180, b: 60 }]);
  const traced = traceSegmentation(segmentation, { preset: "ui", smooth: 0.5, upscale: 1 });
  const xs: number[] = [];
  for (const subpath of traced.shapes[0]?.subpaths ?? []) {
    const points = [subpath.start];
    for (const command of subpath.commands) points.push({ x: command.x, y: command.y });
    for (const point of points) if (point.x < 8) xs.push(point.x);
  }
  assert.ok(xs.length >= 2);
  const span = Math.max(...xs) - Math.min(...xs);
  assert.ok(span < 0.45, "left edge still stairs by " + span.toFixed(2));
  assert.ok(traced.nodeCount <= 8, "node count " + traced.nodeCount);
});

function medianChannel(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function oklabChroma(lab: { a: number; b: number }): number {
  return Math.hypot(lab.a, lab.b);
}
