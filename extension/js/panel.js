"use strict";
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // src/panel.ts
  var childProcess = __toESM(__require("child_process"));
  var crypto = __toESM(__require("crypto"));
  var fs = __toESM(__require("fs"));
  var os = __toESM(__require("os"));
  var path = __toESM(__require("path"));

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
    for (let start2 = 0; start2 < labels.length; start2++) {
      if ((labels[start2] ?? TRANSPARENT) !== label || owner[start2] !== -1) continue;
      const pixels = [];
      const adjacency = /* @__PURE__ */ new Map();
      let perimeter = 0;
      const id = components.length;
      stack.push(start2);
      owner[start2] = id;
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

  // src/color/png.ts
  var import_zlib = __require("zlib");
  var SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  function decodePng(buffer) {
    if (buffer.length < 8 || !buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error("\u0E44\u0E1F\u0E25\u0E4C\u0E44\u0E21\u0E48\u0E43\u0E0A\u0E48 PNG");
    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = -1;
    const idat = [];
    while (offset + 8 <= buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const type = buffer.toString("ascii", offset + 4, offset + 8);
      const start2 = offset + 8;
      const end = start2 + length;
      if (end + 4 > buffer.length) throw new Error("PNG \u0E02\u0E32\u0E14\u0E2A\u0E48\u0E27\u0E19\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25");
      const chunk2 = buffer.subarray(start2, end);
      if (type === "IHDR") {
        width = chunk2.readUInt32BE(0);
        height = chunk2.readUInt32BE(4);
        bitDepth = chunk2[8] ?? 0;
        colorType = chunk2[9] ?? -1;
        const interlace = chunk2[12] ?? 0;
        if (bitDepth !== 8 || colorType !== 2 && colorType !== 6) throw new Error("\u0E23\u0E2D\u0E07\u0E23\u0E31\u0E1A PNG 8-bit RGB \u0E2B\u0E23\u0E37\u0E2D RGBA \u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19");
        if (interlace !== 0) throw new Error("\u0E44\u0E21\u0E48\u0E23\u0E2D\u0E07\u0E23\u0E31\u0E1A PNG \u0E41\u0E1A\u0E1A interlaced");
        if (width < 1 || height < 1 || width > 8e3 || height > 8e3) throw new Error("\u0E02\u0E19\u0E32\u0E14 PNG \u0E44\u0E21\u0E48\u0E40\u0E2B\u0E21\u0E32\u0E30\u0E01\u0E31\u0E1A\u0E07\u0E32\u0E19\u0E41\u0E01\u0E49\u0E2A\u0E35\u0E43\u0E19\u0E1E\u0E32\u0E40\u0E19\u0E25");
      } else if (type === "IDAT") {
        idat.push(chunk2);
      } else if (type === "IEND") {
        break;
      }
      offset = end + 4;
    }
    if (width === 0 || idat.length === 0) throw new Error("PNG \u0E44\u0E21\u0E48\u0E21\u0E35\u0E20\u0E32\u0E1E");
    const bpp = colorType === 6 ? 4 : 3;
    const inflated = (0, import_zlib.inflateSync)(Buffer.concat(idat));
    const stride = width * bpp;
    const expected = height * (stride + 1);
    if (inflated.length < expected) throw new Error("\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E1E\u0E34\u0E01\u0E40\u0E0B\u0E25\u0E43\u0E19 PNG \u0E44\u0E21\u0E48\u0E04\u0E23\u0E1A");
    const raw = unfilter(inflated, width, height, bpp);
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const source = i * bpp;
      const target = i * 4;
      if (bpp === 4) {
        data[target] = raw[source] ?? 0;
        data[target + 1] = raw[source + 1] ?? 0;
        data[target + 2] = raw[source + 2] ?? 0;
        data[target + 3] = raw[source + 3] ?? 0;
      } else {
        data[target] = raw[source] ?? 0;
        data[target + 1] = raw[source + 1] ?? 0;
        data[target + 2] = raw[source + 2] ?? 0;
        data[target + 3] = 255;
      }
    }
    return { width, height, data };
  }
  function encodePng(width, height, rgba) {
    if (rgba.length < width * height * 4) throw new Error("\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E20\u0E32\u0E1E\u0E2A\u0E31\u0E49\u0E19\u0E01\u0E27\u0E48\u0E32\u0E02\u0E19\u0E32\u0E14\u0E17\u0E35\u0E48\u0E23\u0E30\u0E1A\u0E38");
    const stride = width * 4;
    const raw = Buffer.alloc(height * (stride + 1));
    for (let y = 0; y < height; y++) {
      const row = y * (stride + 1);
      raw[row] = 0;
      for (let x = 0; x < stride; x++) raw[row + 1 + x] = rgba[y * stride + x] ?? 0;
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;
    return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", (0, import_zlib.deflateSync)(raw)), chunk("IEND", Buffer.alloc(0))]);
  }
  function unfilter(scanlines, width, height, bpp) {
    const stride = width * bpp;
    const out = new Uint8Array(height * stride);
    let offset = 0;
    for (let y = 0; y < height; y++) {
      const filter = scanlines[offset] ?? 0;
      offset++;
      const rowStart = y * stride;
      const prevStart = (y - 1) * stride;
      for (let x = 0; x < stride; x++) {
        const raw = scanlines[offset] ?? 0;
        offset++;
        const left = x >= bpp ? out[rowStart + x - bpp] ?? 0 : 0;
        const up = y > 0 ? out[prevStart + x] ?? 0 : 0;
        const upLeft = y > 0 && x >= bpp ? out[prevStart + x - bpp] ?? 0 : 0;
        let value = raw;
        if (filter === 1) value = raw + left & 255;
        else if (filter === 2) value = raw + up & 255;
        else if (filter === 3) value = raw + Math.floor((left + up) / 2) & 255;
        else if (filter === 4) value = raw + paeth(left, up, upLeft) & 255;
        else if (filter !== 0) throw new Error("PNG filter \u0E44\u0E21\u0E48\u0E23\u0E39\u0E49\u0E08\u0E31\u0E01");
        out[rowStart + x] = value;
      }
    }
    return out;
  }
  function paeth(left, up, upLeft) {
    const estimate = left + up - upLeft;
    const distanceLeft = Math.abs(estimate - left);
    const distanceUp = Math.abs(estimate - up);
    const distanceUpLeft = Math.abs(estimate - upLeft);
    if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left;
    if (distanceUp <= distanceUpLeft) return up;
    return upLeft;
  }
  function chunk(type, data) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  }
  var CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index++) {
      let value = index;
      for (let bit = 0; bit < 8; bit++) value = (value & 1) === 1 ? 3988292384 ^ value >>> 1 : value >>> 1;
      table[index] = value >>> 0;
    }
    return table;
  })();
  function crc32(buffer) {
    let crc = 4294967295;
    for (let i = 0; i < buffer.length; i++) {
      const mixed = CRC_TABLE[(crc ^ (buffer[i] ?? 0)) & 255] ?? 0;
      crc = mixed ^ crc >>> 8;
    }
    return (crc ^ 4294967295) >>> 0;
  }

  // src/color/segment.ts
  function segmentImage(rgba, width, height, maxColors) {
    if (rgba.length < width * height * 4) throw new Error("\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E20\u0E32\u0E1E\u0E2A\u0E31\u0E49\u0E19\u0E01\u0E27\u0E48\u0E32\u0E02\u0E19\u0E32\u0E14\u0E17\u0E35\u0E48\u0E23\u0E30\u0E1A\u0E38");
    const colors = Math.max(1, Math.floor(maxColors));
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
  function renderRgba(segmentation) {
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
  function medianCutPalette(unique, maxColors) {
    let buckets = [unique.slice()];
    while (buckets.length < maxColors) {
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

  // src/panel.ts
  var HostTimeoutError = class extends Error {
    constructor() {
      super("Illustrator \u0E44\u0E21\u0E48\u0E15\u0E2D\u0E1A\u0E01\u0E25\u0E31\u0E1A\u0E20\u0E32\u0E22\u0E43\u0E19\u0E40\u0E27\u0E25\u0E32\u0E17\u0E35\u0E48\u0E01\u0E33\u0E2B\u0E19\u0E14");
    }
  };
  function getElement(id) {
    const value = document.getElementById(id);
    if (value === null) throw new Error("Missing panel element: " + id);
    return value;
  }
  function getButton(id) {
    const value = getElement(id);
    if (!(value instanceof HTMLButtonElement)) throw new Error("Expected button: " + id);
    return value;
  }
  function getInput(id) {
    const value = getElement(id);
    if (!(value instanceof HTMLInputElement)) throw new Error("Expected input: " + id);
    return value;
  }
  function getOutput(id) {
    const value = getElement(id);
    if (!(value instanceof HTMLOutputElement)) throw new Error("Expected output: " + id);
    return value;
  }
  function getUi() {
    const preview = getElement("preview");
    const preset = getElement("preset");
    if (!(preview instanceof HTMLImageElement)) throw new Error("Expected preview image");
    if (!(preset instanceof HTMLSelectElement)) throw new Error("Expected preset selector");
    return {
      selection: getElement("selection"),
      status: getElement("status"),
      phase: getElement("phase"),
      preview,
      previewEmpty: getElement("preview-empty"),
      refresh: getButton("refresh"),
      trace: getButton("trace"),
      cancel: getButton("cancel"),
      apply: getButton("apply"),
      preset,
      colors: getInput("colors"),
      colorsValue: getOutput("colors-value"),
      smooth: getInput("smooth"),
      smoothValue: getOutput("smooth-value"),
      editorRoot: getElement("editor-root")
    };
  }
  function parseHostResult(raw) {
    if (raw === "EvalScript error.") throw new Error("Illustrator \u0E40\u0E23\u0E35\u0E22\u0E01\u0E2A\u0E04\u0E23\u0E34\u0E1B\u0E15\u0E4C\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08");
    const parts = raw.split("|");
    const kind = parts[0];
    if (kind === "ERR") throw new Error(decodeURIComponent(parts[1] ?? "Illustrator error"));
    if (kind !== "OK") throw new Error("Illustrator \u0E2A\u0E48\u0E07\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E23\u0E39\u0E1B\u0E41\u0E1A\u0E1A\u0E17\u0E35\u0E48\u0E44\u0E21\u0E48\u0E23\u0E39\u0E49\u0E08\u0E31\u0E01");
    return parts.slice(1).map((part) => decodeURIComponent(part));
  }
  function parsePositiveNumber(raw, label) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) throw new Error("\u0E04\u0E48\u0E32\u0E08\u0E32\u0E01 Illustrator \u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07: " + label);
    return value;
  }
  function parseFiniteNumber(raw, label) {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error("\u0E04\u0E48\u0E32\u0E08\u0E32\u0E01 Illustrator \u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07: " + label);
    return value;
  }
  function parseSelection(parts) {
    if (parts.length !== 11) throw new Error("\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E20\u0E32\u0E1E\u0E17\u0E35\u0E48\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E44\u0E21\u0E48\u0E04\u0E23\u0E1A");
    const itemType = parts[3];
    if (itemType !== "PlacedItem" && itemType !== "RasterItem") throw new Error("\u0E23\u0E2D\u0E07\u0E23\u0E31\u0E1A\u0E20\u0E32\u0E1E raster \u0E17\u0E35\u0E48\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E2B\u0E19\u0E36\u0E48\u0E07\u0E20\u0E32\u0E1E");
    const uuid = parts[4];
    if (!uuid) throw new Error("\u0E20\u0E32\u0E1E\u0E17\u0E35\u0E48\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E44\u0E21\u0E48\u0E21\u0E35 Illustrator UUID");
    const left = parseFiniteNumber(parts[5], "left");
    const top = parseFiniteNumber(parts[6], "top");
    const right = parseFiniteNumber(parts[7], "right");
    const bottom = parseFiniteNumber(parts[8], "bottom");
    return {
      documentName: parts[0] ?? "",
      documentIdentity: parts[1] ?? "",
      itemName: parts[2] ?? "",
      itemType,
      uuid,
      bounds: [left, top, right, bottom],
      widthPt: parsePositiveNumber(String(right - left), "width"),
      heightPt: parsePositiveNumber(String(top - bottom), "height"),
      embedded: parts[9] === "1",
      fromResult: parts[10] === "1"
    };
  }
  function callHost(host, method, args = []) {
    const encoded = args.map((value) => '"' + encodeURIComponent(value) + '"').join(",");
    const script = method + "(" + encoded + ")";
    return new Promise((resolve, reject) => {
      let finished = false;
      const timer = window.setTimeout(() => {
        if (finished) return;
        finished = true;
        reject(new HostTimeoutError());
      }, 18e4);
      host.evalScript(script, (raw) => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timer);
        try {
          resolve(parseHostResult(raw));
        } catch (error) {
          reject(error);
        }
      });
    });
  }
  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }
  function newJob(settings) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vector-panel-"));
    return {
      id: crypto.randomBytes(8).toString("hex"),
      directory,
      pngPath: path.join(directory, "source.png"),
      flatPath: path.join(directory, "flat.png"),
      svgPath: path.join(directory, "result.svg"),
      settings,
      cancelled: false
    };
  }
  function cleanJob(job) {
    try {
      fs.rmSync(job.directory, { recursive: true, force: true });
    } catch (_) {
    }
  }
  function cleanStaleJobs() {
    try {
      const root = os.tmpdir();
      for (const name of fs.readdirSync(root)) {
        if (!name.startsWith("vector-panel-")) continue;
        const directory = path.join(root, name);
        const stat = fs.statSync(directory);
        if (stat.isDirectory() && Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1e3) {
          fs.rmSync(directory, { recursive: true, force: true });
        }
      }
    } catch (_) {
    }
  }
  function vtracerArguments(job, maxColors) {
    const args = [job.flatPath, job.svgPath];
    const preset = job.settings.preset;
    const colors = String(Math.max(2, maxColors));
    if (preset === "photo") {
      args.push("--preset", "photo", "--max-colors", colors);
    } else {
      args.push("--preset", "poster", "--hierarchical", "cutout", "--max-colors", colors);
      if (preset === "icon") args.push("--mode", "polygon");
    }
    if (job.settings.simplify > 0) args.push("--simplify", String(job.settings.simplify));
    args.push("--optimize", "1");
    return args;
  }
  function runVtracer(binary, job, maxColors, onStart) {
    return new Promise((resolve, reject) => {
      const child = childProcess.spawn(binary, vtracerArguments(job, maxColors), { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      onStart(child);
      let stderr = "";
      child.stderr?.on("data", (chunk2) => {
        if (stderr.length < 4e3) stderr += chunk2.toString("utf8").slice(0, 4e3 - stderr.length);
      });
      child.once("error", (error) => reject(error));
      child.once("close", (code) => {
        if (job.cancelled) {
          reject(new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27"));
        } else if (code === 0 && fs.existsSync(job.svgPath) && fs.statSync(job.svgPath).size > 0) {
          resolve();
        } else {
          reject(new Error("VTracer \u0E41\u0E1B\u0E25\u0E07\u0E20\u0E32\u0E1E\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08" + (stderr ? ": " + stderr.trim() : "")));
        }
      });
    });
  }
  function readSettings(ui) {
    const preset = ui.preset.value;
    if (preset !== "logo" && preset !== "icon" && preset !== "photo") throw new Error("Preset \u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07");
    const maxColors = Number(ui.colors.value);
    const simplify = Number(ui.smooth.value) / 10;
    if (!Number.isInteger(maxColors) || maxColors < 2 || maxColors > 32) throw new Error("\u0E08\u0E33\u0E19\u0E27\u0E19\u0E2A\u0E35\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07");
    if (!Number.isFinite(simplify) || simplify < 0 || simplify > 3) throw new Error("\u0E04\u0E48\u0E32\u0E04\u0E27\u0E32\u0E21\u0E40\u0E23\u0E35\u0E22\u0E1A\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07");
    return { preset, maxColors, simplify };
  }
  function showSelection(ui, selection) {
    ui.selection.replaceChildren();
    if (selection === null) {
      ui.selection.textContent = "\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E20\u0E32\u0E1E raster \u0E2B\u0E19\u0E36\u0E48\u0E07\u0E20\u0E32\u0E1E\u0E1A\u0E19 artboard";
      return;
    }
    const title = document.createElement("strong");
    title.textContent = selection.itemName || selection.itemType;
    const detail = document.createElement("small");
    detail.textContent = selection.documentName + " \xB7 " + (selection.embedded ? "embedded" : "linked") + " \xB7 " + Math.round(selection.widthPt) + " \xD7 " + Math.round(selection.heightPt) + " pt";
    if (selection.fromResult) detail.textContent += " \xB7 \u0E41\u0E1B\u0E25\u0E07\u0E0B\u0E49\u0E33\u0E40\u0E1B\u0E47\u0E19\u0E40\u0E27\u0E2D\u0E23\u0E4C\u0E0A\u0E31\u0E19\u0E43\u0E2B\u0E21\u0E48";
    ui.selection.append(title, detail);
  }
  function currentSelection(state) {
    switch (state.kind) {
      case "empty":
        return null;
      case "loading":
        return null;
      case "selected":
      case "capturing":
      case "editing":
      case "tracing":
      case "preview":
      case "applying":
        return state.selection;
      default: {
        const exhaustive = state;
        return exhaustive;
      }
    }
  }
  var RESET_CAPTURE = "\u0E01\u0E32\u0E23\u0E2D\u0E48\u0E32\u0E19\u0E20\u0E32\u0E1E\u0E41\u0E25\u0E49\u0E27\u0E41\u0E22\u0E01\u0E2A\u0E35\u0E43\u0E2B\u0E21\u0E48\u0E08\u0E30\u0E25\u0E49\u0E32\u0E07 Zap, \u0E14\u0E34\u0E19\u0E2A\u0E2D, \u0E40\u0E17\u0E2A\u0E35 \u0E41\u0E25\u0E30\u0E01\u0E32\u0E23\u0E23\u0E27\u0E21\u0E2A\u0E35\u0E17\u0E35\u0E48\u0E17\u0E33\u0E44\u0E27\u0E49 \u0E16\u0E49\u0E32\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E40\u0E2A\u0E49\u0E19\u0E08\u0E32\u0E01\u0E2A\u0E35\u0E17\u0E35\u0E48\u0E41\u0E01\u0E49\u0E2D\u0E22\u0E39\u0E48 \u0E43\u0E2B\u0E49\u0E01\u0E14\u0E14\u0E39\u0E40\u0E2A\u0E49\u0E19\u0E41\u0E17\u0E19";
  var RESET_SEGMENT = "\u0E01\u0E32\u0E23\u0E41\u0E22\u0E01\u0E2A\u0E35\u0E43\u0E2B\u0E21\u0E48\u0E08\u0E32\u0E01\u0E20\u0E32\u0E1E\u0E17\u0E35\u0E48\u0E08\u0E31\u0E1A\u0E44\u0E27\u0E49\u0E08\u0E30\u0E25\u0E49\u0E32\u0E07\u0E01\u0E32\u0E23\u0E41\u0E01\u0E49\u0E2A\u0E35\u0E17\u0E35\u0E48\u0E17\u0E33\u0E14\u0E49\u0E27\u0E22\u0E21\u0E37\u0E2D \u0E41\u0E25\u0E49\u0E27\u0E40\u0E23\u0E34\u0E48\u0E21\u0E19\u0E31\u0E1A\u0E2A\u0E35\u0E08\u0E32\u0E01\u0E20\u0E32\u0E1E\u0E15\u0E49\u0E19\u0E09\u0E1A\u0E31\u0E1A\u0E2D\u0E35\u0E01\u0E04\u0E23\u0E31\u0E49\u0E07";
  function swatchPayload(palette) {
    return palette.map((color) => color.r + "," + color.g + "," + color.b).join(";");
  }
  function start() {
    const ui = getUi();
    let state = { kind: "empty" };
    const extensionPath = typeof CSInterface === "undefined" ? "" : new CSInterface().getSystemPath(SystemPath.EXTENSION);
    const host = typeof CSInterface === "undefined" ? null : new CSInterface();
    const editor = createColorEditor(ui.editorRoot, {
      onVectorPreview: () => {
        void vectorize();
      },
      onResegment: () => {
        void resegment();
      },
      onExportSwatches: (palette) => {
        void exportSwatches(palette);
      },
      onChange: (colorCount) => {
        if (state.kind === "editing") ui.phase.textContent = "\u0E41\u0E01\u0E49\u0E2A\u0E35 \xB7 " + colorCount + " \u0E2A\u0E35";
        else if (state.kind === "preview") ui.phase.textContent = "\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E43\u0E2A\u0E48\u0E1C\u0E25 \xB7 " + colorCount + " \u0E2A\u0E35";
      }
    });
    function message(value, isError = false) {
      ui.status.textContent = value;
      ui.status.classList.toggle("error", isError);
    }
    function render() {
      showSelection(ui, currentSelection(state));
      const busy = state.kind === "loading" || state.kind === "capturing" || state.kind === "tracing" || state.kind === "applying";
      ui.refresh.disabled = busy;
      ui.trace.disabled = busy || state.kind === "empty";
      ui.trace.textContent = currentSelection(state)?.fromResult ? "\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E40\u0E27\u0E2D\u0E23\u0E4C\u0E0A\u0E31\u0E19\u0E43\u0E2B\u0E21\u0E48" : "\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07";
      ui.apply.disabled = state.kind !== "preview";
      ui.cancel.hidden = state.kind !== "tracing";
      ui.editorRoot.hidden = !editor.hasDocument();
      const count = editor.hasDocument() ? " \xB7 " + editor.colorCount() + " \u0E2A\u0E35" : "";
      const phase = state.kind === "loading" ? "\u0E15\u0E23\u0E27\u0E08\u0E20\u0E32\u0E1E" : state.kind === "capturing" ? "\u0E2D\u0E48\u0E32\u0E19\u0E20\u0E32\u0E1E" : state.kind === "editing" ? "\u0E41\u0E01\u0E49\u0E2A\u0E35" : state.kind === "tracing" ? "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E41\u0E1B\u0E25\u0E07" : state.kind === "applying" ? "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E43\u0E2A\u0E48\u0E1C\u0E25" : state.kind === "preview" ? "\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E43\u0E2A\u0E48\u0E1C\u0E25" : "\u0E1E\u0E23\u0E49\u0E2D\u0E21";
      ui.phase.textContent = phase + (state.kind === "editing" || state.kind === "preview" || state.kind === "applying" ? count : "");
      if (state.kind === "preview" || state.kind === "applying") {
        ui.preview.src = state.dataUrl;
        ui.preview.hidden = false;
        ui.previewEmpty.hidden = true;
      } else {
        ui.preview.removeAttribute("src");
        ui.preview.hidden = true;
        ui.previewEmpty.hidden = false;
      }
    }
    function openSegmentation(job) {
      const decoded = decodePng(fs.readFileSync(job.pngPath));
      editor.load(segmentImage(decoded.data, decoded.width, decoded.height, job.settings.maxColors));
    }
    async function refresh() {
      if (host === null) {
        message("\u0E40\u0E1B\u0E34\u0E14 Panel \u0E19\u0E35\u0E49\u0E08\u0E32\u0E01 Adobe Illustrator \u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19", true);
        return;
      }
      if (state.kind === "loading" || state.kind === "capturing" || state.kind === "tracing" || state.kind === "applying") return;
      if (!await editor.confirmDiscard(RESET_CAPTURE)) return;
      if (state.kind === "preview" || state.kind === "editing") cleanJob(state.job);
      editor.clear();
      state = { kind: "loading" };
      render();
      try {
        const selection = parseSelection(await callHost(host, "VP_snapshot"));
        state = { kind: "selected", selection };
        message("\u0E20\u0E32\u0E1E\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E41\u0E1B\u0E25\u0E07");
      } catch (error) {
        state = { kind: "empty" };
        message(errorMessage(error), true);
      }
      render();
    }
    async function trace() {
      if (host === null) return;
      if (state.kind !== "selected" && state.kind !== "preview" && state.kind !== "editing") return;
      if (!await editor.confirmDiscard(RESET_CAPTURE)) return;
      const selection = state.selection;
      if (state.kind === "preview" || state.kind === "editing") cleanJob(state.job);
      let job = null;
      try {
        job = newJob(readSettings(ui));
        state = { kind: "capturing", selection, job };
        message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E2D\u0E48\u0E32\u0E19\u0E20\u0E32\u0E1E\u0E08\u0E32\u0E01 Illustrator\u2026");
        render();
        await callHost(host, "VP_capture", [selection.uuid, job.pngPath, selection.documentIdentity]);
        if (!fs.existsSync(job.pngPath) || fs.statSync(job.pngPath).size === 0) throw new Error("Illustrator \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E2A\u0E48\u0E07\u0E20\u0E32\u0E1E PNG \u0E01\u0E25\u0E31\u0E1A\u0E21\u0E32");
        openSegmentation(job);
        state = { kind: "editing", selection, job };
        message("\u0E41\u0E22\u0E01\u0E44\u0E14\u0E49 " + editor.colorCount() + " \u0E2A\u0E35 \u0E41\u0E01\u0E49\u0E1A\u0E19\u0E41\u0E1C\u0E19\u0E17\u0E35\u0E48\u0E2A\u0E35 \u0E41\u0E25\u0E49\u0E27\u0E01\u0E14\u0E14\u0E39\u0E40\u0E2A\u0E49\u0E19\u0E40\u0E21\u0E37\u0E48\u0E2D\u0E1E\u0E23\u0E49\u0E2D\u0E21");
        render();
      } catch (error) {
        if (job !== null) cleanJob(job);
        editor.clear();
        state = { kind: "selected", selection };
        message(errorMessage(error), true);
        render();
      }
    }
    async function resegment() {
      if (state.kind !== "editing" && state.kind !== "preview") return;
      if (!await editor.confirmDiscard(RESET_SEGMENT)) return;
      const { selection, job } = state;
      try {
        job.settings = readSettings(ui);
        openSegmentation(job);
        state = { kind: "editing", selection, job };
        message("\u0E41\u0E22\u0E01\u0E2A\u0E35\u0E43\u0E2B\u0E21\u0E48 \xB7 " + editor.colorCount() + " \u0E2A\u0E35");
      } catch (error) {
        message(errorMessage(error), true);
      }
      render();
    }
    async function vectorize() {
      if (state.kind !== "editing" && state.kind !== "preview" || !editor.hasDocument()) return;
      const { selection, job } = state;
      try {
        const segmentation = editor.segmentation();
        if (segmentation.palette.length === 0) throw new Error("\u0E44\u0E21\u0E48\u0E21\u0E35\u0E2A\u0E35\u0E43\u0E2B\u0E49\u0E41\u0E1B\u0E25\u0E07");
        fs.writeFileSync(job.flatPath, encodePng(segmentation.width, segmentation.height, renderRgba(segmentation)));
        const binary = path.join(extensionPath, "bin", process.platform === "win32" ? "vtracer.exe" : "vtracer");
        let note = "";
        if (!fs.existsSync(binary)) {
          fs.writeFileSync(job.svgPath, segmentationToSvg(segmentation), "utf8");
          note = "\u0E44\u0E21\u0E48\u0E1E\u0E1A VTracer \u0E08\u0E36\u0E07\u0E41\u0E2A\u0E14\u0E07\u0E2A\u0E35\u0E17\u0E35\u0E48\u0E41\u0E01\u0E49\u0E41\u0E1A\u0E1A\u0E1E\u0E34\u0E01\u0E40\u0E0B\u0E25";
        } else {
          message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E40\u0E2A\u0E49\u0E19\u0E08\u0E32\u0E01\u0E2A\u0E35\u0E17\u0E35\u0E48\u0E41\u0E01\u0E49\u2026");
          state = { kind: "tracing", selection, job, child: null };
          render();
          await runVtracer(binary, job, segmentation.palette.length, (child) => {
            state = { kind: "tracing", selection, job, child };
            render();
          });
        }
        const svg = fs.readFileSync(job.svgPath, "utf8");
        state = { kind: "preview", selection, job, dataUrl: "data:image/svg+xml;base64," + Buffer.from(svg, "utf8").toString("base64") };
        message((note ? note + " \xB7 " : "\u0E14\u0E39\u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E41\u0E25\u0E49\u0E27\u0E01\u0E14\u0E43\u0E2A\u0E48\u0E43\u0E19 Illustrator \xB7 ") + "\u0E41\u0E1C\u0E19\u0E17\u0E35\u0E48\u0E2A\u0E35 " + editor.colorCount() + " \xB7 \u0E40\u0E27\u0E01\u0E40\u0E15\u0E2D\u0E23\u0E4C " + countSvgFills(svg) + " \u0E2A\u0E35");
        render();
      } catch (error) {
        state = { kind: "editing", selection, job };
        message(errorMessage(error), true);
        render();
      }
    }
    async function exportSwatches(palette) {
      if (host === null) {
        message("\u0E43\u0E2A\u0E48 Swatches \u0E44\u0E14\u0E49\u0E40\u0E21\u0E37\u0E48\u0E2D\u0E40\u0E1B\u0E34\u0E14 Panel \u0E43\u0E19 Illustrator", true);
        return;
      }
      if (palette.length === 0) {
        message("\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E2A\u0E35\u0E43\u0E2B\u0E49\u0E43\u0E2A\u0E48", true);
        return;
      }
      const jobId = state.kind === "editing" || state.kind === "preview" || state.kind === "tracing" || state.kind === "applying" || state.kind === "capturing" ? state.job.id : "palette";
      try {
        const result = await callHost(host, "VP_swatches", ["Vector Panel " + jobId, swatchPayload(palette)]);
        message("\u0E43\u0E2A\u0E48 Swatches \u0E41\u0E25\u0E49\u0E27 " + (result[1] ?? String(palette.length)) + " \u0E2A\u0E35 \u0E43\u0E19\u0E01\u0E25\u0E38\u0E48\u0E21 " + (result[0] ?? ""));
      } catch (error) {
        message(errorMessage(error), true);
      }
    }
    async function apply() {
      if (host === null || state.kind !== "preview") return;
      const { selection, job, dataUrl } = state;
      state = { kind: "applying", selection, job, dataUrl };
      message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E19\u0E33 path \u0E40\u0E02\u0E49\u0E32 Illustrator\u2026");
      render();
      try {
        const settings = "preset=" + job.settings.preset + ";colors=" + job.settings.maxColors + ";simplify=" + job.settings.simplify + ";edited=" + editor.colorCount();
        const result = await callHost(host, "VP_commit", [selection.uuid, job.svgPath, job.id, settings, selection.bounds.join(","), selection.documentIdentity]);
        message("\u0E43\u0E2A\u0E48\u0E1C\u0E25\u0E41\u0E25\u0E49\u0E27: " + (result[1] ?? "0") + " paths \xB7 \u0E15\u0E49\u0E19\u0E09\u0E1A\u0E31\u0E1A\u0E22\u0E31\u0E07\u0E2D\u0E22\u0E39\u0E48 \xB7 \u0E2A\u0E35 " + editor.colorCount());
        cleanJob(job);
        editor.clear();
        state = { kind: "selected", selection };
      } catch (error) {
        if (error instanceof HostTimeoutError) {
          message("Illustrator \u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E15\u0E2D\u0E1A\u0E01\u0E25\u0E31\u0E1A \u0E15\u0E23\u0E27\u0E08 Layers \u0E01\u0E48\u0E2D\u0E19\u0E01\u0E14\u0E43\u0E2A\u0E48\u0E1C\u0E25\u0E2D\u0E35\u0E01\u0E04\u0E23\u0E31\u0E49\u0E07 \u0E01\u0E32\u0E23\u0E41\u0E01\u0E49\u0E2A\u0E35\u0E22\u0E31\u0E07\u0E2D\u0E22\u0E39\u0E48", true);
          state = { kind: "editing", selection, job };
        } else {
          message(errorMessage(error), true);
          state = { kind: "preview", selection, job, dataUrl };
        }
      }
      render();
    }
    ui.refresh.addEventListener("click", () => {
      void refresh();
    });
    ui.trace.addEventListener("click", () => {
      void trace();
    });
    ui.apply.addEventListener("click", () => {
      void apply();
    });
    ui.cancel.addEventListener("click", () => {
      if (state.kind !== "tracing") return;
      state.job.cancelled = true;
      state.child?.kill();
      message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u2026");
    });
    ui.colors.addEventListener("input", () => {
      ui.colorsValue.value = ui.colors.value;
    });
    ui.smooth.addEventListener("input", () => {
      ui.smoothValue.value = (Number(ui.smooth.value) / 10).toFixed(1);
    });
    ui.preset.addEventListener("change", () => {
      ui.colors.value = ui.preset.value === "photo" ? "24" : ui.preset.value === "icon" ? "4" : "8";
      ui.colorsValue.value = ui.colors.value;
    });
    window.addEventListener("beforeunload", () => {
      if (state.kind === "preview" || state.kind === "editing") cleanJob(state.job);
      if (state.kind === "tracing") {
        state.job.cancelled = true;
        state.child?.kill();
        cleanJob(state.job);
      }
    });
    cleanStaleJobs();
    render();
    void refresh();
  }
  start();
})();
