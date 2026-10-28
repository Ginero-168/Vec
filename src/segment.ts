import type { TracePreset } from "./trace";

export type SegmentOptions = {
  readonly mode: TracePreset;
  readonly maxColors: number;
  readonly removeBackground: boolean;
  readonly snapBlends?: boolean;
  readonly speckArea?: number;
  readonly backdropSpread?: number;
  readonly opaqueAt?: number;
};

export type SegmentViews = {
  readonly colors: Uint8Array;
  readonly backdrop: Uint8Array;
  readonly spread: number;
  readonly paletteSize: number;
};

export type RGB = { r: number; g: number; b: number };

export type SegmentColorStage = {
  readonly colors: Uint8Array;
  readonly labels: Int16Array;
  readonly punchLabels: Int16Array;
  readonly palette: readonly RGB[];
  readonly opaque: Uint8Array;
  readonly spread: number;
};

export type SegmentBackdropStage = {
  readonly backdrop: Uint8Array;
  readonly punchInput: Uint8Array;
};

const MODE_CAP: Readonly<Record<TracePreset, number>> = { logo: 8, icon: 8, photo: 32, poster: 10 };
const SPECK_AREA: Readonly<Record<TracePreset, number>> = { logo: 18, icon: 12, photo: 6, poster: 28 };

export function segmentRaster(rgba: Uint8Array, width: number, height: number, options: SegmentOptions): Uint8Array {
  return segmentViews(rgba, width, height, options).backdrop;
}

export function segmentViews(rgba: Uint8Array, width: number, height: number, options: SegmentOptions): SegmentViews {
  const colors = segmentColorStage(rgba, width, height, options);
  const backdrop = segmentBackdropStage(rgba, width, height, colors, options.removeBackground, options.backdropSpread ?? 22);
  return { colors: colors.colors, backdrop: backdrop.backdrop, spread: colors.spread, paletteSize: colors.palette.length };
}

export function segmentColorStage(rgba: Uint8Array, width: number, height: number, options: SegmentOptions, onProgress?: (fraction: number) => void): SegmentColorStage {
  let lastProgress = 0;
  const report = (fraction: number): void => {
    lastProgress = Math.max(lastProgress, Math.min(1, fraction));
    onProgress?.(lastProgress);
  };
  const count = width * height;
  if (width < 2 || height < 2 || rgba.length < count * 4) {
    const copy = rgba.slice();
    const labels = new Int16Array(count);
    labels.fill(-1);
    report(1);
    return { colors: copy, labels, punchLabels: labels, palette: [], opaque: new Uint8Array(count), spread: 0 };
  }
  const source = rgba;
  const cutoff = Math.min(255, Math.max(0, Math.round(options.opaqueAt ?? 128)));
  report(0);
  const samples = collectSamples(source, width, height, cutoff, (fraction) => report(fraction * 0.08));
  const centroids = cluster(samples, colorCap(options), (fraction) => report(0.08 + fraction * 0.12));
  const snapBlends = options.snapBlends ?? (options.mode === "logo" || options.mode === "icon");
  const areas = new Uint32Array(centroids.length);
  for (let index = 0; index < count; index += 1) {
    if ((source[index * 4 + 3] ?? 0) < cutoff) continue;
    const label = nearest(pixelAt(source, index), centroids);
    areas[label] = (areas[label] ?? 0) + 1;
    if (index % Math.max(1, width * 4) === 0) report(0.2 + (index / count) * 0.12);
  }
  report(0.32);
  const palette = snapBlends ? foldBlends(centroids, areas) : centroids;
  const labels = new Int16Array(count);
  labels.fill(-1);
  for (let index = 0; index < count; index += 1) {
    if ((source[index * 4 + 3] ?? 0) < cutoff) continue;
    labels[index] = nearest(pixelAt(source, index), palette);
    if (index % Math.max(1, width * 4) === 0) report(0.32 + (index / count) * 0.16);
  }
  report(0.48);
  cleanupEdges(labels, width, height, (fraction) => report(0.48 + fraction * 0.12));
  mergeSpecks(labels, width, height, Math.max(0, Math.round(options.speckArea ?? SPECK_AREA[options.mode])), (fraction) => report(0.6 + fraction * 0.18));
  const punchLabels = new Int16Array(labels);
  for (let index = 0; index < count; index += 1) {
    if ((source[index * 4 + 3] ?? 0) > 0 && (punchLabels[index] ?? -1) < 0) punchLabels[index] = nearest(pixelAt(source, index), palette);
    if (index % Math.max(1, width * 4) === 0) report(0.78 + (index / count) * 0.1);
  }
  const opaque = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    opaque[index] = (source[index * 4 + 3] ?? 0) >= cutoff ? 255 : 0;
    if (index % Math.max(1, width * 4) === 0) report(0.88 + (index / count) * 0.08);
  }
  const colors = paintLabels(labels, palette, opaque, (fraction) => report(0.96 + fraction * 0.04));
  report(1);
  return { colors, labels, punchLabels, palette, opaque, spread: borderMeasure(source, width, height)?.spread ?? 0 };
}

