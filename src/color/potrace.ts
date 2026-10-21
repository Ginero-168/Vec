/**
 * Potrace (Peter Selinger, 2003), written from the paper.
 * Bitmap corners are integer vertices. Black is on the left of every edge.
 * Parameters match the published defaults: alphamax 1, opttolerance 0.2, turdsize 2.
 */

export type PotraceCommand =
  | { readonly op: "L"; readonly x: number; readonly y: number }
  | {
      readonly op: "C";
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
    };

export type PotracePath = {
  readonly area: number;
  readonly start: { readonly x: number; readonly y: number };
  readonly commands: readonly PotraceCommand[];
};

export type PotraceOptions = {
  readonly alphamax?: number;
  readonly opttolerance?: number;
  readonly turdsize?: number;
  /** L∞ distance, in mask pixels, that still counts as a straight edge. */
  readonly straightness?: number;
};

type Pt = { x: number; y: number };

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

/** Trace a binary mask into closed compound contours, in mask-corner coordinates. */
export function traceMask(mask: Uint8Array, width: number, height: number, options: PotraceOptions = {}): PotracePath[] {
  if (width < 1 || height < 1 || mask.length < width * height) return [];
  const alphamax = options.alphamax ?? 1;
  const opttolerance = options.opttolerance ?? 0.2;
  const turdsize = options.turdsize ?? 2;
  const straightness = options.straightness ?? 1;
  const original = mask;
  const work = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) work[i] = mask[i] ? 1 : 0;
  const paths: PotracePath[] = [];
  const guard = width * height + 2;
  for (let pass = 0; pass < guard; pass++) {
    const start = findStart(work, width, height);
    if (!start) break;
    const walked = walkPath(work, original, width, height, start.x, start.y);
    if (walked.length < 4) {
      invertInterior(work, width, height, walked);
      continue;
    }
    const area = polygonArea(walked);
    invertInterior(work, width, height, walked);
    if (Math.abs(area) < turdsize) continue;
    const fitted = fitPath(walked, alphamax, opttolerance, area, straightness);
    if (fitted && fitted.commands.length >= 3) paths.push(fitted);
  }
  return paths;
}

function findStart(mask: Uint8Array, width: number, height: number): { x: number; y: number } | null {
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (mask[row + x] !== 1) continue;
      if (x === 0 || mask[row + x - 1] !== 1) return { x, y };
    }
  }
  return null;
}

function on(mask: Uint8Array, width: number, height: number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= width || y >= height) return false;
  return mask[y * width + x] === 1;
}

/** Pixel on the left of the edge that leaves (x, y) in direction `dir`. */
function leftOf(x: number, y: number, dir: number): { x: number; y: number } {
  const stepX = DX[dir] ?? 0;
  const stepY = DY[dir] ?? 0;
  return { x: Math.floor(x + stepX / 2 + stepY * 0.5), y: Math.floor(y + stepY / 2 - stepX * 0.5) };
}

function rightOf(x: number, y: number, dir: number): { x: number; y: number } {
  const stepX = DX[dir] ?? 0;
  const stepY = DY[dir] ?? 0;
  return { x: Math.floor(x + stepX / 2 - stepY * 0.5), y: Math.floor(y + stepY / 2 + stepX * 0.5) };
}

function edgeLegal(mask: Uint8Array, width: number, height: number, x: number, y: number, dir: number): boolean {
  const left = leftOf(x, y, dir);
  const right = rightOf(x, y, dir);
  return on(mask, width, height, left.x, left.y) && !on(mask, width, height, right.x, right.y);
}

function blackMajority(mask: Uint8Array, width: number, height: number, x: number, y: number): boolean {
  for (let radius = 2; radius <= 4; radius++) {
    let score = 0;
    for (let a = -radius + 1; a <= radius - 1; a++) {
      score += on(mask, width, height, x + a, y + radius - 1) ? 1 : -1;
      score += on(mask, width, height, x + radius - 1, y + a - 1) ? 1 : -1;
      score += on(mask, width, height, x + a - 1, y - radius) ? 1 : -1;
      score += on(mask, width, height, x - radius, y + a) ? 1 : -1;
    }
    if (score > 0) return true;
    if (score < 0) return false;
  }
  return false;
}

