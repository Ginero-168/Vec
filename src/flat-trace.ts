import { labDistance2, oklabToRgb, rgbToOklab, type Lab, type RGB } from "./color.ts";

export type FlatPlate = {
  readonly rgba: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly palette: readonly string[];
  readonly originX: number;
  readonly originY: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly borderColor: string | null;
  readonly labels: Uint8Array;
  readonly colors: readonly RGB[];
  readonly source: Uint8Array;
};

export type SubjectBox = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

const UP = 8;
const CORE_TAU = 0.035;
const REGION_TOLERANCE = 0.06;
const COLOR_FLOOR = 0.035;
const OWN_COLOR = 0.05;
const DILATE_RADIUS = 3;
const SPECK_SOURCE = 1.44;
export const SMOOTH_SOURCE = 0.6;
const K_MAX = 16;

/**
 * Raster hook immediately before palette extraction.
 * The default returns the same pixels. Another module can denoise or reshape
 * the raster here; flat-region cores and the palette are measured on the result.
 */
export type RasterPreprocess = (rgba: Uint8Array, width: number, height: number) => Uint8Array;

export function identityRaster(rgba: Uint8Array, _width: number, _height: number): Uint8Array {
  return rgba;
}

/** One plate per separated logo. A single subject keeps the whole frame so its backdrop stays in the palette. */
export function flatPlates(
  rgba: Uint8Array,
  width: number,
  height: number,
  maxColors: number,
  preprocess: RasterPreprocess = identityRaster,
  smoothSigma = SMOOTH_SOURCE,
  recoverSoft = true
): FlatPlate[] {
  const boxes = subjectBoxes(rgba, width, height);
  return boxes.map((box) => plateFor(rgba, width, height, box, maxColors, preprocess, smoothSigma, recoverSoft));
}

export function subjectBoxes(rgba: Uint8Array, width: number, height: number): SubjectBox[] {
  const found = enclosedBoxes(rgba, width, height);
  if (found.length <= 1) return [{ x: 0, y: 0, width, height }];
  return found;
}

function plateFor(
  rgba: Uint8Array,
  width: number,
  height: number,
  box: SubjectBox,
  maxColors: number,
  preprocess: RasterPreprocess,
  smoothSigma: number,
  recoverSoft: boolean
): FlatPlate {
  const cropW = box.width;
  const cropH = box.height;
  const crop = new Uint8Array(cropW * cropH * 4);
  for (let y = 0; y < cropH; y += 1) {
    const from = ((box.y + y) * width + box.x) * 4;
    crop.set(rgba.subarray(from, from + cropW * 4), y * cropW * 4);
  }
  const painted = labelImage(crop, cropW, cropH, maxColors, preprocess, smoothSigma, recoverSoft);
  return {
    rgba: painted.rgba,
    width: painted.width,
    height: painted.height,
    scale: UP,
    palette: painted.palette,
    originX: box.x,
    originY: box.y,
    sourceWidth: cropW,
    sourceHeight: cropH,
    borderColor: cornerColor(crop, cropW, cropH),
    labels: painted.labels,
    colors: painted.colors,
    source: crop
  };
}

export function cornerColor(rgba: Uint8Array, width: number, height: number): string | null {
  const points = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1]
  ];
  const opaque: RGB[] = [];
  for (const point of points) {
    const x = point[0] ?? 0;
    const y = point[1] ?? 0;
    const offset = (y * width + x) * 4;
    if ((rgba[offset + 3] ?? 0) < 250) continue;
    opaque.push({ r: rgba[offset] ?? 0, g: rgba[offset + 1] ?? 0, b: rgba[offset + 2] ?? 0 });
  }
  if (opaque.length === 0) return null;
  const mean = {
    r: opaque.reduce((sum, color) => sum + color.r, 0) / opaque.length,
    g: opaque.reduce((sum, color) => sum + color.g, 0) / opaque.length,
    b: opaque.reduce((sum, color) => sum + color.b, 0) / opaque.length
  };
  for (const color of opaque) {
    if (Math.abs(color.r - mean.r) > 18 || Math.abs(color.g - mean.g) > 18 || Math.abs(color.b - mean.b) > 18) return null;
  }
  return hex(Math.round(mean.r), Math.round(mean.g), Math.round(mean.b));
}

type Painted = {
  readonly rgba: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly palette: readonly string[];
  readonly labels: Uint8Array;
  readonly colors: readonly RGB[];
};

