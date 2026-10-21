import { TRANSPARENT, type Rgb } from "./model";
import { oklabDistance, rgbToOklab } from "./oklab";
import type { SnapAxis, VecCommand } from "./trace";

type Point = { x: number; y: number };

export type CleanFit = {
  readonly start: Point;
  readonly commands: readonly VecCommand[];
};

const KAPPA = 0.5522847498307936;

/** Strength 0 is off. 1 is the strongest automatic tolerance, in source pixels. */
export function cleanTolerance(strength: number): number {
  const t = Math.min(1, Math.max(0, strength));
  if (t <= 0) return 0;
  // The base tracer already drops sub-1.15px stairs. The slider has to sit above that
  // or turning clean shapes on leaves the same anchors.
  return 1.15 + t * 2.15;
}

/** The Smooth tool fits a selected boundary harder than the default slider. */
export function strongCleanTolerance(strength: number): number {
  return Math.max(cleanTolerance(strength), 2.05);
}

/**
 * Pixels that belong to a thin, high-contrast, non-ray component.
 * Clean shapes leaves those boundaries on the existing fitter.
 */
export function letterMask(labels: Uint16Array, width: number, height: number, palette: readonly Rgb[]): Uint8Array {
  const mask = new Uint8Array(labels.length);
  const owner = new Int32Array(labels.length);
  owner.fill(-1);
  const stack: number[] = [];
  const labs = palette.map((color) => rgbToOklab(color.r, color.g, color.b));
  for (let start = 0; start < labels.length; start++) {
    const label = labels[start] ?? TRANSPARENT;
    if (label === TRANSPARENT || owner[start] !== -1) continue;
    const pixels: number[] = [];
    const adjacency = new Map<number, number>();
    stack.push(start);
    owner[start] = 1;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      pixels.push(current);
      const x = current % width;
      const y = (current - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const neighbors = [current - 1, current + 1, current - width, current + width];
      for (const next of neighbors) {
        if (next < 0 || next >= labels.length) {
          adjacency.set(TRANSPARENT, (adjacency.get(TRANSPARENT) ?? 0) + 1);
          continue;
        }
        const nx = next % width;
        if (Math.abs(nx - x) + Math.abs(Math.floor(next / width) - y) !== 1) {
          adjacency.set(TRANSPARENT, (adjacency.get(TRANSPARENT) ?? 0) + 1);
          continue;
        }
        const neighbor = labels[next] ?? TRANSPARENT;
        if (neighbor === label) {
          if (owner[next] === -1) {
            owner[next] = 1;
            stack.push(next);
          }
        } else adjacency.set(neighbor, (adjacency.get(neighbor) ?? 0) + 1);
      }
    }
    if (pixels.length < 12 || pixels.length > 8000) continue;
    const thick = thickness(pixels, width, height, 5);
    if (thick > 4) continue;
    const boxArea = (maxX - minX + 1) * (maxY - minY + 1);
    if (boxArea > 0 && pixels.length / boxArea > 0.82 && Math.min(maxX - minX, maxY - minY) >= 8) continue;
    let contrast = 0;
    let dominant = TRANSPARENT;
    let dominantCount = 0;
    for (const [neighbor, count] of adjacency) {
      if (count > dominantCount) {
        dominant = neighbor;
        dominantCount = count;
      }
    }
    const own = labs[label];
    if (dominant === TRANSPARENT || dominant >= labs.length) contrast = 1;
    else {
      const other = labs[dominant];
      if (own && other) contrast = oklabDistance(own, other);
    }
    if (!own || contrast < 0.18) continue;
    if (rayLike(pixels, width, minX, minY, maxX, maxY)) continue;
    for (const pixel of pixels) mask[pixel] = 1;
  }
  return mask;
}

export function boundaryHits(
  mask: Uint8Array,
  width: number,
  height: number,
  points: readonly Point[],
  fraction: number
): boolean {
  if (points.length === 0) return false;
  let hits = 0;
  let samples = 0;
  const step = Math.max(1, Math.floor(points.length / 48));
  for (let i = 0; i < points.length; i += step) {
    const point = points[i];
    if (!point) continue;
    samples++;
    if (nearMask(mask, width, height, point.x, point.y)) hits++;
  }
  if (samples === 0) return false;
  if (fraction <= 0) return hits > 0;
  return hits / samples >= fraction;
}

export function fitOpenClean(points: readonly Point[], tolerance: number): VecCommand[] {
  if (points.length < 2) return [];
  const coarse = Math.min(0.9, Math.max(0.4, tolerance * 0.32));
  const kept = decimateIndexed(points, coarse);
  const guide = kept.map((index) => points[index]!);
  const cuts = [0];
  if (guide.length >= 12) {
    for (const cut of crispCorners(guide, false)) {
      const index = kept[cut];
      if (index !== undefined && index > 0 && index < points.length - 1) cuts.push(index);
    }
  }
  cuts.push(points.length - 1);
  const commands: VecCommand[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const span = points.slice(cuts[i]!, cuts[i + 1]! + 1);
    commands.push(...shorterSpan(span, tolerance));
  }
  const end = points[points.length - 1];
  return end ? pinEnd(commands, end) : commands;
}

function shorterSpan(points: readonly Point[], tolerance: number): VecCommand[] {
  const smooth = flattenPieces(fitSmoothSpan(points, tolerance, 0));
  const linear = chordFit(points, tolerance);
  if (smooth.length > 0 && (linear.length === 0 || smooth.length <= linear.length)) return smooth;
  return linear.length > 0 ? linear : smooth;
}

function chordFit(points: readonly Point[], tolerance: number): VecCommand[] {
  const guide = decimateOpen(points, tolerance);
  const commands: VecCommand[] = [];
  for (let i = 1; i < guide.length; i++) {
    const from = guide[i - 1];
    const to = guide[i];
    if (!from || !to) continue;
    const line = tryLine([from, to], tolerance);
    if (line) commands.push(...line.commands);
    else commands.push({ op: "L", x: to.x, y: to.y, primitive: "line" });
  }
  return commands;
}

