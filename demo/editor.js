"use strict";
(() => {
  // src/color/model.ts
  var TRANSPARENT = 65535;
  var defaultZapThresholds = {
    maxSpeckleArea: 48,
    speckleAreaRatio: 4e-4,
    maxThinWidth: 1,
    minBoundaryRatio: 1,
    maxFragmentArea: 2e3,
    fragmentAreaRatio: 0.08
  };
  var HISTORY_LIMIT = 50;
  function rgbHex(color) {
    const channel = (value) => value.toString(16).padStart(2, "0");
    return "#" + channel(color.r) + channel(color.g) + channel(color.b);
  }
  function colorDistance(a, b) {
    const dr = a.r - b.r;
    const dg = a.g - b.g;
    const db = a.b - b.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }
  function sameRgb(a, b) {
    return a.r === b.r && a.g === b.g && a.b === b.b;
  }
  function clonePalette(palette) {
    return palette.map((color) => ({ r: color.r, g: color.g, b: color.b }));
  }
  var ColorDocument = class _ColorDocument {
    constructor(segmentation, thresholds) {
      this.past = [];
      this.future = [];
      this.width = segmentation.width;
      this.height = segmentation.height;
      this.labels = segmentation.labels.slice();
      this.palette = clonePalette(segmentation.palette);
      this.active = this.palette.length > 0 ? largestIndex(this.labels, this.palette.length) : -1;
      this.thresholds = { ...thresholds };
      this.original = this.capture();
    }
    static fromSegmentation(segmentation, thresholds = defaultZapThresholds) {
      if (segmentation.labels.length !== segmentation.width * segmentation.height) {
        throw new Error("\u0E02\u0E19\u0E32\u0E14 label map \u0E44\u0E21\u0E48\u0E15\u0E23\u0E07\u0E01\u0E31\u0E1A\u0E20\u0E32\u0E1E");
      }
      return new _ColorDocument(segmentation, thresholds);
    }
    colorCount() {
      return this.palette.length;
    }
    counts() {
      const totals = new Array(this.palette.length).fill(0);
      for (let i = 0; i < this.labels.length; i++) {
        const label = this.labels[i] ?? TRANSPARENT;
        if (label !== TRANSPARENT && label < totals.length) totals[label] = (totals[label] ?? 0) + 1;
      }
      return totals;
    }
    /** True when labels or palette differ from the segmentation this document was opened with. */
    dirty() {
      if (this.palette.length !== this.original.palette.length) return true;
      for (let i = 0; i < this.palette.length; i++) {
        const current = this.palette[i];
        const initial = this.original.palette[i];
        if (!current || !initial || !sameRgb(current, initial)) return true;
      }
      for (let i = 0; i < this.labels.length; i++) {
        if (this.labels[i] !== this.original.labels[i]) return true;
      }
      return false;
    }
    canUndo() {
      return this.past.length > 0;
    }
    canRedo() {
      return this.future.length > 0;
    }
    segmentation() {
      return {
        width: this.width,
        height: this.height,
        labels: this.labels.slice(),
        palette: clonePalette(this.palette)
      };
    }
    setThresholds(partial) {
      this.thresholds = { ...this.thresholds, ...partial };
    }
    setActive(index) {
      if (index >= 0 && index < this.palette.length) this.active = index;
    }
    undo() {
      const previous = this.past.pop();
      if (!previous) return false;
      this.future.push(this.capture());
      this.restore(previous);
      return true;
    }
    redo() {
      const next = this.future.pop();
      if (!next) return false;
      this.past.push(this.capture());
      this.restore(next);
      return true;
    }
    revert() {
      if (!this.dirty()) return false;
      this.pushHistory();
      this.restore(this.original);
      return true;
    }
    zap(x, y) {
      if (!this.inBounds(x, y)) return { ok: false, reason: "\u0E04\u0E25\u0E34\u0E01\u0E19\u0E2D\u0E01\u0E20\u0E32\u0E1E" };
      const index = y * this.width + x;
      const label = this.labels[index] ?? TRANSPARENT;
      if (label === TRANSPARENT) return { ok: false, reason: "\u0E08\u0E38\u0E14\u0E19\u0E35\u0E49\u0E42\u0E1B\u0E23\u0E48\u0E07\u0E43\u0E2A \u0E44\u0E21\u0E48\u0E21\u0E35\u0E40\u0E28\u0E29\u0E2A\u0E35\u0E43\u0E2B\u0E49 Zap" };
      if (!this.palette[label]) return { ok: false, reason: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E2A\u0E35\u0E02\u0E2D\u0E07\u0E08\u0E38\u0E14\u0E19\u0E35\u0E49" };
      const found = componentsOf(this.labels, this.width, this.height, label);
      const clicked = found.components[found.owner[index] ?? -1];
      if (!clicked) return { ok: false, reason: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E0A\u0E34\u0E49\u0E19\u0E2A\u0E35\u0E15\u0E23\u0E07\u0E19\u0E35\u0E49" };
      const areaLimit = areaCap(this.thresholds.maxSpeckleArea, this.thresholds.speckleAreaRatio, this.labels.length);
      const fragmentCap = areaCap(this.thresholds.maxFragmentArea, this.thresholds.fragmentAreaRatio, this.labels.length);
      const clickedStats = measure(clicked, this.width, this.height, this.thresholds, areaLimit, fragmentCap);
      if (!clickedStats.zappable) return { ok: false, reason: refusal(clickedStats, this.thresholds, areaLimit) };
      const plan = [];
      for (const component of found.components) {
        const stats = component === clicked ? clickedStats : measure(component, this.width, this.height, this.thresholds, areaLimit, fragmentCap);
        if (!stats.zappable) continue;
        const target = bestNeighbor(component, label, this.palette);
        if (target === null) continue;
        plan.push({ pixels: component.pixels, target });
      }
      if (!plan.some((item) => item.pixels === clicked.pixels)) {
        return { ok: false, reason: "\u0E40\u0E28\u0E29\u0E19\u0E35\u0E49\u0E44\u0E21\u0E48\u0E15\u0E34\u0E14\u0E01\u0E31\u0E1A\u0E2A\u0E35\u0E2D\u0E37\u0E48\u0E19 \u0E08\u0E36\u0E07\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E23\u0E27\u0E21" };
      }
      const before = this.colorCount();
      this.pushHistory();
      for (const item of plan) {
        for (const pixel of item.pixels) this.labels[pixel] = item.target;
      }
      const indexMap = this.compact();
      return {
        ok: true,
        changed: true,
        indexMap,
        detail: "Zap \u0E23\u0E27\u0E21 " + plan.length + " \u0E0A\u0E34\u0E49\u0E19\u0E40\u0E02\u0E49\u0E32\u0E01\u0E31\u0E1A\u0E2A\u0E35\u0E02\u0E49\u0E32\u0E07\u0E40\u0E04\u0E35\u0E22\u0E07 \xB7 " + before + " \u2192 " + this.colorCount() + " \u0E2A\u0E35"
      };
    }
    fill(x, y) {
      if (!this.inBounds(x, y)) return { ok: false, reason: "\u0E04\u0E25\u0E34\u0E01\u0E19\u0E2D\u0E01\u0E20\u0E32\u0E1E" };
      if (this.active < 0) return { ok: false, reason: "\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E2A\u0E35\u0E17\u0E35\u0E48\u0E40\u0E25\u0E37\u0E2D\u0E01" };
      const source = this.labels[y * this.width + x] ?? TRANSPARENT;
      const target = this.active;
      if (source === target) return { ok: true, changed: false, indexMap: null, detail: "" };
      this.pushHistory();
      const stack = [y * this.width + x];
      const seen = new Uint8Array(this.labels.length);
      seen[y * this.width + x] = 1;
      while (stack.length > 0) {
        const current = stack.pop();
        if (current === void 0) break;
        this.labels[current] = target;
        const cx = current % this.width;
        const cy = (current - cx) / this.width;
        const neighbors = [
          cx > 0 ? current - 1 : -1,
          cx + 1 < this.width ? current + 1 : -1,
          cy > 0 ? current - this.width : -1,
          cy + 1 < this.height ? current + this.width : -1
        ];
        for (const next of neighbors) {
          if (next < 0 || seen[next] === 1) continue;
          if ((this.labels[next] ?? TRANSPARENT) !== source) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
      const indexMap = this.compact();
      return { ok: true, changed: true, indexMap, detail: "\u0E40\u0E17\u0E2A\u0E35\u0E41\u0E25\u0E49\u0E27 \xB7 " + this.colorCount() + " \u0E2A\u0E35" };
    }
    /** Paint one pixel. The first changed pixel of a stroke opens a single undo step. */
    pencil(x, y, stroke) {
      if (!this.inBounds(x, y)) return { ok: false, reason: "\u0E04\u0E25\u0E34\u0E01\u0E19\u0E2D\u0E01\u0E20\u0E32\u0E1E" };
      if (this.active < 0) return { ok: false, reason: "\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E2A\u0E35\u0E17\u0E35\u0E48\u0E40\u0E25\u0E37\u0E2D\u0E01" };
      const index = y * this.width + x;
      if ((this.labels[index] ?? TRANSPARENT) === this.active) return { ok: true, changed: false, indexMap: null, detail: "" };
      if (!stroke.pushed) {
        this.pushHistory();
        stroke.pushed = true;
      }
      this.labels[index] = this.active;
      return { ok: true, changed: true, indexMap: null, detail: "" };
    }
    /** Close a pencil stroke and drop a palette entry that no longer has pixels. */
    endPencil(stroke) {
      if (!stroke.pushed) return { ok: true, changed: false, indexMap: null, detail: "" };
      const indexMap = this.compact();
      return { ok: true, changed: true, indexMap, detail: "\u0E23\u0E30\u0E1A\u0E32\u0E22\u0E41\u0E25\u0E49\u0E27 \xB7 " + this.colorCount() + " \u0E2A\u0E35" };
    }
    /**
     * Recolor every listed color into representative and drop the others.
     * The representative is the color the user chose to keep — never inferred.
     */
    collapse(members, representative) {
      if (representative < 0 || representative >= this.palette.length) return { ok: false, reason: "\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E2A\u0E35\u0E17\u0E35\u0E48\u0E08\u0E30\u0E40\u0E01\u0E47\u0E1A" };
      const sources = members.filter((index) => index !== representative && index >= 0 && index < this.palette.length);
      if (sources.length === 0) return { ok: true, changed: false, indexMap: null, detail: "" };
      const kept = this.palette[representative];
      if (!kept) return { ok: false, reason: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E2A\u0E35\u0E17\u0E35\u0E48\u0E08\u0E30\u0E40\u0E01\u0E47\u0E1A" };
      const before = this.colorCount();
      this.pushHistory();
      const sourceSet = new Set(sources);
      for (let i = 0; i < this.labels.length; i++) {
        const label = this.labels[i] ?? TRANSPARENT;
        if (sourceSet.has(label)) this.labels[i] = representative;
      }
      if (sourceSet.has(this.active)) this.active = representative;
      const indexMap = this.compact();
      return {
        ok: true,
        changed: true,
        indexMap,
        detail: "\u0E23\u0E27\u0E21\u0E2A\u0E35\u0E41\u0E25\u0E49\u0E27 " + before + " \u2192 " + this.colorCount() + " \xB7 \u0E40\u0E01\u0E47\u0E1A " + rgbHex(kept)
      };
    }
    merge(source, target) {
      if (source === target) return { ok: true, changed: false, indexMap: null, detail: "" };
      return this.collapse([source, target], target);
    }
    inBounds(x, y) {
      return x >= 0 && y >= 0 && x < this.width && y < this.height;
    }
    capture() {
      return { labels: this.labels.slice(), palette: clonePalette(this.palette), active: this.active };
    }
    restore(snapshot) {
      this.labels = snapshot.labels.slice();
      this.palette = clonePalette(snapshot.palette);
      this.active = snapshot.active;
    }
    pushHistory() {
      this.past.push(this.capture());
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
      this.future = [];
    }
    /** Drop unused colors. Returns oldIndex -> newIndex (-1 if removed), or null if every color stayed. */
    compact() {
      const used = new Array(this.palette.length).fill(false);
      for (let i = 0; i < this.labels.length; i++) {
        const label = this.labels[i] ?? TRANSPARENT;
        if (label !== TRANSPARENT && label < used.length) used[label] = true;
      }
      if (used.every((value) => value)) return null;
      const map = new Array(this.palette.length).fill(-1);
      const next = [];
      for (let i = 0; i < this.palette.length; i++) {
        if (!used[i]) continue;
        map[i] = next.length;
        const color = this.palette[i];
        if (color) next.push(color);
      }
      const relabeled = new Uint16Array(this.labels.length);
      for (let i = 0; i < this.labels.length; i++) {
        const label = this.labels[i] ?? TRANSPARENT;
        relabeled[i] = label === TRANSPARENT ? TRANSPARENT : map[label] ?? TRANSPARENT;
      }
      this.labels = relabeled;
      this.palette = next;
      if (this.active >= 0) this.active = map[this.active] ?? (next.length > 0 ? 0 : -1);
      return map;
    }
  };
  function componentsOf(labels, width, height, label) {
    const owner = new Int32Array(labels.length);
    owner.fill(-1);
    const components = [];
    const stack = [];
    for (let start = 0; start < labels.length; start++) {
      if ((labels[start] ?? TRANSPARENT) !== label || owner[start] !== -1) continue;
      const pixels = [];
      const adjacency = /* @__PURE__ */ new Map();
      let perimeter = 0;
      const id = components.length;
      stack.push(start);
      owner[start] = id;
      while (stack.length > 0) {
        const current = stack.pop();
        if (current === void 0) break;
        pixels.push(current);
        const x = current % width;
        const y = (current - x) / width;
        const neighbors = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1]
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            perimeter++;
            continue;
          }
          const next = ny * width + nx;
          const neighbor = labels[next] ?? TRANSPARENT;
          if (neighbor === label) {
            if (owner[next] === -1) {
              owner[next] = id;
              stack.push(next);
            }
          } else {
            perimeter++;
            adjacency.set(neighbor, (adjacency.get(neighbor) ?? 0) + 1);
          }
        }
      }
      components.push({ pixels, area: pixels.length, perimeter, adjacency });
    }
    return { components, owner };
  }
  function areaCap(absolute, ratio, pixels) {
    return Math.max(absolute, Math.round(pixels * ratio));
  }
  function measure(component, width, height, thresholds, areaLimit, fragmentCap) {
    let opaqueNeighbors = 0;
    for (const label of component.adjacency.keys()) {
      if (label !== TRANSPARENT) opaqueNeighbors++;
    }
    const ratio = component.area === 0 ? 0 : component.perimeter / component.area;
    if (opaqueNeighbors < 1 || component.area > fragmentCap) {
      return { area: component.area, ratio, thickness: -1, zappable: false };
    }
    if (component.area <= areaLimit || ratio >= thresholds.minBoundaryRatio) {
      return { area: component.area, ratio, thickness: component.area <= areaLimit ? 1 : 0, zappable: true };
    }
    const thickness = componentThickness(component.pixels, width, height, thresholds.maxThinWidth);
    return {
      area: component.area,
      ratio,
      thickness,
      zappable: thickness <= thresholds.maxThinWidth
    };
  }
  function componentThickness(pixels, width, height, limit) {
    const alive = new Set(pixels);
    let steps = 0;
    while (alive.size > 0 && steps <= limit) {
      const remove = [];
      for (const pixel of alive) {
        const x = pixel % width;
        const y = (pixel - x) / width;
        const exposed = x === 0 || y === 0 || x + 1 === width || y + 1 === height || !alive.has(pixel - 1) || !alive.has(pixel + 1) || !alive.has(pixel - width) || !alive.has(pixel + width);
        if (exposed) remove.push(pixel);
      }
      if (remove.length === 0) return steps + 1;
      for (const pixel of remove) alive.delete(pixel);
      steps++;
    }
    return alive.size > 0 ? limit + 1 : steps;
  }
  function bestNeighbor(component, ownLabel, palette) {
    const own = palette[ownLabel];
    if (!own) return null;
    let best = null;
    for (const [label, adjacency] of component.adjacency) {
      if (label === TRANSPARENT) continue;
      const other = palette[label];
      if (!other) continue;
      const distance = colorDistance(own, other);
      const score = adjacency / (1 + distance / 32);
      const better = !best || score > best.score + 1e-9 || Math.abs(score - best.score) <= 1e-9 && (adjacency > best.adjacency || adjacency === best.adjacency && (distance < best.distance || distance === best.distance && label < best.label));
      if (better) best = { label, adjacency, distance, score };
    }
    return best ? best.label : null;
  }
  function refusal(stats, thresholds, areaLimit) {
    const thick = stats.thickness < 0 ? "\u0E43\u0E2B\u0E0D\u0E48\u0E01\u0E27\u0E48\u0E32\u0E40\u0E1E\u0E14\u0E32\u0E19\u0E40\u0E28\u0E29\u0E2A\u0E35" : "\u0E2B\u0E19\u0E32 " + stats.thickness + "px";
    return "\u0E1E\u0E37\u0E49\u0E19\u0E17\u0E35\u0E48\u0E19\u0E35\u0E49 " + stats.area + " \u0E1E\u0E34\u0E01\u0E40\u0E0B\u0E25 \u0E2D\u0E31\u0E15\u0E23\u0E32\u0E2A\u0E48\u0E27\u0E19\u0E02\u0E2D\u0E1A " + stats.ratio.toFixed(2) + " " + thick + " \u2014 \u0E40\u0E1B\u0E47\u0E19\u0E2A\u0E35\u0E15\u0E48\u0E2D\u0E40\u0E19\u0E37\u0E48\u0E2D\u0E07 Zap \u0E43\u0E0A\u0E49\u0E01\u0E31\u0E1A\u0E08\u0E38\u0E14\u0E40\u0E25\u0E47\u0E01 (\u2264 " + areaLimit + " px) \u0E40\u0E2A\u0E49\u0E19\u0E1A\u0E32\u0E07 (\u2264 " + thresholds.maxThinWidth + " px) \u0E2B\u0E23\u0E37\u0E2D\u0E02\u0E2D\u0E1A\u0E41\u0E15\u0E01 (\u0E2D\u0E31\u0E15\u0E23\u0E32\u0E2A\u0E48\u0E27\u0E19 \u2265 " + thresholds.minBoundaryRatio + ") \u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19";
  }
  function largestIndex(labels, paletteLength) {
    const totals = new Array(paletteLength).fill(0);
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i] ?? TRANSPARENT;
      if (label !== TRANSPARENT && label < paletteLength) totals[label] = (totals[label] ?? 0) + 1;
    }
    let best = 0;
    for (let i = 1; i < totals.length; i++) {
      if ((totals[i] ?? 0) > (totals[best] ?? 0)) best = i;
    }
    return best;
  }

  // src/editor-ui.ts
  var TOOL_HINT = {
    zap: "Zap \xB7 \u0E04\u0E25\u0E34\u0E01\u0E40\u0E28\u0E29\u0E02\u0E2D\u0E1A\u0E2B\u0E23\u0E37\u0E2D\u0E08\u0E38\u0E14\u0E40\u0E25\u0E47\u0E01 \u0E23\u0E30\u0E1A\u0E1A\u0E41\u0E22\u0E01\u0E0A\u0E34\u0E49\u0E19\u0E17\u0E35\u0E48\u0E15\u0E34\u0E14\u0E01\u0E31\u0E19\u0E41\u0E25\u0E49\u0E27\u0E23\u0E27\u0E21\u0E40\u0E02\u0E49\u0E32\u0E2A\u0E35\u0E02\u0E49\u0E32\u0E07\u0E40\u0E04\u0E35\u0E22\u0E07",
    fill: "Fill \xB7 \u0E04\u0E25\u0E34\u0E01\u0E1E\u0E37\u0E49\u0E19\u0E17\u0E35\u0E48\u0E17\u0E35\u0E48\u0E15\u0E34\u0E14\u0E01\u0E31\u0E19 \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E40\u0E17\u0E2A\u0E35\u0E17\u0E35\u0E48\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E2D\u0E22\u0E39\u0E48",
    pencil: "Pencil \xB7 \u0E25\u0E32\u0E01\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E23\u0E30\u0E1A\u0E32\u0E22\u0E17\u0E35\u0E25\u0E30\u0E1E\u0E34\u0E01\u0E40\u0E0B\u0E25 \u0E14\u0E49\u0E27\u0E22\u0E2A\u0E35\u0E17\u0E35\u0E48\u0E40\u0E25\u0E37\u0E2D\u0E01",
    dropper: "Color \xB7 \u0E04\u0E25\u0E34\u0E01\u0E1A\u0E19\u0E20\u0E32\u0E1E\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E2B\u0E22\u0E34\u0E1A\u0E2A\u0E35\u0E08\u0E32\u0E01\u0E2A\u0E48\u0E27\u0E19\u0E19\u0E31\u0E49\u0E19"
  };
  var ICONS = {
    undo: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M6.5 3.2 3 6.5l3.5 3.2V7.4c2.7.2 4.4 1.6 5.2 3.6.2-3.4-1.4-6.2-5.2-6.6V3.2z"/></svg>',
    redo: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M9.5 3.2 13 6.5 9.5 9.7V7.4c-2.7.2-4.4 1.6-5.2 3.6-.2-3.4 1.4-6.2 5.2-6.6V3.2z"/></svg>',
    revert: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.4" d="M8 3.2v3.2M8 3.2A4.8 4.8 0 1 1 3.4 8"/><path fill="currentColor" d="M8 2.2 5.8 5h4.4L8 2.2z"/></svg>',
    zap: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M9.2 1 3 9h4.2L6.4 15 13 6.6H8.6L9.2 1z"/></svg>',
    fill: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8.2 1.6 3.4 8.2c-.8 1.1-.2 2.8 1.2 2.8h.2l-.6 2.6h8.2l-.7-2.6h.2c1.4 0 2-.1 1.2-2.8L8.2 1.6z"/></svg>',
    pencil: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M11.2 1.8 14.2 4.8 5.6 13.4 2 14l.6-3.6 8.6-8.6z"/></svg>',
    dropper: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M10.2 1.6c.8.1 1.6.5 2.2 1.1l.9.9c.6.6 1 1.4 1.1 2.2l-2.2.6-4.7 4.7-2.6-2.6 4.7-4.7.6-2.2zM3.2 10.2l2.6 2.6-2.2 1.2-1.6-1.6 1.2-2.2z"/></svg>'
  };
  function createColorEditor(container, hooks = {}) {
    container.replaceChildren();
    container.insertAdjacentHTML("beforeend", editorMarkup(hooks));
    const canvas = required(container, "canvas", HTMLCanvasElement);
    const context = canvasContext(canvas);
    const countNow = required(container, ".count-now", HTMLElement);
    const countNext = required(container, ".count-next", HTMLElement);
    const note = required(container, ".editor-note", HTMLElement);
    const hint = required(container, ".tool-hint", HTMLElement);
    const readout = required(container, ".readout", HTMLElement);
    const hex = required(container, ".active-hex", HTMLElement);
    const swatch = required(container, ".active-swatch", HTMLElement);
    const diagram = required(container, ".diagram", HTMLElement);
    const collapse = required(container, "[data-action='collapse']", HTMLButtonElement);
    const zoom = required(container, ".zoom-range", HTMLInputElement);
    const areaInput = required(container, "[data-threshold='area']", HTMLInputElement);
    const thinInput = required(container, "[data-threshold='thin']", HTMLInputElement);
    const ratioInput = required(container, "[data-threshold='ratio']", HTMLInputElement);
    const dialog = required(container, "dialog", HTMLDialogElement);
    const dialogCopy = required(container, ".confirm-copy", HTMLElement);
    const marquee = document.createElement("div");
    marquee.className = "marquee";
    marquee.hidden = true;
    diagram.append(marquee);
    let doc = null;
    let tool = "zap";
    let bitmap = null;
    let positions = /* @__PURE__ */ new Map();
    let selected = /* @__PURE__ */ new Set();
    let representative = null;
    let stroke = null;
    let targetHex = null;
    let drag = null;
    function noteText(value) {
      note.textContent = value;
    }
    function showCount(next) {
      const current = doc ? doc.colorCount() : 0;
      countNow.textContent = current + " \u0E2A\u0E35";
      if (next === null || next === current) {
        countNext.hidden = true;
        countNext.textContent = "";
      } else {
        countNext.hidden = false;
        countNext.textContent = "\u2192 " + next;
      }
    }
    function armedCollapse() {
      if (!doc || representative === null) return null;
      const members = selectedIndices();
      if (members.length < 2) return null;
      if (!members.some((index) => rgbHex(doc.palette[index]) === representative)) return null;
      return doc.colorCount() - (members.length - 1);
    }
    function selectedIndices() {
      if (!doc) return [];
      const indices = [];
      doc.palette.forEach((color, index) => {
        if (selected.has(rgbHex(color))) indices.push(index);
      });
      return indices;
    }
    function syncChrome() {
      const tools = container.querySelectorAll("[data-tool]");
      tools.forEach((button) => {
        button.setAttribute("aria-pressed", button.dataset.tool === tool ? "true" : "false");
      });
      hint.textContent = TOOL_HINT[tool];
      const undo = container.querySelector("[data-history='undo']");
      const redo = container.querySelector("[data-history='redo']");
      const revert = container.querySelector("[data-history='revert']");
      if (undo) undo.disabled = !doc || !doc.canUndo();
      if (redo) redo.disabled = !doc || !doc.canRedo();
      if (revert) revert.disabled = !doc || !doc.dirty();
      collapse.disabled = !doc || selectedIndices().length < 2;
      const color = doc && doc.active >= 0 ? doc.palette[doc.active] : null;
      if (color) {
        swatch.style.background = rgbHex(color);
        hex.textContent = rgbHex(color);
      } else {
        swatch.style.background = "transparent";
        hex.textContent = "\u0E44\u0E21\u0E48\u0E21\u0E35\u0E2A\u0E35";
      }
      if (!drag || drag.kind !== "dot" || drag.group) showCount(armedCollapse());
      canvas.style.cursor = tool === "dropper" ? "copy" : "crosshair";
    }
    function paintBitmap() {
      if (!doc) return;
      bitmap = context.createImageData(doc.width, doc.height);
      const data = bitmap.data;
      for (let i = 0; i < doc.labels.length; i++) {
        const label = doc.labels[i] ?? TRANSPARENT;
        const offset = i * 4;
        const color = label === TRANSPARENT ? null : doc.palette[label];
        if (!color) {
          data[offset + 3] = 0;
          continue;
        }
        data[offset] = color.r;
        data[offset + 1] = color.g;
        data[offset + 2] = color.b;
        data[offset + 3] = 255;
      }
      canvas.width = doc.width;
      canvas.height = doc.height;
      context.putImageData(bitmap, 0, 0);
      applyZoom();
    }
    function applyZoom() {
      const scale = Number(zoom.value) || 1;
      canvas.style.width = canvas.width * scale + "px";
      canvas.style.height = canvas.height * scale + "px";
    }
    function placeMissing() {
      if (!doc) return;
      const box = diagram.clientWidth || container.clientWidth || 320;
      const gap = 68;
      const cols = Math.max(1, Math.floor((box - 8) / gap));
      let slot = 0;
      for (const color of doc.palette) {
        const key = rgbHex(color);
        if (positions.has(key)) continue;
        const col = slot % cols;
        const row = Math.floor(slot / cols);
        slot++;
        positions.set(key, { x: 36 + col * gap, y: 40 + row * gap });
      }
    }
    function radiusFor(count, max) {
      const ratio = max > 0 ? Math.sqrt(count / max) : 0;
      return 13 + ratio * 17;
    }
    function renderDiagram() {
      if (!doc) {
        diagram.style.height = "120px";
        return;
      }
      placeMissing();
      const counts = doc.counts();
      const max = counts.reduce((best, value) => Math.max(best, value), 0);
      diagram.querySelectorAll(".swatch-dot").forEach((node) => node.remove());
      let lowest = 120;
      doc.palette.forEach((color, index) => {
        const key = rgbHex(color);
        const pos = positions.get(key) ?? { x: 40, y: 40 };
        const radius = radiusFor(counts[index] ?? 0, max);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "swatch-dot";
        button.dataset.index = String(index);
        button.dataset.hex = key;
        button.style.left = pos.x + "px";
        button.style.top = pos.y + "px";
        button.style.width = radius * 2 + "px";
        button.style.height = radius * 2 + "px";
        button.style.background = key;
        button.title = key + " \xB7 " + (counts[index] ?? 0) + " \u0E1E\u0E34\u0E01\u0E40\u0E0B\u0E25";
        button.setAttribute("aria-label", "\u0E2A\u0E35 " + key + " " + (counts[index] ?? 0) + " \u0E1E\u0E34\u0E01\u0E40\u0E0B\u0E25");
        if (selected.has(key)) button.classList.add("is-selected");
        if (representative === key) button.classList.add("is-representative");
        if (targetHex === key) button.classList.add("is-target");
        button.addEventListener("pointerdown", onDotPointerDown);
        diagram.append(button);
        lowest = Math.max(lowest, pos.y + radius + 28);
      });
      diagram.style.height = lowest + "px";
    }
    function renderAll() {
      paintBitmap();
      renderDiagram();
      syncChrome();
      if (doc) hooks.onChange?.(doc.colorCount());
    }
    function finish(result) {
      if (!result.ok) {
        noteText(result.reason);
        syncChrome();
        return;
      }
      if (result.detail) noteText(result.detail);
      if (result.changed) renderAll();
      else syncChrome();
    }
    function eventPixel(event) {
      if (!doc) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const x = Math.floor((event.clientX - rect.left) / rect.width * doc.width);
      const y = Math.floor((event.clientY - rect.top) / rect.height * doc.height);
      if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null;
      return { x, y };
    }
    function paintPixel(x, y) {
      if (!doc || !stroke) return;
      doc.pencil(x, y, stroke);
      if (!bitmap) return;
      const color = doc.palette[doc.active];
      if (!color) return;
      const offset = (y * doc.width + x) * 4;
      bitmap.data[offset] = color.r;
      bitmap.data[offset + 1] = color.g;
      bitmap.data[offset + 2] = color.b;
      bitmap.data[offset + 3] = 255;
    }
    function paintLine(x0, y0, x1, y1) {
      const dx = Math.abs(x1 - x0);
      const dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx - dy;
      let x = x0;
      let y = y0;
      while (true) {
        paintPixel(x, y);
        if (x === x1 && y === y1) break;
        const doubled = 2 * err;
        if (doubled > -dy) {
          err -= dy;
          x += sx;
        }
        if (doubled < dx) {
          err += dx;
          y += sy;
        }
      }
      if (bitmap) context.putImageData(bitmap, 0, 0);
    }
    function localPoint(event) {
      const rect = diagram.getBoundingClientRect();
      return { x: event.clientX - rect.left + diagram.scrollLeft, y: event.clientY - rect.top + diagram.scrollTop };
    }
    function hitDot(x, y, ignore) {
      if (!doc) return null;
      const counts = doc.counts();
      const max = counts.reduce((best, value) => Math.max(best, value), 0);
      let found = null;
      doc.palette.forEach((color, index) => {
        if (index === ignore) return;
        const pos = positions.get(rgbHex(color));
        if (!pos) return;
        const radius = radiusFor(counts[index] ?? 0, max) + 6;
        const dx = x - pos.x;
        const dy = y - pos.y;
        if (dx * dx + dy * dy <= radius * radius) found = index;
      });
      return found;
    }
    function onDotPointerDown(event) {
      if (event.button !== 0 || !doc) return;
      const button = event.currentTarget;
      if (!(button instanceof HTMLButtonElement)) return;
      event.preventDefault();
      event.stopPropagation();
      const index = Number(button.dataset.index);
      const colorHex = button.dataset.hex ?? "";
      try {
        button.setPointerCapture(event.pointerId);
      } catch {
      }
      const group = selected.size > 1 && selected.has(colorHex);
      const origins = /* @__PURE__ */ new Map();
      if (group) {
        for (const key of selected) {
          const pos = positions.get(key);
          if (pos) origins.set(key, { ...pos });
        }
      } else {
        const pos = positions.get(colorHex);
        if (pos) origins.set(colorHex, { ...pos });
      }
      drag = { kind: "dot", pointerId: event.pointerId, index, hex: colorHex, sx: event.clientX, sy: event.clientY, moved: false, group, origins };
      targetHex = null;
    }
    function moveDots(event, current) {
      const dx = event.clientX - current.sx;
      const dy = event.clientY - current.sy;
      if (!current.moved && Math.hypot(dx, dy) < 4) return;
      current.moved = true;
      for (const [key, origin] of current.origins) {
        positions.set(key, { x: origin.x + dx, y: origin.y + dy });
      }
      if (!current.group && doc) {
        const point = localPoint(event);
        const hit = hitDot(point.x, point.y, current.index);
        const hitColor = hit === null ? void 0 : doc.palette[hit];
        targetHex = hitColor ? rgbHex(hitColor) : null;
        showCount(hit === null ? null : doc.colorCount() - 1);
      }
      moveDotElements();
      syncChrome();
    }
    function moveDotElements() {
      let lowest = 120;
      diagram.querySelectorAll(".swatch-dot").forEach((button) => {
        const key = button.dataset.hex;
        if (!key) return;
        const pos = positions.get(key);
        if (!pos) return;
        button.style.left = pos.x + "px";
        button.style.top = pos.y + "px";
        button.classList.toggle("is-target", targetHex === key);
        lowest = Math.max(lowest, pos.y + button.offsetHeight / 2 + 28);
      });
      diagram.style.height = lowest + "px";
    }
    function releaseDot(current) {
      if (!doc) return;
      if (!current.moved) {
        doc.setActive(current.index);
        if (selected.size > 1 && selected.has(current.hex)) representative = current.hex;
        else {
          selected = /* @__PURE__ */ new Set([current.hex]);
          representative = null;
        }
        noteText("");
      } else if (!current.group && targetHex) {
        const target = doc.palette.findIndex((color) => rgbHex(color) === targetHex);
        if (target >= 0) {
          const before = doc.colorCount();
          const result = doc.merge(current.index, target);
          targetHex = null;
          if (result.ok && result.changed) {
            selected.delete(current.hex);
            if (representative === current.hex) representative = null;
            noteText(before + " \u2192 " + doc.colorCount() + " \u0E2A\u0E35 \xB7 " + result.detail);
          } else if (!result.ok) noteText(result.reason);
        }
      }
      targetHex = null;
      renderAll();
    }
    function onPointerMove(event) {
      if (drag && event.pointerId === drag.pointerId && drag.kind === "dot") {
        moveDots(event, drag);
        return;
      }
      if (drag && event.pointerId === drag.pointerId && drag.kind === "pencil") {
        const pixel = eventPixel(event);
        if (!pixel) return;
        paintLine(drag.x, drag.y, pixel.x, pixel.y);
        drag.x = pixel.x;
        drag.y = pixel.y;
        return;
      }
      if (drag && event.pointerId === drag.pointerId && drag.kind === "marquee") {
        const point = localPoint(event);
        drag.x1 = point.x;
        drag.y1 = point.y;
        if (Math.hypot(point.x - drag.x0, point.y - drag.y0) > 4) drag.moved = true;
        const left = Math.min(drag.x0, point.x);
        const top = Math.min(drag.y0, point.y);
        marquee.hidden = false;
        marquee.style.left = left + "px";
        marquee.style.top = top + "px";
        marquee.style.width = Math.abs(point.x - drag.x0) + "px";
        marquee.style.height = Math.abs(point.y - drag.y0) + "px";
        return;
      }
      if (event.currentTarget === canvas || canvas.contains(event.target)) {
        const pixel = eventPixel(event);
        if (!pixel || !doc) {
          readout.textContent = "";
          return;
        }
        const label = doc.labels[pixel.y * doc.width + pixel.x] ?? TRANSPARENT;
        const color = label === TRANSPARENT ? null : doc.palette[label];
        readout.textContent = pixel.x + ", " + pixel.y + (color ? " \xB7 " + rgbHex(color) : " \xB7 \u0E42\u0E1B\u0E23\u0E48\u0E07\u0E43\u0E2A");
      }
    }
    function onPointerUp(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const current = drag;
      drag = null;
      marquee.hidden = true;
      if (current.kind === "dot") releaseDot(current);
      else if (current.kind === "pencil") {
        if (doc && stroke) finish(doc.endPencil(stroke));
        stroke = null;
      } else if (current.kind === "marquee") {
        if (!current.moved || !doc) {
          selected = /* @__PURE__ */ new Set();
          representative = null;
        } else {
          const left = Math.min(current.x0, current.x1);
          const right = Math.max(current.x0, current.x1);
          const top = Math.min(current.y0, current.y1);
          const bottom = Math.max(current.y0, current.y1);
          const next = /* @__PURE__ */ new Set();
          for (const color of doc.palette) {
            const key = rgbHex(color);
            const pos = positions.get(key);
            if (!pos) continue;
            if (pos.x >= left && pos.x <= right && pos.y >= top && pos.y <= bottom) next.add(key);
          }
          selected = next;
          representative = null;
          if (next.size >= 2) noteText("\u0E04\u0E25\u0E34\u0E01\u0E2A\u0E35\u0E43\u0E19\u0E01\u0E25\u0E38\u0E48\u0E21\u0E17\u0E35\u0E48\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E40\u0E01\u0E47\u0E1A \u0E41\u0E25\u0E49\u0E27\u0E01\u0E14\u0E22\u0E38\u0E1A\u0E01\u0E25\u0E38\u0E48\u0E21");
        }
        renderDiagram();
        syncChrome();
      }
    }
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !doc) return;
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
      }
      const pixel = eventPixel(event);
      if (!pixel) return;
      if (tool === "pencil") {
        stroke = { pushed: false };
        drag = { kind: "pencil", pointerId: event.pointerId, x: pixel.x, y: pixel.y };
        paintLine(pixel.x, pixel.y, pixel.x, pixel.y);
        return;
      }
      if (tool === "zap") finish(doc.zap(pixel.x, pixel.y));
      else if (tool === "fill") finish(doc.fill(pixel.x, pixel.y));
      else {
        const label = doc.labels[pixel.y * doc.width + pixel.x] ?? TRANSPARENT;
        if (label === TRANSPARENT) noteText("\u0E08\u0E38\u0E14\u0E19\u0E35\u0E49\u0E42\u0E1B\u0E23\u0E48\u0E07\u0E43\u0E2A");
        else {
          doc.setActive(label);
          noteText("\u0E40\u0E25\u0E37\u0E2D\u0E01 " + rgbHex(doc.palette[label]));
          syncChrome();
        }
      }
    });
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    diagram.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest(".swatch-dot")) return;
      try {
        diagram.setPointerCapture(event.pointerId);
      } catch {
      }
      const point = localPoint(event);
      drag = { kind: "marquee", pointerId: event.pointerId, x0: point.x, y0: point.y, x1: point.x, y1: point.y, moved: false };
    });
    diagram.addEventListener("pointermove", onPointerMove);
    diagram.addEventListener("pointerup", onPointerUp);
    diagram.addEventListener("pointercancel", onPointerUp);
    container.querySelectorAll("[data-tool]").forEach((button) => {
      button.addEventListener("click", () => {
        const next = button.dataset.tool;
        if (next === "zap" || next === "fill" || next === "pencil" || next === "dropper") {
          tool = next;
          noteText("");
          syncChrome();
        }
      });
    });
    container.querySelector("[data-history='undo']")?.addEventListener("click", () => {
      if (!doc || !doc.undo()) return;
      noteText("\u0E22\u0E49\u0E2D\u0E19\u0E41\u0E25\u0E49\u0E27 \xB7 " + doc.colorCount() + " \u0E2A\u0E35");
      renderAll();
    });
    container.querySelector("[data-history='redo']")?.addEventListener("click", () => {
      if (!doc || !doc.redo()) return;
      noteText("\u0E17\u0E33\u0E0B\u0E49\u0E33\u0E41\u0E25\u0E49\u0E27 \xB7 " + doc.colorCount() + " \u0E2A\u0E35");
      renderAll();
    });
    container.querySelector("[data-history='revert']")?.addEventListener("click", () => {
      if (!doc || !doc.revert()) return;
      selected = /* @__PURE__ */ new Set();
      representative = null;
      noteText("\u0E04\u0E37\u0E19\u0E04\u0E48\u0E32\u0E15\u0E2D\u0E19\u0E41\u0E22\u0E01\u0E2A\u0E35\u0E04\u0E23\u0E31\u0E49\u0E07\u0E41\u0E23\u0E01 \xB7 " + doc.colorCount() + " \u0E2A\u0E35");
      renderAll();
    });
    collapse.addEventListener("click", () => {
      if (!doc) return;
      const members = selectedIndices();
      if (members.length < 2) return;
      const representativeIndex = doc.palette.findIndex((color) => rgbHex(color) === representative);
      if (representativeIndex < 0) {
        noteText("\u0E04\u0E25\u0E34\u0E01\u0E2A\u0E35\u0E43\u0E19\u0E01\u0E25\u0E38\u0E48\u0E21\u0E17\u0E35\u0E48\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E40\u0E01\u0E47\u0E1A\u0E44\u0E27\u0E49 \u0E41\u0E25\u0E49\u0E27\u0E01\u0E14\u0E22\u0E38\u0E1A\u0E01\u0E25\u0E38\u0E48\u0E21\u0E2D\u0E35\u0E01\u0E04\u0E23\u0E31\u0E49\u0E07");
        return;
      }
      const before = doc.colorCount();
      const result = doc.collapse(members, representativeIndex);
      if (!result.ok) {
        noteText(result.reason);
        return;
      }
      selected = new Set(representative ? [representative] : []);
      noteText(before + " \u2192 " + doc.colorCount() + " \u0E2A\u0E35 \xB7 " + result.detail);
      renderAll();
    });
    zoom.addEventListener("input", applyZoom);
    const pushThresholds = () => {
      if (!doc) return;
      doc.setThresholds({
        maxSpeckleArea: clampNumber(areaInput.value, 1, 5e3, defaultZapThresholds.maxSpeckleArea),
        maxThinWidth: clampNumber(thinInput.value, 1, 8, defaultZapThresholds.maxThinWidth),
        minBoundaryRatio: clampNumber(ratioInput.value, 0.2, 4, defaultZapThresholds.minBoundaryRatio)
      });
    };
    areaInput.addEventListener("input", pushThresholds);
    thinInput.addEventListener("input", pushThresholds);
    ratioInput.addEventListener("input", pushThresholds);
    container.querySelector("[data-action='vector']")?.addEventListener("click", () => hooks.onVectorPreview?.());
    container.querySelector("[data-action='resegment']")?.addEventListener("click", () => hooks.onResegment?.());
    container.querySelector("[data-action='swatches']")?.addEventListener("click", () => {
      if (doc) hooks.onExportSwatches?.(doc.palette);
    });
    function onKey(event) {
      if (!doc || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      const key = event.key.toLowerCase();
      if (key === "z") doc.undo();
      else if (key === "y") doc.redo();
      else if (key === "t") {
        if (doc.revert()) {
          selected = /* @__PURE__ */ new Set();
          representative = null;
        }
      } else if (key === "d") tool = "zap";
      else if (key === "f") tool = "fill";
      else if (key === "x") tool = "pencil";
      else if (key === "c") tool = "dropper";
      else return;
      event.preventDefault();
      renderAll();
    }
    window.addEventListener("keydown", onKey);
    function load(segmentation) {
      doc = ColorDocument.fromSegmentation(segmentation, {
        ...defaultZapThresholds,
        maxSpeckleArea: clampNumber(areaInput.value, 1, 5e3, defaultZapThresholds.maxSpeckleArea),
        maxThinWidth: clampNumber(thinInput.value, 1, 8, defaultZapThresholds.maxThinWidth),
        minBoundaryRatio: clampNumber(ratioInput.value, 0.2, 4, defaultZapThresholds.minBoundaryRatio)
      });
      positions = /* @__PURE__ */ new Map();
      selected = /* @__PURE__ */ new Set();
      representative = null;
      targetHex = null;
      noteText("\u0E41\u0E22\u0E01\u0E44\u0E14\u0E49 " + doc.colorCount() + " \u0E2A\u0E35 \u0E41\u0E01\u0E49\u0E1A\u0E19\u0E20\u0E32\u0E1E\u0E19\u0E35\u0E49\u0E01\u0E48\u0E2D\u0E19\u0E17\u0E33\u0E40\u0E2A\u0E49\u0E19");
      renderAll();
    }
    return {
      load,
      clear() {
        doc = null;
        bitmap = null;
        positions = /* @__PURE__ */ new Map();
        selected = /* @__PURE__ */ new Set();
        representative = null;
        context.clearRect(0, 0, canvas.width, canvas.height);
        diagram.querySelectorAll(".swatch-dot").forEach((node) => node.remove());
        showCount(null);
        syncChrome();
      },
      hasDocument: () => doc !== null,
      dirty: () => doc?.dirty() ?? false,
      colorCount: () => doc?.colorCount() ?? 0,
      segmentation() {
        if (!doc) throw new Error("\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E41\u0E1C\u0E19\u0E17\u0E35\u0E48\u0E2A\u0E35");
        return doc.segmentation();
      },
      confirmDiscard(message) {
        if (!doc || !doc.dirty()) return Promise.resolve(true);
        dialogCopy.textContent = message;
        if (typeof dialog.showModal !== "function") return Promise.resolve(window.confirm(message));
        dialog.showModal();
        return new Promise((resolve) => {
          dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
        });
      },
      destroy() {
        window.removeEventListener("keydown", onKey);
        container.replaceChildren();
      }
    };
  }
  function editorMarkup(hooks) {
    const vector = hooks.onVectorPreview ? '<button type="button" class="primary" data-action="vector">\u0E14\u0E39\u0E40\u0E2A\u0E49\u0E19</button>' : "";
    const resegment = hooks.onResegment ? '<button type="button" class="secondary" data-action="resegment">\u0E41\u0E1B\u0E25\u0E07\u0E43\u0E2B\u0E21\u0E48</button>' : "";
    const swatches = hooks.onExportSwatches ? '<button type="button" class="secondary" data-action="swatches">\u0E43\u0E2A\u0E48 Swatches</button>' : "";
    return `
    <section class="editor" aria-labelledby="editor-title">
      <div class="section-heading">
        <h2 id="editor-title">\u0E41\u0E01\u0E49\u0E2A\u0E35</h2>
        <p class="count-pill" aria-live="polite"><span class="count-now">0 \u0E2A\u0E35</span><span class="count-next" hidden></span></p>
      </div>
      <p class="editor-lead">\u0E41\u0E01\u0E49\u0E1A\u0E19\u0E41\u0E1C\u0E19\u0E17\u0E35\u0E48\u0E2A\u0E35\u0E40\u0E14\u0E35\u0E22\u0E27\u0E01\u0E31\u0E19\u0E19\u0E35\u0E49\u0E01\u0E48\u0E2D\u0E19\u0E17\u0E33\u0E40\u0E2A\u0E49\u0E19\u0E43\u0E2B\u0E49\u0E40\u0E23\u0E35\u0E22\u0E1A \u0E15\u0E31\u0E27\u0E40\u0E25\u0E02\u0E04\u0E37\u0E2D\u0E08\u0E33\u0E19\u0E27\u0E19\u0E2A\u0E35\u0E17\u0E35\u0E48\u0E43\u0E0A\u0E49\u0E08\u0E23\u0E34\u0E07</p>
      <div class="seg-frame"><canvas aria-label="\u0E41\u0E1C\u0E19\u0E17\u0E35\u0E48\u0E2A\u0E35\u0E17\u0E35\u0E48\u0E41\u0E01\u0E49\u0E44\u0E14\u0E49"></canvas></div>
      <div class="editor-meta">
        <span class="active-swatch" aria-hidden="true"></span>
        <span class="active-hex">\u0E44\u0E21\u0E48\u0E21\u0E35\u0E2A\u0E35</span>
        <span class="readout"></span>
        <label class="zoom-label" for="zoom-range">\u0E02\u0E22\u0E32\u0E22 <input class="zoom-range" id="zoom-range" name="zoom" type="range" min="1" max="8" value="2" /></label>
      </div>
      <div class="toolstrip" role="toolbar" aria-label="\u0E40\u0E04\u0E23\u0E37\u0E48\u0E2D\u0E07\u0E21\u0E37\u0E2D\u0E41\u0E01\u0E49\u0E2A\u0E35">
        ${toolButton("undo", "data-history", "Undo", "Undo (Z)")}
        ${toolButton("redo", "data-history", "Redo", "Redo (Y)")}
        ${toolButton("revert", "data-history", "Revert", "Revert (T)")}
        ${toolButton("zap", "data-tool", "Zap", "Zap (D)")}
        ${toolButton("fill", "data-tool", "Fill", "Fill (F)")}
        ${toolButton("pencil", "data-tool", "Pencil", "Pencil (X)")}
        ${toolButton("dropper", "data-tool", "Color", "Color (C)")}
      </div>
      <p class="tool-hint"></p>
      <p class="editor-note" role="status"></p>
      <details class="zap-tune">
        <summary>\u0E40\u0E01\u0E13\u0E11\u0E4C Zap</summary>
        <label for="zap-area">\u0E08\u0E38\u0E14\u0E40\u0E25\u0E47\u0E01\u0E44\u0E21\u0E48\u0E40\u0E01\u0E34\u0E19 <input id="zap-area" name="zap-area" data-threshold="area" type="number" min="1" max="5000" value="${defaultZapThresholds.maxSpeckleArea}" /> px</label>
        <label for="zap-thin">\u0E40\u0E2A\u0E49\u0E19\u0E1A\u0E32\u0E07\u0E44\u0E21\u0E48\u0E40\u0E01\u0E34\u0E19 <input id="zap-thin" name="zap-thin" data-threshold="thin" type="number" min="1" max="8" value="${defaultZapThresholds.maxThinWidth}" /> px</label>
        <label for="zap-ratio">\u0E2D\u0E31\u0E15\u0E23\u0E32\u0E2A\u0E48\u0E27\u0E19\u0E02\u0E2D\u0E1A <input id="zap-ratio" name="zap-ratio" data-threshold="ratio" type="number" min="0.2" max="4" step="0.1" value="${defaultZapThresholds.minBoundaryRatio}" /></label>
      </details>
      <div class="section-heading">
        <h3>\u0E41\u0E1C\u0E19\u0E20\u0E32\u0E1E\u0E2A\u0E35</h3>
        <button type="button" class="text-button" data-action="collapse" disabled>\u0E22\u0E38\u0E1A\u0E01\u0E25\u0E38\u0E48\u0E21</button>
      </div>
      <p class="diagram-lead">\u0E25\u0E32\u0E01\u0E27\u0E07\u0E01\u0E25\u0E21\u0E44\u0E1B\u0E27\u0E32\u0E07\u0E1A\u0E19\u0E2D\u0E35\u0E01\u0E2A\u0E35\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E23\u0E27\u0E21 \u0E2A\u0E35\u0E1B\u0E25\u0E32\u0E22\u0E17\u0E32\u0E07\u0E04\u0E37\u0E2D\u0E2A\u0E35\u0E17\u0E35\u0E48\u0E40\u0E01\u0E47\u0E1A \u0E25\u0E32\u0E01\u0E1A\u0E19\u0E1E\u0E37\u0E49\u0E19\u0E17\u0E35\u0E48\u0E27\u0E48\u0E32\u0E07\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E04\u0E25\u0E38\u0E21\u0E01\u0E25\u0E38\u0E48\u0E21 \u0E41\u0E25\u0E49\u0E27\u0E04\u0E25\u0E34\u0E01\u0E2A\u0E35\u0E17\u0E35\u0E48\u0E08\u0E30\u0E40\u0E01\u0E47\u0E1A\u0E01\u0E48\u0E2D\u0E19\u0E01\u0E14\u0E22\u0E38\u0E1A\u0E01\u0E25\u0E38\u0E48\u0E21 \u0E01\u0E25\u0E38\u0E48\u0E21\u0E17\u0E35\u0E48\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E41\u0E25\u0E49\u0E27\u0E22\u0E49\u0E32\u0E22\u0E44\u0E14\u0E49\u0E17\u0E31\u0E49\u0E07\u0E01\u0E49\u0E2D\u0E19</p>
      <div class="diagram" aria-label="\u0E41\u0E1C\u0E19\u0E20\u0E32\u0E1E\u0E2A\u0E35 \u0E25\u0E32\u0E01\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E23\u0E27\u0E21\u0E2B\u0E23\u0E37\u0E2D\u0E08\u0E31\u0E14\u0E01\u0E25\u0E38\u0E48\u0E21"></div>
      <div class="editor-actions">${vector}${resegment}${swatches}</div>
      <dialog class="confirm">
        <form method="dialog">
          <h3>\u0E01\u0E32\u0E23\u0E17\u0E33\u0E0B\u0E49\u0E33\u0E08\u0E30\u0E25\u0E49\u0E32\u0E07\u0E01\u0E32\u0E23\u0E41\u0E01\u0E49\u0E2A\u0E35</h3>
          <p class="confirm-copy"></p>
          <div class="confirm-actions">
            <button type="submit" class="secondary" value="cancel">\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01</button>
            <button type="submit" class="primary" value="ok">\u0E25\u0E49\u0E32\u0E07\u0E41\u0E25\u0E49\u0E27\u0E17\u0E33\u0E15\u0E48\u0E2D</button>
          </div>
        </form>
      </dialog>
    </section>`;
  }
  function toolButton(name, attribute, label, title) {
    const pressed = attribute === "data-tool" && name === "zap" ? ' aria-pressed="true"' : attribute === "data-tool" ? ' aria-pressed="false"' : "";
    return `<button type="button" class="tool" ${attribute}="${name}" title="${title}"${pressed}>${ICONS[name] ?? ""}<span>${label}</span></button>`;
  }
  function canvasContext(canvas) {
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("\u0E43\u0E0A\u0E49 canvas 2d \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49");
    return context;
  }
  function required(container, selector, kind) {
    const value = container.querySelector(selector);
    if (!value || !(value instanceof kind)) throw new Error("Missing editor element: " + selector);
    return value;
  }
  function clampNumber(raw, min, max, fallback) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  }

  // src/color/segment.ts
  function segmentImage(rgba, width, height, maxColors2) {
    if (rgba.length < width * height * 4) throw new Error("\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E20\u0E32\u0E1E\u0E2A\u0E31\u0E49\u0E19\u0E01\u0E27\u0E48\u0E32\u0E02\u0E19\u0E32\u0E14\u0E17\u0E35\u0E48\u0E23\u0E30\u0E1A\u0E38");
    const colors = Math.max(1, Math.floor(maxColors2));
    const labels = new Uint16Array(width * height);
    labels.fill(TRANSPARENT);
    const histogram = /* @__PURE__ */ new Map();
    for (let i = 0; i < width * height; i++) {
      const offset = i * 4;
      const alpha = rgba[offset + 3] ?? 0;
      if (alpha < 128) continue;
      const key = (rgba[offset] ?? 0) << 16 | (rgba[offset + 1] ?? 0) << 8 | (rgba[offset + 2] ?? 0);
      histogram.set(key, (histogram.get(key) ?? 0) + 1);
    }
    const unique = [];
    for (const [key, n] of histogram) {
      unique.push({ r: key >> 16 & 255, g: key >> 8 & 255, b: key & 255, n });
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
  function segmentationToSvg(segmentation) {
    const groups = /* @__PURE__ */ new Map();
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
    const body = [];
    for (const [label, rects] of groups) {
      const color = segmentation.palette[label];
      if (!color || rects.length === 0) continue;
      body.push('<g fill="' + rgbHex(color) + '">' + rects.join("") + "</g>");
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + segmentation.width + " " + segmentation.height + '" width="' + segmentation.width + '" height="' + segmentation.height + '" shape-rendering="crispEdges">' + body.join("") + "</svg>";
  }
  function countSvgFills(svg) {
    const found = /* @__PURE__ */ new Set();
    const pattern = /fill="(#[0-9a-fA-F]{6})"/g;
    let match = pattern.exec(svg);
    while (match) {
      if (match[1]) found.add(match[1].toLowerCase());
      match = pattern.exec(svg);
    }
    return found.size;
  }
  function exactPalette(unique) {
    return [...unique].sort((a, b) => b.n - a.n || a.r - b.r || a.g - b.g || a.b - b.b).map((color) => ({ r: color.r, g: color.g, b: color.b }));
  }
  function medianCutPalette(unique, maxColors2) {
    let buckets = [unique.slice()];
    while (buckets.length < maxColors2) {
      let best = -1;
      let bestScore = -1;
      for (let i = 0; i < buckets.length; i++) {
        const bucket2 = buckets[i];
        if (!bucket2 || bucket2.length < 2) continue;
        const score = bucketScore(bucket2);
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
  function bucketScore(bucket) {
    let total = 0;
    for (const color of bucket) total += color.n;
    return channelSpan(bucket) * total;
  }
  function channelSpan(bucket) {
    let best = 0;
    for (const channel of [0, 1, 2]) {
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
  function dominantChannel(bucket) {
    let best = 0;
    let bestSpan = -1;
    for (const channel of [0, 1, 2]) {
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
  function channelValue(color, channel) {
    if (channel === 0) return color.r;
    if (channel === 1) return color.g;
    return color.b;
  }
  function average(bucket) {
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
  function nearest(palette, r, g, b) {
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
  function compactSegmentation(segmentation) {
    const used = new Array(segmentation.palette.length).fill(false);
    for (let i = 0; i < segmentation.labels.length; i++) {
      const label = segmentation.labels[i] ?? TRANSPARENT;
      if (label !== TRANSPARENT && label < used.length) used[label] = true;
    }
    if (used.every((value) => value)) return segmentation;
    const map = new Array(segmentation.palette.length).fill(-1);
    const palette = [];
    for (let i = 0; i < segmentation.palette.length; i++) {
      if (!used[i]) continue;
      map[i] = palette.length;
      const color = segmentation.palette[i];
      if (color) palette.push(color);
    }
    const labels = new Uint16Array(segmentation.labels.length);
    for (let i = 0; i < segmentation.labels.length; i++) {
      const label = segmentation.labels[i] ?? TRANSPARENT;
      labels[i] = label === TRANSPARENT ? TRANSPARENT : map[label] ?? TRANSPARENT;
    }
    return { width: segmentation.width, height: segmentation.height, labels, palette };
  }

  // src/color/sample.ts
  var SAMPLE_ORANGE = { r: 242, g: 107, b: 29 };
  var SAMPLE_CREAM = { r: 244, g: 236, b: 220 };
  var SAMPLE_SPECKLE = { r: 248, g: 140, b: 60 };
  var SAMPLE_FRINGE = { r: 245, g: 120, b: 40 };
  function makeStripeSample() {
    const width = 120;
    const height = 156;
    const rgba = new Uint8Array(width * height * 4);
    const cx = 60;
    const cy = 64;
    const rx = 50;
    const ry = 56;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let cover = 0;
        for (let sy = 0; sy < 4; sy++) {
          for (let sx = 0; sx < 4; sx++) {
            const px = x + (sx + 0.5) / 4;
            const py = y + (sy + 0.5) / 4;
            const nx = (px - cx) / rx;
            const ny = (py - cy) / ry;
            if (nx * nx + ny * ny <= 1) cover++;
          }
        }
        if (cover === 0) continue;
        const band = stripeBand(x + 0.5, cx, rx);
        const bandLeft = stripeBand(x - 0.5, cx, rx);
        const bandRight = stripeBand(x + 1.5, cx, rx);
        let color = band % 2 === 0 ? SAMPLE_ORANGE : SAMPLE_CREAM;
        if (band === 2 && bandLeft === 1) color = SAMPLE_FRINGE;
        if (band === 2 && bandLeft === 2 && bandRight === 2 && x % 5 === 1 && y % 6 === 2) color = SAMPLE_SPECKLE;
        const offset = (y * width + x) * 4;
        rgba[offset] = color.r;
        rgba[offset + 1] = color.g;
        rgba[offset + 2] = color.b;
        rgba[offset + 3] = Math.round(cover / 16 * 255);
      }
    }
    return { width, height, rgba };
  }
  function stripeBand(x, cx, rx) {
    const u = (x - cx) / rx;
    return Math.max(0, Math.min(4, Math.floor((u + 1) * 2.5)));
  }

  // src/demo.ts
  var root = document.getElementById("editor-root");
  var preview = document.getElementById("preview");
  var previewEmpty = document.getElementById("preview-empty");
  var status = document.getElementById("status");
  var phase = document.getElementById("phase");
  if (!(root instanceof HTMLElement) || !(preview instanceof HTMLImageElement) || !(previewEmpty instanceof HTMLElement) || !(status instanceof HTMLElement) || !(phase instanceof HTMLElement)) {
    throw new Error("\u0E2B\u0E19\u0E49\u0E32\u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E44\u0E21\u0E48\u0E04\u0E23\u0E1A");
  }
  var rootEl = root;
  var previewEl = preview;
  var previewEmptyEl = previewEmpty;
  var statusEl = status;
  var phaseEl = phase;
  var image = makeStripeSample();
  var maxColors = 8;
  function showStatus(value) {
    statusEl.textContent = value;
  }
  var editor = createColorEditor(rootEl, {
    onChange(colorCount) {
      phaseEl.textContent = "\u0E41\u0E01\u0E49\u0E2A\u0E35 \xB7 " + colorCount + " \u0E2A\u0E35";
    },
    onVectorPreview() {
      const segmentation = editor.segmentation();
      const svg = segmentationToSvg(segmentation);
      previewEl.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      previewEl.hidden = false;
      previewEmptyEl.hidden = true;
      const vectorColors = countSvgFills(svg);
      phaseEl.textContent = "\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E43\u0E2A\u0E48\u0E1C\u0E25 \xB7 " + editor.colorCount() + " \u0E2A\u0E35";
      showStatus("\u0E41\u0E1C\u0E19\u0E17\u0E35\u0E48\u0E2A\u0E35 " + editor.colorCount() + " \xB7 \u0E40\u0E27\u0E01\u0E40\u0E15\u0E2D\u0E23\u0E4C " + vectorColors + " \u0E2A\u0E35 \xB7 \u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E19\u0E35\u0E49\u0E04\u0E37\u0E2D\u0E2A\u0E35\u0E17\u0E35\u0E48\u0E2A\u0E48\u0E07\u0E40\u0E02\u0E49\u0E32\u0E15\u0E31\u0E27\u0E17\u0E33\u0E40\u0E2A\u0E49\u0E19 \u0E01\u0E48\u0E2D\u0E19\u0E40\u0E01\u0E25\u0E35\u0E48\u0E22");
    },
    onResegment() {
      void (async () => {
        const ok = await editor.confirmDiscard("\u0E01\u0E32\u0E23\u0E41\u0E22\u0E01\u0E2A\u0E35\u0E43\u0E2B\u0E21\u0E48\u0E08\u0E32\u0E01\u0E20\u0E32\u0E1E\u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E08\u0E30\u0E25\u0E49\u0E32\u0E07 Zap, \u0E14\u0E34\u0E19\u0E2A\u0E2D, \u0E40\u0E17\u0E2A\u0E35 \u0E41\u0E25\u0E30\u0E01\u0E32\u0E23\u0E23\u0E27\u0E21\u0E2A\u0E35\u0E17\u0E35\u0E48\u0E17\u0E33\u0E44\u0E27\u0E49");
        if (!ok) return;
        editor.load(segmentImage(image.rgba, image.width, image.height, maxColors));
        phaseEl.textContent = "\u0E41\u0E01\u0E49\u0E2A\u0E35 \xB7 " + editor.colorCount() + " \u0E2A\u0E35";
        showStatus("\u0E41\u0E22\u0E01\u0E2A\u0E35\u0E43\u0E2B\u0E21\u0E48 \xB7 " + editor.colorCount() + " \u0E2A\u0E35");
      })();
    },
    onExportSwatches(palette) {
      const lines = palette.map((color, index) => index + 1 + " " + rgbHex(color)).join(" \xB7 ");
      showStatus("\u0E01\u0E25\u0E38\u0E48\u0E21 Swatches \u0E08\u0E30\u0E16\u0E39\u0E01\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E43\u0E19 Illustrator (" + palette.length + " \u0E2A\u0E35): " + lines);
    }
  });
  editor.load(segmentImage(image.rgba, image.width, image.height, maxColors));
  phaseEl.textContent = "\u0E41\u0E01\u0E49\u0E2A\u0E35 \xB7 " + editor.colorCount() + " \u0E2A\u0E35";
  showStatus("\u0E20\u0E32\u0E1E\u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E25\u0E32\u0E22\u0E17\u0E32\u0E07 \u0E21\u0E35\u0E40\u0E28\u0E29\u0E2A\u0E35\u0E02\u0E2D\u0E1A\u0E43\u0E2B\u0E49 Zap");
})();