/** Sub-pixel flat label map. `maxColors` <= 0 picks the smallest K that keeps every flat region. */
export function labelImage(
  rgba: Uint8Array,
  width: number,
  height: number,
  maxColors: number,
  preprocess: RasterPreprocess = identityRaster,
  smoothSigma = SMOOTH_SOURCE,
  recoverSoft = true
): Painted {
  const prepared = preprocess(rgba, width, height);
  const source = prepared.length === rgba.length ? prepared : rgba;
  const count = width * height;
  const lab = new Float64Array(count * 3);
  const linear = new Float64Array(count * 3);
  const alpha = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    const color = { r: source[offset] ?? 0, g: source[offset + 1] ?? 0, b: source[offset + 2] ?? 0 };
    alpha[index] = (source[offset + 3] ?? 0) >= 128 ? 255 : 0;
    const converted = rgbToOklab(color);
    lab[index * 3] = converted.L;
    lab[index * 3 + 1] = converted.a;
    lab[index * 3 + 2] = converted.b;
    linear[index * 3] = srgbToLinear(color.r);
    linear[index * 3 + 1] = srgbToLinear(color.g);
    linear[index * 3 + 2] = srgbToLinear(color.b);
  }
  let core = coreMask(lab, alpha, width, height, CORE_TAU);
  if (countOf(core) < 8) core = coreMask(lab, alpha, width, height, 0.08);
  const userK = maxColors > 0 ? Math.min(K_MAX, Math.max(2, Math.round(maxColors))) : 0;
  const built = buildPalette(lab, core, width, height, userK);
  const centers = recoverSoft ? coverResiduals(lab, alpha, width, height, built, userK) : built;
  const labels = assignLabels(linear, lab, core, alpha, width, height, centers, smoothSigma);
  const colors = fillColors(source, alpha, core, labels, width, height, centers);
  return paintLabels(labels, colors, width * UP, height * UP);
}

function assignLabels(linear: Float64Array, lab: Float64Array, core: Uint8Array, alpha: Uint8Array, width: number, height: number, centers: Lab[], smoothSigma: number): Uint8Array {
  const count = width * height;
  const kCount = centers.length;
  const coreLabel = new Int16Array(count);
  coreLabel.fill(-1);
  for (let index = 0; index < count; index += 1) {
    if (core[index] !== 1) continue;
    coreLabel[index] = nearestLab(readLab(lab, index), centers);
  }
  const allow = new Uint16Array(count);
  const disk = diskOffsets(DILATE_RADIUS);
  for (let index = 0; index < count; index += 1) {
    const label = coreLabel[index] ?? -1;
    if (label < 0) continue;
    const x = index % width;
    const y = (index - x) / width;
    for (const offset of disk) {
      const nx = x + offset.x;
      const ny = y + offset.y;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const at = ny * width + nx;
      allow[at] = (allow[at] ?? 0) | (1 << label);
    }
  }
  const square = squareOffsets(1);
  for (let index = 0; index < count; index += 1) {
    if (alpha[index] === 0) continue;
    const color = readLab(lab, index);
    let near = 0;
    for (let label = 0; label < kCount; label += 1) {
      const center = centers[label];
      if (center === undefined) continue;
      if (Math.sqrt(labDistance2(color, center)) >= OWN_COLOR) continue;
      near |= 1 << label;
    }
    if (near === 0) continue;
    const x = index % width;
    const y = (index - x) / width;
    for (const offset of square) {
      const nx = x + offset.x;
      const ny = y + offset.y;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const at = ny * width + nx;
      allow[at] = (allow[at] ?? 0) | near;
    }
  }
  const nearestCore = nearestCoreLabel(coreLabel, width, height);
  for (let index = 0; index < count; index += 1) {
    if ((allow[index] ?? 0) !== 0) continue;
    const label = nearestCore[index] ?? -1;
    if (label >= 0) allow[index] = 1 << label;
  }
  const upW = width * UP;
  const upH = height * UP;
  const labels = new Uint8Array(upW * upH);
  labels.fill(255);
  const tile = 48;
  for (let y0 = 0; y0 < height; y0 += tile) {
    const y1 = Math.min(height, y0 + tile);
    for (let y = y0; y < y1; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (alpha[y * width + x] === 0) continue;
        const mask = allow[y * width + x] ?? 0;
        const bits = bitList(mask, kCount);
        for (let oy = 0; oy < UP; oy += 1) {
          for (let ox = 0; ox < UP; ox += 1) {
            const ux = x * UP + ox;
            const uy = y * UP + oy;
            const at = uy * upW + ux;
            if (bits.length === 0) continue;
            if (bits.length === 1) {
              labels[at] = bits[0] ?? 0;
              continue;
            }
            const sample = bicubicLab(linear, width, height, (ux + 0.5) / UP - 0.5, (uy + 0.5) / UP - 0.5);
            labels[at] = explain(sample, bits, centers);
          }
        }
      }
    }
  }
  cleanLabels(labels, upW, upH, kCount, Math.floor(SPECK_SOURCE * UP * UP));
  smoothLabels(labels, upW, upH, kCount, smoothSigma * UP);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] !== 0) continue;
      for (let oy = 0; oy < UP; oy += 1) {
        for (let ox = 0; ox < UP; ox += 1) labels[(y * UP + oy) * upW + x * UP + ox] = 255;
      }
    }
  }
  return labels;
}