export function fitClosedClean(points: readonly Point[], tolerance: number): CleanFit | null {
  if (points.length < 6) return null;
  const direct = acceptFit(fitClosedPrimitives(points, tolerance), points, tolerance);
  if (direct) return direct;
  const guided = fitClosedGuided(points, tolerance);
  if (guided) return guided;
  return acceptFit(fitClosedRaw(points, tolerance), points, tolerance) ?? fitClosedRaw(points, tolerance);
}

function acceptFit(fit: CleanFit | null, points: readonly Point[], tolerance: number): CleanFit | null {
  if (!fit || fit.commands.length === 0) return null;
  if (sampleCurveError(fit.start, fit.commands, points) > tolerance) return null;
  return fit;
}

function thickness(pixels: readonly number[], width: number, height: number, limit: number): number {
  const alive = new Set(pixels);
  let steps = 0;
  while (alive.size > 0 && steps <= limit) {
    const remove: number[] = [];
    for (const pixel of alive) {
      const x = pixel % width;
      const y = (pixel - x) / width;
      const exposed =
        x === 0 ||
        y === 0 ||
        x + 1 === width ||
        y + 1 === height ||
        !alive.has(pixel - 1) ||
        !alive.has(pixel + 1) ||
        !alive.has(pixel - width) ||
        !alive.has(pixel + width);
      if (exposed) remove.push(pixel);
    }
    if (remove.length === 0) return steps + 1;
    for (const pixel of remove) alive.delete(pixel);
    steps++;
  }
  return alive.size > 0 ? limit + 1 : steps;
}

function rayLike(pixels: readonly number[], width: number, minX: number, minY: number, maxX: number, maxY: number): boolean {
  const dx = maxX - minX;
  const dy = maxY - minY;
  const length = Math.hypot(dx, dy);
  if (length < 10) return false;
  let maxDistance = 0;
  for (const pixel of pixels) {
    const x = pixel % width;
    const y = (pixel - x) / width;
    maxDistance = Math.max(maxDistance, pointSegmentDistance({ x, y }, { x: minX, y: minY }, { x: maxX, y: maxY }));
  }
  return maxDistance <= 2.4 && length / Math.max(1, maxDistance) >= 8;
}

function nearMask(mask: Uint8Array, width: number, height: number, x: number, y: number): boolean {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  for (let dy = -1; dy <= 0; dy++) {
    for (let dx = -1; dx <= 0; dx++) {
      const px = x0 + dx;
      const py = y0 + dy;
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      if ((mask[py * width + px] ?? 0) > 0) return true;
    }
  }
  return false;
}

type Piece = { readonly commands: readonly VecCommand[] };

function flattenPieces(pieces: readonly Piece[]): VecCommand[] {
  const commands: VecCommand[] = [];
  for (const piece of pieces) commands.push(...piece.commands);
  return commands;
}

function tryLine(points: readonly Point[], tolerance: number): Piece | null {
  const start = points[0];
  const end = points[points.length - 1];
  if (!start || !end) return null;
  const chord = maxSegmentError(points, start, end);
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const snap = nearestSnap(angle);
  if (chord <= tolerance) {
    return { commands: [{ op: "L", x: end.x, y: end.y, primitive: "line", snap: snap?.name }] };
  }
  if (!snap) return null;
  const snapped = projectSegment(points, snap.axis);
  if (!snapped || maxSegmentError(points, snapped.start, snapped.end) > tolerance) return null;
  const move = Math.max(Math.hypot(snapped.start.x - start.x, snapped.start.y - start.y), Math.hypot(snapped.end.x - end.x, snapped.end.y - end.y));
  if (move > 0.05) return null;
  return { commands: [{ op: "L", x: end.x, y: end.y, primitive: "line", snap: snap.name }] };
}

function tryArc(points: readonly Point[], tolerance: number): Piece | null {
  const start = points[0];
  const end = points[points.length - 1];
  if (!start || !end || points.length < 6) return null;
  const circle = fitCircle(points);
  if (!circle) return null;
  const chord = Math.hypot(end.x - start.x, end.y - start.y);
  if (circle.r > Math.max(48, chord * 6)) return null;
  let maxError = 0;
  for (const point of points) maxError = Math.max(maxError, Math.abs(Math.hypot(point.x - circle.cx, point.y - circle.cy) - circle.r));
  if (maxError > tolerance) return null;
  const sweep = sweepAbout(points, circle);
  if (Math.abs(sweep) < 0.4 || Math.abs(sweep) > Math.PI * 1.85) return null;
  const commands = arcCubics(start, end, circle, sweep);
  if (commands.length === 0) return null;
  if (curveError(points, start, commands) > tolerance) return null;
  return { commands };
}

function tryFairCubic(points: readonly Point[], tolerance: number): Piece | null {
  const start = points[0];
  const end = points[points.length - 1];
  if (!start || !end || points.length < 4) return null;
  const smoothed = smoothPolyline(points, 2);
  const incoming = unitToward(smoothed, 0, false);
  const outgoing = unitToward(smoothed, smoothed.length - 1, true);
  if (!incoming || !outgoing) return null;
  const fitted = fitCubic(points, incoming, outgoing);
  if (!fitted || fitted.error > tolerance) return null;
  if (extraInflection(points, start, fitted.command)) return null;
  return { commands: [{ ...fitted.command, primitive: "cubic" }] };
}

function tryFullCircle(points: readonly Point[], tolerance: number): CleanFit | null {
  if (points.length < 12 || crispCorners(points, true).length >= 3) return null;
  const circle = fitCircle(points);
  if (!circle) return null;
  const box = bounds(points);
  if (circle.cx < box.minX - circle.r * 0.25 || circle.cx > box.maxX + circle.r * 0.25) return null;
  if (circle.cy < box.minY - circle.r * 0.25 || circle.cy > box.maxY + circle.r * 0.25) return null;
  let maxError = 0;
  for (const point of points) maxError = Math.max(maxError, Math.abs(Math.hypot(point.x - circle.cx, point.y - circle.cy) - circle.r));
  if (maxError > tolerance) return null;
  const sweep = signedArea(points) >= 0 ? Math.PI * 2 : -Math.PI * 2;
  const startAngle = Math.atan2(points[0]!.y - circle.cy, points[0]!.x - circle.cx);
  const start = { x: circle.cx + Math.cos(startAngle) * circle.r, y: circle.cy + Math.sin(startAngle) * circle.r };
  const commands = fullArcCubics(circle, startAngle, sweep);
  if (commands.length === 0) return null;
  if (sampleCurveError(start, commands, points) > tolerance) return null;
  return { start, commands };
}

