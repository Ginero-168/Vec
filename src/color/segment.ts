import { TRANSPARENT, rgbHex, type Rgb, type Segmentation } from "./model";
import { oklabChroma, oklabDistance, oklabToRgb, rgbToOklab, type Lab } from "./oklab";
import { PRESETS, type PresetName } from "./presets";

export type SegmentOptions = {
  readonly preset?: PresetName;
  readonly sensitivity?: number;
  readonly smoothContrast?: number;
};

type Bin = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly n: number;
  readonly lab: Lab;
  readonly key: number;
};

const BIN_SHIFT = 3;
const BIN_COUNT = 32 * 32 * 32;

/**
 * Palette in OKLab, then a label map the color editor can paint.
 * Flat images with few colors are kept exactly. Photographs and screenshots
 * get a weighted palette whose swatch is the median of interior pixels, so
 * anti-aliased edges do not pull orange toward tan. Blend pixels keep a
 * coverage value the tracer uses to place the boundary between pixels.
 */
export function segmentImage(
  rgba: Uint8Array,
  width: number,
  height: number,
  maxColors: number,
  options: SegmentOptions = {}
): Segmentation {
  if (rgba.length < width * height * 4) throw new Error("ข้อมูลภาพสั้นกว่าขนาดที่ระบุ");
  const colors = Math.max(1, Math.floor(maxColors));
  const profile = options.preset ? PRESETS[options.preset] : PRESETS.logo;
  const sensitivity = options.sensitivity ?? profile.sensitivity;
  const smoothContrast = options.smoothContrast ?? profile.smoothContrast;
  const pixelCount = width * height;
  const labels = new Uint16Array(pixelCount);
  labels.fill(TRANSPARENT);

  const histogram = new Map<number, number>();
  let opaque = 0;
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4;
    if ((rgba[offset + 3] ?? 0) < 128) continue;
    opaque++;
    const key = ((rgba[offset] ?? 0) << 16) | ((rgba[offset + 1] ?? 0) << 8) | (rgba[offset + 2] ?? 0);
    histogram.set(key, (histogram.get(key) ?? 0) + 1);
  }
  if (opaque === 0) return { width, height, labels, palette: [] };

  if (histogram.size <= colors) {
    const palette = exactPalette(histogram);
    const lookup = new Map<number, number>();
    palette.forEach((color, index) => lookup.set((color.r << 16) | (color.g << 8) | color.b, index));
    for (let i = 0; i < pixelCount; i++) {
      const offset = i * 4;
      if ((rgba[offset + 3] ?? 0) < 128) continue;
      const key = ((rgba[offset] ?? 0) << 16) | ((rgba[offset + 1] ?? 0) << 8) | (rgba[offset + 2] ?? 0);
      labels[i] = lookup.get(key) ?? 0;
    }
    return { width, height, labels, palette };
  }

  const bins = buildBins(rgba, pixelCount);
  const seeded = seedCentroids(bins, colors);
  const centroids = kMeans(bins, seeded.labs);
  ensureProtected(centroids, seeded.protectedLabs);
  const paletteLabs = centroids.map((lab) => ({ ...lab }));
  assignPixels(rgba, labels, pixelCount, paletteLabs);

  const coverage = new Float32Array(pixelCount);
  coverage.fill(1);
  const partner = new Uint16Array(pixelCount);
  partner.fill(TRANSPARENT);
  const blend = new Uint8Array(pixelCount);
  reassignBlends(rgba, labels, width, height, paletteLabs, coverage, partner, blend);
  writeRobustPalette(rgba, labels, width, height, paletteLabs, blend);

  mergeClusters(labels, partner, coverage, paletteLabs, sensitivity, smoothContrast, colors);
  detachNeutrals(rgba, labels, partner, coverage, paletteLabs);
  smoothLowContrast(labels, partner, coverage, width, height, paletteLabs, smoothContrast);
  removeWeakSpeckles(labels, partner, coverage, width, height, paletteLabs);
  absorbDarkBlobs(rgba, labels, partner, coverage, width, height, paletteLabs);
  dissolveSlivers(rgba, labels, partner, coverage, width, height, paletteLabs);
  peelPaleEdges(rgba, labels, partner, coverage, width, height, paletteLabs);
  liftNearWhite(rgba, labels, partner, coverage, width, height, paletteLabs);
  settleEdges(rgba, labels, partner, coverage, width, height, paletteLabs);
  const compacted = compactAll(labels, partner, paletteLabs);
  return {
    width,
    height,
    labels: compacted.labels,
    palette: compacted.palette,
    coverage,
    partner: compacted.partner
  };
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

/** Pixel-aligned SVG of the label map, one flat fill per palette color. */
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
  const gradients = /fill="url\(#([^"]+)\)"/g;
  let gradient = gradients.exec(svg);
  while (gradient) {
    if (gradient[1]) found.add("url(" + gradient[1] + ")");
    gradient = gradients.exec(svg);
  }
  return found.size;
}

function exactPalette(histogram: Map<number, number>): Rgb[] {
  const unique: { r: number; g: number; b: number; n: number }[] = [];
  for (const [key, n] of histogram) unique.push({ r: (key >> 16) & 255, g: (key >> 8) & 255, b: key & 255, n });
  unique.sort((a, b) => b.n - a.n || a.r - b.r || a.g - b.g || a.b - b.b);
  return unique.map((color) => ({ r: color.r, g: color.g, b: color.b }));
}

function buildBins(rgba: Uint8Array, pixelCount: number): Bin[] {
  const count = new Int32Array(BIN_COUNT);
  const sumR = new Float64Array(BIN_COUNT);
  const sumG = new Float64Array(BIN_COUNT);
  const sumB = new Float64Array(BIN_COUNT);
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4;
    if ((rgba[offset + 3] ?? 0) < 128) continue;
    const r = rgba[offset] ?? 0;
    const g = rgba[offset + 1] ?? 0;
    const b = rgba[offset + 2] ?? 0;
    const key = ((r >> BIN_SHIFT) << 10) | ((g >> BIN_SHIFT) << 5) | (b >> BIN_SHIFT);
    count[key] = (count[key] ?? 0) + 1;
    sumR[key] = (sumR[key] ?? 0) + r;
    sumG[key] = (sumG[key] ?? 0) + g;
    sumB[key] = (sumB[key] ?? 0) + b;
  }
  const bins: Bin[] = [];
  for (let key = 0; key < BIN_COUNT; key++) {
    const n = count[key] ?? 0;
    if (n === 0) continue;
    const r = Math.round((sumR[key] ?? 0) / n);
    const g = Math.round((sumG[key] ?? 0) / n);
    const b = Math.round((sumB[key] ?? 0) / n);
    bins.push({ r, g, b, n, lab: rgbToOklab(r, g, b), key });
  }
  return bins;
}

function seedCentroids(bins: Bin[], maxColors: number): { labs: Lab[]; protectedLabs: Lab[] } {
  const seeds: Lab[] = [];
  const protectedLabs: Lab[] = [];
  const remember = (lab: Lab, protect: boolean) => {
    if (seeds.length >= maxColors) return;
    if (seeds.some((seed) => oklabDistance(seed, lab) < 0.045)) return;
    seeds.push(lab);
    if (protect) protectedLabs.push(lab);
  };

  const chromaBins = bins
    .filter((bin) => oklabChroma(bin.lab) > 0.08 && bin.n >= 6)
    .sort((a, b) => b.n * oklabChroma(b.lab) - a.n * oklabChroma(a.lab));
  const chromaBudget = Math.max(1, Math.floor(maxColors / 2));
  for (const bin of chromaBins) {
    if (seeds.length >= chromaBudget) break;
    if (seeds.every((seed) => oklabDistance(seed, bin.lab) > 0.07)) {
      seeds.push(bin.lab);
      protectedLabs.push(bin.lab);
    }
  }

  const populous = bins.filter((bin) => bin.n >= 24).sort((a, b) => a.lab.l - b.lab.l);
  const darkest = populous[0];
  const lightest = populous[populous.length - 1];
  if (darkest) remember(darkest.lab, darkest.lab.l < 0.35);
  if (lightest) remember(lightest.lab, lightest.lab.l > 0.9);

  const opaque = bins.reduce((sum, bin) => sum + bin.n, 0);
  const largeNeutral = Math.max(64, opaque * 0.005);
  const neutrals = bins
    .filter((bin) => oklabChroma(bin.lab) < 0.035 && bin.n >= largeNeutral)
    .sort((a, b) => b.n - a.n);
  for (const bin of neutrals) {
    if (seeds.length >= maxColors) break;
    const distinct = seeds.every((seed) => oklabChroma(seed) >= 0.05 || Math.abs(seed.l - bin.lab.l) > 0.07);
    if (!distinct) continue;
    seeds.push(bin.lab);
    protectedLabs.push(bin.lab);
  }

  const minorities = bins.filter((bin) => bin.n >= 4).sort((a, b) => b.n - a.n);
  for (const bin of minorities) {
    if (seeds.length >= maxColors) break;
    const isolated = seeds.every((seed) => oklabDistance(seed, bin.lab) > 0.12);
    const vivid = oklabChroma(bin.lab) > 0.08 || bin.lab.l > 0.93;
    if (isolated && vivid) {
      seeds.push(bin.lab);
      protectedLabs.push(bin.lab);
    }
  }

  while (seeds.length < maxColors) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < bins.length; i++) {
      const bin = bins[i];
      if (!bin) continue;
      let nearest = Infinity;
      for (const seed of seeds) nearest = Math.min(nearest, oklabDistance(seed, bin.lab));
      const score = nearest * nearest * bin.n;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    const chosen = bins[best];
    if (!chosen || bestScore < 1e-8) break;
    seeds.push(chosen.lab);
  }
  if (seeds.length === 0 && bins[0]) seeds.push(bins[0].lab);
  return { labs: seeds, protectedLabs };
}