function chooseDir(
  work: Uint8Array,
  original: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  incoming: number
): number {
  let straight = false;
  let left = false;
  let right = false;
  const leftDir = (incoming + 3) & 3;
  const rightDir = (incoming + 1) & 3;
  if (edgeLegal(work, width, height, x, y, incoming)) straight = true;
  if (edgeLegal(work, width, height, x, y, leftDir)) left = true;
  if (edgeLegal(work, width, height, x, y, rightDir)) right = true;
  if (straight) return incoming;
  if (left && !right) return leftDir;
  if (right && !left) return rightDir;
  if (left && right) {
    const connectBlack = !blackMajority(original, width, height, x, y);
    const leftPixel = leftOf(x, y, leftDir);
    const rightPixel = leftOf(x, y, rightDir);
    const leftBlack = on(original, width, height, leftPixel.x, leftPixel.y);
    const rightBlack = on(original, width, height, rightPixel.x, rightPixel.y);
    if (connectBlack) {
      if (leftBlack && !rightBlack) return leftDir;
      if (rightBlack && !leftBlack) return rightDir;
    } else {
      if (leftBlack && !rightBlack) return rightDir;
      if (rightBlack && !leftBlack) return leftDir;
    }
    return connectBlack ? leftDir : rightDir;
  }
  for (let dir = 0; dir < 4; dir++) if (edgeLegal(work, width, height, x, y, dir)) return dir;
  return incoming;
}

function walkPath(work: Uint8Array, original: Uint8Array, width: number, height: number, x: number, y: number): Pt[] {
  let dir = 1;
  if (!edgeLegal(work, width, height, x, y, dir)) {
    for (let candidate = 0; candidate < 4; candidate++) {
      if (edgeLegal(work, width, height, x, y, candidate)) {
        dir = candidate;
        break;
      }
    }
  }
  const path: Pt[] = [{ x, y }];
  const startX = x;
  const startY = y;
  const startDir = dir;
  const limit = (width + 1) * (height + 1) * 2;
  for (let step = 0; step < limit; step++) {
    x += DX[dir] ?? 0;
    y += DY[dir] ?? 0;
    path.push({ x, y });
    if (x === startX && y === startY && dir === startDir) break;
    if (x === startX && y === startY) break;
    dir = chooseDir(work, original, width, height, x, y, dir);
  }
  return path;
}

function polygonArea(path: readonly Pt[]): number {
  let area = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i];
    const to = path[i + 1];
    if (!from || !to || from.y !== to.y) continue;
    area += from.y * (to.x - from.x);
  }
  return area;
}

function invertInterior(mask: Uint8Array, width: number, height: number, path: readonly Pt[]): void {
  const spans: number[][] = [];
  for (let y = 0; y < height; y++) spans.push([]);
  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i];
    const to = path[i + 1];
    if (!from || !to || from.x !== to.x) continue;
    const y0 = Math.min(from.y, to.y);
    const y1 = Math.max(from.y, to.y);
    for (let y = y0; y < y1; y++) {
      if (y >= 0 && y < height) spans[y]?.push(from.x);
    }
  }
  for (let y = 0; y < height; y++) {
    const xs = spans[y];
    if (!xs || xs.length === 0) continue;
    xs.sort((left, right) => left - right);
    const cleaned: number[] = [];
    for (let i = 0; i < xs.length; ) {
      let j = i + 1;
      while (j < xs.length && xs[j] === xs[i]) j++;
      if ((j - i) % 2 === 1) cleaned.push(xs[i] ?? 0);
      i = j;
    }
    const row = y * width;
    for (let k = 0; k + 1 < cleaned.length; k += 2) {
      const left = cleaned[k] ?? 0;
      const right = cleaned[k + 1] ?? 0;
      for (let x = left; x < right; x++) {
        if (x >= 0 && x < width) mask[row + x] = mask[row + x] === 1 ? 0 : 1;
      }
    }
  }
}

