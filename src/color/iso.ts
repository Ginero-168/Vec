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
  labels: Uint16Array
): { points: IsoPoint[]; soft: boolean } {
  const original = points.map((point) => ({ x: point.x, y: point.y }));
  if (outside === TRANSPARENT || inside === TRANSPARENT || points.length < 2) return { points: original, soft: false };
  const labA = paletteLab(palette, inside);
  const labB = paletteLab(palette, outside);
  if (!labA || !labB) return { points: original, soft: false };
  const edgeCount = closed ? points.length : points.length - 1;
  if (edgeCount < 1) return { points: original, soft: false };
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
    insideRaw.push(sampleT(ends.inside[0], ends.inside[1], 1, width, height, rgba, labels, inside, outside, labA, labB));
    outsideRaw.push(sampleT(ends.outside[0], ends.outside[1], 0, width, height, rgba, labels, inside, outside, labA, labB));
  }
  const insideT = smoothLine(smoothLine(insideRaw, closed), closed);
  const outsideT = smoothLine(smoothLine(outsideRaw, closed), closed);
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
    const loop = relaxJogs(dedupe(crossings, true), true);
    if (loop.length < 3) return { points: original, soft: false };
    return { points: loop, soft: true };
  }
  const start = points[0];
  const end = points[points.length - 1];
  if (!start || !end) return { points: original, soft: false };
  const open = relaxJogs(
    dedupe(
      [sharedJunction(start, width, height, rgba, labels, palette), ...crossings, sharedJunction(end, width, height, rgba, labels, palette)],
      false
    ),
    false
  );
  if (open.length < 2) return { points: original, soft: false };
  return { points: open, soft: true };
}

/**
 * Pull short grid jogs onto the chord of their neighbors. A real corner, with
 * two long arms, stays where the iso-line put it. Straight runs are unchanged.
 */
function relaxJogs(points: readonly IsoPoint[], closed: boolean): IsoPoint[] {
  const count = points.length;
  if (count < 3) return points.map((point) => ({ x: point.x, y: point.y }));
  let current = points.map((point) => ({ x: point.x, y: point.y }));
  for (let pass = 0; pass < 6; pass++) {
    const next = current.map((point) => ({ x: point.x, y: point.y }));
    const first = closed ? 0 : 1;
    const last = closed ? count : count - 1;
    for (let i = first; i < last; i++) {
      const previous = current[(i - 1 + count) % count]!;
      const point = current[i]!;
      const following = current[(i + 1) % count]!;
      const incoming = Math.hypot(point.x - previous.x, point.y - previous.y);
      const outgoing = Math.hypot(following.x - point.x, following.y - point.y);
      if (incoming > 2.4 && outgoing > 2.4) continue;
      const turn = jogTurn(previous, point, following);
      if (turn < 0.55) continue;
      const weight = turn > 2.2 ? 0.85 : 0.62;
      next[i] = {
        x: point.x * (1 - weight) + ((previous.x + following.x) / 2) * weight,
        y: point.y * (1 - weight) + ((previous.y + following.y) / 2) * weight
      };
    }
    current = next;
  }
  return current;
}

function jogTurn(a: IsoPoint, b: IsoPoint, c: IsoPoint): number {
  const incoming = Math.atan2(b.y - a.y, b.x - a.x);
  const outgoing = Math.atan2(c.y - b.y, c.x - b.x);
  let delta = outgoing - incoming;
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return Math.abs(delta);
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

function smoothLine(values: readonly number[], closed: boolean): number[] {
  const count = values.length;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const previous = values[closed ? (i - 1 + count) % count : Math.max(0, i - 1)] ?? 0;
    const next = values[closed ? (i + 1) % count : Math.min(count - 1, i + 1)] ?? 0;
    out.push(0.25 * previous + 0.5 * (values[i] ?? 0) + 0.25 * next);
  }
  return out;
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