function nearestCoreLabel(coreLabel: Int16Array, width: number, height: number): Int16Array {
  const nearest = new Int16Array(coreLabel.length);
  nearest.fill(-1);
  const queue: number[] = [];
  for (let index = 0; index < coreLabel.length; index += 1) {
    const label = coreLabel[index] ?? -1;
    if (label < 0) continue;
    nearest[index] = label;
    queue.push(index);
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor] ?? 0;
    const label = nearest[index] ?? -1;
    const x = index % width;
    const y = (index - x) / width;
    const steps = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1]
    ];
    for (const step of steps) {
      const nx = step[0] ?? 0;
      const ny = step[1] ?? 0;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const at = ny * width + nx;
      if ((nearest[at] ?? -1) >= 0) continue;
      nearest[at] = label;
      queue.push(at);
    }
  }
  return nearest;
}

function explain(sample: Lab, bits: readonly number[], centers: readonly Lab[]): number {
  let best = bits[0] ?? 0;
  let bestDistance = Infinity;
  for (const label of bits) {
    const center = centers[label];
    if (center === undefined) continue;
    const distance = Math.sqrt(labDistance2(sample, center));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = label;
    }
  }
  for (let left = 0; left < bits.length; left += 1) {
    for (let right = left + 1; right < bits.length; right += 1) {
      const a = bits[left];
      const b = bits[right];
      if (a === undefined || b === undefined) continue;
      const first = centers[a];
      const second = centers[b];
      if (first === undefined || second === undefined) continue;
      const projected = projectLab(sample, first, second);
      if (projected.distance < bestDistance) {
        bestDistance = projected.distance;
        best = projected.t < 0.5 ? a : b;
      }
    }
  }
  return best;
}

function fillColors(rgba: Uint8Array, alpha: Uint8Array, core: Uint8Array, labels: Uint8Array, width: number, height: number, centers: readonly Lab[]): RGB[] {
  const sums = centers.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));
  const upW = width * UP;
  const mid = UP >> 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (alpha[index] === 0 || core[index] !== 1) continue;
      const label = labels[(y * UP + mid) * upW + x * UP + mid] ?? 255;
      const bin = sums[label];
      if (bin === undefined) continue;
      const offset = index * 4;
      bin.r += rgba[offset] ?? 0;
      bin.g += rgba[offset + 1] ?? 0;
      bin.b += rgba[offset + 2] ?? 0;
      bin.n += 1;
    }
  }
  return centers.map((center, index) => {
    const bin = sums[index];
    if (bin !== undefined && bin.n > 4) return { r: Math.round(bin.r / bin.n), g: Math.round(bin.g / bin.n), b: Math.round(bin.b / bin.n) };
    return oklabToRgb(center);
  });
}

function paintLabels(labels: Uint8Array, colors: readonly RGB[], width: number, height: number): Painted {
  const used = new Map<number, number>();
  const palette: string[] = [];
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index] ?? 255;
    if (label === 255) continue;
    let slot = used.get(label);
    if (slot === undefined) {
      const color = colors[label] ?? { r: 0, g: 0, b: 0 };
      const paint = hex(color.r, color.g, color.b);
      slot = palette.indexOf(paint);
      if (slot < 0) {
        slot = palette.length;
        palette.push(paint);
      }
      used.set(label, slot);
    }
    const color = colors[label] ?? { r: 0, g: 0, b: 0 };
    const offset = index * 4;
    rgba[offset] = color.r;
    rgba[offset + 1] = color.g;
    rgba[offset + 2] = color.b;
    rgba[offset + 3] = 255;
  }
  return { rgba, width, height, palette, labels, colors };
}