function fitPath(path: readonly Pt[], alphamax: number, opttolerance: number, area: number, straightness: number): PotracePath | null {
  const n = path.length - 1;
  if (n < 4) return null;
  const xs = new Int32Array(n);
  const ys = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = path[i]?.x ?? 0;
    ys[i] = path[i]?.y ?? 0;
  }
  const reach = straightReach(xs, ys, n, straightness);
  const polygon = optimalPolygon(xs, ys, n, reach);
  let maxReach = 0;
  for (let i = 0; i < n; i++) if ((reach[i] ?? 0) > maxReach) maxReach = reach[i] ?? 0;
  if (polygon.length < 3) return null;
  const adjusted = adjustVertices(xs, ys, n, polygon);
  return smoothAdjusted(adjusted, alphamax, opttolerance, area);
}

function dirBit(x0: number, y0: number, x1: number, y1: number): number {
  if (x1 > x0) return 1;
  if (y1 > y0) return 2;
  if (x1 < x0) return 4;
  if (y1 < y0) return 8;
  return 0;
}

function bitCount(value: number): number {
  let count = 0;
  let bits = value;
  while (bits > 0) {
    count += bits & 1;
    bits >>= 1;
  }
  return count;
}

/**
 * Longest straight extension, in edges, starting at each vertex.
 * A path is straight when it does not use all four directions and every
 * vertex lies in the L∞ 1-neighborhood of the chord through its ends
 * (the paper's triplewise line condition, evaluated on the chord).
 */
function straightReach(xs: Int32Array, ys: Int32Array, n: number, straightness: number): Int32Array {
  const reach = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    if ((reach[i] ?? 0) > 0) continue;
    const best = farthestStraight(xs, ys, n, i, straightness);
    reach[i] = best;
    if (best >= 24 && chordDeviation(xs, ys, n, i, best) <= 0.9) {
      for (let k = 1; k < best - 16; k++) {
        const index = (i + k) % n;
        const rest = best - k;
        if (rest > (reach[index] ?? 0)) reach[index] = rest;
      }
    }
  }
  return reach;
}

function farthestStraight(xs: Int32Array, ys: Int32Array, n: number, start: number, straightness: number): number {
  const cap = Math.min(n - 1, 96);
  let dirs = 0;
  let best = 1;
  let prevX = xs[start] ?? 0;
  let prevY = ys[start] ?? 0;
  for (let len = 1; len <= cap; len++) {
    const index = (start + len) % n;
    const x = xs[index] ?? 0;
    const y = ys[index] ?? 0;
    dirs |= dirBit(prevX, prevY, x, y);
    prevX = x;
    prevY = y;
    if (bitCount(dirs) >= 4) break;
    if (len <= 3 || chordFits(xs, ys, n, start, len, straightness)) best = len;
    else break;
  }
  return best;
}

function chordFits(xs: Int32Array, ys: Int32Array, n: number, start: number, edges: number, straightness: number): boolean {
  const x0 = xs[start] ?? 0;
  const y0 = ys[start] ?? 0;
  const end = (start + edges) % n;
  const x1 = xs[end] ?? 0;
  const y1 = ys[end] ?? 0;
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (dx === 0 && dy === 0) return edges <= 3;
  for (let step = 1; step < edges; step++) {
    const index = (start + step) % n;
    const prev = (start + step - 1 + n) % n;
    const next = (start + step + 1) % n;
    const px = xs[index] ?? 0;
    const py = ys[index] ?? 0;
    if ((xs[next] ?? 0) - px === px - (xs[prev] ?? 0) && (ys[next] ?? 0) - py === py - (ys[prev] ?? 0)) continue;
    if (!lineHitsSquare(x0, y0, x1, y1, px, py, straightness)) return false;
  }
  return true;
}

function chordDeviation(xs: Int32Array, ys: Int32Array, n: number, start: number, edges: number): number {
  const x0 = xs[start] ?? 0;
  const y0 = ys[start] ?? 0;
  const end = (start + edges) % n;
  const x1 = xs[end] ?? 0;
  const y1 = ys[end] ?? 0;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return 0;
  let worst = 0;
  for (let step = 1; step < edges; step++) {
    const index = (start + step) % n;
    const cross = Math.abs(((xs[index] ?? 0) - x0) * dy - ((ys[index] ?? 0) - y0) * dx);
    const distance = cross / length;
    if (distance > worst) worst = distance;
  }
  return worst;
}

