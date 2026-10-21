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
  var crypto = __toESM(__require("crypto"));
  var fs = __toESM(__require("fs"));
  var os = __toESM(__require("os"));
  var path = __toESM(__require("path"));

  // src/color/oklab.ts
  function srgbToLinear(channel) {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }
  function linearToSrgb(channel) {
    const value = channel <= 31308e-7 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, value)) * 255);
  }
  function rgbToOklab(r, g, b) {
    const lr = srgbToLinear(r);
    const lg = srgbToLinear(g);
    const lb = srgbToLinear(b);
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    return {
      l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    };
  }
  function oklabToRgb(lab) {
    const l = lab.l + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
    const m = lab.l - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
    const s = lab.l - 0.0894841775 * lab.a - 1.291485548 * lab.b;
    const l3 = l * l * l;
    const m3 = m * m * m;
    const s3 = s * s * s;
    return {
      r: linearToSrgb(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
      g: linearToSrgb(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
      b: linearToSrgb(-0.0041960362 * l3 - 0.7034186147 * m3 + 1.707614701 * s3)
    };
  }
  function oklabDistance(a, b) {
    const dl = a.l - b.l;
    const da = a.a - b.a;
    const db = a.b - b.b;
    return Math.sqrt(dl * dl + da * da + db * db);
  }
  function oklabChroma(lab) {
    return Math.hypot(lab.a, lab.b);
  }

  // src/color/model.ts
  var TRANSPARENT = 65535;
  var ZAP_STROKE_CONTRAST = 0.28;
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
      this.smoothMask = new Uint8Array(segmentation.labels.length);
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
        if ((this.smoothMask[i] ?? 0) !== (this.original.smoothMask[i] ?? 0)) return true;
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
      let smoothMask;
      for (let i = 0; i < this.smoothMask.length; i++) {
        if ((this.smoothMask[i] ?? 0) > 0) {
          smoothMask = this.smoothMask.slice();
          break;
        }
      }
      return {
        width: this.width,
        height: this.height,
        labels: this.labels.slice(),
        palette: clonePalette(this.palette),
        smoothMask
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
      if (strokeProtected(clicked, label, this.palette, this.width, this.height)) {
        return { ok: false, reason: "\u0E40\u0E2A\u0E49\u0E19\u0E19\u0E35\u0E49\u0E15\u0E31\u0E14\u0E01\u0E31\u0E1A\u0E2A\u0E35\u0E02\u0E49\u0E32\u0E07\u0E40\u0E04\u0E35\u0E22\u0E07\u0E0A\u0E31\u0E14 Zap \u0E08\u0E36\u0E07\u0E44\u0E21\u0E48\u0E25\u0E1A \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E44\u0E21\u0E48\u0E43\u0E2B\u0E49\u0E15\u0E31\u0E27\u0E2D\u0E31\u0E01\u0E29\u0E23\u0E2B\u0E23\u0E37\u0E2D\u0E08\u0E38\u0E14\u0E17\u0E35\u0E48\u0E04\u0E21\u0E0A\u0E31\u0E14\u0E2B\u0E32\u0E22" };
      }
      const plan = [];
      for (const component of found.components) {
        const stats = component === clicked ? clickedStats : measure(component, this.width, this.height, this.thresholds, areaLimit, fragmentCap);
        if (!stats.zappable) continue;
        if (strokeProtected(component, label, this.palette, this.width, this.height)) continue;
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
    /**
     * Mark the shared boundary under this pixel for a stronger clean-shape fit.
     * One gesture is one undo step.
     */
    smoothAt(x, y, stroke = null) {
      if (!this.inBounds(x, y)) return { ok: false, reason: "\u0E04\u0E25\u0E34\u0E01\u0E19\u0E2D\u0E01\u0E20\u0E32\u0E1E" };
      const segment = boundarySegment(this.labels, this.width, this.height, x, y);
      if (segment.length === 0) return { ok: false, reason: "\u0E04\u0E25\u0E34\u0E01\u0E1A\u0E19\u0E23\u0E2D\u0E22\u0E15\u0E48\u0E2D\u0E02\u0E2D\u0E07\u0E2A\u0E2D\u0E07\u0E2A\u0E35 \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E40\u0E01\u0E25\u0E32\u0E0A\u0E48\u0E27\u0E07\u0E19\u0E31\u0E49\u0E19" };
      const fresh = segment.filter((pixel) => (this.smoothMask[pixel] ?? 0) === 0);
      if (fresh.length === 0) return { ok: true, changed: false, indexMap: null, detail: "" };
      if (!stroke?.pushed) this.pushHistory();
      if (stroke) stroke.pushed = true;
      for (const pixel of fresh) this.smoothMask[pixel] = 1;
      return { ok: true, changed: true, indexMap: null, detail: "\u0E40\u0E01\u0E25\u0E32\u0E02\u0E2D\u0E1A " + segment.length + " \u0E1E\u0E34\u0E01\u0E40\u0E0B\u0E25" };
    }
    smoothLasso(x0, y0, x1, y1) {
      const left = Math.max(0, Math.min(x0, x1));
      const right = Math.min(this.width - 1, Math.max(x0, x1));
      const top = Math.max(0, Math.min(y0, y1));
      const bottom = Math.min(this.height - 1, Math.max(y0, y1));
      const seen = new Uint8Array(this.labels.length);
      const fresh = [];
      for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
          const index = y * this.width + x;
          if (seen[index]) continue;
          if (!isBoundary(this.labels, this.width, this.height, x, y)) continue;
          const segment = boundarySegment(this.labels, this.width, this.height, x, y);
          for (const pixel of segment) {
            seen[pixel] = 1;
            if ((this.smoothMask[pixel] ?? 0) === 0) fresh.push(pixel);
          }
        }
      }
      if (fresh.length === 0) return { ok: true, changed: false, indexMap: null, detail: "\u0E43\u0E19\u0E01\u0E23\u0E2D\u0E1A\u0E19\u0E35\u0E49\u0E44\u0E21\u0E48\u0E21\u0E35\u0E02\u0E2D\u0E1A\u0E43\u0E2B\u0E49\u0E40\u0E01\u0E25\u0E32" };
      this.pushHistory();
      for (const pixel of fresh) this.smoothMask[pixel] = 1;
      return { ok: true, changed: true, indexMap: null, detail: "\u0E40\u0E01\u0E25\u0E32\u0E02\u0E2D\u0E1A\u0E43\u0E19\u0E01\u0E23\u0E2D\u0E1A " + fresh.length + " \u0E1E\u0E34\u0E01\u0E40\u0E0B\u0E25" };
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
      return { labels: this.labels.slice(), palette: clonePalette(this.palette), active: this.active, smoothMask: this.smoothMask.slice() };
    }
    restore(snapshot) {
      this.labels = snapshot.labels.slice();
      this.palette = clonePalette(snapshot.palette);
      this.active = snapshot.active;
      this.smoothMask = snapshot.smoothMask.slice();
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
    const thickness2 = componentThickness(component.pixels, width, height, thresholds.maxThinWidth);
    return {
      area: component.area,
      ratio,
      thickness: thickness2,
      zappable: thickness2 <= thresholds.maxThinWidth
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
  function isBoundary(labels, width, height, x, y) {
    const label = labels[y * width + x] ?? TRANSPARENT;
    if (label === TRANSPARENT) return false;
    const neighbors = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1]
    ];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return true;
      if ((labels[ny * width + nx] ?? TRANSPARENT) !== label) return true;
    }
    return false;
  }
  function nearestBoundary(labels, width, height, x, y) {
    if (isBoundary(labels, width, height, x, y)) return { x, y };
    for (let radius = 1; radius <= 6; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (isBoundary(labels, width, height, nx, ny)) return { x: nx, y: ny };
        }
      }
    }
    return null;
  }
  function boundarySegment(labels, width, height, x, y) {
    const origin = nearestBoundary(labels, width, height, x, y);
    if (!origin) return [];
    const index = origin.y * width + origin.x;
    const label = labels[index] ?? TRANSPARENT;
    let other = TRANSPARENT;
    const around = [
      [origin.x - 1, origin.y],
      [origin.x + 1, origin.y],
      [origin.x, origin.y - 1],
      [origin.x, origin.y + 1]
    ];
    for (const [nx, ny] of around) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        other = TRANSPARENT;
        break;
      }
      const neighbor = labels[ny * width + nx] ?? TRANSPARENT;
      if (neighbor !== label) {
        other = neighbor;
        break;
      }
    }
    const pixels = [];
    const seen = new Uint8Array(labels.length);
    const stack = [index];
    seen[index] = 1;
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === void 0) break;
      const cx = current % width;
      const cy = (current - cx) / width;
      let touches = false;
      const nexts = [current - 1, current + 1, current - width, current + width];
      for (const next of nexts) {
        if (next < 0 || next >= labels.length) {
          if (other === TRANSPARENT) touches = true;
          continue;
        }
        const nx = next % width;
        if (Math.abs(nx - cx) + Math.abs(Math.floor(next / width) - cy) !== 1) {
          if (other === TRANSPARENT) touches = true;
          continue;
        }
        const neighbor = labels[next] ?? TRANSPARENT;
        if (neighbor === other) touches = true;
        else if (neighbor === label && seen[next] === 0 && (labels[next] ?? TRANSPARENT) === label) {
        }
      }
      if (!touches) continue;
      pixels.push(current);
      for (const next of nexts) {
        if (next < 0 || next >= labels.length || seen[next] === 1) continue;
        const nx = next % width;
        if (Math.abs(nx - cx) + Math.abs(Math.floor(next / width) - cy) !== 1) continue;
        if ((labels[next] ?? TRANSPARENT) !== label) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    return pixels;
  }
  function strokeProtected(component, ownLabel, palette, width, height) {
    if (!componentElongated(component, width, height)) return false;
    const target = bestNeighbor(component, ownLabel, palette);
    if (target === null) return false;
    const own = palette[ownLabel];
    const other = palette[target];
    if (!own || !other) return false;
    return oklabDistance(rgbToOklab(own.r, own.g, own.b), rgbToOklab(other.r, other.g, other.b)) >= ZAP_STROKE_CONTRAST;
  }
  function componentElongated(component, width, height) {
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    for (const pixel of component.pixels) {
      const x = pixel % width;
      const y = (pixel - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const spanX = maxX - minX + 1;
    const spanY = maxY - minY + 1;
    const aspect = Math.max(spanX, spanY) / Math.max(1, Math.min(spanX, spanY));
    if (aspect >= 2.2) return true;
    return component.area >= 6 && componentThickness(component.pixels, width, height, 2) <= 2;
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
    dropper: "Color \xB7 \u0E04\u0E25\u0E34\u0E01\u0E1A\u0E19\u0E20\u0E32\u0E1E\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E2B\u0E22\u0E34\u0E1A\u0E2A\u0E35\u0E08\u0E32\u0E01\u0E2A\u0E48\u0E27\u0E19\u0E19\u0E31\u0E49\u0E19",
    smooth: "Smooth \xB7 \u0E04\u0E25\u0E34\u0E01\u0E0A\u0E48\u0E27\u0E07\u0E02\u0E2D\u0E1A\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E40\u0E01\u0E25\u0E32\u0E43\u0E2B\u0E49\u0E40\u0E1B\u0E47\u0E19\u0E40\u0E2A\u0E49\u0E19\u0E2B\u0E23\u0E37\u0E2D\u0E2A\u0E48\u0E27\u0E19\u0E42\u0E04\u0E49\u0E07 \u0E25\u0E32\u0E01\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E1B\u0E31\u0E14 Shift \u0E04\u0E49\u0E32\u0E07\u0E41\u0E25\u0E49\u0E27\u0E25\u0E32\u0E01\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E04\u0E25\u0E38\u0E21\u0E01\u0E23\u0E2D\u0E1A"
  };
  var ICONS = {
    undo: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M6.5 3.2 3 6.5l3.5 3.2V7.4c2.7.2 4.4 1.6 5.2 3.6.2-3.4-1.4-6.2-5.2-6.6V3.2z"/></svg>',
    redo: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M9.5 3.2 13 6.5 9.5 9.7V7.4c-2.7.2-4.4 1.6-5.2 3.6-.2-3.4 1.4-6.2 5.2-6.6V3.2z"/></svg>',
    revert: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.4" d="M8 3.2v3.2M8 3.2A4.8 4.8 0 1 1 3.4 8"/><path fill="currentColor" d="M8 2.2 5.8 5h4.4L8 2.2z"/></svg>',
    zap: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M9.2 1 3 9h4.2L6.4 15 13 6.6H8.6L9.2 1z"/></svg>',
    fill: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8.2 1.6 3.4 8.2c-.8 1.1-.2 2.8 1.2 2.8h.2l-.6 2.6h8.2l-.7-2.6h.2c1.4 0 2-.1 1.2-2.8L8.2 1.6z"/></svg>',
    pencil: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M11.2 1.8 14.2 4.8 5.6 13.4 2 14l.6-3.6 8.6-8.6z"/></svg>',
    dropper: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M10.2 1.6c.8.1 1.6.5 2.2 1.1l.9.9c.6.6 1 1.4 1.1 2.2l-2.2.6-4.7 4.7-2.6-2.6 4.7-4.7.6-2.2zM3.2 10.2l2.6 2.6-2.2 1.2-1.6-1.6 1.2-2.2z"/></svg>',
    smooth: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M2 11c2.2-4 3.4-4 5.2-1.2C8.8 12.2 10 12.4 14 5"/></svg>'
  };
  function createColorEditor(container, hooks = {}) {
    container.replaceChildren();
    container.insertAdjacentHTML("beforeend", editorMarkup(hooks));
    const canvas = required(container, "canvas", HTMLCanvasElement);
    const context = canvasContext(canvas);
    const stage = document.createElement("div");
    stage.className = "seg-stage";
    const smoothMarquee = document.createElement("div");
    smoothMarquee.className = "marquee";
    smoothMarquee.hidden = true;
    canvas.replaceWith(stage);
    stage.append(canvas, smoothMarquee);
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
        const marked = (doc.smoothMask[i] ?? 0) > 0;
        data[offset] = marked ? Math.round(color.r * 0.42 + 207 * 0.58) : color.r;
        data[offset + 1] = marked ? Math.round(color.g * 0.42 + 182 * 0.58) : color.g;
        data[offset + 2] = marked ? Math.round(color.b * 0.42 + 255 * 0.58) : color.b;
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
    function paintSmooth(x0, y0, x1, y1) {
      if (!doc || !stroke) return;
      const dx = Math.abs(x1 - x0);
      const dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx - dy;
      let x = x0;
      let y = y0;
      let changed = false;
      while (true) {
        const result = doc.smoothAt(x, y, stroke);
        if (result.ok && result.changed) changed = true;
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
      if (changed) paintBitmap();
    }
    function placeSmoothMarquee(x0, y0, x1, y1) {
      const scale = Number(zoom.value) || 1;
      const left = Math.min(x0, x1) * scale;
      const top = Math.min(y0, y1) * scale;
      smoothMarquee.hidden = false;
      smoothMarquee.style.left = left + "px";
      smoothMarquee.style.top = top + "px";
      smoothMarquee.style.width = Math.abs(x1 - x0) * scale + "px";
      smoothMarquee.style.height = Math.abs(y1 - y0) * scale + "px";
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
      if (drag && event.pointerId === drag.pointerId && drag.kind === "smooth") {
        const pixel = eventPixel(event);
        if (!pixel) return;
        paintSmooth(drag.x, drag.y, pixel.x, pixel.y);
        drag.x = pixel.x;
        drag.y = pixel.y;
        return;
      }
      if (drag && event.pointerId === drag.pointerId && drag.kind === "smooth-lasso") {
        const pixel = eventPixel(event);
        if (!pixel) return;
        drag.x1 = pixel.x;
        drag.y1 = pixel.y;
        if (Math.abs(pixel.x - drag.x0) + Math.abs(pixel.y - drag.y0) > 2) drag.moved = true;
        placeSmoothMarquee(drag.x0, drag.y0, pixel.x, pixel.y);
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
      } else if (current.kind === "smooth") {
        stroke = null;
        syncChrome();
      } else if (current.kind === "smooth-lasso") {
        smoothMarquee.hidden = true;
        if (doc && current.moved) finish(doc.smoothLasso(current.x0, current.y0, current.x1, current.y1));
        else if (doc) finish(doc.smoothAt(current.x0, current.y0, null));
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
      if (tool === "smooth") {
        stroke = { pushed: false };
        if (event.shiftKey) {
          drag = { kind: "smooth-lasso", pointerId: event.pointerId, x0: pixel.x, y0: pixel.y, x1: pixel.x, y1: pixel.y, moved: false };
          placeSmoothMarquee(pixel.x, pixel.y, pixel.x, pixel.y);
        } else {
          drag = { kind: "smooth", pointerId: event.pointerId, x: pixel.x, y: pixel.y };
          finish(doc.smoothAt(pixel.x, pixel.y, stroke));
        }
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
        if (next === "zap" || next === "fill" || next === "pencil" || next === "dropper" || next === "smooth") {
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
        ${toolButton("smooth", "data-tool", "Smooth", "Smooth")}
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
      const chunk = buffer.subarray(start2, end);
      if (type === "IHDR") {
        width = chunk.readUInt32BE(0);
        height = chunk.readUInt32BE(4);
        bitDepth = chunk[8] ?? 0;
        colorType = chunk[9] ?? -1;
        const interlace = chunk[12] ?? 0;
        if (bitDepth !== 8 || colorType !== 2 && colorType !== 6) throw new Error("\u0E23\u0E2D\u0E07\u0E23\u0E31\u0E1A PNG 8-bit RGB \u0E2B\u0E23\u0E37\u0E2D RGBA \u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19");
        if (interlace !== 0) throw new Error("\u0E44\u0E21\u0E48\u0E23\u0E2D\u0E07\u0E23\u0E31\u0E1A PNG \u0E41\u0E1A\u0E1A interlaced");
        if (width < 1 || height < 1 || width > 8e3 || height > 8e3) throw new Error("\u0E02\u0E19\u0E32\u0E14 PNG \u0E44\u0E21\u0E48\u0E40\u0E2B\u0E21\u0E32\u0E30\u0E01\u0E31\u0E1A\u0E07\u0E32\u0E19\u0E41\u0E01\u0E49\u0E2A\u0E35\u0E43\u0E19\u0E1E\u0E32\u0E40\u0E19\u0E25");
      } else if (type === "IDAT") {
        idat.push(chunk);
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
  var CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index++) {
      let value = index;
      for (let bit = 0; bit < 8; bit++) value = (value & 1) === 1 ? 3988292384 ^ value >>> 1 : value >>> 1;
      table[index] = value >>> 0;
    }
    return table;
  })();

  // src/color/presets.ts
  var PRESETS = {
    logo: { maxColors: 8, sensitivity: 0.06, smoothContrast: 0.07, cornerAngle: 0.9, smooth: 1.6 },
    icon: { maxColors: 6, sensitivity: 0.05, smoothContrast: 0.05, cornerAngle: 0.55, smooth: 0.4 },
    ui: { maxColors: 12, sensitivity: 0.04, smoothContrast: 0.075, cornerAngle: 0.6, smooth: 0.5 },
    illustration: { maxColors: 16, sensitivity: 0.05, smoothContrast: 0.055, cornerAngle: 0.75, smooth: 1.2 },
    photo: { maxColors: 24, sensitivity: 0.03, smoothContrast: 0.04, cornerAngle: 0.85, smooth: 1.4 }
  };
  function isPresetName(value) {
    return value === "logo" || value === "icon" || value === "ui" || value === "illustration" || value === "photo";
  }
  function presetProfile(value) {
    return isPresetName(value) ? PRESETS[value] : PRESETS.logo;
  }
  function curveError(smooth) {
    const t = Math.min(3, Math.max(0, smooth)) / 3;
    return 0.2 + t * 1.3;
  }
  function chooseUpscale(width, height, preset) {
    const minor = Math.min(width, height);
    if (preset === "photo") return minor <= 400 ? 2 : 1;
    if (preset === "icon") return minor <= 700 ? 4 : 2;
    if (preset === "logo") return minor <= 400 ? 3 : minor <= 900 ? 2 : 1;
    if (preset === "ui") return minor <= 400 ? 3 : 2;
    return minor <= 400 ? 3 : minor <= 1200 ? 2 : 1;
  }

  // src/color/segment.ts
  var BIN_SHIFT = 3;
  var BIN_COUNT = 32 * 32 * 32;
  function segmentImage(rgba, width, height, maxColors, options = {}) {
    if (rgba.length < width * height * 4) throw new Error("\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E20\u0E32\u0E1E\u0E2A\u0E31\u0E49\u0E19\u0E01\u0E27\u0E48\u0E32\u0E02\u0E19\u0E32\u0E14\u0E17\u0E35\u0E48\u0E23\u0E30\u0E1A\u0E38");
    const colors = Math.max(1, Math.floor(maxColors));
    const profile = options.preset ? PRESETS[options.preset] : PRESETS.logo;
    const sensitivity = options.sensitivity ?? profile.sensitivity;
    const smoothContrast = options.smoothContrast ?? profile.smoothContrast;
    const pixelCount = width * height;
    const labels = new Uint16Array(pixelCount);
    labels.fill(TRANSPARENT);
    const histogram = /* @__PURE__ */ new Map();
    let opaque = 0;
    for (let i = 0; i < pixelCount; i++) {
      const offset = i * 4;
      if ((rgba[offset + 3] ?? 0) < 128) continue;
      opaque++;
      const key = (rgba[offset] ?? 0) << 16 | (rgba[offset + 1] ?? 0) << 8 | (rgba[offset + 2] ?? 0);
      histogram.set(key, (histogram.get(key) ?? 0) + 1);
    }
    if (opaque === 0) return { width, height, labels, palette: [] };
    if (histogram.size <= colors) {
      const palette = exactPalette(histogram);
      const lookup = /* @__PURE__ */ new Map();
      palette.forEach((color, index) => lookup.set(color.r << 16 | color.g << 8 | color.b, index));
      for (let i = 0; i < pixelCount; i++) {
        const offset = i * 4;
        if ((rgba[offset + 3] ?? 0) < 128) continue;
        const key = (rgba[offset] ?? 0) << 16 | (rgba[offset + 1] ?? 0) << 8 | (rgba[offset + 2] ?? 0);
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
  function exactPalette(histogram) {
    const unique = [];
    for (const [key, n] of histogram) unique.push({ r: key >> 16 & 255, g: key >> 8 & 255, b: key & 255, n });
    unique.sort((a, b) => b.n - a.n || a.r - b.r || a.g - b.g || a.b - b.b);
    return unique.map((color) => ({ r: color.r, g: color.g, b: color.b }));
  }
  function buildBins(rgba, pixelCount) {
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
      const key = r >> BIN_SHIFT << 10 | g >> BIN_SHIFT << 5 | b >> BIN_SHIFT;
      count[key] = (count[key] ?? 0) + 1;
      sumR[key] = (sumR[key] ?? 0) + r;
      sumG[key] = (sumG[key] ?? 0) + g;
      sumB[key] = (sumB[key] ?? 0) + b;
    }
    const bins = [];
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
  function seedCentroids(bins, maxColors) {
    const seeds = [];
    const protectedLabs = [];
    const remember = (lab, protect) => {
      if (seeds.length >= maxColors) return;
      if (seeds.some((seed) => oklabDistance(seed, lab) < 0.045)) return;
      seeds.push(lab);
      if (protect) protectedLabs.push(lab);
    };
    const chromaBins = bins.filter((bin) => oklabChroma(bin.lab) > 0.08 && bin.n >= 6).sort((a, b) => b.n * oklabChroma(b.lab) - a.n * oklabChroma(a.lab));
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
    const largeNeutral = Math.max(64, opaque * 5e-3);
    const neutrals = bins.filter((bin) => oklabChroma(bin.lab) < 0.035 && bin.n >= largeNeutral).sort((a, b) => b.n - a.n);
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
  function kMeans(bins, seeds) {
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
  function ensureProtected(centroids, protectedLabs) {
    for (const lab of protectedLabs) {
      if (centroids.some((centroid) => oklabDistance(centroid, lab) < 0.08)) continue;
      centroids.push(lab);
    }
  }
  function assignPixels(rgba, labels, pixelCount, centroids) {
    const binLabel = new Int16Array(BIN_COUNT);
    binLabel.fill(-1);
    for (let i = 0; i < pixelCount; i++) {
      const offset = i * 4;
      if ((rgba[offset + 3] ?? 0) < 128) continue;
      const r = rgba[offset] ?? 0;
      const g = rgba[offset + 1] ?? 0;
      const b = rgba[offset + 2] ?? 0;
      const key = r >> BIN_SHIFT << 10 | g >> BIN_SHIFT << 5 | b >> BIN_SHIFT;
      let label = binLabel[key] ?? -1;
      if (label < 0) {
        label = nearestLab(centroids, rgbToOklab(r, g, b));
        binLabel[key] = label;
      }
      labels[i] = label;
    }
  }
  function reassignBlends(rgba, labels, width, height, palette, coverage, partner, blend) {
    const next = labels.slice();
    const cache = /* @__PURE__ */ new Map();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        const label = labels[index] ?? TRANSPARENT;
        if (label === TRANSPARENT) continue;
        let bestOther = -1;
        let bestT = 0;
        let bestPerp = Infinity;
        const neighbors = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1]
        ];
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
  function writeRobustPalette(rgba, labels, width, height, palette, blend) {
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
  function mergeClusters(labels, partner, coverage, palette, sensitivity, smoothContrast, maxColors) {
    const counts = countLabels(labels, palette.length);
    const active = palette.map((_, index) => (counts[index] ?? 0) > 0);
    const protectedSlot = palette.map((lab) => oklabChroma(lab) > 0.045 || lab.l > 0.93);
    const largeArea = labels.length * 5e-3;
    const activeCount = () => active.filter(Boolean).length;
    for (; ; ) {
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
          const underLimit = sameHueClose(left, right) || distance < limit && !bothProtected;
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
  function smoothLowContrast(labels, partner, coverage, width, height, palette, smoothContrast) {
    const distance = /* @__PURE__ */ new Map();
    const pair = (a, b) => {
      const key = a < b ? a * palette.length + b : b * palette.length + a;
      const cached = distance.get(key);
      if (cached !== void 0) return cached;
      const left = palette[a];
      const right = palette[b];
      const value = left && right ? oklabDistance(left, right) : Infinity;
      distance.set(key, value);
      return value;
    };
    const votes = new Int32Array(palette.length);
    const touched = [];
    for (let iter = 0; iter < 6; iter++) {
      const next = labels.slice();
      let changed = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const index = y * width + x;
          const label = labels[index] ?? TRANSPARENT;
          if (label === TRANSPARENT) continue;
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
  function removeWeakSpeckles(labels, partner, coverage, width, height, palette) {
    const areaLimit = Math.max(12, Math.round(width * height * 5e-5));
    const seen = new Uint8Array(labels.length);
    const stack = [];
    for (let start2 = 0; start2 < labels.length; start2++) {
      const label = labels[start2] ?? TRANSPARENT;
      if (label === TRANSPARENT || seen[start2]) continue;
      stack.push(start2);
      seen[start2] = 1;
      const pixels = [];
      const adjacency = /* @__PURE__ */ new Map();
      let minX = width;
      let maxX = 0;
      let minY = height;
      let maxY = 0;
      while (stack.length > 0) {
        const current = stack.pop();
        if (current === void 0) break;
        pixels.push(current);
        const x = current % width;
        const y = (current - x) / width;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        const neighbors = [current - 1, current + 1, current - width, current + width];
        for (const next of neighbors) {
          const nx = next % width;
          const ny = (next - nx) / width;
          if (next < 0 || next >= labels.length) continue;
          if (next === current - 1 && x === 0 || next === current + 1 && x + 1 === width) continue;
          if (ny < 0 || ny >= height) continue;
          const neighbor = labels[next] ?? TRANSPARENT;
          if (neighbor === label) {
            if (!seen[next]) {
              seen[next] = 1;
              stack.push(next);
            }
          } else if (neighbor !== TRANSPARENT) {
            adjacency.set(neighbor, (adjacency.get(neighbor) ?? 0) + 1);
          }
        }
      }
      if (pixels.length > areaLimit || adjacency.size === 0) continue;
      const spanX = maxX - minX + 1;
      const spanY = maxY - minY + 1;
      const aspect = Math.max(spanX, spanY) / Math.max(1, Math.min(spanX, spanY));
      if (aspect >= 2.2) continue;
      if (pixels.length >= 6 && componentThickness2(pixels, width, height, 2) <= 2) continue;
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
  var DARK_SURROUND_L = 0.12;
  function sameHueClose(left, right) {
    const leftChroma = oklabChroma(left);
    const rightChroma = oklabChroma(right);
    if (leftChroma < 0.08 || rightChroma < 0.08) return false;
    let angle = Math.abs(Math.atan2(left.b, left.a) - Math.atan2(right.b, right.a));
    if (angle > Math.PI) angle = Math.PI * 2 - angle;
    if (angle > 0.22) return false;
    if (Math.abs(left.l - right.l) > 0.08) return false;
    return oklabDistance(left, right) < 0.09;
  }
  function detachNeutrals(rgba, labels, partner, coverage, palette) {
    const counts = countLabels(labels, palette.length);
    const neutral = [];
    const chromatic = new Array(palette.length).fill(false);
    for (let i = 0; i < palette.length; i++) {
      const lab = palette[i];
      if (!lab || (counts[i] ?? 0) === 0) continue;
      if (oklabChroma(lab) < 0.03) neutral.push(i);
      chromatic[i] = oklabChroma(lab) >= 0.045;
    }
    if (neutral.length === 0) return;
    const cache = /* @__PURE__ */ new Map();
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i] ?? TRANSPARENT;
      if (label === TRANSPARENT || !chromatic[label]) continue;
      if ((partner[i] ?? TRANSPARENT) !== TRANSPARENT) continue;
      const offset = i * 4;
      const key = (rgba[offset] ?? 0) << 16 | (rgba[offset + 1] ?? 0) << 8 | (rgba[offset + 2] ?? 0);
      let next = cache.get(key);
      if (next === void 0) {
        const lab = rgbToOklab(key >> 16 & 255, key >> 8 & 255, key & 255);
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
  function huesApart(left, right) {
    const leftChroma = oklabChroma(left);
    const rightChroma = oklabChroma(right);
    if (leftChroma >= 0.035 && rightChroma < 0.025 || rightChroma >= 0.035 && leftChroma < 0.025) return true;
    if (leftChroma > 0.04 && rightChroma > 0.04) {
      let angle = Math.abs(Math.atan2(left.b, left.a) - Math.atan2(right.b, right.a));
      if (angle > Math.PI) angle = Math.PI * 2 - angle;
      if (angle > 0.45) return true;
    }
    return false;
  }
  function forEachComponent(labels, width, height, body) {
    const seen = new Uint8Array(labels.length);
    const stack = [];
    for (let start2 = 0; start2 < labels.length; start2++) {
      const label = labels[start2] ?? TRANSPARENT;
      if (label === TRANSPARENT || seen[start2]) continue;
      stack.push(start2);
      seen[start2] = 1;
      const pixels = [];
      const adjacency = /* @__PURE__ */ new Map();
      let minX = width;
      let maxX = 0;
      let minY = height;
      let maxY = 0;
      while (stack.length > 0) {
        const current = stack.pop();
        if (current === void 0) break;
        pixels.push(current);
        const x = current % width;
        const y = (current - x) / width;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        const neighbors = [current - 1, current + 1, current - width, current + width];
        for (const next of neighbors) {
          if (next < 0 || next >= labels.length) continue;
          const nx = next % width;
          const ny = (next - nx) / width;
          if (next === current - 1 && x === 0 || next === current + 1 && x + 1 === width) continue;
          if (ny < 0 || ny >= height) continue;
          const neighbor = labels[next] ?? TRANSPARENT;
          if (neighbor === label) {
            if (!seen[next]) {
              seen[next] = 1;
              stack.push(next);
            }
          } else if (neighbor !== TRANSPARENT) {
            adjacency.set(neighbor, (adjacency.get(neighbor) ?? 0) + 1);
          }
        }
      }
      body({ label, pixels, minX, maxX, minY, maxY, adjacency });
    }
  }
  function absorbDarkBlobs(rgba, labels, partner, coverage, width, height, palette) {
    const areaCap2 = Math.max(160, Math.round(width * height * 4e-3));
    const counts = countLabels(labels, palette.length);
    const largeArea = width * height * 5e-3;
    const mark = new Uint8Array(labels.length);
    forEachComponent(labels, width, height, (region) => {
      if (region.pixels.length < 4 || region.pixels.length > areaCap2 || region.adjacency.size === 0) return;
      const spanX = region.maxX - region.minX + 1;
      const spanY = region.maxY - region.minY + 1;
      const aspect = Math.max(spanX, spanY) / Math.max(1, Math.min(spanX, spanY));
      if (aspect >= 2.2) return;
      if (region.pixels.length >= 6 && componentThickness2(region.pixels, width, height, 3) <= 3) return;
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
    });
  }
  function dissolveSlivers(rgba, labels, partner, coverage, width, height, palette) {
    forEachComponent(labels, width, height, (region) => {
      if (region.pixels.length < 2 || region.adjacency.size === 0) return;
      const spanX = region.maxX - region.minX + 1;
      const spanY = region.maxY - region.minY + 1;
      const aspect = Math.max(spanX, spanY) / Math.max(1, Math.min(spanX, spanY));
      const narrow = Math.min(spanX, spanY) <= 2 || aspect >= 2.4;
      if (!narrow && region.pixels.length > 80) return;
      const thick = componentThickness2(region.pixels, width, height, 3);
      const thinStrip = Math.min(spanX, spanY) <= 2 || thick <= 1 || thick <= 2 && aspect >= 2.4;
      if (!thinStrip) return;
      const target = sliverTarget(rgba, region, palette);
      if (target < 0 || target === region.label) return;
      for (const pixel of region.pixels) {
        labels[pixel] = target;
        coverage[pixel] = 1;
        partner[pixel] = TRANSPARENT;
      }
    });
  }
  function peelPaleEdges(rgba, labels, partner, coverage, width, height, palette) {
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
          if (neighbor === index - 1 && x === 0 || neighbor === index + 1 && x + 1 === width) continue;
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
  function liftNearWhite(rgba, labels, partner, coverage, width, height, palette) {
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
        if (neighbor === i - 1 && x === 0 || neighbor === i + 1 && x + 1 === width) continue;
        if (ny < 0 || ny >= height) continue;
        const other = labels[neighbor] ?? TRANSPARENT;
        const color = other === TRANSPARENT ? void 0 : palette[other];
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
  function sliverTarget(rgba, region, palette) {
    const ranked = [...region.adjacency.entries()].sort((a, b) => b[1] - a[1]);
    const first = ranked[0];
    if (!first) return -1;
    const second = ranked[1];
    const colorA = palette[first[0]];
    const colorB = second ? palette[second[0]] : void 0;
    const median2 = medianLab(rgba, region.pixels);
    const own = palette[region.label];
    if (median2.l < 0.22 && oklabChroma(median2) < 0.05) return -1;
    if (colorA && isHalo(median2, colorA)) return first[0];
    if (colorB && second && isHalo(median2, colorB)) return second[0];
    if (colorA && colorB) {
      const along = project(median2, colorA, colorB);
      if (along && along.t > 0.05 && along.t < 0.95 && along.perp < Math.min(0.05, 0.45 * along.length)) {
        return along.t < 0.5 ? first[0] : second ? second[0] : first[0];
      }
    }
    const pale = median2.l > 0.82 && oklabChroma(median2) < 0.06;
    const paleSwatch = !!own && own.l > 0.88 && oklabChroma(own) < 0.05;
    if (!pale && !paleSwatch) return -1;
    let best = -1;
    let bestScore = Infinity;
    for (const [other] of ranked) {
      const color = palette[other];
      if (!color || color.l > 0.9 && oklabChroma(color) < 0.04) continue;
      const distance = oklabDistance(median2, color);
      if (distance < bestScore) {
        bestScore = distance;
        best = other;
      }
    }
    return bestScore < 0.45 ? best : -1;
  }
  function isHalo(pixel, neighbor) {
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
  function ringLabs(rgba, labels, pixels, width, height, mark) {
    for (const pixel of pixels) mark[pixel] = 1;
    const ring = [];
    const seenRing = /* @__PURE__ */ new Set();
    for (const pixel of pixels) {
      const x = pixel % width;
      const y = (pixel - x) / width;
      const neighbors = [pixel - 1, pixel + 1, pixel - width, pixel + width];
      for (const next of neighbors) {
        if (next < 0 || next >= labels.length || seenRing.has(next)) continue;
        const nx = next % width;
        const ny = (next - nx) / width;
        if (next === pixel - 1 && x === 0 || next === pixel + 1 && x + 1 === width) continue;
        if (ny < 0 || ny >= height || mark[next]) continue;
        seenRing.add(next);
        const offset = next * 4;
        ring.push(rgbToOklab(rgba[offset] ?? 0, rgba[offset + 1] ?? 0, rgba[offset + 2] ?? 0));
      }
    }
    for (const pixel of pixels) mark[pixel] = 0;
    return ring;
  }
  function surroundLabel(adjacency, palette, surround) {
    let best = -1;
    let bestScore = Infinity;
    for (const [other, touches] of adjacency) {
      const color = palette[other];
      if (!color || touches <= 0) continue;
      const distance = oklabDistance(color, surround);
      const score = distance - Math.min(touches, 40) * 5e-4;
      if (score < bestScore) {
        bestScore = score;
        best = other;
      }
    }
    return best;
  }
  function medianLab(rgba, pixels) {
    const step = Math.max(1, Math.floor(pixels.length / 480));
    const l = [];
    const a = [];
    const b = [];
    for (let i = 0; i < pixels.length; i += step) {
      const index = pixels[i];
      if (index === void 0) continue;
      const offset = index * 4;
      const lab = rgbToOklab(rgba[offset] ?? 0, rgba[offset + 1] ?? 0, rgba[offset + 2] ?? 0);
      l.push(lab.l);
      a.push(lab.a);
      b.push(lab.b);
    }
    return { l: median(l), a: median(a), b: median(b) };
  }
  function medianOf(labs) {
    return {
      l: median(labs.map((lab) => lab.l)),
      a: median(labs.map((lab) => lab.a)),
      b: median(labs.map((lab) => lab.b))
    };
  }
  function median(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  }
  function spreadL(labs) {
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
  function settleEdges(rgba, labels, partner, coverage, width, height, palette) {
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
    reconcilePartners(labels, partner, coverage);
  }
  function pinToLocalCores(rgba, labels, partner, coverage, width, height, palette, gradient) {
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
    const seen = [];
    const cache = /* @__PURE__ */ new Map();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        const label = labels[index] ?? TRANSPARENT;
        if (label === TRANSPARENT || flat[index]) continue;
        seen.length = 0;
        const y0 = Math.max(0, y - radius);
        const y1 = Math.min(height - 1, y + radius);
        const x0 = Math.max(0, x - radius);
        const x1 = Math.min(width - 1, x + radius);
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
        let first = -1;
        let second = -1;
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
  function pinToNearbyCores(rgba, labels, partner, coverage, width, height, palette) {
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
    const seen = [];
    const cache = /* @__PURE__ */ new Map();
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
  function keepNeutralDark(lab, current, colorA, colorB) {
    if (!current || !(lab.l < 0.45) || oklabChroma(lab) >= 0.08) return false;
    if (!(lab.l + 0.08 < colorA.l && lab.l + 0.08 < colorB.l)) return false;
    return oklabChroma(current) < 0.04;
  }
  function keepDarkLabel(lab, current, chosen) {
    if (!current || !chosen || !(lab.l < 0.4) || !(lab.l + 0.12 < chosen.l)) return false;
    if (oklabChroma(lab) < 0.04 && oklabChroma(current) > 0.05) return false;
    return oklabDistance(lab, current) <= oklabDistance(lab, chosen) + 0.04;
  }
  function dissolveBoundarySlivers(rgba, labels, partner, coverage, width, height, palette) {
    const cache = /* @__PURE__ */ new Map();
    for (let pass = 0; pass < 6; pass++) {
      const jobs = [];
      forEachComponent(labels, width, height, (region) => {
        if (region.adjacency.size < 2 || region.pixels.length < 1) return;
        const spanX = region.maxX - region.minX + 1;
        const spanY = region.maxY - region.minY + 1;
        if (spanX >= 6 && spanY >= 6 && region.pixels.length >= Math.min(spanX, spanY) * 4) return;
        if (componentThickness2(region.pixels, width, height, 2) > 1) return;
        const ranked = [...region.adjacency.entries()].sort((left, right) => right[1] - left[1]);
        const first = ranked[0];
        const second = ranked[1];
        if (!first || !second) return;
        const median2 = medianLab(rgba, region.pixels);
        const colorA = palette[first[0]];
        const colorB = palette[second[0]];
        if (colorA && colorB && median2.l + 0.18 < colorA.l && median2.l + 0.18 < colorB.l && oklabChroma(median2) < 0.04) return;
        jobs.push({ pixels: region.pixels, first: first[0], second: second[0] });
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
  function mergeSoftBoundaries(rgba, labels, partner, coverage, width, height, palette, sobel) {
    const threshold = 26;
    for (let pass = 0; pass < 5; pass++) {
      const built = buildComponents(labels, width, height);
      const stride = built.comps.length + 1;
      if (stride <= 1) return;
      const pairs = /* @__PURE__ */ new Map();
      const consider = (left, right, leftIndex, rightIndex) => {
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
      const jobs = [];
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
  function clearCheckerboards(labels, partner, coverage, width, height) {
    const votes = /* @__PURE__ */ new Map();
    for (let pass = 0; pass < 8; pass++) {
      let changed = 0;
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const index = y * width + x;
          const label = labels[index] ?? TRANSPARENT;
          if (label === TRANSPARENT) continue;
          const neighbors = [index - 1, index + 1, index - width, index + width];
          votes.clear();
          let foreign = 0;
          for (const neighbor of neighbors) {
            const other = labels[neighbor] ?? TRANSPARENT;
            if (other === label || other === TRANSPARENT) continue;
            foreign++;
            votes.set(other, (votes.get(other) ?? 0) + 1);
          }
          if (foreign < 4) continue;
          let best = -1;
          let bestCount = 0;
          for (const [other, count] of votes) {
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
  function clearSolidSpecks(labels, partner, coverage, width, height) {
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
  function reconcilePartners(labels, partner, coverage) {
    for (let i = 0; i < labels.length; i++) {
      const other = partner[i] ?? TRANSPARENT;
      if (other === TRANSPARENT || other === (labels[i] ?? TRANSPARENT)) {
        partner[i] = TRANSPARENT;
        coverage[i] = 1;
      }
    }
  }
  function sobelLuma(rgba, width, height) {
    const magnitude = new Float32Array(width * height);
    magnitude.fill(999);
    const lumaAt = (x, y) => {
      const offset = (y * width + x) * 4;
      return 0.2126 * (rgba[offset] ?? 0) + 0.7152 * (rgba[offset + 1] ?? 0) + 0.0722 * (rgba[offset + 2] ?? 0);
    };
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const gx = -lumaAt(x - 1, y - 1) + lumaAt(x + 1, y - 1) - 2 * lumaAt(x - 1, y) + 2 * lumaAt(x + 1, y) - lumaAt(x - 1, y + 1) + lumaAt(x + 1, y + 1);
        const gy = -lumaAt(x - 1, y - 1) - 2 * lumaAt(x, y - 1) - lumaAt(x + 1, y - 1) + lumaAt(x - 1, y + 1) + 2 * lumaAt(x, y + 1) + lumaAt(x + 1, y + 1);
        magnitude[y * width + x] = Math.hypot(gx, gy);
      }
    }
    return magnitude;
  }
  function componentIsDarker(rgba, samples, targetL) {
    if (samples.length === 0) return false;
    let sum = 0;
    for (const index of samples) {
      const offset = index * 4;
      sum += rgbToOklab(rgba[offset] ?? 0, rgba[offset + 1] ?? 0, rgba[offset + 2] ?? 0).l;
    }
    const mean = sum / samples.length;
    return mean < 0.42 && mean + 0.12 < targetL;
  }
  function buildComponents(labels, width, height) {
    const ids = new Int32Array(labels.length);
    ids.fill(-1);
    const comps = [];
    const stack = [];
    for (let start2 = 0; start2 < labels.length; start2++) {
      if ((ids[start2] ?? -1) !== -1) continue;
      const label = labels[start2] ?? TRANSPARENT;
      if (label === TRANSPARENT) continue;
      const id = comps.length;
      const comp = { label, count: 0, samples: [] };
      comps.push(comp);
      stack.push(start2);
      ids[start2] = id;
      while (stack.length > 0) {
        const current = stack.pop();
        if (current === void 0) break;
        comp.count++;
        if (comp.samples.length < 8 || comp.count % 40 === 0) comp.samples.push(current);
        const x = current % width;
        const y = (current - x) / width;
        const neighbors = [current - 1, current + 1, current - width, current + width];
        for (const next of neighbors) {
          if (next < 0 || next >= labels.length || (ids[next] ?? -1) !== -1) continue;
          const nx = next % width;
          const ny = (next - nx) / width;
          if (next === current - 1 && x === 0 || next === current + 1 && x + 1 === width) continue;
          if (ny < 0 || ny >= height) continue;
          if ((labels[next] ?? TRANSPARENT) !== label) continue;
          ids[next] = id;
          stack.push(next);
        }
      }
    }
    return { ids, comps };
  }
  function compactAll(labels, partner, palette) {
    const used = new Array(palette.length).fill(false);
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i] ?? TRANSPARENT;
      if (label !== TRANSPARENT && label < used.length) used[label] = true;
    }
    const map = new Array(palette.length).fill(TRANSPARENT);
    const nextPalette = [];
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
      nextLabels[i] = label === TRANSPARENT ? TRANSPARENT : map[label] ?? TRANSPARENT;
      const other = partner[i] ?? TRANSPARENT;
      const mapped = other === TRANSPARENT ? TRANSPARENT : map[other] ?? TRANSPARENT;
      nextPartner[i] = mapped === nextLabels[i] ? TRANSPARENT : mapped;
    }
    return { labels: nextLabels, palette: nextPalette, partner: nextPartner };
  }
  function cachedLab(cache, rgba, index) {
    const offset = index * 4;
    const key = (rgba[offset] ?? 0) << 16 | (rgba[offset + 1] ?? 0) << 8 | (rgba[offset + 2] ?? 0);
    const found = cache.get(key);
    if (found) return found;
    const lab = rgbToOklab(key >> 16 & 255, key >> 8 & 255, key & 255);
    cache.set(key, lab);
    return lab;
  }
  function project(point, from, to) {
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
  function isInterior(labels, width, height, x, y, label) {
    if (x === 0 || y === 0 || x + 1 === width || y + 1 === height) return false;
    const index = y * width + x;
    return labels[index - 1] === label && labels[index + 1] === label && labels[index - width] === label && labels[index + width] === label;
  }
  function labBin(value, min, max, bins) {
    const t = (value - min) / (max - min);
    return Math.min(bins - 1, Math.max(0, Math.floor(t * bins)));
  }
  function histogramMedian(hist, base, bins, total, min, max) {
    const half = total / 2;
    let accumulated = 0;
    for (let i = 0; i < bins; i++) {
      accumulated += hist[base + i] ?? 0;
      if (accumulated >= half) return min + (i + 0.5) / bins * (max - min);
    }
    return (min + max) / 2;
  }
  function countLabels(labels, paletteLength) {
    const counts = new Int32Array(paletteLength);
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i] ?? TRANSPARENT;
      if (label !== TRANSPARENT && label < paletteLength) counts[label] = (counts[label] ?? 0) + 1;
    }
    return counts;
  }
  function relabel(labels, partner, coverage, source, target) {
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] === source) labels[i] = target;
      if (partner[i] === source) partner[i] = target;
      if (partner[i] === labels[i]) {
        partner[i] = TRANSPARENT;
        coverage[i] = 1;
      }
    }
  }
  function nearestLab(centroids, lab) {
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
  function componentThickness2(pixels, width, height, limit) {
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

  // src/color/clean.ts
  var KAPPA = 0.5522847498307936;
  function cleanTolerance(strength) {
    const t = Math.min(1, Math.max(0, strength));
    if (t <= 0) return 0;
    return 1.15 + t * 2.15;
  }
  function strongCleanTolerance(strength) {
    return Math.max(cleanTolerance(strength), 2.05);
  }
  function letterMask(labels, width, height, palette) {
    const mask = new Uint8Array(labels.length);
    const owner = new Int32Array(labels.length);
    owner.fill(-1);
    const stack = [];
    const labs = palette.map((color) => rgbToOklab(color.r, color.g, color.b));
    for (let start2 = 0; start2 < labels.length; start2++) {
      const label = labels[start2] ?? TRANSPARENT;
      if (label === TRANSPARENT || owner[start2] !== -1) continue;
      const pixels = [];
      const adjacency = /* @__PURE__ */ new Map();
      stack.push(start2);
      owner[start2] = 1;
      let minX = width;
      let maxX = 0;
      let minY = height;
      let maxY = 0;
      while (stack.length > 0) {
        const current = stack.pop();
        if (current === void 0) break;
        pixels.push(current);
        const x = current % width;
        const y = (current - x) / width;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        const neighbors = [current - 1, current + 1, current - width, current + width];
        for (const next of neighbors) {
          if (next < 0 || next >= labels.length) {
            adjacency.set(TRANSPARENT, (adjacency.get(TRANSPARENT) ?? 0) + 1);
            continue;
          }
          const nx = next % width;
          if (Math.abs(nx - x) + Math.abs(Math.floor(next / width) - y) !== 1) {
            adjacency.set(TRANSPARENT, (adjacency.get(TRANSPARENT) ?? 0) + 1);
            continue;
          }
          const neighbor = labels[next] ?? TRANSPARENT;
          if (neighbor === label) {
            if (owner[next] === -1) {
              owner[next] = 1;
              stack.push(next);
            }
          } else adjacency.set(neighbor, (adjacency.get(neighbor) ?? 0) + 1);
        }
      }
      if (pixels.length < 12 || pixels.length > 8e3) continue;
      const thick = thickness(pixels, width, height, 5);
      if (thick > 4) continue;
      const boxArea = (maxX - minX + 1) * (maxY - minY + 1);
      if (boxArea > 0 && pixels.length / boxArea > 0.82 && Math.min(maxX - minX, maxY - minY) >= 8) continue;
      let contrast = 0;
      let dominant = TRANSPARENT;
      let dominantCount = 0;
      for (const [neighbor, count] of adjacency) {
        if (count > dominantCount) {
          dominant = neighbor;
          dominantCount = count;
        }
      }
      const own = labs[label];
      if (dominant === TRANSPARENT || dominant >= labs.length) contrast = 1;
      else {
        const other = labs[dominant];
        if (own && other) contrast = oklabDistance(own, other);
      }
      if (!own || contrast < 0.18) continue;
      if (rayLike(pixels, width, minX, minY, maxX, maxY)) continue;
      for (const pixel of pixels) mask[pixel] = 1;
    }
    return mask;
  }
  function boundaryHits(mask, width, height, points, fraction) {
    if (points.length === 0) return false;
    let hits = 0;
    let samples = 0;
    const step = Math.max(1, Math.floor(points.length / 48));
    for (let i = 0; i < points.length; i += step) {
      const point = points[i];
      if (!point) continue;
      samples++;
      if (nearMask(mask, width, height, point.x, point.y)) hits++;
    }
    if (samples === 0) return false;
    if (fraction <= 0) return hits > 0;
    return hits / samples >= fraction;
  }
  function fitOpenClean(points, tolerance) {
    if (points.length < 2) return [];
    const coarse = Math.min(0.9, Math.max(0.4, tolerance * 0.32));
    const kept = decimateIndexed(points, coarse);
    const guide = kept.map((index) => points[index]);
    const cuts = [0];
    if (guide.length >= 12) {
      for (const cut of crispCorners(guide, false)) {
        const index = kept[cut];
        if (index !== void 0 && index > 0 && index < points.length - 1) cuts.push(index);
      }
    }
    cuts.push(points.length - 1);
    const commands = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const span = points.slice(cuts[i], cuts[i + 1] + 1);
      commands.push(...shorterSpan(span, tolerance));
    }
    const end = points[points.length - 1];
    return end ? pinEnd(commands, end) : commands;
  }
  function shorterSpan(points, tolerance) {
    const smooth = flattenPieces(fitSmoothSpan(points, tolerance, 0));
    const linear = chordFit(points, tolerance);
    if (smooth.length > 0 && (linear.length === 0 || smooth.length <= linear.length)) return smooth;
    return linear.length > 0 ? linear : smooth;
  }
  function chordFit(points, tolerance) {
    const guide = decimateOpen(points, tolerance);
    const commands = [];
    for (let i = 1; i < guide.length; i++) {
      const from = guide[i - 1];
      const to = guide[i];
      if (!from || !to) continue;
      const line = tryLine([from, to], tolerance);
      if (line) commands.push(...line.commands);
      else commands.push({ op: "L", x: to.x, y: to.y, primitive: "line" });
    }
    return commands;
  }
  function fitClosedClean(points, tolerance) {
    if (points.length < 6) return null;
    const direct = acceptFit(fitClosedPrimitives(points, tolerance), points, tolerance);
    if (direct) return direct;
    const guided = fitClosedGuided(points, tolerance);
    if (guided) return guided;
    return acceptFit(fitClosedRaw(points, tolerance), points, tolerance) ?? fitClosedRaw(points, tolerance);
  }
  function acceptFit(fit, points, tolerance) {
    if (!fit || fit.commands.length === 0) return null;
    if (sampleCurveError(fit.start, fit.commands, points) > tolerance) return null;
    return fit;
  }
  function thickness(pixels, width, height, limit) {
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
  function rayLike(pixels, width, minX, minY, maxX, maxY) {
    const dx = maxX - minX;
    const dy = maxY - minY;
    const length = Math.hypot(dx, dy);
    if (length < 10) return false;
    let maxDistance = 0;
    for (const pixel of pixels) {
      const x = pixel % width;
      const y = (pixel - x) / width;
      maxDistance = Math.max(maxDistance, pointSegmentDistance({ x, y }, { x: minX, y: minY }, { x: maxX, y: maxY }));
    }
    return maxDistance <= 2.4 && length / Math.max(1, maxDistance) >= 8;
  }
  function nearMask(mask, width, height, x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    for (let dy = -1; dy <= 0; dy++) {
      for (let dx = -1; dx <= 0; dx++) {
        const px = x0 + dx;
        const py = y0 + dy;
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        if ((mask[py * width + px] ?? 0) > 0) return true;
      }
    }
    return false;
  }
  function flattenPieces(pieces) {
    const commands = [];
    for (const piece of pieces) commands.push(...piece.commands);
    return commands;
  }
  function tryLine(points, tolerance) {
    const start2 = points[0];
    const end = points[points.length - 1];
    if (!start2 || !end) return null;
    const chord = maxSegmentError(points, start2, end);
    const angle = Math.atan2(end.y - start2.y, end.x - start2.x);
    const snap = nearestSnap(angle);
    if (chord <= tolerance) {
      return { commands: [{ op: "L", x: end.x, y: end.y, primitive: "line", snap: snap?.name }] };
    }
    if (!snap) return null;
    const snapped = projectSegment(points, snap.axis);
    if (!snapped || maxSegmentError(points, snapped.start, snapped.end) > tolerance) return null;
    const move = Math.max(Math.hypot(snapped.start.x - start2.x, snapped.start.y - start2.y), Math.hypot(snapped.end.x - end.x, snapped.end.y - end.y));
    if (move > 0.05) return null;
    return { commands: [{ op: "L", x: end.x, y: end.y, primitive: "line", snap: snap.name }] };
  }
  function tryArc(points, tolerance) {
    const start2 = points[0];
    const end = points[points.length - 1];
    if (!start2 || !end || points.length < 6) return null;
    const circle = fitCircle(points);
    if (!circle) return null;
    const chord = Math.hypot(end.x - start2.x, end.y - start2.y);
    if (circle.r > Math.max(48, chord * 6)) return null;
    let maxError = 0;
    for (const point of points) maxError = Math.max(maxError, Math.abs(Math.hypot(point.x - circle.cx, point.y - circle.cy) - circle.r));
    if (maxError > tolerance) return null;
    const sweep = sweepAbout(points, circle);
    if (Math.abs(sweep) < 0.4 || Math.abs(sweep) > Math.PI * 1.85) return null;
    const commands = arcCubics(start2, end, circle, sweep);
    if (commands.length === 0) return null;
    if (curveError2(points, start2, commands) > tolerance) return null;
    return { commands };
  }
  function tryFairCubic(points, tolerance) {
    const start2 = points[0];
    const end = points[points.length - 1];
    if (!start2 || !end || points.length < 4) return null;
    const smoothed = smoothPolyline(points, 2);
    const incoming = unitToward(smoothed, 0, false);
    const outgoing = unitToward(smoothed, smoothed.length - 1, true);
    if (!incoming || !outgoing) return null;
    const fitted = fitCubic(points, incoming, outgoing);
    if (!fitted || fitted.error > tolerance) return null;
    if (extraInflection(points, start2, fitted.command)) return null;
    return { commands: [{ ...fitted.command, primitive: "cubic" }] };
  }
  function tryFullCircle(points, tolerance) {
    if (points.length < 12 || crispCorners(points, true).length >= 3) return null;
    const circle = fitCircle(points);
    if (!circle) return null;
    const box = bounds(points);
    if (circle.cx < box.minX - circle.r * 0.25 || circle.cx > box.maxX + circle.r * 0.25) return null;
    if (circle.cy < box.minY - circle.r * 0.25 || circle.cy > box.maxY + circle.r * 0.25) return null;
    let maxError = 0;
    for (const point of points) maxError = Math.max(maxError, Math.abs(Math.hypot(point.x - circle.cx, point.y - circle.cy) - circle.r));
    if (maxError > tolerance) return null;
    const sweep = signedArea(points) >= 0 ? Math.PI * 2 : -Math.PI * 2;
    const startAngle = Math.atan2(points[0].y - circle.cy, points[0].x - circle.cx);
    const start2 = { x: circle.cx + Math.cos(startAngle) * circle.r, y: circle.cy + Math.sin(startAngle) * circle.r };
    const commands = fullArcCubics(circle, startAngle, sweep);
    if (commands.length === 0) return null;
    if (sampleCurveError(start2, commands, points) > tolerance) return null;
    return { start: start2, commands };
  }
  function tryFullEllipse(points, tolerance) {
    if (points.length < 16 || crispCorners(points, true).length >= 3) return null;
    const ellipse = fitEllipse(points);
    if (!ellipse) return null;
    if (ellipse.rx < 4 || ellipse.ry < 4) return null;
    const ratio = ellipse.rx / ellipse.ry;
    if (ratio < 0.35 || ratio > 2.8) return null;
    let maxError = 0;
    for (const point of points) maxError = Math.max(maxError, ellipseRadialError(point, ellipse));
    if (maxError > tolerance) return null;
    const sweep = signedArea(points) >= 0 ? Math.PI * 2 : -Math.PI * 2;
    const start2 = ellipsePoint(ellipse, 0);
    const commands = ellipseCubics(ellipse, sweep);
    if (sampleCurveError(start2, commands, points) > tolerance) return null;
    return { start: start2, commands };
  }
  function tryRoundedRect(points, tolerance) {
    const runs = curvatureRuns(points);
    if (!runs) return null;
    const commands = [];
    let start2 = null;
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      const next = runs[(i + 1) % runs.length];
      if (!run || !next) return null;
      const from = points[run.indices[0]];
      const to = points[next.indices[0]];
      if (!start2) start2 = from;
      if (!run.curved) {
        const span2 = run.indices.map((index) => points[index]).concat(to);
        const line = tryLine(span2, Math.max(tolerance, 0.75));
        if (!line) return null;
        const command = line.commands[0];
        if (!command || command.op !== "L") return null;
        commands.push({ ...command, x: to.x, y: to.y });
        continue;
      }
      const span = run.indices.map((index) => points[index]).concat(to);
      const arc = tryArc(span, tolerance);
      if (!arc) return null;
      const rebuilt = arc.commands.map(
        (command, index) => index === arc.commands.length - 1 ? { ...command, x: to.x, y: to.y } : command
      );
      commands.push(...rebuilt);
    }
    if (!start2 || commands.length === 0) return null;
    if (sampleCurveError(start2, commands, points) > tolerance * 1.25) return null;
    return { start: start2, commands };
  }
  function trySuperellipse(points, tolerance) {
    if (points.length < 24) return null;
    const box = bounds(points);
    const width = box.maxX - box.minX;
    const height = box.maxY - box.minY;
    if (width < 8 || height < 8) return null;
    const ratio = width / height;
    if (ratio < 0.55 || ratio > 1.8) return null;
    if (crispCorners(points, true).length >= 3) return null;
    let best = null;
    const cx0 = (box.minX + box.maxX) / 2;
    const cy0 = (box.minY + box.maxY) / 2;
    for (const n of [2.6, 3.2, 4, 4.8, 5.5]) {
      for (const scale of [0.9, 0.96, 1]) {
        const candidate = { cx: cx0, cy: cy0, a: width / 2 * scale, b: height / 2 * scale, n, error: 0 };
        let maxError = 0;
        for (const point of points) {
          maxError = Math.max(maxError, superellipseError(point, candidate));
          if (best && maxError >= best.error) break;
        }
        candidate.error = maxError;
        if (maxError <= tolerance && (!best || maxError < best.error)) best = candidate;
      }
    }
    if (!best) return null;
    const sweep = signedArea(points) >= 0 ? Math.PI * 2 : -Math.PI * 2;
    const steps = 8;
    const start2 = superPoint(best, 0);
    const commands = [];
    for (let i = 0; i < steps; i++) {
      const t0 = sweep * i / steps;
      const t1 = sweep * (i + 1) / steps;
      const p0 = i === 0 ? start2 : superPoint(best, t0);
      const p3 = i === steps - 1 ? start2 : superPoint(best, t1);
      const tan0 = superTangent(best, t0, sweep > 0);
      const tan1 = superTangent(best, t1, sweep > 0);
      const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
      const arm = chord * 0.35;
      commands.push({
        op: "C",
        x1: p0.x + tan0.x * arm,
        y1: p0.y + tan0.y * arm,
        x2: p3.x - tan1.x * arm,
        y2: p3.y - tan1.y * arm,
        x: p3.x,
        y: p3.y,
        primitive: "cubic"
      });
    }
    if (sampleCurveError(start2, commands, points) > tolerance) return null;
    return { start: start2, commands };
  }
  function curvatureRuns(points) {
    const count = points.length;
    if (count < 20) return null;
    const turn = new Float64Array(count);
    for (let i = 0; i < count; i++) turn[i] = turnAngle(points[(i + count - 1) % count], points[i], points[(i + 1) % count]);
    const smooth = new Float64Array(count);
    const radius = 3;
    for (let i = 0; i < count; i++) {
      let sum = 0;
      for (let delta = -radius; delta <= radius; delta++) sum += turn[(i + delta + count) % count] ?? 0;
      smooth[i] = sum / (radius * 2 + 1);
    }
    const curved = [];
    for (let i = 0; i < count; i++) curved.push(Math.abs(smooth[i] ?? 0) > 0.05);
    let origin = -1;
    for (let i = 0; i < count; i++) if (!curved[i]) {
      origin = i;
      break;
    }
    if (origin < 0) return null;
    const runs = [];
    let cursor = 0;
    while (cursor < count) {
      const index = (origin + cursor) % count;
      const flag = curved[index] ?? false;
      const indices = [index];
      cursor++;
      while (cursor < count && (curved[(origin + cursor) % count] ?? false) === flag) {
        indices.push((origin + cursor) % count);
        cursor++;
      }
      runs.push({ curved: flag, indices });
    }
    absorb(runs, (run, previous, next) => run.curved && run.indices.length <= 2 && !previous.curved && !next.curved, false);
    absorb(runs, (run, previous, next) => !run.curved && run.indices.length <= 4 && previous.curved && next.curved, true);
    const useful = runs.filter((run) => run.indices.length > 0);
    if (useful.length !== 8) return null;
    let bends = 0;
    let sides = 0;
    for (let i = 0; i < useful.length; i++) {
      const run = useful[i];
      const next = useful[(i + 1) % useful.length];
      if (!run || !next || run.curved === next.curved) return null;
      if (run.curved) bends++;
      else sides++;
      if (run.curved) {
        let integral = 0;
        for (const index of run.indices) integral += turn[index] ?? 0;
        if (Math.abs(integral) < 0.55 || Math.abs(integral) > 2.1) return null;
      }
    }
    if (bends !== 4 || sides !== 4) return null;
    return useful;
  }
  function absorb(runs, take, curved) {
    for (let i = 0; i < runs.length; ) {
      const run = runs[i];
      const previous = runs[(i + runs.length - 1) % runs.length];
      const next = runs[(i + 1) % runs.length];
      if (!run || !previous || !next || previous === next || !take(run, previous, next)) {
        i++;
        continue;
      }
      previous.indices = previous.indices.concat(run.indices, next.indices);
      previous.curved = curved;
      const nextIndex = (i + 1) % runs.length;
      const drop = [i, nextIndex].sort((a, b) => b - a);
      for (const index of drop) runs.splice(index, 1);
      i = 0;
    }
  }
  function crispCorners(points, closed) {
    const count = points.length;
    if (count < 6) return [];
    const reach = 3.4;
    const turns = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const back = walkPoint(points, i, reach, -1, closed);
      const ahead = walkPoint(points, i, reach, 1, closed);
      const current = points[i];
      if (!back || !ahead || !current) continue;
      const turn = Math.abs(turnAngle(back.point, current, ahead.point));
      if (turn < 0.9) continue;
      if (pathDeviation(points, i, back.index, -1, closed) > 0.85 || pathDeviation(points, i, ahead.index, 1, closed) > 0.85) continue;
      turns[i] = turn;
    }
    const cuts = [];
    for (let i = 0; i < count; i++) {
      const turn = turns[i] ?? 0;
      if (turn < 0.9) continue;
      const left = turns[(i - 1 + count) % count] ?? 0;
      const right = turns[(i + 1) % count] ?? 0;
      if (turn + 1e-6 < left || turn < right) continue;
      const last = cuts[cuts.length - 1];
      if (last !== void 0 && i - last < 4) continue;
      cuts.push(i);
    }
    if (closed && cuts.length >= 2) {
      const first = cuts[0];
      const last = cuts[cuts.length - 1];
      if (first !== void 0 && last !== void 0 && first + count - last < 4) cuts.pop();
    }
    return cuts;
  }
  function walkPoint(points, index, distance, sign, closed) {
    const count = points.length;
    let remaining = distance;
    let cursor = index;
    for (let guard = 0; guard < count; guard++) {
      const next = cursor + sign;
      if (!closed && (next < 0 || next >= count)) return null;
      const wrapped = (next + count) % count;
      const from = points[(cursor + count) % count];
      const to = points[wrapped];
      if (!from || !to) return null;
      const step = Math.hypot(to.x - from.x, to.y - from.y);
      if (step < 1e-8) {
        if (wrapped === index) return null;
        cursor = wrapped;
        continue;
      }
      if (step + 1e-8 >= remaining) {
        const t = remaining / step;
        return { point: { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, index: wrapped };
      }
      remaining -= step;
      if (closed && wrapped === index) return null;
      cursor = wrapped;
    }
    return null;
  }
  function pathDeviation(points, from, to, sign, closed) {
    const count = points.length;
    const start2 = points[from];
    const end = points[(to + count) % count];
    if (!start2 || !end) return Infinity;
    let max = 0;
    let cursor = from;
    for (let guard = 0; guard < count; guard++) {
      const next = cursor + sign;
      if (!closed && (next < 0 || next >= count)) break;
      const wrapped = (next + count) % count;
      const point = points[wrapped];
      if (point) max = Math.max(max, pointSegmentDistance(point, start2, end));
      if (wrapped === (to + count) % count) break;
      cursor = wrapped;
    }
    return max;
  }
  function fitSmoothSpan(points, tolerance, depth) {
    const end = points[points.length - 1];
    const start2 = points[0];
    if (!start2 || !end) return [];
    if (points.length < 2) return [];
    const line = tryLine(points, tolerance);
    const bow = maxSegmentError(points, start2, end);
    if (line && bow <= 0.55) return [line];
    if (points.length >= 6) {
      const arc = tryArc(points, tolerance);
      if (arc && arc.commands.length <= 2) return [arc];
    }
    if (points.length >= 4) {
      const cubic = tryFairCubic(points, tolerance);
      if (cubic) return [cubic];
    }
    if (line) return [line];
    if (depth > 12 || points.length <= 3) return [{ commands: [{ op: "L", x: end.x, y: end.y, primitive: "line" }] }];
    const split = splitIndex(points);
    return fairJoin(
      fitSmoothSpan(points.slice(0, split + 1), tolerance, depth + 1),
      fitSmoothSpan(points.slice(split), tolerance, depth + 1)
    );
  }
  function fitClosedPrimitives(points, tolerance) {
    return tryFullCircle(points, tolerance) ?? tryRoundedRect(points, tolerance) ?? trySuperellipse(points, tolerance) ?? tryFullEllipse(points, tolerance);
  }
  function fitClosedGuided(points, tolerance) {
    const epsilon = Math.max(0.5, Math.min(tolerance * 0.78, 1.3));
    const guide = decimateClosed(points, epsilon);
    if (guide.length < 6) return null;
    const primitive = fitClosedPrimitives(guide, Math.max(0.35, tolerance - epsilon * 0.35));
    if (primitive && sampleCurveError(primitive.start, primitive.commands, points) <= tolerance) return primitive;
    const fitted = fitClosedRaw(guide, Math.max(0.3, tolerance - epsilon));
    if (!fitted || sampleCurveError(fitted.start, fitted.commands, points) > tolerance) return null;
    return fitted;
  }
  function fitClosedRaw(points, tolerance) {
    const cuts = crispCorners(points, true);
    if (cuts.length >= 3) {
      const commands2 = [];
      for (let i = 0; i < cuts.length; i++) {
        const span = sliceCyclic(points, cuts[i], cuts[(i + 1) % cuts.length]);
        commands2.push(...fitOpenClean(span, tolerance));
      }
      const start3 = points[cuts[0]];
      if (!start3 || commands2.length === 0) return null;
      return { start: start3, commands: commands2 };
    }
    const loop = points.concat(points[0]);
    const commands = fitOpenClean(loop, tolerance);
    const start2 = points[0];
    if (!start2 || commands.length === 0) return null;
    return { start: start2, commands };
  }
  function pinEnd(commands, end) {
    const last = commands[commands.length - 1];
    if (!last || last.x === end.x && last.y === end.y) return commands;
    return commands.slice(0, -1).concat([{ ...last, x: end.x, y: end.y }]);
  }
  function decimateIndexed(points, epsilon) {
    if (points.length < 3 || epsilon <= 0) return points.map((_, index) => index);
    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;
    const stack = [0, points.length - 1];
    while (stack.length > 0) {
      const end = stack.pop();
      const start2 = stack.pop();
      if (start2 === void 0 || end === void 0) break;
      let best = -1;
      let bestDistance = epsilon;
      for (let i = start2 + 1; i < end; i++) {
        const point = points[i];
        const from = points[start2];
        const to = points[end];
        if (!point || !from || !to) continue;
        const distance = pointSegmentDistance(point, from, to);
        if (distance > bestDistance) {
          bestDistance = distance;
          best = i;
        }
      }
      if (best >= 0) {
        keep[best] = 1;
        stack.push(start2, best, best, end);
      }
    }
    const indexes = [];
    for (let i = 0; i < points.length; i++) if (keep[i]) indexes.push(i);
    return indexes;
  }
  function decimateOpen(points, epsilon) {
    if (points.length < 3 || epsilon <= 0) return points.slice();
    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;
    const stack = [0, points.length - 1];
    while (stack.length > 0) {
      const end = stack.pop();
      const start2 = stack.pop();
      if (start2 === void 0 || end === void 0) break;
      let best = -1;
      let bestDistance = epsilon;
      for (let i = start2 + 1; i < end; i++) {
        const point = points[i];
        const from = points[start2];
        const to = points[end];
        if (!point || !from || !to) continue;
        const distance = pointSegmentDistance(point, from, to);
        if (distance > bestDistance) {
          bestDistance = distance;
          best = i;
        }
      }
      if (best >= 0) {
        keep[best] = 1;
        stack.push(start2, best, best, end);
      }
    }
    const out = [];
    for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
    return out;
  }
  function decimateClosed(points, epsilon) {
    if (points.length < 8) return points.slice();
    let first = 0;
    for (let i = 1; i < points.length; i++) {
      const point = points[i];
      const best = points[first];
      if (!point || !best) continue;
      if (point.x < best.x - 1e-9 || Math.abs(point.x - best.x) <= 1e-9 && point.y < best.y) first = i;
    }
    const origin = points[first];
    if (!origin) return points.slice();
    let second = 0;
    let far = -1;
    for (let i = 0; i < points.length; i++) {
      if (i === first) continue;
      const point = points[i];
      if (!point) continue;
      const distance = (point.x - origin.x) ** 2 + (point.y - origin.y) ** 2;
      if (distance > far) {
        far = distance;
        second = i;
      }
    }
    const a = decimateOpen(sliceCyclic(points, first, second), epsilon);
    const b = decimateOpen(sliceCyclic(points, second, first), epsilon);
    if (a.length === 0) return b;
    return a.concat(b.slice(1, -1));
  }
  function fairJoin(left, right) {
    const previous = left[left.length - 1];
    const next = right[0];
    if (!previous || !next) return left.concat(right);
    const leftCommand = previous.commands[previous.commands.length - 1];
    const rightCommand = next.commands[0];
    if (!leftCommand || !rightCommand || leftCommand.op !== "C" || rightCommand.op !== "C") return left.concat(right);
    const tx = leftCommand.x - leftCommand.x2;
    const ty = leftCommand.y - leftCommand.y2;
    const length = Math.hypot(tx, ty);
    if (length < 1e-6) return left.concat(right);
    const arm = Math.hypot(rightCommand.x1 - leftCommand.x, rightCommand.y1 - leftCommand.y);
    const matched = Math.max(length, Math.min(arm, length * 1.35));
    const joined = {
      ...rightCommand,
      x1: leftCommand.x + tx / length * matched,
      y1: leftCommand.y + ty / length * matched
    };
    const rebuilt = { commands: [joined, ...next.commands.slice(1)] };
    return left.concat([rebuilt], right.slice(1));
  }
  function fitCircle(points) {
    let sumX = 0;
    let sumY = 0;
    let sumX2 = 0;
    let sumY2 = 0;
    let sumXY = 0;
    let sumR = 0;
    let sumRX = 0;
    let sumRY = 0;
    const count = points.length;
    if (count < 6) return null;
    for (const point of points) {
      const radius22 = point.x * point.x + point.y * point.y;
      sumX += point.x;
      sumY += point.y;
      sumX2 += point.x * point.x;
      sumY2 += point.y * point.y;
      sumXY += point.x * point.y;
      sumR += radius22;
      sumRX += radius22 * point.x;
      sumRY += radius22 * point.y;
    }
    const det = determinant(sumX2, sumXY, sumX, sumXY, sumY2, sumY, sumX, sumY, count);
    if (Math.abs(det) < 1e-8) return null;
    const d = determinant(-sumRX, sumXY, sumX, -sumRY, sumY2, sumY, -sumR, sumY, count) / det;
    const e = determinant(sumX2, -sumRX, sumX, sumXY, -sumRY, sumY, sumX, -sumR, count) / det;
    const f = determinant(sumX2, sumXY, -sumRX, sumXY, sumY2, -sumRY, sumX, sumY, -sumR) / det;
    const cx = -d / 2;
    const cy = -e / 2;
    const radius2 = cx * cx + cy * cy - f;
    if (!(radius2 > 1)) return null;
    return { cx, cy, r: Math.sqrt(radius2) };
  }
  function fitEllipse(points) {
    let sx = 0;
    let sy = 0;
    for (const point of points) {
      sx += point.x;
      sy += point.y;
    }
    const cx = sx / points.length;
    const cy = sy / points.length;
    let a00 = 0;
    let a01 = 0;
    let a11 = 0;
    let b0 = 0;
    let b1 = 0;
    for (const point of points) {
      const x2 = (point.x - cx) * (point.x - cx);
      const y2 = (point.y - cy) * (point.y - cy);
      a00 += x2 * x2;
      a01 += x2 * y2;
      a11 += y2 * y2;
      b0 += x2;
      b1 += y2;
    }
    const det = a00 * a11 - a01 * a01;
    if (Math.abs(det) < 1e-6) return null;
    const u = (a11 * b0 - a01 * b1) / det;
    const v = (a00 * b1 - a01 * b0) / det;
    if (!(u > 1e-6) || !(v > 1e-6)) return null;
    return { cx, cy, rx: 1 / Math.sqrt(u), ry: 1 / Math.sqrt(v) };
  }
  function ellipseRadialError(point, ellipse) {
    const dx = (point.x - ellipse.cx) / ellipse.rx;
    const dy = (point.y - ellipse.cy) / ellipse.ry;
    const rho = Math.hypot(dx, dy);
    return Math.abs(rho - 1) * Math.hypot(point.x - ellipse.cx, point.y - ellipse.cy) / Math.max(rho, 0.25);
  }
  function superellipseError(point, shape) {
    const dx = (point.x - shape.cx) / shape.a;
    const dy = (point.y - shape.cy) / shape.b;
    const rho = (Math.abs(dx) ** shape.n + Math.abs(dy) ** shape.n) ** (1 / shape.n);
    return Math.abs(rho - 1) * Math.hypot(point.x - shape.cx, point.y - shape.cy) / Math.max(rho, 0.25);
  }
  function fullArcCubics(circle, startAngle, sweep) {
    const commands = [];
    const steps = 4;
    for (let i = 0; i < steps; i++) {
      const a0 = startAngle + sweep * i / steps;
      const a1 = startAngle + sweep * (i + 1) / steps;
      commands.push(arcStep(circle, a0, a1, i === steps - 1 ? startAngle : null));
    }
    return commands;
  }
  function ellipseCubics(ellipse, sweep) {
    const commands = [];
    const steps = 4;
    for (let i = 0; i < steps; i++) {
      const a0 = sweep * i / steps;
      const a1 = sweep * (i + 1) / steps;
      const p0 = ellipsePoint(ellipse, a0);
      const p3 = ellipsePoint(ellipse, i === steps - 1 ? 0 : a1);
      const arm = KAPPA * (Math.abs(sweep) / (Math.PI * 2)) * 4;
      const t0 = ellipseTangent(ellipse, a0, sweep > 0);
      const t1 = ellipseTangent(ellipse, a1, sweep > 0);
      commands.push({
        op: "C",
        x1: p0.x + t0.x * ellipseScale(ellipse, arm),
        y1: p0.y + t0.y * ellipseScale(ellipse, arm),
        x2: p3.x - t1.x * ellipseScale(ellipse, arm),
        y2: p3.y - t1.y * ellipseScale(ellipse, arm),
        x: p3.x,
        y: p3.y,
        primitive: "arc"
      });
    }
    return commands;
  }
  function ellipseScale(ellipse, arm) {
    return (ellipse.rx + ellipse.ry) / 2 * arm;
  }
  function arcCubics(start2, end, circle, sweep) {
    const startAngle = Math.atan2(start2.y - circle.cy, start2.x - circle.cx);
    const steps = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI * 0.62)));
    const commands = [];
    for (let i = 0; i < steps; i++) {
      const a0 = startAngle + sweep * i / steps;
      const a1 = startAngle + sweep * (i + 1) / steps;
      const command = arcStep(circle, a0, a1, null);
      const origin = commandFrom(circle, a0);
      if (i === 0) {
        commands.push({ ...command, x1: start2.x + (command.x1 - origin.x), y1: start2.y + (command.y1 - origin.y) });
      } else commands.push(command);
    }
    const last = commands[commands.length - 1];
    if (last) commands[commands.length - 1] = { ...last, x: end.x, y: end.y };
    return commands;
  }
  function arcStep(circle, a0, a1, closeAt) {
    const p0 = commandFrom(circle, a0);
    const p3 = closeAt === null ? commandFrom(circle, a1) : commandFrom(circle, closeAt);
    const sweep = a1 - a0;
    const k = 4 / 3 * Math.tan(sweep / 4);
    const t0 = { x: -Math.sin(a0), y: Math.cos(a0) };
    const t1 = { x: -Math.sin(a1), y: Math.cos(a1) };
    return {
      op: "C",
      x1: p0.x + t0.x * k * circle.r,
      y1: p0.y + t0.y * k * circle.r,
      x2: p3.x - t1.x * k * circle.r,
      y2: p3.y - t1.y * k * circle.r,
      x: p3.x,
      y: p3.y,
      primitive: "arc"
    };
  }
  function commandFrom(circle, angle) {
    return { x: circle.cx + Math.cos(angle) * circle.r, y: circle.cy + Math.sin(angle) * circle.r };
  }
  function ellipsePoint(ellipse, angle) {
    return { x: ellipse.cx + Math.cos(angle) * ellipse.rx, y: ellipse.cy + Math.sin(angle) * ellipse.ry };
  }
  function ellipseTangent(ellipse, angle, positive) {
    const tx = -ellipse.rx * Math.sin(angle);
    const ty = ellipse.ry * Math.cos(angle);
    const length = Math.hypot(tx, ty) || 1;
    const sign = positive ? 1 : -1;
    return { x: tx / length * sign, y: ty / length * sign };
  }
  function superPoint(shape, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const power = 2 / shape.n;
    return {
      x: shape.cx + Math.sign(c) * shape.a * Math.abs(c) ** power,
      y: shape.cy + Math.sign(s) * shape.b * Math.abs(s) ** power
    };
  }
  function superTangent(shape, angle, positive) {
    const ahead = superPoint(shape, angle + 0.02);
    const behind = superPoint(shape, angle - 0.02);
    const length = Math.hypot(ahead.x - behind.x, ahead.y - behind.y) || 1;
    const sign = positive ? 1 : -1;
    return { x: (ahead.x - behind.x) / length * sign, y: (ahead.y - behind.y) / length * sign };
  }
  function sweepAbout(points, circle) {
    let sweep = 0;
    for (let i = 1; i < points.length; i++) {
      const previous = points[i - 1];
      const point = points[i];
      if (!previous || !point) continue;
      const a0 = Math.atan2(previous.y - circle.cy, previous.x - circle.cx);
      const a1 = Math.atan2(point.y - circle.cy, point.x - circle.cx);
      let delta = a1 - a0;
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      sweep += delta;
    }
    return sweep;
  }
  function fitCubic(points, t1, t2) {
    const p0 = points[0];
    const p3 = points[points.length - 1];
    if (!p0 || !p3) return null;
    const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
    if (chord < 1e-6) return null;
    let length = 0;
    const parameter = [0];
    for (let i = 1; i < points.length; i++) {
      const previous = points[i - 1];
      const point = points[i];
      if (!previous || !point) return null;
      length += Math.hypot(point.x - previous.x, point.y - previous.y);
      parameter.push(length);
    }
    if (length < 1e-6) return null;
    let c11 = 0;
    let c12 = 0;
    let c22 = 0;
    let x1 = 0;
    let x2 = 0;
    const tangentDot = t1.x * t2.x + t1.y * t2.y;
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      if (!point) return null;
      const t = (parameter[i] ?? 0) / length;
      const u = 1 - t;
      const b1 = 3 * u * u * t;
      const b2 = 3 * u * t * t;
      const basisX = p0.x * u * u * u + p3.x * t * t * t;
      const basisY = p0.y * u * u * u + p3.y * t * t * t;
      c11 += b1 * b1;
      c22 += b2 * b2;
      c12 += b1 * b2 * tangentDot;
      x1 += b1 * ((point.x - basisX) * t1.x + (point.y - basisY) * t1.y);
      x2 += b2 * ((point.x - basisX) * t2.x + (point.y - basisY) * t2.y);
    }
    const det = c11 * c22 - c12 * c12;
    if (Math.abs(det) < 1e-10) return null;
    const alpha1 = (c22 * x1 - c12 * x2) / det;
    const alpha2 = (c11 * x2 - c12 * x1) / det;
    if (!(alpha1 > 0) || !(alpha2 > 0) || alpha1 > chord * 1.2 || alpha2 > chord * 1.2) return null;
    const command = {
      op: "C",
      x1: p0.x + t1.x * alpha1,
      y1: p0.y + t1.y * alpha1,
      x2: p3.x + t2.x * alpha2,
      y2: p3.y + t2.y * alpha2,
      x: p3.x,
      y: p3.y
    };
    let maxError = 0;
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      if (!point) continue;
      const at = cubicAt(p0, { x: command.x1, y: command.y1 }, { x: command.x2, y: command.y2 }, p3, (parameter[i] ?? 0) / length);
      maxError = Math.max(maxError, Math.hypot(at.x - point.x, at.y - point.y));
    }
    return { command, error: maxError };
  }
  function extraInflection(points, start2, command) {
    const end = { x: command.x, y: command.y };
    const source = signChanges(points.map((point) => signedDistance(point, start2, end)));
    const samples = [];
    for (let step = 0; step <= 8; step++) {
      const at = cubicAt(start2, { x: command.x1, y: command.y1 }, { x: command.x2, y: command.y2 }, end, step / 8);
      samples.push(signedDistance(at, start2, end));
    }
    return signChanges(samples) > source + 1;
  }
  function signChanges(values) {
    let changes = 0;
    let previous = 0;
    for (const value of values) {
      const sign = value > 0.15 ? 1 : value < -0.15 ? -1 : 0;
      if (sign === 0) continue;
      if (previous !== 0 && sign !== previous) changes++;
      previous = sign;
    }
    return changes;
  }
  function curveError2(points, start2, commands) {
    return sampleCurveError(start2, commands, points);
  }
  function sampleCurveError(start2, commands, points) {
    const samples = sampleCommands(start2, commands, 10);
    let maxError = 0;
    for (const point of points) {
      let best = Infinity;
      for (let i = 1; i < samples.length; i++) {
        const from = samples[i - 1];
        const to = samples[i];
        if (!from || !to) continue;
        best = Math.min(best, pointSegmentDistance(point, from, to));
      }
      maxError = Math.max(maxError, best);
    }
    return maxError;
  }
  function sampleCommands(start2, commands, steps) {
    const samples = [start2];
    let x = start2.x;
    let y = start2.y;
    for (const command of commands) {
      if (command.op === "L") {
        samples.push({ x: command.x, y: command.y });
        x = command.x;
        y = command.y;
        continue;
      }
      const from = { x, y };
      for (let step = 1; step <= steps; step++) {
        samples.push(cubicAt(from, { x: command.x1, y: command.y1 }, { x: command.x2, y: command.y2 }, { x: command.x, y: command.y }, step / steps));
      }
      x = command.x;
      y = command.y;
    }
    return samples;
  }
  function smoothPolyline(points, radius) {
    return points.map((point, index) => {
      if (index === 0 || index === points.length - 1) return point;
      let x = 0;
      let y = 0;
      let weight = 0;
      for (let delta = -radius; delta <= radius; delta++) {
        const sample2 = points[index + delta];
        if (!sample2) continue;
        const w = radius + 1 - Math.abs(delta);
        x += sample2.x * w;
        y += sample2.y * w;
        weight += w;
      }
      return weight > 0 ? { x: x / weight, y: y / weight } : point;
    });
  }
  function unitToward(points, index, atEnd) {
    const origin = points[index];
    if (!origin) return null;
    const reach = Math.min(5, atEnd ? index : points.length - 1 - index);
    let x = 0;
    let y = 0;
    for (let step = 1; step <= reach; step++) {
      const point = points[atEnd ? index - step : index + step];
      if (!point) continue;
      x += (point.x - origin.x) / step;
      y += (point.y - origin.y) / step;
    }
    const length = Math.hypot(x, y);
    if (length < 1e-8) return null;
    return { x: x / length, y: y / length };
  }
  function splitIndex(points) {
    const start2 = points[0];
    const end = points[points.length - 1];
    if (!start2 || !end) return Math.floor(points.length / 2);
    let best = -1;
    let index = Math.floor(points.length / 2);
    for (let i = 1; i < points.length - 1; i++) {
      const point = points[i];
      if (!point) continue;
      const distance = pointSegmentDistance(point, start2, end);
      if (distance > best) {
        best = distance;
        index = i;
      }
    }
    if (index <= 0 || index >= points.length - 1) return Math.floor(points.length / 2);
    return index;
  }
  function projectSegment(points, axis) {
    const first = points[0];
    const last = points[points.length - 1];
    if (!first || !last) return null;
    const mid = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
    const direction = { x: Math.cos(axis), y: Math.sin(axis) };
    const project2 = (point) => {
      const t = (point.x - mid.x) * direction.x + (point.y - mid.y) * direction.y;
      return { x: mid.x + t * direction.x, y: mid.y + t * direction.y };
    };
    return { start: project2(first), end: project2(last) };
  }
  function nearestSnap(angle) {
    const axes = [
      { axis: 0, name: "horizontal" },
      { axis: Math.PI / 4, name: "diagonal" },
      { axis: Math.PI / 2, name: "vertical" },
      { axis: 3 * Math.PI / 4, name: "diagonal" },
      { axis: Math.PI, name: "horizontal" },
      { axis: -Math.PI / 4, name: "diagonal" },
      { axis: -Math.PI / 2, name: "vertical" },
      { axis: -3 * Math.PI / 4, name: "diagonal" }
    ];
    let best = null;
    let bestDelta = 0.22;
    for (const candidate of axes) {
      let delta = Math.abs(angle - candidate.axis);
      if (delta > Math.PI) delta = Math.PI * 2 - delta;
      if (delta < bestDelta) {
        bestDelta = delta;
        best = candidate;
      }
    }
    return best;
  }
  function maxSegmentError(points, start2, end) {
    let max = 0;
    for (const point of points) max = Math.max(max, pointSegmentDistance(point, start2, end));
    return max;
  }
  function pointSegmentDistance(point, from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-8) return Math.hypot(point.x - from.x, point.y - from.y);
    const t = Math.min(1, Math.max(0, ((point.x - from.x) * dx + (point.y - from.y) * dy) / (length * length)));
    return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
  }
  function signedDistance(point, from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-8) return 0;
    return ((point.x - from.x) * dy - (point.y - from.y) * dx) / length;
  }
  function turnAngle(a, b, c) {
    const incoming = Math.atan2(b.y - a.y, b.x - a.x);
    const outgoing = Math.atan2(c.y - b.y, c.x - b.x);
    let delta = outgoing - incoming;
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
  }
  function signedArea(points) {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      const next = points[(i + 1) % points.length];
      if (!point || !next) continue;
      area += point.x * next.y - next.x * point.y;
    }
    return area / 2;
  }
  function bounds(points) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of points) {
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;
    }
    return { minX, minY, maxX, maxY };
  }
  function sliceCyclic(points, start2, end) {
    const out = [points[start2]];
    if (start2 === end) {
      for (let i = 1; i <= points.length; i++) out.push(points[(start2 + i) % points.length]);
      return out;
    }
    let cursor = start2;
    do {
      cursor = (cursor + 1) % points.length;
      out.push(points[cursor]);
    } while (cursor !== end);
    return out;
  }
  function cubicAt(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y
    };
  }
  function determinant(a00, a01, a02, a10, a11, a12, a20, a21, a22) {
    return a00 * (a11 * a22 - a12 * a21) - a01 * (a10 * a22 - a12 * a20) + a02 * (a10 * a21 - a11 * a20);
  }

  // src/color/iso.ts
  function refineChain(points, closed, inside, outside, width, height, rgba, palette, labels) {
    const original = points.map((point) => ({ x: point.x, y: point.y }));
    if (outside === TRANSPARENT || inside === TRANSPARENT || points.length < 2) return { points: original, soft: false };
    const labA = paletteLab(palette, inside);
    const labB = paletteLab(palette, outside);
    if (!labA || !labB) return { points: original, soft: false };
    const edgeCount = closed ? points.length : points.length - 1;
    if (edgeCount < 1) return { points: original, soft: false };
    const insideRaw = [];
    const outsideRaw = [];
    const pixels = [];
    for (let edge = 0; edge < edgeCount; edge++) {
      const from = points[edge];
      const to = points[(edge + 1) % points.length];
      if (!from || !to) return { points: original, soft: false };
      const ends = edgePixels(from.x, from.y, to.x, to.y);
      if (!ends) return { points: original, soft: false };
      pixels.push(ends);
      insideRaw.push(sampleT(ends.inside[0], ends.inside[1], 1, width, height, rgba, labels, inside, outside, labA, labB));
      outsideRaw.push(sampleT(ends.outside[0], ends.outside[1], 0, width, height, rgba, labels, inside, outside, labA, labB));
    }
    const insideT = smoothLine(smoothLine(insideRaw, closed), closed);
    const outsideT = smoothLine(smoothLine(outsideRaw, closed), closed);
    const crossings = [];
    let soft = 0;
    for (let edge = 0; edge < edgeCount; edge++) {
      const ends = pixels[edge];
      if (!ends) return { points: original, soft: false };
      const near = insideT[edge] ?? 0;
      const far = outsideT[edge] ?? 1;
      if (near > 0.08 || far < 0.92) soft++;
      crossings.push(dualCrossing(ends.inside[0], ends.inside[1], ends.outside[0], ends.outside[1], near, far));
    }
    if (soft * 5 < edgeCount) return { points: original, soft: false };
    if (closed) {
      const loop = relaxJogs(dedupe(crossings, true), true);
      if (loop.length < 3) return { points: original, soft: false };
      return { points: loop, soft: true };
    }
    const start2 = points[0];
    const end = points[points.length - 1];
    if (!start2 || !end) return { points: original, soft: false };
    const open = relaxJogs(
      dedupe(
        [sharedJunction(start2, width, height, rgba, labels, palette), ...crossings, sharedJunction(end, width, height, rgba, labels, palette)],
        false
      ),
      false
    );
    if (open.length < 2) return { points: original, soft: false };
    return { points: open, soft: true };
  }
  function relaxJogs(points, closed) {
    const count = points.length;
    if (count < 3) return points.map((point) => ({ x: point.x, y: point.y }));
    let current = points.map((point) => ({ x: point.x, y: point.y }));
    for (let pass = 0; pass < 6; pass++) {
      const next = current.map((point) => ({ x: point.x, y: point.y }));
      const first = closed ? 0 : 1;
      const last = closed ? count : count - 1;
      for (let i = first; i < last; i++) {
        const previous = current[(i - 1 + count) % count];
        const point = current[i];
        const following = current[(i + 1) % count];
        const incoming = Math.hypot(point.x - previous.x, point.y - previous.y);
        const outgoing = Math.hypot(following.x - point.x, following.y - point.y);
        if (incoming > 2.4 && outgoing > 2.4) continue;
        const turn = jogTurn(previous, point, following);
        if (turn < 0.55) continue;
        const weight = turn > 2.2 ? 0.85 : 0.62;
        next[i] = {
          x: point.x * (1 - weight) + (previous.x + following.x) / 2 * weight,
          y: point.y * (1 - weight) + (previous.y + following.y) / 2 * weight
        };
      }
      current = next;
    }
    return current;
  }
  function jogTurn(a, b, c) {
    const incoming = Math.atan2(b.y - a.y, b.x - a.x);
    const outgoing = Math.atan2(c.y - b.y, c.x - b.x);
    let delta = outgoing - incoming;
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    return Math.abs(delta);
  }
  function dualCrossing(insideX, insideY, outsideX, outsideY, insideT, outsideT) {
    const denom = insideT - outsideT;
    let u = Math.abs(denom) < 1e-4 ? 0.5 : (0.5 - outsideT) / denom;
    if (u < 0) u = 0;
    if (u > 1) u = 1;
    const originX = outsideX + 0.5;
    const originY = outsideY + 0.5;
    return { x: originX + (insideX + 0.5 - originX) * u, y: originY + (insideY + 0.5 - originY) * u };
  }
  function sharedJunction(point, width, height, rgba, labels, palette) {
    const gx = Math.round(point.x);
    const gy = Math.round(point.y);
    if (Math.abs(point.x - gx) > 0.01 || Math.abs(point.y - gy) > 0.01) return { x: point.x, y: point.y };
    const pairs = [
      [gx - 1, gy - 1, gx, gy - 1],
      [gx - 1, gy, gx, gy],
      [gx - 1, gy - 1, gx - 1, gy],
      [gx, gy - 1, gx, gy]
    ];
    const crossings = [];
    for (const pair of pairs) {
      const ax = pair[0];
      const ay = pair[1];
      const bx = pair[2];
      const by = pair[3];
      if (ax < 0 || ay < 0 || bx < 0 || by < 0 || ax >= width || ay >= height || bx >= width || by >= height) continue;
      const labelA = labels[ay * width + ax] ?? TRANSPARENT;
      const labelB = labels[by * width + bx] ?? TRANSPARENT;
      if (labelA === labelB || labelA === TRANSPARENT || labelB === TRANSPARENT) continue;
      const labA = paletteLab(palette, labelA);
      const labB = paletteLab(palette, labelB);
      if (!labA || !labB) continue;
      const tA = sampleT(ax, ay, 1, width, height, rgba, labels, labelA, labelB, labA, labB);
      const tB = sampleT(bx, by, 0, width, height, rgba, labels, labelA, labelB, labA, labB);
      if (tA <= 0.08 && tB >= 0.92) return { x: gx, y: gy };
      crossings.push(dualCrossing(ax, ay, bx, by, tA, tB));
    }
    if (crossings.length === 0) return { x: gx, y: gy };
    let x = 0;
    let y = 0;
    for (const crossing of crossings) {
      x += crossing.x;
      y += crossing.y;
    }
    return { x: x / crossings.length, y: y / crossings.length };
  }
  function smoothLine(values, closed) {
    const count = values.length;
    const out = [];
    for (let i = 0; i < count; i++) {
      const previous = values[closed ? (i - 1 + count) % count : Math.max(0, i - 1)] ?? 0;
      const next = values[closed ? (i + 1) % count : Math.min(count - 1, i + 1)] ?? 0;
      out.push(0.25 * previous + 0.5 * (values[i] ?? 0) + 0.25 * next);
    }
    return out;
  }
  function edgePixels(ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    if (dx === 1 && dy === 0) return { inside: [ax, ay], outside: [ax, ay - 1] };
    if (dx === -1 && dy === 0) return { inside: [ax - 1, ay - 1], outside: [ax - 1, ay] };
    if (dx === 0 && dy === 1) return { inside: [ax - 1, ay], outside: [ax, ay] };
    if (dx === 0 && dy === -1) return { inside: [ax, ay - 1], outside: [ax - 1, ay - 1] };
    return null;
  }
  function sampleT(x, y, k, width, height, rgba, labels, inside, outside, labA, labB) {
    if (x < 0 || y < 0 || x >= width || y >= height) return k <= 0 ? 1 : 0;
    const index = y * width + x;
    if ((rgba[index * 4 + 3] ?? 0) < 128) return 1;
    const label = labels[index] ?? TRANSPARENT;
    const lab = rgbToOklab(rgba[index * 4] ?? 0, rgba[index * 4 + 1] ?? 0, rgba[index * 4 + 2] ?? 0);
    const projected = coverageT(lab, labA, labB);
    if (label !== inside && label !== outside) return projected;
    return projected;
  }
  function coverageT(lab, from, to) {
    const dl = to.l - from.l;
    const da = to.a - from.a;
    const db = to.b - from.b;
    const length2 = dl * dl + da * da + db * db;
    if (length2 < 1e-10) return 0.5;
    const t = ((lab.l - from.l) * dl + (lab.a - from.a) * da + (lab.b - from.b) * db) / length2;
    return Math.min(1, Math.max(0, t));
  }
  function dedupe(points, closed) {
    const out = [];
    for (const point of points) {
      const previous = out[out.length - 1];
      if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 1e-3) continue;
      out.push(point);
    }
    if (closed && out.length > 2) {
      const first = out[0];
      const last = out[out.length - 1];
      if (first && last && Math.hypot(first.x - last.x, first.y - last.y) < 1e-3) out.pop();
    }
    return out;
  }
  function paletteLab(palette, label) {
    const color = palette[label];
    if (!color) return null;
    return rgbToOklab(color.r, color.g, color.b);
  }

  // src/color/trace.ts
  function traceSegmentation(segmentation, options = {}) {
    const preset = options.preset ?? "logo";
    const profile = presetProfile(preset);
    const error = curveError(options.smooth ?? profile.smooth);
    const cornerAngle = options.cornerAngle ?? profile.cornerAngle;
    const hasSource = !!options.source && options.source.length >= segmentation.width * segmentation.height * 4;
    const scale = hasSource ? 1 : options.upscale && options.upscale > 1 ? Math.round(options.upscale) : options.upscale === 1 ? 1 : chooseUpscale(segmentation.width, segmentation.height, preset);
    const field = resolveField(segmentation, options);
    const scaled = scale <= 1 ? { labels: field.labels, width: segmentation.width, height: segmentation.height } : upscaleField(field, segmentation.width, segmentation.height, scale);
    const shapes = [];
    const cache = /* @__PURE__ */ new Map();
    const clean = cleanSession(segmentation, options);
    const counts = countLabels2(scaled.labels, segmentation.palette.length);
    const order = segmentation.palette.map((_, index) => index).filter((index) => (counts[index] ?? 0) > 0);
    order.sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0) || a - b);
    for (const label of order) {
      if (options.isCancelled?.()) break;
      const contours = traceLabel(scaled.labels, scaled.width, scaled.height, label);
      const iso = hasSource && options.source ? { rgba: options.source, palette: segmentation.palette, labels: field.labels, width: segmentation.width, height: segmentation.height, inside: label } : null;
      const subpaths = [];
      for (const contour of contours) {
        const subpath = contourToSubpath(contour, scale, error, cornerAngle, Math.max(1.15, error * 0.85), cache, clean, iso);
        if (subpath && subpath.commands.length > 0) subpaths.push(subpath);
      }
      const color = segmentation.palette[label];
      if (!color || subpaths.length === 0) continue;
      shapes.push({ color, area: counts[label] ?? 0, subpaths });
    }
    let nodeCount = 0;
    let subpathCount = 0;
    for (const shape of shapes) {
      subpathCount += shape.subpaths.length;
      for (const subpath of shape.subpaths) nodeCount += subpath.commands.length;
    }
    return {
      svg: shapesToSvg(shapes, segmentation.width, segmentation.height),
      pathCount: shapes.length,
      nodeCount,
      subpathCount,
      colorCount: shapes.length,
      shapes
    };
  }
  function resolveField(segmentation, options) {
    const count = segmentation.width * segmentation.height;
    const labels = segmentation.labels;
    const coverage = new Float32Array(count);
    coverage.fill(1);
    const partner = new Uint16Array(count);
    partner.fill(TRANSPARENT);
    const sourceCoverage = options.coverage ?? segmentation.coverage;
    const sourcePartner = options.partner ?? segmentation.partner;
    if (sourceCoverage && sourceCoverage.length === count) coverage.set(sourceCoverage);
    if (sourcePartner && sourcePartner.length === count) partner.set(sourcePartner);
    const original = options.originalLabels;
    if (original && original.length === count) {
      for (let i = 0; i < count; i++) {
        if ((labels[i] ?? TRANSPARENT) !== (original[i] ?? TRANSPARENT)) {
          coverage[i] = 1;
          partner[i] = TRANSPARENT;
        }
      }
    }
    const paletteLength = segmentation.palette.length;
    for (let i = 0; i < count; i++) {
      const other = partner[i] ?? TRANSPARENT;
      const label = labels[i] ?? TRANSPARENT;
      if (other === TRANSPARENT || other === label || other >= paletteLength) {
        partner[i] = TRANSPARENT;
        if (other === label) coverage[i] = 1;
      }
    }
    return { labels, coverage, partner };
  }
  function upscaleField(field, width, height, scale) {
    const scaledWidth = width * scale;
    const scaledHeight = height * scale;
    const labels = new Uint16Array(scaledWidth * scaledHeight);
    labels.fill(TRANSPARENT);
    const cells = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        const label = field.labels[index] ?? TRANSPARENT;
        if (label === TRANSPARENT) continue;
        const other = field.partner[index] ?? TRANSPARENT;
        const cover = field.coverage[index] ?? 1;
        const originX = x * scale;
        const originY = y * scale;
        if (other === TRANSPARENT || cover >= 0.999) {
          fillBlock(labels, scaledWidth, originX, originY, scale, label);
          continue;
        }
        let dx = 0;
        let dy = 0;
        if (x > 0 && field.labels[index - 1] === other) dx -= 1;
        if (x + 1 < width && field.labels[index + 1] === other) dx += 1;
        if (y > 0 && field.labels[index - width] === other) dy -= 1;
        if (y + 1 < height && field.labels[index + width] === other) dy += 1;
        if (dx === 0 && dy === 0) dx = 1;
        cells.length = 0;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = sx - (scale - 1) / 2;
            const py = sy - (scale - 1) / 2;
            cells.push({ x: sx, y: sy, proj: px * dx + py * dy });
          }
        }
        cells.sort((a, b) => b.proj - a.proj || a.y - b.y || a.x - b.x);
        const partnerCount = Math.max(0, Math.min(scale * scale, Math.round((1 - cover) * scale * scale)));
        for (let i = 0; i < cells.length; i++) {
          const cell = cells[i];
          if (!cell) continue;
          labels[(originY + cell.y) * scaledWidth + originX + cell.x] = i < partnerCount ? other : label;
        }
      }
    }
    return { labels, width: scaledWidth, height: scaledHeight };
  }
  function fillBlock(labels, width, originX, originY, scale, label) {
    for (let sy = 0; sy < scale; sy++) {
      const row = (originY + sy) * width + originX;
      labels.fill(label, row, row + scale);
    }
  }
  function traceLabel(labels, width, height, label) {
    const horizontal = new Uint8Array(width * (height + 1));
    const vertical = new Uint8Array((width + 1) * height);
    const contours = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((labels[y * width + x] ?? TRANSPARENT) !== label) continue;
        if (sample(labels, width, height, x, y - 1) === label) continue;
        if ((horizontal[y * width + x] ?? 0) & 1) continue;
        const contour = walk(labels, width, height, label, x, y, horizontal, vertical);
        if (contour && contour.points.length >= 3) contours.push(contour);
      }
    }
    return contours;
  }
  function walk(labels, width, height, label, startX, startY, horizontal, vertical) {
    let x = startX;
    let y = startY;
    let dir = 0;
    const points = [];
    const outside = [];
    const limit = (width + 1) * (height + 1) * 2;
    for (let step = 0; step < limit; step++) {
      if (step > 0 && x === startX && y === startY && dir === 0) break;
      if (!markEdge(x, y, dir, width, height, horizontal, vertical)) break;
      points.push({ x, y });
      const left = leftOf(x, y, dir);
      outside.push(sample(labels, width, height, left[0], left[1]));
      if (dir === 0) x += 1;
      else if (dir === 1) y += 1;
      else if (dir === 2) x -= 1;
      else y -= 1;
      const turn = [dir + 1 & 3, dir, dir + 3 & 3, dir + 2 & 3];
      let next = -1;
      for (const candidate of turn) {
        const right = rightOf(x, y, candidate);
        const other = leftOf(x, y, candidate);
        if (sample(labels, width, height, right[0], right[1]) === label && sample(labels, width, height, other[0], other[1]) !== label) {
          next = candidate;
          break;
        }
      }
      if (next < 0) break;
      dir = next;
    }
    if (points.length !== outside.length || points.length < 3) return null;
    return { points, outside };
  }
  function sample(labels, width, height, x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) return TRANSPARENT;
    return labels[y * width + x] ?? TRANSPARENT;
  }
  function rightOf(x, y, dir) {
    if (dir === 0) return [x, y];
    if (dir === 1) return [x - 1, y];
    if (dir === 2) return [x - 1, y - 1];
    return [x, y - 1];
  }
  function leftOf(x, y, dir) {
    if (dir === 0) return [x, y - 1];
    if (dir === 1) return [x, y];
    if (dir === 2) return [x - 1, y];
    return [x - 1, y - 1];
  }
  function markEdge(x, y, dir, width, height, horizontal, vertical) {
    if (dir === 0 || dir === 2) {
      const edgeX = dir === 0 ? x : x - 1;
      if (edgeX < 0 || y < 0 || edgeX >= width || y > height) return false;
      const index2 = y * width + edgeX;
      const bit2 = dir === 0 ? 1 : 2;
      if ((horizontal[index2] ?? 0) & bit2) return false;
      horizontal[index2] = (horizontal[index2] ?? 0) | bit2;
      return true;
    }
    const edgeY = dir === 1 ? y : y - 1;
    if (x < 0 || edgeY < 0 || x > width || edgeY >= height) return false;
    const index = edgeY * (width + 1) + x;
    const bit = dir === 1 ? 1 : 2;
    if ((vertical[index] ?? 0) & bit) return false;
    vertical[index] = (vertical[index] ?? 0) | bit;
    return true;
  }
  function cleanSession(segmentation, options) {
    const strength = options.cleanShapes ?? 0;
    const selected = options.smoothMask && options.smoothMask.some((value) => value > 0) ? options.smoothMask : null;
    if (!(strength > 0) && !selected) return null;
    return {
      tolerance: strength > 0 ? cleanTolerance(strength) : 0,
      strong: strongCleanTolerance(strength),
      letters: strength > 0 && !options.cleanText ? letterMask(segmentation.labels, segmentation.width, segmentation.height, segmentation.palette) : null,
      selected,
      width: segmentation.width,
      height: segmentation.height,
      cache: /* @__PURE__ */ new Map()
    };
  }
  function cleanChainTolerance(points, session) {
    if (!session) return null;
    if (session.selected && boundaryHits(session.selected, session.width, session.height, points, 0.08)) return session.strong;
    if (!(session.tolerance > 0)) return null;
    if (session.letters && boundaryHits(session.letters, session.width, session.height, points, 0.35)) return null;
    return session.tolerance;
  }
  function contourToSubpath(contour, scale, error, cornerAngle, simplify, cache, clean, iso) {
    const points = contour.points.map((point) => ({ x: point.x / scale, y: point.y / scale }));
    const chains = splitChains(points, clean ? stabilizeOutside(contour.outside) : contour.outside).map((chain) => prepareChain(chain, iso));
    if (chains.length === 0) return null;
    const only = chains[0];
    if (chains.length === 1 && only?.closed) {
      const canonical = canonicalizeClosed(only.points);
      if (canonical.length < 3) return null;
      const tolerance = cappedTolerance(cleanChainTolerance(canonical, clean), only.soft);
      const commands2 = cachedClosed(canonical, error, cornerAngle, simplify, cache, only.soft);
      const start3 = canonical[0];
      if (tolerance !== null && clean) {
        const fitted = cachedCleanClosed(canonical, tolerance, clean);
        if (fitted && fitted.commands.length > 0 && fitted.commands.length <= commands2.length) return fitted;
      }
      if (!start3 || commands2.length === 0) return null;
      return { start: start3, commands: commands2 };
    }
    const start2 = chains[0]?.points[0];
    if (!start2) return null;
    const commands = [];
    for (const chain of chains) {
      if (chain.closed || chain.points.length < 2) continue;
      const tolerance = cappedTolerance(cleanChainTolerance(chain.points, clean), chain.soft);
      const plain = cachedOpen(chain.points, error, cornerAngle, simplify, cache, chain.soft);
      if (tolerance === null || !clean) commands.push(...plain);
      else {
        const fitted = cachedCleanOpen(chain.points, tolerance, clean);
        commands.push(...fitted.length > 0 && fitted.length <= plain.length ? fitted : plain);
      }
    }
    if (commands.length === 0) return null;
    return { start: start2, commands };
  }
  function prepareChain(chain, iso) {
    if (!iso) return { ...chain, soft: false };
    const refined = refineChain(chain.points, chain.closed, iso.inside, chain.outside, iso.width, iso.height, iso.rgba, iso.palette, iso.labels);
    return { points: refined.points, closed: chain.closed, outside: chain.outside, soft: refined.soft };
  }
  function cappedTolerance(tolerance, soft) {
    if (tolerance === null || !soft) return tolerance;
    return Math.min(tolerance, 0.3);
  }
  function cachedCleanOpen(points, tolerance, session) {
    const canonical = canonicalizeOpen(points);
    const key = "k|" + tolerance.toFixed(3) + "|" + pointKey(canonical.points);
    let fitted = session.cache.get(key);
    if (!fitted) {
      const origin = canonical.points[0];
      if (!origin) return [];
      fitted = { start: origin, commands: fitOpenClean(canonical.points, tolerance) };
      session.cache.set(key, fitted);
    }
    if (fitted.commands.length === 0) return [];
    return canonical.reversed ? reverseCommands(fitted.commands, fitted.start) : fitted.commands;
  }
  function cachedCleanClosed(points, tolerance, session) {
    const key = "kc|" + tolerance.toFixed(3) + "|" + pointKey(points);
    let fitted = session.cache.get(key);
    if (!fitted) {
      const cleanFit = fitClosedClean(points, tolerance);
      if (!cleanFit) return null;
      fitted = { start: cleanFit.start, commands: [...cleanFit.commands] };
      session.cache.set(key, fitted);
    }
    return fitted;
  }
  function stabilizeOutside(outside) {
    const count = outside.length;
    if (count < 6) return outside.slice();
    const copy = outside.slice();
    const runs = [];
    let cursor = 0;
    while (cursor < count) {
      const label = copy[cursor] ?? TRANSPARENT;
      let length = 1;
      while (cursor + length < count && (copy[cursor + length] ?? TRANSPARENT) === label) length++;
      runs.push({ start: cursor, length, label });
      cursor += length;
    }
    if (runs.length >= 2) {
      const first = runs[0];
      const last = runs[runs.length - 1];
      if (first && last && first.label === last.label) {
        last.length += first.length;
        runs.shift();
      }
    }
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      if (!run || run.length > 3) continue;
      const previous = runs[(i - 1 + runs.length) % runs.length];
      const next = runs[(i + 1) % runs.length];
      if (!previous || !next || previous === next || previous.label !== next.label) continue;
      for (let step = 0; step < run.length; step++) copy[(run.start + step) % count] = previous.label;
    }
    return copy;
  }
  function splitChains(points, outside) {
    const count = points.length;
    if (count < 3 || outside.length !== count) return [];
    let junction = -1;
    for (let i = 0; i < count; i++) {
      if ((outside[i] ?? TRANSPARENT) !== (outside[(i + count - 1) % count] ?? TRANSPARENT)) {
        junction = i;
        break;
      }
    }
    if (junction < 0) return [{ points: points.slice(), closed: true, outside: outside[0] ?? TRANSPARENT }];
    const chains = [];
    let cursor = junction;
    let walked = 0;
    while (walked < count) {
      const outsideLabel = outside[cursor] ?? TRANSPARENT;
      const chain = [points[cursor]];
      while (walked < count) {
        const next = (cursor + 1) % count;
        chain.push(points[next]);
        walked++;
        cursor = next;
        if (walked >= count || (outside[cursor] ?? TRANSPARENT) !== outsideLabel) break;
      }
      chains.push({ points: chain, closed: false, outside: outsideLabel });
    }
    return chains;
  }
  function cachedOpen(points, error, cornerAngle, simplify, cache, subpixel) {
    const canonical = canonicalizeOpen(points);
    const key = (subpixel ? "s|" : "o|") + error.toFixed(4) + "|" + simplify.toFixed(4) + "|" + cornerAngle.toFixed(3) + "|" + pointKey(canonical.points);
    let fitted = cache.get(key);
    if (!fitted) {
      fitted = subpixel ? fitSubpixelOpen(canonical.points, cornerAngle) : fitOpenChain(canonical.points, error, cornerAngle, simplify);
      cache.set(key, fitted);
    }
    const origin = canonical.points[0];
    if (!origin) return [];
    return canonical.reversed ? reverseCommands(fitted, origin) : fitted;
  }
  function cachedClosed(points, error, cornerAngle, simplify, cache, subpixel) {
    const key = (subpixel ? "sc|" : "c|") + error.toFixed(4) + "|" + simplify.toFixed(4) + "|" + cornerAngle.toFixed(3) + "|" + pointKey(points);
    let fitted = cache.get(key);
    if (!fitted) {
      fitted = subpixel ? fitSubpixelClosed(points, cornerAngle) : fitClosedChain(points, error, cornerAngle, simplify);
      cache.set(key, fitted);
    }
    return fitted;
  }
  function canonicalizeOpen(points) {
    const forward = points.slice();
    const backward = points.slice().reverse();
    if (comparePoints(forward, backward) <= 0) return { points: forward, reversed: false };
    return { points: backward, reversed: true };
  }
  function canonicalizeClosed(points) {
    if (points.length === 0) return [];
    let start2 = 0;
    for (let i = 1; i < points.length; i++) {
      if (comparePoint(points[i], points[start2]) < 0) start2 = i;
    }
    const forward = rotate(points, start2);
    const reversed = points.slice().reverse();
    let reverseStart = 0;
    for (let i = 0; i < reversed.length; i++) {
      const point = reversed[i];
      const origin = points[start2];
      if (point && origin && point.x === origin.x && point.y === origin.y) {
        reverseStart = i;
        break;
      }
    }
    const backward = rotate(reversed, reverseStart);
    return comparePoints(forward, backward) <= 0 ? forward : backward;
  }
  function rotate(points, start2) {
    const out = [];
    for (let i = 0; i < points.length; i++) out.push(points[(start2 + i) % points.length]);
    return out;
  }
  function comparePoint(a, b) {
    if (a.x !== b.x) return a.x - b.x;
    return a.y - b.y;
  }
  function comparePoints(a, b) {
    const count = Math.min(a.length, b.length);
    for (let i = 0; i < count; i++) {
      const delta = comparePoint(a[i], b[i]);
      if (delta !== 0) return delta;
    }
    return a.length - b.length;
  }
  function pointKey(points) {
    let key = "";
    for (const point of points) key += point.x.toFixed(4) + "," + point.y.toFixed(4) + ";";
    return key;
  }
  var SUBPIXEL_ERROR = 0.28;
  var SUBPIXEL_EPSILON = 0.22;
  function fitSubpixelOpen(points, cornerAngle) {
    const keep = optimalIndices(points, SUBPIXEL_EPSILON);
    if (keep.length < 2) return [];
    const polygon = keep.map((index) => points[index]);
    const cuts = subpixelCorners(polygon, false, cornerAngle);
    const commands = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      fitSubpixelSpan(points, keep[cuts[i]], keep[cuts[i + 1]], commands, null, null);
    }
    return commands;
  }
  function fitSubpixelClosed(points, cornerAngle) {
    const keep = optimalClosedIndices(points, SUBPIXEL_EPSILON);
    if (keep.length < 3 || keep[0] !== 0) return [];
    const polygon = keep.map((index) => points[index]);
    const corners = subpixelCorners(polygon, true, cornerAngle);
    const commands = [];
    if (corners.length === 0) {
      const anchors = smoothAnchors(polygon);
      for (let i = 0; i < anchors.length; i++) {
        const from = keep[anchors[i]];
        const to = keep[anchors[(i + 1) % anchors.length]];
        const span = sliceCyclic2(points, from, to);
        const startTangent = loopTangent(points, from);
        const endTangent = loopTangent(points, to);
        fitSubpixelSpan(span, 0, span.length - 1, commands, startTangent, endTangent ? { x: -endTangent.x, y: -endTangent.y } : null);
      }
      return commands;
    }
    const cuts = corners.includes(0) ? corners : [0, ...corners];
    const bridge = !corners.includes(0);
    for (let i = 0; i < cuts.length; i++) {
      const fromCut = cuts[i];
      const toCut = cuts[(i + 1) % cuts.length];
      const from = keep[fromCut];
      const to = keep[toCut];
      const span = sliceCyclic2(points, from, to);
      const startTangent = bridge && fromCut === 0 ? loopTangent(points, from) : null;
      const endForward = bridge && toCut === 0 ? loopTangent(points, to) : null;
      fitSubpixelSpan(span, 0, span.length - 1, commands, startTangent, endForward ? { x: -endForward.x, y: -endForward.y } : null);
    }
    return commands;
  }
  function optimalIndices(points, epsilon) {
    const count = points.length;
    if (count === 0) return [];
    if (count < 3) return points.map((_, index) => index);
    const prev = new Int32Array(count);
    const cost = new Int32Array(count);
    for (let end = 1; end < count; end++) {
      let bestIndex = end - 1;
      let bestCost = cost[end - 1] + 1;
      const limit = Math.max(0, end - 96);
      for (let start2 = end - 2; start2 >= limit; start2--) {
        const candidate = cost[start2] + 1;
        if (candidate > bestCost) continue;
        if (maxChordError(points, start2, end) > epsilon) continue;
        bestIndex = start2;
        bestCost = candidate;
      }
      if (limit > 0 && cost[0] + 1 < bestCost && maxChordError(points, 0, end) <= epsilon) {
        bestIndex = 0;
        bestCost = cost[0] + 1;
      }
      cost[end] = bestCost;
      prev[end] = bestIndex;
    }
    const chosen = [];
    for (let cursor = count - 1; cursor >= 0; cursor = prev[cursor]) {
      chosen.push(cursor);
      if (cursor === 0) break;
    }
    chosen.reverse();
    return mergeColinearIndices(points, chosen, epsilon);
  }
  function mergeColinearIndices(points, indices, epsilon) {
    if (indices.length < 3) return indices.slice();
    const out = [indices[0]];
    for (let i = 1; i < indices.length - 1; i++) {
      const previous = out[out.length - 1];
      const next = indices[i + 1];
      if (maxChordError(points, previous, next) > epsilon) out.push(indices[i]);
    }
    out.push(indices[indices.length - 1]);
    return out;
  }
  function optimalClosedIndices(points, epsilon) {
    const count = points.length;
    if (count < 4) return points.map((_, index) => index);
    let first = 0;
    for (let i = 1; i < count; i++) if (comparePoint(points[i], points[first]) < 0) first = i;
    let second = 0;
    let best = -1;
    for (let i = 0; i < count; i++) {
      if (i === first) continue;
      const distance = distance2(points[i], points[first]);
      if (distance > best) {
        best = distance;
        second = i;
      }
    }
    const arcIndices = (start2, end) => {
      const local = [];
      const global = [];
      let cursor = start2;
      local.push(points[cursor]);
      global.push(cursor);
      while (cursor !== end) {
        cursor = (cursor + 1) % count;
        local.push(points[cursor]);
        global.push(cursor);
        if (local.length > count) break;
      }
      return optimalIndices(local, epsilon).map((index) => global[index]);
    };
    const head = arcIndices(first, second);
    const tail = arcIndices(second, first);
    return rotateClosedIndices(head.concat(tail.slice(1, -1)));
  }
  function rotateClosedIndices(indices) {
    const placed = indices.slice();
    if (!placed.includes(0)) {
      for (let i = 0; i < placed.length; i++) {
        const from = placed[i];
        const to = placed[(i + 1) % placed.length];
        const contains = from < to ? 0 > from && 0 < to : 0 > from || 0 < to;
        if (contains) {
          placed.splice(i + 1, 0, 0);
          break;
        }
      }
      if (!placed.includes(0)) placed.unshift(0);
    }
    const at = placed.indexOf(0);
    return placed.slice(at).concat(placed.slice(0, at));
  }
  function subpixelCorners(points, closed, cornerAngle) {
    const alpha = Math.max(cornerAngle, 1);
    if (!closed) {
      const cuts2 = [0];
      for (let i = 1; i < points.length - 1; i++) {
        if (sharpCorner(points[i - 1], points[i], points[i + 1], alpha)) cuts2.push(i);
      }
      cuts2.push(points.length - 1);
      return cuts2;
    }
    const cuts = [];
    for (let i = 0; i < points.length; i++) {
      const previous = points[(i + points.length - 1) % points.length];
      const next = points[(i + 1) % points.length];
      if (sharpCorner(previous, points[i], next, alpha)) cuts.push(i);
    }
    return cuts;
  }
  function sharpCorner(previous, current, next, alpha) {
    const turn = Math.abs(turnAngle2(previous, current, next));
    if (turn < alpha) return false;
    const incoming = Math.hypot(current.x - previous.x, current.y - previous.y);
    const outgoing = Math.hypot(next.x - current.x, next.y - current.y);
    return incoming >= 2 && outgoing >= 2;
  }
  function smoothAnchors(points) {
    const count = points.length;
    const target = Math.max(4, Math.min(12, Math.round(count / 18)));
    const step = Math.max(1, Math.floor(count / target));
    const anchors = [];
    for (let i = 0; i < count; i += step) anchors.push(i);
    if (anchors.length < 3) return [0, Math.floor(count / 3), Math.floor(2 * count / 3)];
    return anchors;
  }
  function fitSubpixelSpan(points, start2, end, out, tStart, tEnd) {
    const from = points[start2];
    const to = points[end];
    if (!from || !to || end <= start2) return;
    if (end === start2 + 1 || maxChordError(points, start2, end) <= 0.07) {
      out.push({ op: "L", x: to.x, y: to.y });
      return;
    }
    let cubic = fitCubic2(points, start2, end, tStart, tEnd);
    if ((!cubic || cubic.error > SUBPIXEL_ERROR) && (tStart || tEnd)) {
      const free = fitCubic2(points, start2, end, null, null);
      if (free && (!cubic || free.error < cubic.error)) cubic = free;
    }
    if (cubic && cubic.error <= SUBPIXEL_ERROR && cubic.command.op === "C") {
      out.push({ ...cubic.command, primitive: "cubic" });
      return;
    }
    let split = start2 + Math.floor((end - start2) / 2);
    let best = -1;
    for (let i = start2 + 1; i < end; i++) {
      const point = points[i];
      if (!point) continue;
      const distance = pointSegmentDistance2(point, from, to);
      if (distance > best) {
        best = distance;
        split = i;
      }
    }
    if (split <= start2 || split >= end) {
      out.push({ op: "L", x: to.x, y: to.y });
      return;
    }
    const through = forwardTangent(points, split);
    const back = through ? { x: -through.x, y: -through.y } : null;
    fitSubpixelSpan(points, start2, split, out, tStart, back);
    fitSubpixelSpan(points, split, end, out, through, tEnd);
  }
  function fitOpenChain(points, error, cornerAngle, simplify) {
    const simplified = douglasPeucker(points, simplify);
    if (simplified.length < 2) return [];
    const corners = [0];
    for (let i = 1; i < simplified.length - 1; i++) {
      if (keptCorner(simplified[i - 1], simplified[i], simplified[i + 1], cornerAngle)) corners.push(i);
    }
    corners.push(simplified.length - 1);
    const commands = [];
    for (let i = 0; i < corners.length - 1; i++) fitRange(simplified, corners[i], corners[i + 1], error, commands);
    return commands;
  }
  function fitClosedChain(points, error, cornerAngle, simplify) {
    const simplified = simplifyClosed(points, simplify);
    if (simplified.length < 3) return [];
    const corners = [];
    for (let i = 0; i < simplified.length; i++) {
      const previous = simplified[(i + simplified.length - 1) % simplified.length];
      const next = simplified[(i + 1) % simplified.length];
      if (keptCorner(previous, simplified[i], next, cornerAngle)) corners.push(i);
    }
    const commands = [];
    if (corners.length === 0) {
      const step = Math.max(1, Math.floor(simplified.length / 4));
      const anchors = [];
      for (let i = 0; i < simplified.length; i += step) anchors.push(i);
      if (anchors.length < 3) return fitOpenChain(simplified.concat(simplified[0]), error, Math.PI, simplify);
      for (let i = 0; i < anchors.length; i++) {
        const span = sliceCyclic2(simplified, anchors[i], anchors[(i + 1) % anchors.length]);
        fitRange(span, 0, span.length - 1, error, commands);
      }
      return commands;
    }
    for (let i = 0; i < corners.length; i++) {
      const span = sliceCyclic2(simplified, corners[i], corners[(i + 1) % corners.length]);
      fitRange(span, 0, span.length - 1, error, commands);
    }
    return commands;
  }
  function simplifyClosed(points, epsilon) {
    let first = 0;
    for (let i = 1; i < points.length; i++) {
      if (comparePoint(points[i], points[first]) < 0) first = i;
    }
    let second = 0;
    let best = -1;
    for (let i = 0; i < points.length; i++) {
      if (i === first) continue;
      const distance = distance2(points[i], points[first]);
      if (distance > best) {
        best = distance;
        second = i;
      }
    }
    const a = douglasPeucker(sliceCyclic2(points, first, second), epsilon);
    const b = douglasPeucker(sliceCyclic2(points, second, first), epsilon);
    if (a.length === 0) return b;
    return a.concat(b.slice(1, -1));
  }
  function sliceCyclic2(points, start2, end) {
    const out = [points[start2]];
    if (start2 === end) {
      for (let i = 1; i <= points.length; i++) out.push(points[(start2 + i) % points.length]);
      return out;
    }
    let cursor = start2;
    do {
      cursor = (cursor + 1) % points.length;
      out.push(points[cursor]);
    } while (cursor !== end);
    return out;
  }
  function douglasPeucker(points, epsilon) {
    if (points.length < 3) return points.slice();
    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;
    const stack = [0, points.length - 1];
    while (stack.length > 0) {
      const end = stack.pop();
      const start2 = stack.pop();
      if (start2 === void 0 || end === void 0) break;
      let bestIndex = -1;
      let bestDistance = epsilon;
      let bestKey = Infinity;
      for (let i = start2 + 1; i < end; i++) {
        const point = points[i];
        const from = points[start2];
        const to = points[end];
        if (!point || !from || !to) continue;
        const distance = pointSegmentDistance2(point, from, to);
        const key = point.x * 1e6 + point.y;
        if (distance > bestDistance + 1e-8 || Math.abs(distance - bestDistance) <= 1e-8 && key < bestKey) {
          bestDistance = distance;
          bestIndex = i;
          bestKey = key;
        }
      }
      if (bestIndex >= 0) {
        keep[bestIndex] = 1;
        stack.push(start2, bestIndex, bestIndex, end);
      }
    }
    const out = [];
    for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
    return out;
  }
  function fitRange(points, start2, end, error, out) {
    const from = points[start2];
    const to = points[end];
    if (!from || !to || end <= start2) return;
    if (end === start2 + 1 || maxChordError(points, start2, end) <= error) {
      out.push({ op: "L", x: to.x, y: to.y });
      return;
    }
    const cubic = fitCubic2(points, start2, end);
    if (cubic && cubic.error <= error) {
      out.push(cubic.command);
      return;
    }
    let split = start2 + Math.floor((end - start2) / 2);
    let best = -1;
    for (let i = start2 + 1; i < end; i++) {
      const point = points[i];
      if (!point) continue;
      const distance = pointSegmentDistance2(point, from, to);
      if (distance > best) {
        best = distance;
        split = i;
      }
    }
    if (split <= start2 || split >= end) {
      out.push({ op: "L", x: to.x, y: to.y });
      return;
    }
    fitRange(points, start2, split, error, out);
    fitRange(points, split, end, error, out);
  }
  function fitCubic2(points, start2, end, tStart = null, tEnd = null) {
    const p0 = points[start2];
    const p3 = points[end];
    if (!p0 || !p3) return null;
    const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
    if (chord < 1e-6) return null;
    const t1 = unitOr(tStart, tangent(points, start2, end, false));
    const t2 = unitOr(tEnd, tangent(points, start2, end, true));
    if (!t1 || !t2) return null;
    let length = 0;
    const parameter = [0];
    for (let i = start2 + 1; i <= end; i++) {
      const previous = points[i - 1];
      const point = points[i];
      if (!previous || !point) return null;
      length += Math.hypot(point.x - previous.x, point.y - previous.y);
      parameter.push(length);
    }
    if (length < 1e-6) return null;
    let c11 = 0;
    let c12 = 0;
    let c22 = 0;
    let x1 = 0;
    let x2 = 0;
    const tangentDot = t1.x * t2.x + t1.y * t2.y;
    for (let i = start2; i <= end; i++) {
      const point = points[i];
      if (!point) return null;
      const t = (parameter[i - start2] ?? 0) / length;
      const u = 1 - t;
      const b1 = 3 * u * u * t;
      const b2 = 3 * u * t * t;
      const basisX = p0.x * u * u * (1 + 2 * t) + p3.x * t * t * (3 - 2 * t);
      const basisY = p0.y * u * u * (1 + 2 * t) + p3.y * t * t * (3 - 2 * t);
      const vx = point.x - basisX;
      const vy = point.y - basisY;
      c11 += b1 * b1;
      c22 += b2 * b2;
      c12 += b1 * b2 * tangentDot;
      x1 += b1 * (vx * t1.x + vy * t1.y);
      x2 += b2 * (vx * t2.x + vy * t2.y);
    }
    const determinant2 = c11 * c22 - c12 * c12;
    if (Math.abs(determinant2) < 1e-10) return null;
    const alpha1 = (c22 * x1 - c12 * x2) / determinant2;
    const alpha2 = (c11 * x2 - c12 * x1) / determinant2;
    if (!(alpha1 > 0) || !(alpha2 > 0) || alpha1 > chord * 4 || alpha2 > chord * 4) return null;
    const command = {
      op: "C",
      x1: p0.x + t1.x * alpha1,
      y1: p0.y + t1.y * alpha1,
      x2: p3.x + t2.x * alpha2,
      y2: p3.y + t2.y * alpha2,
      x: p3.x,
      y: p3.y
    };
    let maxError = 0;
    for (let i = start2; i <= end; i++) {
      const point = points[i];
      if (!point) continue;
      const t = (parameter[i - start2] ?? 0) / length;
      const at = cubicAt2(p0, { x: command.x1, y: command.y1 }, { x: command.x2, y: command.y2 }, p3, t);
      maxError = Math.max(maxError, Math.hypot(at.x - point.x, at.y - point.y));
    }
    return { command, error: maxError };
  }
  function unitOr(imposed, fallback) {
    const source = imposed ?? fallback;
    if (!source) return null;
    const length = Math.hypot(source.x, source.y);
    if (length < 1e-8) return fallback;
    return { x: source.x / length, y: source.y / length };
  }
  function loopTangent(points, index) {
    const count = points.length;
    const origin = points[index];
    if (!origin || count < 2) return null;
    let x = 0;
    let y = 0;
    for (let step = 1; step <= 4; step++) {
      const next = points[(index + step) % count];
      const previous = points[(index - step + count * 4) % count];
      const weight = 1 / step;
      if (next) {
        x += (next.x - origin.x) * weight;
        y += (next.y - origin.y) * weight;
      }
      if (previous) {
        x += (origin.x - previous.x) * weight;
        y += (origin.y - previous.y) * weight;
      }
    }
    const length = Math.hypot(x, y);
    if (length < 1e-8) return null;
    return { x: x / length, y: y / length };
  }
  function forwardTangent(points, index) {
    const origin = points[index];
    if (!origin) return null;
    let x = 0;
    let y = 0;
    for (let step = 1; step <= 4; step++) {
      const next = points[index + step];
      const previous = points[index - step];
      const weight = 1 / step;
      if (next) {
        x += (next.x - origin.x) * weight;
        y += (next.y - origin.y) * weight;
      }
      if (previous) {
        x += (origin.x - previous.x) * weight;
        y += (origin.y - previous.y) * weight;
      }
    }
    const length = Math.hypot(x, y);
    if (length < 1e-8) return null;
    return { x: x / length, y: y / length };
  }
  function tangent(points, start2, end, atEnd) {
    const origin = points[atEnd ? end : start2];
    if (!origin) return null;
    const reach = Math.min(4, end - start2);
    let x = 0;
    let y = 0;
    for (let step = 1; step <= reach; step++) {
      const point = points[atEnd ? end - step : start2 + step];
      if (!point) continue;
      const weight = 1 / step;
      x += (point.x - origin.x) * weight;
      y += (point.y - origin.y) * weight;
    }
    const length = Math.hypot(x, y);
    if (length < 1e-8) return null;
    return { x: x / length, y: y / length };
  }
  function cubicAt2(p0, p1, p2, p3, t) {
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    return {
      x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
      y: a * p0.y + b * p1.y + c * p2.y + d * p3.y
    };
  }
  function maxChordError(points, start2, end) {
    const from = points[start2];
    const to = points[end];
    if (!from || !to) return 0;
    let max = 0;
    for (let i = start2 + 1; i < end; i++) {
      const point = points[i];
      if (!point) continue;
      max = Math.max(max, pointSegmentDistance2(point, from, to));
    }
    return max;
  }
  function pointSegmentDistance2(point, from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-8) return Math.hypot(point.x - from.x, point.y - from.y);
    return Math.abs((point.x - from.x) * dy - (point.y - from.y) * dx) / length;
  }
  function keptCorner(previous, current, next, cornerAngle) {
    const turn = Math.abs(turnAngle2(previous, current, next));
    if (turn < cornerAngle) return false;
    const incoming = Math.hypot(current.x - previous.x, current.y - previous.y);
    const outgoing = Math.hypot(next.x - current.x, next.y - current.y);
    if (incoming < 1.35 && outgoing < 1.35) return false;
    if (Math.min(incoming, outgoing) < 0.8 && turn < 1.15) return false;
    return true;
  }
  function turnAngle2(a, b, c) {
    const incoming = Math.atan2(b.y - a.y, b.x - a.x);
    const outgoing = Math.atan2(c.y - b.y, c.x - b.x);
    let delta = outgoing - incoming;
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
  }
  function distance2(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }
  function reverseCommands(commands, start2) {
    let x = start2.x;
    let y = start2.y;
    const segments = [];
    for (const command of commands) {
      segments.push({ fromX: x, fromY: y, command });
      x = command.x;
      y = command.y;
    }
    const reversed = [];
    for (let i = segments.length - 1; i >= 0; i--) {
      const segment = segments[i];
      if (!segment) continue;
      if (segment.command.op === "L") {
        reversed.push({ op: "L", x: segment.fromX, y: segment.fromY, primitive: segment.command.primitive, snap: segment.command.snap });
      } else {
        reversed.push({
          op: "C",
          x1: segment.command.x2,
          y1: segment.command.y2,
          x2: segment.command.x1,
          y2: segment.command.y1,
          x: segment.fromX,
          y: segment.fromY,
          primitive: segment.command.primitive
        });
      }
    }
    return reversed;
  }
  function countLabels2(labels, paletteLength) {
    const counts = new Int32Array(paletteLength);
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i] ?? TRANSPARENT;
      if (label !== TRANSPARENT && label < paletteLength) counts[label] = (counts[label] ?? 0) + 1;
    }
    return counts;
  }
  function shapesToSvg(shapes, width, height) {
    const body = shapes.map((shape) => {
      const data = shape.subpaths.map((subpath) => {
        let path2 = "M" + formatNumber(subpath.start.x) + " " + formatNumber(subpath.start.y);
        for (const command of subpath.commands) {
          if (command.op === "L") path2 += "L" + formatNumber(command.x) + " " + formatNumber(command.y);
          else {
            path2 += "C" + formatNumber(command.x1) + " " + formatNumber(command.y1) + " " + formatNumber(command.x2) + " " + formatNumber(command.y2) + " " + formatNumber(command.x) + " " + formatNumber(command.y);
          }
        }
        return path2 + "Z";
      }).join("");
      return '<path fill="' + rgbHex(shape.color) + '" stroke="' + rgbHex(shape.color) + '" stroke-width="0.4" stroke-linejoin="round" fill-rule="evenodd" d="' + data + '"/>';
    }).join("");
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + " " + height + '" width="' + width + '" height="' + height + '">' + body + "</svg>";
  }
  function formatNumber(value) {
    const rounded = Math.round(value * 100) / 100;
    if (Object.is(rounded, -0) || rounded === 0) return "0";
    return String(rounded);
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
      cleanShapes: getInput("clean-shapes"),
      cleanStrength: getInput("clean-strength"),
      cleanStrengthValue: getOutput("clean-strength-value"),
      cleanText: getInput("clean-text"),
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
      cancelled: false,
      source: null
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
  function readSettings(ui) {
    const preset = ui.preset.value;
    if (!isPresetName(preset)) throw new Error("Preset \u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07");
    const maxColors = Number(ui.colors.value);
    const simplify = Number(ui.smooth.value) / 10;
    const cleanShapes = ui.cleanShapes.checked ? Number(ui.cleanStrength.value) / 100 : 0;
    if (!Number.isInteger(maxColors) || maxColors < 2 || maxColors > 32) throw new Error("\u0E08\u0E33\u0E19\u0E27\u0E19\u0E2A\u0E35\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07");
    if (!Number.isFinite(simplify) || simplify < 0 || simplify > 3) throw new Error("\u0E04\u0E48\u0E32\u0E04\u0E27\u0E32\u0E21\u0E40\u0E23\u0E35\u0E22\u0E1A\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07");
    if (!Number.isFinite(cleanShapes) || cleanShapes < 0 || cleanShapes > 1) throw new Error("\u0E04\u0E27\u0E32\u0E21\u0E41\u0E23\u0E07\u0E02\u0E2D\u0E07\u0E23\u0E39\u0E1B\u0E17\u0E23\u0E07\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07");
    return { preset, maxColors, simplify, cleanShapes, cleanText: ui.cleanText.checked };
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
      ui.cancel.hidden = true;
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
      const segmentation = segmentImage(decoded.data, decoded.width, decoded.height, job.settings.maxColors, { preset: job.settings.preset });
      job.source = segmentation;
      editor.load(segmentation);
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
        const live = readSettings(ui);
        job.settings = { ...job.settings, simplify: live.simplify, cleanShapes: live.cleanShapes, cleanText: live.cleanText };
        message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E40\u0E2A\u0E49\u0E19\u0E08\u0E32\u0E01\u0E2A\u0E35\u0E17\u0E35\u0E48\u0E41\u0E01\u0E49\u2026");
        state = { kind: "tracing", selection, job };
        render();
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (job.cancelled) throw new Error("\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27");
        const source = job.source;
        const decoded = decodePng(fs.readFileSync(job.pngPath));
        const sourcePixels = decoded.width === segmentation.width && decoded.height === segmentation.height ? decoded.data : void 0;
        const traced = traceSegmentation(segmentation, {
          preset: job.settings.preset,
          smooth: job.settings.simplify,
          cleanShapes: job.settings.cleanShapes,
          cleanText: job.settings.cleanText,
          smoothMask: segmentation.smoothMask,
          coverage: source?.coverage,
          partner: source?.partner,
          originalLabels: source?.labels,
          source: sourcePixels
        });
        fs.writeFileSync(job.svgPath, traced.svg, "utf8");
        const svg = traced.svg;
        state = { kind: "preview", selection, job, dataUrl: "data:image/svg+xml;base64," + Buffer.from(svg, "utf8").toString("base64") };
        message("\u0E14\u0E39\u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E41\u0E25\u0E49\u0E27\u0E01\u0E14\u0E43\u0E2A\u0E48\u0E43\u0E19 Illustrator \xB7 \u0E41\u0E1C\u0E19\u0E17\u0E35\u0E48\u0E2A\u0E35 " + editor.colorCount() + " \xB7 \u0E40\u0E27\u0E01\u0E40\u0E15\u0E2D\u0E23\u0E4C " + countSvgFills(svg) + " \u0E2A\u0E35 \xB7 " + traced.pathCount + " \u0E40\u0E2A\u0E49\u0E19 \xB7 " + traced.nodeCount + " \u0E08\u0E38\u0E14");
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
        const settings = "preset=" + job.settings.preset + ";colors=" + job.settings.maxColors + ";simplify=" + job.settings.simplify + ";clean=" + job.settings.cleanShapes + ";cleanText=" + (job.settings.cleanText ? 1 : 0) + ";edited=" + editor.colorCount();
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
      message("\u0E01\u0E33\u0E25\u0E31\u0E07\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01\u2026");
    });
    ui.colors.addEventListener("input", () => {
      ui.colorsValue.value = ui.colors.value;
    });
    ui.smooth.addEventListener("input", () => {
      ui.smoothValue.value = (Number(ui.smooth.value) / 10).toFixed(1);
    });
    const syncClean = () => {
      const on = ui.cleanShapes.checked;
      ui.cleanStrength.disabled = !on;
      ui.cleanText.disabled = !on;
      ui.cleanStrengthValue.value = ui.cleanStrength.value;
    };
    ui.cleanShapes.addEventListener("change", syncClean);
    ui.cleanStrength.addEventListener("input", syncClean);
    syncClean();
    ui.preset.addEventListener("change", () => {
      const profile = presetProfile(ui.preset.value);
      ui.colors.value = String(profile.maxColors);
      ui.colorsValue.value = ui.colors.value;
      ui.smooth.value = String(Math.round(profile.smooth * 10));
      ui.smoothValue.value = profile.smooth.toFixed(1);
    });
    window.addEventListener("beforeunload", () => {
      if (state.kind === "preview" || state.kind === "editing") cleanJob(state.job);
      if (state.kind === "tracing") {
        state.job.cancelled = true;
        cleanJob(state.job);
      }
    });
    cleanStaleJobs();
    render();
    void refresh();
  }
  start();
})();
