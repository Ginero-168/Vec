export type AnchorPoint = {
  readonly pathIndex: number;
  readonly anchorIndex: number;
  readonly x: number;
  readonly y: number;
};

export type BatchItem = {
  readonly uuid: string;
  readonly name: string;
  readonly itemType: "PlacedItem" | "RasterItem";
  readonly embedded: boolean;
  readonly bounds: readonly [number, number, number, number];
};

export type BatchList = {
  readonly documentName: string;
  readonly documentIdentity: string;
  readonly items: readonly BatchItem[];
};

type Point = { x: number; y: number };
type Cubic = { p0: Point; p1: Point; p2: Point; p3: Point };
type Subpath = { cubics: Cubic[]; closed: boolean };
type Token = { cmd: string; args: number[] };
type AnchorLoc = { subIndex: number; kind: "start" | "end"; cubicIndex: number };

const ARG_COUNT: Readonly<Record<string, number>> = { m: 2, l: 2, h: 1, v: 1, c: 6, z: 0 };
const sampledCubics = new WeakMap<Cubic, readonly Point[]>();

function shapePattern(): RegExp {
  return /<path\b[^>]*\/>|<path\b[^>]*>[\s\S]*?<\/path>|<circle\b[^>]*\/>|<ellipse\b[^>]*\/>|<rect\b[^>]*\/>/gi;
}

export function fairTolerance(smoothness: number): number {
  const clamped = Math.min(3, Math.max(0, Number.isFinite(smoothness) ? smoothness : 0));
  return Math.round((0.4 + clamped * 2.2) * 100) / 100;
}

/** Fit tolerance in original pixels. The slider still moves it, and it stays under half a pixel. */
export function geometryTolerance(smoothness: number): number {
  const clamped = Math.min(3, Math.max(0, Number.isFinite(smoothness) ? smoothness : 0));
  return Math.round((0.12 + clamped * 0.08) * 100) / 100;
}

/** Drop anchors whose cubic can be merged without leaving the curve by more than `tolerance` source pixels. */
export function relaxPaths(svg: string, tolerance = 0.15): string {
  const limit = Math.min(0.5, Math.max(0.05, Number.isFinite(tolerance) ? tolerance : 0.15));
  return svg.replace(shapePattern(), (tag) => {
    if (!/^<path\b/i.test(tag)) return tag;
    const quoted = readD(tag);
    if (quoted === null) return tag;
    const parsed = parsePath(quoted.value);
    if (parsed === null || parsed.length === 0) return tag;
    const relaxed = parsed.map((subpath) => relaxSubpath(subpath, limit));
    const next = serialize(relaxed);
    if (next === quoted.value) return tag;
    return tag.slice(0, quoted.start) + next + tag.slice(quoted.end);
  });
}

function relaxSubpath(subpath: Subpath, tolerance: number): Subpath {
  const cubics = subpath.cubics.slice();
  let guard = cubics.length;
  let merged = true;
  while (merged && cubics.length > 1 && guard > 0) {
    merged = false;
    guard -= 1;
    const last = subpath.closed ? cubics.length : cubics.length - 1;
    for (let index = 0; index < last; index += 1) {
      const nextIndex = (index + 1) % cubics.length;
      if (nextIndex === 0) continue;
      const first = cubics[index];
      const second = cubics[nextIndex];
      if (first === undefined || second === undefined) continue;
      const fitted = fitSamples(sampleChain([first, second]), tolerance, outgoing(first), incoming(second), 0);
      const replacement = fitted?.[0];
      if (fitted === null || fitted.length !== 1 || replacement === undefined) continue;
      cubics.splice(index, 2, replacement);
      merged = true;
      break;
    }
  }
  return { cubics, closed: subpath.closed };
}

export function fairPaths(svg: string, options: { readonly smoothness: number; readonly cornerDegrees: number; readonly tolerance?: number }): string {
  const tolerance = options.tolerance ?? fairTolerance(options.smoothness);
  const minTurn = 90 - Math.min(90, Math.max(0, Number.isFinite(options.cornerDegrees) ? options.cornerDegrees : 0));
  return svg.replace(shapePattern(), (tag) => {
    if (!/^<path\b/i.test(tag)) return tag;
    const quoted = readD(tag);
    if (quoted === null) return tag;
    const parsed = parsePath(quoted.value);
    if (parsed === null || parsed.length === 0) return tag;
    const faired = parsed.map((subpath) => fairSubpath(subpath, tolerance, minTurn));
    const next = serialize(faired);
    if (next === quoted.value) return tag;
    return tag.slice(0, quoted.start) + next + tag.slice(quoted.end);
  });
}

export function listAnchors(svg: string): AnchorPoint[] {
  const anchors: AnchorPoint[] = [];
  let pathIndex = 0;
  for (const tag of svg.match(shapePattern()) ?? []) {
    if (!/^<path\b/i.test(tag)) continue;
    const data = readD(tag)?.value ?? "";
    const parsed = parsePath(data);
    if (parsed === null) {
      pathIndex += 1;
      continue;
    }
    const locations = anchorLocations(parsed);
    for (let anchorIndex = 0; anchorIndex < locations.length; anchorIndex += 1) {
      const point = pointOf(parsed, locations[anchorIndex]);
      if (point === null) continue;
      anchors.push({ pathIndex, anchorIndex, x: point.x, y: point.y });
    }
    pathIndex += 1;
  }
  return anchors;
}

export function moveAnchor(svg: string, pathIndex: number, anchorIndex: number, x: number, y: number): string {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return svg;
  let seen = 0;
  return svg.replace(shapePattern(), (tag) => {
    if (!/^<path\b/i.test(tag)) return tag;
    const current = seen;
    seen += 1;
    if (current !== pathIndex) return tag;
    const quoted = readD(tag);
    if (quoted === null) return tag;
    const parsed = parsePath(quoted.value);
    if (parsed === null) return tag;
    const locations = anchorLocations(parsed);
    const loc = locations[anchorIndex];
    if (loc === undefined) return tag;
    const moved = applyMove(parsed, loc, x, y);
    if (moved === null) return tag;
    return tag.slice(0, quoted.start) + serialize(moved) + tag.slice(quoted.end);
  });
}