function lineHitsSquare(ax: number, ay: number, bx: number, by: number, px: number, py: number, radius: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.max(Math.abs(px - ax), Math.abs(py - ay)) <= radius;
  let low = -1e18;
  let high = 1e18;
  const constrain = (delta: number, span: number): boolean => {
    if (span === 0) return Math.abs(delta) <= radius;
    const left = (delta - radius) / span;
    const right = (delta + radius) / span;
    low = Math.max(low, Math.min(left, right));
    high = Math.min(high, Math.max(left, right));
    return low <= high + 1e-8;
  };
  return constrain(px - ax, dx) && constrain(py - ay, dy);
}

function optimalPolygon(xs: Int32Array, ys: Int32Array, n: number, reach: Int32Array): number[] {
  let origin = 0;
  let sharpest = -1;
  const window = Math.min(6, Math.floor(n / 4));
  for (let i = 0; i < n; i++) {
    const previous = (i - window + n) % n;
    const next = (i + window) % n;
    const turn = Math.abs(cornerTurn(xs[previous] ?? 0, ys[previous] ?? 0, xs[i] ?? 0, ys[i] ?? 0, xs[next] ?? 0, ys[next] ?? 0));
    if (turn > sharpest) {
      sharpest = turn;
      origin = i;
    }
  }
  const count = new Int32Array(n + 1);
  const penalty = new Float64Array(n + 1);
  const previous = new Int32Array(n + 1);
  count.fill(1_000_000);
  penalty.fill(Infinity);
  previous.fill(-1);
  count[0] = 0;
  penalty[0] = 0;
  const prefix = prefixSums(xs, ys, n, origin);
  for (let i = 0; i < n; i++) {
    if ((count[i] ?? 0) >= 1_000_000) continue;
    const at = (origin + i) % n;
    const pred = (at - 1 + n) % n;
    const maxLen = Math.min(n - 3, Math.max(0, (reach[pred] ?? 0) - 2));
    for (let len = 1; len <= maxLen && i + len <= n; len++) {
      if (i === 0 && i + len === n) continue;
      const j = i + len;
      const add = segmentPenalty(prefix, i, j, n);
      const nextCount = (count[i] ?? 0) + 1;
      const nextPenalty = (penalty[i] ?? 0) + add;
      if (nextCount < (count[j] ?? 0) || (nextCount === count[j] && nextPenalty < (penalty[j] ?? Infinity))) {
        count[j] = nextCount;
        penalty[j] = nextPenalty;
        previous[j] = i;
      }
    }
  }
  if ((count[n] ?? 0) >= 1_000_000 || (count[n] ?? 0) < 3) return decimate(xs, ys, n, origin);
  const indices: number[] = [];
  let cursor = n;
  while (cursor > 0) {
    const prior = previous[cursor] ?? -1;
    if (prior < 0) break;
    indices.push((origin + prior) % n);
    cursor = prior;
  }
  indices.reverse();
  return indices.length >= 3 ? indices : decimate(xs, ys, n, origin);
}

function cornerTurn(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const inX = bx - ax;
  const inY = by - ay;
  const outX = cx - bx;
  const outY = cy - by;
  const cross = inX * outY - inY * outX;
  const dot = inX * outX + inY * outY;
  return Math.atan2(cross, dot);
}

type Sums = {
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly xx: Float64Array;
  readonly yy: Float64Array;
  readonly xy: Float64Array;
  readonly ox: number;
  readonly oy: number;
};

function prefixSums(xs: Int32Array, ys: Int32Array, n: number, origin: number): Sums {
  const x = new Float64Array(n + 1);
  const y = new Float64Array(n + 1);
  const xx = new Float64Array(n + 1);
  const yy = new Float64Array(n + 1);
  const xy = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const px = xs[(origin + i) % n] ?? 0;
    const py = ys[(origin + i) % n] ?? 0;
    x[i + 1] = (x[i] ?? 0) + px;
    y[i + 1] = (y[i] ?? 0) + py;
    xx[i + 1] = (xx[i] ?? 0) + px * px;
    yy[i + 1] = (yy[i] ?? 0) + py * py;
    xy[i + 1] = (xy[i] ?? 0) + px * py;
  }
  return { x, y, xx, yy, xy, ox: xs[origin] ?? 0, oy: ys[origin] ?? 0 };
}

