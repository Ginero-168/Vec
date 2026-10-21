import { boundaryHits, cleanTolerance, fitClosedClean, fitOpenClean, letterMask, strongCleanTolerance } from "./clean";
import { refineChain } from "./iso";
import { TRANSPARENT, rgbHex, type Rgb, type Segmentation } from "./model";
import { chooseUpscale, curveError, presetProfile, type PresetName } from "./presets";

export type TraceOptions = {
  /** Smooth slider, 0 (crisp) through 3 (very smooth). */
  readonly smooth?: number;
  readonly preset?: PresetName;
  readonly cornerAngle?: number;
  /** 0 chooses a scale from the preset and the image size. */
  readonly upscale?: number;
  readonly coverage?: Float32Array;
  readonly partner?: Uint16Array;
  /** Labels from the segmentation before manual edits. Edited pixels are drawn solid. */
  readonly originalLabels?: Uint16Array;
  /**
   * Clean-shapes strength, 0 off through 1. Off leaves the existing fitter untouched.
   * When on, each shared edge is fit to lines, arcs, and fair curves.
   */
  readonly cleanShapes?: number;
  /** Also clean thin high-contrast letters. Off keeps those edges on the existing fitter. */
  readonly cleanText?: boolean;
  /** Source pixels whose shared boundary the Smooth tool asked to clean. */
  readonly smoothMask?: Uint8Array;
  /** Original pixels. Shared edges then follow the 0.5 color contour instead of the label grid. */
  readonly source?: Uint8Array;
  readonly isCancelled?: () => boolean;
};

export type SnapAxis = "horizontal" | "vertical" | "diagonal";

export type VecCommand =
  | { readonly op: "L"; readonly x: number; readonly y: number; readonly primitive?: "line"; readonly snap?: SnapAxis }
  | {
      readonly op: "C";
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
      readonly primitive?: "arc" | "cubic";
    };

export type VecSubpath = {
  readonly start: Point;
  readonly commands: readonly VecCommand[];
};

export type VecShape = {
  readonly color: Rgb;
  readonly area: number;
  readonly subpaths: readonly VecSubpath[];
};

export type TraceResult = {
  readonly svg: string;
  readonly pathCount: number;
  readonly nodeCount: number;
  readonly subpathCount: number;
  readonly colorCount: number;
  readonly shapes: readonly VecShape[];
};

type Point = { x: number; y: number };

type FitCommand = VecCommand;

/**
 * Trace label regions into stacked fills. Shared boundaries are smoothed once
 * and reused in reverse, so neighboring paths meet without a hairline gap.
 * Coverage from the segmenter places that boundary between pixels.
 */
export function traceSegmentation(segmentation: Segmentation, options: TraceOptions = {}): TraceResult {
  const preset = options.preset ?? "logo";
  const profile = presetProfile(preset);
  const error = curveError(options.smooth ?? profile.smooth);
  const cornerAngle = options.cornerAngle ?? profile.cornerAngle;
  const hasSource = !!options.source && options.source.length >= segmentation.width * segmentation.height * 4;
  const scale = hasSource
    ? 1
    : options.upscale && options.upscale > 1
      ? Math.round(options.upscale)
      : options.upscale === 1
        ? 1
        : chooseUpscale(segmentation.width, segmentation.height, preset);
  const field = resolveField(segmentation, options);
  const scaled = scale <= 1 ? { labels: field.labels, width: segmentation.width, height: segmentation.height } : upscaleField(field, segmentation.width, segmentation.height, scale);
  const shapes: VecShape[] = [];
  const cache = new Map<string, FitCommand[]>();
  const clean = cleanSession(segmentation, options);
  const counts = countLabels(scaled.labels, segmentation.palette.length);
  const order = segmentation.palette.map((_, index) => index).filter((index) => (counts[index] ?? 0) > 0);
  order.sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0) || a - b);

  for (const label of order) {
    if (options.isCancelled?.()) break;
    const contours = traceLabel(scaled.labels, scaled.width, scaled.height, label);
    const iso =
      hasSource && options.source
        ? { rgba: options.source, palette: segmentation.palette, labels: field.labels, width: segmentation.width, height: segmentation.height, inside: label }
        : null;
    const subpaths: VecSubpath[] = [];
    for (const contour of contours) {
      const subpath = contourToSubpath(contour, scale, error, cornerAngle, Math.max(1.15, error * 0.85), cache, clean, iso);
      if (subpath && subpath.commands.length > 0) subpaths.push(subpath);
    }
    const color = segmentation.palette[label];
    if (!color || subpaths.length === 0) continue;
    shapes.push({ color, area: counts[label] ?? 0, subpaths });
  }

  let nodeCount = 0;
  let subpathCount = 0;
  for (const shape of shapes) {
    subpathCount += shape.subpaths.length;
    for (const subpath of shape.subpaths) nodeCount += subpath.commands.length;
  }
  return {
    svg: shapesToSvg(shapes, segmentation.width, segmentation.height),
    pathCount: shapes.length,
    nodeCount,
    subpathCount,
    colorCount: shapes.length,
    shapes
  };
}

export type SharedEdgeStats = {
  readonly edges: number;
  readonly median: number;
  readonly p90: number;
};

/** Open shared boundaries in source pixels. Each boundary is counted once. */
export function measureSharedEdges(segmentation: Segmentation, options: TraceOptions = {}): SharedEdgeStats {
  const preset = options.preset ?? "logo";
  const scale =
    options.upscale && options.upscale > 1 ? Math.round(options.upscale) : options.upscale === 1 ? 1 : chooseUpscale(segmentation.width, segmentation.height, preset);
  const field = resolveField(segmentation, options);
  const scaled = scale <= 1 ? { labels: field.labels, width: segmentation.width, height: segmentation.height } : upscaleField(field, segmentation.width, segmentation.height, scale);
  const counts = countLabels(scaled.labels, segmentation.palette.length);
  const order = segmentation.palette.map((_, index) => index).filter((index) => (counts[index] ?? 0) > 0);
  const seen = new Set<string>();
  const lengths: number[] = [];
  const clean = (options.cleanShapes ?? 0) > 0;
  for (const label of order) {
    const contours = traceLabel(scaled.labels, scaled.width, scaled.height, label);
    for (const contour of contours) {
      const outside = clean ? stabilizeOutside(contour.outside) : contour.outside;
      const chains = splitChains(contour.points, outside);
      for (const chain of chains) {
        if (chain.closed || chain.points.length < 2) continue;
        const start = chain.points[0];
        const end = chain.points[chain.points.length - 1];
        if (!start || !end) continue;
        const startKey = Math.round(start.x) + "," + Math.round(start.y);
        const endKey = Math.round(end.x) + "," + Math.round(end.y);
        const key = startKey < endKey ? startKey + ">" + endKey : endKey + ">" + startKey;
        if (seen.has(key)) continue;
        seen.add(key);
        lengths.push((chain.points.length - 1) / scale);
      }
    }
  }
  lengths.sort((left, right) => left - right);
  const mid = lengths[Math.floor(lengths.length / 2)] ?? 0;
  const p90 = lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * 0.9))] ?? 0;
  return { edges: lengths.length, median: mid, p90 };
}