export function removeShape(svg: string, index: number): string {
  const tags = svg.match(shapePattern()) ?? [];
  if (index < 0 || index >= tags.length || tags.length < 2) return svg;
  let seen = 0;
  return svg.replace(shapePattern(), (tag) => {
    const current = seen;
    seen += 1;
    return current === index ? "" : tag;
  });
}

export function expandPrimitives(svg: string): string {
  return svg.replace(shapePattern(), (tag) => primitivePath(tag) ?? tag);
}

export function paintDisc(rgba: Uint8Array, width: number, height: number, x: number, y: number, radius: number, color: string): Uint8Array {
  const next = new Uint8Array(rgba);
  const rgb = parseHex(color);
  if (rgb === null || !(radius > 0) || width <= 0 || height <= 0) return next;
  const radiusSquared = radius * radius;
  const left = Math.max(0, Math.floor(x - radius));
  const right = Math.min(width - 1, Math.ceil(x + radius));
  const top = Math.max(0, Math.floor(y - radius));
  const bottom = Math.min(height - 1, Math.ceil(y + radius));
  for (let py = top; py <= bottom; py += 1) {
    for (let px = left; px <= right; px += 1) {
      const dx = px + 0.5 - x;
      const dy = py + 0.5 - y;
      if (dx * dx + dy * dy > radiusSquared) continue;
      const offset = (py * width + px) * 4;
      next[offset] = rgb[0];
      next[offset + 1] = rgb[1];
      next[offset + 2] = rgb[2];
      next[offset + 3] = 255;
    }
  }
  return next;
}

export function paletteFromRaster(rgba: Uint8Array): readonly string[] | null {
  const colors: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < rgba.length; index += 4) {
    if ((rgba[index + 3] ?? 0) < 128) continue;
    const color = "#" + byte(rgba[index]) + byte(rgba[index + 1]) + byte(rgba[index + 2]);
    if (seen.has(color)) continue;
    if (colors.length === 32) return null;
    seen.add(color);
    colors.push(color);
  }
  return colors;
}

export function parseBatchFields(parts: readonly string[]): BatchList {
  if (parts.length < 3) throw new Error("รายการภาพไม่ครบ");
  const count = Number(parts[2]);
  if (!Number.isInteger(count) || count < 0 || count > 12) throw new Error("จำนวนภาพต่อชุดต้องไม่เกิน 12");
  if (parts.length !== 3 + count * 8) throw new Error("รายการภาพไม่ครบ");
  const items: BatchItem[] = [];
  for (let index = 0; index < count; index += 1) {
    const base = 3 + index * 8;
    const uuid = parts[base] ?? "";
    const itemType = parts[base + 2];
    if (!uuid) throw new Error("ภาพไม่มี UUID");
    if (itemType !== "PlacedItem" && itemType !== "RasterItem") throw new Error("รองรับภาพ raster");
    const left = finite(parts[base + 4], "left");
    const top = finite(parts[base + 5], "top");
    const right = finite(parts[base + 6], "right");
    const bottom = finite(parts[base + 7], "bottom");
    if (right <= left || top <= bottom) throw new Error("ขนาดภาพไม่ถูกต้อง");
    items.push({
      uuid,
      name: parts[base + 1] ?? "",
      itemType,
      embedded: parts[base + 3] === "1",
      bounds: [left, top, right, bottom]
    });
  }
  return { documentName: parts[0] ?? "", documentIdentity: parts[1] ?? "", items };
}

function finite(raw: string | undefined, label: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error("ค่าจาก Illustrator ไม่ถูกต้อง: " + label);
  return value;
}

function byte(value: number | undefined): string {
  return (value ?? 0).toString(16).padStart(2, "0");
}

function parseHex(color: string): readonly [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (match === null) return null;
  const hex = match[1] ?? "";
  return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
}

function readD(tag: string): { readonly value: string; readonly start: number; readonly end: number } | null {
  const match = /\bd\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag);
  if (match === null || match[1] === undefined || match.index === undefined) return null;
  const value = match[2] ?? "";
  const open = match.index + match[0].indexOf(match[1]);
  return { value, start: open + 1, end: open + 1 + value.length };
}

function fairSubpath(subpath: Subpath, tolerance: number, minTurn: number): Subpath {
  if (subpath.cubics.length < 2) return subpath;
  const points = outlinePoints(subpath);
  const locked = new Set(protectedStarts(subpath.cubics, subpath.closed, minTurn));
  if (!subpath.closed) {
    locked.add(0);
    locked.add(points.length - 1);
  }
  const kept = subpath.closed ? simplifyClosed(points, tolerance, locked) : simplifyOpen(points, tolerance, locked);
  const cubics: Cubic[] = [];
  for (let index = 0; index < kept.length; index += 1) {
    const from = kept[index] ?? 0;
    const to = kept[subpath.closed ? (index + 1) % kept.length : index + 1];
    if (to === undefined) continue;
    const chain = cubicsBetween(subpath.cubics, from, to, subpath.closed);
    const start = points[from];
    const end = points[to];
    if (chain.length > 1 && start !== undefined && end !== undefined) cubics.push(straightCubic(start, end));
    else cubics.push(...fitChain(chain, tolerance));
  }
  return { cubics: cubics.length > 0 ? cubics : subpath.cubics, closed: subpath.closed };
}

function outlinePoints(subpath: Subpath): Point[] {
  const points = subpath.cubics.map((cubic) => cubic.p0);
  const last = subpath.cubics[subpath.cubics.length - 1]?.p3;
  const first = points[0];
  if (last !== undefined && (first === undefined || !subpath.closed || distance(first, last) >= 0.05)) points.push(last);
  return points;
}

function simplifyOpen(points: readonly Point[], epsilon: number, locked: ReadonlySet<number>): number[] {
  const seeds = uniqueSorted([0, points.length - 1, ...locked]);
  const keep = new Set<number>(seeds);
  for (let index = 0; index < seeds.length - 1; index += 1) keepFar(points, seeds[index] ?? 0, seeds[index + 1] ?? 0, epsilon, keep);
  return uniqueSorted(keep);
}

