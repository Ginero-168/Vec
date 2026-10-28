"use strict";
(() => {
  // src/color.ts
  function srgbChannelToLinear(channel) {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }
  function linearChannelToSrgb(channel) {
    const value = Math.min(1, Math.max(0, channel));
    const encoded = value <= 31308e-7 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, encoded)) * 255);
  }
  function rgbToOklab(color) {
    const red = srgbChannelToLinear(color.r);
    const green = srgbChannelToLinear(color.g);
    const blue = srgbChannelToLinear(color.b);
    const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
    const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
    const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
    return {
      L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    };
  }
  function oklabToRgb(color) {
    const l = color.L + 0.3963377774 * color.a + 0.2158037573 * color.b;
    const m = color.L - 0.1055613458 * color.a - 0.0638541728 * color.b;
    const s = color.L - 0.0894841775 * color.a - 1.291485548 * color.b;
    const lp = l * l * l;
    const mp = m * m * m;
    const sp = s * s * s;
    return {
      r: linearChannelToSrgb(4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp),
      g: linearChannelToSrgb(-1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp),
      b: linearChannelToSrgb(-0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp)
    };
  }
  function labDistance2(left, right) {
    const dL = left.L - right.L;
    const da = left.a - right.a;
    const db = left.b - right.b;
    return dL * dL + da * da + db * db;
  }

  // src/segment.ts
  function paintLabels(labels, palette, alpha) {
    const next = new Uint8Array(alpha.length * 4);
    for (let index = 0; index < alpha.length; index += 1) {
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

  // src/palette-edit.ts
  function rgbToHex(rgb) {
    const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
    return `#${h(rgb.r)}${h(rgb.g)}${h(rgb.b)}`;
  }
  function hexToRgb(hex) {
    const clean = hex.replace(/^#/, "");
    if (clean.length === 3) {
      const r2 = parseInt(clean[0] + clean[0], 16);
      const g2 = parseInt(clean[1] + clean[1], 16);
      const b2 = parseInt(clean[2] + clean[2], 16);
      return { r: r2, g: g2, b: b2 };
    }
    const r = parseInt(clean.substring(0, 2), 16) || 0;
    const g = parseInt(clean.substring(2, 4), 16) || 0;
    const b = parseInt(clean.substring(4, 6), 16) || 0;
    return { r, g, b };
  }
  function extractClusters(stage) {
    const counts = new Uint32Array(stage.palette.length);
    const totalPixels = stage.labels.length;
    for (let i = 0; i < totalPixels; i++) {
      const label = stage.labels[i] ?? -1;
      if (label >= 0 && label < counts.length) {
        counts[label] = (counts[label] ?? 0) + 1;
      }
    }
    const clusters = [];
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
  function extractSubShades(stage, clusterIndex, baseColor, totalPixels, source) {
    if (totalPixels <= 0) return [];
    if (source && source.length >= stage.labels.length * 4) {
      const bins = /* @__PURE__ */ new Map();
      const stride = Math.max(1, Math.floor(stage.labels.length / 5e3));
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
          const rgb = {
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
    const variations = [
      { dL: -0.06, weight: 3 },
      { dL: -0.03, weight: 5 },
      { dL: 0, weight: 8 },
      { dL: 0.03, weight: 5 },
      { dL: 0.06, weight: 3 }
    ];
    return variations.map((v) => {
      const adjustedLab = {
        L: Math.max(0.05, Math.min(0.95, baseLab.L + v.dL)),
        a: baseLab.a,
        b: baseLab.b
      };
      const c = oklabToRgb(adjustedLab);
      return {
        color: c,
        hex: rgbToHex(c),
        pixelCount: Math.max(1, Math.round(totalPixels * v.weight / 24))
      };
    });
  }
  function applyMerge(stage, from, to) {
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
      ...stage.sourceRgba !== void 0 ? { sourceRgba: stage.sourceRgba } : {}
    };
  }
  function applyRecolor(stage, cluster, hex, alpha) {
    if (cluster < 0 || cluster >= stage.palette.length) return stage;
    const newColor = hexToRgb(hex);
    const newPalette = stage.palette.map((c, i) => i === cluster ? newColor : c);
    const newColors = stage.colors.slice();
    const newOpaque = stage.opaque.slice();
    const effectiveAlpha = alpha !== void 0 ? Math.max(0, Math.min(255, Math.round(alpha))) : 255;
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
      ...stage.sourceRgba !== void 0 ? { sourceRgba: stage.sourceRgba } : {}
    };
  }
  function applyHide(stage, cluster, hidden) {
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
      ...stage.sourceRgba !== void 0 ? { sourceRgba: stage.sourceRgba } : {}
    };
  }
  function applySplit(stage, cluster, _k = 2) {
    if (cluster < 0 || cluster >= stage.palette.length) return stage;
    const count = stage.labels.length;
    const memberIndices = [];
    for (let i = 0; i < count; i++) {
      if (stage.labels[i] === cluster) {
        memberIndices.push(i);
      }
    }
    if (memberIndices.length < 2) return stage;
    const source = stage.sourceRgba;
    const pixelColors = [];
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
      const rgb = { r, g, b };
      pixelColors.push({ index: idx, oklab: rgbToOklab(rgb), rgb });
    }
    let sumL = 0, sumA = 0, sumB = 0;
    for (const p of pixelColors) {
      sumL += p.oklab.L;
      sumA += p.oklab.a;
      sumB += p.oklab.b;
    }
    const mean = { L: sumL / pixelColors.length, a: sumA / pixelColors.length, b: sumB / pixelColors.length };
    let bestDist0 = -1;
    let seed0 = pixelColors[0].oklab;
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
    let c0 = { ...seed0 };
    let c1 = { ...seed1 };
    let assign0 = [];
    let assign1 = [];
    for (let iter = 0; iter < 10; iter++) {
      assign0 = [];
      assign1 = [];
      let s0L = 0, s0A = 0, s0B = 0;
      let s1L = 0, s1A = 0, s1B = 0;
      for (let i = 0; i < pixelColors.length; i++) {
        const p = pixelColors[i];
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
      assign0.push(assign1.pop());
    } else if (assign1.length === 0 && assign0.length > 1) {
      assign1.push(assign0.pop());
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
      ...stage.sourceRgba !== void 0 ? { sourceRgba: stage.sourceRgba } : {}
    };
  }
  function applySplitShade(stage, cluster, shadeIndex) {
    if (cluster < 0 || cluster >= stage.palette.length) return stage;
    const baseColor = stage.palette[cluster] ?? { r: 0, g: 0, b: 0 };
    const subShades = extractSubShades(stage, cluster, baseColor, 100, stage.sourceRgba);
    if (shadeIndex < 0 || shadeIndex >= subShades.length) return stage;
    const targetShade = subShades[shadeIndex];
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
      ...stage.sourceRgba !== void 0 ? { sourceRgba: stage.sourceRgba } : {}
    };
  }
  function applyEdits(colorsOutput, edits) {
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
  function isNetZeroEdits(baseStage, currentStage) {
    if (baseStage === currentStage) return true;
    if (baseStage.palette.length !== currentStage.palette.length) return false;
    for (let i = 0; i < baseStage.palette.length; i++) {
      const b = baseStage.palette[i];
      const c = currentStage.palette[i];
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
  function createDimmedPreview(stage, selectedCluster) {
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
  function remapEditsAcrossMaxColors(edits, oldStage, newStage) {
    const remappedEdits = [];
    let unmappedCount = 0;
    function findNearestCluster(color, palette) {
      const targetLab = rgbToOklab(color);
      let bestDist = Infinity;
      let bestIdx = 0;
      for (let i = 0; i < palette.length; i++) {
        const pLab = rgbToOklab(palette[i]);
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
  var PaletteEditHistory = class {
    constructor(initialEdits = []) {
      this.undoStack = [];
      this.redoStack = [];
      this.undoStack = [...initialEdits];
    }
    push(edit) {
      this.undoStack.push(edit);
      this.redoStack = [];
    }
    undo() {
      const edit = this.undoStack.pop();
      if (edit !== void 0) {
        this.redoStack.push(edit);
        return edit;
      }
      return null;
    }
    redo() {
      const edit = this.redoStack.pop();
      if (edit !== void 0) {
        this.undoStack.push(edit);
        return edit;
      }
      return null;
    }
    canUndo() {
      return this.undoStack.length > 0;
    }
    canRedo() {
      return this.redoStack.length > 0;
    }
    getEdits() {
      return [...this.undoStack];
    }
    setEdits(edits) {
      this.undoStack = [...edits];
      this.redoStack = [];
    }
    clear() {
      this.undoStack = [];
      this.redoStack = [];
    }
  };

  // src/color-diagram.ts
  var SVG_NS = "http://www.w3.org/2000/svg";
  function packCirclesDeterministic(items) {
    if (items.length === 0) return [];
    const sorted = [...items].sort((a, b) => b.r - a.r);
    if (sorted.length === 1) {
      return [{ id: sorted[0].id, r: sorted[0].r, x: 0, y: 0 }];
    }
    const placed = [];
    placed.push({ id: sorted[0].id, r: sorted[0].r, x: 0, y: 0 });
    placed.push({ id: sorted[1].id, r: sorted[1].r, x: sorted[0].r + sorted[1].r, y: 0 });
    for (let i = 2; i < sorted.length; i++) {
      const r_i = sorted[i].r;
      let bestScore = Infinity;
      let bestX = 0;
      let bestY = 0;
      let found = false;
      for (let j = 0; j < placed.length; j++) {
        for (let k = j + 1; k < placed.length; k++) {
          const cj = placed[j];
          const ck = placed[k];
          const dx = ck.x - cj.x;
          const dy = ck.y - cj.y;
          const d = Math.hypot(dx, dy);
          const dj = cj.r + r_i;
          const dk = ck.r + r_i;
          if (d > dj + dk || d < Math.abs(dj - dk) || d < 1e-4) continue;
          const a = (dj * dj - dk * dk + d * d) / (2 * d);
          const hSq = dj * dj - a * a;
          if (hSq < 0) continue;
          const h = Math.sqrt(hSq);
          const mx = cj.x + a * dx / d;
          const my = cj.y + a * dy / d;
          const rx = -dy / d * h;
          const ry = dx / d * h;
          const candidates = [
            { x: mx + rx, y: my + ry },
            { x: mx - rx, y: my - ry }
          ];
          for (const cand of candidates) {
            let collides = false;
            for (let m = 0; m < placed.length; m++) {
              if (m === j || m === k) continue;
              const dist = Math.hypot(cand.x - placed[m].x, cand.y - placed[m].y);
              if (dist < r_i + placed[m].r - 0.5) {
                collides = true;
                break;
              }
            }
            if (!collides) {
              const score = cand.x * cand.x + cand.y * cand.y;
              if (score < bestScore) {
                bestScore = score;
                bestX = cand.x;
                bestY = cand.y;
                found = true;
              }
            }
          }
        }
      }
      if (!found) {
        let minOriginDist = Infinity;
        let refCircle = placed[0];
        for (const p of placed) {
          const dist = Math.hypot(p.x, p.y);
          if (dist < minOriginDist) {
            minOriginDist = dist;
            refCircle = p;
          }
        }
        const angle = i * 2.399963229728653;
        bestX = refCircle.x + Math.cos(angle) * (refCircle.r + r_i + 2);
        bestY = refCircle.y + Math.sin(angle) * (refCircle.r + r_i + 2);
      }
      placed.push({ id: sorted[i].id, r: r_i, x: bestX, y: bestY });
    }
    return placed;
  }
  function mountColorDiagram(container, api = {}) {
    if (container === null) {
      return {
        update: () => void 0,
        selectCluster: () => void 0,
        showApplyBar: () => void 0,
        destroy: () => void 0
      };
    }
    const root = document.createElement("div");
    root.className = "color-diagram-root";
    container.replaceChildren(root);
    let rawColorsOutput = null;
    let activeColorsOutput = null;
    const history = new PaletteEditHistory();
    let activeTool = "none";
    let viewMode = "output";
    let currentMaxColors = api.getMaxColors ? api.getMaxColors() : 35;
    if (!currentMaxColors || currentMaxColors <= 0) currentMaxColors = 35;
    let selectedClusterIndex = null;
    let forceShowApplyBar = false;
    const bubblePositionCache = /* @__PURE__ */ new Map();
    const header = document.createElement("div");
    header.className = "cd-header";
    const applyBar = document.createElement("div");
    applyBar.className = "cd-apply-bar";
    applyBar.style.display = "none";
    const btnDiscard = document.createElement("button");
    btnDiscard.type = "button";
    btnDiscard.className = "cd-btn-discard";
    btnDiscard.innerHTML = "<span>&larr;</span><span>Discard</span>";
    const btnApply = document.createElement("button");
    btnApply.type = "button";
    btnApply.className = "cd-btn-apply";
    btnApply.innerHTML = "<span>Apply</span><span>&rarr;</span>";
    applyBar.append(btnDiscard, btnApply);
    const btnAllTools = document.createElement("button");
    btnAllTools.type = "button";
    btnAllTools.className = "cd-btn-all-tools";
    btnAllTools.innerHTML = "<span>&larr;</span><span>All tools</span>";
    const headerActions = document.createElement("div");
    headerActions.className = "cd-header-actions";
    const btnUndo = document.createElement("button");
    btnUndo.type = "button";
    btnUndo.className = "cd-icon-btn";
    btnUndo.title = "Undo";
    btnUndo.disabled = true;
    btnUndo.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path></svg>`;
    const btnRedo = document.createElement("button");
    btnRedo.type = "button";
    btnRedo.className = "cd-icon-btn";
    btnRedo.title = "Redo";
    btnRedo.disabled = true;
    btnRedo.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"></path><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"></path></svg>`;
    const badgeCount = document.createElement("div");
    badgeCount.className = "cd-badge-count";
    badgeCount.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="4" fill="currentColor"></circle></svg><span id="cd-count-text">${currentMaxColors}</span>`;
    headerActions.append(btnUndo, btnRedo, badgeCount);
    header.append(applyBar, btnAllTools, headerActions);
    const canvasContainer = document.createElement("div");
    canvasContainer.className = "cd-canvas-container";
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "cd-svg-stage");
    svg.setAttribute("viewBox", "0 0 440 360");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    canvasContainer.append(svg);
    const editorPanel = document.createElement("div");
    editorPanel.className = "cd-editor-panel";
    editorPanel.style.display = "none";
    editorPanel.innerHTML = `
    <div class="cd-editor-row">
      <div class="cd-editor-field">
        <label>RGB</label>
        <div class="cd-colorwell-wrap">
          <input type="color" id="cd-edit-colorwell" class="cd-colorwell" />
          <input type="text" id="cd-edit-hex" class="cd-hex-input" maxlength="7" spellcheck="false" />
        </div>
      </div>
      <div class="cd-editor-field">
        <label>A</label>
        <input type="number" id="cd-edit-alpha" class="cd-alpha-input" min="0" max="255" value="255" />
      </div>
      <div class="cd-editor-field cd-eye-field">
        <label class="cd-eye-toggle" title="Toggle visibility">
          <input type="checkbox" id="cd-edit-eye" checked />
          <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
        </label>
      </div>
      <div class="cd-editor-actions">
        <button type="button" id="cd-edit-revert" class="cd-btn-circle" title="Revert"><svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.2" fill="none"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg></button>
        <button type="button" id="cd-edit-cancel" class="cd-btn-circle cd-btn-cancel" title="Cancel"><svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M18 6 6 18M6 6l12 12"></path></svg></button>
        <button type="button" id="cd-edit-accept" class="cd-btn-circle cd-btn-accept" title="Accept"><svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg></button>
      </div>
    </div>
  `;
    canvasContainer.append(editorPanel);
    const editColorwell = editorPanel.querySelector("#cd-edit-colorwell");
    const editHex = editorPanel.querySelector("#cd-edit-hex");
    const editAlpha = editorPanel.querySelector("#cd-edit-alpha");
    const editEye = editorPanel.querySelector("#cd-edit-eye");
    const editRevert = editorPanel.querySelector("#cd-edit-revert");
    const editCancel = editorPanel.querySelector("#cd-edit-cancel");
    const editAccept = editorPanel.querySelector("#cd-edit-accept");
    editColorwell.addEventListener("input", () => {
      editHex.value = editColorwell.value;
      previewCurrentEditorTweak();
    });
    editHex.addEventListener("change", () => {
      let val = editHex.value.trim();
      if (!val.startsWith("#")) val = "#" + val;
      if (/^#[0-9a-f]{6}$/i.test(val)) {
        editColorwell.value = val;
        previewCurrentEditorTweak();
      }
    });
    editAlpha.addEventListener("input", () => {
      previewCurrentEditorTweak();
    });
    editEye.addEventListener("change", () => {
      previewCurrentEditorTweak();
    });
    editRevert.addEventListener("click", () => {
      if (selectedClusterIndex !== null && rawColorsOutput) {
        const orig = rawColorsOutput.palette[selectedClusterIndex];
        if (orig) {
          const hex = rgbToHex(orig);
          editColorwell.value = hex;
          editHex.value = hex;
          editAlpha.value = "255";
          editEye.checked = true;
          previewCurrentEditorTweak();
        }
      }
    });
    editCancel.addEventListener("click", () => {
      closeEditor();
    });
    editAccept.addEventListener("click", () => {
      if (selectedClusterIndex !== null) {
        const hex = editHex.value;
        const alpha = Number(editAlpha.value);
        const isVisible = editEye.checked;
        if (!isVisible) {
          applyEditAction({ kind: "hide", cluster: selectedClusterIndex, hidden: true });
        } else {
          applyEditAction({ kind: "recolor", cluster: selectedClusterIndex, hex, alpha });
        }
      }
      closeEditor();
    });
    function previewCurrentEditorTweak() {
      if (selectedClusterIndex === null || !activeColorsOutput) return;
      const hex = editHex.value;
      const alpha = Number(editAlpha.value);
      const isVisible = editEye.checked;
      let tweaked;
      if (!isVisible) {
        tweaked = applyHide(activeColorsOutput, selectedClusterIndex, true);
      } else {
        tweaked = applyRecolor(activeColorsOutput, selectedClusterIndex, hex, alpha);
      }
      api.onPreviewUpdate?.(tweaked.colors);
    }
    function openEditor(clusterIndex) {
      selectedClusterIndex = clusterIndex;
      if (!activeColorsOutput) return;
      const cluster = activeColorsOutput.palette[clusterIndex];
      if (!cluster) return;
      const hex = rgbToHex(cluster);
      editColorwell.value = hex;
      editHex.value = hex;
      editAlpha.value = "255";
      editEye.checked = true;
      editorPanel.style.display = "block";
      const dimmed = createDimmedPreview(activeColorsOutput, clusterIndex);
      api.onSelectCluster?.(clusterIndex, dimmed);
      api.onPreviewUpdate?.(dimmed);
      renderBubbles();
    }
    function closeEditor() {
      selectedClusterIndex = null;
      editorPanel.style.display = "none";
      if (activeColorsOutput) {
        api.onPreviewUpdate?.(activeColorsOutput.colors);
      }
      api.onSelectCluster?.(null, null);
      renderBubbles();
    }
    const toolRow = document.createElement("div");
    toolRow.className = "cd-tool-row";
    const toggleView = document.createElement("div");
    toggleView.className = "cd-toggle-view cd-output-mode";
    toggleView.innerHTML = `
    <span class="cd-toggle-label">Original</span>
    <div class="cd-toggle-pill">
      <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none"><path d="m7 16-4-4 4-4"></path><path d="m17 8 4 4-4 4"></path><path d="M3 12h18"></path></svg>
    </div>
    <span class="cd-toggle-label">Output</span>
  `;
    toggleView.addEventListener("click", () => {
      viewMode = viewMode === "original" ? "output" : "original";
      toggleView.classList.toggle("cd-output-mode", viewMode === "output");
      renderBubbles();
      api.onToggleView?.(viewMode);
    });
    const btnMerge = document.createElement("button");
    btnMerge.type = "button";
    btnMerge.className = "cd-tool-btn";
    btnMerge.innerHTML = `
    <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none">
      <circle cx="6" cy="12" r="3.5"></circle>
      <circle cx="18" cy="12" r="3.5"></circle>
      <path d="M9.5 12h5"></path>
    </svg>
    <span>Merge</span>
  `;
    btnMerge.addEventListener("click", () => {
      setTool(activeTool === "merge" ? "none" : "merge");
    });
    const btnSplit = document.createElement("button");
    btnSplit.type = "button";
    btnSplit.className = "cd-tool-btn";
    btnSplit.innerHTML = `
    <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none">
      <circle cx="12" cy="12" r="4"></circle>
      <circle cx="6" cy="6" r="2.5"></circle>
      <circle cx="18" cy="18" r="2.5"></circle>
      <path d="M9.5 9.5 7.5 7.5M14.5 14.5l2 2"></path>
    </svg>
    <span>Split</span>
  `;
    btnSplit.addEventListener("click", () => {
      setTool(activeTool === "split" ? "none" : "split");
    });
    const btnEdit = document.createElement("button");
    btnEdit.type = "button";
    btnEdit.className = "cd-tool-btn";
    btnEdit.innerHTML = `
    <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none">
      <circle cx="12" cy="12" r="9"></circle>
      <circle cx="12" cy="12" r="3" fill="currentColor"></circle>
      <path d="m14 14 6 6"></path>
    </svg>
    <span>Edit</span>
  `;
    btnEdit.addEventListener("click", () => {
      setTool(activeTool === "edit" ? "none" : "edit");
    });
    toolRow.append(toggleView, btnMerge, btnSplit, btnEdit);
    const presetsSection = document.createElement("div");
    presetsSection.className = "cd-presets-section";
    const presetsHeader = document.createElement("div");
    presetsHeader.className = "cd-presets-title";
    presetsHeader.innerHTML = `Palette Presets <span class="cd-presets-subtitle">(processing color count)</span>`;
    const swatchGrid = document.createElement("div");
    swatchGrid.className = "cd-swatch-grid";
    const MAX_PRESET_COUNT = 48;
    const swatchButtons = [];
    for (let count = 1; count <= MAX_PRESET_COUNT; count++) {
      const swatch = document.createElement("div");
      swatch.className = "cd-swatch";
      swatch.textContent = String(count);
      swatch.dataset.count = String(count);
      const hue = count * 137.508 % 360;
      const lightness = 40 + count * 19 % 25;
      swatch.style.backgroundColor = `hsl(${hue}, 70%, ${lightness}%)`;
      if (count === currentMaxColors) {
        swatch.classList.add("selected");
      }
      swatch.addEventListener("click", () => {
        handleMaxColorsChange(count);
      });
      swatchGrid.append(swatch);
      swatchButtons.push(swatch);
    }
    presetsSection.append(presetsHeader, swatchGrid);
    root.append(header, canvasContainer, toolRow, presetsSection);
    function handleMaxColorsChange(newCount) {
      if (newCount === currentMaxColors) return;
      currentMaxColors = newCount;
      updateSelectedPreset();
      api.onSetMaxColors?.(newCount);
    }
    function updateSelectedPreset() {
      const badgeText = root.querySelector("#cd-count-text");
      if (badgeText) badgeText.textContent = String(currentMaxColors);
      for (const btn of swatchButtons) {
        const c = Number(btn.dataset.count);
        btn.classList.toggle("selected", c === currentMaxColors);
      }
    }
    function setTool(tool) {
      activeTool = tool;
      btnMerge.classList.toggle("active", activeTool === "merge");
      btnSplit.classList.toggle("active", activeTool === "split");
      btnEdit.classList.toggle("active", activeTool === "edit");
    }
    function syncDiscardApplyBar() {
      if (forceShowApplyBar) {
        applyBar.style.display = "inline-flex";
        btnAllTools.style.display = "none";
        return;
      }
      if (!rawColorsOutput || !activeColorsOutput) {
        applyBar.style.display = "none";
        btnAllTools.style.display = "inline-flex";
        return;
      }
      const hasNetChanges = !isNetZeroEdits(rawColorsOutput, activeColorsOutput);
      if (hasNetChanges) {
        applyBar.style.display = "inline-flex";
        btnAllTools.style.display = "none";
      } else {
        applyBar.style.display = "none";
        btnAllTools.style.display = "inline-flex";
      }
    }
    btnDiscard.addEventListener("click", () => {
      history.clear();
      forceShowApplyBar = false;
      if (rawColorsOutput) {
        activeColorsOutput = rawColorsOutput;
        api.onPreviewUpdate?.(activeColorsOutput.colors);
        api.onEditsChanged?.([], activeColorsOutput);
        api.onDiscard?.();
      }
      syncHistoryButtons();
      syncDiscardApplyBar();
      renderBubbles();
    });
    btnApply.addEventListener("click", () => {
      if (activeColorsOutput) {
        api.onApply?.(activeColorsOutput);
      }
    });
    function applyEditAction(edit) {
      if (!rawColorsOutput) return;
      history.push(edit);
      activeColorsOutput = applyEdits(rawColorsOutput, history.getEdits());
      syncHistoryButtons();
      syncDiscardApplyBar();
      renderBubbles();
      api.onPreviewUpdate?.(activeColorsOutput.colors);
      if (edit.kind === "merge") api.onMerge?.(edit.from, edit.to);
      else if (edit.kind === "split") api.onSplit?.(edit.cluster, edit.k ?? 2);
      else if (edit.kind === "splitShade") api.onSplitShade?.(edit.cluster, edit.shadeIndex);
      else if (edit.kind === "recolor") api.onRecolor?.(edit.cluster, edit.hex, edit.alpha);
      else if (edit.kind === "hide") api.onHide?.(edit.cluster, edit.hidden);
      api.onEditsChanged?.(history.getEdits(), activeColorsOutput);
    }
    function syncHistoryButtons() {
      btnUndo.disabled = !history.canUndo();
      btnRedo.disabled = !history.canRedo();
    }
    btnUndo.addEventListener("click", () => {
      if (!rawColorsOutput) return;
      const undone = history.undo();
      if (undone) {
        activeColorsOutput = applyEdits(rawColorsOutput, history.getEdits());
        syncHistoryButtons();
        syncDiscardApplyBar();
        renderBubbles();
        api.onPreviewUpdate?.(activeColorsOutput.colors);
        api.onUndo?.();
        api.onEditsChanged?.(history.getEdits(), activeColorsOutput);
      }
    });
    btnRedo.addEventListener("click", () => {
      if (!rawColorsOutput) return;
      const redone = history.redo();
      if (redone) {
        activeColorsOutput = applyEdits(rawColorsOutput, history.getEdits());
        syncHistoryButtons();
        syncDiscardApplyBar();
        renderBubbles();
        api.onPreviewUpdate?.(activeColorsOutput.colors);
        api.onRedo?.();
        api.onEditsChanged?.(history.getEdits(), activeColorsOutput);
      }
    });
    function computeStablePackedPositions(clusters) {
      const viewW = 440;
      const viewH = 340;
      const maxPixels = Math.max(...clusters.map((c) => c.pixelCount), 1);
      const items = clusters.map((c) => {
        const normalized = Math.sqrt(c.pixelCount / maxPixels);
        const r = Math.max(20, Math.min(65, normalized * 62));
        return { id: c.index, r, hex: c.hex };
      });
      const allCached = items.every((it) => bubblePositionCache.has(it.hex));
      if (allCached) {
        return items.map((it) => {
          const pos = bubblePositionCache.get(it.hex);
          return { id: it.id, x: pos.x, y: pos.y, r: it.r };
        });
      }
      const sorted = [...items].sort((a, b) => b.r - a.r);
      const packed = packCirclesDeterministic(sorted);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      packed.forEach((p) => {
        minX = Math.min(minX, p.x - p.r);
        maxX = Math.max(maxX, p.x + p.r);
        minY = Math.min(minY, p.y - p.r);
        maxY = Math.max(maxY, p.y + p.r);
      });
      const pad = 24;
      const packW = Math.max(1, maxX - minX);
      const packH = Math.max(1, maxY - minY);
      const scale = Math.min((viewW - pad * 2) / packW, (viewH - pad * 2) / packH, 1.15);
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const results = [];
      packed.forEach((p) => {
        const orig = items.find((it) => it.id === p.id);
        const x = viewW / 2 + (p.x - centerX) * scale;
        const y = viewH / 2 + (p.y - centerY) * scale;
        const r = p.r * scale;
        if (orig) {
          bubblePositionCache.set(orig.hex, { x, y });
        }
        results.push({ id: p.id, x, y, r });
      });
      return results;
    }
    function renderBubbles() {
      svg.replaceChildren();
      if (!activeColorsOutput || activeColorsOutput.palette.length === 0) {
        const text = document.createElementNS(SVG_NS, "text");
        text.setAttribute("x", "220");
        text.setAttribute("y", "180");
        text.setAttribute("fill", "#64748b");
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("font-size", "14");
        text.textContent = "\u0E44\u0E21\u0E48\u0E21\u0E35\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E01\u0E25\u0E38\u0E48\u0E21\u0E2A\u0E35 (No color clusters)";
        svg.append(text);
        return;
      }
      const clusters = extractClusters(activeColorsOutput);
      if (clusters.length === 0) return;
      const defs = document.createElementNS(SVG_NS, "defs");
      const filter = document.createElementNS(SVG_NS, "filter");
      filter.setAttribute("id", "cd-bubble-shadow");
      filter.setAttribute("x", "-20%");
      filter.setAttribute("y", "-20%");
      filter.setAttribute("width", "140%");
      filter.setAttribute("height", "140%");
      filter.innerHTML = `<feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000000" flood-opacity="0.45" />`;
      defs.append(filter);
      clusters.forEach((c) => {
        const grad = document.createElementNS(SVG_NS, "radialGradient");
        grad.setAttribute("id", `cd-grad-${c.index}`);
        grad.setAttribute("cx", "35%");
        grad.setAttribute("cy", "35%");
        grad.setAttribute("r", "70%");
        grad.setAttribute("fx", "30%");
        grad.setAttribute("fy", "30%");
        const stop0 = document.createElementNS(SVG_NS, "stop");
        stop0.setAttribute("offset", "0%");
        stop0.setAttribute("stop-color", lightenHex(c.hex, 0.25));
        const stop1 = document.createElementNS(SVG_NS, "stop");
        stop1.setAttribute("offset", "75%");
        stop1.setAttribute("stop-color", c.hex);
        const stop2 = document.createElementNS(SVG_NS, "stop");
        stop2.setAttribute("offset", "100%");
        stop2.setAttribute("stop-color", darkenHex(c.hex, 0.3));
        grad.append(stop0, stop1, stop2);
        defs.append(grad);
      });
      svg.append(defs);
      const positioned = computeStablePackedPositions(clusters);
      const clusterMap = new Map(clusters.map((c) => [c.index, c]));
      positioned.forEach((p) => {
        const cluster = clusterMap.get(p.id);
        if (!cluster) return;
        const group = document.createElementNS(SVG_NS, "g");
        group.setAttribute("class", "cd-bubble-group");
        group.dataset.cluster = String(cluster.index);
        if (selectedClusterIndex === cluster.index) {
          group.classList.add("cd-selected-bubble");
        }
        const mainCircle = document.createElementNS(SVG_NS, "circle");
        mainCircle.setAttribute("class", "cd-main-bubble");
        mainCircle.setAttribute("cx", String(p.x));
        mainCircle.setAttribute("cy", String(p.y));
        mainCircle.setAttribute("r", String(p.r));
        mainCircle.setAttribute("fill", `url(#cd-grad-${cluster.index})`);
        mainCircle.setAttribute("stroke", selectedClusterIndex === cluster.index ? "#38bdf8" : "rgba(255, 255, 255, 0.12)");
        mainCircle.setAttribute("stroke-width", selectedClusterIndex === cluster.index ? "3.5" : "1");
        mainCircle.setAttribute("filter", "url(#cd-bubble-shadow)");
        group.append(mainCircle);
        if (cluster.subShades.length > 0 && p.r > 16) {
          const subCount = cluster.subShades.length;
          const subRadius = Math.max(3.5, Math.min(9.5, p.r * 0.65 / Math.sqrt(subCount)));
          cluster.subShades.forEach((shade, sIdx) => {
            const subAngle = sIdx * 2.399963229728653;
            const subDist = Math.min(p.r * 0.65, Math.sqrt(sIdx + 0.5) * subRadius * 1.5);
            const scx = p.x + Math.cos(subAngle) * subDist;
            const scy = p.y + Math.sin(subAngle) * subDist;
            const subCircle = document.createElementNS(SVG_NS, "circle");
            subCircle.setAttribute("class", "cd-sub-bubble");
            subCircle.dataset.cluster = String(cluster.index);
            subCircle.dataset.shadeIndex = String(sIdx);
            subCircle.setAttribute("cx", String(scx));
            subCircle.setAttribute("cy", String(scy));
            subCircle.setAttribute("r", String(subRadius));
            subCircle.setAttribute("fill", viewMode === "original" ? shade.hex : lightenHex(cluster.hex, 0.15));
            subCircle.setAttribute("stroke", "rgba(255, 255, 255, 0.28)");
            subCircle.setAttribute("stroke-width", "0.75");
            subCircle.setAttribute("cursor", "grab");
            subCircle.addEventListener("pointerdown", (event) => {
              event.stopPropagation();
              const startX = event.clientX;
              const startY = event.clientY;
              let isDraggingOut = false;
              const onPointerMove = (moveEv) => {
                const dist = Math.hypot(moveEv.clientX - startX, moveEv.clientY - startY);
                if (dist > p.r * 0.75) {
                  isDraggingOut = true;
                  subCircle.classList.add("cd-drag-out");
                }
              };
              const onPointerUp = () => {
                window.removeEventListener("pointermove", onPointerMove);
                window.removeEventListener("pointerup", onPointerUp);
                subCircle.classList.remove("cd-drag-out");
                if (isDraggingOut) {
                  applyEditAction({ kind: "splitShade", cluster: cluster.index, shadeIndex: sIdx });
                }
              };
              window.addEventListener("pointermove", onPointerMove);
              window.addEventListener("pointerup", onPointerUp);
            });
            group.append(subCircle);
          });
        }
        group.addEventListener("pointerdown", (event) => {
          if (activeTool === "split") {
            applyEditAction({ kind: "split", cluster: cluster.index, k: 2 });
            return;
          }
          if (activeTool === "edit") {
            openEditor(cluster.index);
            return;
          }
          const startX = event.clientX;
          const startY = event.clientY;
          let isDragging = false;
          const onPointerMove = (moveEvent) => {
            const dist = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
            if (dist > 5 && !isDragging) {
              isDragging = true;
              group.classList.add("cd-drag-source");
            }
            if (isDragging) {
              const elements = document.elementsFromPoint(moveEvent.clientX, moveEvent.clientY);
              const targetGroup = elements.find((el) => el.classList.contains("cd-bubble-group"));
              svg.querySelectorAll(".cd-drop-target").forEach((el) => el.classList.remove("cd-drop-target"));
              if (targetGroup && targetGroup.dataset.cluster !== String(cluster.index)) {
                targetGroup.classList.add("cd-drop-target");
              }
            }
          };
          const onPointerUp = (upEvent) => {
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
            group.classList.remove("cd-drag-source");
            const elements = document.elementsFromPoint(upEvent.clientX, upEvent.clientY);
            const targetGroup = elements.find((el) => el.classList.contains("cd-bubble-group"));
            svg.querySelectorAll(".cd-drop-target").forEach((el) => el.classList.remove("cd-drop-target"));
            if (isDragging && targetGroup) {
              const targetCluster = Number(targetGroup.dataset.cluster);
              if (!isNaN(targetCluster) && targetCluster !== cluster.index) {
                applyEditAction({ kind: "merge", from: cluster.index, to: targetCluster });
              }
            } else if (!isDragging) {
              if (selectedClusterIndex === cluster.index) {
                closeEditor();
              } else {
                openEditor(cluster.index);
              }
            }
          };
          window.addEventListener("pointermove", onPointerMove);
          window.addEventListener("pointerup", onPointerUp);
        });
        svg.append(group);
      });
    }
    return {
      update(colorsOutput, options) {
        if (options?.maxColors !== void 0 && options.maxColors > 0) {
          currentMaxColors = options.maxColors;
          updateSelectedPreset();
        }
        const prevRaw = rawColorsOutput;
        rawColorsOutput = colorsOutput;
        if (colorsOutput) {
          if (prevRaw && prevRaw.palette.length !== colorsOutput.palette.length && history.getEdits().length > 0) {
            const { remappedEdits } = remapEditsAcrossMaxColors(history.getEdits(), prevRaw, colorsOutput);
            history.setEdits(remappedEdits);
          }
          activeColorsOutput = applyEdits(colorsOutput, history.getEdits());
        } else {
          activeColorsOutput = null;
        }
        syncHistoryButtons();
        syncDiscardApplyBar();
        renderBubbles();
      },
      selectCluster(clusterIndex) {
        if (clusterIndex === null) {
          closeEditor();
        } else {
          openEditor(clusterIndex);
        }
      },
      showApplyBar(show) {
        forceShowApplyBar = show;
        syncDiscardApplyBar();
      },
      destroy() {
        container.replaceChildren();
      }
    };
  }
  function lightenHex(hex, percent) {
    const rgb = hexToRgb(hex);
    const r = Math.min(255, Math.round(rgb.r + (255 - rgb.r) * percent));
    const g = Math.min(255, Math.round(rgb.g + (255 - rgb.g) * percent));
    const b = Math.min(255, Math.round(rgb.b + (255 - rgb.b) * percent));
    return rgbToHex({ r, g, b });
  }
  function darkenHex(hex, percent) {
    const rgb = hexToRgb(hex);
    const r = Math.max(0, Math.round(rgb.r * (1 - percent)));
    const g = Math.max(0, Math.round(rgb.g * (1 - percent)));
    const b = Math.max(0, Math.round(rgb.b * (1 - percent)));
    return rgbToHex({ r, g, b });
  }

  // scripts/color-diagram-demo.ts
  function generateSampleStage() {
    const width = 240;
    const height = 90;
    const count = width * height;
    const palette = [
      { r: 226, g: 148, b: 52 },
      // 0: Orange #e29434
      { r: 223, g: 78, b: 64 },
      // 1: Red #df4e40
      { r: 101, g: 199, b: 91 },
      // 2: Green #65c75b
      { r: 30, g: 116, b: 232 },
      // 3: Blue #1e74e8
      { r: 152, g: 85, b: 203 },
      // 4: Purple #9855cb
      { r: 245, g: 245, b: 247 },
      // 5: White #f5f5f7
      { r: 42, g: 45, b: 55 },
      // 6: Dark Charcoal #2a2d37
      { r: 126, g: 126, b: 131 }
      // 7: Metal Gray #7e7e83
    ];
    const labels = new Int16Array(count);
    const punchLabels = new Int16Array(count);
    const opaque = new Uint8Array(count);
    const colors = new Uint8Array(count * 4);
    const sourceRgba = new Uint8Array(count * 4);
    labels.fill(6);
    punchLabels.fill(6);
    opaque.fill(255);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        let label = 6;
        const d1 = Math.hypot(x - 35, y - 45);
        if (d1 < 22) {
          if (d1 < 9) label = 3;
          else if (y < 45 && x >= 35) label = 0;
          else if (x < 35 && y > 35) label = 2;
          else label = 1;
        }
        const d2 = Math.hypot(x - 85, y - 45);
        if (d2 < 22) {
          if (d2 < 14) label = 5;
          else label = 7;
        }
        const d3 = Math.hypot(x - 135, y - 45);
        if (d3 < 20) {
          if (x > 125 && x < 133 && y > 38 && y < 46) label = 0;
          else if (x > 137 && x < 145 && y > 38 && y < 46) label = 4;
          else if (x > 125 && x < 133 && y > 49 && y < 57) label = 2;
          else if (x > 137 && x < 145 && y > 49 && y < 57) label = 1;
          else label = 5;
        }
        const d4 = Math.hypot(x - 185, y - 45);
        if (d4 < 22) {
          if (x > 175 && x < 183 && y > 35 && y < 55 || x > 187 && x < 195 && y > 35 && y < 55) {
            label = 0;
          } else {
            label = 6;
          }
        }
        if (x > 133 && x < 137 && y > 76 && y < 80) {
          label = 0;
        }
        labels[idx] = label;
        punchLabels[idx] = label;
        const c = palette[label];
        const offset = idx * 4;
        const jitter = (x * 17 + y * 31) % 9 - 4;
        const sr = Math.max(0, Math.min(255, c.r + jitter * 2));
        const sg = Math.max(0, Math.min(255, c.g + jitter));
        const sb = Math.max(0, Math.min(255, c.b + jitter * 2));
        sourceRgba[offset] = sr;
        sourceRgba[offset + 1] = sg;
        sourceRgba[offset + 2] = sb;
        sourceRgba[offset + 3] = 255;
        colors[offset] = c.r;
        colors[offset + 1] = c.g;
        colors[offset + 2] = c.b;
        colors[offset + 3] = 255;
      }
    }
    return {
      colors,
      labels,
      punchLabels,
      palette,
      opaque,
      spread: 0,
      sourceRgba
    };
  }
  function initDemo() {
    const container = document.getElementById("diagram-container");
    const previewCanvas = document.getElementById("preview-canvas");
    const previewCtx = previewCanvas.getContext("2d");
    const baseStage = generateSampleStage();
    previewCanvas.width = 240;
    previewCanvas.height = 90;
    function renderPreviewRaster(rgba) {
      if (!previewCtx) return;
      const imgData = previewCtx.createImageData(240, 90);
      imgData.data.set(rgba);
      previewCtx.putImageData(imgData, 0, 0);
    }
    const diagram = mountColorDiagram(container, {
      onSelectCluster: (clusterIndex, dimmedRaster) => {
        if (dimmedRaster) {
          renderPreviewRaster(dimmedRaster);
        } else {
          renderPreviewRaster(baseStage.colors);
        }
      },
      onPreviewUpdate: (raster) => {
        renderPreviewRaster(raster);
      },
      onApply: () => {
        console.log("Apply clicked, rerunning downstream steps 3-8!");
      },
      onDiscard: () => {
        renderPreviewRaster(baseStage.colors);
      }
    });
    diagram.update(baseStage, { maxColors: 6 });
    diagram.showApplyBar(true);
    diagram.selectCluster(0);
    const dimmed = createDimmedPreview(baseStage, 0);
    renderPreviewRaster(dimmed);
  }
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", initDemo);
  } else {
    initDemo();
  }
})();
