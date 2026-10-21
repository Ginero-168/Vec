import { TRANSPARENT, type Rgb } from "./model";
import { rgbToOklab, type Lab } from "./oklab";

export type IsoPoint = { x: number; y: number };

/**
 * Replace one shared edge with the t=0.5 iso-line of the source color between
 * the two palette colors. Each unit edge contributes the bilinear crossing on
 * the segment between the two pixel centers, so a diagonal is a diagonal and
 * not a staircase of grid edges. Hard (unblended) edges stay on the label-map
 * corners so a crisp rectangle keeps its corners. Open chains meet at one
 * shared sub-pixel junction; a binary corner stays on the integer vertex.
 */
export function refineChain(
  points: readonly IsoPoint[],
  closed: boolean,
  inside: number,
  outside: number,
  width: number,
  height: number,
  rgba: Uint8Array,
  palette: readonly Rgb[],
  labels: Uint16Array,
  denoise = true
): { points: IsoPoint[]; soft: boolean } {
  const original = points.map((point) => ({ x: point.x, y: point.y }));
  if (outside === TRANSPARENT || inside === TRANSPARENT || points.length < 2) return { points: original, soft: false };
  const labA = paletteLab(palette, inside);
  const labB = paletteLab(palette, outside);
  if (!labA || !labB) return { points: original, soft: false };
  const edgeCount = closed ? points.length : points.length - 1;
  if (edgeCount < 1) return { points: original, soft: false };
  const coverage = new Map<number, number>();
  const coverageAt = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= width || y >= height) return Number.NaN;
    const index = y * width + x;
    const hit = coverage.get(index);
    if (hit !== undefined) return hit;
    const value = sampleT(x, y, 0, width, height, rgba, labels, inside, outside, labA, labB);
    coverage.set(index, value);
    return value;
  };
  const insideRaw: number[] = [];
  const outsideRaw: number[] = [];
  const pixels: { inside: [number, number]; outside: [number, number] }[] = [];
  for (let edge = 0; edge < edgeCount; edge++) {
    const from = points[edge];
    const to = points[(edge + 1) % points.length];
    if (!from || !to) return { points: original, soft: false };
    const ends = edgePixels(from.x, from.y, to.x, to.y);
    if (!ends) return { points: original, soft: false };
    pixels.push(ends);
    insideRaw.push(blurredCoverage(ends.inside[0], ends.inside[1], width, height, coverageAt));
    outsideRaw.push(blurredCoverage(ends.outside[0], ends.outside[1], width, height, coverageAt));
  }
  const insideT = gaussianSmooth(insideRaw, closed);
  const outsideT = gaussianSmooth(outsideRaw, closed);
  const crossings: IsoPoint[] = [];
  let soft = 0;
  for (let edge = 0; edge < edgeCount; edge++) {
    const ends = pixels[edge];
    if (!ends) return { points: original, soft: false };
    const near = insideT[edge] ?? 0;
    const far = outsideT[edge] ?? 1;
    if (near > 0.08 || far < 0.92) soft++;
    crossings.push(dualCrossing(ends.inside[0], ends.inside[1], ends.outside[0], ends.outside[1], near, far));
  }
  if (soft * 5 < edgeCount) return { points: original, soft: false };
  if (closed) {
    const loop = dedupe(crossings, true);
    if (loop.length < 3) return { points: original, soft: false };
    if (!denoise) return { points: loop, soft: true };
    const smoothed = smoothContour(loop, true);
    if (smoothed.length < 3) return { points: original, soft: false };
    return { points: smoothed, soft: true };
  }
  const start = points[0];
  const end = points[points.length - 1];
  if (!start || !end) return { points: original, soft: false };
  const open = dedupe(
    [sharedJunction(start, width, height, rgba, labels, palette), ...crossings, sharedJunction(end, width, height, rgba, labels, palette)],
    false
  );
  if (open.length < 2) return { points: original, soft: false };
  if (!denoise) return { points: open, soft: true };
  const smoothed = smoothContour(open, false);
  if (smoothed.length < 2) return { points: original, soft: false };
  return { points: smoothed, soft: true };
}

