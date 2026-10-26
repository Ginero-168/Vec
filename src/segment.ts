import type { TracePreset } from "./trace";

export type SegmentOptions = {
  readonly mode: TracePreset;
  readonly maxColors: number;
  readonly removeBackground: boolean;
};

type RGB = { r: number; g: number; b: number };

const MODE_CAP: Readonly<Record<TracePreset, number>> = { logo: 8, icon: 8, photo: 32, poster: 10 };
const SPECK_AREA: Readonly<Record<TracePreset, number>> = { logo: 18, icon: 12, photo: 6, poster: 28 };

export function segmentRaster(rgba: Uint8Array, width: number, height: number, options: SegmentOptions): Uint8Array {
  const count = width * height;
  if (width < 2 || height < 2 || rgba.length < count * 4) return rgba.slice();
  const source = options.mode === "poster" ? grayscale(rgba, count) : rgba;
  const samples = collectSamples(source, width, height);
  const centroids = cluster(samples, colorCap(options));
  const snapBlends = options.mode === "logo" || options.mode === "icon";
  const palette = snapBlends ? foldBlends(centroids) : centroids;
  const labels = new Int16Array(count);
  for (let index = 0; index < count; index += 1) {
    labels[index] = nearest(pixelAt(source, index), palette);
  }
  cleanupEdges(labels, width, height);
  mergeSpecks(labels, width, height, SPECK_AREA[options.mode]);
  const alpha = new Uint8Array(count);
  alpha.fill(255);
  if (options.removeBackground) clearFlatBackdrop(source, labels, width, height, palette, alpha);
  const next = new Uint8Array(count * 4);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    if ((alpha[index] ?? 0) === 0) continue;
    const color = palette[labels[index] ?? 0] ?? { r: 0, g: 0, b: 0 };
    next[offset] = color.r;
    next[offset + 1] = color.g;
    next[offset + 2] = color.b;
    next[offset + 3] = 255;
  }
  return next;
}

function colorCap(options: SegmentOptions): number {
  const requested = options.maxColors > 0 ? options.maxColors : MODE_CAP[options.mode];
  return Math.min(32, Math.max(2, requested));
}

function grayscale(rgba: Uint8Array, count: number): Uint8Array {
  const next = new Uint8Array(rgba.length);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    const y = Math.round(0.2126 * (rgba[offset] ?? 0) + 0.7152 * (rgba[offset + 1] ?? 0) + 0.0722 * (rgba[offset + 2] ?? 0));
    next[offset] = y;
    next[offset + 1] = y;
    next[offset + 2] = y;
    next[offset + 3] = rgba[offset + 3] ?? 255;
  }
  return next;
}

function collectSamples(rgba: Uint8Array, width: number, height: number): RGB[] {
  const target = 8000;
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / target)));
  const samples: RGB[] = [];
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const offset = (y * width + x) * 4;
      if ((rgba[offset + 3] ?? 0) < 128) continue;
      samples.push({ r: rgba[offset] ?? 0, g: rgba[offset + 1] ?? 0, b: rgba[offset + 2] ?? 0 });
    }
  }
  return samples.length > 0 ? samples : [{ r: 0, g: 0, b: 0 }];
}

function cluster(samples: readonly RGB[], cap: number): RGB[] {
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

function foldBlends(centroids: readonly RGB[]): RGB[] {
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

function cleanupEdges(labels: Int16Array, width: number, height: number): void {
  const original = new Int16Array(labels);
  for (let pass = 0; pass < 2; pass += 1) {
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        if (isThin(original, width, index)) continue;
        const counts = new Map<number, number>();
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const label = original[index + dy * width + dx] ?? 0;
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

function mergeSpecks(labels: Int16Array, width: number, height: number, minArea: number): void {
  const count = width * height;
  const seen = new Uint8Array(count);
  const queue = new Int32Array(count);
  for (let start = 0; start < count; start += 1) {
    if (seen[start] === 1) continue;
    const label = labels[start] ?? 0;
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
        const other = labels[next] ?? label;
        if (other === label) continue;
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
}

function clearFlatBackdrop(rgba: Uint8Array, labels: Int16Array, width: number, height: number, palette: readonly RGB[], alpha: Uint8Array): void {
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
  if (border === 0) return;
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
  if (spread / border > 22) return;
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
  if (fraction < 0.08 || fraction > 0.92) return;
  for (let index = 0; index < tail; index += 1) alpha[queue[index] ?? 0] = 0;
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