function buildPalette(lab: Float64Array, core: Uint8Array, width: number, height: number, userK: number): Lab[] {
  const bins = new Map<string, { x: number; y: number; z: number; n: number }>();
  for (let index = 0; index < core.length; index += 1) {
    if (core[index] !== 1) continue;
    const color = readLab(lab, index);
    const key = Math.round(color.L / 0.008) + "," + Math.round(color.a / 0.008) + "," + Math.round(color.b / 0.008);
    const bin = bins.get(key) ?? { x: 0, y: 0, z: 0, n: 0 };
    bin.x += color.L;
    bin.y += color.a;
    bin.z += color.b;
    bin.n += 1;
    bins.set(key, bin);
  }
  const samples: Lab[] = [];
  const weights: number[] = [];
  for (const bin of bins.values()) {
    if (bin.n === 0) continue;
    samples.push({ L: bin.x / bin.n, a: bin.y / bin.n, b: bin.z / bin.n });
    weights.push(Math.log1p(bin.n));
  }
  if (samples.length === 0) return [{ L: 0, a: 0, b: 0 }];
  const regions = regionMeans(lab, core, width, height);
  const anchors = distinctAnchors(regions);
  const floorK = Math.max(2, anchors.length);
  if (userK > 0) return wkmeans(samples, weights, Math.min(K_MAX, Math.max(userK, anchors.length)), anchors);
  if (regions.length === 0) return wkmeans(samples, weights, Math.min(K_MAX, Math.max(2, Math.min(8, samples.length))));
  let chosen = wkmeans(samples, weights, Math.min(floorK, samples.length), anchors);
  for (let k = floorK; k <= Math.min(K_MAX, Math.max(samples.length, anchors.length)); k += 1) {
    chosen = wkmeans(samples, weights, k, anchors);
    const missed = regions.some((region) => chosen.every((center) => Math.sqrt(labDistance2(center, region.mean)) > REGION_TOLERANCE));
    if (!missed) return chosen;
  }
  return chosen;
}

function distinctAnchors(regions: readonly { readonly mean: Lab; readonly size: number }[]): Lab[] {
  const ordered = [...regions].sort((left, right) => right.size - left.size);
  const kept: Lab[] = [];
  for (const region of ordered) {
    if (kept.length >= K_MAX) break;
    if (kept.every((color) => Math.sqrt(labDistance2(color, region.mean)) > COLOR_FLOOR)) kept.push({ ...region.mean });
  }
  return kept;
}

function regionMeans(lab: Float64Array, core: Uint8Array, width: number, height: number): { mean: Lab; size: number }[] {
  const groups = new Map<number, number[]>();
  for (let index = 0; index < core.length; index += 1) {
    if (core[index] !== 1) continue;
    const color = readLab(lab, index);
    const key = (Math.round(color.L / 0.05) + 40) * 10000 + (Math.round(color.a / 0.05) + 40) * 100 + (Math.round(color.b / 0.05) + 40);
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [index]);
    else list.push(index);
  }
  const means: { mean: Lab; size: number }[] = [];
  for (const pixels of groups.values()) {
    const member = new Uint8Array(core.length);
    for (const index of pixels) member[index] = 1;
    const labeled = components(member, width, height);
    for (let id = 1; id <= labeled.count; id += 1) {
      const size = labeled.sizes[id] ?? 0;
      if (size < 12) continue;
      let l = 0;
      let a = 0;
      let b = 0;
      const values: Lab[] = [];
      for (let index = 0; index < member.length; index += 1) {
        if ((labeled.ids[index] ?? 0) !== id) continue;
        const color = readLab(lab, index);
        values.push(color);
        l += color.L;
        a += color.a;
        b += color.b;
      }
      const n = values.length;
      if (n === 0) continue;
      const mean = { L: l / n, a: a / n, b: b / n };
      let varL = 0;
      let varA = 0;
      let varB = 0;
      for (const color of values) {
        varL += (color.L - mean.L) ** 2;
        varA += (color.a - mean.a) ** 2;
        varB += (color.b - mean.b) ** 2;
      }
      const spread = Math.max(Math.sqrt(varL / n), Math.sqrt(varA / n), Math.sqrt(varB / n));
      if (spread < 0.015) means.push({ mean, size });
    }
  }
  return means;
}