export async function segmentColorStageAsync(
  rgba: Uint8Array,
  width: number,
  height: number,
  options: SegmentOptions,
  onProgress?: (fraction: number) => void,
  shouldCancel?: () => boolean
): Promise<SegmentColorStage> {
  if (shouldCancel?.() === true) throw new Error("ยกเลิกแล้ว");
  const work = { lastYield: Date.now() };
  const cooperate = async (): Promise<void> => {
    if (Date.now() - work.lastYield < 20) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    work.lastYield = Date.now();
    if (shouldCancel?.() === true) throw new Error("ยกเลิกแล้ว");
  };
  let last = 0;
  const report = (fraction: number): void => {
    last = Math.max(last, Math.min(1, fraction));
    onProgress?.(last);
  };
  const count = width * height;
  if (width < 2 || height < 2 || rgba.length < count * 4) {
    const labels = new Int16Array(count);
    labels.fill(-1);
    report(1);
    return { colors: rgba.slice(), labels, punchLabels: labels, palette: [], opaque: new Uint8Array(count), spread: 0 };
  }
  const cutoff = Math.min(255, Math.max(0, Math.round(options.opaqueAt ?? 128)));
  const samples = collectSamples(rgba, width, height, cutoff);
  const centroids = await clusterAsync(samples, colorCap(options), cooperate, (fraction) => report(fraction * 0.15));
  const snapBlends = options.snapBlends ?? (options.mode === "logo" || options.mode === "icon");
  const areas = new Uint32Array(centroids.length);
  for (let index = 0; index < count; index += 1) {
    if ((rgba[index * 4 + 3] ?? 0) >= cutoff) {
      const label = nearest(pixelAt(rgba, index), centroids);
      areas[label] = (areas[label] ?? 0) + 1;
    }
    if (index % Math.max(1, width * 4) === 0) {
      report(0.15 + (index / count) * 0.13);
      await cooperate();
    }
  }
  const palette = snapBlends ? foldBlends(centroids, areas) : centroids;
  const labels = new Int16Array(count);
  labels.fill(-1);
  for (let index = 0; index < count; index += 1) {
    if ((rgba[index * 4 + 3] ?? 0) >= cutoff) labels[index] = nearest(pixelAt(rgba, index), palette);
    if (index % Math.max(1, width * 4) === 0) {
      report(0.28 + (index / count) * 0.18);
      await cooperate();
    }
  }
  await cleanupEdgesAsync(labels, width, height, cooperate, (fraction) => report(0.46 + fraction * 0.12));
  await mergeSpecksAsync(labels, width, height, Math.max(0, Math.round(options.speckArea ?? SPECK_AREA[options.mode])), cooperate, (fraction) => report(0.58 + fraction * 0.18));
  const punchLabels = new Int16Array(labels);
  for (let index = 0; index < count; index += 1) {
    if ((rgba[index * 4 + 3] ?? 0) > 0 && (punchLabels[index] ?? -1) < 0) punchLabels[index] = nearest(pixelAt(rgba, index), palette);
    if (index % Math.max(1, width * 4) === 0) {
      report(0.76 + (index / count) * 0.1);
      await cooperate();
    }
  }
  const opaque = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    opaque[index] = (rgba[index * 4 + 3] ?? 0) >= cutoff ? 255 : 0;
    if (index % Math.max(1, width * 4) === 0) {
      report(0.86 + (index / count) * 0.08);
      await cooperate();
    }
  }
  const colors = await paintLabelsAsync(labels, palette, opaque, cooperate, (fraction) => report(0.94 + fraction * 0.06));
  report(1);
  return { colors, labels, punchLabels, palette, opaque, spread: borderMeasure(rgba, width, height)?.spread ?? 0 };
}