function segmentPenalty(sums: Sums, i: number, j: number, n: number): number {
  const count = j - i + 1;
  if (count <= 1) return 0;
  const closed = j === n;
  const sx = closed ? (sums.x[n] ?? 0) - (sums.x[i] ?? 0) + sums.ox : (sums.x[j + 1] ?? 0) - (sums.x[i] ?? 0);
  const sy = closed ? (sums.y[n] ?? 0) - (sums.y[i] ?? 0) + sums.oy : (sums.y[j + 1] ?? 0) - (sums.y[i] ?? 0);
  const sxx = closed ? (sums.xx[n] ?? 0) - (sums.xx[i] ?? 0) + sums.ox * sums.ox : (sums.xx[j + 1] ?? 0) - (sums.xx[i] ?? 0);
  const syy = closed ? (sums.yy[n] ?? 0) - (sums.yy[i] ?? 0) + sums.oy * sums.oy : (sums.yy[j + 1] ?? 0) - (sums.yy[i] ?? 0);
  const sxy = closed ? (sums.xy[n] ?? 0) - (sums.xy[i] ?? 0) + sums.ox * sums.oy : (sums.xy[j + 1] ?? 0) - (sums.xy[i] ?? 0);
  const x0 = pointAt(sums, i);
  const x1 = pointAt(sums, closed ? 0 : j);
  const vx = x1.x - x0.x;
  const vy = x1.y - x0.y;
  const mx = (x0.x + x1.x) / 2;
  const my = (x0.y + x1.y) / 2;
  const ex = sx / count;
  const ey = sy / count;
  const a = sxx / count - 2 * mx * ex + mx * mx;
  const b = sxy / count - mx * ey - my * ex + mx * my;
  const c = syy / count - 2 * my * ey + my * my;
  return Math.sqrt(Math.max(0, c * vx * vx + 2 * b * vx * vy + a * vy * vy));
}

function pointAt(sums: Sums, index: number): Pt {
  return {
    x: (sums.x[index + 1] ?? 0) - (sums.x[index] ?? 0),
    y: (sums.y[index + 1] ?? 0) - (sums.y[index] ?? 0)
  };
}

function decimate(xs: Int32Array, ys: Int32Array, n: number, origin: number): number[] {
  const indices: number[] = [];
  const step = Math.max(1, Math.floor(n / 12));
  for (let i = 0; i < n; i += step) indices.push((origin + i) % n);
  return indices.length >= 3 ? indices : [0, Math.floor(n / 3), Math.floor((2 * n) / 3)];
}

function adjustVertices(xs: Int32Array, ys: Int32Array, n: number, polygon: readonly number[]): Pt[] {
  const m = polygon.length;
  const lines = polygon.map((start, index) => {
    const end = polygon[(index + 1) % m] ?? start;
    return fitLine(xs, ys, n, start, end);
  });
  return polygon.map((index, vertex) => {
    const original = { x: xs[index] ?? 0, y: ys[index] ?? 0 };
    const left = lines[(vertex - 1 + m) % m];
    const right = lines[vertex];
    if (!left || !right) return original;
    const hit = intersectLines(left, right);
    if (!hit) return original;
    return clampSquare(hit, original, 0.5);
  });
}

type Line = { readonly px: number; readonly py: number; readonly dx: number; readonly dy: number };