function wkmeans(samples: readonly Lab[], weights: readonly number[], kCount: number, frozen: readonly Lab[] = []): Lab[] {
  const count = samples.length;
  const pinned = Math.min(frozen.length, K_MAX);
  const k = Math.max(1, Math.min(K_MAX, Math.max(kCount, pinned, count === 0 ? pinned : 1)));
  const centers: Lab[] = [];
  for (let index = 0; index < pinned && centers.length < k; index += 1) {
    const seed = frozen[index] ?? zeroLab();
    centers.push({ L: seed.L, a: seed.a, b: seed.b });
  }
  if (count === 0) return centers.length > 0 ? centers : [{ L: 0, a: 0, b: 0 }];
  const distance = new Float64Array(count);
  if (centers.length === 0) {
    let first = 0;
    let bestWeight = -1;
    for (let index = 0; index < count; index += 1) {
      const weight = weights[index] ?? 0;
      if (weight > bestWeight) {
        bestWeight = weight;
        first = index;
      }
    }
    centers.push({ ...(samples[first] ?? zeroLab()) });
  }
  for (let index = 0; index < count; index += 1) {
    const sample = samples[index] ?? zeroLab();
    let best = Infinity;
    for (const center of centers) best = Math.min(best, Math.sqrt(labDistance2(sample, center)));
    distance[index] = best;
  }
  while (centers.length < k && centers.length < count + pinned) {
    let at = 0;
    let score = -1;
    for (let index = 0; index < count; index += 1) {
      const next = (distance[index] ?? 0) * Math.sqrt(weights[index] ?? 0);
      if (next > score) {
        score = next;
        at = index;
      }
    }
    if (score <= 0 && centers.length >= pinned) break;
    const center = samples[at] ?? zeroLab();
    centers.push({ L: center.L, a: center.a, b: center.b });
    for (let index = 0; index < count; index += 1) {
      distance[index] = Math.min(distance[index] ?? 0, Math.sqrt(labDistance2(samples[index] ?? zeroLab(), center)));
    }
  }
  const pinCount = Math.min(pinned, centers.length);
  for (let round = 0; round < 40; round += 1) {
    const bins = centers.map(() => ({ L: 0, a: 0, b: 0, w: 0 }));
    for (let index = 0; index < count; index += 1) {
      const sample = samples[index] ?? zeroLab();
      const slot = nearestLab(sample, centers);
      const bin = bins[slot];
      const weight = weights[index] ?? 0;
      if (bin === undefined) continue;
      bin.L += sample.L * weight;
      bin.a += sample.a * weight;
      bin.b += sample.b * weight;
      bin.w += weight;
    }
    for (let index = pinCount; index < centers.length; index += 1) {
      const bin = bins[index];
      if (bin === undefined || bin.w === 0) continue;
      centers[index] = { L: bin.L / bin.w, a: bin.a / bin.w, b: bin.b / bin.w };
    }
  }
  return centers;
}

/** Flat cores miss thin or soft bands. Fill unused K slots with those tight residual colors. */
function coverResiduals(lab: Float64Array, alpha: Uint8Array, width: number, height: number, centers: readonly Lab[], userK: number): Lab[] {
  const kept = uniqueCenters(centers);
  const limit = Math.min(K_MAX, userK > 0 ? Math.max(userK, kept.length) : K_MAX);
  const minCount = Math.max(24, Math.floor(width * height * 0.004));
  const next = kept.slice();
  for (let round = 0; round < K_MAX && next.length < limit; round += 1) {
    const residual = largestResidual(lab, alpha, width, height, next, minCount);
    if (residual === null) break;
    next.push(residual);
  }
  return next;
}

function uniqueCenters(centers: readonly Lab[]): Lab[] {
  const kept: Lab[] = [];
  for (const center of centers) {
    if (kept.every((other) => Math.sqrt(labDistance2(other, center)) > COLOR_FLOOR)) kept.push({ L: center.L, a: center.a, b: center.b });
  }
  return kept.length > 0 ? kept : [{ L: 0, a: 0, b: 0 }];
}

function largestResidual(lab: Float64Array, alpha: Uint8Array, width: number, height: number, centers: readonly Lab[], minCount: number): Lab | null {
  const bins = new Map<string, { L: number; a: number; b: number; n: number; vL: number; vA: number; vB: number }>();
  for (let index = 0; index < width * height; index += 1) {
    if (alpha[index] === 0) continue;
    const color = readLab(lab, index);
    let nearest = Infinity;
    for (const center of centers) nearest = Math.min(nearest, Math.sqrt(labDistance2(color, center)));
    if (nearest <= COLOR_FLOOR) continue;
    const key = Math.round(color.L / 0.04) + "," + Math.round(color.a / 0.04) + "," + Math.round(color.b / 0.04);
    const bin = bins.get(key) ?? { L: 0, a: 0, b: 0, n: 0, vL: 0, vA: 0, vB: 0 };
    bin.L += color.L;
    bin.a += color.a;
    bin.b += color.b;
    bin.n += 1;
    bin.vL += color.L * color.L;
    bin.vA += color.a * color.a;
    bin.vB += color.b * color.b;
    bins.set(key, bin);
  }
  let best: Lab | null = null;
  let bestCount = minCount - 1;
  for (const bin of bins.values()) {
    if (bin.n < minCount || bin.n <= bestCount) continue;
    const mean = { L: bin.L / bin.n, a: bin.a / bin.n, b: bin.b / bin.n };
    const spread = Math.max(
      Math.sqrt(Math.max(0, bin.vL / bin.n - mean.L * mean.L)),
      Math.sqrt(Math.max(0, bin.vA / bin.n - mean.a * mean.a)),
      Math.sqrt(Math.max(0, bin.vB / bin.n - mean.b * mean.b))
    );
    if (spread > 0.02) continue;
    if (centers.some((center) => Math.sqrt(labDistance2(center, mean)) <= COLOR_FLOOR)) continue;
    if (blendOf(mean, centers)) continue;
    best = mean;
    bestCount = bin.n;
  }
  return best;
}