function kMeans(bins: Bin[], seeds: Lab[]): Lab[] {
  const centroids = seeds.map((lab) => ({ l: lab.l, a: lab.a, b: lab.b }));
  const assign = new Int32Array(bins.length);
  assign.fill(-1);
  for (let iter = 0; iter < 8; iter++) {
    let moved = false;
    for (let i = 0; i < bins.length; i++) {
      const bin = bins[i];
      if (!bin) continue;
      const next = nearestLab(centroids, bin.lab);
      if (assign[i] !== next) moved = true;
      assign[i] = next;
    }
    const sumL = new Float64Array(centroids.length);
    const sumA = new Float64Array(centroids.length);
    const sumB = new Float64Array(centroids.length);
    const sumN = new Float64Array(centroids.length);
    for (let i = 0; i < bins.length; i++) {
      const bin = bins[i];
      if (!bin) continue;
      const group = assign[i] ?? 0;
      sumL[group] = (sumL[group] ?? 0) + bin.lab.l * bin.n;
      sumA[group] = (sumA[group] ?? 0) + bin.lab.a * bin.n;
      sumB[group] = (sumB[group] ?? 0) + bin.lab.b * bin.n;
      sumN[group] = (sumN[group] ?? 0) + bin.n;
    }
    for (let group = 0; group < centroids.length; group++) {
      const n = sumN[group] ?? 0;
      if (n <= 0) continue;
      centroids[group] = {
        l: (sumL[group] ?? 0) / n,
        a: (sumA[group] ?? 0) / n,
        b: (sumB[group] ?? 0) / n
      };
    }
    if (!moved && iter > 0) break;
  }
  return centroids;
}

function ensureProtected(centroids: Lab[], protectedLabs: readonly Lab[]): void {
  for (const lab of protectedLabs) {
    if (centroids.some((centroid) => oklabDistance(centroid, lab) < 0.08)) continue;
    centroids.push(lab);
  }
}

function assignPixels(rgba: Uint8Array, labels: Uint16Array, pixelCount: number, centroids: readonly Lab[]): void {
  const binLabel = new Int16Array(BIN_COUNT);
  binLabel.fill(-1);
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4;
    if ((rgba[offset + 3] ?? 0) < 128) continue;
    const r = rgba[offset] ?? 0;
    const g = rgba[offset + 1] ?? 0;
    const b = rgba[offset + 2] ?? 0;
    const key = ((r >> BIN_SHIFT) << 10) | ((g >> BIN_SHIFT) << 5) | (b >> BIN_SHIFT);
    let label = binLabel[key] ?? -1;
    if (label < 0) {
      label = nearestLab(centroids, rgbToOklab(r, g, b));
      binLabel[key] = label;
    }
    labels[i] = label;
  }
}

function reassignBlends(
  rgba: Uint8Array,
  labels: Uint16Array,
  width: number,
  height: number,
  palette: readonly Lab[],
  coverage: Float32Array,
  partner: Uint16Array,
  blend: Uint8Array
): void {
  const next = labels.slice();
  const cache = new Map<number, Lab>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const label = labels[index] ?? TRANSPARENT;
      if (label === TRANSPARENT) continue;
      if (
        x > 0 &&
        y > 0 &&
        x + 1 < width &&
        y + 1 < height &&
        labels[index - 1] === label &&
        labels[index + 1] === label &&
        labels[index - width] === label &&
        labels[index + width] === label
      ) {
        continue;
      }
      let bestOther = -1;
      let bestT = 0;
      let bestPerp = Infinity;
      const neighbors = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1]
      ] as const;
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const other = labels[ny * width + nx] ?? TRANSPARENT;
        if (other === TRANSPARENT || other === label) continue;
        const color = palette[label];
        const neighbor = palette[other];
        if (!color || !neighbor) continue;
        const lab = cachedLab(cache, rgba, index);
        const along = project(lab, color, neighbor);
        if (!along) continue;
        if (along.t < 0.08 || along.t > 0.92) continue;
        if (along.perp >= Math.min(0.03, 0.35 * along.length)) continue;
        if (along.perp < bestPerp) {
          bestPerp = along.perp;
          bestT = along.t;
          bestOther = other;
        }
      }
      if (bestOther < 0) continue;
      blend[index] = 1;
      if (bestT < 0.5) {
        coverage[index] = 1 - bestT;
        partner[index] = bestOther;
      } else {
        next[index] = bestOther;
        coverage[index] = bestT;
        partner[index] = label;
      }
    }
  }
  labels.set(next);
}

function writeRobustPalette(
  rgba: Uint8Array,
  labels: Uint16Array,
  width: number,
  height: number,
  palette: Lab[],
  blend: Uint8Array
): void {
  const count = palette.length;
  const interior = new Int32Array(count);
  const solid = new Int32Array(count);
  const all = new Int32Array(count);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const label = labels[index] ?? TRANSPARENT;
      if (label === TRANSPARENT || label >= count) continue;
      all[label] = (all[label] ?? 0) + 1;
      if ((blend[index] ?? 0) === 1) continue;
      solid[label] = (solid[label] ?? 0) + 1;
      if (isInterior(labels, width, height, x, y, label)) interior[label] = (interior[label] ?? 0) + 1;
    }
  }
  const mode = new Uint8Array(count);
  for (let label = 0; label < count; label++) {
    if ((interior[label] ?? 0) >= 12) mode[label] = 2;
    else if ((solid[label] ?? 0) >= 4) mode[label] = 1;
    else mode[label] = 0;
  }
  const bins = 96;
  const histL = new Int32Array(count * bins);
  const histA = new Int32Array(count * bins);
  const histB = new Int32Array(count * bins);
  const used = new Int32Array(count);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const label = labels[index] ?? TRANSPARENT;
      if (label === TRANSPARENT || label >= count) continue;
      const kind = mode[label] ?? 0;
      if (kind === 2 && (!isInterior(labels, width, height, x, y, label) || (blend[index] ?? 0) === 1)) continue;
      if (kind === 1 && (blend[index] ?? 0) === 1) continue;
      const offset = index * 4;
      const lab = rgbToOklab(rgba[offset] ?? 0, rgba[offset + 1] ?? 0, rgba[offset + 2] ?? 0);
      const base = label * bins;
      histL[base + labBin(lab.l, 0, 1, bins)] = (histL[base + labBin(lab.l, 0, 1, bins)] ?? 0) + 1;
      histA[base + labBin(lab.a, -0.45, 0.45, bins)] = (histA[base + labBin(lab.a, -0.45, 0.45, bins)] ?? 0) + 1;
      histB[base + labBin(lab.b, -0.45, 0.45, bins)] = (histB[base + labBin(lab.b, -0.45, 0.45, bins)] ?? 0) + 1;
      used[label] = (used[label] ?? 0) + 1;
    }
  }
  for (let label = 0; label < count; label++) {
    const total = used[label] ?? 0;
    if (total === 0) continue;
    const base = label * bins;
    palette[label] = {
      l: histogramMedian(histL, base, bins, total, 0, 1),
      a: histogramMedian(histA, base, bins, total, -0.45, 0.45),
      b: histogramMedian(histB, base, bins, total, -0.45, 0.45)
    };
  }
}

