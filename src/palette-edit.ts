import { labDistance2, oklabToRgb, rgbToOklab, type Lab } from "./color.ts";
import type { LabControls } from "./lab-model.ts";
import { paintLabels, type RGB, type SegmentColorStage } from "./segment.ts";

export type PaletteEdit =
  | { readonly kind: "merge"; readonly from: number; readonly to: number }
  | { readonly kind: "split"; readonly cluster: number; readonly k?: number }
  | { readonly kind: "splitShade"; readonly cluster: number; readonly shadeIndex: number }
  | { readonly kind: "recolor"; readonly cluster: number; readonly hex: string; readonly alpha?: number }
  | { readonly kind: "hide"; readonly cluster: number; readonly hidden: boolean };

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
  readonly alpha?: number;
  readonly hidden?: boolean;
};

export type ParamCheckResult = {
  readonly clearEdits: boolean;
  readonly warning: string | null;
  readonly remappedEdits?: PaletteEdit[];
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

export function extractSubShades(
  stage: SegmentColorStage,
  clusterIndex: number,
  baseColor: RGB,
  totalPixels: number,
  source?: Uint8Array
): SubShade[] {
  if (totalPixels <= 0) return [];

  if (source && source.length >= stage.labels.length * 4) {
    const bins = new Map<string, { r: number; g: number; b: number; count: number }>();
    const stride = Math.max(1, Math.floor(stage.labels.length / 5000));

    for (let i = 0; i < stage.labels.length; i += stride) {
      if (stage.labels[i] !== clusterIndex) continue;
      const r = source[i * 4] ?? 0;
      const g = source[i * 4 + 1] ?? 0;
      const b = source[i * 4 + 2] ?? 0;
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
 * Recolors cluster `cluster` to the new hex color and optional alpha (0..255).
 */
export function applyRecolor(
  stage: SegmentColorStage,
  cluster: number,
  hex: string,
  alpha?: number
): SegmentColorStage {
  if (cluster < 0 || cluster >= stage.palette.length) return stage;
  const newColor = hexToRgb(hex);
  const newPalette = stage.palette.map((c, i) => (i === cluster ? newColor : c));
  const newColors = stage.colors.slice();
  const newOpaque = stage.opaque.slice();

  const effectiveAlpha = alpha !== undefined ? Math.max(0, Math.min(255, Math.round(alpha))) : 255;

  for (let i = 0; i < stage.labels.length; i++) {
    if (stage.labels[i] === cluster) {
      const offset = i * 4;
      newOpaque[i] = effectiveAlpha;
      if (effectiveAlpha === 0) {
        newColors[offset] = 0;
        newColors[offset + 1] = 0;
        newColors[offset + 2] = 0;
        newColors[offset + 3] = 0;
      } else {
        newColors[offset] = newColor.r;
        newColors[offset + 1] = newColor.g;
        newColors[offset + 2] = newColor.b;
        newColors[offset + 3] = effectiveAlpha;
      }
    }
  }

  return {
    colors: newColors,
    labels: stage.labels,
    punchLabels: stage.punchLabels,
    palette: newPalette,
    opaque: newOpaque,
    spread: stage.spread,
    ...(stage.sourceRgba !== undefined ? { sourceRgba: stage.sourceRgba } : {})
  };
}

/**
 * Toggles visibility / hiding of a cluster.
 * When hidden, cluster pixels become transparent (opaque = 0).
 */
export function applyHide(stage: SegmentColorStage, cluster: number, hidden: boolean): SegmentColorStage {
  if (cluster < 0 || cluster >= stage.palette.length) return stage;
  const newOpaque = stage.opaque.slice();
  const newColors = stage.colors.slice();
  const color = stage.palette[cluster] ?? { r: 0, g: 0, b: 0 };

  for (let i = 0; i < stage.labels.length; i++) {
    if (stage.labels[i] === cluster) {
      const offset = i * 4;
      if (hidden) {
        newOpaque[i] = 0;
        newColors[offset] = 0;
        newColors[offset + 1] = 0;
        newColors[offset + 2] = 0;
        newColors[offset + 3] = 0;
      } else {
        newOpaque[i] = 255;
        newColors[offset] = color.r;
        newColors[offset + 1] = color.g;
        newColors[offset + 2] = color.b;
        newColors[offset + 3] = 255;
      }
    }
  }

  return {
    colors: newColors,
    labels: stage.labels,
    punchLabels: stage.punchLabels,
    palette: stage.palette,
    opaque: newOpaque,
    spread: stage.spread,
    ...(stage.sourceRgba !== undefined ? { sourceRgba: stage.sourceRgba } : {})
  };
}

/**
 * Splits cluster `cluster` into k=2 sub-clusters using deterministic k-means in OKLab.
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

  let sumL = 0, sumA = 0, sumB = 0;
  for (const p of pixelColors) {
    sumL += p.oklab.L;
    sumA += p.oklab.a;
    sumB += p.oklab.b;
  }
  const mean: Lab = { L: sumL / pixelColors.length, a: sumA / pixelColors.length, b: sumB / pixelColors.length };

  let bestDist0 = -1;
  let seed0 = pixelColors[0]!.oklab;
  for (const p of pixelColors) {
    const d = labDistance2(p.oklab, mean);
    if (d > bestDist0) {
      bestDist0 = d;
      seed0 = p.oklab;
    }
  }

  let bestDist1 = -1;
  let seed1 = seed0;
  for (const p of pixelColors) {
    const d = labDistance2(p.oklab, seed0);
    if (d > bestDist1) {
      bestDist1 = d;
      seed1 = p.oklab;
    }
  }

  if (bestDist1 < 1e-4) {
    seed0 = { L: Math.max(0, seed0.L - 0.05), a: seed0.a, b: seed0.b };
    seed1 = { L: Math.min(1, seed1.L + 0.05), a: seed1.a, b: seed1.b };
  }

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
 * Splits a specific inner shade circle out of its bubble into its own color cluster.
 * Used when dragging an inner circle OUT of its bubble.
 */
export function applySplitShade(
  stage: SegmentColorStage,
  cluster: number,
  shadeIndex: number
): SegmentColorStage {
  if (cluster < 0 || cluster >= stage.palette.length) return stage;
  const baseColor = stage.palette[cluster] ?? { r: 0, g: 0, b: 0 };
  const subShades = extractSubShades(stage, cluster, baseColor, 100, stage.sourceRgba);
  if (shadeIndex < 0 || shadeIndex >= subShades.length) return stage;

  const targetShade = subShades[shadeIndex]!;
  const targetLab = rgbToOklab(targetShade.color);
  const source = stage.sourceRgba;

  const newClusterIndex = stage.palette.length;
  const newPalette = [...stage.palette, targetShade.color];
  const newLabels = new Int16Array(stage.labels);
  const newPunchLabels = new Int16Array(stage.punchLabels);

  let splitPixelCount = 0;
  for (let i = 0; i < stage.labels.length; i++) {
    if (stage.labels[i] === cluster) {
      if (source && source.length >= (i + 1) * 4) {
        const r = source[i * 4] ?? 0;
        const g = source[i * 4 + 1] ?? 0;
        const b = source[i * 4 + 2] ?? 0;
        const pLab = rgbToOklab({ r, g, b });
        const dTarget = labDistance2(pLab, targetLab);
        const dBase = labDistance2(pLab, rgbToOklab(baseColor));
        if (dTarget < dBase) {
          newLabels[i] = newClusterIndex;
          if (newPunchLabels[i] === cluster) newPunchLabels[i] = newClusterIndex;
          splitPixelCount++;
        }
      }
    }
  }

  // If no pixels met condition, split at least 1 pixel
  if (splitPixelCount === 0) {
    for (let i = 0; i < stage.labels.length; i++) {
      if (stage.labels[i] === cluster) {
        newLabels[i] = newClusterIndex;
        if (newPunchLabels[i] === cluster) newPunchLabels[i] = newClusterIndex;
        break;
      }
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
    } else if (edit.kind === "splitShade") {
      current = applySplitShade(current, edit.cluster, edit.shadeIndex);
    } else if (edit.kind === "recolor") {
      current = applyRecolor(current, edit.cluster, edit.hex, edit.alpha);
    } else if (edit.kind === "hide") {
      current = applyHide(current, edit.cluster, edit.hidden);
    }
  }
  return current;
}

/**
 * Determines whether net edits are zero (meaning current output matches base output).
 */
export function isNetZeroEdits(baseStage: SegmentColorStage, currentStage: SegmentColorStage): boolean {
  if (baseStage === currentStage) return true;
  if (baseStage.palette.length !== currentStage.palette.length) return false;

  for (let i = 0; i < baseStage.palette.length; i++) {
    const b = baseStage.palette[i]!;
    const c = currentStage.palette[i]!;
    if (b.r !== c.r || b.g !== c.g || b.b !== c.b) return false;
  }

  for (let i = 0; i < baseStage.labels.length; i++) {
    if (baseStage.labels[i] !== currentStage.labels[i]) return false;
  }

  for (let i = 0; i < baseStage.opaque.length; i++) {
    if (baseStage.opaque[i] !== currentStage.opaque[i]) return false;
  }

  return true;
}

/**
 * Creates a dimmed preview raster where the selected cluster is highlighted
 * in full color, and all other clusters are dimmed (dark grayscale).
 */
export function createDimmedPreview(stage: SegmentColorStage, selectedCluster: number): Uint8Array {
  const dimmed = new Uint8Array(stage.colors.length);
  const count = stage.labels.length;

  for (let i = 0; i < count; i++) {
    const offset = i * 4;
    const isSelected = stage.labels[i] === selectedCluster;
    const opaque = stage.opaque[i] ?? 0;

    if (opaque === 0) {
      dimmed[offset] = 0;
      dimmed[offset + 1] = 0;
      dimmed[offset + 2] = 0;
      dimmed[offset + 3] = 0;
      continue;
    }

    const r = stage.colors[offset] ?? 0;
    const g = stage.colors[offset + 1] ?? 0;
    const b = stage.colors[offset + 2] ?? 0;

    if (isSelected) {
      dimmed[offset] = r;
      dimmed[offset + 1] = g;
      dimmed[offset + 2] = b;
      dimmed[offset + 3] = 255;
    } else {
      const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      const dimmedVal = Math.round(lum * 0.2);
      dimmed[offset] = dimmedVal;
      dimmed[offset + 1] = dimmedVal;
      dimmed[offset + 2] = dimmedVal;
      dimmed[offset + 3] = 160;
    }
  }

  return dimmed;
}

/**
 * Remaps manual edits across a maxColors clustering change.
 * Recolor and hide edits follow the nearest cluster by color.
 * Merges re-apply if both sides still exist distinctly in the new palette.
 */
export function remapEditsAcrossMaxColors(
  edits: readonly PaletteEdit[],
  oldStage: SegmentColorStage,
  newStage: SegmentColorStage
): { remappedEdits: PaletteEdit[]; unmappedCount: number; warning: string | null } {
  const remappedEdits: PaletteEdit[] = [];
  let unmappedCount = 0;

  function findNearestCluster(color: RGB, palette: readonly RGB[]): number {
    const targetLab = rgbToOklab(color);
    let bestDist = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < palette.length; i++) {
      const pLab = rgbToOklab(palette[i]!);
      const d = labDistance2(pLab, targetLab);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  for (const edit of edits) {
    if (edit.kind === "recolor") {
      const oldColor = oldStage.palette[edit.cluster];
      if (oldColor) {
        const newIdx = findNearestCluster(oldColor, newStage.palette);
        remappedEdits.push({ kind: "recolor", cluster: newIdx, hex: edit.hex, alpha: edit.alpha });
      } else {
        unmappedCount++;
      }
    } else if (edit.kind === "hide") {
      const oldColor = oldStage.palette[edit.cluster];
      if (oldColor) {
        const newIdx = findNearestCluster(oldColor, newStage.palette);
        remappedEdits.push({ kind: "hide", cluster: newIdx, hidden: edit.hidden });
      } else {
        unmappedCount++;
      }
    } else if (edit.kind === "merge") {
      const oldFromColor = oldStage.palette[edit.from];
      const oldToColor = oldStage.palette[edit.to];
      if (oldFromColor && oldToColor) {
        const newFrom = findNearestCluster(oldFromColor, newStage.palette);
        const newTo = findNearestCluster(oldToColor, newStage.palette);
        if (newFrom !== newTo) {
          remappedEdits.push({ kind: "merge", from: newFrom, to: newTo });
        }
      } else {
        unmappedCount++;
      }
    } else if (edit.kind === "split") {
      const oldColor = oldStage.palette[edit.cluster];
      if (oldColor) {
        const newIdx = findNearestCluster(oldColor, newStage.palette);
        remappedEdits.push({ kind: "split", cluster: newIdx, k: edit.k });
      } else {
        unmappedCount++;
      }
    } else if (edit.kind === "splitShade") {
      const oldColor = oldStage.palette[edit.cluster];
      if (oldColor) {
        const newIdx = findNearestCluster(oldColor, newStage.palette);
        remappedEdits.push({ kind: "splitShade", cluster: newIdx, shadeIndex: edit.shadeIndex });
      } else {
        unmappedCount++;
      }
    }
  }

  const warning = unmappedCount > 0 ? `${unmappedCount} edit(s) could not be remapped to the new palette.` : null;
  return { remappedEdits, unmappedCount, warning };
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

  setEdits(edits: readonly PaletteEdit[]): void {
    this.undoStack = [...edits];
    this.redoStack = [];
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}

/**
 * Checks whether palette edits should survive or be remapped across control param changes.
 * Mode change clears edits with a warning.
 * maxColors change: manual edits SURVIVE and are remapped onto the new clustering.
 * Downstream parameter changes (speckArea, removeBackground, etc.): edits survive directly.
 */
export function checkEditsParamChange(
  previousControls: LabControls,
  nextControls: LabControls,
  hasEdits: boolean,
  oldStage?: SegmentColorStage,
  newStage?: SegmentColorStage,
  currentEdits: readonly PaletteEdit[] = []
): ParamCheckResult {
  // Mode change: clear with warning
  if (previousControls.mode !== nextControls.mode) {
    return {
      clearEdits: true,
      warning: hasEdits ? "Palette edits cleared because mode changed." : null
    };
  }

  // maxColors change: manual edits survive via remapping
  if (previousControls.maxColors !== nextControls.maxColors && hasEdits && oldStage && newStage) {
    const { remappedEdits, warning } = remapEditsAcrossMaxColors(currentEdits, oldStage, newStage);
    return {
      clearEdits: false,
      warning,
      remappedEdits
    };
  }

  return {
    clearEdits: false,
    warning: null
  };
}