function tryFullEllipse(points: readonly Point[], tolerance: number): CleanFit | null {
  if (points.length < 16 || crispCorners(points, true).length >= 3) return null;
  const ellipse = fitEllipse(points);
  if (!ellipse) return null;
  if (ellipse.rx < 4 || ellipse.ry < 4) return null;
  const ratio = ellipse.rx / ellipse.ry;
  if (ratio < 0.35 || ratio > 2.8) return null;
  let maxError = 0;
  for (const point of points) maxError = Math.max(maxError, ellipseRadialError(point, ellipse));
  if (maxError > tolerance) return null;
  const sweep = signedArea(points) >= 0 ? Math.PI * 2 : -Math.PI * 2;
  const start = ellipsePoint(ellipse, 0);
  const commands = ellipseCubics(ellipse, sweep);
  if (sampleCurveError(start, commands, points) > tolerance) return null;
  return { start, commands };
}

function tryRoundedRect(points: readonly Point[], tolerance: number): CleanFit | null {
  const runs = curvatureRuns(points);
  if (!runs) return null;
  const commands: VecCommand[] = [];
  let start: Point | null = null;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const next = runs[(i + 1) % runs.length];
    if (!run || !next) return null;
    const from = points[run.indices[0]!]!;
    const to = points[next.indices[0]!]!;
    if (!start) start = from;
    if (!run.curved) {
      const span = run.indices.map((index) => points[index]!).concat(to);
      const line = tryLine(span, Math.max(tolerance, 0.75));
      if (!line) return null;
      const command = line.commands[0];
      if (!command || command.op !== "L") return null;
      commands.push({ ...command, x: to.x, y: to.y });
      continue;
    }
    const span = run.indices.map((index) => points[index]!).concat(to);
    const arc = tryArc(span, tolerance);
    if (!arc) return null;
    const rebuilt = arc.commands.map((command, index) =>
      index === arc.commands.length - 1 ? { ...command, x: to.x, y: to.y } : command
    );
    commands.push(...rebuilt);
  }
  if (!start || commands.length === 0) return null;
  if (sampleCurveError(start, commands, points) > tolerance * 1.25) return null;
  return { start, commands };
}

function trySuperellipse(points: readonly Point[], tolerance: number): CleanFit | null {
  if (points.length < 24) return null;
  const box = bounds(points);
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  if (width < 8 || height < 8) return null;
  const ratio = width / height;
  if (ratio < 0.55 || ratio > 1.8) return null;
  if (crispCorners(points, true).length >= 3) return null;
  let best: { cx: number; cy: number; a: number; b: number; n: number; error: number } | null = null;
  const cx0 = (box.minX + box.maxX) / 2;
  const cy0 = (box.minY + box.maxY) / 2;
  for (const n of [2.6, 3.2, 4, 4.8, 5.5]) {
    for (const scale of [0.9, 0.96, 1]) {
      const candidate = { cx: cx0, cy: cy0, a: (width / 2) * scale, b: (height / 2) * scale, n, error: 0 };
      let maxError = 0;
      for (const point of points) {
        maxError = Math.max(maxError, superellipseError(point, candidate));
        if (best && maxError >= best.error) break;
      }
      candidate.error = maxError;
      if (maxError <= tolerance && (!best || maxError < best.error)) best = candidate;
    }
  }
  if (!best) return null;
  const sweep = signedArea(points) >= 0 ? Math.PI * 2 : -Math.PI * 2;
  const steps = 8;
  const start = superPoint(best, 0);
  const commands: VecCommand[] = [];
  for (let i = 0; i < steps; i++) {
    const t0 = (sweep * i) / steps;
    const t1 = (sweep * (i + 1)) / steps;
    const p0 = i === 0 ? start : superPoint(best, t0);
    const p3 = i === steps - 1 ? start : superPoint(best, t1);
    const tan0 = superTangent(best, t0, sweep > 0);
    const tan1 = superTangent(best, t1, sweep > 0);
    const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
    const arm = chord * 0.35;
    commands.push({
      op: "C",
      x1: p0.x + tan0.x * arm,
      y1: p0.y + tan0.y * arm,
      x2: p3.x - tan1.x * arm,
      y2: p3.y - tan1.y * arm,
      x: p3.x,
      y: p3.y,
      primitive: "cubic"
    });
  }
  if (sampleCurveError(start, commands, points) > tolerance) return null;
  return { start, commands };
}

function curvatureRuns(points: readonly Point[]): { curved: boolean; indices: number[] }[] | null {
  const count = points.length;
  if (count < 20) return null;
  const turn = new Float64Array(count);
  for (let i = 0; i < count; i++) turn[i] = turnAngle(points[(i + count - 1) % count]!, points[i]!, points[(i + 1) % count]!);
  const smooth = new Float64Array(count);
  const radius = 3;
  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let delta = -radius; delta <= radius; delta++) sum += turn[(i + delta + count) % count] ?? 0;
    smooth[i] = sum / (radius * 2 + 1);
  }
  const curved: boolean[] = [];
  for (let i = 0; i < count; i++) curved.push(Math.abs(smooth[i] ?? 0) > 0.05);
  let origin = -1;
  for (let i = 0; i < count; i++) if (!curved[i]) {
    origin = i;
    break;
  }
  if (origin < 0) return null;
  const runs: { curved: boolean; indices: number[] }[] = [];
  let cursor = 0;
  while (cursor < count) {
    const index = (origin + cursor) % count;
    const flag = curved[index] ?? false;
    const indices = [index];
    cursor++;
    while (cursor < count && (curved[(origin + cursor) % count] ?? false) === flag) {
      indices.push((origin + cursor) % count);
      cursor++;
    }
    runs.push({ curved: flag, indices });
  }
  absorb(runs, (run, previous, next) => run.curved && run.indices.length <= 2 && !previous.curved && !next.curved, false);
  absorb(runs, (run, previous, next) => !run.curved && run.indices.length <= 4 && previous.curved && next.curved, true);
  const useful = runs.filter((run) => run.indices.length > 0);
  if (useful.length !== 8) return null;
  let bends = 0;
  let sides = 0;
  for (let i = 0; i < useful.length; i++) {
    const run = useful[i];
    const next = useful[(i + 1) % useful.length];
    if (!run || !next || run.curved === next.curved) return null;
    if (run.curved) bends++;
    else sides++;
    if (run.curved) {
      let integral = 0;
      for (const index of run.indices) integral += turn[index] ?? 0;
      if (Math.abs(integral) < 0.55 || Math.abs(integral) > 2.1) return null;
    }
  }
  if (bends !== 4 || sides !== 4) return null;
  return useful;
}