function fitLine(xs: Int32Array, ys: Int32Array, n: number, start: number, end: number): Line {
  let count = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let cursor = start;
  const guard = n + 1;
  for (let step = 0; step < guard; step++) {
    const x = xs[cursor] ?? 0;
    const y = ys[cursor] ?? 0;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
    count++;
    if (cursor === end) break;
    cursor = (cursor + 1) % n;
  }
  const mx = sx / count;
  const my = sy / count;
  const a = sxx / count - mx * mx;
  const b = sxy / count - mx * my;
  const c = syy / count - my * my;
  let dx = 1;
  let dy = 0;
  if (Math.abs(b) > 1e-8 || Math.abs(a - c) > 1e-8) {
    const theta = 0.5 * Math.atan2(2 * b, a - c);
    dx = Math.cos(theta);
    dy = Math.sin(theta);
  } else if (c > a) {
    dx = 0;
    dy = 1;
  }
  return { px: mx, py: my, dx, dy };
}

function intersectLines(left: Line, right: Line): Pt | null {
  const cross = left.dx * right.dy - left.dy * right.dx;
  if (Math.abs(cross) < 1e-8) return null;
  const t = ((right.px - left.px) * right.dy - (right.py - left.py) * right.dx) / cross;
  return { x: left.px + left.dx * t, y: left.py + left.dy * t };
}

function clampSquare(point: Pt, origin: Pt, radius: number): Pt {
  return {
    x: Math.min(origin.x + radius, Math.max(origin.x - radius, point.x)),
    y: Math.min(origin.y + radius, Math.max(origin.y - radius, point.y))
  };
}

function smoothAdjusted(points: readonly Pt[], alphamax: number, opttolerance: number, area: number): PotracePath | null {
  const count = points.length;
  if (count < 3) return null;
  const mid: Pt[] = [];
  const corner: boolean[] = [];
  const alpha: number[] = [];
  for (let i = 0; i < count; i++) {
    const current = points[i];
    const next = points[(i + 1) % count];
    if (!current || !next) return null;
    mid.push({ x: (current.x + next.x) / 2, y: (current.y + next.y) / 2 });
    const previous = points[(i - 1 + count) % count];
    if (!previous) return null;
    const value = cornerParameter(previous, current, next);
    const sharp = value > alphamax;
    corner.push(sharp);
    alpha.push(sharp ? value : Math.min(1, Math.max(0.55, value)));
  }
  const merged = mergeSmooth(points, mid, corner, alpha, opttolerance);
  const flat = flattenStraight(merged.start, merged.commands, Math.max(opttolerance, 0.85));
  return { area, start: flat.start, commands: flat.commands };
}

/** A curve whose controls sit on its chord is a line. Collinear lines become one. */
function flattenStraight(start: Pt, commands: readonly PotraceCommand[], tolerance: number): { start: Pt; commands: PotraceCommand[] } {
  const ends: Pt[] = [start];
  const kinds: Array<"L" | "C"> = [];
  let x = start.x;
  let y = start.y;
  for (const command of commands) {
    if (command.op === "L" || controlDeviation(x, y, command) <= tolerance) kinds.push("L");
    else kinds.push("C");
    ends.push({ x: command.x, y: command.y });
    x = command.x;
    y = command.y;
  }
  const keep = new Uint8Array(kinds.length).fill(1);
  const count = kinds.length;
  for (let i = 1; i < count; i++) {
    if (kinds[i] !== "L" || kinds[i - 1] !== "L") continue;
    const before = ends[i - 1];
    const middle = ends[i];
    const after = ends[i + 1];
    if (!before || !middle || !after) continue;
    if (pointSegmentDistance(middle, before, after) <= tolerance) keep[i - 1] = 0;
  }
  const out: PotraceCommand[] = [];
  for (let i = 0; i < count; i++) {
    if (!keep[i]) continue;
    const end = ends[i + 1];
    const command = commands[i];
    if (!end || !command) continue;
    if (kinds[i] === "L") out.push({ op: "L", x: end.x, y: end.y });
    else out.push(command);
  }
  return { start, commands: out.length >= 3 ? out : commands.slice() };
}

function controlDeviation(x: number, y: number, command: PotraceCommand): number {
  if (command.op === "L") return 0;
  const end = { x: command.x, y: command.y };
  const origin = { x, y };
  return Math.max(pointSegmentDistance({ x: command.x1, y: command.y1 }, origin, end), pointSegmentDistance({ x: command.x2, y: command.y2 }, origin, end));
}