/**
 * Flatten marching-squares kinks onto the local chord. A corner that is sharp
 * at both a short and a long scale stays where the iso-line put it.
 */
function smoothContour(points: readonly IsoPoint[], closed: boolean): IsoPoint[] {
  if (points.length < 3) return points.map((point) => ({ x: point.x, y: point.y }));
  let current = points.map((point) => ({ x: point.x, y: point.y }));
  for (let pass = 0; pass < 2; pass++) current = flattenStairs(current, closed);
  return dedupe(current, closed);
}

/** Pull marching-squares kinks onto the local chord. A real corner, sharp at both scales, stays put. */
function flattenStairs(points: readonly IsoPoint[], closed: boolean): IsoPoint[] {
  const count = points.length;
  const next = points.map((point) => ({ x: point.x, y: point.y }));
  const window = 6;
  const first = closed ? 0 : window;
  const last = closed ? count : count - window;
  for (let i = first; i < last; i++) {
    if (stableCorner(points, i, closed)) continue;
    const near = cornerTurn(points, i, 2, closed);
    const far = cornerTurn(points, i, window, closed);
    if (near < 0.35 || far > 0.5) continue;
    const before = points[(i - window + count) % count];
    const after = points[(i + window) % count];
    const point = points[i];
    if (!before || !after || !point) continue;
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const length2 = dx * dx + dy * dy;
    if (length2 < 1e-4) continue;
    const t = ((point.x - before.x) * dx + (point.y - before.y) * dy) / length2;
    const clamped = Math.min(1, Math.max(0, t));
    const targetX = before.x + dx * clamped;
    const targetY = before.y + dy * clamped;
    next[i] = { x: point.x * 0.35 + targetX * 0.65, y: point.y * 0.35 + targetY * 0.65 };
  }
  return next;
}

/** Along-chain Gaussian, sigma ~0.7 samples. Open ends renormalize so a reversed chain stays the reverse. */
function gaussianSmooth(values: readonly number[], closed: boolean): number[] {
  const sigma = 0.7;
  const radius = 3;
  const weight: number[] = [];
  for (let k = -radius; k <= radius; k++) weight.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  const count = values.length;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    let sum = 0;
    let wsum = 0;
    for (let k = -radius; k <= radius; k++) {
      let index = i + k;
      if (closed) index = (index + count * 4) % count;
      else if (index < 0 || index >= count) continue;
      const w = weight[k + radius] ?? 0;
      sum += (values[index] ?? 0) * w;
      wsum += w;
    }
    out.push(wsum > 0 ? sum / wsum : (values[i] ?? 0));
  }
  return out;
}

function jogTurn(a: IsoPoint, b: IsoPoint, c: IsoPoint): number {
  const incoming = Math.atan2(b.y - a.y, b.x - a.x);
  const outgoing = Math.atan2(c.y - b.y, c.x - b.x);
  let delta = outgoing - incoming;
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return Math.abs(delta);
}

/** A stair kink is sharp up close and straight a few pixels out. A real corner stays sharp. */
function stableCorner(points: readonly IsoPoint[], index: number, closed: boolean): boolean {
  const near = cornerTurn(points, index, 3, closed);
  const far = cornerTurn(points, index, 6, closed);
  return near >= 1 && far >= 0.65;
}

function cornerTurn(points: readonly IsoPoint[], index: number, window: number, closed: boolean): number {
  const count = points.length;
  if (!closed && (index < window || index + window >= count)) return 0;
  const previous = points[(index - window + count) % count];
  const point = points[index];
  const following = points[(index + window) % count];
  if (!previous || !point || !following) return 0;
  return jogTurn(previous, point, following);
}