function absorb(
  runs: { curved: boolean; indices: number[] }[],
  take: (run: { curved: boolean; indices: number[] }, previous: { curved: boolean; indices: number[] }, next: { curved: boolean; indices: number[] }) => boolean,
  curved: boolean
): void {
  for (let i = 0; i < runs.length; ) {
    const run = runs[i];
    const previous = runs[(i + runs.length - 1) % runs.length];
    const next = runs[(i + 1) % runs.length];
    if (!run || !previous || !next || previous === next || !take(run, previous, next)) {
      i++;
      continue;
    }
    previous.indices = previous.indices.concat(run.indices, next.indices);
    previous.curved = curved;
    const nextIndex = (i + 1) % runs.length;
    const drop = [i, nextIndex].sort((a, b) => b - a);
    for (const index of drop) runs.splice(index, 1);
    i = 0;
  }
}

function crispCorners(points: readonly Point[], closed: boolean): number[] {
  const count = points.length;
  if (count < 6) return [];
  const reach = 3.4;
  const turns = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const back = walkPoint(points, i, reach, -1, closed);
    const ahead = walkPoint(points, i, reach, 1, closed);
    const current = points[i];
    if (!back || !ahead || !current) continue;
    const turn = Math.abs(turnAngle(back.point, current, ahead.point));
    if (turn < 0.9) continue;
    if (pathDeviation(points, i, back.index, -1, closed) > 0.85 || pathDeviation(points, i, ahead.index, 1, closed) > 0.85) continue;
    turns[i] = turn;
  }
  const cuts: number[] = [];
  for (let i = 0; i < count; i++) {
    const turn = turns[i] ?? 0;
    if (turn < 0.9) continue;
    const left = turns[(i - 1 + count) % count] ?? 0;
    const right = turns[(i + 1) % count] ?? 0;
    if (turn + 1e-6 < left || turn < right) continue;
    const last = cuts[cuts.length - 1];
    if (last !== undefined && i - last < 4) continue;
    cuts.push(i);
  }
  if (closed && cuts.length >= 2) {
    const first = cuts[0];
    const last = cuts[cuts.length - 1];
    if (first !== undefined && last !== undefined && first + count - last < 4) cuts.pop();
  }
  return cuts;
}