function mergeClusters(
  labels: Uint16Array,
  partner: Uint16Array,
  coverage: Float32Array,
  palette: Lab[],
  sensitivity: number,
  smoothContrast: number,
  maxColors: number
): void {
  const counts = countLabels(labels, palette.length);
  const active = palette.map((_, index) => (counts[index] ?? 0) > 0);
  const protectedSlot = palette.map((lab) => oklabChroma(lab) > 0.045 || lab.l > 0.93);
  const largeArea = labels.length * 0.005;
  const activeCount = () => active.filter(Boolean).length;
  for (;;) {
    let bestI = -1;
    let bestJ = -1;
    let bestD = Infinity;
    let bestAllowed = false;
    for (let i = 0; i < palette.length; i++) {
      if (!active[i]) continue;
      const left = palette[i];
      if (!left) continue;
      for (let j = i + 1; j < palette.length; j++) {
        if (!active[j]) continue;
        const right = palette[j];
        if (!right) continue;
        if (huesApart(left, right)) continue;
        const distance = oklabDistance(left, right);
        const bothNeutral = oklabChroma(left) < 0.05 && oklabChroma(right) < 0.05;
        const leftLarge = (counts[i] ?? 0) >= largeArea;
        const rightLarge = (counts[j] ?? 0) >= largeArea;
        if (bothNeutral && leftLarge && rightLarge && Math.abs(left.l - right.l) > 0.06) continue;
        const lowChroma = oklabChroma(left) < 0.05 && oklabChroma(right) < 0.05;
        const limit = lowChroma ? Math.max(sensitivity, smoothContrast) : sensitivity;
        const bothProtected = (protectedSlot[i] ?? false) && (protectedSlot[j] ?? false);
        const underLimit = sameHueClose(left, right) || (distance < limit && !bothProtected);
        const overBudget = activeCount() > maxColors && !bothProtected;
        if (!underLimit && !overBudget) continue;
        const prefer = underLimit && !bestAllowed ? true : underLimit === bestAllowed && distance < bestD;
        if (bestI < 0 || prefer) {
          bestI = i;
          bestJ = j;
          bestD = distance;
          bestAllowed = underLimit;
        }
      }
    }
    if (bestI < 0 || bestJ < 0) break;
    const source = (counts[bestI] ?? 0) <= (counts[bestJ] ?? 0) ? bestI : bestJ;
    const target = source === bestI ? bestJ : bestI;
    relabel(labels, partner, coverage, source, target);
    counts[target] = (counts[target] ?? 0) + (counts[source] ?? 0);
    counts[source] = 0;
    active[source] = false;
  }
}

function smoothLowContrast(
  labels: Uint16Array,
  partner: Uint16Array,
  coverage: Float32Array,
  width: number,
  height: number,
  palette: readonly Lab[],
  smoothContrast: number
): void {
  const distance = new Map<number, number>();
  const pair = (a: number, b: number) => {
    const key = a < b ? a * palette.length + b : b * palette.length + a;
    const cached = distance.get(key);
    if (cached !== undefined) return cached;
    const left = palette[a];
    const right = palette[b];
    const value = left && right ? oklabDistance(left, right) : Infinity;
    distance.set(key, value);
    return value;
  };
  const votes = new Int32Array(palette.length);
  const touched: number[] = [];
  for (let iter = 0; iter < 6; iter++) {
    const next = labels.slice();
    let changed = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        const label = labels[index] ?? TRANSPARENT;
        if (label === TRANSPARENT) continue;
        if (
          x > 0 &&
          y > 0 &&
          x + 1 < width &&
          y + 1 < height &&
          labels[index - 1] === label &&
          labels[index + 1] === label &&
          labels[index - width] === label &&
          labels[index + width] === label
        ) {
          continue;
        }
        touched.length = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const neighbor = labels[ny * width + nx] ?? TRANSPARENT;
            if (neighbor === TRANSPARENT || neighbor >= votes.length) continue;
            if ((votes[neighbor] ?? 0) === 0) touched.push(neighbor);
            votes[neighbor] = (votes[neighbor] ?? 0) + 1;
          }
        }
        let best = label;
        let bestCount = 0;
        for (const candidate of touched) {
          const count = votes[candidate] ?? 0;
          if (count > bestCount) {
            best = candidate;
            bestCount = count;
          }
          votes[candidate] = 0;
        }
        if (best === label || bestCount < 5) continue;
        if (pair(label, best) >= smoothContrast) continue;
        next[index] = best;
        coverage[index] = 1;
        partner[index] = TRANSPARENT;
        changed++;
      }
    }
    labels.set(next);
    if (changed === 0) break;
  }
}

function removeWeakSpeckles(
  labels: Uint16Array,
  partner: Uint16Array,
  coverage: Float32Array,
  width: number,
  height: number,
  palette: readonly Lab[]
): void {
  const areaLimit = Math.max(12, Math.round(width * height * 0.00005));
  const seen = new Uint8Array(labels.length);
  const stack: number[] = [];
  for (let start = 0; start < labels.length; start++) {
    const label = labels[start] ?? TRANSPARENT;
    if (label === TRANSPARENT || seen[start]) continue;
    stack.push(start);
    seen[start] = 1;
    const pixels: number[] = [];
    const adjacency = new Map<number, number>();
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let oversized = false;
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      const x = current % width;
      const y = (current - x) / width;
      if (!oversized) {
        pixels.push(current);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (pixels.length > areaLimit) oversized = true;
      }
      const neighbors = [current - 1, current + 1, current - width, current + width];
      for (const next of neighbors) {
        const nx = next % width;
        const ny = (next - nx) / width;
        if (next < 0 || next >= labels.length) continue;
        if ((next === current - 1 && x === 0) || (next === current + 1 && x + 1 === width)) continue;
        if (ny < 0 || ny >= height) continue;
        const neighbor = labels[next] ?? TRANSPARENT;
        if (neighbor === label) {
          if (!seen[next]) {
            seen[next] = 1;
            stack.push(next);
          }
        } else if (!oversized && neighbor !== TRANSPARENT) {
          adjacency.set(neighbor, (adjacency.get(neighbor) ?? 0) + 1);
        }
      }
    }
    if (oversized || pixels.length > areaLimit || adjacency.size === 0) continue;
    const spanX = maxX - minX + 1;
    const spanY = maxY - minY + 1;
    const aspect = Math.max(spanX, spanY) / Math.max(1, Math.min(spanX, spanY));
    if (aspect >= 2.2) continue;
    if (pixels.length >= 6 && componentThickness(pixels, width, height, 2) <= 2) continue;
    const own = palette[label];
    if (!own) continue;
    let target = -1;
    let bestScore = -1;
    let contrast = Infinity;
    for (const [other, touches] of adjacency) {
      const color = palette[other];
      if (!color) continue;
      const distance = oklabDistance(own, color);
      const score = touches / (1 + distance * 8);
      if (score > bestScore) {
        bestScore = score;
        target = other;
        contrast = distance;
      }
    }
    if (target < 0) continue;
    const vivid = oklabChroma(own) > 0.08 || own.l > 0.92;
    if (vivid && contrast > 0.05) continue;
    if (contrast >= 0.1) continue;
    for (const pixel of pixels) {
      labels[pixel] = target;
      coverage[pixel] = 1;
      partner[pixel] = TRANSPARENT;
    }
  }
}

/**
 * OKLab L gap. A compact component this much darker than a low-contrast
 * surround is a shadow or blend artifact, not a separate ink.
 */
export const DARK_SURROUND_L = 0.12;

/** A chromatic dark must stay apart from black, and distinct hues must not collapse. */
function sameHueClose(left: Lab, right: Lab): boolean {
  const leftChroma = oklabChroma(left);
  const rightChroma = oklabChroma(right);
  if (leftChroma < 0.08 || rightChroma < 0.08) return false;
  let angle = Math.abs(Math.atan2(left.b, left.a) - Math.atan2(right.b, right.a));
  if (angle > Math.PI) angle = Math.PI * 2 - angle;
  if (angle > 0.22) return false;
  if (Math.abs(left.l - right.l) > 0.08) return false;
  return oklabDistance(left, right) < 0.09;
}

/** Near-neutral pixels must not wear a chromatic swatch such as maroon. */
function detachNeutrals(
  rgba: Uint8Array,
  labels: Uint16Array,
  partner: Uint16Array,
  coverage: Float32Array,
  palette: readonly Lab[]
): void {
  const counts = countLabels(labels, palette.length);
  const neutral: number[] = [];
  const chromatic = new Array<boolean>(palette.length).fill(false);
  for (let i = 0; i < palette.length; i++) {
    const lab = palette[i];
    if (!lab || (counts[i] ?? 0) === 0) continue;
    if (oklabChroma(lab) < 0.03) neutral.push(i);
    chromatic[i] = oklabChroma(lab) >= 0.045;
  }
  if (neutral.length === 0) return;
  const cache = new Map<number, number>();
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i] ?? TRANSPARENT;
    if (label === TRANSPARENT || !chromatic[label]) continue;
    if ((partner[i] ?? TRANSPARENT) !== TRANSPARENT) continue;
    const offset = i * 4;
    const key = ((rgba[offset] ?? 0) << 16) | ((rgba[offset + 1] ?? 0) << 8) | (rgba[offset + 2] ?? 0);
    let next = cache.get(key);
    if (next === undefined) {
      const lab = rgbToOklab((key >> 16) & 255, (key >> 8) & 255, key & 255);
      if (oklabChroma(lab) >= 0.03) next = label;
      else {
        let best = label;
        let bestDistance = Infinity;
        for (const candidate of neutral) {
          const color = palette[candidate];
          if (!color) continue;
          const distance = oklabDistance(lab, color);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = candidate;
          }
        }
        next = bestDistance < 0.4 ? best : label;
      }
      cache.set(key, next);
    }
    if (next !== label) {
      labels[i] = next;
      coverage[i] = 1;
      partner[i] = TRANSPARENT;
    }
  }
}