/** Crossings of the source 0.5 contour along every label boundary, in source pixels. */
export function boundaryIsoPoints(
  labels: Uint16Array,
  width: number,
  height: number,
  rgba: Uint8Array,
  palette: readonly Rgb[]
): IsoPoint[] {
  const points: IsoPoint[] = [];
  const seen = new Uint8Array(labels.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const inside = labels[index] ?? TRANSPARENT;
      if (inside === TRANSPARENT || seen[index]) continue;
      const right = x + 1 < width ? (labels[index + 1] ?? TRANSPARENT) : TRANSPARENT;
      const below = y + 1 < height ? (labels[index + width] ?? TRANSPARENT) : TRANSPARENT;
      if (right !== inside && right !== TRANSPARENT) {
        seen[index] = 1;
        const labA = paletteLab(palette, inside);
        const labB = paletteLab(palette, right);
        if (labA && labB) points.push(pairCrossing(x, y, x + 1, y, width, height, rgba, labels, inside, right, labA, labB));
      }
      if (below !== inside && below !== TRANSPARENT) {
        const labA = paletteLab(palette, inside);
        const labB = paletteLab(palette, below);
        if (labA && labB) points.push(pairCrossing(x, y, x, y + 1, width, height, rgba, labels, inside, below, labA, labB));
      }
    }
  }
  return points;
}

function pairCrossing(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  height: number,
  rgba: Uint8Array,
  labels: Uint16Array,
  inside: number,
  outside: number,
  labA: Lab,
  labB: Lab
): IsoPoint {
  const insideT = sampleT(ax, ay, 1, width, height, rgba, labels, inside, outside, labA, labB);
  const outsideT = sampleT(bx, by, 0, width, height, rgba, labels, inside, outside, labA, labB);
  return dualCrossing(ax, ay, bx, by, insideT, outsideT);
}

/** Bilinear t=0.5 point on the segment joining the outside pixel center to the inside pixel center. */
function dualCrossing(insideX: number, insideY: number, outsideX: number, outsideY: number, insideT: number, outsideT: number): IsoPoint {
  const denom = insideT - outsideT;
  let u = Math.abs(denom) < 1e-4 ? 0.5 : (0.5 - outsideT) / denom;
  if (u < 0) u = 0;
  if (u > 1) u = 1;
  const originX = outsideX + 0.5;
  const originY = outsideY + 0.5;
  return { x: originX + (insideX + 0.5 - originX) * u, y: originY + (insideY + 0.5 - originY) * u };
}

/**
 * One sub-pixel point for a grid vertex, agreed by every chain that ends there.
 * A binary step keeps the integer vertex so a hard edge still meets its neighbor.
 */
function sharedJunction(
  point: IsoPoint,
  width: number,
  height: number,
  rgba: Uint8Array,
  labels: Uint16Array,
  palette: readonly Rgb[]
): IsoPoint {
  const gx = Math.round(point.x);
  const gy = Math.round(point.y);
  if (Math.abs(point.x - gx) > 0.01 || Math.abs(point.y - gy) > 0.01) return { x: point.x, y: point.y };
  const pairs: [number, number, number, number][] = [
    [gx - 1, gy - 1, gx, gy - 1],
    [gx - 1, gy, gx, gy],
    [gx - 1, gy - 1, gx - 1, gy],
    [gx, gy - 1, gx, gy]
  ];
  const crossings: IsoPoint[] = [];
  for (const pair of pairs) {
    const ax = pair[0];
    const ay = pair[1];
    const bx = pair[2];
    const by = pair[3];
    if (ax < 0 || ay < 0 || bx < 0 || by < 0 || ax >= width || ay >= height || bx >= width || by >= height) continue;
    const labelA = labels[ay * width + ax] ?? TRANSPARENT;
    const labelB = labels[by * width + bx] ?? TRANSPARENT;
    if (labelA === labelB || labelA === TRANSPARENT || labelB === TRANSPARENT) continue;
    const labA = paletteLab(palette, labelA);
    const labB = paletteLab(palette, labelB);
    if (!labA || !labB) continue;
    const tA = sampleT(ax, ay, 1, width, height, rgba, labels, labelA, labelB, labA, labB);
    const tB = sampleT(bx, by, 0, width, height, rgba, labels, labelA, labelB, labA, labB);
    if (tA <= 0.08 && tB >= 0.92) return { x: gx, y: gy };
    crossings.push(dualCrossing(ax, ay, bx, by, tA, tB));
  }
  if (crossings.length === 0) return { x: gx, y: gy };
  let x = 0;
  let y = 0;
  for (const crossing of crossings) {
    x += crossing.x;
    y += crossing.y;
  }
  return { x: x / crossings.length, y: y / crossings.length };
}