async function clusterAsync(
  samples: readonly RGB[],
  cap: number,
  cooperate: () => Promise<void>,
  onProgress: (fraction: number) => void
): Promise<RGB[]> {
  const centroids = seedCentroids(samples, cap);
  for (let round = 0; round < 8; round += 1) {
    const sums = centroids.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      if (sample === undefined) continue;
      const slot = nearest(sample, centroids);
      const bin = sums[slot];
      if (bin !== undefined) {
        bin.r += sample.r;
        bin.g += sample.g;
        bin.b += sample.b;
        bin.n += 1;
      }
      if (index % 1024 === 0) await cooperate();
    }
    for (let index = 0; index < centroids.length; index += 1) {
      const bin = sums[index];
      if (bin === undefined || bin.n === 0) continue;
      centroids[index] = { r: Math.round(bin.r / bin.n), g: Math.round(bin.g / bin.n), b: Math.round(bin.b / bin.n) };
    }
    onProgress((round + 1) / 8);
  }
  return centroids;
}

async function cleanupEdgesAsync(labels: Int16Array, width: number, height: number, cooperate: () => Promise<void>, onProgress: (fraction: number) => void): Promise<void> {
  const original = new Int16Array(labels);
  for (let pass = 0; pass < 2; pass += 1) {
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        if ((original[index] ?? -1) < 0 || isThin(original, width, index)) continue;
        const counts = new Map<number, number>();
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const label = original[index + dy * width + dx] ?? -1;
            if (label >= 0) counts.set(label, (counts.get(label) ?? 0) + 1);
          }
        }
        let bestLabel = original[index] ?? 0;
        let bestCount = 0;
        for (const [label, count] of counts) {
          if (count > bestCount) {
            bestCount = count;
            bestLabel = label;
          }
        }
        if (bestCount >= 5) labels[index] = bestLabel;
      }
      if (y % 4 === 0) await cooperate();
      onProgress((pass + y / height) / 2);
    }
    original.set(labels);
  }
}

async function mergeSpecksAsync(labels: Int16Array, width: number, height: number, minArea: number, cooperate: () => Promise<void>, onProgress: (fraction: number) => void): Promise<void> {
  const count = width * height;
  const seen = new Uint8Array(count);
  const queue = new Int32Array(count);
  for (let start = 0; start < count; start += 1) {
    if (seen[start] === 1) continue;
    const label = labels[start] ?? -1;
    if (label < 0) {
      seen[start] = 1;
      continue;
    }
    let head = 0;
    let tail = 0;
    queue[tail] = start;
    tail += 1;
    seen[start] = 1;
    let minX = start % width;
    let maxX = minX;
    let minY = Math.floor(start / width);
    let maxY = minY;
    while (head < tail) {
      const index = queue[head] ?? 0;
      head += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const neighbors = [index - 1, index + 1, index - width, index + width];
      for (const next of neighbors) {
        if (next < 0 || next >= count || seen[next] === 1) continue;
        const nx = next % width;
        if (Math.abs(nx - x) > 1 || (labels[next] ?? -1) !== label) continue;
        seen[next] = 1;
        queue[tail] = next;
        tail += 1;
      }
      if (head % 4096 === 0) await cooperate();
    }
    const area = tail;
    const spanX = maxX - minX + 1;
    const spanY = maxY - minY + 1;
    const thin = Math.max(spanX, spanY) >= 8 && Math.min(spanX, spanY) <= 2 && area >= 6;
    if (area < minArea && !thin) {
      const around = new Map<number, number>();
      for (let cursor = 0; cursor < tail; cursor += 1) {
        const index = queue[cursor] ?? 0;
        const x = index % width;
        const y = Math.floor(index / width);
        const neighbors = [index - 1, index + 1, index - width, index + width];
        for (const next of neighbors) {
          if (next < 0 || next >= count) continue;
          const nx = next % width;
          const ny = Math.floor(next / width);
          if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
          const other = labels[next] ?? -1;
          if (other >= 0 && other !== label) around.set(other, (around.get(other) ?? 0) + 1);
        }
        if (cursor % 4096 === 0) await cooperate();
      }
      let replacement = label;
      let votes = 0;
      for (const [other, vote] of around) {
        if (vote > votes) {
          votes = vote;
          replacement = other;
        }
      }
      if (replacement !== label) {
        for (let cursor = 0; cursor < tail; cursor += 1) {
          labels[queue[cursor] ?? 0] = replacement;
          if (cursor % 4096 === 0) await cooperate();
        }
      }
    }
    if (start % 4096 === 0) {
      onProgress(start / count);
      await cooperate();
    }
  }
  onProgress(1);
}