function huesApart(left: Lab, right: Lab): boolean {
  const leftChroma = oklabChroma(left);
  const rightChroma = oklabChroma(right);
  if ((leftChroma >= 0.035 && rightChroma < 0.025) || (rightChroma >= 0.035 && leftChroma < 0.025)) return true;
  if (leftChroma > 0.04 && rightChroma > 0.04) {
    let angle = Math.abs(Math.atan2(left.b, left.a) - Math.atan2(right.b, right.a));
    if (angle > Math.PI) angle = Math.PI * 2 - angle;
    if (angle > 0.45) return true;
  }
  return false;
}

type Region = {
  readonly label: number;
  readonly pixels: number[];
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly adjacency: Map<number, number>;
};

type ComponentKeep = (info: { count: number; minX: number; maxX: number; minY: number; maxY: number; fat: boolean }) => boolean;

/**
 * Flood each label component. `keep` may reject a component once its size or a
 * solid 5×5 block proves the caller would ignore it, so a full-frame background
 * is only marked seen and not copied into an array.
 */
function forEachComponent(labels: Uint16Array, width: number, height: number, body: (region: Region) => void, keep?: ComponentKeep): void {
  const seen = new Uint8Array(labels.length);
  const stack: number[] = [];
  for (let start = 0; start < labels.length; start++) {
    const label = labels[start] ?? TRANSPARENT;
    if (label === TRANSPARENT || seen[start]) continue;
    stack.push(start);
    seen[start] = 1;
    const pixels: number[] = [];
    const adjacency = new Map<number, number>();
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let fat = false;
    let dropped = false;
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      const x = current % width;
      const y = (current - x) / width;
      if (!dropped) {
        pixels.push(current);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (keep && !fat && pixels.length > 24 && solidBlock(labels, width, height, x, y, label)) fat = true;
        if (keep && (fat || pixels.length % 32 === 0) && !keep({ count: pixels.length, minX, maxX, minY, maxY, fat })) {
          dropped = true;
          pixels.length = 0;
          adjacency.clear();
        }
      }
      if (x > 0) visitComponentNeighbor(labels, seen, stack, adjacency, current - 1, label, dropped);
      if (x + 1 < width) visitComponentNeighbor(labels, seen, stack, adjacency, current + 1, label, dropped);
      if (y > 0) visitComponentNeighbor(labels, seen, stack, adjacency, current - width, label, dropped);
      if (y + 1 < height) visitComponentNeighbor(labels, seen, stack, adjacency, current + width, label, dropped);
    }
    if (!dropped) body({ label, pixels, minX, maxX, minY, maxY, adjacency });
  }
}

function visitComponentNeighbor(
  labels: Uint16Array,
  seen: Uint8Array,
  stack: number[],
  adjacency: Map<number, number>,
  next: number,
  label: number,
  dropped: boolean
): void {
  if (next < 0 || next >= labels.length) return;
  const neighbor = labels[next] ?? TRANSPARENT;
  if (neighbor === label) {
    if (!seen[next]) {
      seen[next] = 1;
      stack.push(next);
    }
  } else if (!dropped && neighbor !== TRANSPARENT) {
    adjacency.set(neighbor, (adjacency.get(neighbor) ?? 0) + 1);
  }
}

/** A 5×5 block of one label is at least three pixels thick, so it is not a sliver. */
function solidBlock(labels: Uint16Array, width: number, height: number, x: number, y: number, label: number): boolean {
  if (x < 2 || y < 2 || x + 2 >= width || y + 2 >= height) return false;
  for (let dy = -2; dy <= 2; dy++) {
    const row = (y + dy) * width;
    for (let dx = -2; dx <= 2; dx++) {
      if ((labels[row + x + dx] ?? TRANSPARENT) !== label) return false;
    }
  }
  return true;
}

function absorbDarkBlobs(
  rgba: Uint8Array,
  labels: Uint16Array,
  partner: Uint16Array,
  coverage: Float32Array,
  width: number,
  height: number,
  palette: readonly Lab[]
): void {
  const areaCap = Math.max(160, Math.round(width * height * 0.004));
  const counts = countLabels(labels, palette.length);
  const largeArea = width * height * 0.005;
  const mark = new Uint8Array(labels.length);
  forEachComponent(
    labels,
    width,
    height,
    (region) => {
    if (region.pixels.length < 4 || region.pixels.length > areaCap || region.adjacency.size === 0) return;
    const spanX = region.maxX - region.minX + 1;
    const spanY = region.maxY - region.minY + 1;
    const aspect = Math.max(spanX, spanY) / Math.max(1, Math.min(spanX, spanY));
    if (aspect >= 2.2) return;
    if (region.pixels.length >= 6 && componentThickness(region.pixels, width, height, 3) <= 3) return;
    const own = medianLab(rgba, region.pixels);
    const swatch = palette[region.label];
    const outside = (counts[region.label] ?? 0) - region.pixels.length;
    if (swatch && outside >= Math.max(largeArea, 400) && oklabDistance(own, swatch) < 0.08) return;
    if (oklabChroma(own) >= 0.045) return;
    const ring = ringLabs(rgba, labels, region.pixels, width, height, mark);
    if (ring.length < 6) return;
    const surround = medianOf(ring);
    if (oklabChroma(surround) > 0.05) return;
    if (spreadL(ring) > 0.055) return;
    const gap = surround.l - own.l;
    if (gap <= DARK_SURROUND_L) return;
    if (own.l < 0.16 && gap > 0.5) return;
    const target = surroundLabel(region.adjacency, palette, surround);
    if (target < 0 || target === region.label) return;
    for (const pixel of region.pixels) {
      labels[pixel] = target;
      coverage[pixel] = 1;
      partner[pixel] = TRANSPARENT;
    }
  },
    (info) => info.count <= areaCap
  );
}

function dissolveSlivers(
  rgba: Uint8Array,
  labels: Uint16Array,
  partner: Uint16Array,
  coverage: Float32Array,
  width: number,
  height: number,
  palette: readonly Lab[]
): void {
  forEachComponent(
    labels,
    width,
    height,
    (region) => {
    if (region.pixels.length < 2 || region.adjacency.size === 0) return;
    const spanX = region.maxX - region.minX + 1;
    const spanY = region.maxY - region.minY + 1;
    const aspect = Math.max(spanX, spanY) / Math.max(1, Math.min(spanX, spanY));
    const narrow = Math.min(spanX, spanY) <= 2 || aspect >= 2.4;
    if (!narrow && region.pixels.length > 80) return;
    const thick = componentThickness(region.pixels, width, height, 3);
    const thinStrip = Math.min(spanX, spanY) <= 2 || thick <= 1 || (thick <= 2 && aspect >= 2.4);
    if (!thinStrip) return;
    const target = sliverTarget(rgba, region, palette);
    if (target < 0 || target === region.label) return;
    for (const pixel of region.pixels) {
      labels[pixel] = target;
      coverage[pixel] = 1;
      partner[pixel] = TRANSPARENT;
    }
  },
    (info) => {
      if (!info.fat || info.count <= 80) return true;
      const spanX = info.maxX - info.minX + 1;
      const spanY = info.maxY - info.minY + 1;
      return Math.min(spanX, spanY) <= 2;
    }
  );
}

function peelPaleEdges(
  rgba: Uint8Array,
  labels: Uint16Array,
  partner: Uint16Array,
  coverage: Float32Array,
  width: number,
  height: number,
  palette: readonly Lab[]
): void {
  const paleSlot = palette.map((lab) => lab.l > 0.9 && oklabChroma(lab) < 0.04);
  const next = labels.slice();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const label = labels[index] ?? TRANSPARENT;
      if (label === TRANSPARENT || !paleSlot[label]) continue;
      const offset = index * 4;
      const red = rgba[offset] ?? 0;
      const green = rgba[offset + 1] ?? 0;
      const blue = rgba[offset + 2] ?? 0;
      const lab = rgbToOklab(red, green, blue);
      if (lab.l > 0.94 && oklabChroma(lab) < 0.025) continue;
      const neighbors = [index - 1, index + 1, index - width, index + width];
      let best = -1;
      let bestDistance = Infinity;
      let contacts = 0;
      for (const neighbor of neighbors) {
        if (neighbor < 0 || neighbor >= labels.length) continue;
        const nx = neighbor % width;
        if ((neighbor === index - 1 && x === 0) || (neighbor === index + 1 && x + 1 === width)) continue;
        const ny = (neighbor - nx) / width;
        if (ny < 0 || ny >= height) continue;
        const other = labels[neighbor] ?? TRANSPARENT;
        if (other === TRANSPARENT || other === label || paleSlot[other]) continue;
        contacts++;
        const color = palette[other];
        if (!color) continue;
        const distance = oklabDistance(lab, color);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = other;
        }
      }
      const nearWhitePixel = red > 226 && green > 226 && blue > 226;
      if (nearWhitePixel && contacts < 2) continue;
      if (best < 0 || bestDistance > 0.28) continue;
      next[index] = best;
      coverage[index] = 1;
      partner[index] = TRANSPARENT;
    }
  }
  labels.set(next);
}