function simplifyClosed(points: readonly Point[], epsilon: number, locked: ReadonlySet<number>): number[] {
  let seeds = uniqueSorted(locked);
  if (seeds.length === 0) seeds = diameterIndices(points);
  else if (seeds.length === 1) seeds = uniqueSorted([seeds[0] ?? 0, farthestIndex(points, seeds[0] ?? 0)]);
  const keep = new Set<number>(seeds);
  for (let index = 0; index < seeds.length; index += 1) {
    keepFar(points, seeds[index] ?? 0, seeds[(index + 1) % seeds.length] ?? 0, epsilon, keep);
  }
  return uniqueSorted(keep);
}

function keepFar(points: readonly Point[], from: number, to: number, epsilon: number, keep: Set<number>): void {
  const chain = indexSpan(from, to, points.length);
  if (chain.length < 3) return;
  const start = points[from];
  const end = points[to];
  if (start === undefined || end === undefined) return;
  let worst = 0;
  let at = -1;
  for (let index = 1; index < chain.length - 1; index += 1) {
    const pointIndex = chain[index] ?? 0;
    const point = points[pointIndex];
    if (point === undefined) continue;
    const gap = distanceToSegment(point, start, end);
    if (gap > worst) {
      worst = gap;
      at = pointIndex;
    }
  }
  if (at < 0 || worst <= epsilon) return;
  keep.add(at);
  keepFar(points, from, at, epsilon, keep);
  keepFar(points, at, to, epsilon, keep);
}

function indexSpan(from: number, to: number, count: number): number[] {
  const span = [from];
  if (count <= 0) return span;
  let cursor = from;
  while (cursor !== to && span.length <= count) {
    cursor = (cursor + 1) % count;
    span.push(cursor);
  }
  return span;
}

function diameterIndices(points: readonly Point[]): number[] {
  let best = 0;
  let left = 0;
  let right = points.length > 1 ? 1 : 0;
  for (let start = 0; start < points.length; start += 1) {
    const origin = points[start];
    if (origin === undefined) continue;
    for (let index = start + 1; index < points.length; index += 1) {
      const point = points[index];
      if (point === undefined) continue;
      const gap = distance(origin, point);
      if (gap > best) {
        best = gap;
        left = start;
        right = index;
      }
    }
  }
  return uniqueSorted([left, right]);
}

function farthestIndex(points: readonly Point[], origin: number): number {
  const start = points[origin];
  if (start === undefined) return origin;
  let best = 0;
  let at = origin;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (point === undefined) continue;
    const gap = distance(start, point);
    if (gap > best) {
      best = gap;
      at = index;
    }
  }
  return at;
}

function uniqueSorted(values: Iterable<number>): number[] {
  return Array.from(new Set(values)).filter((value) => Number.isInteger(value) && value >= 0).sort((left, right) => left - right);
}

function cubicsBetween(cubics: readonly Cubic[], from: number, to: number, closed: boolean): Cubic[] {
  if (!closed) return cubics.slice(from, to);
  if (to > from) return cubics.slice(from, to);
  return cubics.slice(from).concat(cubics.slice(0, to));
}

function protectedStarts(cubics: readonly Cubic[], closed: boolean, minTurn: number): number[] {
  const stairs = stairRunIndices(cubics.map((_, index) => {
    const previous = cubics[closed ? (index - 1 + cubics.length) % cubics.length : index - 1];
    const next = cubics[index];
    return previous !== undefined && next !== undefined && isStairJoint(previous, next);
  }), closed);
  const starts: number[] = [];
  for (let index = 0; index < cubics.length; index += 1) {
    if (stairs.has(index)) continue;
    const previous = cubics[closed ? (index - 1 + cubics.length) % cubics.length : index - 1];
    const next = cubics[index];
    if (previous === undefined || next === undefined) continue;
    if (isCorner(previous, next, minTurn)) starts.push(index);
  }
  return starts;
}

function stairRunIndices(flags: readonly boolean[], closed: boolean): Set<number> {
  const skip = new Set<number>();
  const count = flags.length;
  const minimum = closed ? 5 : 3;
  const mark = (run: readonly number[]): void => {
    if (run.length < minimum) return;
    for (const index of run) skip.add(index);
  };
  if (!closed) {
    let run: number[] = [];
    for (let index = 0; index < count; index += 1) {
      if (flags[index] === true) run.push(index);
      else {
        mark(run);
        run = [];
      }
    }
    mark(run);
    return skip;
  }
  let gap = -1;
  for (let index = 0; index < count; index += 1) {
    if (flags[index] !== true) {
      gap = index;
      break;
    }
  }
  if (gap < 0) {
    if (count >= 5) for (let index = 0; index < count; index += 1) skip.add(index);
    return skip;
  }
  let run: number[] = [];
  for (let step = 1; step <= count; step += 1) {
    const index = (gap + step) % count;
    if (flags[index] === true) run.push(index);
    else {
      mark(run);
      run = [];
    }
  }
  mark(run);
  return skip;
}

function isStairJoint(previous: Cubic, next: Cubic): boolean {
  if (chord(previous) > 24 || chord(next) > 24) return false;
  const turn = turnDegrees(incoming(previous), outgoing(next));
  return turn >= 60 && turn <= 120;
}

function isStairChain(chain: readonly Cubic[]): boolean {
  if (chain.length < 3) return false;
  for (let index = 1; index < chain.length; index += 1) {
    const previous = chain[index - 1];
    const next = chain[index];
    if (previous === undefined || next === undefined || !isStairJoint(previous, next)) return false;
  }
  return true;
}

function isCorner(previous: Cubic, next: Cubic, minTurn: number): boolean {
  const longer = Math.max(chord(previous), chord(next));
  if (!(longer > 3)) return false;
  return turnDegrees(incoming(previous), outgoing(next)) >= minTurn;
}

function fitChain(chain: readonly Cubic[], tolerance: number): Cubic[] {
  if (chain.length <= 1) return chain.slice();
  const limit = isStairChain(chain) && tolerance >= 1 ? Math.max(tolerance, 6) : tolerance;
  const samples = sampleChain(chain);
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (first === undefined || last === undefined || distance(first, last) < 0.05) return chain.slice();
  const fitted = fitSamples(samples, limit, outgoing(chain[0] ?? line(first, last)), incoming(chain[chain.length - 1] ?? line(first, last)), 0);
  if (fitted === null || fitted.length === 0 || fitted.length >= chain.length) return chain.slice();
  return fitted;
}