/**
 * Curvature sign changes per 10px of smooth boundary. Sharp corners are skipped.
 * A scalloped edge flips once per pixel and scores well above 1; a font-like
 * outline of lines and fair curves stays under 0.5.
 */
export function boundaryWobble(shapes: readonly VecShape[]): number {
  let signChanges = 0;
  let smoothLength = 0;
  for (const shape of shapes) {
    for (const subpath of shape.subpaths) {
      const samples = sampleSubpath(subpath, 0.5);
      let previousSign = 0;
      for (let i = 1; i < samples.length - 1; i++) {
        const before = samples[i - 1];
        const point = samples[i];
        const after = samples[i + 1];
        if (!before || !point || !after) continue;
        const inX = point.x - before.x;
        const inY = point.y - before.y;
        const outX = after.x - point.x;
        const outY = after.y - point.y;
        const length = Math.hypot(outX, outY);
        if (length < 1e-4) continue;
        const turn = Math.atan2(inX * outY - inY * outX, inX * outX + inY * outY);
        if (Math.abs(turn) > 0.4) {
          previousSign = 0;
          continue;
        }
        smoothLength += length;
        if (Math.abs(turn) < 0.03) continue;
        const sign = turn > 0 ? 1 : -1;
        if (previousSign !== 0 && sign !== previousSign) signChanges++;
        previousSign = sign;
      }
    }
  }
  if (smoothLength < 1) return 0;
  return signChanges / (smoothLength / 10);
}

/** Fraction of output segments that are short axis-aligned grid steps. */
export function staircaseRatio(shapes: readonly VecShape[]): number {
  let total = 0;
  let stairs = 0;
  for (const shape of shapes) {
    for (const subpath of shape.subpaths) {
      let x = subpath.start.x;
      let y = subpath.start.y;
      for (const command of subpath.commands) {
        total++;
        if (command.op === "L") {
          const dx = command.x - x;
          const dy = command.y - y;
          const length = Math.hypot(dx, dy);
          const axis = Math.abs(dx) <= 0.05 || Math.abs(dy) <= 0.05;
          const onGrid = nearInteger(x) && nearInteger(y) && nearInteger(command.x) && nearInteger(command.y);
          if (axis && (length <= 1.35 || (onGrid && length <= 1.75))) stairs++;
        }
        x = command.x;
        y = command.y;
      }
    }
  }
  return total === 0 ? 0 : stairs / total;
}

/**
 * p95 distance, in source pixels, from the source 0.5 iso-contour to the
 * traced boundary. Hard label edges are not part of the sample.
 */
export function contourDeviationP95(segmentation: Segmentation, source: Uint8Array, shapes: readonly VecShape[]): number {
  const width = segmentation.width;
  const height = segmentation.height;
  const buckets = bucketSamples(sampleShapes(shapes));
  const distances: number[] = [];
  const counts = countLabels(segmentation.labels, segmentation.palette.length);
  for (let label = 0; label < segmentation.palette.length; label++) {
    if ((counts[label] ?? 0) === 0) continue;
    const contours = traceLabel(segmentation.labels, width, height, label);
    for (const contour of contours) {
      const chains = splitChains(contour.points, contour.outside);
      for (const chain of chains) {
        const refined = refineChain(chain.points, chain.closed, label, chain.outside, width, height, source, segmentation.palette, segmentation.labels, false);
        if (!refined.soft) continue;
        for (const point of refined.points) distances.push(nearestSample(buckets, point.x, point.y));
      }
    }
  }
  if (distances.length === 0) return 0;
  distances.sort((left, right) => left - right);
  return distances[Math.min(distances.length - 1, Math.floor(distances.length * 0.95))] ?? 0;
}

function nearInteger(value: number): boolean {
  return Math.abs(value - Math.round(value)) <= 0.02;
}

function sampleSubpath(subpath: VecSubpath, spacing: number): Point[] {
  const samples: Point[] = [{ x: subpath.start.x, y: subpath.start.y }];
  let x = subpath.start.x;
  let y = subpath.start.y;
  for (const command of subpath.commands) {
    if (command.op === "L") {
      const length = Math.hypot(command.x - x, command.y - y);
      const steps = Math.max(1, Math.ceil(length / spacing));
      for (let step = 1; step <= steps; step++) {
        const t = step / steps;
        samples.push({ x: x + (command.x - x) * t, y: y + (command.y - y) * t });
      }
    } else {
      const p0 = { x, y };
      const p1 = { x: command.x1, y: command.y1 };
      const p2 = { x: command.x2, y: command.y2 };
      const p3 = { x: command.x, y: command.y };
      const length = Math.hypot(p3.x - p0.x, p3.y - p0.y) + Math.hypot(p1.x - p0.x, p1.y - p0.y) + Math.hypot(p3.x - p2.x, p3.y - p2.y);
      const steps = Math.max(2, Math.ceil(length / spacing));
      for (let step = 1; step <= steps; step++) samples.push(cubicAt(p0, p1, p2, p3, step / steps));
    }
    x = command.x;
    y = command.y;
  }
  return samples;
}

function sampleShapes(shapes: readonly VecShape[]): Point[] {
  const samples: Point[] = [];
  for (const shape of shapes) {
    for (const subpath of shape.subpaths) samples.push(...sampleSubpath(subpath, 0.3));
  }
  return samples;
}

function bucketSamples(points: readonly Point[]): Map<string, Point[]> {
  const buckets = new Map<string, Point[]>();
  for (const point of points) {
    const key = Math.round(point.x * 2) + "," + Math.round(point.y * 2);
    const list = buckets.get(key);
    if (list) list.push(point);
    else buckets.set(key, [point]);
  }
  return buckets;
}

function nearestSample(buckets: Map<string, Point[]>, x: number, y: number): number {
  const cx = Math.round(x * 2);
  const cy = Math.round(y * 2);
  let best = 2;
  for (let oy = -3; oy <= 3; oy++) {
    for (let ox = -3; ox <= 3; ox++) {
      const list = buckets.get(cx + ox + "," + (cy + oy));
      if (!list) continue;
      for (const point of list) {
        const distance = Math.hypot(point.x - x, point.y - y);
        if (distance < best) best = distance;
      }
    }
  }
  return best;
}

type Field = {
  readonly labels: Uint16Array;
  readonly coverage: Float32Array;
  readonly partner: Uint16Array;
};

type Contour = {
  readonly points: Point[];
  readonly outside: number[];
};