function walkPoint(
  points: readonly Point[],
  index: number,
  distance: number,
  sign: -1 | 1,
  closed: boolean
): { point: Point; index: number } | null {
  const count = points.length;
  let remaining = distance;
  let cursor = index;
  for (let guard = 0; guard < count; guard++) {
    const next = cursor + sign;
    if (!closed && (next < 0 || next >= count)) return null;
    const wrapped = (next + count) % count;
    const from = points[(cursor + count) % count];
    const to = points[wrapped];
    if (!from || !to) return null;
    const step = Math.hypot(to.x - from.x, to.y - from.y);
    if (step < 1e-8) {
      if (wrapped === index) return null;
      cursor = wrapped;
      continue;
    }
    if (step + 1e-8 >= remaining) {
      const t = remaining / step;
      return { point: { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, index: wrapped };
    }
    remaining -= step;
    if (closed && wrapped === index) return null;
    cursor = wrapped;
  }
  return null;
}

function pathDeviation(points: readonly Point[], from: number, to: number, sign: -1 | 1, closed: boolean): number {
  const count = points.length;
  const start = points[from];
  const end = points[(to + count) % count];
  if (!start || !end) return Infinity;
  let max = 0;
  let cursor = from;
  for (let guard = 0; guard < count; guard++) {
    const next = cursor + sign;
    if (!closed && (next < 0 || next >= count)) break;
    const wrapped = (next + count) % count;
    const point = points[wrapped];
    if (point) max = Math.max(max, pointSegmentDistance(point, start, end));
    if (wrapped === ((to + count) % count)) break;
    cursor = wrapped;
  }
  return max;
}

function fitSmoothSpan(points: readonly Point[], tolerance: number, depth: number): Piece[] {
  const end = points[points.length - 1];
  const start = points[0];
  if (!start || !end) return [];
  if (points.length < 2) return [];
  const line = tryLine(points, tolerance);
  const bow = maxSegmentError(points, start, end);
  if (line && bow <= 0.55) return [line];
  if (points.length >= 6) {
    const arc = tryArc(points, tolerance);
    if (arc && arc.commands.length <= 2) return [arc];
  }
  if (points.length >= 4) {
    const cubic = tryFairCubic(points, tolerance);
    if (cubic) return [cubic];
  }
  if (line) return [line];
  if (depth > 12 || points.length <= 3) return [{ commands: [{ op: "L", x: end.x, y: end.y, primitive: "line" }] }];
  const split = splitIndex(points);
  return fairJoin(
    fitSmoothSpan(points.slice(0, split + 1), tolerance, depth + 1),
    fitSmoothSpan(points.slice(split), tolerance, depth + 1)
  );
}

function fitClosedPrimitives(points: readonly Point[], tolerance: number): CleanFit | null {
  return tryFullCircle(points, tolerance) ?? tryRoundedRect(points, tolerance) ?? trySuperellipse(points, tolerance) ?? tryFullEllipse(points, tolerance);
}

function fitClosedGuided(points: readonly Point[], tolerance: number): CleanFit | null {
  const epsilon = Math.max(0.5, Math.min(tolerance * 0.78, 1.3));
  const guide = decimateClosed(points, epsilon);
  if (guide.length < 6) return null;
  const primitive = fitClosedPrimitives(guide, Math.max(0.35, tolerance - epsilon * 0.35));
  if (primitive && sampleCurveError(primitive.start, primitive.commands, points) <= tolerance) return primitive;
  const fitted = fitClosedRaw(guide, Math.max(0.3, tolerance - epsilon));
  if (!fitted || sampleCurveError(fitted.start, fitted.commands, points) > tolerance) return null;
  return fitted;
}

function fitClosedRaw(points: readonly Point[], tolerance: number): CleanFit | null {
  const cuts = crispCorners(points, true);
  if (cuts.length >= 3) {
    const commands: VecCommand[] = [];
    for (let i = 0; i < cuts.length; i++) {
      const span = sliceCyclic(points, cuts[i]!, cuts[(i + 1) % cuts.length]!);
      commands.push(...fitOpenClean(span, tolerance));
    }
    const start = points[cuts[0]!];
    if (!start || commands.length === 0) return null;
    return { start, commands };
  }
  const loop = points.concat(points[0]!);
  const commands = fitOpenClean(loop, tolerance);
  const start = points[0];
  if (!start || commands.length === 0) return null;
  return { start, commands };
}

function pinEnd(commands: VecCommand[], end: Point): VecCommand[] {
  const last = commands[commands.length - 1];
  if (!last || (last.x === end.x && last.y === end.y)) return commands;
  return commands.slice(0, -1).concat([{ ...last, x: end.x, y: end.y }]);
}

function decimateIndexed(points: readonly Point[], epsilon: number): number[] {
  if (points.length < 3 || epsilon <= 0) return points.map((_, index) => index);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [0, points.length - 1];
  while (stack.length > 0) {
    const end = stack.pop();
    const start = stack.pop();
    if (start === undefined || end === undefined) break;
    let best = -1;
    let bestDistance = epsilon;
    for (let i = start + 1; i < end; i++) {
      const point = points[i];
      const from = points[start];
      const to = points[end];
      if (!point || !from || !to) continue;
      const distance = pointSegmentDistance(point, from, to);
      if (distance > bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push(start, best, best, end);
    }
  }
  const indexes: number[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) indexes.push(i);
  return indexes;
}

function decimateOpen(points: readonly Point[], epsilon: number): Point[] {
  if (points.length < 3 || epsilon <= 0) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [0, points.length - 1];
  while (stack.length > 0) {
    const end = stack.pop();
    const start = stack.pop();
    if (start === undefined || end === undefined) break;
    let best = -1;
    let bestDistance = epsilon;
    for (let i = start + 1; i < end; i++) {
      const point = points[i];
      const from = points[start];
      const to = points[end];
      if (!point || !from || !to) continue;
      const distance = pointSegmentDistance(point, from, to);
      if (distance > bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push(start, best, best, end);
    }
  }
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]!);
  return out;
}

function decimateClosed(points: readonly Point[], epsilon: number): Point[] {
  if (points.length < 8) return points.slice();
  let first = 0;
  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    const best = points[first];
    if (!point || !best) continue;
    if (point.x < best.x - 1e-9 || (Math.abs(point.x - best.x) <= 1e-9 && point.y < best.y)) first = i;
  }
  const origin = points[first];
  if (!origin) return points.slice();
  let second = 0;
  let far = -1;
  for (let i = 0; i < points.length; i++) {
    if (i === first) continue;
    const point = points[i];
    if (!point) continue;
    const distance = (point.x - origin.x) ** 2 + (point.y - origin.y) ** 2;
    if (distance > far) {
      far = distance;
      second = i;
    }
  }
  const a = decimateOpen(sliceCyclic(points, first, second), epsilon);
  const b = decimateOpen(sliceCyclic(points, second, first), epsilon);
  if (a.length === 0) return b;
  return a.concat(b.slice(1, -1));
}

function fairJoin(left: readonly Piece[], right: readonly Piece[]): Piece[] {
  const previous = left[left.length - 1];
  const next = right[0];
  if (!previous || !next) return left.concat(right);
  const leftCommand = previous.commands[previous.commands.length - 1];
  const rightCommand = next.commands[0];
  if (!leftCommand || !rightCommand || leftCommand.op !== "C" || rightCommand.op !== "C") return left.concat(right);
  const tx = leftCommand.x - leftCommand.x2;
  const ty = leftCommand.y - leftCommand.y2;
  const length = Math.hypot(tx, ty);
  if (length < 1e-6) return left.concat(right);
  const arm = Math.hypot(rightCommand.x1 - leftCommand.x, rightCommand.y1 - leftCommand.y);
  const matched = Math.max(length, Math.min(arm, length * 1.35));
  const joined: VecCommand = {
    ...rightCommand,
    x1: leftCommand.x + (tx / length) * matched,
    y1: leftCommand.y + (ty / length) * matched
  };
  const rebuilt: Piece = { commands: [joined, ...next.commands.slice(1)] };
  return left.concat([rebuilt], right.slice(1));
}