function liftNearWhite(
  rgba: Uint8Array,
  labels: Uint16Array,
  partner: Uint16Array,
  coverage: Float32Array,
  width: number,
  height: number,
  palette: readonly Lab[]
): void {
  let lightest = -1;
  let lightestL = -1;
  for (let i = 0; i < palette.length; i++) {
    const lab = palette[i];
    if (!lab || lab.l <= lightestL) continue;
    lightestL = lab.l;
    lightest = i;
  }
  const target = palette[lightest];
  if (!target || lightest < 0 || lightestL < 0.9) return;
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i] ?? TRANSPARENT;
    if (label === TRANSPARENT || label === lightest) continue;
    const own = palette[label];
    if (!own || own.l > 0.9) continue;
    const offset = i * 4;
    const red = rgba[offset] ?? 0;
    const green = rgba[offset + 1] ?? 0;
    const blue = rgba[offset + 2] ?? 0;
    if (red < 232 || green < 232 || blue < 232) continue;
    const x = i % width;
    const y = (i - x) / width;
    let chromaticNeighbor = false;
    const neighbors = [i - 1, i + 1, i - width, i + width];
    for (const neighbor of neighbors) {
      if (neighbor < 0 || neighbor >= labels.length) continue;
      const nx = neighbor % width;
      const ny = (neighbor - nx) / width;
      if ((neighbor === i - 1 && x === 0) || (neighbor === i + 1 && x + 1 === width)) continue;
      if (ny < 0 || ny >= height) continue;
      const other = labels[neighbor] ?? TRANSPARENT;
      const color = other === TRANSPARENT ? undefined : palette[other];
      if (color && oklabChroma(color) > 0.08) chromaticNeighbor = true;
    }
    if (chromaticNeighbor) continue;
    const lab = rgbToOklab(red, green, blue);
    if (oklabDistance(lab, target) + 0.015 >= oklabDistance(lab, own)) continue;
    labels[i] = lightest;
    coverage[i] = 1;
    partner[i] = TRANSPARENT;
  }
}

function sliverTarget(rgba: Uint8Array, region: Region, palette: readonly Lab[]): number {
  const ranked = [...region.adjacency.entries()].sort((a, b) => b[1] - a[1]);
  const first = ranked[0];
  if (!first) return -1;
  const second = ranked[1];
  const colorA = palette[first[0]];
  const colorB = second ? palette[second[0]] : undefined;
  const median = medianLab(rgba, region.pixels);
  const own = palette[region.label];
  if (median.l < 0.22 && oklabChroma(median) < 0.05) return -1;
  if (colorA && isHalo(median, colorA)) return first[0];
  if (colorB && second && isHalo(median, colorB)) return second[0];
  if (colorA && colorB) {
    const along = project(median, colorA, colorB);
    if (along && along.t > 0.05 && along.t < 0.95 && along.perp < Math.min(0.05, 0.45 * along.length)) {
      return along.t < 0.5 ? first[0] : (second ? second[0] : first[0]);
    }
  }
  const pale = median.l > 0.82 && oklabChroma(median) < 0.06;
  const paleSwatch = !!own && own.l > 0.88 && oklabChroma(own) < 0.05;
  if (!pale && !paleSwatch) return -1;
  let best = -1;
  let bestScore = Infinity;
  for (const [other] of ranked) {
    const color = palette[other];
    if (!color || (color.l > 0.9 && oklabChroma(color) < 0.04)) continue;
    const distance = oklabDistance(median, color);
    if (distance < bestScore) {
      bestScore = distance;
      best = other;
    }
  }
  return bestScore < 0.45 ? best : -1;
}

function isHalo(pixel: Lab, neighbor: Lab): boolean {
  const pixelChroma = oklabChroma(pixel);
  const neighborChroma = oklabChroma(neighbor);
  if (neighborChroma < 0.05 || pixelChroma < 0.02) return false;
  let angle = Math.abs(Math.atan2(pixel.b, pixel.a) - Math.atan2(neighbor.b, neighbor.a));
  if (angle > Math.PI) angle = Math.PI * 2 - angle;
  if (angle > 0.4) return false;
  if (oklabDistance(pixel, neighbor) > 0.14) return false;
  if (pixel.l + 0.12 < neighbor.l) return false;
  return true;
}

function ringLabs(
  rgba: Uint8Array,
  labels: Uint16Array,
  pixels: readonly number[],
  width: number,
  height: number,
  mark: Uint8Array
): Lab[] {
  for (const pixel of pixels) mark[pixel] = 1;
  const ring: Lab[] = [];
  const seenRing = new Set<number>();
  for (const pixel of pixels) {
    const x = pixel % width;
    const y = (pixel - x) / width;
    const neighbors = [pixel - 1, pixel + 1, pixel - width, pixel + width];
    for (const next of neighbors) {
      if (next < 0 || next >= labels.length || seenRing.has(next)) continue;
      const nx = next % width;
      const ny = (next - nx) / width;
      if ((next === pixel - 1 && x === 0) || (next === pixel + 1 && x + 1 === width)) continue;
      if (ny < 0 || ny >= height || mark[next]) continue;
      seenRing.add(next);
      const offset = next * 4;
      ring.push(rgbToOklab(rgba[offset] ?? 0, rgba[offset + 1] ?? 0, rgba[offset + 2] ?? 0));
    }
  }
  for (const pixel of pixels) mark[pixel] = 0;
  return ring;
}

function surroundLabel(adjacency: ReadonlyMap<number, number>, palette: readonly Lab[], surround: Lab): number {
  let best = -1;
  let bestScore = Infinity;
  for (const [other, touches] of adjacency) {
    const color = palette[other];
    if (!color || touches <= 0) continue;
    const distance = oklabDistance(color, surround);
    const score = distance - Math.min(touches, 40) * 0.0005;
    if (score < bestScore) {
      bestScore = score;
      best = other;
    }
  }
  return best;
}

function medianLab(rgba: Uint8Array, pixels: readonly number[]): Lab {
  const step = Math.max(1, Math.floor(pixels.length / 480));
  const l: number[] = [];
  const a: number[] = [];
  const b: number[] = [];
  for (let i = 0; i < pixels.length; i += step) {
    const index = pixels[i];
    if (index === undefined) continue;
    const offset = index * 4;
    const lab = rgbToOklab(rgba[offset] ?? 0, rgba[offset + 1] ?? 0, rgba[offset + 2] ?? 0);
    l.push(lab.l);
    a.push(lab.a);
    b.push(lab.b);
  }
  return { l: median(l), a: median(a), b: median(b) };
}