function blendOf(color: Lab, centers: readonly Lab[]): boolean {
  for (let left = 0; left < centers.length; left += 1) {
    for (let right = left + 1; right < centers.length; right += 1) {
      const first = centers[left];
      const second = centers[right];
      if (first === undefined || second === undefined) continue;
      const projected = projectLab(color, first, second);
      if (projected.t > 0.04 && projected.t < 0.96 && projected.distance <= 0.02) return true;
    }
  }
  return false;
}

function cleanLabels(labels: Uint8Array, width: number, height: number, kCount: number, minArea: number): void {
  for (let pass = 0; pass < 2; pass += 1) {
    for (let label = 0; label < kCount; label += 1) {
      const mask = new Uint8Array(labels.length);
      for (let index = 0; index < labels.length; index += 1) if (labels[index] === label) mask[index] = 1;
      const labeled = components(mask, width, height);
      const small = new Uint8Array(labels.length);
      let any = false;
      for (let index = 0; index < labels.length; index += 1) {
        const id = labeled.ids[index] ?? 0;
        if (id > 0 && (labeled.sizes[id] ?? 0) < minArea) {
          small[index] = 1;
          any = true;
        }
      }
      if (!any) continue;
      const replacement = nearestOutside(labels, small, width, height);
      for (let index = 0; index < labels.length; index += 1) if (small[index] === 1) labels[index] = replacement[index] ?? label;
    }
  }
}

function nearestOutside(labels: Uint8Array, small: Uint8Array, width: number, height: number): Uint8Array {
  const nearest = new Uint8Array(labels.length);
  const seen = new Uint8Array(labels.length);
  const queue: number[] = [];
  for (let index = 0; index < small.length; index += 1) {
    if (small[index] === 1) continue;
    seen[index] = 1;
    nearest[index] = labels[index] ?? 0;
    queue.push(index);
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor] ?? 0;
    const x = index % width;
    const y = (index - x) / width;
    const around = [index - 1, index + 1, index - width, index + width];
    for (const next of around) {
      if (next < 0 || next >= labels.length || seen[next] === 1) continue;
      const nx = next % width;
      if (Math.abs(nx - x) + Math.abs((next - nx) / width - y) !== 1) continue;
      seen[next] = 1;
      nearest[next] = nearest[index] ?? 0;
      queue.push(next);
    }
  }
  return nearest;
}

function smoothLabels(labels: Uint8Array, width: number, height: number, kCount: number, sigma: number): void {
  if (!(sigma > 0)) return;
  const kernel = gaussianKernel(sigma);
  const best = new Float64Array(labels.length);
  best.fill(-1);
  const next = labels.slice();
  const mask = new Float64Array(labels.length);
  const blurred = new Float64Array(labels.length);
  for (let label = 0; label < kCount; label += 1) {
    for (let index = 0; index < labels.length; index += 1) mask[index] = labels[index] === label ? 1 : 0;
    blurSeparable(mask, blurred, width, height, kernel);
    for (let index = 0; index < labels.length; index += 1) {
      const value = blurred[index] ?? 0;
      if (value > (best[index] ?? -1)) {
        best[index] = value;
        next[index] = label;
      }
    }
  }
  labels.set(next);
}

function enclosedBoxes(rgba: Uint8Array, width: number, height: number): SubjectBox[] {
  const count = width * height;
  if (width < 2 || height < 2 || rgba.length < count * 4) return [];
  const lab = new Float64Array(count * 3);
  const opaque = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    opaque[index] = (rgba[offset + 3] ?? 0) >= 128 ? 1 : 0;
    const color = rgbToOklab({ r: rgba[offset] ?? 0, g: rgba[offset + 1] ?? 0, b: rgba[offset + 2] ?? 0 });
    lab[index * 3] = color.L;
    lab[index * 3 + 1] = color.a;
    lab[index * 3 + 2] = color.b;
  }
  const edge = new Uint8Array(count);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (opaque[index] !== 1) continue;
      const color = readLab(lab, index);
      let strong = false;
      for (const step of [-1, 1, -width, width]) {
        const next = index + step;
        const nx = x + (step === -1 ? -1 : step === 1 ? 1 : 0);
        const ny = y + (step === -width ? -1 : step === width ? 1 : 0);
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (opaque[next] !== 1) {
          strong = true;
          break;
        }
        if (Math.sqrt(labDistance2(color, readLab(lab, next))) > COLOR_FLOOR) {
          strong = true;
          break;
        }
      }
      if (strong) edge[index] = 1;
    }
  }
  const outside = new Uint8Array(count);
  const queue: number[] = [];
  for (let x = 0; x < width; x += 1) {
    seedOutside(0 * width + x, edge, outside, queue);
    seedOutside((height - 1) * width + x, edge, outside, queue);
  }
  for (let y = 0; y < height; y += 1) {
    seedOutside(y * width, edge, outside, queue);
    seedOutside(y * width + width - 1, edge, outside, queue);
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor] ?? 0;
    const x = index % width;
    const y = (index - x) / width;
    const steps = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1]
    ];
    for (const step of steps) {
      const nx = step[0] ?? 0;
      const ny = step[1] ?? 0;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      seedOutside(ny * width + nx, edge, outside, queue);
    }
  }
  const object = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) if (opaque[index] === 1 && outside[index] !== 1) object[index] = 1;
  const labeled = components(object, width, height);
  const boxes: SubjectBox[] = [];
  for (let id = 1; id <= labeled.count; id += 1) {
    if ((labeled.sizes[id] ?? 0) < 400) continue;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    for (let index = 0; index < count; index += 1) {
      if ((labeled.ids[index] ?? 0) !== id) continue;
      const x = index % width;
      const y = (index - x) / width;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const pad = 2;
    const x = Math.max(0, minX - pad);
    const y = Math.max(0, minY - pad);
    boxes.push({ x, y, width: Math.min(width, maxX + 1 + pad) - x, height: Math.min(height, maxY + 1 + pad) - y });
  }
  return mergeStackedFragments(mergeBoxes(boxes, 8));
}