async function paintLabelsAsync(labels: Int16Array, palette: readonly RGB[], alpha: Uint8Array, cooperate: () => Promise<void>, onProgress: (fraction: number) => void): Promise<Uint8Array> {
  const next = new Uint8Array(alpha.length * 4);
  for (let index = 0; index < alpha.length; index += 1) {
    const offset = index * 4;
    if ((alpha[index] ?? 0) !== 0) {
      const color = palette[labels[index] ?? 0] ?? { r: 0, g: 0, b: 0 };
      next[offset] = color.r;
      next[offset + 1] = color.g;
      next[offset + 2] = color.b;
      next[offset + 3] = 255;
    }
    if (index % 16384 === 0) {
      onProgress(index / alpha.length);
      await cooperate();
    }
  }
  onProgress(1);
  return next;
}

export function segmentBackdropStage(
  rgba: Uint8Array,
  width: number,
  height: number,
  colors: SegmentColorStage,
  removeBackground: boolean,
  spreadLimit: number,
  onProgress?: (fraction: number) => void
): SegmentBackdropStage {
  onProgress?.(0);
  if (colors.palette.length === 0) {
    onProgress?.(1);
    return { backdrop: colors.colors.slice(), punchInput: rgba.slice() };
  }
  const alpha = colors.opaque.slice();
  const punchAlpha = new Uint8Array(width * height);
  for (let index = 0; index < punchAlpha.length; index += 1) {
    if ((colors.punchLabels[index] ?? -1) >= 0) punchAlpha[index] = rgba[index * 4 + 3] ?? 0;
    if (index % Math.max(1, width * 4) === 0) onProgress?.((index / punchAlpha.length) * 0.25);
  }
  const cleared = removeBackground ? flatBackdropMask(rgba, colors.labels, width, height, colors.palette, spreadLimit) : null;
  if (cleared !== null) {
    for (let index = 0; index < cleared.length; index += 1) {
      if (cleared[index] !== 0) {
        alpha[index] = 0;
        punchAlpha[index] = 0;
      }
      if (index % Math.max(1, width * 4) === 0) onProgress?.(0.25 + (index / cleared.length) * 0.35);
    }
  }
  return {
    backdrop: paintLabels(colors.labels, colors.palette, alpha, (fraction) => onProgress?.(0.6 + fraction * 0.2)),
    punchInput: paintLabelsWithAlpha(colors.punchLabels, colors.palette, punchAlpha, (fraction) => onProgress?.(0.8 + fraction * 0.2))
  };
}

export async function segmentBackdropStageAsync(
  rgba: Uint8Array,
  width: number,
  height: number,
  colors: SegmentColorStage,
  removeBackground: boolean,
  spreadLimit: number,
  onProgress?: (fraction: number) => void,
  shouldCancel?: () => boolean
): Promise<SegmentBackdropStage> {
  if (shouldCancel?.() === true) throw new Error("ยกเลิกแล้ว");
  let lastYield = Date.now();
  const cooperate = async (): Promise<void> => {
    if (Date.now() - lastYield < 20) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    lastYield = Date.now();
    if (shouldCancel?.() === true) throw new Error("ยกเลิกแล้ว");
  };
  onProgress?.(0);
  if (colors.palette.length === 0) {
    onProgress?.(1);
    return { backdrop: colors.colors.slice(), punchInput: rgba.slice() };
  }
  const alpha = colors.opaque.slice();
  const punchAlpha = new Uint8Array(width * height);
  for (let index = 0; index < punchAlpha.length; index += 1) {
    if ((colors.punchLabels[index] ?? -1) >= 0) punchAlpha[index] = rgba[index * 4 + 3] ?? 0;
    if (index % 8192 === 0) {
      onProgress?.(0.2 * index / punchAlpha.length);
      await cooperate();
    }
  }
  const cleared = removeBackground ? await flatBackdropMaskAsync(rgba, colors.labels, width, height, colors.palette, spreadLimit, cooperate) : null;
  if (cleared !== null) {
    for (let index = 0; index < cleared.length; index += 1) {
      if (cleared[index] !== 0) {
        alpha[index] = 0;
        punchAlpha[index] = 0;
      }
      if (index % 8192 === 0) {
        onProgress?.(0.2 + 0.3 * index / cleared.length);
        await cooperate();
      }
    }
  }
  const backdrop = await paintLabelsAsync(colors.labels, colors.palette, alpha, cooperate, (fraction) => onProgress?.(0.5 + fraction * 0.25));
  const punchInput = await paintLabelsWithAlphaAsync(colors.punchLabels, colors.palette, punchAlpha, cooperate, (fraction) => onProgress?.(0.75 + fraction * 0.25));
  onProgress?.(1);
  return { backdrop, punchInput };
}