function medianOf(labs: readonly Lab[]): Lab {
  return {
    l: median(labs.map((lab) => lab.l)),
    a: median(labs.map((lab) => lab.a)),
    b: median(labs.map((lab) => lab.b))
  };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function spreadL(labs: readonly Lab[]): number {
  let mean = 0;
  for (const lab of labs) mean += lab.l;
  mean /= labs.length;
  let variance = 0;
  for (const lab of labs) {
    const delta = lab.l - mean;
    variance += delta * delta;
  }
  return Math.sqrt(variance / labs.length);
}

/**
 * Edge pixels belong to the two local core regions only, and a soft shade
 * inside one shape stays one label. Runs after the palette has settled.
 */
function settleEdges(
  rgba: Uint8Array,
  labels: Uint16Array,
  partner: Uint16Array,
  coverage: Float32Array,
  width: number,
  height: number,
  palette: readonly Lab[]
): void {
  const gradient = sobelLuma(rgba, width, height);
  dissolveBoundarySlivers(rgba, labels, partner, coverage, width, height, palette);
  mergeSoftBoundaries(rgba, labels, partner, coverage, width, height, palette, gradient);
  dissolveBoundarySlivers(rgba, labels, partner, coverage, width, height, palette);
  clearCheckerboards(labels, partner, coverage, width, height);
  pinToLocalCores(rgba, labels, partner, coverage, width, height, palette, gradient);
  pinToNearbyCores(rgba, labels, partner, coverage, width, height, palette);
  clearCheckerboards(labels, partner, coverage, width, height);
  clearSolidSpecks(labels, partner, coverage, width, height);
  for (let pass = 0; pass < 4; pass++) pinToNearbyCores(rgba, labels, partner, coverage, width, height, palette);
  dissolveBoundarySlivers(rgba, labels, partner, coverage, width, height, palette);
  clearSolidSpecks(labels, partner, coverage, width, height);
  absorbInteriorSpecks(rgba, labels, partner, coverage, width, height);
  reconcilePartners(labels, partner, coverage);
}

function pinToLocalCores(
  rgba: Uint8Array,
  labels: Uint16Array,
  partner: Uint16Array,
  coverage: Float32Array,
  width: number,
  height: number,
  palette: readonly Lab[],
  gradient: Float32Array
): void {
  const colorCount = palette.length;
  const flat = new Uint8Array(labels.length);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = y * width + x;
      const label = labels[index] ?? TRANSPARENT;
      if (label === TRANSPARENT || (gradient[index] ?? 999) >= 22) continue;
      if (isInterior(labels, width, height, x, y, label)) flat[index] = 1;
    }
  }
  const radius = 8;
  const next = labels.slice();
  const totals = new Int32Array(colorCount);
  const seen: number[] = [];
  const cache = new Map<number, Lab>();
  const stride = width + 1;
  const plane = (height + 1) * stride;
  const prefix = colorCount > 0 && colorCount <= 24 ? new Uint32Array(colorCount * plane) : null;
  if (prefix) {
    for (let y = 0; y < height; y++) {
      const row = y * width;
      const dstRow = (y + 1) * stride;
      const prevRow = y * stride;
      for (let x = 0; x < width; x++) {
        const index = row + x;
        for (let candidate = 0; candidate < colorCount; candidate++) {
          const base = candidate * plane;
          prefix[base + dstRow + x + 1] =
            (prefix[base + prevRow + x + 1] ?? 0) + (prefix[base + dstRow + x] ?? 0) - (prefix[base + prevRow + x] ?? 0);
        }
        if (!flat[index]) continue;
        const painted = labels[index] ?? TRANSPARENT;
        if (painted === TRANSPARENT || painted >= colorCount) continue;
        const slot = painted * plane + dstRow + x + 1;
        prefix[slot] = (prefix[slot] ?? 0) + 1;
      }
    }
  }
  const windowCount = (candidate: number, x0: number, y0: number, x1: number, y1: number): number => {
    if (!prefix) return 0;
    const base = candidate * plane;
    const top = y0 * stride;
    const bottom = (y1 + 1) * stride;
    return (
      (prefix[base + bottom + x1 + 1] ?? 0) -
      (prefix[base + top + x1 + 1] ?? 0) -
      (prefix[base + bottom + x0] ?? 0) +
      (prefix[base + top + x0] ?? 0)
    );
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const label = labels[index] ?? TRANSPARENT;
      if (label === TRANSPARENT || flat[index]) continue;
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(height - 1, y + radius);
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      let first = -1;
      let second = -1;
      let tied = prefix === null;
      if (prefix) {
        let firstN = 0;
        let secondN = 0;
        for (let candidate = 0; candidate < colorCount; candidate++) {
          const count = windowCount(candidate, x0, y0, x1, y1);
          if (count < 3) continue;
          if (first < 0 || count > firstN) {
            second = first;
            secondN = firstN;
            first = candidate;
            firstN = count;
          } else if (count === firstN) {
            tied = true;
          } else if (second < 0 || count > secondN) {
            second = candidate;
            secondN = count;
          } else if (count === secondN) {
            tied = true;
          }
        }
      }
      if (tied) {
        seen.length = 0;
        for (let yy = y0; yy <= y1; yy++) {
          const row = yy * width;
          for (let xx = x0; xx <= x1; xx++) {
            const neighborIndex = row + xx;
            if (!flat[neighborIndex]) continue;
            const neighbor = labels[neighborIndex] ?? TRANSPARENT;
            if (neighbor === TRANSPARENT || neighbor >= colorCount) continue;
            if (totals[neighbor] === 0) seen.push(neighbor);
            totals[neighbor] = (totals[neighbor] ?? 0) + 1;
          }
        }
        first = -1;
        second = -1;
        for (const candidate of seen) {
          if ((totals[candidate] ?? 0) < 3) continue;
          if (first < 0 || (totals[candidate] ?? 0) > (totals[first] ?? 0)) {
            second = first;
            first = candidate;
          } else if (second < 0 || (totals[candidate] ?? 0) > (totals[second] ?? 0)) {
            second = candidate;
          }
        }
        for (const candidate of seen) totals[candidate] = 0;
      }
      if (first < 0 || second < 0) continue;
      const colorA = palette[first];
      const colorB = palette[second];
      if (!colorA || !colorB) continue;
      const lab = cachedLab(cache, rgba, index);
      if (keepNeutralDark(lab, palette[label], colorA, colorB)) continue;
      const along = project(lab, colorA, colorB);
      const distanceA = oklabDistance(lab, colorA);
      const distanceB = oklabDistance(lab, colorB);
      let chosen = distanceA <= distanceB ? first : second;
      if (along && along.perp <= Math.max(0.05, 0.55 * along.length)) chosen = along.t < 0.5 ? first : second;
      if (keepDarkLabel(lab, palette[label], palette[chosen])) continue;
      next[index] = chosen;
      coverage[index] = 1;
      partner[index] = TRANSPARENT;
    }
  }
  labels.set(next);
}

function pinToNearbyCores(
  rgba: Uint8Array,
  labels: Uint16Array,
  partner: Uint16Array,
  coverage: Float32Array,
  width: number,
  height: number,
  palette: readonly Lab[]
): void {
  const colorCount = palette.length;
  const core = new Uint8Array(labels.length);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = y * width + x;
      const label = labels[index] ?? TRANSPARENT;
      if (label === TRANSPARENT) continue;
      if (isInterior(labels, width, height, x, y, label)) core[index] = 1;
    }
  }
  const next = labels.slice();
  const totals = new Int32Array(colorCount);
  const seen: number[] = [];
  const cache = new Map<number, Lab>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const label = labels[index] ?? TRANSPARENT;
      if (label === TRANSPARENT || core[index]) continue;
      seen.length = 0;
      for (let oy = -2; oy <= 2; oy++) {
        const yy = y + oy;
        if (yy < 0 || yy >= height) continue;
        const row = yy * width;
        for (let ox = -2; ox <= 2; ox++) {
          const xx = x + ox;
          if (xx < 0 || xx >= width) continue;
          const neighborIndex = row + xx;
          if (!core[neighborIndex]) continue;
          const neighbor = labels[neighborIndex] ?? TRANSPARENT;
          if (neighbor === TRANSPARENT || neighbor >= colorCount) continue;
          if (totals[neighbor] === 0) seen.push(neighbor);
          totals[neighbor] = (totals[neighbor] ?? 0) + 1;
        }
      }
      let first = -1;
      let second = -1;
      for (const candidate of seen) {
        if (first < 0 || (totals[candidate] ?? 0) > (totals[first] ?? 0)) {
          second = first;
          first = candidate;
        } else if (second < 0 || (totals[candidate] ?? 0) > (totals[second] ?? 0)) {
          second = candidate;
        }
      }
      for (const candidate of seen) totals[candidate] = 0;
      if (first < 0 || second < 0 || label === first || label === second) continue;
      const colorA = palette[first];
      const colorB = palette[second];
      if (!colorA || !colorB) continue;
      const lab = cachedLab(cache, rgba, index);
      if (keepNeutralDark(lab, palette[label], colorA, colorB)) continue;
      const along = project(lab, colorA, colorB);
      const nearer = oklabDistance(lab, colorA) <= oklabDistance(lab, colorB) ? first : second;
      let chosen = nearer;
      if (along && along.perp <= Math.max(0.05, 0.55 * along.length)) chosen = along.t < 0.5 ? first : second;
      if (keepDarkLabel(lab, palette[label], palette[chosen])) continue;
      next[index] = chosen;
      coverage[index] = 1;
      partner[index] = TRANSPARENT;
    }
  }
  labels.set(next);
}

function keepNeutralDark(lab: Lab, current: Lab | undefined, colorA: Lab, colorB: Lab): boolean {
  if (!current || !(lab.l < 0.45) || oklabChroma(lab) >= 0.08) return false;
  if (!(lab.l + 0.08 < colorA.l && lab.l + 0.08 < colorB.l)) return false;
  return oklabChroma(current) < 0.04;
}

function keepDarkLabel(lab: Lab, current: Lab | undefined, chosen: Lab | undefined): boolean {
  if (!current || !chosen || !(lab.l < 0.4) || !(lab.l + 0.12 < chosen.l)) return false;
  if (oklabChroma(lab) < 0.04 && oklabChroma(current) > 0.05) return false;
  return oklabDistance(lab, current) <= oklabDistance(lab, chosen) + 0.04;
}