function fitCircle(points: readonly Point[]): { cx: number; cy: number; r: number } | null {
  let sumX = 0;
  let sumY = 0;
  let sumX2 = 0;
  let sumY2 = 0;
  let sumXY = 0;
  let sumR = 0;
  let sumRX = 0;
  let sumRY = 0;
  const count = points.length;
  if (count < 6) return null;
  for (const point of points) {
    const radius2 = point.x * point.x + point.y * point.y;
    sumX += point.x;
    sumY += point.y;
    sumX2 += point.x * point.x;
    sumY2 += point.y * point.y;
    sumXY += point.x * point.y;
    sumR += radius2;
    sumRX += radius2 * point.x;
    sumRY += radius2 * point.y;
  }
  const det = determinant(sumX2, sumXY, sumX, sumXY, sumY2, sumY, sumX, sumY, count);
  if (Math.abs(det) < 1e-8) return null;
  const d = determinant(-sumRX, sumXY, sumX, -sumRY, sumY2, sumY, -sumR, sumY, count) / det;
  const e = determinant(sumX2, -sumRX, sumX, sumXY, -sumRY, sumY, sumX, -sumR, count) / det;
  const f = determinant(sumX2, sumXY, -sumRX, sumXY, sumY2, -sumRY, sumX, sumY, -sumR) / det;
  const cx = -d / 2;
  const cy = -e / 2;
  const radius2 = cx * cx + cy * cy - f;
  if (!(radius2 > 1)) return null;
  return { cx, cy, r: Math.sqrt(radius2) };
}

function fitEllipse(points: readonly Point[]): { cx: number; cy: number; rx: number; ry: number } | null {
  let sx = 0;
  let sy = 0;
  for (const point of points) {
    sx += point.x;
    sy += point.y;
  }
  const cx = sx / points.length;
  const cy = sy / points.length;
  let a00 = 0;
  let a01 = 0;
  let a11 = 0;
  let b0 = 0;
  let b1 = 0;
  for (const point of points) {
    const x2 = (point.x - cx) * (point.x - cx);
    const y2 = (point.y - cy) * (point.y - cy);
    a00 += x2 * x2;
    a01 += x2 * y2;
    a11 += y2 * y2;
    b0 += x2;
    b1 += y2;
  }
  const det = a00 * a11 - a01 * a01;
  if (Math.abs(det) < 1e-6) return null;
  const u = (a11 * b0 - a01 * b1) / det;
  const v = (a00 * b1 - a01 * b0) / det;
  if (!(u > 1e-6) || !(v > 1e-6)) return null;
  return { cx, cy, rx: 1 / Math.sqrt(u), ry: 1 / Math.sqrt(v) };
}

function ellipseRadialError(point: Point, ellipse: { cx: number; cy: number; rx: number; ry: number }): number {
  const dx = (point.x - ellipse.cx) / ellipse.rx;
  const dy = (point.y - ellipse.cy) / ellipse.ry;
  const rho = Math.hypot(dx, dy);
  return Math.abs(rho - 1) * Math.hypot(point.x - ellipse.cx, point.y - ellipse.cy) / Math.max(rho, 0.25);
}

function superellipseError(point: Point, shape: { cx: number; cy: number; a: number; b: number; n: number }): number {
  const dx = (point.x - shape.cx) / shape.a;
  const dy = (point.y - shape.cy) / shape.b;
  const rho = (Math.abs(dx) ** shape.n + Math.abs(dy) ** shape.n) ** (1 / shape.n);
  return Math.abs(rho - 1) * Math.hypot(point.x - shape.cx, point.y - shape.cy) / Math.max(rho, 0.25);
}

function fullArcCubics(circle: { cx: number; cy: number; r: number }, startAngle: number, sweep: number): VecCommand[] {
  const commands: VecCommand[] = [];
  const steps = 4;
  for (let i = 0; i < steps; i++) {
    const a0 = startAngle + (sweep * i) / steps;
    const a1 = startAngle + (sweep * (i + 1)) / steps;
    commands.push(arcStep(circle, a0, a1, i === steps - 1 ? startAngle : null));
  }
  return commands;
}

function ellipseCubics(ellipse: { cx: number; cy: number; rx: number; ry: number }, sweep: number): VecCommand[] {
  const commands: VecCommand[] = [];
  const steps = 4;
  for (let i = 0; i < steps; i++) {
    const a0 = (sweep * i) / steps;
    const a1 = (sweep * (i + 1)) / steps;
    const p0 = ellipsePoint(ellipse, a0);
    const p3 = ellipsePoint(ellipse, i === steps - 1 ? 0 : a1);
    const arm = KAPPA * (Math.abs(sweep) / (Math.PI * 2)) * 4;
    const t0 = ellipseTangent(ellipse, a0, sweep > 0);
    const t1 = ellipseTangent(ellipse, a1, sweep > 0);
    commands.push({
      op: "C",
      x1: p0.x + t0.x * ellipseScale(ellipse, arm),
      y1: p0.y + t0.y * ellipseScale(ellipse, arm),
      x2: p3.x - t1.x * ellipseScale(ellipse, arm),
      y2: p3.y - t1.y * ellipseScale(ellipse, arm),
      x: p3.x,
      y: p3.y,
      primitive: "arc"
    });
  }
  return commands;
}

function ellipseScale(ellipse: { rx: number; ry: number }, arm: number): number {
  return ((ellipse.rx + ellipse.ry) / 2) * arm;
}

type CubicCommand = Extract<VecCommand, { op: "C" }>;

function arcCubics(start: Point, end: Point, circle: { cx: number; cy: number; r: number }, sweep: number): CubicCommand[] {
  const startAngle = Math.atan2(start.y - circle.cy, start.x - circle.cx);
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI * 0.62)));
  const commands: CubicCommand[] = [];
  for (let i = 0; i < steps; i++) {
    const a0 = startAngle + (sweep * i) / steps;
    const a1 = startAngle + (sweep * (i + 1)) / steps;
    const command = arcStep(circle, a0, a1, null);
    const origin = commandFrom(circle, a0);
    if (i === 0) {
      commands.push({ ...command, x1: start.x + (command.x1 - origin.x), y1: start.y + (command.y1 - origin.y) });
    } else commands.push(command);
  }
  const last = commands[commands.length - 1];
  if (last) commands[commands.length - 1] = { ...last, x: end.x, y: end.y };
  return commands;
}

