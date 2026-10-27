import { srgbChannelToLinear, type RGB } from "./color.ts";

export type SharedBoundaryInput = {
  readonly labels: Uint8Array;
  readonly labelWidth: number;
  readonly labelHeight: number;
  readonly colors: readonly RGB[];
  readonly source: Uint8Array;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly scale: number;
  readonly omitFill?: string | null;
  readonly tolerance?: number;
  readonly cornerDegrees?: number;
};

type Pt = { readonly x: number; readonly y: number };
type Cubic = { readonly p0: Pt; readonly c1: Pt; readonly c2: Pt; readonly p1: Pt };
type Step = { readonly x: number; readonly y: number; readonly dir: number };
type Chain = {
  readonly steps: readonly Step[];
  readonly loop: boolean;
  readonly startKey: string;
  readonly endKey: string;
  left: number;
  right: number;
  points: Pt[];
  cubics: Cubic[];
};
type Dir = {
  readonly chain: number;
  readonly rev: boolean;
  readonly from: string;
  readonly to: string;
  readonly left: number;
  readonly angle: number;
  used: boolean;
};
type Cycle = {
  readonly label: number;
  readonly points: Pt[];
  readonly cubics: Cubic[];
  readonly area: number;
  readonly edges: number;
  parent: number;
  readonly children: number[];
};

/**
 * One cubic chain per shared edge. Both regions reuse it, one of them reversed.
 * The curve sits on the linear-light 50% blend of the two flat colors.
 */