function fitSamples(samples: readonly Point[], tolerance: number, tanStart: Point, tanEnd: Point, depth: number): Cubic[] | null {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (first === undefined || last === undefined) return null;
  if (distance(first, last) < 0.05) return [];
  if (maxSegmentDistance(samples, first, last) <= tolerance) return [straightCubic(first, last)];
  const cubic = fitCubic(samples, tanStart, tanEnd);
  const worst = farthest(samples, cubic);
  if (worst.distance <= tolerance) return [cubic];
  const index = splitIndex(samples, worst.index);
  if (depth >= 12 || index <= 0 || index >= samples.length - 1) return null;
  const tangent = tangentAt(samples, index);
  const left = fitSamples(samples.slice(0, index + 1), tolerance, tanStart, tangent, depth + 1);
  const right = fitSamples(samples.slice(index), tolerance, tangent, tanEnd, depth + 1);
  if (left === null || right === null) return null;
  return [...left, ...right];
}

function sampleChain(chain: readonly Cubic[]): Point[] {
  const samples: Point[] = [];
  chain.forEach((cubic, index) => {
    if (index === 0) samples.push(cubic.p0);
    for (const t of [0.25, 0.5, 0.75, 1]) samples.push(bezier(cubic, t));
  });
  return samples;
}

function splitIndex(samples: readonly Point[], errorIndex: number): number {
  const last = samples.length - 1;
  if (errorIndex >= 3 && errorIndex <= last - 3) return errorIndex;
  const first = samples[0];
  const end = samples[last];
  if (first === undefined || end === undefined) return Math.max(1, Math.floor(last / 2));
  let bulge = 0;
  let at = Math.max(1, Math.floor(last / 2));
  for (let index = 2; index <= last - 2; index += 1) {
    const point = samples[index];
    if (point === undefined) continue;
    const error = distanceToSegment(point, first, end);
    if (error > bulge) {
      bulge = error;
      at = index;
    }
  }
  return at;
}

function farthest(samples: readonly Point[], cubic: Cubic): { readonly distance: number; readonly index: number } {
  let distanceWorst = 0;
  let index = 0;
  const curveSamples = sampleCubic(cubic);
  for (let sampleIndex = 1; sampleIndex < samples.length - 1; sampleIndex += 1) {
    const point = samples[sampleIndex];
    if (point === undefined) continue;
    const error = distanceToCubicSamples(point, curveSamples);
    if (error > distanceWorst) {
      distanceWorst = error;
      index = sampleIndex;
    }
  }
  return { distance: distanceWorst, index };
}

function maxSegmentDistance(samples: readonly Point[], start: Point, end: Point): number {
  let worst = 0;
  for (const point of samples) worst = Math.max(worst, distanceToSegment(point, start, end));
  return worst;
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-8) return distance(point, start);
  const t = Math.min(1, Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return distance(point, { x: start.x + dx * t, y: start.y + dy * t });
}

function sampleCubic(cubic: Cubic): readonly Point[] {
  const cached = sampledCubics.get(cubic);
  if (cached !== undefined) return cached;
  const samples: Point[] = [];
  for (let step = 0; step <= 24; step += 1) samples.push(bezier(cubic, step / 24));
  sampledCubics.set(cubic, samples);
  return samples;
}

function distanceToCubicSamples(point: Point, samples: readonly Point[]): number {
  let bestSquared = Infinity;
  for (const sample of samples) {
    const dx = point.x - sample.x;
    const dy = point.y - sample.y;
    const squared = dx * dx + dy * dy;
    if (squared < bestSquared) bestSquared = squared;
  }
  return Math.sqrt(bestSquared);
}

function tangentAt(samples: readonly Point[], index: number): Point {
  const previous = samples[Math.max(0, index - 1)] ?? { x: 0, y: 0 };
  const next = samples[Math.min(samples.length - 1, index + 1)] ?? previous;
  return { x: next.x - previous.x, y: next.y - previous.y };
}

function straightCubic(start: Point, end: Point): Cubic {
  return {
    p0: start,
    p1: { x: start.x + (end.x - start.x) / 3, y: start.y + (end.y - start.y) / 3 },
    p2: { x: start.x + (2 * (end.x - start.x)) / 3, y: start.y + (2 * (end.y - start.y)) / 3 },
    p3: end
  };
}

function fitCubic(samples: readonly Point[], tanStart: Point, tanEnd: Point): Cubic {
  const start = samples[0];
  const end = samples[samples.length - 1];
  if (start === undefined || end === undefined) return straightCubic(start ?? { x: 0, y: 0 }, end ?? { x: 0, y: 0 });
  const fallback = cubicFromTangents(start, end, tanStart, tanEnd);
  const startDir = unit(tanStart);
  const endDir = unit(tanEnd);
  if (startDir === null || endDir === null || samples.length < 4) return fallback;
  const parameters = chordParameters(samples);
  const solved = solveCubic(samples, parameters, start, end, startDir, endDir);
  const refined = solved === null ? null : solveCubic(samples, projectParameters(samples, solved), start, end, startDir, endDir);
  let best = fallback;
  for (const next of [solved, refined]) {
    if (next !== null && cubicError(samples, next) < cubicError(samples, best)) best = next;
  }
  return best;
}

function cubicError(samples: readonly Point[], cubic: Cubic): number {
  let worst = 0;
  const curveSamples = sampleCubic(cubic);
  for (const sample of samples) worst = Math.max(worst, distanceToCubicSamples(sample, curveSamples));
  return worst;
}

function chordParameters(samples: readonly Point[]): number[] {
  const lengths: number[] = [0];
  let total = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const next = samples[index];
    total += previous === undefined || next === undefined ? 0 : distance(previous, next);
    lengths.push(total);
  }
  if (total < 1e-6) return samples.map((_, index) => (samples.length <= 1 ? 0 : index / (samples.length - 1)));
  return lengths.map((length) => length / total);
}