async function flatBackdropMaskAsync(
  rgba: Uint8Array,
  labels: Int16Array,
  width: number,
  height: number,
  palette: readonly RGB[],
  spreadLimit: number,
  cooperate: () => Promise<void>
): Promise<Uint8Array | null> {
  const measured = borderMeasure(rgba, width, height);
  if (measured === null || measured.spread > spreadLimit) return null;
  const mean = measured.mean;
  const backdrop = nearest(mean, palette);
  const count = width * height;
  const queue = new Int32Array(count);
  const seen = new Uint8Array(count);
  let tail = 0;
  const push = (index: number): void => {
    if (index < 0 || index >= count || seen[index] === 1) return;
    if ((labels[index] ?? -1) !== backdrop && distance2(pixelAt(rgba, index), mean) > 26 * 26) return;
    seen[index] = 1;
    queue[tail] = index;
    tail += 1;
  };
  for (let x = 0; x < width; x += 1) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    push(y * width + width - 1);
  }
  let head = 0;
  while (head < tail) {
    const index = queue[head] ?? 0;
    head += 1;
    const x = index % width;
    const neighbors = [index - 1, index + 1, index - width, index + width];
    for (const next of neighbors) {
      if (next < 0 || next >= count || seen[next] === 1) continue;
      const nx = next % width;
      if (Math.abs(nx - x) > 1) continue;
      push(next);
    }
    if (head % 4096 === 0) await cooperate();
  }
  const fraction = tail / count;
  if (fraction < 0.08 || fraction > 0.92) return null;
  const cleared = new Uint8Array(count);
  for (let index = 0; index < tail; index += 1) {
    cleared[queue[index] ?? 0] = 1;
    if (index % 8192 === 0) await cooperate();
  }
  return cleared;
}

async function paintLabelsWithAlphaAsync(labels: Int16Array, palette: readonly RGB[], alpha: Uint8Array, cooperate: () => Promise<void>, onProgress: (fraction: number) => void): Promise<Uint8Array> {
  const next = new Uint8Array(alpha.length * 4);
  for (let index = 0; index < alpha.length; index += 1) {
    const offset = index * 4;
    const opacity = alpha[index] ?? 0;
    if (opacity !== 0) {
      const color = palette[labels[index] ?? 0] ?? { r: 0, g: 0, b: 0 };
      next[offset] = color.r;
      next[offset + 1] = color.g;
      next[offset + 2] = color.b;
      next[offset + 3] = opacity;
    }
    if (index % 8192 === 0) {
      onProgress(index / alpha.length);
      await cooperate();
    }
  }
  onProgress(1);
  return next;
}

export function borderSpread(rgba: Uint8Array, width: number, height: number): number {
  return borderMeasure(rgba, width, height)?.spread ?? 0;
}

function paintLabels(labels: Int16Array, palette: readonly RGB[], alpha: Uint8Array, onProgress?: (fraction: number) => void): Uint8Array {
  const next = new Uint8Array(alpha.length * 4);
  for (let index = 0; index < alpha.length; index += 1) {
    const offset = index * 4;
    if ((alpha[index] ?? 0) === 0) continue;
    const color = palette[labels[index] ?? 0] ?? { r: 0, g: 0, b: 0 };
    next[offset] = color.r;
    next[offset + 1] = color.g;
    next[offset + 2] = color.b;
    next[offset + 3] = 255;
    if (index % 16384 === 0) onProgress?.(index / alpha.length);
  }
  onProgress?.(1);
  return next;
}