function resolveField(segmentation: Segmentation, options: TraceOptions): Field {
  const count = segmentation.width * segmentation.height;
  const labels = segmentation.labels;
  const coverage = new Float32Array(count);
  coverage.fill(1);
  const partner = new Uint16Array(count);
  partner.fill(TRANSPARENT);
  const sourceCoverage = options.coverage ?? segmentation.coverage;
  const sourcePartner = options.partner ?? segmentation.partner;
  if (sourceCoverage && sourceCoverage.length === count) coverage.set(sourceCoverage);
  if (sourcePartner && sourcePartner.length === count) partner.set(sourcePartner);
  const original = options.originalLabels;
  if (original && original.length === count) {
    for (let i = 0; i < count; i++) {
      if ((labels[i] ?? TRANSPARENT) !== (original[i] ?? TRANSPARENT)) {
        coverage[i] = 1;
        partner[i] = TRANSPARENT;
      }
    }
  }
  const paletteLength = segmentation.palette.length;
  for (let i = 0; i < count; i++) {
    const other = partner[i] ?? TRANSPARENT;
    const label = labels[i] ?? TRANSPARENT;
    if (other === TRANSPARENT || other === label || other >= paletteLength) {
      partner[i] = TRANSPARENT;
      if (other === label) coverage[i] = 1;
    }
  }
  return { labels, coverage, partner };
}

function upscaleField(field: Field, width: number, height: number, scale: number): { labels: Uint16Array; width: number; height: number } {
  const scaledWidth = width * scale;
  const scaledHeight = height * scale;
  const labels = new Uint16Array(scaledWidth * scaledHeight);
  labels.fill(TRANSPARENT);
  const cells: { x: number; y: number; proj: number }[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const label = field.labels[index] ?? TRANSPARENT;
      if (label === TRANSPARENT) continue;
      const other = field.partner[index] ?? TRANSPARENT;
      const cover = field.coverage[index] ?? 1;
      const originX = x * scale;
      const originY = y * scale;
      if (other === TRANSPARENT || cover >= 0.999) {
        fillBlock(labels, scaledWidth, originX, originY, scale, label);
        continue;
      }
      let dx = 0;
      let dy = 0;
      if (x > 0 && field.labels[index - 1] === other) dx -= 1;
      if (x + 1 < width && field.labels[index + 1] === other) dx += 1;
      if (y > 0 && field.labels[index - width] === other) dy -= 1;
      if (y + 1 < height && field.labels[index + width] === other) dy += 1;
      if (dx === 0 && dy === 0) dx = 1;
      cells.length = 0;
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const px = sx - (scale - 1) / 2;
          const py = sy - (scale - 1) / 2;
          cells.push({ x: sx, y: sy, proj: px * dx + py * dy });
        }
      }
      cells.sort((a, b) => b.proj - a.proj || a.y - b.y || a.x - b.x);
      const partnerCount = Math.max(0, Math.min(scale * scale, Math.round((1 - cover) * scale * scale)));
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        if (!cell) continue;
        labels[(originY + cell.y) * scaledWidth + originX + cell.x] = i < partnerCount ? other : label;
      }
    }
  }
  return { labels, width: scaledWidth, height: scaledHeight };
}

function fillBlock(labels: Uint16Array, width: number, originX: number, originY: number, scale: number, label: number): void {
  for (let sy = 0; sy < scale; sy++) {
    const row = (originY + sy) * width + originX;
    labels.fill(label, row, row + scale);
  }
}

function traceLabel(labels: Uint16Array, width: number, height: number, label: number): Contour[] {
  const horizontal = new Uint8Array(width * (height + 1));
  const vertical = new Uint8Array((width + 1) * height);
  const contours: Contour[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((labels[y * width + x] ?? TRANSPARENT) !== label) continue;
      if (sample(labels, width, height, x, y - 1) === label) continue;
      if ((horizontal[y * width + x] ?? 0) & 1) continue;
      const contour = walk(labels, width, height, label, x, y, horizontal, vertical);
      if (contour && contour.points.length >= 3) contours.push(contour);
    }
  }
  return contours;
}

function walk(
  labels: Uint16Array,
  width: number,
  height: number,
  label: number,
  startX: number,
  startY: number,
  horizontal: Uint8Array,
  vertical: Uint8Array
): Contour | null {
  let x = startX;
  let y = startY;
  let dir = 0;
  const points: Point[] = [];
  const outside: number[] = [];
  const limit = (width + 1) * (height + 1) * 2;
  for (let step = 0; step < limit; step++) {
    if (step > 0 && x === startX && y === startY && dir === 0) break;
    if (!markEdge(x, y, dir, width, height, horizontal, vertical)) break;
    points.push({ x, y });
    const left = leftOf(x, y, dir);
    outside.push(sample(labels, width, height, left[0], left[1]));
    if (dir === 0) x += 1;
    else if (dir === 1) y += 1;
    else if (dir === 2) x -= 1;
    else y -= 1;
    const turn = [(dir + 1) & 3, dir, (dir + 3) & 3, (dir + 2) & 3];
    let next = -1;
    for (const candidate of turn) {
      const right = rightOf(x, y, candidate);
      const other = leftOf(x, y, candidate);
      if (sample(labels, width, height, right[0], right[1]) === label && sample(labels, width, height, other[0], other[1]) !== label) {
        next = candidate;
        break;
      }
    }
    if (next < 0) break;
    dir = next;
  }
  if (points.length !== outside.length || points.length < 3) return null;
  return { points, outside };
}

function sample(labels: Uint16Array, width: number, height: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= width || y >= height) return TRANSPARENT;
  return labels[y * width + x] ?? TRANSPARENT;
}

function rightOf(x: number, y: number, dir: number): [number, number] {
  if (dir === 0) return [x, y];
  if (dir === 1) return [x - 1, y];
  if (dir === 2) return [x - 1, y - 1];
  return [x, y - 1];
}

function leftOf(x: number, y: number, dir: number): [number, number] {
  if (dir === 0) return [x, y - 1];
  if (dir === 1) return [x, y];
  if (dir === 2) return [x - 1, y];
  return [x - 1, y - 1];
}

function markEdge(x: number, y: number, dir: number, width: number, height: number, horizontal: Uint8Array, vertical: Uint8Array): boolean {
  if (dir === 0 || dir === 2) {
    const edgeX = dir === 0 ? x : x - 1;
    if (edgeX < 0 || y < 0 || edgeX >= width || y > height) return false;
    const index = y * width + edgeX;
    const bit = dir === 0 ? 1 : 2;
    if ((horizontal[index] ?? 0) & bit) return false;
    horizontal[index] = (horizontal[index] ?? 0) | bit;
    return true;
  }
  const edgeY = dir === 1 ? y : y - 1;
  if (x < 0 || edgeY < 0 || x > width || edgeY >= height) return false;
  const index = edgeY * (width + 1) + x;
  const bit = dir === 1 ? 1 : 2;
  if ((vertical[index] ?? 0) & bit) return false;
  vertical[index] = (vertical[index] ?? 0) | bit;
  return true;
}

type Chain = { readonly points: Point[]; readonly closed: boolean; readonly outside: number };