/**
 * α = 4γ/3 from the unit square touched by a line parallel to the opposite
 * midpoint chord. α > alphamax is a corner; otherwise the curve is clamped
 * into [0.55, 1].
 */
function cornerParameter(previous: Pt, current: Pt, next: Pt): number {
  const b0 = { x: (previous.x + current.x) / 2, y: (previous.y + current.y) / 2 };
  const b1 = { x: (current.x + next.x) / 2, y: (current.y + next.y) / 2 };
  const dx = b1.x - b0.x;
  const dy = b1.y - b0.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-8) return 4 / 3;
  const nx = -dy / length;
  const ny = dx / length;
  const lineS = (b0.x - current.x) * nx + (b0.y - current.y) * ny;
  if (Math.abs(lineS) < 1e-8) return 4 / 3;
  const support = 0.5 * (Math.abs(nx) + Math.abs(ny));
  const touch = Math.abs(lineS - support) <= Math.abs(lineS + support) ? support : -support;
  const gamma = 1 - touch / lineS;
  return (4 / 3) * gamma;
}

function mergeSmooth(
  points: readonly Pt[],
  mid: readonly Pt[],
  corner: readonly boolean[],
  alpha: readonly number[],
  tolerance: number
): { start: Pt; commands: PotraceCommand[] } {
  const count = points.length;
  const drop = new Uint8Array(count);
  if (tolerance > 0) {
    let index = 0;
    while (index < count) {
      if (corner[index]) {
        index++;
        continue;
      }
      let end = index;
      while (end < count && !corner[end]) end++;
      greedyMerge(points, corner, drop, index, end, tolerance);
      index = end;
    }
  }
  const kept: number[] = [];
  for (let i = 0; i < count; i++) if (!drop[i]) kept.push(i);
  if (kept.length < 3) {
    for (let i = 0; i < count; i++) drop[i] = 0;
    kept.length = 0;
    for (let i = 0; i < count; i++) kept.push(i);
  }
  const startIndex = kept[kept.length - 1] ?? 0;
  const start = mid[startIndex] ?? { x: 0, y: 0 };
  const commands: PotraceCommand[] = [];
  for (let k = 0; k < kept.length; k++) {
    const i = kept[k] ?? 0;
    const next = kept[(k + 1) % kept.length] ?? i;
    const current = points[i];
    const bCur = mid[i];
    const bPrev = mid[(i - 1 + count) % count];
    if (!current || !bCur || !bPrev) continue;
    if (corner[i]) {
      commands.push({ op: "L", x: current.x, y: current.y });
      if (!corner[next]) commands.push({ op: "L", x: bCur.x, y: bCur.y });
      continue;
    }
    const t = 0.5 + 0.5 * (alpha[i] ?? 0.8);
    commands.push({
      op: "C",
      x1: bPrev.x + (current.x - bPrev.x) * t,
      y1: bPrev.y + (current.y - bPrev.y) * t,
      x2: bCur.x + (current.x - bCur.x) * t,
      y2: bCur.y + (current.y - bCur.y) * t,
      x: bCur.x,
      y: bCur.y
    });
  }
  return { start, commands };
}

function greedyMerge(
  points: readonly Pt[],
  corner: readonly boolean[],
  drop: Uint8Array,
  from: number,
  to: number,
  tolerance: number
): void {
  const run = to - from;
  if (run < 2) return;
  let cursor = from;
  while (cursor < to - 1) {
    let best = cursor;
    for (let end = cursor + 1; end < to; end++) {
      if (!sameConvexity(points, cursor, end) || !withinTolerance(points, cursor, end, tolerance)) break;
      best = end;
    }
    for (let i = cursor + 1; i <= best; i++) if (!corner[i]) drop[i] = 1;
    cursor = best + 1;
  }
}