export function traceSharedBoundary(input: SharedBoundaryInput): string {
  const scale = input.scale > 0 ? input.scale : 1;
  const width = input.labelWidth;
  const height = input.labelHeight;
  if (width < 1 || height < 1 || input.labels.length < width * height) return emptySvg(input.sourceWidth, input.sourceHeight);
  const labels = new Int16Array(width * height);
  for (let index = 0; index < labels.length; index += 1) {
    const value = input.labels[index] ?? 255;
    labels[index] = value === 255 ? -1 : value;
  }
  const labelAt = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= width || y >= height) return -1;
    return labels[y * width + x] ?? -1;
  };
  const hActive = (x: number, y: number): boolean => labelAt(x, y - 1) !== labelAt(x, y);
  const vActive = (x: number, y: number): boolean => labelAt(x - 1, y) !== labelAt(x, y);
  const seenH = new Uint8Array(width * (height + 1));
  const seenV = new Uint8Array((width + 1) * height);
  const degree = (x: number, y: number): number => {
    let count = 0;
    if (x < width && hActive(x, y)) count += 1;
    if (x > 0 && hActive(x - 1, y)) count += 1;
    if (y < height && vActive(x, y)) count += 1;
    if (y > 0 && vActive(x, y - 1)) count += 1;
    return count;
  };
  const crackSeen = (x: number, y: number, dir: number): boolean => {
    if (dir === 0 || dir === 2) {
      const hx = dir === 0 ? x : x - 1;
      return (seenH[y * width + hx] ?? 0) === 1;
    }
    const vy = dir === 1 ? y : y - 1;
    return (seenV[vy * (width + 1) + x] ?? 0) === 1;
  };
  const markCrack = (x: number, y: number, dir: number): void => {
    if (dir === 0 || dir === 2) seenH[y * width + (dir === 0 ? x : x - 1)] = 1;
    else seenV[(dir === 1 ? y : y - 1) * (width + 1) + x] = 1;
  };
  const otherDir = (x: number, y: number, arrivedBy: number): number => {
    const back = (arrivedBy + 2) % 4;
    const options: number[] = [];
    if (x < width && hActive(x, y)) options.push(0);
    if (y < height && vActive(x, y)) options.push(1);
    if (x > 0 && hActive(x - 1, y)) options.push(2);
    if (y > 0 && vActive(x, y - 1)) options.push(3);
    for (const option of options) if (option !== back) return option;
    return -1;
  };
  const limit = (width + 1) * (height + 1) + 4;
  const walk = (x: number, y: number, dir: number, loop: boolean): { readonly steps: Step[]; readonly endX: number; readonly endY: number; readonly loop: boolean } => {
    const steps: Step[] = [];
    let cx = x;
    let cy = y;
    let cd = dir;
    for (let guard = 0; guard < limit; guard += 1) {
      if (crackSeen(cx, cy, cd)) break;
      markCrack(cx, cy, cd);
      steps.push({ x: cx, y: cy, dir: cd });
      if (cd === 0) cx += 1;
      else if (cd === 1) cy += 1;
      else if (cd === 2) cx -= 1;
      else cy -= 1;
      if (loop && cx === x && cy === y) return { steps, endX: cx, endY: cy, loop: true };
      if (!loop && degree(cx, cy) !== 2) return { steps, endX: cx, endY: cy, loop: false };
      const next = otherDir(cx, cy, cd);
      if (next < 0) return { steps, endX: cx, endY: cy, loop: false };
      cd = next;
    }
    return { steps, endX: cx, endY: cy, loop };
  };
  const chains: Chain[] = [];
  const begin = (x: number, y: number, dir: number, loop: boolean): void => {
    if (crackSeen(x, y, dir)) return;
    const traced = walk(x, y, dir, loop);
    if (traced.steps.length === 0) return;
    const first = traced.steps[0];
    if (first === undefined) return;
    const sides = sidePixels(first.x, first.y, first.dir);
    chains.push({
      steps: traced.steps,
      loop: traced.loop,
      startKey: key(x, y),
      endKey: key(traced.endX, traced.endY),
      left: labelAt(sides.lx, sides.ly),
      right: labelAt(sides.rx, sides.ry),
      points: [],
      cubics: []
    });
  };
  for (let y = 0; y <= height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!hActive(x, y) || (seenH[y * width + x] ?? 0) === 1) continue;
      if (degree(x, y) !== 2) begin(x, y, 0, false);
      else if (degree(x + 1, y) !== 2) begin(x + 1, y, 2, false);
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x <= width; x += 1) {
      if (!vActive(x, y) || (seenV[y * (width + 1) + x] ?? 0) === 1) continue;
      if (degree(x, y) !== 2) begin(x, y, 1, false);
      else if (degree(x, y + 1) !== 2) begin(x, y + 1, 3, false);
    }
  }
  for (let y = 0; y <= height; y += 1) {
    for (let x = 0; x < width; x += 1) if (hActive(x, y) && (seenH[y * width + x] ?? 0) === 0) begin(x, y, 0, true);
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x <= width; x += 1) if (vActive(x, y) && (seenV[y * (width + 1) + x] ?? 0) === 0) begin(x, y, 1, true);
  }
  const linear = new Float32Array(input.sourceWidth * input.sourceHeight * 3);
  const alpha = new Uint8Array(input.sourceWidth * input.sourceHeight);
  for (let index = 0; index < alpha.length; index += 1) {
    const offset = index * 4;
    linear[index * 3] = srgbChannelToLinear(input.source[offset] ?? 0);
    linear[index * 3 + 1] = srgbChannelToLinear(input.source[offset + 1] ?? 0);
    linear[index * 3 + 2] = srgbChannelToLinear(input.source[offset + 2] ?? 0);
    alpha[index] = input.source[offset + 3] ?? 0;
  }
  const flat = input.colors.map((color) => ({
    r: srgbChannelToLinear(color.r),
    g: srgbChannelToLinear(color.g),
    b: srgbChannelToLinear(color.b)
  }));
  const sample = (sx: number, sy: number): { readonly r: number; readonly g: number; readonly b: number; readonly a: number } => {
    const x0 = Math.floor(sx);
    const y0 = Math.floor(sy);
    const tx = sx - x0;
    const ty = sy - y0;
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let oy = 0; oy <= 1; oy += 1) {
      for (let ox = 0; ox <= 1; ox += 1) {
        const px = x0 + ox;
        const py = y0 + oy;
        const weight = (ox === 0 ? 1 - tx : tx) * (oy === 0 ? 1 - ty : ty);
        if (px < 0 || py < 0 || px >= input.sourceWidth || py >= input.sourceHeight) continue;
        const index = py * input.sourceWidth + px;
        r += (linear[index * 3] ?? 0) * weight;
        g += (linear[index * 3 + 1] ?? 0) * weight;
        b += (linear[index * 3 + 2] ?? 0) * weight;
        a += (alpha[index] ?? 0) * weight;
      }
    }
    return { r, g, b, a };
  };
  const place = (step: Step): Pt => {
    const sides = sidePixels(step.x, step.y, step.dir);
    const leftLabel = labelAt(sides.lx, sides.ly);
    const rightLabel = labelAt(sides.rx, sides.ry);
    const left = pixelCenter(sides.lx, sides.ly, scale);
    const right = pixelCenter(sides.rx, sides.ry, scale);
    const mid = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
    const dx = right.x - left.x;
    const dy = right.y - left.y;
    const length = Math.hypot(dx, dy) || 1;
    const dir = { x: dx / length, y: dy / length };
    const span = Math.max(0.2, 1.6 / scale);
    const colorEdge = leftLabel >= 0 && rightLabel >= 0;
    const leftFlat = flat[leftLabel];
    const rightFlat = flat[rightLabel];
    const goal = colorEdge ? 0.5 : 128;
    const miss = (distance: number): number => {
      const probed = sample(mid.x + dir.x * distance, mid.y + dir.y * distance);
      const value = colorEdge && leftFlat !== undefined && rightFlat !== undefined ? project(probed, leftFlat, rightFlat) : probed.a;
      return Math.abs(value - goal);
    };
    let bestD = 0;
    let bestError = Infinity;
    const steps = 16;
    for (let stepIndex = 0; stepIndex <= steps; stepIndex += 1) {
      const distance = -span + (span * 2 * stepIndex) / steps;
      const error = miss(distance);
      if (error < bestError) {
        bestError = error;
        bestD = distance;
      }
    }
    let low = Math.max(-span, bestD - span / steps);
    let high = Math.min(span, bestD + span / steps);
    for (let refine = 0; refine < 6; refine += 1) {
      const left = low + (high - low) / 3;
      const right = high - (high - low) / 3;
      if (miss(left) < miss(right)) high = right;
      else low = left;
    }
    bestD = (low + high) / 2;
    return quantize({ x: mid.x + dir.x * bestD, y: mid.y + dir.y * bestD });
  };
  const junction = new Map<string, { x: number; y: number; n: number }>();
  const accumulate = (at: string, point: Pt): void => {
    const bin = junction.get(at) ?? { x: 0, y: 0, n: 0 };
    bin.x += point.x;
    bin.y += point.y;
    bin.n += 1;
    junction.set(at, bin);
  };
  for (const chain of chains) {
    if (chain.loop || chain.steps.length === 0) continue;
    const first = chain.steps[0];
    const last = chain.steps[chain.steps.length - 1];
    if (first === undefined || last === undefined) continue;
    accumulate(chain.startKey, place(first));
    accumulate(chain.endKey, place(last));
  }
  const junctionAt = (at: string): Pt => {
    const bin = junction.get(at);
    if (bin === undefined || bin.n === 0) return quantize(vertexPoint(at, scale));
    return quantize({ x: bin.x / bin.n, y: bin.y / bin.n });
  };
  const tolerance = input.tolerance ?? 0.18;
  const minTurn = Math.max(18, 90 - (input.cornerDegrees ?? 45));
  for (const chain of chains) {
    const raw: Pt[] = [];
    if (!chain.loop) raw.push(junctionAt(chain.startKey));
    for (const step of chain.steps) raw.push(place(step));
    if (!chain.loop) raw.push(junctionAt(chain.endKey));
    const points = dedupe(raw);
    chain.points = chain.loop ? points : points;
    const ring = chain.loop && points.length >= 3 ? [...points, points[0] ?? quantize({ x: 0, y: 0 })] : points;
    chain.cubics = fitPolyline(ring, tolerance, minTurn).map(quantizeCubic);
  }
  const cycles: Cycle[] = [];
  const pushCycle = (label: number, points: Pt[], cubics: Cubic[]): void => {
    if (label < 0 || cubics.length === 0 || points.length < 3) return;
    cycles.push({
      label,
      points,
      cubics,
      area: Math.abs(shoelace(points)),
      edges: edgeCount(points, input.sourceWidth, input.sourceHeight),
      parent: -1,
      children: []
    });
  };
  for (const chain of chains) {
    if (!chain.loop) continue;
    if (chain.left >= 0) pushCycle(chain.left, chain.points, chain.cubics);
    if (chain.right >= 0) pushCycle(chain.right, chain.points.slice().reverse(), reverseCubics(chain.cubics));
  }
  const dirs: Dir[] = [];
  for (let index = 0; index < chains.length; index += 1) {
    const chain = chains[index];
    if (chain === undefined || chain.loop || chain.points.length < 2) continue;
    dirs.push({
      chain: index,
      rev: false,
      from: chain.startKey,
      to: chain.endKey,
      left: chain.left,
      angle: travelAngle(chain.points, false),
      used: false
    });
    dirs.push({
      chain: index,
      rev: true,
      from: chain.endKey,
      to: chain.startKey,
      left: chain.right,
      angle: travelAngle(chain.points, true),
      used: false
    });
  }
  const outgoing = new Map<string, Dir[]>();
  for (const dir of dirs) {
    const list = outgoing.get(dir.from);
    if (list === undefined) outgoing.set(dir.from, [dir]);
    else list.push(dir);
  }
  for (const dir of dirs) {
    if (dir.used || dir.left < 0) continue;
    const walked: Dir[] = [];
    let cursor: Dir | null = dir;
    for (let guard = 0; cursor !== null && guard < dirs.length + 2; guard += 1) {
      if (cursor.used && cursor !== dir) break;
      cursor.used = true;
      walked.push(cursor);
      const fromLabel = cursor.left;
      const heading = cursor.angle;
      const arrivedAt = cursor.to;
      const options: Dir[] = (outgoing.get(arrivedAt) ?? []).filter((option: Dir) => option.left === fromLabel && (!option.used || option === dir));
      let best: Dir | null = null;
      let bestTurn = Infinity;
      for (const option of options) {
        let turn = heading - option.angle;
        turn = ((turn % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        if (turn < bestTurn) {
          bestTurn = turn;
          best = option;
        }
      }
      if (best === null || best === dir) break;
      cursor = best;
    }
    const first = walked[0];
    const last = walked[walked.length - 1];
    if (first === undefined || last === undefined || last.to !== first.from) continue;
    const points: Pt[] = [];
    const cubics: Cubic[] = [];
    for (const piece of walked) {
      const chain = chains[piece.chain];
      if (chain === undefined) continue;
      const pts = piece.rev ? chain.points.slice().reverse() : chain.points;
      const curves = piece.rev ? reverseCubics(chain.cubics) : chain.cubics;
      if (points.length === 0) points.push(...pts);
      else points.push(...pts.slice(1));
      cubics.push(...curves);
    }
    pushCycle(first.left, points, cubics);
  }
  nest(cycles);
  const omit = normalizeHex(input.omitFill ?? null);
  const canvasArea = Math.max(1, input.sourceWidth * input.sourceHeight);
  const paths: { area: number; markup: string }[] = [];
  const emitCompound = (index: number): void => {
    const cycle = cycles[index];
    if (cycle === undefined || cycle.area < 0.2) return;
    const parts = [cyclePath(cycle.cubics)];
    for (const child of cycle.children) {
      const hole = cycles[child];
      if (hole === undefined) continue;
      parts.push(cyclePath(hole.cubics));
      for (const island of hole.children) emitCompound(island);
    }
    const color = input.colors[cycle.label];
    if (color === undefined || parts.every((part) => part === "")) return;
    paths.push({ area: cycle.area, markup: '<path d="' + parts.filter((part) => part !== "").join(" ") + '" fill="' + hex(color) + '"/>' });
  };
  for (let index = 0; index < cycles.length; index += 1) {
    const cycle = cycles[index];
    if (cycle === undefined || cycle.parent >= 0) continue;
    const backdrop = omit !== null && cycle.edges >= 3 && cycle.area > canvasArea * 0.5 && hex(input.colors[cycle.label] ?? { r: 0, g: 0, b: 0 }) === omit;
    if (backdrop) {
      for (const hole of cycle.children) {
        const cutout = cycles[hole];
        if (cutout === undefined) continue;
        for (const island of cutout.children) emitCompound(island);
      }
      continue;
    }
    emitCompound(index);
  }
  paths.sort((left, right) => right.area - left.area);
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    String(input.sourceWidth) +
    '" height="' +
    String(input.sourceHeight) +
    '" viewBox="0 0 ' +
    String(input.sourceWidth) +
    " " +
    String(input.sourceHeight) +
    '">' +
    paths.map((path) => path.markup).join("") +
    "</svg>"
  );
}