type IsoContext = {
  readonly rgba: Uint8Array;
  readonly palette: readonly Rgb[];
  readonly labels: Uint16Array;
  readonly width: number;
  readonly height: number;
  readonly inside: number;
};

type CleanSession = {
  readonly tolerance: number;
  readonly strong: number;
  readonly letters: Uint8Array | null;
  readonly selected: Uint8Array | null;
  readonly width: number;
  readonly height: number;
  readonly cache: Map<string, { start: Point; commands: FitCommand[] }>;
};

function cleanSession(segmentation: Segmentation, options: TraceOptions): CleanSession | null {
  const strength = options.cleanShapes ?? 0;
  const selected = options.smoothMask && options.smoothMask.some((value) => value > 0) ? options.smoothMask : null;
  if (!(strength > 0) && !selected) return null;
  return {
    tolerance: strength > 0 ? cleanTolerance(strength) : 0,
    strong: strongCleanTolerance(strength),
    letters: strength > 0 && !options.cleanText ? letterMask(segmentation.labels, segmentation.width, segmentation.height, segmentation.palette) : null,
    selected,
    width: segmentation.width,
    height: segmentation.height,
    cache: new Map()
  };
}

function cleanChainTolerance(points: readonly Point[], session: CleanSession | null): number | null {
  if (!session) return null;
  if (session.selected && boundaryHits(session.selected, session.width, session.height, points, 0.08)) return session.strong;
  if (!(session.tolerance > 0)) return null;
  if (session.letters && boundaryHits(session.letters, session.width, session.height, points, 0.35)) return null;
  return session.tolerance;
}

function contourToSubpath(
  contour: Contour,
  scale: number,
  error: number,
  cornerAngle: number,
  simplify: number,
  cache: Map<string, FitCommand[]>,
  clean: CleanSession | null,
  iso: IsoContext | null
): VecSubpath | null {
  const points = contour.points.map((point) => ({ x: point.x / scale, y: point.y / scale }));
  const chains = splitChains(points, clean ? stabilizeOutside(contour.outside) : contour.outside).map((chain) => prepareChain(chain, iso));
  if (chains.length === 0) return null;
  const only = chains[0];
  if (chains.length === 1 && only?.closed) {
    const canonical = canonicalizeClosed(only.points);
    if (canonical.length < 3) return null;
    const tolerance = cappedTolerance(cleanChainTolerance(canonical, clean), only.soft);
    const fitError = fairnessError(error, canonical, clean, only.soft);
    const commands = cachedClosed(canonical, fitError, cornerAngle, simplify, cache, only.soft);
    const start = canonical[0];
    if (tolerance !== null && clean) {
      const fitted = cachedCleanClosed(canonical, tolerance, clean);
      if (fitted && fitted.commands.length > 0 && (only.soft || fitted.commands.length <= commands.length)) return fitted;
    }
    if (!start || commands.length === 0) return null;
    return { start, commands };
  }
  const start = chains[0]?.points[0];
  if (!start) return null;
  const commands: FitCommand[] = [];
  for (const chain of chains) {
    if (chain.closed || chain.points.length < 2) continue;
    const tolerance = cappedTolerance(cleanChainTolerance(chain.points, clean), chain.soft);
    const fitError = fairnessError(error, chain.points, clean, chain.soft);
    const plain = cachedOpen(chain.points, fitError, cornerAngle, simplify, cache, chain.soft);
    if (tolerance === null || !clean) commands.push(...plain);
    else {
      const fitted = cachedCleanOpen(chain.points, tolerance, clean);
      commands.push(...(fitted.length > 0 && (chain.soft || fitted.length <= plain.length) ? fitted : plain));
    }
  }
  if (commands.length === 0) return null;
  return { start, commands };
}

function prepareChain(chain: Chain, iso: IsoContext | null): Chain & { soft: boolean } {
  if (!iso) return { ...chain, soft: false };
  const refined = refineChain(chain.points, chain.closed, iso.inside, chain.outside, iso.width, iso.height, iso.rgba, iso.palette, iso.labels);
  return { points: refined.points, closed: chain.closed, outside: chain.outside, soft: refined.soft };
}

function cappedTolerance(tolerance: number | null, soft: boolean): number | null {
  if (tolerance === null || !soft) return tolerance;
  const t = Math.min(1, Math.max(0, (tolerance - 1.15) / 2.15));
  return 0.45 + t;
}

/** Letters skip arc snapping. Clean shapes still loosens the line/cubic tolerance so stems go straight. */
function fairnessError(base: number, points: readonly Point[], clean: CleanSession | null, soft: boolean): number {
  const tolerance = soft ? Math.min(1.5, base * 1.2) : base;
  if (!soft || !clean || !(clean.tolerance > 0) || !clean.letters) return tolerance;
  if (!boundaryHits(clean.letters, clean.width, clean.height, points, 0.35)) return tolerance;
  const t = Math.min(1, Math.max(0, (clean.tolerance - 1.15) / 2.15));
  return Math.max(tolerance, 0.5 + t * 0.55);
}

function cachedCleanOpen(points: readonly Point[], tolerance: number, session: CleanSession): FitCommand[] {
  const canonical = canonicalizeOpen(points);
  const key = "k|" + tolerance.toFixed(3) + "|" + pointKey(canonical.points);
  let fitted = session.cache.get(key);
  if (!fitted) {
    const origin = canonical.points[0];
    if (!origin) return [];
    fitted = { start: origin, commands: fitOpenClean(canonical.points, tolerance) };
    session.cache.set(key, fitted);
  }
  if (fitted.commands.length === 0) return [];
  return canonical.reversed ? reverseCommands(fitted.commands, fitted.start) : fitted.commands;
}

function cachedCleanClosed(points: Point[], tolerance: number, session: CleanSession): { start: Point; commands: FitCommand[] } | null {
  const key = "kc|" + tolerance.toFixed(3) + "|" + pointKey(points);
  let fitted = session.cache.get(key);
  if (!fitted) {
    const cleanFit = fitClosedClean(points, tolerance);
    if (!cleanFit) return null;
    fitted = { start: cleanFit.start, commands: [...cleanFit.commands] };
    session.cache.set(key, fitted);
  }
  return fitted;
}

function stabilizeOutside(outside: readonly number[]): number[] {
  const count = outside.length;
  if (count < 6) return outside.slice();
  const copy = outside.slice();
  const runs: { start: number; length: number; label: number }[] = [];
  let cursor = 0;
  while (cursor < count) {
    const label = copy[cursor] ?? TRANSPARENT;
    let length = 1;
    while (cursor + length < count && (copy[cursor + length] ?? TRANSPARENT) === label) length++;
    runs.push({ start: cursor, length, label });
    cursor += length;
  }
  if (runs.length >= 2) {
    const first = runs[0];
    const last = runs[runs.length - 1];
    if (first && last && first.label === last.label) {
      last.length += first.length;
      runs.shift();
    }
  }
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (!run || run.length > 3) continue;
    const previous = runs[(i - 1 + runs.length) % runs.length];
    const next = runs[(i + 1) % runs.length];
    if (!previous || !next || previous === next || previous.label !== next.label) continue;
    for (let step = 0; step < run.length; step++) copy[(run.start + step) % count] = previous.label;
  }
  return copy;
}