function arcStep(circle: { cx: number; cy: number; r: number }, a0: number, a1: number, closeAt: number | null): CubicCommand {
  const p0 = commandFrom(circle, a0);
  const p3 = closeAt === null ? commandFrom(circle, a1) : commandFrom(circle, closeAt);
  const sweep = a1 - a0;
  const k = (4 / 3) * Math.tan(sweep / 4);
  const t0 = { x: -Math.sin(a0), y: Math.cos(a0) };
  const t1 = { x: -Math.sin(a1), y: Math.cos(a1) };
  return {
    op: "C",
    x1: p0.x + t0.x * k * circle.r,
    y1: p0.y + t0.y * k * circle.r,
    x2: p3.x - t1.x * k * circle.r,
    y2: p3.y - t1.y * k * circle.r,
    x: p3.x,
    y: p3.y,
    primitive: "arc"
  };
}

function commandFrom(circle: { cx: number; cy: number; r: number }, angle: number): Point {
  return { x: circle.cx + Math.cos(angle) * circle.r, y: circle.cy + Math.sin(angle) * circle.r };
}

function ellipsePoint(ellipse: { cx: number; cy: number; rx: number; ry: number }, angle: number): Point {
  return { x: ellipse.cx + Math.cos(angle) * ellipse.rx, y: ellipse.cy + Math.sin(angle) * ellipse.ry };
}

function ellipseTangent(ellipse: { rx: number; ry: number }, angle: number, positive: boolean): Point {
  const tx = -ellipse.rx * Math.sin(angle);
  const ty = ellipse.ry * Math.cos(angle);
  const length = Math.hypot(tx, ty) || 1;
  const sign = positive ? 1 : -1;
  return { x: (tx / length) * sign, y: (ty / length) * sign };
}

function superPoint(shape: { cx: number; cy: number; a: number; b: number; n: number }, angle: number): Point {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const power = 2 / shape.n;
  return {
    x: shape.cx + Math.sign(c) * shape.a * Math.abs(c) ** power,
    y: shape.cy + Math.sign(s) * shape.b * Math.abs(s) ** power
  };
}

function superTangent(shape: { cx: number; cy: number; a: number; b: number; n: number }, angle: number, positive: boolean): Point {
  const ahead = superPoint(shape, angle + 0.02);
  const behind = superPoint(shape, angle - 0.02);
  const length = Math.hypot(ahead.x - behind.x, ahead.y - behind.y) || 1;
  const sign = positive ? 1 : -1;
  return { x: ((ahead.x - behind.x) / length) * sign, y: ((ahead.y - behind.y) / length) * sign };
}

function sweepAbout(points: readonly Point[], circle: { cx: number; cy: number }): number {
  let sweep = 0;
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const point = points[i];
    if (!previous || !point) continue;
    const a0 = Math.atan2(previous.y - circle.cy, previous.x - circle.cx);
    const a1 = Math.atan2(point.y - circle.cy, point.x - circle.cx);
    let delta = a1 - a0;
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    sweep += delta;
  }
  return sweep;
}

function fitCubic(
  points: readonly Point[],
  t1: Point,
  t2: Point
): { command: { op: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }; error: number } | null {
  const p0 = points[0];
  const p3 = points[points.length - 1];
  if (!p0 || !p3) return null;
  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  if (chord < 1e-6) return null;
  let length = 0;
  const parameter = [0];
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const point = points[i];
    if (!previous || !point) return null;
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
    parameter.push(length);
  }
  if (length < 1e-6) return null;
  let c11 = 0;
  let c12 = 0;
  let c22 = 0;
  let x1 = 0;
  let x2 = 0;
  const tangentDot = t1.x * t2.x + t1.y * t2.y;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (!point) return null;
    const t = (parameter[i] ?? 0) / length;
    const u = 1 - t;
    const b1 = 3 * u * u * t;
    const b2 = 3 * u * t * t;
    const basisX = p0.x * u * u * u + p3.x * t * t * t;
    const basisY = p0.y * u * u * u + p3.y * t * t * t;
    c11 += b1 * b1;
    c22 += b2 * b2;
    c12 += b1 * b2 * tangentDot;
    x1 += b1 * ((point.x - basisX) * t1.x + (point.y - basisY) * t1.y);
    x2 += b2 * ((point.x - basisX) * t2.x + (point.y - basisY) * t2.y);
  }
  const det = c11 * c22 - c12 * c12;
  if (Math.abs(det) < 1e-10) return null;
  const alpha1 = (c22 * x1 - c12 * x2) / det;
  const alpha2 = (c11 * x2 - c12 * x1) / det;
  if (!(alpha1 > 0) || !(alpha2 > 0) || alpha1 > chord * 1.2 || alpha2 > chord * 1.2) return null;
  const command = {
    op: "C" as const,
    x1: p0.x + t1.x * alpha1,
    y1: p0.y + t1.y * alpha1,
    x2: p3.x + t2.x * alpha2,
    y2: p3.y + t2.y * alpha2,
    x: p3.x,
    y: p3.y
  };
  let maxError = 0;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (!point) continue;
    const at = cubicAt(p0, { x: command.x1, y: command.y1 }, { x: command.x2, y: command.y2 }, p3, (parameter[i] ?? 0) / length);
    maxError = Math.max(maxError, Math.hypot(at.x - point.x, at.y - point.y));
  }
  return { command, error: maxError };
}

function extraInflection(points: readonly Point[], start: Point, command: { x1: number; y1: number; x2: number; y2: number; x: number; y: number }): boolean {
  const end = { x: command.x, y: command.y };
  const source = signChanges(points.map((point) => signedDistance(point, start, end)));
  const samples: number[] = [];
  for (let step = 0; step <= 8; step++) {
    const at = cubicAt(start, { x: command.x1, y: command.y1 }, { x: command.x2, y: command.y2 }, end, step / 8);
    samples.push(signedDistance(at, start, end));
  }
  return signChanges(samples) > source + 1;
}

function signChanges(values: readonly number[]): number {
  let changes = 0;
  let previous = 0;
  for (const value of values) {
    const sign = value > 0.15 ? 1 : value < -0.15 ? -1 : 0;
    if (sign === 0) continue;
    if (previous !== 0 && sign !== previous) changes++;
    previous = sign;
  }
  return changes;
}

function curveError(points: readonly Point[], start: Point, commands: readonly VecCommand[]): number {
  return sampleCurveError(start, commands, points);
}