function paintLabelsWithAlpha(labels: Int16Array, palette: readonly RGB[], alpha: Uint8Array, onProgress?: (fraction: number) => void): Uint8Array {
  const next = new Uint8Array(alpha.length * 4);
  for (let index = 0; index < alpha.length; index += 1) {
    const offset = index * 4;
    const opacity = alpha[index] ?? 0;
    if (opacity === 0) continue;
    const color = palette[labels[index] ?? 0] ?? { r: 0, g: 0, b: 0 };
    next[offset] = color.r;
    next[offset + 1] = color.g;
    next[offset + 2] = color.b;
    next[offset + 3] = opacity;
    if (index % 16384 === 0) onProgress?.(index / alpha.length);
  }
  onProgress?.(1);
  return next;
}

function colorCap(options: SegmentOptions): number {
  const requested = options.maxColors > 0 ? options.maxColors : MODE_CAP[options.mode];
  return Math.min(32, Math.max(2, requested));
}

function collectSamples(rgba: Uint8Array, width: number, height: number, cutoff: number, onProgress?: (fraction: number) => void): RGB[] {
  const target = 8000;
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / target)));
  const samples: RGB[] = [];
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const offset = (y * width + x) * 4;
      if ((rgba[offset + 3] ?? 0) < cutoff) continue;
      samples.push({ r: rgba[offset] ?? 0, g: rgba[offset + 1] ?? 0, b: rgba[offset + 2] ?? 0 });
    }
    onProgress?.(y / height);
  }
  return samples.length > 0 ? samples : [{ r: 0, g: 0, b: 0 }];
}

function cluster(samples: readonly RGB[], cap: number, onProgress?: (fraction: number) => void): RGB[] {
  const centroids = seedCentroids(samples, cap);
  for (let round = 0; round < 8; round += 1) {
    const sums = centroids.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));
    for (const sample of samples) {
      const index = nearest(sample, centroids);
      const bin = sums[index];
      if (bin === undefined) continue;
      bin.r += sample.r;
      bin.g += sample.g;
      bin.b += sample.b;
      bin.n += 1;
    }
    for (let index = 0; index < centroids.length; index += 1) {
      const bin = sums[index];
      if (bin === undefined || bin.n === 0) continue;
      centroids[index] = { r: Math.round(bin.r / bin.n), g: Math.round(bin.g / bin.n), b: Math.round(bin.b / bin.n) };
    }
    onProgress?.((round + 1) / 8);
  }
  return centroids;
}

function seedCentroids(samples: readonly RGB[], cap: number): RGB[] {
  const first = samples[Math.floor(samples.length / 2)] ?? { r: 0, g: 0, b: 0 };
  const centroids: RGB[] = [{ ...first }];
  while (centroids.length < cap) {
    let best = 0;
    let chosen = first;
    for (const sample of samples) {
      const gap = distanceToPalette(sample, centroids);
      if (gap > best) {
        best = gap;
        chosen = sample;
      }
    }
    if (best < 16 * 16) break;
    centroids.push({ ...chosen });
  }
  return centroids;
}

function foldBlends(centroids: readonly RGB[], areas: Uint32Array): RGB[] {
  const map = centroids.map((_, index) => index);
  for (let index = 0; index < centroids.length; index += 1) {
    const color = centroids[index];
    if (color === undefined) continue;
    let host = -1;
    for (let left = 0; left < centroids.length; left += 1) {
      if (left === index) continue;
      for (let right = left + 1; right < centroids.length; right += 1) {
        if (right === index) continue;
        const a = centroids[left];
        const b = centroids[right];
        if (a === undefined || b === undefined || !onSegment(color, a, b)) continue;
        const fringe = areas[index] ?? 0;
        const parent = Math.min(areas[left] ?? 0, areas[right] ?? 0);
        if (fringe * 5 >= parent) continue;
        host = distance2(color, a) <= distance2(color, b) ? left : right;
      }
    }
    if (host >= 0) map[index] = host;
  }
  const kept: RGB[] = [];
  const remap = new Map<number, number>();
  for (let index = 0; index < centroids.length; index += 1) {
    let cursor = map[index] ?? index;
    const seen = new Set<number>();
    while ((map[cursor] ?? cursor) !== cursor && !seen.has(cursor)) {
      seen.add(cursor);
      cursor = map[cursor] ?? cursor;
    }
    const existing = remap.get(cursor);
    if (existing !== undefined) {
      remap.set(index, existing);
      continue;
    }
    const color = centroids[cursor];
    if (color === undefined) continue;
    remap.set(index, kept.length);
    remap.set(cursor, kept.length);
    kept.push(color);
  }
  return kept.length > 0 ? kept : centroids.slice();
}