function splitChains(points: readonly Point[], outside: readonly number[]): Chain[] {
  const count = points.length;
  if (count < 3 || outside.length !== count) return [];
  let junction = -1;
  for (let i = 0; i < count; i++) {
    if ((outside[i] ?? TRANSPARENT) !== (outside[(i + count - 1) % count] ?? TRANSPARENT)) {
      junction = i;
      break;
    }
  }
  if (junction < 0) return [{ points: points.slice(), closed: true, outside: outside[0] ?? TRANSPARENT }];
  const chains: Chain[] = [];
  let cursor = junction;
  let walked = 0;
  while (walked < count) {
    const outsideLabel = outside[cursor] ?? TRANSPARENT;
    const chain: Point[] = [points[cursor]!];
    while (walked < count) {
      const next = (cursor + 1) % count;
      chain.push(points[next]!);
      walked++;
      cursor = next;
      if (walked >= count || (outside[cursor] ?? TRANSPARENT) !== outsideLabel) break;
    }
    chains.push({ points: chain, closed: false, outside: outsideLabel });
  }
  return chains;
}

function cachedOpen(points: readonly Point[], error: number, cornerAngle: number, simplify: number, cache: Map<string, FitCommand[]>, subpixel: boolean): FitCommand[] {
  const canonical = canonicalizeOpen(points);
  const key = (subpixel ? "s|" : "o|") + error.toFixed(4) + "|" + simplify.toFixed(4) + "|" + cornerAngle.toFixed(3) + "|" + pointKey(canonical.points);
  let fitted = cache.get(key);
  if (!fitted) {
    fitted = subpixel ? fitSubpixelOpen(canonical.points, cornerAngle, error) : fitOpenChain(canonical.points, error, cornerAngle, simplify);
    cache.set(key, fitted);
  }
  const origin = canonical.points[0];
  if (!origin) return [];
  return canonical.reversed ? reverseCommands(fitted, origin) : fitted;
}

function cachedClosed(points: Point[], error: number, cornerAngle: number, simplify: number, cache: Map<string, FitCommand[]>, subpixel: boolean): FitCommand[] {
  const key = (subpixel ? "sc|" : "c|") + error.toFixed(4) + "|" + simplify.toFixed(4) + "|" + cornerAngle.toFixed(3) + "|" + pointKey(points);
  let fitted = cache.get(key);
  if (!fitted) {
    fitted = subpixel ? fitSubpixelClosed(points, cornerAngle, error) : fitClosedChain(points, error, cornerAngle, simplify);
    cache.set(key, fitted);
  }
  return fitted;
}

function canonicalizeOpen(points: readonly Point[]): { points: Point[]; reversed: boolean } {
  const forward = points.slice();
  const backward = points.slice().reverse();
  if (comparePoints(forward, backward) <= 0) return { points: forward, reversed: false };
  return { points: backward, reversed: true };
}

function canonicalizeClosed(points: readonly Point[]): Point[] {
  if (points.length === 0) return [];
  let start = 0;
  for (let i = 1; i < points.length; i++) {
    if (comparePoint(points[i]!, points[start]!) < 0) start = i;
  }
  const forward = rotate(points, start);
  const reversed = points.slice().reverse();
  let reverseStart = 0;
  for (let i = 0; i < reversed.length; i++) {
    const point = reversed[i];
    const origin = points[start];
    if (point && origin && point.x === origin.x && point.y === origin.y) {
      reverseStart = i;
      break;
    }
  }
  const backward = rotate(reversed, reverseStart);
  return comparePoints(forward, backward) <= 0 ? forward : backward;
}

function rotate(points: readonly Point[], start: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) out.push(points[(start + i) % points.length]!);
  return out;
}

function comparePoint(a: Point, b: Point): number {
  if (a.x !== b.x) return a.x - b.x;
  return a.y - b.y;
}

function comparePoints(a: readonly Point[], b: readonly Point[]): number {
  const count = Math.min(a.length, b.length);
  for (let i = 0; i < count; i++) {
    const delta = comparePoint(a[i]!, b[i]!);
    if (delta !== 0) return delta;
  }
  return a.length - b.length;
}

function pointKey(points: readonly Point[]): string {
  let key = "";
  for (const point of points) key += point.x.toFixed(4) + "," + point.y.toFixed(4) + ";";
  return key;
}

function fitSubpixelOpen(points: Point[], cornerAngle: number, tolerance: number): FitCommand[] {
  const cuts = denseCorners(points, false, cornerAngle);
  const commands: FitCommand[] = [];
  for (let i = 0; i < cuts.length - 1; i++) fitFairSpan(points, cuts[i]!, cuts[i + 1]!, tolerance, null, null, commands);
  return commands;
}

function fitSubpixelClosed(points: Point[], cornerAngle: number, tolerance: number): FitCommand[] {
  const commands: FitCommand[] = [];
  const corners = denseCorners(points, true, cornerAngle);
  if (corners.length === 0) {
    const span = sliceCyclic(points, 0, 0);
    const tangent = loopTangent(points, 0);
    fitFairSpan(span, 0, span.length - 1, tolerance, tangent, tangent ? { x: -tangent.x, y: -tangent.y } : null, commands);
    return commands;
  }
  const cuts = corners.includes(0) ? corners : [0, ...corners];
  const bridge = !corners.includes(0);
  for (let i = 0; i < cuts.length; i++) {
    const fromCut = cuts[i]!;
    const toCut = cuts[(i + 1) % cuts.length]!;
    const span = sliceCyclic(points, fromCut, toCut);
    const startTangent = bridge && fromCut === 0 ? loopTangent(points, 0) : null;
    const endForward = bridge && toCut === 0 ? loopTangent(points, 0) : null;
    fitFairSpan(span, 0, span.length - 1, tolerance, startTangent, endForward ? { x: -endForward.x, y: -endForward.y } : null, commands);
  }
  return commands;
}

function sharpCorner(previous: Point, current: Point, next: Point, alpha: number): boolean {
  const turn = Math.abs(turnAngle(previous, current, next));
  if (turn < alpha) return false;
  const incoming = Math.hypot(current.x - previous.x, current.y - previous.y);
  const outgoing = Math.hypot(next.x - current.x, next.y - current.y);
  return incoming >= 2 && outgoing >= 2;
}