function edgeCount(points: readonly Pt[], width: number, height: number): number {
  const margin = 0.75;
  let count = 0;
  if (points.some((point) => point.y <= margin)) count += 1;
  if (points.some((point) => point.x >= width - margin)) count += 1;
  if (points.some((point) => point.y >= height - margin)) count += 1;
  if (points.some((point) => point.x <= margin)) count += 1;
  return count;
}

function sidePixels(x: number, y: number, dir: number): { readonly lx: number; readonly ly: number; readonly rx: number; readonly ry: number } {
  if (dir === 0) return { lx: x, ly: y - 1, rx: x, ry: y };
  if (dir === 1) return { lx: x, ly: y, rx: x - 1, ry: y };
  if (dir === 2) return { lx: x - 1, ly: y, rx: x - 1, ry: y - 1 };
  return { lx: x - 1, ly: y - 1, rx: x, ry: y - 1 };
}

function pixelCenter(x: number, y: number, scale: number): Pt {
  return { x: (x + 0.5) / scale, y: (y + 0.5) / scale };
}

function vertexPoint(at: string, scale: number): Pt {
  const [x, y] = at.split(",").map((value) => Number(value));
  return { x: (x ?? 0) / scale, y: (y ?? 0) / scale };
}

function project(sample: { readonly r: number; readonly g: number; readonly b: number }, left: { readonly r: number; readonly g: number; readonly b: number }, right: { readonly r: number; readonly g: number; readonly b: number }): number {
  const dr = right.r - left.r;
  const dg = right.g - left.g;
  const db = right.b - left.b;
  const length = dr * dr + dg * dg + db * db;
  if (length < 1e-8) return 0.5;
  return Math.min(1, Math.max(0, ((sample.r - left.r) * dr + (sample.g - left.g) * dg + (sample.b - left.b) * db) / length));
}