function mergeStackedFragments(boxes: readonly SubjectBox[]): SubjectBox[] {
  const open = boxes.map((box) => ({ ...box }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let left = 0; left < open.length && !merged; left += 1) {
      for (let right = left + 1; right < open.length; right += 1) {
        const a = open[left];
        const b = open[right];
        if (a === undefined || b === undefined) continue;
        const upper = a.y <= b.y ? a : b;
        const lower = a.y <= b.y ? b : a;
        const yGap = lower.y - (upper.y + upper.height);
        const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const ratio = Math.max(a.width, b.width) / Math.max(1, Math.min(a.width, b.width));
        const gapLimit = Math.max(upper.height, lower.height) * 1.2;
        if (yGap < 0 || yGap > gapLimit || overlap < 0.7 * Math.min(a.width, b.width) || ratio > 1.4) continue;
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        open[left] = { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
        open.splice(right, 1);
        merged = true;
        break;
      }
    }
  }
  return open;
}

function seedOutside(index: number, edge: Uint8Array, outside: Uint8Array, queue: number[]): void {
  if (edge[index] === 1 || outside[index] === 1) return;
  outside[index] = 1;
  queue.push(index);
}

function mergeBoxes(boxes: SubjectBox[], gap: number): SubjectBox[] {
  const open = boxes.map((box) => ({ ...box }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let left = 0; left < open.length; left += 1) {
      for (let right = left + 1; right < open.length; right += 1) {
        const a = open[left];
        const b = open[right];
        if (a === undefined || b === undefined) continue;
        const apart = a.x > b.x + b.width + gap || b.x > a.x + a.width + gap || a.y > b.y + b.height + gap || b.y > a.y + a.height + gap;
        if (apart) continue;
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        open[left] = { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
        open.splice(right, 1);
        merged = true;
        break;
      }
      if (merged) break;
    }
  }
  return open;
}

function coreMask(lab: Float64Array, alpha: Uint8Array, width: number, height: number, tau: number): Uint8Array {
  const core = new Uint8Array(width * height);
  const limit = tau * tau;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (alpha[index] === 0) continue;
      const color = readLab(lab, index);
      let worst = 0;
      let flat = true;
      for (let dy = -1; dy <= 1 && flat; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = Math.min(width - 1, Math.max(0, x + dx));
          const ny = Math.min(height - 1, Math.max(0, y + dy));
          const next = ny * width + nx;
          if (alpha[next] === 0) {
            flat = false;
            break;
          }
          worst = Math.max(worst, labDistance2(color, readLab(lab, next)));
          if (worst >= limit) flat = false;
        }
      }
      if (flat && worst < limit) core[index] = 1;
    }
  }
  return core;
}

function components(mask: Uint8Array, width: number, height: number): { readonly ids: Int32Array; readonly sizes: Int32Array; readonly count: number } {
  const ids = new Int32Array(mask.length);
  const sizes: number[] = [0];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] !== 1 || ids[start] !== 0) continue;
    const id = sizes.length;
    sizes.push(0);
    stack.push(start);
    ids[start] = id;
    while (stack.length > 0) {
      const index = stack.pop() ?? 0;
      sizes[id] = (sizes[id] ?? 0) + 1;
      const x = index % width;
      const y = (index - x) / width;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (mask[next] !== 1 || ids[next] !== 0) continue;
          ids[next] = id;
          stack.push(next);
        }
      }
    }
  }
  return { ids, sizes: Int32Array.from(sizes), count: sizes.length - 1 };
}