/** Corners on the denoised polyline, measured across a few pixels so a 1px ripple is not a corner. */
function denseCorners(points: readonly Point[], closed: boolean, cornerAngle: number): number[] {
  const alpha = Math.max(cornerAngle, 1);
  const count = points.length;
  const near = 3;
  const far = 6;
  const found: { index: number; turn: number }[] = [];
  const first = closed ? 0 : near;
  const last = closed ? count : Math.max(near, count - near);
  for (let i = first; i < last; i++) {
    const previous = points[(i - near + count) % count];
    const current = points[i];
    const next = points[(i + near) % count];
    if (!previous || !current || !next) continue;
    if (!closed && (i < far || i + far >= count)) {
      if (!sharpCorner(previous, current, next, alpha)) continue;
    } else {
      const before = points[(i - far + count) % count];
      const after = points[(i + far) % count];
      if (!before || !after) continue;
      if (Math.abs(turnAngle(before, current, after)) < 0.65) continue;
      if (!sharpCorner(previous, current, next, alpha)) continue;
    }
    found.push({ index: i, turn: Math.abs(turnAngle(previous, current, next)) });
  }
  const kept: { index: number; turn: number }[] = [];
  for (const corner of found) {
    const previous = kept[kept.length - 1];
    if (previous && corner.index - previous.index < 4) {
      if (corner.turn > previous.turn) kept[kept.length - 1] = corner;
      continue;
    }
    kept.push(corner);
  }
  if (closed && kept.length >= 2) {
    const firstCorner = kept[0];
    const lastCorner = kept[kept.length - 1];
    if (firstCorner && lastCorner && firstCorner.index + count - lastCorner.index < 4) {
      if (lastCorner.turn > firstCorner.turn) kept.shift();
      else kept.pop();
    }
  }
  if (!closed) return [0, ...kept.map((corner) => corner.index), count - 1];
  return kept.map((corner) => corner.index);
}

function fitFairSpan(
  points: readonly Point[],
  start: number,
  end: number,
  tolerance: number,
  tStart: Point | null,
  tEnd: Point | null,
  out: FitCommand[]
): void {
  let cursor = start;
  let incoming = tStart;
  while (cursor < end) {
    const lineTo = farthestLine(points, cursor, end, tolerance);
    const cubic = lineTo < end ? farthestCubic(points, cursor, end, tolerance, incoming, tEnd) : null;
    if (cubic && cubic.index > lineTo) {
      let command = cubic.command;
      if (cubic.index < end) {
        const travel = forwardTangent(points, cubic.index);
        if (travel) {
          const joined = fairCubic(points, cursor, cubic.index, tolerance, incoming, { x: -travel.x, y: -travel.y });
          if (joined) command = joined;
        }
      }
      out.push(command);
      incoming = cubic.index < end ? forwardTangent(points, cubic.index) : null;
      cursor = cubic.index;
      continue;
    }
    const to = points[lineTo];
    if (!to || lineTo <= cursor) {
      const step = points[cursor + 1];
      if (!step) return;
      out.push({ op: "L", x: step.x, y: step.y });
      incoming = null;
      cursor += 1;
      continue;
    }
    out.push({ op: "L", x: to.x, y: to.y });
    incoming = lineTo < end ? forwardTangent(points, lineTo) : null;
    cursor = lineTo;
  }
}

function farthestLine(points: readonly Point[], start: number, end: number, tolerance: number): number {
  if (end <= start) return start;
  if (end === start + 1 || maxChordError(points, start, end) <= tolerance) return end;
  const step = Math.max(1, Math.floor((end - start) / 20));
  let best = start + 1;
  for (let j = start + 1 + step; j <= end; j += step) {
    if (maxChordError(points, start, j) <= tolerance) best = j;
  }
  const limit = Math.min(end, best + step);
  for (let j = best + 1; j <= limit; j++) {
    if (maxChordError(points, start, j) <= tolerance) best = j;
  }
  return best;
}

function farthestCubic(
  points: readonly Point[],
  start: number,
  end: number,
  tolerance: number,
  tStart: Point | null,
  tEnd: Point | null
): { index: number; command: FitCommand } | null {
  if (end < start + 2) return null;
  const step = Math.max(1, Math.floor((end - start) / 16));
  let bestIndex = -1;
  let bestCommand: FitCommand | null = null;
  for (let j = end; j >= start + 2; j -= step) {
    const command = fairCubic(points, start, j, tolerance, tStart, j === end ? tEnd : null);
    if (!command) continue;
    bestIndex = j;
    bestCommand = command;
    break;
  }
  if (!bestCommand || bestIndex < 0) return null;
  const limit = Math.min(end, bestIndex + step - 1);
  for (let j = bestIndex + 1; j <= limit; j++) {
    const command = fairCubic(points, start, j, tolerance, tStart, j === end ? tEnd : null);
    if (!command) continue;
    bestIndex = j;
    bestCommand = command;
  }
  return { index: bestIndex, command: bestCommand };
}

function fairCubic(
  points: readonly Point[],
  start: number,
  end: number,
  tolerance: number,
  tStart: Point | null,
  tEnd: Point | null
): FitCommand | null {
  if (end <= start + 1) return null;
  let cubic = fitCubic(points, start, end, tStart, tEnd);
  if ((!cubic || cubic.error > tolerance) && (tStart || tEnd)) {
    const free = fitCubic(points, start, end, null, null);
    if (free && (!cubic || free.error < cubic.error)) cubic = free;
  }
  if (!cubic || cubic.error > tolerance || cubic.command.op !== "C") return null;
  const origin = points[start];
  if (!origin || cubicOscillates(origin, cubic.command)) return null;
  return {
    op: "C",
    x1: cubic.command.x1,
    y1: cubic.command.y1,
    x2: cubic.command.x2,
    y2: cubic.command.y2,
    x: cubic.command.x,
    y: cubic.command.y,
    primitive: "cubic"
  };
}

function cubicOscillates(origin: Point, command: { x1: number; y1: number; x2: number; y2: number; x: number; y: number }): boolean {
  const p1x = command.x1 - origin.x;
  const p1y = command.y1 - origin.y;
  const e1x = command.x2 - command.x1;
  const e1y = command.y2 - command.y1;
  const e2x = command.x - command.x2;
  const e2y = command.y - command.y2;
  const first = p1x * e1y - p1y * e1x;
  const second = e1x * e2y - e1y * e2x;
  if (first * second < -1e-4) return true;
  const p1 = { x: command.x1, y: command.y1 };
  const p2 = { x: command.x2, y: command.y2 };
  const p3 = { x: command.x, y: command.y };
  let sign = 0;
  for (const t of [0.2, 0.4, 0.6, 0.8]) {
    const curvature = signedCurvature(origin, p1, p2, p3, t);
    if (Math.abs(curvature) < 0.02) continue;
    const next = curvature > 0 ? 1 : -1;
    if (sign !== 0 && next !== sign) return true;
    sign = next;
  }
  return false;
}

