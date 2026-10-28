import { labDistance2, oklabToRgb, rgbToOklab, type Lab } from "./color.ts";
import type { LabControls } from "./lab-model.ts";
import { paintLabels, type RGB, type SegmentColorStage } from "./segment.ts";

export type PaletteEdit =
  | { readonly kind: "merge"; readonly from: number; readonly to: number }
  | { readonly kind: "split"; readonly cluster: number; readonly k?: number }
  | { readonly kind: "recolor"; readonly cluster: number; readonly hex: string };

export type SubShade = {
  readonly color: RGB;
  readonly hex: string;
  readonly pixelCount: number;
};

export type PaletteCluster = {
  readonly index: number;
  readonly color: RGB;
  readonly hex: string;
  readonly pixelCount: number;
  readonly subShades: readonly SubShade[];
};

export type ParamCheckResult = {
  readonly clearEdits: boolean;
  readonly warning: string | null;
};

export function rgbToHex(rgb: RGB): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(rgb.r)}${h(rgb.g)}${h(rgb.b)}`;
}

export function hexToRgb(hex: string): RGB {
  const clean = hex.replace(/^#/, "");
  if (clean.length === 3) {
    const r = parseInt(clean[0]! + clean[0]!, 16);
    const g = parseInt(clean[1]! + clean[1]!, 16);
    const b = parseInt(clean[2]! + clean[2]!, 16);
    return { r, g, b };
  }
  const r = parseInt(clean.substring(0, 2), 16) || 0;
  const g = parseInt(clean.substring(2, 4), 16) || 0;
  const b = parseInt(clean.substring(4, 6), 16) || 0;
  return { r, g, b };
}

/**
 * Extracts cluster statistics (color, hex, pixelCount, sub-shades) for UI rendering.
 */
export function extractClusters(stage: SegmentColorStage): PaletteCluster[] {
  const counts = new Uint32Array(stage.palette.length);
  const totalPixels = stage.labels.length;
  for (let i = 0; i < totalPixels; i++) {
    const label = stage.labels[i] ?? -1;
    if (label >= 0 && label < counts.length) {
      counts[label] = (counts[label] ?? 0) + 1;
    }
  }

  const clusters: PaletteCluster[] = [];
  const source = stage.sourceRgba;

  for (let idx = 0; idx < stage.palette.length; idx++) {
    const pixelCount = counts[idx] ?? 0;
    if (pixelCount === 0) continue;
    const color = stage.palette[idx] ?? { r: 0, g: 0, b: 0 };
    const hex = rgbToHex(color);
    const subShades = extractSubShades(stage, idx, color, pixelCount, source);
    clusters.push({
      index: idx,
      color,
      hex,
      pixelCount,
      subShades
    });
  }

  return clusters;
}

function extractSubShades(
  stage: SegmentColorStage,
  clusterIndex: number,
  baseColor: RGB,
  totalPixels: number,
  source?: Uint8Array
): SubShade[] {
  if (totalPixels <= 0) return [];

  if (source && source.length >= stage.labels.length * 4) {
    // Collect unique colors / sub-shades with 5-bit quantization for nice clustering
    const bins = new Map<string, { r: number; g: number; b: number; count: number }>();
    const stride = Math.max(1, Math.floor(stage.labels.length / 5000));

    for (let i = 0; i < stage.labels.length; i += stride) {
      if (stage.labels[i] !== clusterIndex) continue;
      const r = source[i * 4] ?? 0;
      const g = source[i * 4 + 1] ?? 0;
      const b = source[i * 4 + 2] ?? 0;
      // 5-bit quantized key
      const key = `${r >> 3},${g >> 3},${b >> 3}`;
      const entry = bins.get(key);
      if (entry) {
        entry.r += r;
        entry.g += g;
        entry.b += b;
        entry.count += 1;
      } else {
        bins.set(key, { r, g, b, count: 1 });
      }
    }

    if (bins.size > 1) {
      const sorted = Array.from(bins.values()).sort((a, b) => b.count - a.count).slice(0, 8);
      return sorted.map((item) => {
        const rgb: RGB = {
          r: Math.round(item.r / item.count),
          g: Math.round(item.g / item.count),
          b: Math.round(item.b / item.count)
        };
        return {
          color: rgb,
          hex: rgbToHex(rgb),
          pixelCount: item.count
        };
      });
    }
  }

  // Synthetic deterministic sub-shades based on base color lightness
  const baseLab = rgbToOklab(baseColor);
  const variations: { dL: number; weight: number }[] = [
    { dL: -0.06, weight: 3 },
    { dL: -0.03, weight: 5 },
    { dL: 0.0, weight: 8 },
    { dL: 0.03, weight: 5 },
    { dL: 0.06, weight: 3 }
  ];

  return variations.map((v) => {
    const adjustedLab: Lab = {
      L: Math.max(0.05, Math.min(0.95, baseLab.L + v.dL)),
      a: baseLab.a,
      b: baseLab.b
    };
    const c = oklabToRgb(adjustedLab);
    return {
      color: c,
      hex: rgbToHex(c),
      pixelCount: Math.max(1, Math.round((totalPixels * v.weight) / 24))
    };
  });
}

/**
 * Merges cluster `from` into cluster `to`.
 * All pixels assigned to `from` become `to`.
 * Cluster `from` is removed and subsequent clusters shift down.
 */
export function applyMerge(stage: SegmentColorStage, from: number, to: number): SegmentColorStage {
  if (from === to) return stage;
  if (from < 0 || from >= stage.palette.length || to < 0 || to >= stage.palette.length) return stage;

  const count = stage.labels.length;
  const newLabels = new Int16Array(count);
  const newPunchLabels = new Int16Array(stage.punchLabels.length);

  // If `to > from`, its new index shifts down by 1 because `from` is removed.
  const targetNewIndex = to > from ? to - 1 : to;

  for (let i = 0; i < count; i++) {
    const l = stage.labels[i] ?? -1;
    if (l === from) {
      newLabels[i] = targetNewIndex;
    } else if (l > from) {
      newLabels[i] = l - 1;
    } else {
      newLabels[i] = l;
    }
  }

  for (let i = 0; i < stage.punchLabels.length; i++) {
    const pl = stage.punchLabels[i] ?? -1;
    if (pl === from) {
      newPunchLabels[i] = targetNewIndex;
    } else if (pl > from) {
      newPunchLabels[i] = pl - 1;
    } else {
      newPunchLabels[i] = pl;
    }
  }

  const newPalette = stage.palette.filter((_, idx) => idx !== from);
  const newColors = paintLabels(newLabels, newPalette, stage.opaque);

  return {
    colors: newColors,
    labels: newLabels,
    punchLabels: newPunchLabels,
    palette: newPalette,
    opaque: stage.opaque,
    spread: stage.spread,
    ...(stage.sourceRgba !== undefined ? { sourceRgba: stage.sourceRgba } : {})
  };
}

/**
 * Recolors cluster `cluster` to the new hex color.
 */
export function applyRecolor(stage: SegmentColorStage, cluster: number, hex: string): SegmentColorStage {
  if (cluster < 0 || cluster >= stage.palette.length) return stage;
  const newColor = hexToRgb(hex);
  const newPalette = stage.palette.map((c, i) => (i === cluster ? newColor : c));
  const newColors = stage.colors.slice();

  for (let i = 0; i < stage.labels.length; i++) {
    if ((stage.opaque[i] ?? 0) === 0) continue;
    if (stage.labels[i] === cluster) {
      const offset = i * 4;
      newColors[offset] = newColor.r;
      newColors[offset + 1] = newColor.g;
      newColors[offset + 2] = newColor.b;
      newColors[offset + 3] = 255;
    }
  }

  return {
    colors: newColors,
    labels: stage.labels,
    punchLabels: stage.punchLabels,
    palette: newPalette,
    opaque: stage.opaque,
    spread: stage.spread,
    ...(stage.sourceRgba !== undefined ? { sourceRgba: stage.sourceRgba } : {})
  };
}

/**
 * Splits cluster `cluster` into k=2 sub-clusters using deterministic k-means in OKLab.
 * Re-clusters ONLY this cluster's pixels.
 */
export function applySplit(stage: SegmentColorStage, cluster: number, _k = 2): SegmentColorStage {
  if (cluster < 0 || cluster >= stage.palette.length) return stage;
  const count = stage.labels.length;
  const memberIndices: number[] = [];
  for (let i = 0; i < count; i++) {
    if (stage.labels[i] === cluster) {
      memberIndices.push(i);
    }
  }
  if (memberIndices.length < 2) return stage;

  // Gather OKLab colors of pixels in this cluster
  const source = stage.sourceRgba;
  const pixelColors: { index: number; oklab: Lab; rgb: RGB }[] = [];

  for (const idx of memberIndices) {
    let r = 0, g = 0, b = 0;
    if (source && source.length >= (idx + 1) * 4) {
      r = source[idx * 4] ?? 0;
      g = source[idx * 4 + 1] ?? 0;
      b = source[idx * 4 + 2] ?? 0;
    } else {
      const base = stage.palette[cluster] ?? { r: 128, g: 128, b: 128 };
      r = base.r;
      g = base.g;
      b = base.b;
    }
    const rgb: RGB = { r, g, b };
    pixelColors.push({ index: idx, oklab: rgbToOklab(rgb), rgb });
  }

  // Deterministic seed initialization for k = 2
  // Compute mean OKLab
  let sumL = 0, sumA = 0, sumB = 0;
  for (const p of pixelColors) {
    sumL += p.oklab.L;
    sumA += p.oklab.a;
    sumB += p.oklab.b;
  }
  const mean: Lab = { L: sumL / pixelColors.length, a: sumA / pixelColors.length, b: sumB / pixelColors.length };

  // Seed 0: point furthest from mean in OKLab
  let bestDist0 = -1;
  let seed0 = pixelColors[0]!.oklab;
  for (const p of pixelColors) {
    const d = labDistance2(p.oklab, mean);
    if (d > bestDist0) {
      bestDist0 = d;
      seed0 = p.oklab;
    }
  }

  // Seed 1: point furthest from seed 0 in OKLab
  let bestDist1 = -1;
  let seed1 = seed0;
  for (const p of pixelColors) {
    const d = labDistance2(p.oklab, seed0);
    if (d > bestDist1) {
      bestDist1 = d;
      seed1 = p.oklab;
    }
  }

  // If seeds are virtually identical (e.g. solid single color in source),
  // split deterministically along lightness axis
  if (bestDist1 < 1e-4) {
    seed0 = { L: Math.max(0, seed0.L - 0.05), a: seed0.a, b: seed0.b };
    seed1 = { L: Math.min(1, seed1.L + 0.05), a: seed1.a, b: seed1.b };
  }

  // k-means iterations (fixed 10 rounds for deterministic convergence)
  let c0: Lab = { ...seed0 };
  let c1: Lab = { ...seed1 };
  let assign0: number[] = [];
  let assign1: number[] = [];

  for (let iter = 0; iter < 10; iter++) {
    assign0 = [];
    assign1 = [];
    let s0L = 0, s0A = 0, s0B = 0;
    let s1L = 0, s1A = 0, s1B = 0;

    for (let i = 0; i < pixelColors.length; i++) {
      const p = pixelColors[i]!;
      const d0 = labDistance2(p.oklab, c0);
      const d1 = labDistance2(p.oklab, c1);
      if (d0 <= d1) {
        assign0.push(p.index);
        s0L += p.oklab.L;
        s0A += p.oklab.a;
        s0B += p.oklab.b;
      } else {
        assign1.push(p.index);
        s1L += p.oklab.L;
        s1A += p.oklab.a;
        s1B += p.oklab.b;
      }
    }

    if (assign0.length > 0) {
      c0 = { L: s0L / assign0.length, a: s0A / assign0.length, b: s0B / assign0.length };
    }
    if (assign1.length > 0) {
      c1 = { L: s1L / assign1.length, a: s1A / assign1.length, b: s1B / assign1.length };
    }
  }

  // Guarantee neither cluster is empty
  if (assign0.length === 0 && assign1.length > 1) {
    assign0.push(assign1.pop()!);
  } else if (assign1.length === 0 && assign0.length > 1) {
    assign1.push(assign0.pop()!);
  }

  const rgb0 = oklabToRgb(c0);
  const rgb1 = oklabToRgb(c1);

  const newClusterIndex = stage.palette.length;
  const newPalette = [...stage.palette];
  newPalette[cluster] = rgb0;
  newPalette.push(rgb1);

  const newLabels = new Int16Array(stage.labels);
  const newPunchLabels = new Int16Array(stage.punchLabels);

  const set1 = new Set(assign1);
  for (const idx of assign1) {
    newLabels[idx] = newClusterIndex;
  }
  for (let i = 0; i < newPunchLabels.length; i++) {
    if (newPunchLabels[i] === cluster && set1.has(i)) {
      newPunchLabels[i] = newClusterIndex;
    }
  }

  const newColors = paintLabels(newLabels, newPalette, stage.opaque);

  return {
    colors: newColors,
    labels: newLabels,
    punchLabels: newPunchLabels,
    palette: newPalette,
    opaque: stage.opaque,
    spread: stage.spread,
    ...(stage.sourceRgba !== undefined ? { sourceRgba: stage.sourceRgba } : {})
  };
}

/**
 * Applies an ordered list of edits to the Colors step cluster output.
 * If edits is empty, returns colorsOutput byte-identical (and reference-identical).
 */
export function applyEdits(
  colorsOutput: SegmentColorStage,
  edits: readonly PaletteEdit[]
): SegmentColorStage {
  if (edits.length === 0) {
    return colorsOutput;
  }
  let current = colorsOutput;
  for (const edit of edits) {
    if (edit.kind === "merge") {
      current = applyMerge(current, edit.from, edit.to);
    } else if (edit.kind === "split") {
      current = applySplit(current, edit.cluster, edit.k ?? 2);
    } else if (edit.kind === "recolor") {
      current = applyRecolor(current, edit.cluster, edit.hex);
    }
  }
  return current;
}

/**
 * Undo/redo stack for palette edits.
 */
export class PaletteEditHistory {
  private undoStack: PaletteEdit[] = [];
  private redoStack: PaletteEdit[] = [];

  constructor(initialEdits: readonly PaletteEdit[] = []) {
    this.undoStack = [...initialEdits];
  }

  push(edit: PaletteEdit): void {
    this.undoStack.push(edit);
    this.redoStack = [];
  }

  undo(): PaletteEdit | null {
    const edit = this.undoStack.pop();
    if (edit !== undefined) {
      this.redoStack.push(edit);
      return edit;
    }
    return null;
  }

  redo(): PaletteEdit | null {
    const edit = this.redoStack.pop();
    if (edit !== undefined) {
      this.undoStack.push(edit);
      return edit;
    }
    return null;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  getEdits(): readonly PaletteEdit[] {
    return [...this.undoStack];
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}

/**
 * Checks whether palette edits should be cleared upon control param changes.
 * Edits survive downstream param changes (speckArea, removeBackground, opaqueAt, etc.).
 * If maxColors or mode (upstream/at Colors) change, edits are cleared and a warning is returned.
 */
export function checkEditsParamChange(
  previousControls: LabControls,
  nextControls: LabControls,
  hasEdits: boolean
): ParamCheckResult {
  if (previousControls.mode !== nextControls.mode || previousControls.maxColors !== nextControls.maxColors) {
    return {
      clearEdits: true,
      warning: hasEdits
        ? "Palette edits cleared because color count or mode changed."
        : null
    };
  }
  return {
    clearEdits: false,
    warning: null
  };
}