function sampleCurveError(start: Point, commands: readonly VecCommand[], points: readonly Point[]): number {
  const samples = sampleCommands(start, commands, 10);
  let maxError = 0;
  for (const point of points) {
    let best = Infinity;
    for (let i = 1; i < samples.length; i++) {
      const from = samples[i - 1];
      const to = samples[i];
      if (!from || !to) continue;
      best = Math.min(best, pointSegmentDistance(point, from, to));
    }
    maxError = Math.max(maxError, best);
  }
  return maxError;
}

function sampleCommands(start: Point, commands: readonly VecCommand[], steps: number): Point[] {
  const samples = [start];
  let x = start.x;
  let y = start.y;
  for (const command of commands) {
    if (command.op === "L") {
      samples.push({ x: command.x, y: command.y });
      x = command.x;
      y = command.y;
      continue;
    }
    const from = { x, y };
    for (let step = 1; step <= steps; step++) {
      samples.push(cubicAt(from, { x: command.x1, y: command.y1 }, { x: command.x2, y: command.y2 }, { x: command.x, y: command.y }, step / steps));
    }
    x = command.x;
    y = command.y;
  }
  return samples;
}

function smoothPolyline(points: readonly Point[], radius: number): Point[] {
  return points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return point;
    let x = 0;
    let y = 0;
    let weight = 0;
    for (let delta = -radius; delta <= radius; delta++) {
      const sample = points[index + delta];
      if (!sample) continue;
      const w = radius + 1 - Math.abs(delta);
      x += sample.x * w;
      y += sample.y * w;
      weight += w;
    }
    return weight > 0 ? { x: x / weight, y: y / weight } : point;
  });
}

function unitToward(points: readonly Point[], index: number, atEnd: boolean): Point | null {
  const origin = points[index];
  if (!origin) return null;
  const reach = Math.min(5, atEnd ? index : points.length - 1 - index);
  let x = 0;
  let y = 0;
  for (let step = 1; step <= reach; step++) {
    const point = points[atEnd ? index - step : index + step];
    if (!point) continue;
    x += (point.x - origin.x) / step;
    y += (point.y - origin.y) / step;
  }
  const length = Math.hypot(x, y);
  if (length < 1e-8) return null;
  return { x: x / length, y: y / length };
}

function splitIndex(points: readonly Point[]): number {
  const start = points[0];
  const end = points[points.length - 1];
  if (!start || !end) return Math.floor(points.length / 2);
  let best = -1;
  let index = Math.floor(points.length / 2);
  for (let i = 1; i < points.length - 1; i++) {
    const point = points[i];
    if (!point) continue;
    const distance = pointSegmentDistance(point, start, end);
    if (distance > best) {
      best = distance;
      index = i;
    }
  }
  if (index <= 0 || index >= points.length - 1) return Math.floor(points.length / 2);
  return index;
}

function projectSegment(points: readonly Point[], axis: number): { start: Point; end: Point } | null {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;
  const mid = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
  const direction = { x: Math.cos(axis), y: Math.sin(axis) };
  const project = (point: Point): Point => {
    const t = (point.x - mid.x) * direction.x + (point.y - mid.y) * direction.y;
    return { x: mid.x + t * direction.x, y: mid.y + t * direction.y };
  };
  return { start: project(first), end: project(last) };
}

function nearestSnap(angle: number): { axis: number; name: SnapAxis } | null {
  const axes: { axis: number; name: SnapAxis }[] = [
    { axis: 0, name: "horizontal" },
    { axis: Math.PI / 4, name: "diagonal" },
    { axis: Math.PI / 2, name: "vertical" },
    { axis: (3 * Math.PI) / 4, name: "diagonal" },
    { axis: Math.PI, name: "horizontal" },
    { axis: -Math.PI / 4, name: "diagonal" },
    { axis: -Math.PI / 2, name: "vertical" },
    { axis: (-3 * Math.PI) / 4, name: "diagonal" }
  ];
  let best: { axis: number; name: SnapAxis } | null = null;
  let bestDelta = 0.22;
  for (const candidate of axes) {
    let delta = Math.abs(angle - candidate.axis);
    if (delta > Math.PI) delta = Math.PI * 2 - delta;
    if (delta < bestDelta) {
      bestDelta = delta;
      best = candidate;
    }
  }
  return best;
}

function maxSegmentError(points: readonly Point[], start: Point, end: Point): number {
  let max = 0;
  for (const point of points) max = Math.max(max, pointSegmentDistance(point, start, end));
  return max;
}

function pointSegmentDistance(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-8) return Math.hypot(point.x - from.x, point.y - from.y);
  const t = Math.min(1, Math.max(0, ((point.x - from.x) * dx + (point.y - from.y) * dy) / (length * length)));
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
}

function signedDistance(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-8) return 0;
  return ((point.x - from.x) * dy - (point.y - from.y) * dx) / length;
}

function turnAngle(a: Point, b: Point, c: Point): number {
  const incoming = Math.atan2(b.y - a.y, b.x - a.x);
  const outgoing = Math.atan2(c.y - b.y, c.x - b.x);
  let delta = outgoing - incoming;
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function signedArea(points: readonly Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const next = points[(i + 1) % points.length];
    if (!point || !next) continue;
    area += point.x * next.y - next.x * point.y;
  }
  return area / 2;
}

function bounds(points: readonly Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, minY, maxX, maxY };
}

function sliceCyclic(points: readonly Point[], start: number, end: number): Point[] {
  const out: Point[] = [points[start]!];
  if (start === end) {
    for (let i = 1; i <= points.length; i++) out.push(points[(start + i) % points.length]!);
    return out;
  }
  let cursor = start;
  do {
    cursor = (cursor + 1) % points.length;
    out.push(points[cursor]!);
  } while (cursor !== end);
  return out;
}

function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y
  };
}

function determinant(a00: number, a01: number, a02: number, a10: number, a11: number, a12: number, a20: number, a21: number, a22: number): number {
  return a00 * (a11 * a22 - a12 * a21) - a01 * (a10 * a22 - a12 * a20) + a02 * (a10 * a21 - a11 * a20);
}