function signedCurvature(p0: Point, p1: Point, p2: Point, p3: Point, t: number): number {
  const u = 1 - t;
  const dx = 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x);
  const dy = 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y);
  const ddx = 6 * u * (p2.x - 2 * p1.x + p0.x) + 6 * t * (p3.x - 2 * p2.x + p1.x);
  const ddy = 6 * u * (p2.y - 2 * p1.y + p0.y) + 6 * t * (p3.y - 2 * p2.y + p1.y);
  const speed = Math.hypot(dx, dy);
  if (speed < 1e-6) return 0;
  return (dx * ddy - dy * ddx) / (speed * speed * speed);
}

function fitOpenChain(points: Point[], error: number, cornerAngle: number, simplify: number): FitCommand[] {
  const simplified = douglasPeucker(points, simplify);
  if (simplified.length < 2) return [];
  const corners = [0];
  for (let i = 1; i < simplified.length - 1; i++) {
    if (keptCorner(simplified[i - 1]!, simplified[i]!, simplified[i + 1]!, cornerAngle)) corners.push(i);
  }
  corners.push(simplified.length - 1);
  const commands: FitCommand[] = [];
  for (let i = 0; i < corners.length - 1; i++) fitRange(simplified, corners[i]!, corners[i + 1]!, error, commands);
  return commands;
}

function fitClosedChain(points: Point[], error: number, cornerAngle: number, simplify: number): FitCommand[] {
  const simplified = simplifyClosed(points, simplify);
  if (simplified.length < 3) return [];
  const corners: number[] = [];
  for (let i = 0; i < simplified.length; i++) {
    const previous = simplified[(i + simplified.length - 1) % simplified.length]!;
    const next = simplified[(i + 1) % simplified.length]!;
    if (keptCorner(previous, simplified[i]!, next, cornerAngle)) corners.push(i);
  }
  const commands: FitCommand[] = [];
  if (corners.length === 0) {
    const step = Math.max(1, Math.floor(simplified.length / 4));
    const anchors: number[] = [];
    for (let i = 0; i < simplified.length; i += step) anchors.push(i);
    if (anchors.length < 3) return fitOpenChain(simplified.concat(simplified[0]!), error, Math.PI, simplify);
    for (let i = 0; i < anchors.length; i++) {
      const span = sliceCyclic(simplified, anchors[i]!, anchors[(i + 1) % anchors.length]!);
      fitRange(span, 0, span.length - 1, error, commands);
    }
    return commands;
  }
  for (let i = 0; i < corners.length; i++) {
    const span = sliceCyclic(simplified, corners[i]!, corners[(i + 1) % corners.length]!);
    fitRange(span, 0, span.length - 1, error, commands);
  }
  return commands;
}

function simplifyClosed(points: readonly Point[], epsilon: number): Point[] {
  let first = 0;
  for (let i = 1; i < points.length; i++) {
    if (comparePoint(points[i]!, points[first]!) < 0) first = i;
  }
  let second = 0;
  let best = -1;
  for (let i = 0; i < points.length; i++) {
    if (i === first) continue;
    const distance = distance2(points[i]!, points[first]!);
    if (distance > best) {
      best = distance;
      second = i;
    }
  }
  const a = douglasPeucker(sliceCyclic(points, first, second), epsilon);
  const b = douglasPeucker(sliceCyclic(points, second, first), epsilon);
  if (a.length === 0) return b;
  return a.concat(b.slice(1, -1));
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

function douglasPeucker(points: readonly Point[], epsilon: number): Point[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [0, points.length - 1];
  while (stack.length > 0) {
    const end = stack.pop();
    const start = stack.pop();
    if (start === undefined || end === undefined) break;
    let bestIndex = -1;
    let bestDistance = epsilon;
    let bestKey = Infinity;
    for (let i = start + 1; i < end; i++) {
      const point = points[i];
      const from = points[start];
      const to = points[end];
      if (!point || !from || !to) continue;
      const distance = pointSegmentDistance(point, from, to);
      const key = point.x * 1_000_000 + point.y;
      if (distance > bestDistance + 1e-8 || (Math.abs(distance - bestDistance) <= 1e-8 && key < bestKey)) {
        bestDistance = distance;
        bestIndex = i;
        bestKey = key;
      }
    }
    if (bestIndex >= 0) {
      keep[bestIndex] = 1;
      stack.push(start, bestIndex, bestIndex, end);
    }
  }
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]!);
  return out;
}

function fitRange(points: readonly Point[], start: number, end: number, error: number, out: FitCommand[]): void {
  const from = points[start];
  const to = points[end];
  if (!from || !to || end <= start) return;
  if (end === start + 1 || maxChordError(points, start, end) <= error) {
    out.push({ op: "L", x: to.x, y: to.y });
    return;
  }
  const cubic = fitCubic(points, start, end);
  if (cubic && cubic.error <= error) {
    out.push(cubic.command);
    return;
  }
  let split = start + Math.floor((end - start) / 2);
  let best = -1;
  for (let i = start + 1; i < end; i++) {
    const point = points[i];
    if (!point) continue;
    const distance = pointSegmentDistance(point, from, to);
    if (distance > best) {
      best = distance;
      split = i;
    }
  }
  if (split <= start || split >= end) {
    out.push({ op: "L", x: to.x, y: to.y });
    return;
  }
  fitRange(points, start, split, error, out);
  fitRange(points, split, end, error, out);
}