function dissolveBoundarySlivers(
  rgba: Uint8Array,
  labels: Uint16Array,
  partner: Uint16Array,
  coverage: Float32Array,
  width: number,
  height: number,
  palette: readonly Lab[]
): void {
  const cache = new Map<number, Lab>();
  for (let pass = 0; pass < 6; pass++) {
    const jobs: { pixels: number[]; first: number; second: number }[] = [];
    forEachComponent(labels, width, height, (region) => {
      if (region.adjacency.size < 2 || region.pixels.length < 1) return;
      const spanX = region.maxX - region.minX + 1;
      const spanY = region.maxY - region.minY + 1;
      if (spanX >= 6 && spanY >= 6 && region.pixels.length >= Math.min(spanX, spanY) * 4) return;
      if (componentThickness(region.pixels, width, height, 2) > 1) return;
      const ranked = [...region.adjacency.entries()].sort((left, right) => right[1] - left[1]);
      const first = ranked[0];
      const second = ranked[1];
      if (!first || !second) return;
      const median = medianLab(rgba, region.pixels);
      const colorA = palette[first[0]];
      const colorB = palette[second[0]];
      if (colorA && colorB && median.l + 0.18 < colorA.l && median.l + 0.18 < colorB.l && oklabChroma(median) < 0.04) return;
      jobs.push({ pixels: region.pixels, first: first[0], second: second[0] });
    }, (info) => {
      const spanX = info.maxX - info.minX + 1;
      const spanY = info.maxY - info.minY + 1;
      if (spanX >= 6 && spanY >= 6 && info.count >= Math.min(spanX, spanY) * 4) return false;
      if (info.fat && Math.min(spanX, spanY) > 2) return false;
      return true;
    });
    if (jobs.length === 0) break;
    for (const job of jobs) {
      const colorA = palette[job.first];
      const colorB = palette[job.second];
      if (!colorA || !colorB) continue;
      for (const pixel of job.pixels) {
        const lab = cachedLab(cache, rgba, pixel);
        const nearer = oklabDistance(lab, colorA) <= oklabDistance(lab, colorB) ? job.first : job.second;
        const nearerLab = palette[nearer];
        if (nearerLab && lab.l < 0.4 && lab.l + 0.12 < nearerLab.l) continue;
        labels[pixel] = nearer;
        coverage[pixel] = 1;
        partner[pixel] = TRANSPARENT;
      }
    }
  }
}

function mergeSoftBoundaries(
  rgba: Uint8Array,
  labels: Uint16Array,
  partner: Uint16Array,
  coverage: Float32Array,
  width: number,
  height: number,
  palette: readonly Lab[],
  sobel: Float32Array
): void {
  const threshold = 26;
  for (let pass = 0; pass < 5; pass++) {
    const built = buildComponents(labels, width, height);
    const stride = built.comps.length + 1;
    if (stride <= 1) return;
    const pairs = new Map<number, { low: number; n: number }>();
    const consider = (left: number, right: number, leftIndex: number, rightIndex: number) => {
      if (left < 0 || right < 0 || left === right) return;
      const lowId = left < right ? left : right;
      const highId = left < right ? right : left;
      const key = lowId * stride + highId;
      const stat = pairs.get(key) ?? { low: 0, n: 0 };
      const magnitude = Math.max(sobel[leftIndex] ?? 999, sobel[rightIndex] ?? 999);
      stat.n++;
      if (magnitude < threshold) stat.low++;
      pairs.set(key, stat);
    };
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const index = row + x;
        const id = built.ids[index] ?? -1;
        if (id < 0) continue;
        if (x + 1 < width) consider(id, built.ids[index + 1] ?? -1, index, index + 1);
        if (y + 1 < height) consider(id, built.ids[index + width] ?? -1, index, index + width);
      }
    }
    const jobs: { source: number; target: number; n: number }[] = [];
    for (const [key, stat] of pairs) {
      if (stat.n < 6 || stat.low / stat.n < 0.72) continue;
      const idA = Math.floor(key / stride);
      const idB = key - idA * stride;
      const left = built.comps[idA];
      const right = built.comps[idB];
      if (!left || !right || left.label === right.label) continue;
      const source = left.count <= right.count ? idA : idB;
      const target = source === idA ? idB : idA;
      const sourceLab = palette[built.comps[source]?.label ?? -1];
      const targetLab = palette[built.comps[target]?.label ?? -1];
      if (sourceLab && targetLab && sourceLab.l + 0.22 < targetLab.l && oklabChroma(sourceLab) < 0.08) continue;
      const sourceComp = built.comps[source];
      if (targetLab && sourceComp && componentIsDarker(rgba, sourceComp.samples, targetLab.l)) continue;
      if (sourceLab && targetLab) {
        const sourceRgb = oklabToRgb(sourceLab);
        const targetRgb = oklabToRgb(targetLab);
        const sourceMax = Math.max(sourceRgb.r, sourceRgb.g, sourceRgb.b);
        const targetMax = Math.max(targetRgb.r, targetRgb.g, targetRgb.b);
        if (sourceMax < 110 && targetMax >= 110) continue;
      }
      jobs.push({ source, target, n: stat.n });
    }
    if (jobs.length === 0) break;
    jobs.sort((left, right) => right.n - left.n);
    const redirect = new Int32Array(built.comps.length);
    redirect.fill(-1);
    for (const job of jobs) {
      if ((redirect[job.source] ?? -1) !== -1 || (redirect[job.target] ?? -1) !== -1) continue;
      redirect[job.source] = job.target;
    }
    let changed = false;
    for (let i = 0; i < labels.length; i++) {
      const id = built.ids[i] ?? -1;
      if (id < 0) continue;
      const targetId = redirect[id] ?? -1;
      if (targetId < 0) continue;
      const target = built.comps[targetId];
      if (!target) continue;
      const previous = labels[i] ?? TRANSPARENT;
      labels[i] = target.label;
      const other = partner[i] ?? TRANSPARENT;
      if (other === TRANSPARENT || other === target.label || other === previous) {
        partner[i] = TRANSPARENT;
        coverage[i] = 1;
      }
      changed = true;
    }
    if (!changed) break;
  }
}

function clearCheckerboards(
  labels: Uint16Array,
  partner: Uint16Array,
  coverage: Float32Array,
  width: number,
  height: number
): void {
  for (let pass = 0; pass < 8; pass++) {
    let changed = 0;
    for (let y = 1; y < height - 1; y++) {
      const row = y * width;
      for (let x = 1; x < width - 1; x++) {
        const index = row + x;
        const label = labels[index] ?? TRANSPARENT;
        if (label === TRANSPARENT) continue;
        const north = labels[index - width] ?? TRANSPARENT;
        const south = labels[index + width] ?? TRANSPARENT;
        const west = labels[index - 1] ?? TRANSPARENT;
        const east = labels[index + 1] ?? TRANSPARENT;
        let foreign = 0;
        if (north !== label && north !== TRANSPARENT) foreign++;
        if (south !== label && south !== TRANSPARENT) foreign++;
        if (west !== label && west !== TRANSPARENT) foreign++;
        if (east !== label && east !== TRANSPARENT) foreign++;
        if (foreign < 4) continue;
        const candidates = [west, east, north, south];
        let best = -1;
        let bestCount = 0;
        for (let i = 0; i < 4; i++) {
          const other = candidates[i] ?? TRANSPARENT;
          if (other === label || other === TRANSPARENT) continue;
          let count = 1;
          for (let j = i + 1; j < 4; j++) if (candidates[j] === other) count++;
          if (count > bestCount) {
            best = other;
            bestCount = count;
          }
        }
        if (best < 0 || bestCount < 2) continue;
        labels[index] = best;
        partner[index] = TRANSPARENT;
        coverage[index] = 1;
        changed++;
      }
    }
    if (changed === 0) break;
  }
}

function clearSolidSpecks(
  labels: Uint16Array,
  partner: Uint16Array,
  coverage: Float32Array,
  width: number,
  height: number
): void {
  for (let pass = 0; pass < 6; pass++) {
    let changed = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const index = y * width + x;
        const label = labels[index] ?? TRANSPARENT;
        if (label === TRANSPARENT) continue;
        const up = labels[index - width] ?? TRANSPARENT;
        const down = labels[index + width] ?? TRANSPARENT;
        const left = labels[index - 1] ?? TRANSPARENT;
        const right = labels[index + 1] ?? TRANSPARENT;
        if (up === TRANSPARENT || up !== down || up !== left || up !== right || up === label) continue;
        labels[index] = up;
        partner[index] = TRANSPARENT;
        coverage[index] = 1;
        changed++;
      }
    }
    if (changed === 0) break;
  }
}