function edgePixels(ax: number, ay: number, bx: number, by: number): { inside: [number, number]; outside: [number, number] } | null {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 1 && dy === 0) return { inside: [ax, ay], outside: [ax, ay - 1] };
  if (dx === -1 && dy === 0) return { inside: [ax - 1, ay - 1], outside: [ax - 1, ay] };
  if (dx === 0 && dy === 1) return { inside: [ax - 1, ay], outside: [ax, ay] };
  if (dx === 0 && dy === -1) return { inside: [ax, ay - 1], outside: [ax - 1, ay - 1] };
  return null;
}

function blurredCoverage(x: number, y: number, width: number, height: number, coverageAt: (px: number, py: number) => number): number {
  const sigma = 0.7;
  const radius = 2;
  let sum = 0;
  let wsum = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const sx = x + dx;
      const sy = y + dy;
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
      const sample = coverageAt(sx, sy);
      if (Number.isNaN(sample)) continue;
      const w = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
      sum += sample * w;
      wsum += w;
    }
  }
  if (wsum <= 0) {
    const fallback = coverageAt(x, y);
    return Number.isNaN(fallback) ? 0.5 : fallback;
  }
  return sum / wsum;
}

function sampleT(
  x: number,
  y: number,
  k: number,
  width: number,
  height: number,
  rgba: Uint8Array,
  labels: Uint16Array,
  inside: number,
  outside: number,
  labA: Lab,
  labB: Lab
): number {
  if (x < 0 || y < 0 || x >= width || y >= height) return k <= 0 ? 1 : 0;
  const index = y * width + x;
  if ((rgba[index * 4 + 3] ?? 0) < 128) return 1;
  const label = labels[index] ?? TRANSPARENT;
  const lab = rgbToOklab(rgba[index * 4] ?? 0, rgba[index * 4 + 1] ?? 0, rgba[index * 4 + 2] ?? 0);
  const projected = coverageT(lab, labA, labB);
  if (label !== inside && label !== outside) return projected;
  return projected;
}

function coverageT(lab: Lab, from: Lab, to: Lab): number {
  const dl = to.l - from.l;
  const da = to.a - from.a;
  const db = to.b - from.b;
  const length2 = dl * dl + da * da + db * db;
  if (length2 < 1e-10) return 0.5;
  const t = ((lab.l - from.l) * dl + (lab.a - from.a) * da + (lab.b - from.b) * db) / length2;
  return Math.min(1, Math.max(0, t));
}

function dedupe(points: readonly IsoPoint[], closed: boolean): IsoPoint[] {
  const out: IsoPoint[] = [];
  for (const point of points) {
    const previous = out[out.length - 1];
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.001) continue;
    out.push(point);
  }
  if (closed && out.length > 2) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first && last && Math.hypot(first.x - last.x, first.y - last.y) < 0.001) out.pop();
  }
  return out;
}

function paletteLab(palette: readonly Rgb[], label: number): Lab | null {
  const color = palette[label];
  if (!color) return null;
  return rgbToOklab(color.r, color.g, color.b);
}