function key(x: number, y: number): string {
  return String(x) + "," + String(y);
}

function quantize(point: Pt): Pt {
  return { x: Math.round(point.x * 1000) / 1000, y: Math.round(point.y * 1000) / 1000 };
}

function quantizeCubic(cubic: Cubic): Cubic {
  return { p0: quantize(cubic.p0), c1: quantize(cubic.c1), c2: quantize(cubic.c2), p1: quantize(cubic.p1) };
}

function dedupe(points: readonly Pt[]): Pt[] {
  const next: Pt[] = [];
  for (const point of points) {
    const last = next[next.length - 1];
    if (last !== undefined && Math.hypot(last.x - point.x, last.y - point.y) < 0.0005) continue;
    next.push(point);
  }
  return next;
}

function fitPolyline(points: readonly Pt[], tolerance: number, minTurn: number): Cubic[] {
  if (points.length < 2) return [];
  const cuts = [0];
  for (let index = 1; index < points.length - 1; index += 1) {
    const before = points[index - 1];
    const current = points[index];
    const after = points[index + 1];
    if (before === undefined || current === undefined || after === undefined) continue;
    const turn = Math.abs(Math.atan2((current.x - before.x) * (after.y - current.y) - (current.y - before.y) * (after.x - current.x), (current.x - before.x) * (after.x - current.x) + (current.y - before.y) * (after.y - current.y)) * 180 / Math.PI);
    if (turn >= minTurn) cuts.push(index);
  }
  cuts.push(points.length - 1);
  const cubics: Cubic[] = [];
  for (let index = 0; index < cuts.length - 1; index += 1) {
    const from = cuts[index] ?? 0;
    const to = cuts[index + 1] ?? from;
    cubics.push(...fitOpen(points.slice(from, to + 1), tolerance, 0));
  }
  return cubics;
}