function onSegment(color: RGB, a: RGB, b: RGB): boolean {
  const abx = b.r - a.r;
  const aby = b.g - a.g;
  const abz = b.b - a.b;
  const length = abx * abx + aby * aby + abz * abz;
  if (length < 80 * 80) return false;
  const t = ((color.r - a.r) * abx + (color.g - a.g) * aby + (color.b - a.b) * abz) / length;
  if (t < 0.18 || t > 0.82) return false;
  const projected = { r: a.r + t * abx, g: a.g + t * aby, b: a.b + t * abz };
  return distance2(color, projected) < 26 * 26 && distance2(color, a) > 18 * 18 && distance2(color, b) > 18 * 18;
}

function cleanupEdges(labels: Int16Array, width: number, height: number, onProgress?: (fraction: number) => void): void {
  const original = new Int16Array(labels);
  for (let pass = 0; pass < 2; pass += 1) {
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        if ((original[index] ?? -1) < 0 || isThin(original, width, index)) continue;
        const counts = new Map<number, number>();
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const label = original[index + dy * width + dx] ?? -1;
            if (label < 0) continue;
            counts.set(label, (counts.get(label) ?? 0) + 1);
          }
        }
        let bestLabel = original[index] ?? 0;
        let bestCount = 0;
        for (const [label, count] of counts) {
          if (count > bestCount) {
            bestCount = count;
            bestLabel = label;
          }
        }
        if (bestCount >= 5) labels[index] = bestLabel;
      }
      onProgress?.((pass + y / height) / 2);
    }
    original.set(labels);
  }
}

function isThin(labels: Int16Array, width: number, index: number): boolean {
  const label = labels[index] ?? 0;
  const left = (labels[index - 1] ?? -1) === label;
  const right = (labels[index + 1] ?? -1) === label;
  const up = (labels[index - width] ?? -1) === label;
  const down = (labels[index + width] ?? -1) === label;
  return (left && right && !up && !down) || (up && down && !left && !right);
}

function mergeSpecks(labels: Int16Array, width: number, height: number, minArea: number, onProgress?: (fraction: number) => void): void {
  const count = width * height;
  const seen = new Uint8Array(count);
  const queue = new Int32Array(count);
  for (let start = 0; start < count; start += 1) {
    if (start % Math.max(1, width * 8) === 0) onProgress?.(start / count);
    if (seen[start] === 1) continue;
    const label = labels[start] ?? -1;
    if (label < 0) {
      seen[start] = 1;
      continue;
    }
    let head = 0;
    let tail = 0;
    queue[tail] = start;
    tail += 1;
    seen[start] = 1;
    let minX = start % width;
    let maxX = minX;
    let minY = Math.floor(start / width);
    let maxY = minY;
    while (head < tail) {
      const index = queue[head] ?? 0;
      head += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const neighbors = [index - 1, index + 1, index - width, index + width];
      for (const next of neighbors) {
        if (next < 0 || next >= count || seen[next] === 1) continue;
        const nx = next % width;
        if (Math.abs(nx - x) > 1) continue;
        if ((labels[next] ?? -1) !== label) continue;
        seen[next] = 1;
        queue[tail] = next;
        tail += 1;
      }
    }
    if (start % 4096 === 0) onProgress?.(start / count);
    const area = tail;
    const spanX = maxX - minX + 1;
    const spanY = maxY - minY + 1;
    const thin = Math.max(spanX, spanY) >= 8 && Math.min(spanX, spanY) <= 2 && area >= 6;
    if (area >= minArea || thin) continue;
    const around = new Map<number, number>();
    for (let cursor = 0; cursor < tail; cursor += 1) {
      const index = queue[cursor] ?? 0;
      const x = index % width;
      const y = Math.floor(index / width);
      const neighbors = [index - 1, index + 1, index - width, index + width];
      for (const next of neighbors) {
        if (next < 0 || next >= count) continue;
        const nx = next % width;
        const ny = Math.floor(next / width);
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
        const other = labels[next] ?? -1;
        if (other < 0 || other === label) continue;
        around.set(other, (around.get(other) ?? 0) + 1);
      }
    }
    let replacement = label;
    let votes = 0;
    for (const [other, vote] of around) {
      if (vote > votes) {
        votes = vote;
        replacement = other;
      }
    }
    if (replacement === label) continue;
    for (let cursor = 0; cursor < tail; cursor += 1) labels[queue[cursor] ?? 0] = replacement;
  }
  onProgress?.(1);
}

