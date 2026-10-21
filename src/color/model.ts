import { oklabDistance, rgbToOklab } from "./oklab";

/** Pixel label that is outside the palette (fully transparent). */
export const TRANSPARENT = 65535;

/** Elongated pieces farther than this from their neighbor are text or icon strokes, not speckles. */
const ZAP_STROKE_CONTRAST = 0.28;

export type Rgb = { readonly r: number; readonly g: number; readonly b: number };

export type Segmentation = {
  readonly width: number;
  readonly height: number;
  /** Palette index per pixel, or TRANSPARENT. Length is width * height. */
  readonly labels: Uint16Array;
  readonly palette: readonly Rgb[];
  /** 1 means a solid pixel. Blend pixels are the fraction of `labels[i]`. */
  readonly coverage?: Float32Array;
  /** The other palette index mixed into a blend pixel, or TRANSPARENT. */
  readonly partner?: Uint16Array;
  /** 1 marks a boundary the Smooth tool should fit more strongly. */
  readonly smoothMask?: Uint8Array;
};

/**
 * Zap is allowed only on edge fragments and speckles: a small area, a thin
 * stroke, or a high boundary-to-area ratio, and the piece must touch another
 * color. Compact regions above the speckle size are refused. The fragment cap
 * keeps a huge noisy region from qualifying just because its outline is long.
 */
export type ZapThresholds = {
  /** Area at or below this (in pixels) is a speckle when it touches another color. */
  readonly maxSpeckleArea: number;
  /** Also treat area <= imagePixels * this ratio as a speckle. */
  readonly speckleAreaRatio: number;
  /** Morphological thickness at or below this counts as a thin fragment. */
  readonly maxThinWidth: number;
  /** perimeter / area at or above this counts as an edge fragment. */
  readonly minBoundaryRatio: number;
  /** Thin and high-ratio tests ignore components larger than this. */
  readonly maxFragmentArea: number;
  /** Those tests also allow up to imagePixels * this ratio. */
  readonly fragmentAreaRatio: number;
};

export const defaultZapThresholds: ZapThresholds = {
  maxSpeckleArea: 48,
  speckleAreaRatio: 0.0004,
  maxThinWidth: 1,
  minBoundaryRatio: 1,
  maxFragmentArea: 2000,
  fragmentAreaRatio: 0.08
};

export type EditResult =
  | { readonly ok: true; readonly changed: boolean; readonly indexMap: readonly number[] | null; readonly detail: string }
  | { readonly ok: false; readonly reason: string };

type Snapshot = {
  readonly labels: Uint16Array;
  readonly palette: readonly Rgb[];
  readonly active: number;
  readonly smoothMask: Uint8Array;
};

const HISTORY_LIMIT = 50;

export function rgbHex(color: Rgb): string {
  const channel = (value: number) => value.toString(16).padStart(2, "0");
  return "#" + channel(color.r) + channel(color.g) + channel(color.b);
}

