import { TRANSPARENT, rgbHex, type Rgb, type Segmentation } from "./model";

type CountedColor = { r: number; g: number; b: number; n: number };

/**
 * Previous RGB median-cut segmenter, kept only so the fixture report can
 * compare the rebuilt pipeline with the one that shipped before it.
 * The panel does not import this file.
 */
export function legacySegmentImage(rgba: Uint8Array, width: number, height: number, maxColors: number): Segmentation {
  if (rgba.length < width * height * 4) throw new Error("ข้อมูลภาพสั้นกว่าขนาดที่ระบุ");
  const colors = Math.max(1, Math.floor(maxColors));
  const labels = new Uint16Array(width * height);
  labels.fill(TRANSPARENT);
  const histogram = new Map<number, number>();
  for (let i = 0; i < width * height; i++) {
    const offset = i * 4;
    const alpha = rgba[offset + 3] ?? 0;
    if (alpha < 128) continue;
    const key = ((rgba[offset] ?? 0) << 16) | ((rgba[offset + 1] ?? 0) << 8) | (rgba[offset + 2] ?? 0);
    histogram.set(key, (histogram.get(key) ?? 0) + 1);
  }
  const unique: CountedColor[] = [];
  for (const [key, n] of histogram) {
    unique.push({ r: (key >> 16) & 255, g: (key >> 8) & 255, b: key & 255, n });
  }
  if (unique.length === 0) return { width, height, labels, palette: [] };

  const palette = unique.length <= colors ? exactPalette(unique) : medianCutPalette(unique, colors);
  for (let i = 0; i < width * height; i++) {
    const offset = i * 4;
    if ((rgba[offset + 3] ?? 0) < 128) continue;
    labels[i] = nearest(palette, rgba[offset] ?? 0, rgba[offset + 1] ?? 0, rgba[offset + 2] ?? 0);
  }
  return compactSegmentation({ width, height, labels, palette });
}

export function renderRgba(segmentation: Segmentation): Uint8Array {
  const rgba = new Uint8Array(segmentation.width * segmentation.height * 4);
  for (let i = 0; i < segmentation.labels.length; i++) {
    const label = segmentation.labels[i] ?? TRANSPARENT;
    if (label === TRANSPARENT) continue;
    const color = segmentation.palette[label];
    if (!color) continue;
    const offset = i * 4;
    rgba[offset] = color.r;
    rgba[offset + 1] = color.g;
    rgba[offset + 2] = color.b;
    rgba[offset + 3] = 255;
  }
  return rgba;
}

/** Pixel-aligned SVG of the label map, one flat fill per palette color. This is the pre-smoothing picture. */
export function segmentationToSvg(segmentation: Segmentation): string {
  const groups = new Map<number, string[]>();
  for (let y = 0; y < segmentation.height; y++) {
    let x = 0;
    while (x < segmentation.width) {
      const label = segmentation.labels[y * segmentation.width + x] ?? TRANSPARENT;
      let end = x + 1;
      while (end < segmentation.width && (segmentation.labels[y * segmentation.width + end] ?? TRANSPARENT) === label) end++;
      if (label !== TRANSPARENT && segmentation.palette[label]) {
        const list = groups.get(label) ?? [];
        list.push('<rect x="' + x + '" y="' + y + '" width="' + (end - x) + '" height="1"/>');
        groups.set(label, list);
      }
      x = end;
    }
  }
  const body: string[] = [];
  for (const [label, rects] of groups) {
    const color = segmentation.palette[label];
    if (!color || rects.length === 0) continue;
    body.push('<g fill="' + rgbHex(color) + '">' + rects.join("") + "</g>");
  }
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
    segmentation.width +
    " " +
    segmentation.height +
    '" width="' +
    segmentation.width +
    '" height="' +
    segmentation.height +
    '" shape-rendering="crispEdges">' +
    body.join("") +
    "</svg>"
  );
}

export function countSvgFills(svg: string): number {
  const found = new Set<string>();
  const pattern = /fill="(#[0-9a-fA-F]{6})"/g;
  let match = pattern.exec(svg);
  while (match) {
    if (match[1]) found.add(match[1].toLowerCase());
    match = pattern.exec(svg);
  }
  return found.size;
}