function solveCubic(samples: readonly Point[], parameters: readonly number[], start: Point, end: Point, startDir: Point, endDir: Point): Cubic | null {
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let d0 = 0;
  let d1 = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const t = parameters[index] ?? 0;
    if (sample === undefined) continue;
    const u = 1 - t;
    const b1 = 3 * u * u * t;
    const b2 = 3 * u * t * t;
    const baseX = (u * u * u + b1) * start.x + (b2 + t * t * t) * end.x;
    const baseY = (u * u * u + b1) * start.y + (b2 + t * t * t) * end.y;
    const ux = b1 * startDir.x;
    const uy = b1 * startDir.y;
    const vx = -b2 * endDir.x;
    const vy = -b2 * endDir.y;
    const rx = sample.x - baseX;
    const ry = sample.y - baseY;
    c00 += ux * ux + uy * uy;
    c01 += ux * vx + uy * vy;
    c11 += vx * vx + vy * vy;
    d0 += ux * rx + uy * ry;
    d1 += vx * rx + vy * ry;
  }
  const det = c00 * c11 - c01 * c01;
  if (Math.abs(det) < 1e-8) return null;
  const alpha = (d0 * c11 - c01 * d1) / det;
  const beta = (c00 * d1 - c01 * d0) / det;
  const limit = distance(start, end) * 3;
  if (!(alpha > 0.05) || !(beta > 0.05) || alpha > limit || beta > limit) return null;
  return {
    p0: start,
    p1: { x: start.x + startDir.x * alpha, y: start.y + startDir.y * alpha },
    p2: { x: end.x - endDir.x * beta, y: end.y - endDir.y * beta },
    p3: end
  };
}

function projectParameters(samples: readonly Point[], cubic: Cubic): number[] {
  return samples.map((sample, index) => {
    if (index === 0) return 0;
    if (index === samples.length - 1) return 1;
    let bestT = index / (samples.length - 1);
    let best = Infinity;
    for (let step = 0; step <= 16; step += 1) {
      const t = step / 16;
      const error = distance(sample, bezier(cubic, t));
      if (error < best) {
        best = error;
        bestT = t;
      }
    }
    return bestT;
  });
}

function cubicFromTangents(start: Point, end: Point, tanStart: Point, tanEnd: Point): Cubic {
  const handle = distance(start, end) / 3;
  const startDir = unit(tanStart) ?? unit({ x: end.x - start.x, y: end.y - start.y }) ?? { x: 1, y: 0 };
  const endDir = unit(tanEnd) ?? startDir;
  return {
    p0: start,
    p1: { x: start.x + startDir.x * handle, y: start.y + startDir.y * handle },
    p2: { x: end.x - endDir.x * handle, y: end.y - endDir.y * handle },
    p3: end
  };
}

function bezier(cubic: Cubic, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * cubic.p0.x + 3 * u * u * t * cubic.p1.x + 3 * u * t * t * cubic.p2.x + t * t * t * cubic.p3.x,
    y: u * u * u * cubic.p0.y + 3 * u * u * t * cubic.p1.y + 3 * u * t * t * cubic.p2.y + t * t * t * cubic.p3.y
  };
}

function outgoing(cubic: Cubic): Point {
  const handle = { x: cubic.p1.x - cubic.p0.x, y: cubic.p1.y - cubic.p0.y };
  return lengthOf(handle) > 1e-6 ? handle : { x: cubic.p3.x - cubic.p0.x, y: cubic.p3.y - cubic.p0.y };
}

function incoming(cubic: Cubic): Point {
  const handle = { x: cubic.p3.x - cubic.p2.x, y: cubic.p3.y - cubic.p2.y };
  return lengthOf(handle) > 1e-6 ? handle : { x: cubic.p3.x - cubic.p0.x, y: cubic.p3.y - cubic.p0.y };
}

function chord(cubic: Cubic): number {
  return distance(cubic.p0, cubic.p3);
}

function turnDegrees(incomingDir: Point, outgoingDir: Point): number {
  const a = unit(incomingDir);
  const b = unit(outgoingDir);
  if (a === null || b === null) return 0;
  const dot = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y));
  return (Math.acos(dot) * 180) / Math.PI;
}

function unit(point: Point): Point | null {
  const length = lengthOf(point);
  if (length < 1e-6) return null;
  return { x: point.x / length, y: point.y / length };
}