function fitOpen(points: readonly Pt[], tolerance: number, depth: number): Cubic[] {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return [];
  if (points.length < 2 || Math.hypot(last.x - first.x, last.y - first.y) < 0.0005) return [];
  if (points.length === 2 || maxChordDistance(points, first, last) <= tolerance) return [lineCubic(first, last)];
  const start = tangentStart(points);
  const end = tangentEnd(points);
  const cubic = fitCubic(points, start, end);
  const worst = maxCubicDistance(points, cubic);
  if (worst.distance <= tolerance) return [cubic];
  const split = worst.index <= 0 || worst.index >= points.length - 1 ? Math.floor(points.length / 2) : worst.index;
  if (depth >= 12 || split <= 0 || split >= points.length - 1) return [cubic];
  return [...fitOpen(points.slice(0, split + 1), tolerance, depth + 1), ...fitOpen(points.slice(split), tolerance, depth + 1)];
}

function fitCubic(points: readonly Pt[], tanStart: Pt, tanEnd: Pt): Cubic {
  const first = points[0] ?? { x: 0, y: 0 };
  const last = points[points.length - 1] ?? first;
  const t = chordParams(points);
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const ti = t[index] ?? 0;
    if (point === undefined) continue;
    const u = 1 - ti;
    const b0 = u * u * u;
    const b1 = 3 * u * u * ti;
    const b2 = 3 * u * ti * ti;
    const b3 = ti * ti * ti;
    const a1x = tanStart.x * b1;
    const a1y = tanStart.y * b1;
    const a2x = tanEnd.x * b2;
    const a2y = tanEnd.y * b2;
    c00 += a1x * a1x + a1y * a1y;
    c01 += a1x * a2x + a1y * a2y;
    c11 += a2x * a2x + a2y * a2y;
    const restX = point.x - (first.x * b0 + last.x * b3);
    const restY = point.y - (first.y * b0 + last.y * b3);
    x0 += a1x * restX + a1y * restY;
    x1 += a2x * restX + a2y * restY;
  }
  const det = c00 * c11 - c01 * c01;
  const length = Math.hypot(last.x - first.x, last.y - first.y);
  let alpha = length / 3;
  let beta = length / 3;
  if (Math.abs(det) > 1e-10) {
    alpha = (x0 * c11 - x1 * c01) / det;
    beta = (c00 * x1 - c01 * x0) / det;
  }
  if (!(alpha > length * 0.02) || !(beta > length * 0.02)) {
    alpha = length / 3;
    beta = length / 3;
  }
  return {
    p0: first,
    c1: { x: first.x + tanStart.x * alpha, y: first.y + tanStart.y * alpha },
    c2: { x: last.x + tanEnd.x * beta, y: last.y + tanEnd.y * beta },
    p1: last
  };
}