export function colorDistance(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function sameRgb(a: Rgb, b: Rgb): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

function clonePalette(palette: readonly Rgb[]): Rgb[] {
  return palette.map((color) => ({ r: color.r, g: color.g, b: color.b }));
}

export class ColorDocument {
  readonly width: number;
  readonly height: number;
  labels: Uint16Array;
  palette: Rgb[];
  active: number;
  smoothMask: Uint8Array;
  thresholds: ZapThresholds;
  private readonly original: Snapshot;
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];

  private constructor(segmentation: Segmentation, thresholds: ZapThresholds) {
    this.width = segmentation.width;
    this.height = segmentation.height;
    this.labels = segmentation.labels.slice();
    this.palette = clonePalette(segmentation.palette);
    this.smoothMask = new Uint8Array(segmentation.labels.length);
    this.active = this.palette.length > 0 ? largestIndex(this.labels, this.palette.length) : -1;
    this.thresholds = { ...thresholds };
    this.original = this.capture();
  }

  static fromSegmentation(segmentation: Segmentation, thresholds: ZapThresholds = defaultZapThresholds): ColorDocument {
    if (segmentation.labels.length !== segmentation.width * segmentation.height) {
      throw new Error("ขนาด label map ไม่ตรงกับภาพ");
    }
    return new ColorDocument(segmentation, thresholds);
  }

  colorCount(): number {
    return this.palette.length;
  }

  counts(): number[] {
    const totals = new Array<number>(this.palette.length).fill(0);
    for (let i = 0; i < this.labels.length; i++) {
      const label = this.labels[i] ?? TRANSPARENT;
      if (label !== TRANSPARENT && label < totals.length) totals[label] = (totals[label] ?? 0) + 1;
    }
    return totals;
  }

  /** True when labels or palette differ from the segmentation this document was opened with. */
  dirty(): boolean {
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

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  segmentation(): Segmentation {
    let smoothMask: Uint8Array | undefined;
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

  setThresholds(partial: Partial<ZapThresholds>): void {
    this.thresholds = { ...this.thresholds, ...partial };
  }

  setActive(index: number): void {
    if (index >= 0 && index < this.palette.length) this.active = index;
  }

  undo(): boolean {
    const previous = this.past.pop();
    if (!previous) return false;
    this.future.push(this.capture());
    this.restore(previous);
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.capture());
    this.restore(next);
    return true;
  }

  revert(): boolean {
    if (!this.dirty()) return false;
    this.pushHistory();
    this.restore(this.original);
    return true;
  }

  zap(x: number, y: number): EditResult {
    if (!this.inBounds(x, y)) return { ok: false, reason: "คลิกนอกภาพ" };
    const index = y * this.width + x;
    const label = this.labels[index] ?? TRANSPARENT;
    if (label === TRANSPARENT) return { ok: false, reason: "จุดนี้โปร่งใส ไม่มีเศษสีให้ Zap" };
    if (!this.palette[label]) return { ok: false, reason: "ไม่พบสีของจุดนี้" };

    const found = componentsOf(this.labels, this.width, this.height, label);
    const clicked = found.components[found.owner[index] ?? -1];
    if (!clicked) return { ok: false, reason: "ไม่พบชิ้นสีตรงนี้" };

    const areaLimit = areaCap(this.thresholds.maxSpeckleArea, this.thresholds.speckleAreaRatio, this.labels.length);
    const fragmentCap = areaCap(this.thresholds.maxFragmentArea, this.thresholds.fragmentAreaRatio, this.labels.length);
    const clickedStats = measure(clicked, this.width, this.height, this.thresholds, areaLimit, fragmentCap);
    if (!clickedStats.zappable) return { ok: false, reason: refusal(clickedStats, this.thresholds, areaLimit) };
    if (strokeProtected(clicked, label, this.palette, this.width, this.height)) {
      return { ok: false, reason: "เส้นนี้ตัดกับสีข้างเคียงชัด Zap จึงไม่ลบ เพื่อไม่ให้ตัวอักษรหรือจุดที่คมชัดหาย" };
    }

    const plan: { pixels: number[]; target: number }[] = [];
    for (const component of found.components) {
      const stats = component === clicked ? clickedStats : measure(component, this.width, this.height, this.thresholds, areaLimit, fragmentCap);
      if (!stats.zappable) continue;
      if (strokeProtected(component, label, this.palette, this.width, this.height)) continue;
      const target = bestNeighbor(component, label, this.palette);
      if (target === null) continue;
      plan.push({ pixels: component.pixels, target });
    }
    if (!plan.some((item) => item.pixels === clicked.pixels)) {
      return { ok: false, reason: "เศษนี้ไม่ติดกับสีอื่น จึงยังไม่รวม" };
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
      detail: "Zap รวม " + plan.length + " ชิ้นเข้ากับสีข้างเคียง · " + before + " → " + this.colorCount() + " สี"
    };
  }

  fill(x: number, y: number): EditResult {
    if (!this.inBounds(x, y)) return { ok: false, reason: "คลิกนอกภาพ" };
    if (this.active < 0) return { ok: false, reason: "ยังไม่มีสีที่เลือก" };
    const source = this.labels[y * this.width + x] ?? TRANSPARENT;
    const target = this.active;
    if (source === target) return { ok: true, changed: false, indexMap: null, detail: "" };
    this.pushHistory();
    const stack = [y * this.width + x];
    const seen = new Uint8Array(this.labels.length);
    seen[y * this.width + x] = 1;
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
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
    return { ok: true, changed: true, indexMap, detail: "เทสีแล้ว · " + this.colorCount() + " สี" };
  }

  /** Paint one pixel. The first changed pixel of a stroke opens a single undo step. */
  pencil(x: number, y: number, stroke: { pushed: boolean }): EditResult {
    if (!this.inBounds(x, y)) return { ok: false, reason: "คลิกนอกภาพ" };
    if (this.active < 0) return { ok: false, reason: "ยังไม่มีสีที่เลือก" };
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
  smoothAt(x: number, y: number, stroke: { pushed: boolean } | null = null): EditResult {
    if (!this.inBounds(x, y)) return { ok: false, reason: "คลิกนอกภาพ" };
    const segment = boundarySegment(this.labels, this.width, this.height, x, y);
    if (segment.length === 0) return { ok: false, reason: "คลิกบนรอยต่อของสองสี เพื่อเกลาช่วงนั้น" };
    const fresh = segment.filter((pixel) => (this.smoothMask[pixel] ?? 0) === 0);
    if (fresh.length === 0) return { ok: true, changed: false, indexMap: null, detail: "" };
    if (!stroke?.pushed) this.pushHistory();
    if (stroke) stroke.pushed = true;
    for (const pixel of fresh) this.smoothMask[pixel] = 1;
    return { ok: true, changed: true, indexMap: null, detail: "เกลาขอบ " + segment.length + " พิกเซล" };
  }

  smoothLasso(x0: number, y0: number, x1: number, y1: number): EditResult {
    const left = Math.max(0, Math.min(x0, x1));
    const right = Math.min(this.width - 1, Math.max(x0, x1));
    const top = Math.max(0, Math.min(y0, y1));
    const bottom = Math.min(this.height - 1, Math.max(y0, y1));
    const seen = new Uint8Array(this.labels.length);
    const fresh: number[] = [];
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
    if (fresh.length === 0) return { ok: true, changed: false, indexMap: null, detail: "ในกรอบนี้ไม่มีขอบให้เกลา" };
    this.pushHistory();
    for (const pixel of fresh) this.smoothMask[pixel] = 1;
    return { ok: true, changed: true, indexMap: null, detail: "เกลาขอบในกรอบ " + fresh.length + " พิกเซล" };
  }

  /** Close a pencil stroke and drop a palette entry that no longer has pixels. */
  endPencil(stroke: { pushed: boolean }): EditResult {
    if (!stroke.pushed) return { ok: true, changed: false, indexMap: null, detail: "" };
    const indexMap = this.compact();
    return { ok: true, changed: true, indexMap, detail: "ระบายแล้ว · " + this.colorCount() + " สี" };
  }

  /**
   * Recolor every listed color into representative and drop the others.
   * The representative is the color the user chose to keep — never inferred.
   */
  collapse(members: readonly number[], representative: number): EditResult {
    if (representative < 0 || representative >= this.palette.length) return { ok: false, reason: "ยังไม่ได้เลือกสีที่จะเก็บ" };
    const sources = members.filter((index) => index !== representative && index >= 0 && index < this.palette.length);
    if (sources.length === 0) return { ok: true, changed: false, indexMap: null, detail: "" };
    const kept = this.palette[representative];
    if (!kept) return { ok: false, reason: "ไม่พบสีที่จะเก็บ" };
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
      detail: "รวมสีแล้ว " + before + " → " + this.colorCount() + " · เก็บ " + rgbHex(kept)
    };
  }

  merge(source: number, target: number): EditResult {
    if (source === target) return { ok: true, changed: false, indexMap: null, detail: "" };
    return this.collapse([source, target], target);
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  private capture(): Snapshot {
    return { labels: this.labels.slice(), palette: clonePalette(this.palette), active: this.active, smoothMask: this.smoothMask.slice() };
  }

  private restore(snapshot: Snapshot): void {
    this.labels = snapshot.labels.slice();
    this.palette = clonePalette(snapshot.palette);
    this.active = snapshot.active;
    this.smoothMask = snapshot.smoothMask.slice();
  }

  private pushHistory(): void {
    this.past.push(this.capture());
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
  }

  /** Drop unused colors. Returns oldIndex -> newIndex (-1 if removed), or null if every color stayed. */
  private compact(): number[] | null {
    const used = new Array<boolean>(this.palette.length).fill(false);
    for (let i = 0; i < this.labels.length; i++) {
      const label = this.labels[i] ?? TRANSPARENT;
      if (label !== TRANSPARENT && label < used.length) used[label] = true;
    }
    if (used.every((value) => value)) return null;
    const map = new Array<number>(this.palette.length).fill(-1);
    const next: Rgb[] = [];
    for (let i = 0; i < this.palette.length; i++) {
      if (!used[i]) continue;
      map[i] = next.length;
      const color = this.palette[i];
      if (color) next.push(color);
    }
    const relabeled = new Uint16Array(this.labels.length);
    for (let i = 0; i < this.labels.length; i++) {
      const label = this.labels[i] ?? TRANSPARENT;
      relabeled[i] = label === TRANSPARENT ? TRANSPARENT : (map[label] ?? TRANSPARENT);
    }
    this.labels = relabeled;
    this.palette = next;
    if (this.active >= 0) this.active = map[this.active] ?? (next.length > 0 ? 0 : -1);
    return map;
  }
}

type Component = {
  readonly pixels: number[];
  readonly area: number;
  readonly perimeter: number;
  readonly adjacency: Map<number, number>;
};

type ComponentSet = {
  readonly components: Component[];
  readonly owner: Int32Array;
};

function componentsOf(labels: Uint16Array, width: number, height: number, label: number): ComponentSet {
  const owner = new Int32Array(labels.length);
  owner.fill(-1);
  const components: Component[] = [];
  const stack: number[] = [];
  for (let start = 0; start < labels.length; start++) {
    if ((labels[start] ?? TRANSPARENT) !== label || owner[start] !== -1) continue;
    const pixels: number[] = [];
    const adjacency = new Map<number, number>();
    let perimeter = 0;
    const id = components.length;
    stack.push(start);
    owner[start] = id;
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      pixels.push(current);
      const x = current % width;
      const y = (current - x) / width;
      const neighbors = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1]
      ] as const;
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

function areaCap(absolute: number, ratio: number, pixels: number): number {
  return Math.max(absolute, Math.round(pixels * ratio));
}

type Measurement = {
  readonly area: number;
  readonly ratio: number;
  readonly thickness: number;
  readonly zappable: boolean;
};

function measure(
  component: Component,
  width: number,
  height: number,
  thresholds: ZapThresholds,
  areaLimit: number,
  fragmentCap: number
): Measurement {
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

/** Erosion steps until the component disappears, or limit + 1 if it is thicker than that. */
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

function isBoundary(labels: Uint16Array, width: number, height: number, x: number, y: number): boolean {
  const label = labels[y * width + x] ?? TRANSPARENT;
  if (label === TRANSPARENT) return false;
  const neighbors = [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1]
  ] as const;
  for (const [nx, ny] of neighbors) {
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) return true;
    if ((labels[ny * width + nx] ?? TRANSPARENT) !== label) return true;
  }
  return false;
}

function nearestBoundary(labels: Uint16Array, width: number, height: number, x: number, y: number): { x: number; y: number } | null {
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

/** Pixels of one color that touch a single neighboring color, the shared segment under the click. */
function boundarySegment(labels: Uint16Array, width: number, height: number, x: number, y: number): number[] {
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
  ] as const;
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
  const pixels: number[] = [];
  const seen = new Uint8Array(labels.length);
  const stack = [index];
  seen[index] = 1;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
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
        // explored below once we know this pixel belongs on the segment
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

/**
 * Neighbor with the best mix of shared edge count and palette distance.
 * Higher adjacency and a closer color both raise the score.
 */
function strokeProtected(component: Component, ownLabel: number, palette: readonly Rgb[], width: number, height: number): boolean {
  if (!componentElongated(component, width, height)) return false;
  const target = bestNeighbor(component, ownLabel, palette);
  if (target === null) return false;
  const own = palette[ownLabel];
  const other = palette[target];
  if (!own || !other) return false;
  return oklabDistance(rgbToOklab(own.r, own.g, own.b), rgbToOklab(other.r, other.g, other.b)) >= ZAP_STROKE_CONTRAST;
}

function componentElongated(component: Component, width: number, height: number): boolean {
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

function bestNeighbor(component: Component, ownLabel: number, palette: readonly Rgb[]): number | null {
  const own = palette[ownLabel];
  if (!own) return null;
  let best: { label: number; adjacency: number; distance: number; score: number } | null = null;
  for (const [label, adjacency] of component.adjacency) {
    if (label === TRANSPARENT) continue;
    const other = palette[label];
    if (!other) continue;
    const distance = colorDistance(own, other);
    const score = adjacency / (1 + distance / 32);
    const better =
      !best ||
      score > best.score + 1e-9 ||
      (Math.abs(score - best.score) <= 1e-9 &&
        (adjacency > best.adjacency || (adjacency === best.adjacency && (distance < best.distance || (distance === best.distance && label < best.label)))));
    if (better) best = { label, adjacency, distance, score };
  }
  return best ? best.label : null;
}

function refusal(stats: Measurement, thresholds: ZapThresholds, areaLimit: number): string {
  const thick = stats.thickness < 0 ? "ใหญ่กว่าเพดานเศษสี" : "หนา " + stats.thickness + "px";
  return (
    "พื้นที่นี้ " +
    stats.area +
    " พิกเซล อัตราส่วนขอบ " +
    stats.ratio.toFixed(2) +
    " " +
    thick +
    " — เป็นสีต่อเนื่อง Zap ใช้กับจุดเล็ก (≤ " +
    areaLimit +
    " px) เส้นบาง (≤ " +
    thresholds.maxThinWidth +
    " px) หรือขอบแตก (อัตราส่วน ≥ " +
    thresholds.minBoundaryRatio +
    ") เท่านั้น"
  );
}

function largestIndex(labels: Uint16Array, paletteLength: number): number {
  const totals = new Array<number>(paletteLength).fill(0);
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