function sameConvexity(points: readonly Pt[], from: number, to: number): boolean {
  let sign = 0;
  for (let i = from; i <= to; i++) {
    const previous = points[(i - 1 + points.length) % points.length];
    const current = points[i];
    const next = points[(i + 1) % points.length];
    if (!previous || !current || !next) return false;
    const cross = (current.x - previous.x) * (next.y - current.y) - (current.y - previous.y) * (next.x - current.x);
    const nextSign = cross > 1e-6 ? 1 : cross < -1e-6 ? -1 : 0;
    if (nextSign === 0) continue;
    if (sign === 0) sign = nextSign;
    else if (sign !== nextSign) return false;
  }
  return true;
}

function withinTolerance(points: readonly Pt[], from: number, to: number, tolerance: number): boolean {
  const start = points[from];
  const end = points[(to + 1) % points.length];
  if (!start || !end) return false;
  for (let i = from; i <= to; i++) {
    const point = points[i];
    if (!point) return false;
    if (pointSegmentDistance(point, start, end) > tolerance + 0.5) return false;
  }
  const samples = sampleRange(points, from, to);
  const curve = approximatingCubic(points, from, to);
  if (!curve) return false;
  for (const sample of samples) {
    if (distanceToCubic(sample, curve) > tolerance) return false;
  }
  return true;
}

function pointSegmentDistance(point: Pt, from: Pt, to: Pt): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  if (length < 1e-8) return Math.hypot(point.x - from.x, point.y - from.y);
  let t = ((point.x - from.x) * dx + (point.y - from.y) * dy) / length;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(point.x - (from.x + dx * t), point.y - (from.y + dy * t));
}

function sampleRange(points: readonly Pt[], from: number, to: number): Pt[] {
  const out: Pt[] = [];
  for (let i = from; i <= to; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    if (!current || !next) continue;
    out.push(current);
    out.push({ x: (current.x + next.x) / 2, y: (current.y + next.y) / 2 });
  }
  return out;
}

function approximatingCubic(points: readonly Pt[], from: number, to: number): { p0: Pt; p1: Pt; p2: Pt; p3: Pt } | null {
  const count = points.length;
  const p0 = points[from];
  const p3 = points[(to + 1) % count];
  const incoming = points[(from - 1 + count) % count];
  const outgoing = points[(to + 2) % count];
  if (!p0 || !p3 || !incoming || !outgoing) return null;
  const t0 = unit(p0.x - incoming.x, p0.y - incoming.y);
  const t1 = unit(p3.x - outgoing.x, p3.y - outgoing.y);
  if (!t0 || !t1) return null;
  const cross = t0.x * t1.y - t0.y * t1.x;
  const length = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  const handle = Math.max(0.5, length * 0.35);
  if (Math.abs(cross) < 1e-4) {
    return {
      p0,
      p1: { x: p0.x + t0.x * handle, y: p0.y + t0.y * handle },
      p2: { x: p3.x + t1.x * handle, y: p3.y + t1.y * handle },
      p3
    };
  }
  const denom = t0.x * t1.y - t0.y * t1.x;
  const t = ((p3.x - p0.x) * t1.y - (p3.y - p0.y) * t1.x) / denom;
  const origin = { x: p0.x + t0.x * t, y: p0.y + t0.y * t };
  const alpha = 0.75;
  return {
    p0,
    p1: { x: p0.x + (origin.x - p0.x) * alpha, y: p0.y + (origin.y - p0.y) * alpha },
    p2: { x: p3.x + (origin.x - p3.x) * alpha, y: p3.y + (origin.y - p3.y) * alpha },
    p3
  };
}

function unit(x: number, y: number): Pt | null {
  const length = Math.hypot(x, y);
  if (length < 1e-6) return null;
  return { x: x / length, y: y / length };
}

function distanceToCubic(point: Pt, curve: { p0: Pt; p1: Pt; p2: Pt; p3: Pt }): number {
  let best = Infinity;
  for (let step = 0; step <= 8; step++) {
    const t = step / 8;
    const u = 1 - t;
    const x = u * u * u * curve.p0.x + 3 * u * u * t * curve.p1.x + 3 * u * t * t * curve.p2.x + t * t * t * curve.p3.x;
    const y = u * u * u * curve.p0.y + 3 * u * u * t * curve.p1.y + 3 * u * t * t * curve.p2.y + t * t * t * curve.p3.y;
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance < best) best = distance;
  }
  return best;
}