function bicubicLab(linear: Float64Array, width: number, height: number, sx: number, sy: number): Lab {
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const fx = sx - x0;
  const fy = sy - y0;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let ky = -1; ky <= 2; ky += 1) {
    const wy = keys(fy - ky);
    const y = reflect101(y0 + ky, height);
    for (let kx = -1; kx <= 2; kx += 1) {
      const weight = wy * keys(fx - kx);
      const x = reflect101(x0 + kx, width);
      const offset = (y * width + x) * 3;
      red += (linear[offset] ?? 0) * weight;
      green += (linear[offset + 1] ?? 0) * weight;
      blue += (linear[offset + 2] ?? 0) * weight;
    }
  }
  return rgbToOklab({ r: linearToSrgb(red), g: linearToSrgb(green), b: linearToSrgb(blue) });
}

function blurSeparable(source: Float64Array, target: Float64Array, width: number, height: number, kernel: Float64Array): void {
  const radius = (kernel.length - 1) >> 1;
  const temp = new Float64Array(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let tap = -radius; tap <= radius; tap += 1) sum += (source[y * width + reflect101(x + tap, width)] ?? 0) * (kernel[tap + radius] ?? 0);
      temp[y * width + x] = sum;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let tap = -radius; tap <= radius; tap += 1) sum += (temp[reflect101(y + tap, height) * width + x] ?? 0) * (kernel[tap + radius] ?? 0);
      target[y * width + x] = sum;
    }
  }
}

function gaussianKernel(sigma: number): Float64Array {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float64Array(radius * 2 + 1);
  let sum = 0;
  for (let index = -radius; index <= radius; index += 1) {
    const weight = Math.exp(-(index * index) / (2 * sigma * sigma));
    kernel[index + radius] = weight;
    sum += weight;
  }
  for (let index = 0; index < kernel.length; index += 1) kernel[index] = (kernel[index] ?? 0) / sum;
  return kernel;
}

function projectLab(color: Lab, left: Lab, right: Lab): { readonly t: number; readonly distance: number } {
  const dL = right.L - left.L;
  const da = right.a - left.a;
  const db = right.b - left.b;
  const length = dL * dL + da * da + db * db;
  const raw = length === 0 ? 0 : ((color.L - left.L) * dL + (color.a - left.a) * da + (color.b - left.b) * db) / length;
  const t = Math.min(1, Math.max(0, raw));
  const mixed = { L: left.L + t * dL, a: left.a + t * da, b: left.b + t * db };
  return { t, distance: Math.sqrt(labDistance2(color, mixed)) };
}

function nearestLab(color: Lab, centers: readonly Lab[]): number {
  let best = 0;
  let score = Infinity;
  for (let index = 0; index < centers.length; index += 1) {
    const center = centers[index];
    if (center === undefined) continue;
    const gap = labDistance2(color, center);
    if (gap < score) {
      score = gap;
      best = index;
    }
  }
  return best;
}

function bitList(mask: number, kCount: number): number[] {
  const bits: number[] = [];
  for (let label = 0; label < kCount; label += 1) if ((mask & (1 << label)) !== 0) bits.push(label);
  return bits;
}

function squareOffsets(radius: number): { x: number; y: number }[] {
  const offsets: { x: number; y: number }[] = [];
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) offsets.push({ x, y });
  }
  return offsets;
}

function diskOffsets(radius: number): { x: number; y: number }[] {
  const offsets: { x: number; y: number }[] = [];
  const limit = radius * radius;
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) if (x * x + y * y <= limit) offsets.push({ x, y });
  }
  return offsets;
}

function readLab(lab: Float64Array, index: number): Lab {
  return { L: lab[index * 3] ?? 0, a: lab[index * 3 + 1] ?? 0, b: lab[index * 3 + 2] ?? 0 };
}

function countOf(mask: Uint8Array): number {
  let count = 0;
  for (const value of mask) if (value === 1) count += 1;
  return count;
}

function zeroLab(): Lab {
  return { L: 0, a: 0, b: 0 };
}

function reflect101(index: number, length: number): number {
  if (length <= 1) return 0;
  const span = length * 2 - 2;
  let wrapped = index % span;
  if (wrapped < 0) wrapped += span;
  return wrapped >= length ? span - wrapped : wrapped;
}

function keys(distance: number): number {
  const t = Math.abs(distance);
  if (t <= 1) return (1.25 * t - 2.25) * t * t + 1;
  if (t < 2) return ((-0.75 * t + 3.75) * t - 6) * t + 3;
  return 0;
}

function srgbToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel: number): number {
  const value = Math.min(1, Math.max(0, channel));
  const encoded = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, encoded)) * 255);
}

function hex(red: number, green: number, blue: number): string {
  return "#" + [red, green, blue].map((value) => Math.min(255, Math.max(0, value)).toString(16).padStart(2, "0")).join("");
}