function fitCubic(points: readonly Point[], start: number, end: number, tStart: Point | null = null, tEnd: Point | null = null): { command: FitCommand; error: number } | null {
  const p0 = points[start];
  const p3 = points[end];
  if (!p0 || !p3) return null;
  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  if (chord < 1e-6) return null;
  const t1 = unitOr(tStart, tangent(points, start, end, false));
  const t2 = unitOr(tEnd, tangent(points, start, end, true));
  if (!t1 || !t2) return null;
  let length = 0;
  const parameter: number[] = [0];
  for (let i = start + 1; i <= end; i++) {
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
  for (let i = start; i <= end; i++) {
    const point = points[i];
    if (!point) return null;
    const t = (parameter[i - start] ?? 0) / length;
    const u = 1 - t;
    const b1 = 3 * u * u * t;
    const b2 = 3 * u * t * t;
    const basisX = p0.x * u * u * (1 + 2 * t) + p3.x * t * t * (3 - 2 * t);
    const basisY = p0.y * u * u * (1 + 2 * t) + p3.y * t * t * (3 - 2 * t);
    const vx = point.x - basisX;
    const vy = point.y - basisY;
    c11 += b1 * b1;
    c22 += b2 * b2;
    c12 += b1 * b2 * tangentDot;
    x1 += b1 * (vx * t1.x + vy * t1.y);
    x2 += b2 * (vx * t2.x + vy * t2.y);
  }
  const determinant = c11 * c22 - c12 * c12;
  if (Math.abs(determinant) < 1e-10) return null;
  const alpha1 = (c22 * x1 - c12 * x2) / determinant;
  const alpha2 = (c11 * x2 - c12 * x1) / determinant;
  if (!(alpha1 > 0) || !(alpha2 > 0) || alpha1 > chord * 4 || alpha2 > chord * 4) return null;
  const command: FitCommand = {
    op: "C",
    x1: p0.x + t1.x * alpha1,
    y1: p0.y + t1.y * alpha1,
    x2: p3.x + t2.x * alpha2,
    y2: p3.y + t2.y * alpha2,
    x: p3.x,
    y: p3.y
  };
  let maxError = 0;
  for (let i = start; i <= end; i++) {
    const point = points[i];
    if (!point) continue;
    const t = (parameter[i - start] ?? 0) / length;
    const at = cubicAt(p0, { x: command.x1, y: command.y1 }, { x: command.x2, y: command.y2 }, p3, t);
    maxError = Math.max(maxError, Math.hypot(at.x - point.x, at.y - point.y));
  }
  return { command, error: maxError };
}

function unitOr(imposed: Point | null, fallback: Point | null): Point | null {
  const source = imposed ?? fallback;
  if (!source) return null;
  const length = Math.hypot(source.x, source.y);
  if (length < 1e-8) return fallback;
  return { x: source.x / length, y: source.y / length };
}

function loopTangent(points: readonly Point[], index: number): Point | null {
  const count = points.length;
  const origin = points[index];
  if (!origin || count < 2) return null;
  let x = 0;
  let y = 0;
  for (let step = 1; step <= 4; step++) {
    const next = points[(index + step) % count];
    const previous = points[(index - step + count * 4) % count];
    const weight = 1 / step;
    if (next) {
      x += (next.x - origin.x) * weight;
      y += (next.y - origin.y) * weight;
    }
    if (previous) {
      x += (origin.x - previous.x) * weight;
      y += (origin.y - previous.y) * weight;
    }
  }
  const length = Math.hypot(x, y);
  if (length < 1e-8) return null;
  return { x: x / length, y: y / length };
}

function forwardTangent(points: readonly Point[], index: number): Point | null {
  const origin = points[index];
  if (!origin) return null;
  let x = 0;
  let y = 0;
  for (let step = 1; step <= 4; step++) {
    const next = points[index + step];
    const previous = points[index - step];
    const weight = 1 / step;
    if (next) {
      x += (next.x - origin.x) * weight;
      y += (next.y - origin.y) * weight;
    }
    if (previous) {
      x += (origin.x - previous.x) * weight;
      y += (origin.y - previous.y) * weight;
    }
  }
  const length = Math.hypot(x, y);
  if (length < 1e-8) return null;
  return { x: x / length, y: y / length };
}

function tangent(points: readonly Point[], start: number, end: number, atEnd: boolean): Point | null {
  const origin = points[atEnd ? end : start];
  if (!origin) return null;
  const reach = Math.min(4, end - start);
  let x = 0;
  let y = 0;
  for (let step = 1; step <= reach; step++) {
    const point = points[atEnd ? end - step : start + step];
    if (!point) continue;
    const weight = 1 / step;
    x += (point.x - origin.x) * weight;
    y += (point.y - origin.y) * weight;
  }
  const length = Math.hypot(x, y);
  if (length < 1e-8) return null;
  return { x: x / length, y: y / length };
}

function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y
  };
}

function maxChordError(points: readonly Point[], start: number, end: number): number {
  const from = points[start];
  const to = points[end];
  if (!from || !to) return 0;
  let max = 0;
  for (let i = start + 1; i < end; i++) {
    const point = points[i];
    if (!point) continue;
    max = Math.max(max, pointSegmentDistance(point, from, to));
  }
  return max;
}

function pointSegmentDistance(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-8) return Math.hypot(point.x - from.x, point.y - from.y);
  return Math.abs((point.x - from.x) * dy - (point.y - from.y) * dx) / length;
}

function keptCorner(previous: Point, current: Point, next: Point, cornerAngle: number): boolean {
  const turn = Math.abs(turnAngle(previous, current, next));
  if (turn < cornerAngle) return false;
  const incoming = Math.hypot(current.x - previous.x, current.y - previous.y);
  const outgoing = Math.hypot(next.x - current.x, next.y - current.y);
  if (incoming < 1.35 && outgoing < 1.35) return false;
  if (Math.min(incoming, outgoing) < 0.8 && turn < 1.15) return false;
  return true;
}

function turnAngle(a: Point, b: Point, c: Point): number {
  const incoming = Math.atan2(b.y - a.y, b.x - a.x);
  const outgoing = Math.atan2(c.y - b.y, c.x - b.x);
  let delta = outgoing - incoming;
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function distance2(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function reverseCommands(commands: readonly FitCommand[], start: Point): FitCommand[] {
  let x = start.x;
  let y = start.y;
  const segments: { fromX: number; fromY: number; command: FitCommand }[] = [];
  for (const command of commands) {
    segments.push({ fromX: x, fromY: y, command });
    x = command.x;
    y = command.y;
  }
  const reversed: FitCommand[] = [];
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (!segment) continue;
    if (segment.command.op === "L") {
      reversed.push({ op: "L", x: segment.fromX, y: segment.fromY, primitive: segment.command.primitive, snap: segment.command.snap });
    } else {
      reversed.push({
        op: "C",
        x1: segment.command.x2,
        y1: segment.command.y2,
        x2: segment.command.x1,
        y2: segment.command.y1,
        x: segment.fromX,
        y: segment.fromY,
        primitive: segment.command.primitive
      });
    }
  }
  return reversed;
}

function countLabels(labels: Uint16Array, paletteLength: number): Int32Array {
  const counts = new Int32Array(paletteLength);
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i] ?? TRANSPARENT;
    if (label !== TRANSPARENT && label < paletteLength) counts[label] = (counts[label] ?? 0) + 1;
  }
  return counts;
}

function shapesToSvg(shapes: readonly VecShape[], width: number, height: number): string {
  const body = shapes
    .map((shape) => {
      const data = shape.subpaths
        .map((subpath) => {
          let path = "M" + formatNumber(subpath.start.x) + " " + formatNumber(subpath.start.y);
          for (const command of subpath.commands) {
            if (command.op === "L") path += "L" + formatNumber(command.x) + " " + formatNumber(command.y);
            else {
              path +=
                "C" +
                formatNumber(command.x1) +
                " " +
                formatNumber(command.y1) +
                " " +
                formatNumber(command.x2) +
                " " +
                formatNumber(command.y2) +
                " " +
                formatNumber(command.x) +
                " " +
                formatNumber(command.y);
            }
          }
          return path + "Z";
        })
        .join("");
      return '<path fill="' + rgbHex(shape.color) + '" stroke="' + rgbHex(shape.color) + '" stroke-width="0.4" stroke-linejoin="round" fill-rule="evenodd" d="' + data + '"/>';
    })
    .join("");
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + " " + height + '" width="' + width + '" height="' + height + '">' + body + "</svg>";
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Object.is(rounded, -0) || rounded === 0) return "0";
  return String(rounded);
}