function lengthOf(point: Point): number {
  return Math.hypot(point.x, point.y);
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function line(start: Point, end: Point): Cubic {
  return straightCubic(start, end);
}

function anchorLocations(subpaths: readonly Subpath[]): AnchorLoc[] {
  const locations: AnchorLoc[] = [];
  subpaths.forEach((subpath, subIndex) => {
    if (subpath.cubics.length === 0) return;
    locations.push({ subIndex, kind: "start", cubicIndex: 0 });
    subpath.cubics.forEach((cubic, cubicIndex) => {
      const start = subpath.cubics[0]?.p0;
      const closing = subpath.closed && start !== undefined && cubicIndex === subpath.cubics.length - 1 && distance(cubic.p3, start) < 0.05;
      if (!closing) locations.push({ subIndex, kind: "end", cubicIndex });
    });
  });
  return locations;
}

function pointOf(subpaths: readonly Subpath[], loc: AnchorLoc | undefined): Point | null {
  if (loc === undefined) return null;
  const subpath = subpaths[loc.subIndex];
  const cubic = subpath?.cubics[loc.cubicIndex];
  if (subpath === undefined || cubic === undefined) return null;
  return loc.kind === "start" ? cubic.p0 : cubic.p3;
}

function applyMove(subpaths: readonly Subpath[], loc: AnchorLoc, x: number, y: number): Subpath[] | null {
  const current = pointOf(subpaths, loc);
  if (current === null) return null;
  const dx = x - current.x;
  const dy = y - current.y;
  return subpaths.map((subpath, subIndex) => {
    if (subIndex !== loc.subIndex) return subpath;
    const cubics = subpath.cubics.map((cubic) => ({
      p0: { ...cubic.p0 },
      p1: { ...cubic.p1 },
      p2: { ...cubic.p2 },
      p3: { ...cubic.p3 }
    }));
    if (loc.kind === "start") {
      const first = cubics[0];
      if (first === undefined) return subpath;
      first.p0 = shift(first.p0, dx, dy);
      first.p1 = shift(first.p1, dx, dy);
      const last = cubics[cubics.length - 1];
      if (subpath.closed && last !== undefined && distance(last.p3, current) < 0.05) {
        last.p2 = shift(last.p2, dx, dy);
        last.p3 = shift(last.p3, dx, dy);
      }
    } else {
      const cubic = cubics[loc.cubicIndex];
      if (cubic === undefined) return subpath;
      cubic.p2 = shift(cubic.p2, dx, dy);
      cubic.p3 = shift(cubic.p3, dx, dy);
      const next = cubics[loc.cubicIndex + 1];
      if (next !== undefined) {
        next.p0 = shift(next.p0, dx, dy);
        next.p1 = shift(next.p1, dx, dy);
      }
    }
    return { cubics, closed: subpath.closed };
  });
}

function shift(point: Point, dx: number, dy: number): Point {
  return { x: point.x + dx, y: point.y + dy };
}

function serialize(subpaths: readonly Subpath[]): string {
  return subpaths
    .map((subpath) => {
      if (subpath.cubics.length === 0) return "";
      const commands = ["M" + pair(subpath.cubics[0]?.p0 ?? { x: 0, y: 0 })];
      for (const cubic of subpath.cubics) commands.push("C" + pair(cubic.p1) + " " + pair(cubic.p2) + " " + pair(cubic.p3));
      if (subpath.closed) commands.push("Z");
      return commands.join("");
    })
    .join("");
}

function pair(point: Point): string {
  return fmt(point.x) + "," + fmt(point.y);
}

function fmt(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function parsePath(data: string): Subpath[] | null {
  const tokens = tokenize(data);
  if (tokens === null) return null;
  const subpaths: Subpath[] = [];
  let current: Cubic[] = [];
  let closed = false;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let drawing = false;
  const commit = (): void => {
    if (!drawing) return;
    subpaths.push({ cubics: current, closed });
    current = [];
    closed = false;
    drawing = false;
  };
  for (const token of tokens) {
    const op = token.cmd.toLowerCase();
    const relative = token.cmd === op;
    const at = (index: number): number => token.args[index] ?? 0;
    if (op === "m") {
      commit();
      cx = relative ? cx + at(0) : at(0);
      cy = relative ? cy + at(1) : at(1);
      sx = cx;
      sy = cy;
      drawing = true;
    } else if (op === "l") {
      const x = relative ? cx + at(0) : at(0);
      const y = relative ? cy + at(1) : at(1);
      current.push(straightCubic({ x: cx, y: cy }, { x, y }));
      cx = x;
      cy = y;
    } else if (op === "h") {
      const x = relative ? cx + at(0) : at(0);
      current.push(straightCubic({ x: cx, y: cy }, { x, y: cy }));
      cx = x;
    } else if (op === "v") {
      const y = relative ? cy + at(0) : at(0);
      current.push(straightCubic({ x: cx, y: cy }, { x: cx, y }));
      cy = y;
    } else if (op === "c") {
      const p1 = relative ? { x: cx + at(0), y: cy + at(1) } : { x: at(0), y: at(1) };
      const p2 = relative ? { x: cx + at(2), y: cy + at(3) } : { x: at(2), y: at(3) };
      const p3 = relative ? { x: cx + at(4), y: cy + at(5) } : { x: at(4), y: at(5) };
      current.push({ p0: { x: cx, y: cy }, p1, p2, p3 });
      cx = p3.x;
      cy = p3.y;
    } else if (op === "z") {
      if (Math.hypot(cx - sx, cy - sy) >= 0.05) current.push(straightCubic({ x: cx, y: cy }, { x: sx, y: sy }));
      cx = sx;
      cy = sy;
      closed = true;
      commit();
    }
  }
  commit();
  return subpaths;
}

function tokenize(data: string): Token[] | null {
  const tokens: Token[] = [];
  let index = 0;
  let cmd = "";
  let args: number[] = [];
  while (index < data.length) {
    const char = data[index] ?? "";
    if (/[A-Za-z]/.test(char)) {
      if (!/[MmLlHhVvCcZz]/.test(char)) return null;
      if (args.length > 0) return null;
      cmd = char;
      args = [];
      index += 1;
      if (char === "Z" || char === "z") {
        tokens.push({ cmd: char, args: [] });
        cmd = "";
      }
      continue;
    }
    if (char === "," || /\s/.test(char)) {
      index += 1;
      continue;
    }
    if (cmd === "") return null;
    const number = readNumber(data, index);
    if (number === null) return null;
    args.push(number.value);
    index = number.next;
    const count = ARG_COUNT[cmd.toLowerCase()];
    if (count === undefined) return null;
    if (args.length === count) {
      tokens.push({ cmd, args });
      args = [];
      if (cmd === "M") cmd = "L";
      else if (cmd === "m") cmd = "l";
    }
  }
  return args.length === 0 ? tokens : null;
}

function readNumber(data: string, index: number): { readonly value: number; readonly next: number } | null {
  const match = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(data.slice(index));
  if (match === null) return null;
  const raw = match[0];
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return { value, next: index + raw.length };
}

function primitivePath(tag: string): string | null {
  const name = (/^<([a-z]+)/i.exec(tag)?.[1] ?? "").toLowerCase();
  if (name !== "circle" && name !== "ellipse" && name !== "rect") return null;
  const attrs = /^<(?:circle|ellipse|rect)\b([^>]*)\/?>/i.exec(tag)?.[1] ?? "";
  const numberAttr = (key: string): number | null => {
    const raw = readAttr(attrs, key);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  let data = "";
  if (name === "rect") {
    const width = numberAttr("width");
    const height = numberAttr("height");
    if (width === null || height === null || !(width > 0) || !(height > 0)) return null;
    const x = numberAttr("x") ?? 0;
    const y = numberAttr("y") ?? 0;
    data = "M" + fmt(x) + "," + fmt(y) + "H" + fmt(x + width) + "V" + fmt(y + height) + "H" + fmt(x) + "Z";
  } else {
    const rx = name === "circle" ? numberAttr("r") : numberAttr("rx");
    const ry = name === "circle" ? rx : numberAttr("ry");
    if (rx === null || ry === null || !(rx > 0) || !(ry > 0)) return null;
    const cx = numberAttr("cx") ?? 0;
    const cy = numberAttr("cy") ?? 0;
    data = ellipsePath(cx, cy, rx, ry);
  }
  const kept = ["fill", "stroke", "stroke-width", "stroke-linejoin", "opacity", "transform", "fill-rule", "id"]
    .map((key) => {
      const value = readAttr(attrs, key);
      return value === null ? "" : " " + key + '="' + value.replace(/"/g, "") + '"';
    })
    .join("");
  return '<path d="' + data + '"' + kept + "/>";
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  const k = 0.5522847498;
  const curves = [
    [cx + rx, cy + k * ry, cx + k * rx, cy + ry, cx, cy + ry],
    [cx - k * rx, cy + ry, cx - rx, cy + k * ry, cx - rx, cy],
    [cx - rx, cy - k * ry, cx - k * rx, cy - ry, cx, cy - ry],
    [cx + k * rx, cy - ry, cx + rx, cy - k * ry, cx + rx, cy]
  ];
  return "M" + fmt(cx + rx) + "," + fmt(cy) + curves.map((row) => "C" + row.map((value) => fmt(value)).join(",")).join("") + "Z";
}

function readAttr(attrs: string, name: string): string | null {
  const match = new RegExp("\\b" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", "i").exec(attrs);
  if (match === null) return null;
  return match[1] ?? match[2] ?? "";
}

/**
 * Classify each short corner segment as sharp or round. VTracer rounds a hard corner into a tiny cubic between two
 * long runs; when that cubic is shorter than `fillet` source pixels, turns the path by at least `minTurn` degrees, and
 * the neighbouring tangents meet next to it, the corner is sharp: the tiny cubic is removed and both neighbours end at
 * the tangent intersection. Longer bends are real rounded corners and stay.
 */
export function sharpenCorners(svg: string, fillet = 1.25, minTurn = 35, curl = fillet): string {
  return sharpenWith(svg, fillet, minTurn, curl, null);
}

/**
 * The cap a sharpening would toggle: the region between the traced rounded corner and the sharp corner it becomes,
 * as a closed polygon in path coordinates. `confirm` receives the path's fill, the cap, and the path's current
 * nonzero fill test; it answers whether the source raster is better explained by the sharp corner.
 */
export type CornerCheck = (
  fill: string,
  cap: readonly { readonly x: number; readonly y: number }[],
  inside: (x: number, y: number) => boolean
) => boolean;

/** sharpenCorners, but each corner is only sharpened when `confirm` says the raster fills its cap. */
export function sharpenConfirmed(svg: string, fillet: number, minTurn: number, curl: number, confirm: CornerCheck): string {
  return sharpenWith(svg, fillet, minTurn, curl, confirm);
}

function sharpenWith(svg: string, fillet: number, minTurn: number, curl: number, confirm: CornerCheck | null): string {
  return svg.replace(shapePattern(), (tag) => {
    if (!/^<path\b/i.test(tag)) return tag;
    const quoted = readD(tag);
    if (quoted === null) return tag;
    const parsed = parsePath(quoted.value);
    if (parsed === null || parsed.length === 0) return tag;
    const fill = /\bfill="([^"]*)"/i.exec(tag)?.[1] ?? "";
    let flat: Point[][] | null = null;
    const inside = (x: number, y: number) => insideFlat((flat ??= flatten(parsed)), x, y);
    const check = confirm === null ? null : (cap: readonly Point[]) => confirm(fill, cap, inside);
    const sharpened = parsed.map((subpath) => sharpenSubpath(subpath, fillet, minTurn, curl, check));
    const next = serialize(sharpened);
    if (next === quoted.value) return tag;
    return tag.slice(0, quoted.start) + next + tag.slice(quoted.end);
  });
}

function flatten(subpaths: readonly Subpath[]): Point[][] {
  return subpaths.map((subpath) => subpath.cubics.flatMap((cubic) => [0, 1, 2, 3, 4, 5, 6, 7].map((step) => bezier(cubic, step / 8))));
}

/** Nonzero-rule fill test against flattened subpaths. */
function insideFlat(rings: readonly Point[][], x: number, y: number): boolean {
  let winding = 0;
  for (const points of rings) {
    for (let index = 0; index < points.length; index += 1) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      if (a === undefined || b === undefined) continue;
      const side = (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y);
      if (a.y <= y && b.y > y && side > 0) winding += 1;
      else if (a.y > y && b.y <= y && side < 0) winding -= 1;
    }
  }
  return winding !== 0;
}

function sharpenSubpath(subpath: Subpath, fillet: number, minTurn: number, curl: number, check: ((cap: readonly Point[]) => boolean) | null): Subpath {
  if (!subpath.closed || subpath.cubics.length < 4) return subpath;
  const cubics = subpath.cubics.map((cubic) => ({ p0: { ...cubic.p0 }, p1: { ...cubic.p1 }, p2: { ...cubic.p2 }, p3: { ...cubic.p3 } }));
  const turnLimit = (minTurn * Math.PI) / 180;
  let index = 0;
  while (index < cubics.length && cubics.length >= 4) {
    // The rounded corner may be one tiny cubic or a run of them; try the shortest run first.
    let replaced = false;
    let run = 0;
    let length = 0;
    while (!replaced && run < 4 && cubics.length - run >= 3) {
      const piece = cubics[(index + run) % cubics.length];
      if (piece === undefined) break;
      length += distance(piece.p0, piece.p3);
      run += 1;
      if (length > fillet) break;
      const before = cubics[(index - 1 + cubics.length) % cubics.length];
      const after = cubics[(index + run) % cubics.length];
      if (before === undefined || after === undefined || before === after) break;
      const into = incoming(before);
      const out = outgoing(after);
      if (angleBetween(into, out) < turnLimit) continue;
      if (distance(before.p0, before.p3) < 2 * length || distance(after.p0, after.p3) < 2 * length) continue;
      const meet = intersectLines(before.p3, into, after.p0, out);
      if (meet === null || distance(meet, before.p3) > 2 * fillet || distance(meet, after.p0) > 2 * fillet) continue;
      if (check !== null) {
        const cap: Point[] = [];
        for (let piece = 0; piece < run; piece += 1) {
          const cubic = cubics[(index + piece) % cubics.length];
          if (cubic !== undefined) for (let step = 0; step < 8; step += 1) cap.push(bezier(cubic, step / 8));
        }
        cap.push({ ...after.p0 }, { ...meet });
        if (!check(cap)) continue;
      }
      before.p2 = { x: before.p2.x + meet.x - before.p3.x, y: before.p2.y + meet.y - before.p3.y };
      before.p3 = { ...meet };
      after.p1 = { x: after.p1.x + meet.x - after.p0.x, y: after.p1.y + meet.y - after.p0.y };
      after.p0 = { ...meet };
      for (let removed = 0; removed < run; removed += 1) {
        const at = index % cubics.length;
        cubics.splice(at, 1);
        if (at < index) index -= 1;
      }
      replaced = true;
    }
    if (!replaced) index += 1;
  }
  if (curl > 0) for (let joint = 0; joint < cubics.length; joint += 1) sharpenJoint(cubics, joint, curl, turnLimit, check);
  return { cubics, closed: subpath.closed };
}

const STRAIGHT_TOLERANCE = 0.15;

/**
 * The other way VTracer rounds a hard corner: no tiny cubic, but both long cubics meeting there curl over their last
 * pixel or two. When each has a straight body that turns by at least `turnLimit` into the other, and the bodies'
 * lines meet within `fillet` of the joint, the curls are cut off and both bodies run straight to the meeting point.
 */
function sharpenJoint(cubics: Cubic[], joint: number, fillet: number, turnLimit: number, check: ((cap: readonly Point[]) => boolean) | null): void {
  const before = cubics[(joint - 1 + cubics.length) % cubics.length];
  const after = cubics[joint];
  if (before === undefined || after === undefined || before === after) return;
  const tail = straightBody(reverseCubic(before));
  const head = straightBody(after);
  if (tail === null || head === null) return;
  const corner = after.p0;
  const from = bezier(before, 1 - tail.t);
  const to = bezier(after, head.t);
  if (distance(from, corner) + distance(corner, to) < 0.05) return;
  const into = { x: -tail.direction.x, y: -tail.direction.y };
  if (angleBetween(into, head.direction) < turnLimit) return;
  // Each straight body must be long (a round cap of a thin bar is short cubics that look straight in their middle)
  // and longer than the curl it replaces; the meeting point's offset from the traced joint is the size of the
  // rounding, which must stay within `fillet`.
  const reach = 3 * fillet;
  if (tail.length < Math.max(reach, 2 * distance(from, corner)) || head.length < Math.max(reach, 2 * distance(corner, to))) return;
  const meet = intersectLines(from, into, to, head.direction);
  if (meet === null || distance(meet, corner) > fillet) return;
  if ((meet.x - from.x) * into.x + (meet.y - from.y) * into.y < -0.05) return;
  if ((to.x - meet.x) * head.direction.x + (to.y - meet.y) * head.direction.y < -0.05) return;
  if (check !== null) {
    const cap: Point[] = [];
    for (let step = 0; step <= 8; step += 1) cap.push(bezier(before, 1 - tail.t + (tail.t * step) / 8));
    for (let step = 1; step <= 8; step += 1) cap.push(bezier(after, (head.t * step) / 8));
    cap.push({ ...meet });
    if (!check(cap)) return;
  }
  const kept = splitCubic(before, 1 - tail.t)[0];
  const rest = splitCubic(after, head.t)[1];
  before.p0 = kept.p0;
  before.p1 = kept.p1;
  before.p2 = { x: kept.p2.x + meet.x - kept.p3.x, y: kept.p2.y + meet.y - kept.p3.y };
  before.p3 = { ...meet };
  after.p0 = { ...meet };
  after.p1 = { x: rest.p1.x + meet.x - rest.p0.x, y: rest.p1.y + meet.y - rest.p0.y };
  after.p2 = rest.p2;
  after.p3 = rest.p3;
}

/** The straight start of a cubic: how far (parameter t) it stays on the line through its early points, and that line. */
function straightBody(cubic: Cubic): { readonly t: number; readonly direction: Point; readonly length: number } | null {
  const end = bezier(cubic, 1);
  // The far end may curl into the next corner, so the body line is taken from the middle of the cubic.
  const anchor = bezier(cubic, 0.75);
  const aim = bezier(cubic, 0.45);
  const span = { x: aim.x - anchor.x, y: aim.y - anchor.y };
  const size = lengthOf(span);
  if (size < 0.5) return null;
  const unit = { x: span.x / size, y: span.y / size };
  const off = (point: Point) => Math.abs((point.x - anchor.x) * unit.y - (point.y - anchor.y) * unit.x);
  for (let step = 16; step >= 8; step -= 1) if (off(bezier(cubic, step / 20)) > STRAIGHT_TOLERANCE) return null;
  let t = 0.4;
  for (let step = 39; step >= 0; step -= 1) {
    const at = step / 100;
    if (off(bezier(cubic, at)) > STRAIGHT_TOLERANCE) break;
    t = at;
  }
  // Measured from the far end: the body runs from t = 1 back to `t`; the curl is 0..t. Return the curl length as t.
  return { t, direction: { x: -unit.x, y: -unit.y }, length: distance(bezier(cubic, t), end) };
}

function reverseCubic(cubic: Cubic): Cubic {
  return { p0: cubic.p3, p1: cubic.p2, p2: cubic.p1, p3: cubic.p0 };
}

function splitCubic(cubic: Cubic, t: number): [Cubic, Cubic] {
  const mix = (a: Point, b: Point) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const a = mix(cubic.p0, cubic.p1), b = mix(cubic.p1, cubic.p2), c = mix(cubic.p2, cubic.p3);
  const d = mix(a, b), e = mix(b, c), f = mix(d, e);
  return [{ p0: cubic.p0, p1: a, p2: d, p3: f }, { p0: f, p1: e, p2: c, p3: cubic.p3 }];
}

function angleBetween(left: Point, right: Point): number {
  const dot = left.x * right.x + left.y * right.y;
  const scale = lengthOf(left) * lengthOf(right);
  if (!(scale > 0)) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot / scale)));
}

function intersectLines(a: Point, da: Point, b: Point, db: Point): Point | null {
  const cross = da.x * db.y - da.y * db.x;
  if (Math.abs(cross) < 1e-9) return null;
  const t = ((b.x - a.x) * db.y - (b.y - a.y) * db.x) / cross;
  return { x: a.x + da.x * t, y: a.y + da.y * t };
}