function exactPalette(unique: readonly CountedColor[]): Rgb[] {
  return [...unique]
    .sort((a, b) => b.n - a.n || a.r - b.r || a.g - b.g || a.b - b.b)
    .map((color) => ({ r: color.r, g: color.g, b: color.b }));
}

function medianCutPalette(unique: CountedColor[], maxColors: number): Rgb[] {
  let buckets: CountedColor[][] = [unique.slice()];
  while (buckets.length < maxColors) {
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < buckets.length; i++) {
      const bucket = buckets[i];
      if (!bucket || bucket.length < 2) continue;
      const score = bucketScore(bucket);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0 || bestScore < 1) break;
    const bucket = buckets[best];
    if (!bucket) break;
    const channel = dominantChannel(bucket);
    bucket.sort((a, b) => channelValue(a, channel) - channelValue(b, channel));
    let total = 0;
    for (const color of bucket) total += color.n;
    let accumulated = 0;
    let split = 1;
    for (let i = 0; i < bucket.length; i++) {
      accumulated += bucket[i]?.n ?? 0;
      if (accumulated >= total / 2) {
        split = Math.min(bucket.length - 1, Math.max(1, i));
        break;
      }
    }
    buckets.splice(best, 1, bucket.slice(0, split), bucket.slice(split));
  }
  return buckets.map((bucket) => average(bucket));
}

function bucketScore(bucket: readonly CountedColor[]): number {
  let total = 0;
  for (const color of bucket) total += color.n;
  return channelSpan(bucket) * total;
}

function channelSpan(bucket: readonly CountedColor[]): number {
  let best = 0;
  for (const channel of [0, 1, 2] as const) {
    let min = 255;
    let max = 0;
    for (const color of bucket) {
      const value = channelValue(color, channel);
      if (value < min) min = value;
      if (value > max) max = value;
    }
    if (max - min > best) best = max - min;
  }
  return best;
}

function dominantChannel(bucket: readonly CountedColor[]): 0 | 1 | 2 {
  let best: 0 | 1 | 2 = 0;
  let bestSpan = -1;
  for (const channel of [0, 1, 2] as const) {
    let min = 255;
    let max = 0;
    for (const color of bucket) {
      const value = channelValue(color, channel);
      if (value < min) min = value;
      if (value > max) max = value;
    }
    if (max - min > bestSpan) {
      bestSpan = max - min;
      best = channel;
    }
  }
  return best;
}

function channelValue(color: CountedColor, channel: 0 | 1 | 2): number {
  if (channel === 0) return color.r;
  if (channel === 1) return color.g;
  return color.b;
}

function average(bucket: readonly CountedColor[]): Rgb {
  let n = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (const color of bucket) {
    n += color.n;
    r += color.r * color.n;
    g += color.g * color.n;
    b += color.b * color.n;
  }
  if (n === 0) return { r: 0, g: 0, b: 0 };
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

function nearest(palette: readonly Rgb[], r: number, g: number, b: number): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < palette.length; i++) {
    const color = palette[i];
    if (!color) continue;
    const dr = color.r - r;
    const dg = color.g - g;
    const db = color.b - b;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

function compactSegmentation(segmentation: Segmentation): Segmentation {
  const used = new Array<boolean>(segmentation.palette.length).fill(false);
  for (let i = 0; i < segmentation.labels.length; i++) {
    const label = segmentation.labels[i] ?? TRANSPARENT;
    if (label !== TRANSPARENT && label < used.length) used[label] = true;
  }
  if (used.every((value) => value)) return segmentation;
  const map = new Array<number>(segmentation.palette.length).fill(-1);
  const palette: Rgb[] = [];
  for (let i = 0; i < segmentation.palette.length; i++) {
    if (!used[i]) continue;
    map[i] = palette.length;
    const color = segmentation.palette[i];
    if (color) palette.push(color);
  }
  const labels = new Uint16Array(segmentation.labels.length);
  for (let i = 0; i < segmentation.labels.length; i++) {
    const label = segmentation.labels[i] ?? TRANSPARENT;
    labels[i] = label === TRANSPARENT ? TRANSPARENT : (map[label] ?? TRANSPARENT);
  }
  return { width: segmentation.width, height: segmentation.height, labels, palette };
}