function borderMeasure(rgba: Uint8Array, width: number, height: number): { readonly mean: RGB; readonly spread: number } | null {
  let red = 0;
  let green = 0;
  let blue = 0;
  let border = 0;
  const visit = (x: number, y: number): void => {
    const offset = (y * width + x) * 4;
    red += rgba[offset] ?? 0;
    green += rgba[offset + 1] ?? 0;
    blue += rgba[offset + 2] ?? 0;
    border += 1;
  };
  for (let x = 0; x < width; x += 1) {
    visit(x, 0);
    if (height > 1) visit(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    visit(0, y);
    if (width > 1) visit(width - 1, y);
  }
  if (border === 0) return null;
  const mean = { r: red / border, g: green / border, b: blue / border };
  let spread = 0;
  const revisit = (x: number, y: number): void => {
    spread += Math.sqrt(distance2(pixelAt(rgba, y * width + x), mean));
  };
  for (let x = 0; x < width; x += 1) {
    revisit(x, 0);
    if (height > 1) revisit(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    revisit(0, y);
    if (width > 1) revisit(width - 1, y);
  }
  return { mean, spread: spread / border };
}

function flatBackdropMask(rgba: Uint8Array, labels: Int16Array, width: number, height: number, palette: readonly RGB[], spreadLimit: number): Uint8Array | null {
  const measured = borderMeasure(rgba, width, height);
  if (measured === null || measured.spread > spreadLimit) return null;
  const mean = measured.mean;
  const backdrop = nearest(mean, palette);
  const count = width * height;
  const queue = new Int32Array(count);
  const seen = new Uint8Array(count);
  let tail = 0;
  const push = (index: number): void => {
    if (index < 0 || index >= count || seen[index] === 1) return;
    if ((labels[index] ?? -1) !== backdrop && distance2(pixelAt(rgba, index), mean) > 26 * 26) return;
    seen[index] = 1;
    queue[tail] = index;
    tail += 1;
  };
  for (let x = 0; x < width; x += 1) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    push(y * width + width - 1);
  }
  let head = 0;
  while (head < tail) {
    const index = queue[head] ?? 0;
    head += 1;
    const x = index % width;
    const neighbors = [index - 1, index + 1, index - width, index + width];
    for (const next of neighbors) {
      if (next < 0 || next >= count || seen[next] === 1) continue;
      const nx = next % width;
      if (Math.abs(nx - x) > 1) continue;
      push(next);
    }
  }
  const fraction = tail / count;
  if (fraction < 0.08 || fraction > 0.92) return null;
  const cleared = new Uint8Array(count);
  for (let index = 0; index < tail; index += 1) cleared[queue[index] ?? 0] = 1;
  return cleared;
}

function pixelAt(rgba: Uint8Array, index: number): RGB {
  const offset = index * 4;
  return { r: rgba[offset] ?? 0, g: rgba[offset + 1] ?? 0, b: rgba[offset + 2] ?? 0 };
}

function nearest(color: RGB, palette: readonly RGB[]): number {
  let best = 0;
  let score = Infinity;
  for (let index = 0; index < palette.length; index += 1) {
    const entry = palette[index];
    if (entry === undefined) continue;
    const gap = distance2(color, entry);
    if (gap < score) {
      score = gap;
      best = index;
    }
  }
  return best;
}

function distanceToPalette(color: RGB, palette: readonly RGB[]): number {
  let best = Infinity;
  for (const entry of palette) best = Math.min(best, distance2(color, entry));
  return best;
}

function distance2(a: RGB, b: RGB): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}