function absorbInteriorSpecks(
  rgba: Uint8Array,
  labels: Uint16Array,
  partner: Uint16Array,
  coverage: Float32Array,
  width: number,
  height: number
): void {
  const totals = new Map<number, number>();
  for (let index = 0; index < labels.length; index++) {
    const label = labels[index] ?? TRANSPARENT;
    if (label === TRANSPARENT) continue;
    totals.set(label, (totals.get(label) ?? 0) + 1);
  }
  forEachComponent(labels, width, height, (region) => {
    if (region.pixels.length < 1 || region.pixels.length > 8 || region.adjacency.size !== 1) return;
    if ((totals.get(region.label) ?? 0) <= region.pixels.length) return;
    if (region.minX <= 0 || region.minY <= 0 || region.maxX >= width - 1 || region.maxY >= height - 1) return;
    const target = region.adjacency.keys().next().value;
    if (target === undefined || target === region.label) return;
    let dark = 0;
    let white = 0;
    for (const pixel of region.pixels) {
      const offset = pixel * 4;
      const r = rgba[offset] ?? 0;
      const g = rgba[offset + 1] ?? 0;
      const b = rgba[offset + 2] ?? 0;
      if (Math.max(r, g, b) < 70) dark++;
      if (r > 236 && g > 236 && b > 236) white++;
    }
    if (dark > 0 || white * 2 >= region.pixels.length) return;
    for (const pixel of region.pixels) {
      labels[pixel] = target;
      partner[pixel] = TRANSPARENT;
      coverage[pixel] = 1;
    }
  }, (info) => info.count <= 8);
}

function reconcilePartners(labels: Uint16Array, partner: Uint16Array, coverage: Float32Array): void {
  for (let i = 0; i < labels.length; i++) {
    const other = partner[i] ?? TRANSPARENT;
    if (other === TRANSPARENT || other === (labels[i] ?? TRANSPARENT)) {
      partner[i] = TRANSPARENT;
      coverage[i] = 1;
    }
  }
}

function sobelLuma(rgba: Uint8Array, width: number, height: number): Float32Array {
  const magnitude = new Float32Array(width * height);
  magnitude.fill(999);
  const lumaAt = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    return 0.2126 * (rgba[offset] ?? 0) + 0.7152 * (rgba[offset + 1] ?? 0) + 0.0722 * (rgba[offset + 2] ?? 0);
  };
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const gx =
        -lumaAt(x - 1, y - 1) +
        lumaAt(x + 1, y - 1) -
        2 * lumaAt(x - 1, y) +
        2 * lumaAt(x + 1, y) -
        lumaAt(x - 1, y + 1) +
        lumaAt(x + 1, y + 1);
      const gy =
        -lumaAt(x - 1, y - 1) -
        2 * lumaAt(x, y - 1) -
        lumaAt(x + 1, y - 1) +
        lumaAt(x - 1, y + 1) +
        2 * lumaAt(x, y + 1) +
        lumaAt(x + 1, y + 1);
      magnitude[y * width + x] = Math.hypot(gx, gy);
    }
  }
  return magnitude;
}

function componentIsDarker(rgba: Uint8Array, samples: readonly number[], targetL: number): boolean {
  if (samples.length === 0) return false;
  let sum = 0;
  for (const index of samples) {
    const offset = index * 4;
    sum += rgbToOklab(rgba[offset] ?? 0, rgba[offset + 1] ?? 0, rgba[offset + 2] ?? 0).l;
  }
  const mean = sum / samples.length;
  return mean < 0.42 && mean + 0.12 < targetL;
}

function buildComponents(
  labels: Uint16Array,
  width: number,
  height: number
): { ids: Int32Array; comps: { label: number; count: number; samples: number[] }[] } {
  const ids = new Int32Array(labels.length);
  ids.fill(-1);
  const comps: { label: number; count: number; samples: number[] }[] = [];
  const stack: number[] = [];
  for (let start = 0; start < labels.length; start++) {
    if ((ids[start] ?? -1) !== -1) continue;
    const label = labels[start] ?? TRANSPARENT;
    if (label === TRANSPARENT) continue;
    const id = comps.length;
    const comp = { label, count: 0, samples: [] as number[] };
    comps.push(comp);
    stack.push(start);
    ids[start] = id;
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      comp.count++;
      if (comp.samples.length < 8 || comp.count % 40 === 0) comp.samples.push(current);
      const x = current % width;
      const y = (current - x) / width;
      const neighbors = [current - 1, current + 1, current - width, current + width];
      for (const next of neighbors) {
        if (next < 0 || next >= labels.length || (ids[next] ?? -1) !== -1) continue;
        const nx = next % width;
        const ny = (next - nx) / width;
        if ((next === current - 1 && x === 0) || (next === current + 1 && x + 1 === width)) continue;
        if (ny < 0 || ny >= height) continue;
        if ((labels[next] ?? TRANSPARENT) !== label) continue;
        ids[next] = id;
        stack.push(next);
      }
    }
  }
  return { ids, comps };
}

function compactAll(
  labels: Uint16Array,
  partner: Uint16Array,
  palette: readonly Lab[]
): { labels: Uint16Array; palette: Rgb[]; partner: Uint16Array } {
  const used = new Array<boolean>(palette.length).fill(false);
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i] ?? TRANSPARENT;
    if (label !== TRANSPARENT && label < used.length) used[label] = true;
  }
  const map = new Array<number>(palette.length).fill(TRANSPARENT);
  const nextPalette: Rgb[] = [];
  for (let i = 0; i < palette.length; i++) {
    if (!used[i]) continue;
    map[i] = nextPalette.length;
    const lab = palette[i];
    if (lab) nextPalette.push(oklabToRgb(lab));
  }
  const nextLabels = new Uint16Array(labels.length);
  const nextPartner = new Uint16Array(partner.length);
  nextPartner.fill(TRANSPARENT);
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i] ?? TRANSPARENT;
    nextLabels[i] = label === TRANSPARENT ? TRANSPARENT : (map[label] ?? TRANSPARENT);
    const other = partner[i] ?? TRANSPARENT;
    const mapped = other === TRANSPARENT ? TRANSPARENT : (map[other] ?? TRANSPARENT);
    nextPartner[i] = mapped === nextLabels[i] ? TRANSPARENT : mapped;
  }
  return { labels: nextLabels, palette: nextPalette, partner: nextPartner };
}

function cachedLab(cache: Map<number, Lab>, rgba: Uint8Array, index: number): Lab {
  const offset = index * 4;
  const key = ((rgba[offset] ?? 0) << 16) | ((rgba[offset + 1] ?? 0) << 8) | (rgba[offset + 2] ?? 0);
  const found = cache.get(key);
  if (found) return found;
  const lab = rgbToOklab((key >> 16) & 255, (key >> 8) & 255, key & 255);
  cache.set(key, lab);
  return lab;
}

function project(point: Lab, from: Lab, to: Lab): { t: number; perp: number; length: number } | null {
  const dl = to.l - from.l;
  const da = to.a - from.a;
  const db = to.b - from.b;
  const length2 = dl * dl + da * da + db * db;
  if (length2 < 1e-10) return null;
  const t = ((point.l - from.l) * dl + (point.a - from.a) * da + (point.b - from.b) * db) / length2;
  const qx = from.l + t * dl;
  const qy = from.a + t * da;
  const qz = from.b + t * db;
  return {
    t,
    perp: Math.hypot(point.l - qx, point.a - qy, point.b - qz),
    length: Math.sqrt(length2)
  };
}

function isInterior(labels: Uint16Array, width: number, height: number, x: number, y: number, label: number): boolean {
  if (x === 0 || y === 0 || x + 1 === width || y + 1 === height) return false;
  const index = y * width + x;
  return labels[index - 1] === label && labels[index + 1] === label && labels[index - width] === label && labels[index + width] === label;
}

function labBin(value: number, min: number, max: number, bins: number): number {
  const t = (value - min) / (max - min);
  return Math.min(bins - 1, Math.max(0, Math.floor(t * bins)));
}

function histogramMedian(hist: Int32Array, base: number, bins: number, total: number, min: number, max: number): number {
  const half = total / 2;
  let accumulated = 0;
  for (let i = 0; i < bins; i++) {
    accumulated += hist[base + i] ?? 0;
    if (accumulated >= half) return min + ((i + 0.5) / bins) * (max - min);
  }
  return (min + max) / 2;
}

function countLabels(labels: Uint16Array, paletteLength: number): Int32Array {
  const counts = new Int32Array(paletteLength);
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i] ?? TRANSPARENT;
    if (label !== TRANSPARENT && label < paletteLength) counts[label] = (counts[label] ?? 0) + 1;
  }
  return counts;
}

function relabel(labels: Uint16Array, partner: Uint16Array, coverage: Float32Array, source: number, target: number): void {
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === source) labels[i] = target;
    if (partner[i] === source) partner[i] = target;
    if (partner[i] === labels[i]) {
      partner[i] = TRANSPARENT;
      coverage[i] = 1;
    }
  }
}

function nearestLab(centroids: readonly Lab[], lab: Lab): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < centroids.length; i++) {
    const centroid = centroids[i];
    if (!centroid) continue;
    const distance = oklabDistance(centroid, lab);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

function componentThickness(pixels: readonly number[], width: number, height: number, limit: number): number {
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