function chordParams(points: readonly Pt[]): number[] {
  const lengths: number[] = [0];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    const delta = previous === undefined || point === undefined ? 0 : Math.hypot(point.x - previous.x, point.y - previous.y);
    total += delta;
    lengths.push(total);
  }
  if (total < 1e-8) return points.map((_point, index) => (points.length === 1 ? 0 : index / (points.length - 1)));
  return lengths.map((value) => value / total);
}

function tangentStart(points: readonly Pt[]): Pt {
  const first = points[0] ?? { x: 0, y: 0 };
  const next = points[Math.min(2, points.length - 1)] ?? first;
  return unit(next.x - first.x, next.y - first.y);
}

function tangentEnd(points: readonly Pt[]): Pt {
  const last = points[points.length - 1] ?? { x: 0, y: 0 };
  const previous = points[Math.max(0, points.length - 3)] ?? last;
  return unit(previous.x - last.x, previous.y - last.y);
}

function unit(x: number, y: number): Pt {
  const length = Math.hypot(x, y);
  if (length < 1e-8) return { x: 1, y: 0 };
  return { x: x / length, y: y / length };
}

function lineCubic(from: Pt, to: Pt): Cubic {
  return {
    p0: from,
    c1: { x: from.x + (to.x - from.x) / 3, y: from.y + (to.y - from.y) / 3 },
    c2: { x: from.x + (2 * (to.x - from.x)) / 3, y: from.y + (2 * (to.y - from.y)) / 3 },
    p1: to
  };
}

function maxChordDistance(points: readonly Pt[], from: Pt, to: Pt): number {
  let worst = 0;
  for (const point of points) worst = Math.max(worst, distanceToSegment(point, from, to));
  return worst;
}

function distanceToSegment(point: Pt, from: Pt, to: Pt): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  if (length < 1e-10) return Math.hypot(point.x - from.x, point.y - from.y);
  const t = Math.min(1, Math.max(0, ((point.x - from.x) * dx + (point.y - from.y) * dy) / length));
  return Math.hypot(point.x - (from.x + dx * t), point.y - (from.y + dy * t));
}

function maxCubicDistance(points: readonly Pt[], cubic: Cubic): { readonly distance: number; readonly index: number } {
  const t = chordParams(points);
  let distance = 0;
  let index = 0;
  for (let sample = 1; sample < points.length - 1; sample += 1) {
    const point = points[sample];
    if (point === undefined) continue;
    const at = bezier(cubic, t[sample] ?? 0);
    const error = Math.hypot(point.x - at.x, point.y - at.y);
    if (error > distance) {
      distance = error;
      index = sample;
    }
  }
  return { distance, index };
}

function bezier(cubic: Cubic, t: number): Pt {
  const u = 1 - t;
  const b0 = u * u * u;
  const b1 = 3 * u * u * t;
  const b2 = 3 * u * t * t;
  const b3 = t * t * t;
  return {
    x: cubic.p0.x * b0 + cubic.c1.x * b1 + cubic.c2.x * b2 + cubic.p1.x * b3,
    y: cubic.p0.y * b0 + cubic.c1.y * b1 + cubic.c2.y * b2 + cubic.p1.y * b3
  };
}

function reverseCubics(cubics: readonly Cubic[]): Cubic[] {
  return cubics.slice().reverse().map((cubic) => ({ p0: cubic.p1, c1: cubic.c2, c2: cubic.c1, p1: cubic.p0 }));
}

function travelAngle(points: readonly Pt[], rev: boolean): number {
  if (!rev) {
    const from = points[0];
    const to = points[1] ?? from;
    if (from === undefined || to === undefined) return 0;
    return Math.atan2(to.y - from.y, to.x - from.x);
  }
  const from = points[points.length - 1];
  const to = points[points.length - 2] ?? from;
  if (from === undefined || to === undefined) return 0;
  return Math.atan2(to.y - from.y, to.x - from.x);
}

function shoelace(points: readonly Pt[]): number {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (current === undefined || next === undefined) continue;
    sum += current.x * next.y - next.x * current.y;
  }
  return sum / 2;
}

function nest(cycles: Cycle[]): void {
  const probes = cycles.map((cycle) => interiorProbe(cycle.points));
  for (let index = 0; index < cycles.length; index += 1) {
    const cycle = cycles[index];
    const probe = probes[index];
    if (cycle === undefined || probe === undefined) continue;
    let parent = -1;
    let parentArea = Infinity;
    for (let otherIndex = 0; otherIndex < cycles.length; otherIndex += 1) {
      if (otherIndex === index) continue;
      const other = cycles[otherIndex];
      if (other === undefined || other.label !== cycle.label || other.area <= cycle.area) continue;
      if (!pointInPoly(other.points, probe.x, probe.y)) continue;
      if (other.area < parentArea) {
        parentArea = other.area;
        parent = otherIndex;
      }
    }
    cycle.parent = parent;
    if (parent >= 0) cycles[parent]?.children.push(index);
  }
}

function interiorProbe(points: readonly Pt[]): Pt {
  const first = points[0];
  const second = points[1] ?? first;
  if (first === undefined || second === undefined) return { x: 0, y: 0 };
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: (first.x + second.x) / 2 + (dy / length) * 0.02, y: (first.y + second.y) / 2 - (dx / length) * 0.02 };
}

function pointInPoly(points: readonly Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const a = points[index];
    const b = points[previous];
    if (a === undefined || b === undefined) continue;
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y || 1e-12) + a.x) inside = !inside;
  }
  return inside;
}

function cyclePath(cubics: readonly Cubic[]): string {
  const first = cubics[0];
  if (first === undefined) return "";
  const commands = ["M " + fmt(first.p0.x) + " " + fmt(first.p0.y)];
  for (const cubic of cubics) commands.push("C " + fmt(cubic.c1.x) + " " + fmt(cubic.c1.y) + " " + fmt(cubic.c2.x) + " " + fmt(cubic.c2.y) + " " + fmt(cubic.p1.x) + " " + fmt(cubic.p1.y));
  commands.push("Z");
  return commands.join(" ");
}

function fmt(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  if (Object.is(rounded, -0)) return "0";
  return String(rounded);
}

function hex(color: RGB): string {
  return "#" + [color.r, color.g, color.b].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("");
}

function normalizeHex(fill: string | null): string | null {
  if (fill === null) return null;
  const match = /#([0-9a-fA-F]{6})/.exec(fill.trim());
  return match === null ? null : "#" + (match[1] ?? "").toLowerCase();
}

function emptySvg(width: number, height: number): string {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + String(width) + '" height="' + String(height) + '" viewBox="0 0 ' + String(width) + " " + String(height) + '"></svg>';
}
