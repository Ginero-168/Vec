import { labDistance2, oklabToRgb, rgbToOklab, type Lab, type RGB } from "./color.ts";

export type FlatPlate = {
  readonly rgba: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly palette: readonly string[];
  readonly originX: number;
  readonly originY: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly borderColor: string | null;
  /** The source crop has see-through pixels: its outline comes from the transparent cut, not from a backdrop. */
  readonly cutOut: boolean;
};

export type SubjectBox = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

const UP = 8;
const CORE_TAU = 0.035;
const REGION_TOLERANCE = 0.06;
const COLOR_FLOOR = 0.035;
const OWN_COLOR = 0.05;
const DILATE_RADIUS = 3;
const SPECK_SOURCE = 1.44;
const SMOOTH_SOURCE = 0.6;
const K_MAX = 16;

/**
 * Raster hook immediately before palette extraction.
 * The default returns the same pixels. Another module can denoise or reshape
 * the raster here; flat-region cores and the palette are measured on the result.
 */
export type RasterPreprocess = (rgba: Uint8Array, width: number, height: number) => Uint8Array;

export function identityRaster(rgba: Uint8Array, _width: number, _height: number): Uint8Array {
  return rgba;
}

/** One plate per separated logo. A single subject keeps the whole frame so its backdrop stays in the palette. */
export function flatPlates(
  rgba: Uint8Array,
  width: number,
  height: number,
  maxColors: number,
  preprocess: RasterPreprocess = identityRaster,
  onProgress?: (fraction: number) => void
): FlatPlate[] {
  const boxes = subjectBoxes(rgba, width, height, (fraction) => onProgress?.(fraction * 0.04));
  onProgress?.(0.04);
  return boxes.map((box, index) => plateFor(rgba, width, height, box, maxColors, preprocess, (fraction) => onProgress?.(0.04 + ((index + fraction) / boxes.length) * 0.96)));
}

export async function flatPlatesAsync(
  rgba: Uint8Array,
  width: number,
  height: number,
  maxColors: number,
  preprocess: RasterPreprocess = identityRaster,
  onProgress?: (fraction: number) => void,
  shouldCancel?: () => boolean
): Promise<FlatPlate[]> {
  if (shouldCancel?.() === true) throw new Error("ยกเลิกแล้ว");
  const context = createCooperativeContext(shouldCancel);
  onProgress?.(0);
  const boxes = await subjectBoxesAsync(rgba, width, height, context, (fraction) => onProgress?.(fraction * 0.04));
  onProgress?.(0.04);
  const plates: FlatPlate[] = [];
  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index];
    if (box === undefined) continue;
    const base = index / boxes.length;
    const span = 1 / boxes.length;
    const cropW = box.width;
    const cropH = box.height;
    const crop = new Uint8Array(cropW * cropH * 4);
    for (let y = 0; y < cropH; y += 1) {
      const from = ((box.y + y) * width + box.x) * 4;
      crop.set(rgba.subarray(from, from + cropW * 4), y * cropW * 4);
      if (y % 8 === 0) {
        onProgress?.(0.04 + (base + span * 0.05 * (y + 1) / cropH) * 0.96);
        await cooperate(context);
      }
    }
    const painted = await labelImageAsync(crop, cropW, cropH, maxColors, preprocess, (fraction) => {
      onProgress?.(0.04 + (base + span * (0.05 + fraction * 0.95)) * 0.96);
    }, context);
    plates.push({
      rgba: painted.rgba,
      width: painted.width,
      height: painted.height,
      scale: UP,
      palette: painted.palette,
      originX: box.x,
      originY: box.y,
      sourceWidth: cropW,
      sourceHeight: cropH,
      borderColor: cornerColor(crop, cropW, cropH),
      cutOut: hasClearPixel(crop)
    });
  }
  onProgress?.(1);
  return plates;
}

type CooperativeContext = { lastYield: number; readonly shouldCancel?: () => boolean };

function createCooperativeContext(shouldCancel?: () => boolean): CooperativeContext {
  return { lastYield: Date.now(), ...(shouldCancel === undefined ? {} : { shouldCancel }) };
}

async function cooperate(context: CooperativeContext): Promise<void> {
  if (Date.now() - context.lastYield < 20) return;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  context.lastYield = Date.now();
  if (context.shouldCancel?.() === true) throw new Error("ยกเลิกแล้ว");
}

export function subjectBoxes(rgba: Uint8Array, width: number, height: number, onProgress?: (fraction: number) => void): SubjectBox[] {
  const found = enclosedBoxes(rgba, width, height, onProgress);
  if (found.length <= 1) return [{ x: 0, y: 0, width, height }];
  return found;
}

async function subjectBoxesAsync(rgba: Uint8Array, width: number, height: number, context: CooperativeContext, onProgress: (fraction: number) => void): Promise<SubjectBox[]> {
  const found = await enclosedBoxesAsync(rgba, width, height, context, onProgress);
  if (found.length <= 1) return [{ x: 0, y: 0, width, height }];
  return found;
}

function plateFor(
  rgba: Uint8Array,
  width: number,
  height: number,
  box: SubjectBox,
  maxColors: number,
  preprocess: RasterPreprocess,
  onProgress?: (fraction: number) => void
): FlatPlate {
  const cropW = box.width;
  const cropH = box.height;
  const crop = new Uint8Array(cropW * cropH * 4);
  for (let y = 0; y < cropH; y += 1) {
    const from = ((box.y + y) * width + box.x) * 4;
    crop.set(rgba.subarray(from, from + cropW * 4), y * cropW * 4);
  }
  const painted = labelImage(crop, cropW, cropH, maxColors, preprocess, onProgress);
  return {
    rgba: painted.rgba,
    width: painted.width,
    height: painted.height,
    scale: UP,
    palette: painted.palette,
    originX: box.x,
    originY: box.y,
    sourceWidth: cropW,
    sourceHeight: cropH,
    borderColor: cornerColor(crop, cropW, cropH),
    cutOut: hasClearPixel(crop)
  };
}

/** Whether any pixel is (almost) fully transparent, i.e. the image is a cut-out rather than art on a backdrop. */
export function hasClearPixel(rgba: Uint8Array): boolean {
  for (let offset = 3; offset < rgba.length; offset += 4) if ((rgba[offset] ?? 0) <= CLEAR_OPACITY) return true;
  return false;
}

export function cornerColor(rgba: Uint8Array, width: number, height: number): string | null {
  const points = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1]
  ];
  const opaque: RGB[] = [];
  for (const point of points) {
    const x = point[0] ?? 0;
    const y = point[1] ?? 0;
    const offset = (y * width + x) * 4;
    // A transparent corner means the backdrop is already transparent; an opaque corner then belongs to the subject.
    if ((rgba[offset + 3] ?? 0) < 250) return null;
    opaque.push({ r: rgba[offset] ?? 0, g: rgba[offset + 1] ?? 0, b: rgba[offset + 2] ?? 0 });
  }
  if (opaque.length === 0) return null;
  const mean = {
    r: opaque.reduce((sum, color) => sum + color.r, 0) / opaque.length,
    g: opaque.reduce((sum, color) => sum + color.g, 0) / opaque.length,
    b: opaque.reduce((sum, color) => sum + color.b, 0) / opaque.length
  };
  for (const color of opaque) {
    if (Math.abs(color.r - mean.r) > 18 || Math.abs(color.g - mean.g) > 18 || Math.abs(color.b - mean.b) > 18) return null;
  }
  return hex(Math.round(mean.r), Math.round(mean.g), Math.round(mean.b));
}

type Painted = { readonly rgba: Uint8Array; readonly width: number; readonly height: number; readonly palette: readonly string[] };

/** Sub-pixel flat label map. `maxColors` <= 0 picks the smallest K that keeps every flat region. */
export function labelImage(
  rgba: Uint8Array,
  width: number,
  height: number,
  maxColors: number,
  preprocess: RasterPreprocess = identityRaster,
  onProgress?: (fraction: number) => void
): Painted {
  const prepared = preprocess(rgba, width, height);
  const source = prepared.length === rgba.length ? prepared : rgba;
  const count = width * height;
  const lab = new Float64Array(count * 3);
  const linear = new Float64Array(count * 3);
  const alpha = new Uint8Array(count);
  const opacity = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    const color = { r: source[offset] ?? 0, g: source[offset + 1] ?? 0, b: source[offset + 2] ?? 0 };
    opacity[index] = source[offset + 3] ?? 0;
    alpha[index] = (opacity[index] ?? 0) >= 128 ? 255 : 0;
    const converted = rgbToOklab(color);
    lab[index * 3] = converted.L;
    lab[index * 3 + 1] = converted.a;
    lab[index * 3 + 2] = converted.b;
    linear[index * 3] = srgbToLinear(color.r);
    linear[index * 3 + 1] = srgbToLinear(color.g);
    linear[index * 3 + 2] = srgbToLinear(color.b);
    if (index % Math.max(1, width * 2) === 0) onProgress?.(0.04 * index / count);
  }
  let core = coreMask(lab, alpha, width, height, CORE_TAU, (fraction) => onProgress?.(0.04 + fraction * 0.1));
  if (countOf(core) < 8) core = coreMask(lab, alpha, width, height, 0.08, (fraction) => onProgress?.(0.14 + fraction * 0.1));
  const userK = maxColors > 0 ? Math.min(K_MAX, Math.max(2, Math.round(maxColors))) : 0;
  const centers = recoverThinColors(lab, alpha, core, width, height, buildPalette(lab, core, width, height, userK, (fraction) => onProgress?.(0.24 + fraction * 0.08)));
  const labels = assignLabels(linear, lab, core, alpha, opacity, width, height, centers, (fraction) => onProgress?.(0.32 + fraction * 0.54));
  const colors = fillColors(source, alpha, core, labels, width, height, centers, (fraction) => onProgress?.(0.86 + fraction * 0.02));
  const painted = paintLabels(labels, colors, width * UP, height * UP, (fraction) => onProgress?.(0.88 + fraction * 0.12));
  onProgress?.(1);
  return painted;
}

async function labelImageAsync(
  rgba: Uint8Array,
  width: number,
  height: number,
  maxColors: number,
  preprocess: RasterPreprocess,
  onProgress: (fraction: number) => void,
  context: CooperativeContext
): Promise<Painted> {
  const prepared = preprocess(rgba, width, height);
  const source = prepared.length === rgba.length ? prepared : rgba;
  const count = width * height;
  const lab = new Float64Array(count * 3);
  const linear = new Float64Array(count * 3);
  const alpha = new Uint8Array(count);
  const opacity = new Uint8Array(count);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const offset = index * 4;
      const color = { r: source[offset] ?? 0, g: source[offset + 1] ?? 0, b: source[offset + 2] ?? 0 };
      opacity[index] = source[offset + 3] ?? 0;
      alpha[index] = (opacity[index] ?? 0) >= 128 ? 255 : 0;
      const converted = rgbToOklab(color);
      lab[index * 3] = converted.L;
      lab[index * 3 + 1] = converted.a;
      lab[index * 3 + 2] = converted.b;
      linear[index * 3] = srgbToLinear(color.r);
      linear[index * 3 + 1] = srgbToLinear(color.g);
      linear[index * 3 + 2] = srgbToLinear(color.b);
    }
    onProgress(0.04 * (y + 1) / height);
    await cooperate(context);
  }
  let core = await coreMaskAsync(lab, alpha, width, height, CORE_TAU, context);
  if (countOf(core) < 8) core = await coreMaskAsync(lab, alpha, width, height, 0.08, context);
  onProgress(0.14);
  const userK = maxColors > 0 ? Math.min(K_MAX, Math.max(2, Math.round(maxColors))) : 0;
  const centers = recoverThinColors(lab, alpha, core, width, height, buildPalette(lab, core, width, height, userK));
  onProgress(0.26);
  const labels = await assignLabelsAsync(linear, lab, core, alpha, opacity, width, height, centers, context, (fraction) => onProgress(0.26 + fraction * 0.64));
  const colors = fillColors(rgba, alpha, core, labels, width, height, centers);
  onProgress(0.94);
  const painted = await paintLabelsAsync(labels, colors, width * UP, height * UP, context, (fraction) => onProgress(0.94 + fraction * 0.06));
  onProgress(1);
  return painted;
}

async function coreMaskAsync(lab: Float64Array, alpha: Uint8Array, width: number, height: number, tau: number, context: CooperativeContext): Promise<Uint8Array> {
  const core = new Uint8Array(width * height);
  const limit = tau * tau;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (alpha[index] === 0) continue;
      const color = readLab(lab, index);
      let worst = 0;
      let flat = true;
      for (let dy = -1; dy <= 1 && flat; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = Math.min(width - 1, Math.max(0, x + dx));
          const ny = Math.min(height - 1, Math.max(0, y + dy));
          const next = ny * width + nx;
          if (alpha[next] === 0) {
            flat = false;
            break;
          }
          worst = Math.max(worst, labDistance2(color, readLab(lab, next)));
          if (worst >= limit) flat = false;
        }
      }
      if (flat && worst < limit) core[index] = 1;
    }
    await cooperate(context);
  }
  return core;
}

async function assignLabelsAsync(
  linear: Float64Array,
  lab: Float64Array,
  core: Uint8Array,
  alpha: Uint8Array,
  opacity: Uint8Array,
  width: number,
  height: number,
  centers: Lab[],
  context: CooperativeContext,
  onProgress: (fraction: number) => void
): Promise<Uint8Array> {
  const count = width * height;
  const kCount = centers.length;
  const coreLabel = new Int16Array(count);
  coreLabel.fill(-1);
  for (let index = 0; index < count; index += 1) {
    if (core[index] === 1) coreLabel[index] = nearestLab(readLab(lab, index), centers);
    if (index % 8192 === 0) await cooperate(context);
  }
  const allow = new Uint16Array(count);
  const disk = diskOffsets(DILATE_RADIUS);
  for (let index = 0; index < count; index += 1) {
    const label = coreLabel[index] ?? -1;
    if (label >= 0) {
      const x = index % width;
      const y = (index - x) / width;
      for (const offset of disk) {
        const nx = x + offset.x;
        const ny = y + offset.y;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const at = ny * width + nx;
        allow[at] = (allow[at] ?? 0) | (1 << label);
      }
    }
    if (index % 4096 === 0) await cooperate(context);
  }
  const square = squareOffsets(1);
  for (let index = 0; index < count; index += 1) {
    if (alpha[index] !== 0) {
      let near = 0;
      const color = readLab(lab, index);
      for (let label = 0; label < kCount; label += 1) {
        const center = centers[label];
        if (center === undefined) continue;
        if (Math.sqrt(labDistance2(color, center)) < OWN_COLOR) near |= 1 << label;
      }
      if (near !== 0) {
        const x = index % width;
        const y = (index - x) / width;
        for (const offset of square) {
          const nx = x + offset.x;
          const ny = y + offset.y;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const at = ny * width + nx;
          allow[at] = (allow[at] ?? 0) | near;
        }
      }
    }
    if (index % 4096 === 0) await cooperate(context);
  }
  const nearestCore = await nearestCoreLabelAsync(coreLabel, width, height, context);
  for (let index = 0; index < count; index += 1) {
    if ((allow[index] ?? 0) === 0) {
      const label = nearestCore[index] ?? -1;
      if (label >= 0) allow[index] = 1 << label;
    }
    if (index % 8192 === 0) await cooperate(context);
  }
  onProgress(0.18);
  const upW = width * UP;
  const upH = height * UP;
  const labels = new Uint8Array(upW * upH);
  labels.fill(255);
  const tile = 48;
  for (let y0 = 0; y0 < height; y0 += tile) {
    const y1 = Math.min(height, y0 + tile);
    for (let y = y0; y < y1; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (alpha[y * width + x] === 0) continue;
        const mask = allow[y * width + x] ?? 0;
        const bits = bitList(mask, kCount);
        for (let oy = 0; oy < UP; oy += 1) {
          for (let ox = 0; ox < UP; ox += 1) {
            const ux = x * UP + ox;
            const uy = y * UP + oy;
            const at = uy * upW + ux;
            if (bits.length === 0) continue;
            if (bits.length === 1) {
              labels[at] = bits[0] ?? 0;
              continue;
            }
            const sample = bicubicLab(linear, width, height, (ux + 0.5) / UP - 0.5, (uy + 0.5) / UP - 0.5);
            labels[at] = explain(sample, bits, centers);
          }
        }
      }
      onProgress(0.18 + 0.25 * (y + 1) / height);
      await cooperate(context);
    }
  }
  await cleanLabelsAsync(labels, upW, upH, kCount, Math.floor(SPECK_SOURCE * UP * UP), context, (fraction) => onProgress(0.43 + fraction * 0.2));
  await smoothLabelsAsync(labels, upW, upH, kCount, SMOOTH_SOURCE * UP, context, (fraction) => onProgress(0.63 + fraction * 0.28));
  cutTransparent(labels, opacity, width, height);
  onProgress(1);
  return labels;
}

async function nearestCoreLabelAsync(coreLabel: Int16Array, width: number, height: number, context: CooperativeContext): Promise<Int16Array> {
  const nearest = new Int16Array(coreLabel.length);
  nearest.fill(-1);
  const queue: number[] = [];
  for (let index = 0; index < coreLabel.length; index += 1) {
    const label = coreLabel[index] ?? -1;
    if (label < 0) continue;
    nearest[index] = label;
    queue.push(index);
    if (index % 8192 === 0) await cooperate(context);
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor] ?? 0;
    const label = nearest[index] ?? -1;
    const x = index % width;
    const y = (index - x) / width;
    const steps = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    for (const step of steps) {
      const nx = step[0] ?? 0;
      const ny = step[1] ?? 0;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const at = ny * width + nx;
      if ((nearest[at] ?? -1) >= 0) continue;
      nearest[at] = label;
      queue.push(at);
    }
    if (cursor % 4096 === 0) await cooperate(context);
  }
  return nearest;
}

async function cleanLabelsAsync(labels: Uint8Array, width: number, height: number, kCount: number, minArea: number, context: CooperativeContext, onProgress: (fraction: number) => void): Promise<void> {
  for (let pass = 0; pass < 2; pass += 1) {
    for (let label = 0; label < kCount; label += 1) {
      const mask = new Uint8Array(labels.length);
      for (let index = 0; index < labels.length; index += 1) {
        if (labels[index] === label) mask[index] = 1;
        if (index % 16384 === 0) await cooperate(context);
      }
      const labeled = await componentsAsync(mask, width, height, context);
      const small = new Uint8Array(labels.length);
      let any = false;
      for (let index = 0; index < labels.length; index += 1) {
        const id = labeled.ids[index] ?? 0;
        if (id > 0 && (labeled.sizes[id] ?? 0) < minArea) {
          small[index] = 1;
          any = true;
        }
        if (index % 16384 === 0) await cooperate(context);
      }
      if (any) {
        const replacement = await nearestOutsideAsync(labels, small, width, height, context);
        for (let index = 0; index < labels.length; index += 1) {
          if (small[index] === 1) labels[index] = replacement[index] ?? label;
          if (index % 16384 === 0) await cooperate(context);
        }
      }
      onProgress((pass * kCount + label + 1) / (2 * Math.max(1, kCount)));
    }
  }
}

async function componentsAsync(mask: Uint8Array, width: number, height: number, context: CooperativeContext): Promise<{ readonly ids: Int32Array; readonly sizes: Int32Array; readonly count: number }> {
  const ids = new Int32Array(mask.length);
  const sizes: number[] = [0];
  const stack: number[] = [];
  let visits = 0;
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] !== 1 || ids[start] !== 0) continue;
    const id = sizes.length;
    sizes.push(0);
    stack.push(start);
    ids[start] = id;
    while (stack.length > 0) {
      const index = stack.pop() ?? 0;
      sizes[id] = (sizes[id] ?? 0) + 1;
      const x = index % width;
      const y = (index - x) / width;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (mask[next] !== 1 || ids[next] !== 0) continue;
          ids[next] = id;
          stack.push(next);
        }
      }
      visits += 1;
      if (visits % 4096 === 0) await cooperate(context);
    }
    if (start % 16384 === 0) await cooperate(context);
  }
  return { ids, sizes: Int32Array.from(sizes), count: sizes.length - 1 };
}

async function nearestOutsideAsync(labels: Uint8Array, small: Uint8Array, width: number, height: number, context: CooperativeContext): Promise<Uint8Array> {
  const nearest = new Uint8Array(labels.length);
  const seen = new Uint8Array(labels.length);
  const queue: number[] = [];
  for (let index = 0; index < small.length; index += 1) {
    if (small[index] === 1) continue;
    seen[index] = 1;
    nearest[index] = labels[index] ?? 0;
    queue.push(index);
    if (index % 16384 === 0) await cooperate(context);
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor] ?? 0;
    const x = index % width;
    const y = (index - x) / width;
    const around = [index - 1, index + 1, index - width, index + width];
    for (const next of around) {
      if (next < 0 || next >= labels.length || seen[next] === 1) continue;
      const nx = next % width;
      if (Math.abs(nx - x) + Math.abs((next - nx) / width - y) !== 1) continue;
      seen[next] = 1;
      nearest[next] = nearest[index] ?? 0;
      queue.push(next);
    }
    if (cursor % 4096 === 0) await cooperate(context);
  }
  return nearest;
}

async function smoothLabelsAsync(labels: Uint8Array, width: number, height: number, kCount: number, sigma: number, context: CooperativeContext, onProgress: (fraction: number) => void): Promise<void> {
  if (!(sigma > 0)) return;
  const kernel = gaussianKernel(sigma);
  const best = new Float64Array(labels.length);
  best.fill(-1);
  const next = labels.slice();
  const mask = new Float64Array(labels.length);
  const blurred = new Float64Array(labels.length);
  for (let label = 0; label < kCount; label += 1) {
    for (let index = 0; index < labels.length; index += 1) {
      mask[index] = labels[index] === label ? 1 : 0;
      if (index % 16384 === 0) await cooperate(context);
    }
    await blurSeparableAsync(mask, blurred, width, height, kernel, context);
    for (let index = 0; index < labels.length; index += 1) {
      const value = blurred[index] ?? 0;
      if (value > (best[index] ?? -1)) {
        best[index] = value;
        next[index] = label;
      }
      if (index % 16384 === 0) await cooperate(context);
    }
    onProgress((label + 1) / Math.max(1, kCount));
  }
  labels.set(next);
}

async function blurSeparableAsync(source: Float64Array, target: Float64Array, width: number, height: number, kernel: Float64Array, context: CooperativeContext): Promise<void> {
  const radius = (kernel.length - 1) >> 1;
  const temp = new Float64Array(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let tap = -radius; tap <= radius; tap += 1) sum += (source[y * width + reflect101(x + tap, width)] ?? 0) * (kernel[tap + radius] ?? 0);
      temp[y * width + x] = sum;
    }
    await cooperate(context);
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let tap = -radius; tap <= radius; tap += 1) sum += (temp[reflect101(y + tap, height) * width + x] ?? 0) * (kernel[tap + radius] ?? 0);
      target[y * width + x] = sum;
    }
    await cooperate(context);
  }
}

async function paintLabelsAsync(labels: Uint8Array, colors: readonly RGB[], width: number, height: number, context: CooperativeContext, onProgress: (fraction: number) => void): Promise<Painted> {
  const used = new Map<number, number>();
  const palette: string[] = [];
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index] ?? 255;
    if (label !== 255) {
      let slot = used.get(label);
      if (slot === undefined) {
        const color = colors[label] ?? { r: 0, g: 0, b: 0 };
        const paint = hex(color.r, color.g, color.b);
        slot = palette.indexOf(paint);
        if (slot < 0) {
          slot = palette.length;
          palette.push(paint);
        }
        used.set(label, slot);
      }
      const color = colors[label] ?? { r: 0, g: 0, b: 0 };
      const offset = index * 4;
      rgba[offset] = color.r;
      rgba[offset + 1] = color.g;
      rgba[offset + 2] = color.b;
      rgba[offset + 3] = 255;
    }
    if (index % 16384 === 0) {
      onProgress(index / labels.length);
      await cooperate(context);
    }
  }
  onProgress(1);
  return { rgba, width, height, palette };
}

function assignLabels(linear: Float64Array, lab: Float64Array, core: Uint8Array, alpha: Uint8Array, opacity: Uint8Array, width: number, height: number, centers: Lab[], onProgress?: (fraction: number) => void): Uint8Array {
  const count = width * height;
  const kCount = centers.length;
  const coreLabel = new Int16Array(count);
  coreLabel.fill(-1);
  for (let index = 0; index < count; index += 1) {
    if (core[index] !== 1) continue;
    coreLabel[index] = nearestLab(readLab(lab, index), centers);
    if (index % 16384 === 0) onProgress?.(0.12 * index / count);
  }
  const allow = new Uint16Array(count);
  const disk = diskOffsets(DILATE_RADIUS);
  for (let index = 0; index < count; index += 1) {
    const label = coreLabel[index] ?? -1;
    if (label < 0) continue;
    const x = index % width;
    const y = (index - x) / width;
    for (const offset of disk) {
      const nx = x + offset.x;
      const ny = y + offset.y;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const at = ny * width + nx;
      allow[at] = (allow[at] ?? 0) | (1 << label);
    }
    if (index % 16384 === 0) onProgress?.(0.12 + 0.16 * index / count);
  }
  const square = squareOffsets(1);
  for (let index = 0; index < count; index += 1) {
    if (alpha[index] === 0) continue;
    const color = readLab(lab, index);
    let near = 0;
    for (let label = 0; label < kCount; label += 1) {
      const center = centers[label];
      if (center === undefined) continue;
      if (Math.sqrt(labDistance2(color, center)) >= OWN_COLOR) continue;
      near |= 1 << label;
    }
    if (near === 0) continue;
    const x = index % width;
    const y = (index - x) / width;
    for (const offset of square) {
      const nx = x + offset.x;
      const ny = y + offset.y;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const at = ny * width + nx;
      allow[at] = (allow[at] ?? 0) | near;
    }
    if (index % 16384 === 0) onProgress?.(0.28 + 0.16 * index / count);
  }
  const nearestCore = nearestCoreLabel(coreLabel, width, height, (fraction) => onProgress?.(0.44 + fraction * 0.14));
  for (let index = 0; index < count; index += 1) {
    if ((allow[index] ?? 0) !== 0) continue;
    const label = nearestCore[index] ?? -1;
    if (label >= 0) allow[index] = 1 << label;
    if (index % 16384 === 0) onProgress?.(0.58 + 0.07 * index / count);
  }
  const upW = width * UP;
  const upH = height * UP;
  const labels = new Uint8Array(upW * upH);
  labels.fill(255);
  const tile = 48;
  for (let y0 = 0; y0 < height; y0 += tile) {
    const y1 = Math.min(height, y0 + tile);
    for (let y = y0; y < y1; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (alpha[y * width + x] === 0) continue;
        const mask = allow[y * width + x] ?? 0;
        const bits = bitList(mask, kCount);
        for (let oy = 0; oy < UP; oy += 1) {
          for (let ox = 0; ox < UP; ox += 1) {
            const ux = x * UP + ox;
            const uy = y * UP + oy;
            const at = uy * upW + ux;
            if (bits.length === 0) continue;
            if (bits.length === 1) {
              labels[at] = bits[0] ?? 0;
              continue;
            }
            const sample = bicubicLab(linear, width, height, (ux + 0.5) / UP - 0.5, (uy + 0.5) / UP - 0.5);
            labels[at] = explain(sample, bits, centers);
          }
        }
      }
      onProgress?.(0.65 + 0.12 * (y + 1) / height);
    }
  }
  cleanLabels(labels, upW, upH, kCount, Math.floor(SPECK_SOURCE * UP * UP), (fraction) => onProgress?.(0.77 + fraction * 0.09));
  smoothLabels(labels, upW, upH, kCount, SMOOTH_SOURCE * UP, (fraction) => onProgress?.(0.86 + fraction * 0.1));
  cutTransparent(labels, opacity, width, height);
  onProgress?.(1);
  return labels;
}

// Cut the transparent area out of the 8x label map along the bilinear 50% opacity contour. Clearing whole source
// pixels left a one-source-pixel staircase on every transparent edge; VTracer traced each step, and the notches
// rendered as slivers and seams. Opaque sub-pixels the per-pixel labelling skipped take a neighbouring label.
const SOLID_OPACITY = 250;
const CLEAR_OPACITY = 5;
const THIN_BEND = 64;
const AXIS_SNAP = (20 * Math.PI) / 180;
// Next to a junction (a cross or T where two cut-outs meet) the 3x3 gradient tilts further; up to this angle a normal
// still snaps when the pixel right beside it on the edge is flat.
const AXIS_SNAP_NEAR = (30 * Math.PI) / 180;
const AXIS_FLAT = (3 * Math.PI) / 180;
const CORNER_SLACK = 0.1;
const CORNER_TILT = (20 * Math.PI) / 180;

// Sub-pixel masks for partially covered pixels. A pixel's own edge line (gradient normal, coverage offset) is exact on
// straight edges but tilts where two edges meet. There, a neighbour's line extended into the pixel, or the
// intersection (convex) or union (concave) of two neighbour lines, matches the pixel's coverage better and keeps the
// corner square. The candidate whose coverage is closest to the pixel's alpha wins; the pixel's own line wins ties.
// Offset t of the half-plane n.p >= t (p relative to the pixel centre) that covers `area` of the unit pixel.
function planeOffset(nx: number, ny: number, area: number): number {
  const steps = 16;
  const covered = (limit: number) => {
    let count = 0;
    for (let j = 0; j < steps; j += 1) {
      for (let i = 0; i < steps; i += 1) if (nx * ((i + 0.5) / steps - 0.5) + ny * ((j + 0.5) / steps - 0.5) >= limit) count += 1;
    }
    return count / (steps * steps);
  };
  let low = -1;
  let high = 1;
  for (let iteration = 0; iteration < 14; iteration += 1) {
    const middle = (low + high) / 2;
    if (covered(middle) > area) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

// A partially covered pixel that is not on a one-sided edge: a ridge (thin opaque part) keeps a centred strip as wide
// as its coverage, a valley (thin gap or hole) keeps a centred gap as wide as its missing coverage, across the axis
// that bends most. Anything flatter keeps the whole-pixel decision. Either way thin parts and small holes survive,
// where the bilinear contour dropped thin parts below 50% and filled holes surrounded by opaque pixels.
function thinShape(level: number, bendX: number, bendY: number): Uint8Array {
  const mask = new Uint8Array(UP * UP);
  const alongX = Math.abs(bendX) >= Math.abs(bendY);
  const bend = alongX ? bendX : bendY;
  const coverage = level / 255;
  for (let cell = 0; cell < mask.length; cell += 1) {
    const across = Math.abs(((alongX ? cell % UP : Math.floor(cell / UP)) + 0.5) / UP - 0.5);
    // Mostly covered pixels stay whole: a shallow valley is the anti-aliased seam where two shapes touch.
    if (level >= 128) mask[cell] = 1;
    else if (bend < -THIN_BEND) mask[cell] = across <= coverage / 2 ? 1 : 0;
    else if (bend > THIN_BEND) mask[cell] = across >= (1 - coverage) / 2 ? 1 : 0;
    else mask[cell] = 0;
  }
  return mask;
}

function edgeShapes(opacity: Uint8Array, width: number, height: number, normalX: Float64Array, normalY: Float64Array): Map<number, Uint8Array> {
  const partial = (index: number) => (opacity[index] ?? 0) > CLEAR_OPACITY && (opacity[index] ?? 0) < SOLID_OPACITY && ((normalX[index] ?? 0) !== 0 || (normalY[index] ?? 0) !== 0);
  const offsets = new Map<number, number>();
  const offset = (index: number) => {
    const known = offsets.get(index);
    if (known !== undefined) return known;
    const value = planeOffset(normalX[index] ?? 0, normalY[index] ?? 0, (opacity[index] ?? 0) / 255);
    offsets.set(index, value);
    return value;
  };
  const shapes = new Map<number, Uint8Array>();
  const cells = UP * UP;
  const read = (x: number, y: number) => opacity[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))] ?? 0;
  const corners: number[] = [];
  const thin: number[] = [];
  // A pixel's line is reliable when a neighbouring edge pixel runs the same way; corner pixels' lines are not.
  const reliable = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!partial(index)) continue;
      for (let dy = -1; dy <= 1 && reliable[index] === 0; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx0 = x + dx, ny0 = y + dy;
          if ((dx === 0 && dy === 0) || nx0 < 0 || ny0 < 0 || nx0 >= width || ny0 >= height) continue;
          const other = ny0 * width + nx0;
          if (partial(other) && (normalX[other] ?? 0) * (normalX[index] ?? 0) + (normalY[other] ?? 0) * (normalY[index] ?? 0) >= Math.cos(CORNER_TILT)) { reliable[index] = 1; break; }
        }
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const level = opacity[index] ?? 0;
      if (level > CLEAR_OPACITY && level < SOLID_OPACITY && !partial(index)) {
        shapes.set(index, thinShape(level, read(x - 1, y) + read(x + 1, y) - 2 * level, read(x, y - 1) + read(x, y + 1) - 2 * level));
        thin.push(index);
        continue;
      }
      if (!partial(index)) continue;
      const lines: { readonly nx: number; readonly ny: number; readonly mask: Uint8Array }[] = [];
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx0 = x + dx, ny0 = y + dy;
          if (nx0 < 0 || ny0 < 0 || nx0 >= width || ny0 >= height) continue;
          const other = ny0 * width + nx0;
          if (!partial(other) || ((dx !== 0 || dy !== 0) && reliable[other] !== 1)) continue;
          const nx = normalX[other] ?? 0, ny = normalY[other] ?? 0, limit = offset(other);
          const mask = new Uint8Array(cells);
          for (let cell = 0; cell < cells; cell += 1) {
            const u = ((cell % UP) + 0.5) / UP - 0.5 - dx, v = (Math.floor(cell / UP) + 0.5) / UP - 0.5 - dy;
            mask[cell] = nx * u + ny * v >= limit ? 1 : 0;
          }
          if (dx === 0 && dy === 0) lines.unshift({ nx, ny, mask });
          else lines.push({ nx, ny, mask });
        }
      }
      const target = (opacity[index] ?? 0) / 255;
      const coverage = (mask: Uint8Array) => mask.reduce((sum, value) => sum + value, 0) / cells;
      const own = lines[0];
      let best = own?.mask ?? new Uint8Array(cells);
      const neighbours = lines.slice(1);
      if (own !== undefined && neighbours.length > 0 && reliable[index] !== 1) {
        // No neighbouring edge runs the way this pixel's gradient points: the gradient is a corner blend.
        let bestError = Number.POSITIVE_INFINITY;
        const consider = (mask: Uint8Array) => {
          const error = Math.abs(coverage(mask) - target);
          if (error <= CORNER_SLACK && error < bestError) { best = mask; bestError = error; }
        };
        for (let a = 0; a < neighbours.length; a += 1) {
          for (let b = a + 1; b < neighbours.length; b += 1) {
            const left = neighbours[a], right = neighbours[b];
            if (left === undefined || right === undefined || left.nx * right.nx + left.ny * right.ny > Math.cos(CORNER_TILT)) continue;
            consider(left.mask.map((value, cell) => value & (right.mask[cell] ?? 0)));
            consider(left.mask.map((value, cell) => value | (right.mask[cell] ?? 0)));
          }
        }
        // Two edges meeting in this pixel explain it best; a single extended edge is the fallback.
        if (bestError === Number.POSITIVE_INFINITY) for (const line of neighbours) consider(line.mask);
      }
      shapes.set(index, best);
      if (reliable[index] !== 1) corners.push(index);
    }
  }
  // Straight and curved edges keep the smooth bilinear contour; only corner pixels and the edge pixels around them
  // use the reconstructed lines (and thin parts / small holes their ridge and valley shapes, set above).
  const zone = new Set<number>(thin);
  for (const index of corners) {
    const x = index % width;
    const y = (index - x) / width;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx0 = x + dx, ny0 = y + dy;
        if (nx0 >= 0 && ny0 >= 0 && nx0 < width && ny0 < height) zone.add(ny0 * width + nx0);
      }
    }
  }
  for (const index of [...shapes.keys()]) if (!zone.has(index)) shapes.delete(index);
  return shapes;
}

function cutTransparent(labels: Uint8Array, opacity: Uint8Array, width: number, height: number): void {
  if (opacity.every((value) => value === 255)) return;
  const upW = width * UP;
  const upH = height * UP;
  const read = (x: number, y: number) => opacity[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))] ?? 0;
  // Each partially covered pixel is cut by one straight edge: normal along the alpha gradient, offset so the kept
  // area matches the pixel's coverage. Fully covered and fully empty pixels keep their square, so hard corners stay
  // hard; the bilinear 50% contour rounded every corner by about half a source pixel.
  const normalX = new Float64Array(width * height);
  const normalY = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const own = opacity[y * width + x] ?? 0;
      if (own <= CLEAR_OPACITY || own >= SOLID_OPACITY) continue;
      const gx = read(x + 1, y - 1) + 2 * read(x + 1, y) + read(x + 1, y + 1) - read(x - 1, y - 1) - 2 * read(x - 1, y) - read(x - 1, y + 1);
      const gy = read(x - 1, y + 1) + 2 * read(x, y + 1) + read(x + 1, y + 1) - read(x - 1, y - 1) - 2 * read(x, y - 1) - read(x + 1, y - 1);
      const length = Math.hypot(gx, gy);
      if (length === 0) continue;
      // Only a real edge (opaque on one side, clear on the other) gets a half-plane. Ridges (thin parts) and valleys
      // (thin gaps, seams between touching shapes) are handled in edgeShapes.
      const stepX = Math.round(gx / length), stepY = Math.round(gy / length);
      const ahead = read(x + stepX, y + stepY), behind = read(x - stepX, y - stepY);
      if (ahead - behind < 96 || ahead < own - 8 || behind > own + 8) continue;
      // A pixel with solid pixels on two opposite sides and none on the other two is a seam between touching shapes
      // (its missing coverage is the anti-aliased seam, not the outline); cutting it opened specks where a seam meets
      // the outline. A corner tip has a third solid side and keeps its cut.
      const solid = (dx: number, dy: number) => read(x + dx, y + dy) >= SOLID_OPACITY;
      const across = (dx: number, dy: number) => solid(dx, dy) && solid(-dx, -dy) && !solid(dy, dx) && !solid(-dy, -dx);
      if (across(1, 0) || across(0, 1)) continue;
      normalX[y * width + x] = gx / length;
      normalY[y * width + x] = gy / length;
    }
  }
  // Snap near-axis normals on straight axis-aligned edges: a 3x3 gradient next to a corner tilts by up to ~20 degrees,
  // and those tilted lines, extended into the corner pixel, are what rounded or spiked axis-aligned corners. Only
  // pixels within two steps of an untilted pixel on the same edge snap; a curve's normals turn gradually and stay.
  const tiltOf = (index: number): number => {
    const nx = normalX[index] ?? 0, ny = normalY[index] ?? 0;
    return Math.atan2(Math.min(Math.abs(nx), Math.abs(ny)), Math.max(Math.abs(nx), Math.abs(ny)));
  };
  const axisOf = (index: number, limit = AXIS_SNAP): number => {
    const nx = normalX[index] ?? 0, ny = normalY[index] ?? 0;
    if (nx === 0 && ny === 0) return 0;
    if (tiltOf(index) > limit) return 0;
    return Math.abs(nx) >= Math.abs(ny) ? (nx > 0 ? 1 : 2) : ny > 0 ? 3 : 4;
  };
  const flat = (index: number, axis: number): boolean => {
    const nx = normalX[index] ?? 0, ny = normalY[index] ?? 0;
    return axisOf(index) === axis && Math.min(Math.abs(nx), Math.abs(ny)) <= Math.sin(AXIS_FLAT);
  };
  const snapped: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const axis = axisOf(index, AXIS_SNAP_NEAR);
      if (axis === 0) continue;
      const alongX = axis <= 2 ? 0 : 1, alongY = axis <= 2 ? 1 : 0;
      let anchored = false;
      const junction = tiltOf(index) > AXIS_SNAP;
      for (const step of junction ? [-1, 1] : [-2, -1, 0, 1, 2]) {
        const nx = x + step * alongX, ny = y + step * alongY;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        // A junction-tilted pixel snaps only where its edge runs into a gap (the pixel past it is fainter); where the
        // outline turns into the shape instead (a star's inner corner) the tilt is real.
        if (junction && read(x - step * alongX, y - step * alongY) >= (opacity[index] ?? 0)) continue;
        if (flat(ny * width + nx, axis)) anchored = true;
      }
      if (anchored) snapped.push(index, axis);
    }
  }
  for (let at = 0; at < snapped.length; at += 2) {
    const index = snapped[at] ?? 0, axis = snapped[at + 1] ?? 0;
    normalX[index] = axis === 1 ? 1 : axis === 2 ? -1 : 0;
    normalY[index] = axis === 3 ? 1 : axis === 4 ? -1 : 0;
  }
  const shape = edgeShapes(opacity, width, height, normalX, normalY);
  let pending: number[] = [];
  for (let uy = 0; uy < upH; uy += 1) {
    const sy = (uy + 0.5) / UP - 0.5;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    for (let ux = 0; ux < upW; ux += 1) {
      const sx = (ux + 0.5) / UP - 0.5;
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      const top = read(x0, y0) * (1 - fx) + read(x0 + 1, y0) * fx;
      const bottom = read(x0, y0 + 1) * (1 - fx) + read(x0 + 1, y0 + 1) * fx;
      const at = uy * upW + ux;
      const ownIndex = Math.floor(uy / UP) * width + Math.floor(ux / UP);
      const own = opacity[ownIndex] ?? 0;
      let inside: boolean;
      if (own >= SOLID_OPACITY) inside = true;
      else if (own <= CLEAR_OPACITY) inside = false;
      else {
        const mask = shape.get(ownIndex);
        inside = mask === undefined ? top * (1 - fy) + bottom * fy >= 128 : mask[(uy % UP) * UP + (ux % UP)] === 1;
      }
      if (!inside) labels[at] = 255;
      else if (labels[at] === 255) pending.push(at);
    }
  }
  while (pending.length > 0) {
    const assigned: number[] = [];
    const waiting: number[] = [];
    for (const at of pending) {
      const x = at % upW;
      const neighbours = [x > 0 ? at - 1 : -1, x < upW - 1 ? at + 1 : -1, at - upW, at + upW];
      const from = neighbours.find((next) => next >= 0 && next < labels.length && labels[next] !== 255);
      if (from === undefined) waiting.push(at);
      else assigned.push(at, labels[from] ?? 0);
    }
    if (assigned.length === 0) break;
    for (let index = 0; index < assigned.length; index += 2) labels[assigned[index] ?? 0] = assigned[index + 1] ?? 0;
    pending = waiting;
  }
}

function nearestCoreLabel(coreLabel: Int16Array, width: number, height: number, onProgress?: (fraction: number) => void): Int16Array {
  const nearest = new Int16Array(coreLabel.length);
  nearest.fill(-1);
  const queue: number[] = [];
  for (let index = 0; index < coreLabel.length; index += 1) {
    const label = coreLabel[index] ?? -1;
    if (label < 0) continue;
    nearest[index] = label;
    queue.push(index);
    if (index % 16384 === 0) onProgress?.(0.4 * index / coreLabel.length);
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor] ?? 0;
    const label = nearest[index] ?? -1;
    const x = index % width;
    const y = (index - x) / width;
    const steps = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1]
    ];
    for (const step of steps) {
      const nx = step[0] ?? 0;
      const ny = step[1] ?? 0;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const at = ny * width + nx;
      if ((nearest[at] ?? -1) >= 0) continue;
      nearest[at] = label;
      queue.push(at);
    }
    if (cursor % 4096 === 0) onProgress?.(0.4 + 0.6 * cursor / Math.max(1, queue.length));
  }
  onProgress?.(1);
  return nearest;
}

function explain(sample: Lab, bits: readonly number[], centers: readonly Lab[]): number {
  let best = bits[0] ?? 0;
  let bestDistance = Infinity;
  for (const label of bits) {
    const center = centers[label];
    if (center === undefined) continue;
    const distance = Math.sqrt(labDistance2(sample, center));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = label;
    }
  }
  for (let left = 0; left < bits.length; left += 1) {
    for (let right = left + 1; right < bits.length; right += 1) {
      const a = bits[left];
      const b = bits[right];
      if (a === undefined || b === undefined) continue;
      const first = centers[a];
      const second = centers[b];
      if (first === undefined || second === undefined) continue;
      const projected = projectLab(sample, first, second);
      if (projected.distance < bestDistance) {
        bestDistance = projected.distance;
        best = projected.t < 0.5 ? a : b;
      }
    }
  }
  return best;
}

function fillColors(rgba: Uint8Array, alpha: Uint8Array, core: Uint8Array, labels: Uint8Array, width: number, height: number, centers: readonly Lab[], onProgress?: (fraction: number) => void): RGB[] {
  const sums = centers.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));
  const upW = width * UP;
  const mid = UP >> 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (alpha[index] === 0 || core[index] !== 1) continue;
      const label = labels[(y * UP + mid) * upW + x * UP + mid] ?? 255;
      const bin = sums[label];
      if (bin === undefined) continue;
      const offset = index * 4;
      bin.r += rgba[offset] ?? 0;
      bin.g += rgba[offset + 1] ?? 0;
      bin.b += rgba[offset + 2] ?? 0;
      bin.n += 1;
    }
    onProgress?.((y + 1) / height);
  }
  return centers.map((center, index) => {
    const bin = sums[index];
    if (bin !== undefined && bin.n > 4) return { r: Math.round(bin.r / bin.n), g: Math.round(bin.g / bin.n), b: Math.round(bin.b / bin.n) };
    return oklabToRgb(center);
  });
}

function paintLabels(labels: Uint8Array, colors: readonly RGB[], width: number, height: number, onProgress?: (fraction: number) => void): Painted {
  const used = new Map<number, number>();
  const palette: string[] = [];
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < labels.length; index += 1) {
    if (index % 16384 === 0) onProgress?.(index / labels.length);
    const label = labels[index] ?? 255;
    if (label === 255) continue;
    let slot = used.get(label);
    if (slot === undefined) {
      const color = colors[label] ?? { r: 0, g: 0, b: 0 };
      const paint = hex(color.r, color.g, color.b);
      slot = palette.indexOf(paint);
      if (slot < 0) {
        slot = palette.length;
        palette.push(paint);
      }
      used.set(label, slot);
    }
    const color = colors[label] ?? { r: 0, g: 0, b: 0 };
    const offset = index * 4;
    rgba[offset] = color.r;
    rgba[offset + 1] = color.g;
    rgba[offset + 2] = color.b;
    rgba[offset + 3] = 255;
  }
  onProgress?.(1);
  return { rgba, width, height, palette };
}

const THIN_TAU = 0.07;
const THIN_MIN = 3;
const BLEND_TOLERANCE = 0.03;
const THIN_DISTANCE = 0.1;
const EDGE_BLEND = 0.06;

/**
 * buildPalette samples only core pixels (all 8 neighbours within CORE_TAU), so a colour that only appears in strokes
 * one or two source pixels wide never gets a centre: gl-microsoft's white gutters at 32/64 px, om-gear's black outline
 * and grey ring, the rainbow bands and airbnb outline at 32 px, tw-apple's stem. Those pixels are still flat along the
 * stroke. Collect opaque non-core pixels whose two neighbours on one axis (horizontal, vertical or a diagonal) match
 * them and that are not a mix of their two neighbours across that axis (anti-aliased edge), group them by colour, and
 * add each group of at least THIN_MIN pixels that is more than THIN_DISTANCE from every centre, largest first.
 * THIN_DISTANCE is wider than REGION_TOLERANCE so JPEG ringing around a known colour does not become a centre.
 */
function recoverThinColors(lab: Float64Array, alpha: Uint8Array, core: Uint8Array, width: number, height: number, centers: Lab[]): Lab[] {
  const limit = THIN_TAU * THIN_TAU;
  const groups = new Map<number, Lab[]>();
  const axes = [[1, 0], [0, 1], [1, 1], [1, -1]];
  // JPEG ringing and soft edges defeat the pixel test above. Look one and two pixels out on each side, snap those to
  // the core palette, and call the pixel an edge blend when the sides are two different centres it lies between.
  const betweenCenters = (color: Lab, x: number, y: number, px: number, py: number): boolean => {
    for (let reach = 1; reach <= 2; reach += 1) {
      const ax = x + px * reach, ay = y + py * reach, bx = x - px * reach, by = y - py * reach;
      if (ax < 0 || ay < 0 || bx < 0 || by < 0 || ax >= width || bx >= width || ay >= height || by >= height) continue;
      const a = ay * width + ax, b = by * width + bx;
      if (alpha[a] === 0 || alpha[b] === 0) continue;
      const left = centers[nearestLab(readLab(lab, a), centers)] ?? zeroLab();
      const right = centers[nearestLab(readLab(lab, b), centers)] ?? zeroLab();
      if (labDistance2(left, right) === 0) continue;
      const mix = projectLab(color, left, right);
      if (mix.t > 0.1 && mix.t < 0.9 && mix.distance <= EDGE_BLEND) return true;
    }
    return false;
  };
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (alpha[index] === 0 || core[index] === 1) continue;
      const color = readLab(lab, index);
      const alongStroke = axes.some(([dx, dy]) => {
        const before = (y - (dy ?? 0)) * width + x - (dx ?? 0);
        const after = (y + (dy ?? 0)) * width + x + (dx ?? 0);
        if (alpha[before] === 0 || alpha[after] === 0 || labDistance2(color, readLab(lab, before)) >= limit || labDistance2(color, readLab(lab, after)) >= limit) return false;
        // Across the stroke: an anti-aliased edge pixel is a mix of the two sides, a real stroke is not.
        const side = (y + (dx ?? 0)) * width + x - (dy ?? 0);
        const other = (y - (dx ?? 0)) * width + x + (dy ?? 0);
        if (alpha[side] === 0 || alpha[other] === 0) return true;
        const across = projectLab(color, readLab(lab, side), readLab(lab, other));
        if (across.t > 0.15 && across.t < 0.85 && across.distance <= BLEND_TOLERANCE) return false;
        return !betweenCenters(color, x, y, dy ?? 0, -(dx ?? 0));
      });
      if (!alongStroke) continue;
      const key = (Math.round(color.L / 0.05) + 40) * 10000 + (Math.round(color.a / 0.05) + 40) * 100 + (Math.round(color.b / 0.05) + 40);
      const list = groups.get(key);
      if (list === undefined) groups.set(key, [color]);
      else list.push(color);
    }
  }
  const result = [...centers];
  const explained = (color: Lab) => result.some((center) => Math.sqrt(labDistance2(color, center)) <= THIN_DISTANCE);
  const ordered = [...groups.values()].filter((list) => list.length >= THIN_MIN).sort((left, right) => right.length - left.length);
  for (const list of ordered) {
    if (result.length >= K_MAX) break;
    const kept = list.filter((color) => !explained(color));
    if (kept.length < THIN_MIN) continue;
    const mean = kept.reduce((sum, color) => ({ L: sum.L + color.L / kept.length, a: sum.a + color.a / kept.length, b: sum.b + color.b / kept.length }), zeroLab());
    if (explained(mean)) continue;
    result.push(mean);
  }
  return result;
}

function buildPalette(lab: Float64Array, core: Uint8Array, width: number, height: number, userK: number, onProgress?: (fraction: number) => void): Lab[] {
  const bins = new Map<string, { x: number; y: number; z: number; n: number }>();
  for (let index = 0; index < core.length; index += 1) {
    if (core[index] !== 1) continue;
    const color = readLab(lab, index);
    const key = Math.round(color.L / 0.008) + "," + Math.round(color.a / 0.008) + "," + Math.round(color.b / 0.008);
    const bin = bins.get(key) ?? { x: 0, y: 0, z: 0, n: 0 };
    bin.x += color.L;
    bin.y += color.a;
    bin.z += color.b;
    bin.n += 1;
    bins.set(key, bin);
    if (index % 16384 === 0) onProgress?.(0.35 * index / core.length);
  }
  const samples: Lab[] = [];
  const weights: number[] = [];
  for (const bin of bins.values()) {
    if (bin.n === 0) continue;
    samples.push({ L: bin.x / bin.n, a: bin.y / bin.n, b: bin.z / bin.n });
    weights.push(Math.log1p(bin.n));
  }
  if (samples.length === 0) return [{ L: 0, a: 0, b: 0 }];
  const regions = regionMeans(lab, core, width, height, (fraction) => onProgress?.(0.35 + fraction * 0.4));
  const anchors = distinctAnchors(regions);
  onProgress?.(0.75);
  const floorK = Math.max(2, anchors.length);
  if (userK > 0) return wkmeans(samples, weights, Math.min(K_MAX, Math.max(userK, anchors.length)), anchors, (fraction) => onProgress?.(0.75 + fraction * 0.25));
  if (regions.length === 0) return wkmeans(samples, weights, Math.min(K_MAX, Math.max(2, Math.min(8, samples.length))), [], (fraction) => onProgress?.(0.75 + fraction * 0.25));
  let chosen = wkmeans(samples, weights, Math.min(floorK, samples.length), anchors, (fraction) => onProgress?.(0.75 + fraction * 0.1));
  for (let k = floorK; k <= Math.min(K_MAX, Math.max(samples.length, anchors.length)); k += 1) {
    chosen = wkmeans(samples, weights, k, anchors, (fraction) => onProgress?.(0.85 + fraction * 0.15));
    const missed = regions.some((region) => chosen.every((center) => Math.sqrt(labDistance2(center, region.mean)) > REGION_TOLERANCE));
    if (!missed) return chosen;
  }
  return chosen;
}

function distinctAnchors(regions: readonly { readonly mean: Lab; readonly size: number }[]): Lab[] {
  const ordered = [...regions].sort((left, right) => right.size - left.size);
  const kept: Lab[] = [];
  for (const region of ordered) {
    if (kept.length >= K_MAX) break;
    if (kept.every((color) => Math.sqrt(labDistance2(color, region.mean)) > COLOR_FLOOR)) kept.push({ ...region.mean });
  }
  return kept;
}

function regionMeans(lab: Float64Array, core: Uint8Array, width: number, height: number, onProgress?: (fraction: number) => void): { mean: Lab; size: number }[] {
  const groups = new Map<number, number[]>();
  for (let index = 0; index < core.length; index += 1) {
    if (core[index] !== 1) continue;
    const color = readLab(lab, index);
    const key = (Math.round(color.L / 0.05) + 40) * 10000 + (Math.round(color.a / 0.05) + 40) * 100 + (Math.round(color.b / 0.05) + 40);
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [index]);
    else list.push(index);
    if (index % 16384 === 0) onProgress?.(0.35 * index / core.length);
  }
  const means: { mean: Lab; size: number }[] = [];
  for (const pixels of groups.values()) {
    const member = new Uint8Array(core.length);
    for (const index of pixels) member[index] = 1;
    const labeled = components(member, width, height, (fraction) => onProgress?.(0.35 + 0.35 * fraction));
    for (let id = 1; id <= labeled.count; id += 1) {
      const size = labeled.sizes[id] ?? 0;
      if (size < 12) continue;
      let l = 0;
      let a = 0;
      let b = 0;
      const values: Lab[] = [];
      for (let index = 0; index < member.length; index += 1) {
        if ((labeled.ids[index] ?? 0) !== id) continue;
        const color = readLab(lab, index);
        values.push(color);
        l += color.L;
        a += color.a;
        b += color.b;
      }
      const n = values.length;
      if (n === 0) continue;
      const mean = { L: l / n, a: a / n, b: b / n };
      let varL = 0;
      let varA = 0;
      let varB = 0;
      for (const color of values) {
        varL += (color.L - mean.L) ** 2;
        varA += (color.a - mean.a) ** 2;
        varB += (color.b - mean.b) ** 2;
      }
      const spread = Math.max(Math.sqrt(varL / n), Math.sqrt(varA / n), Math.sqrt(varB / n));
      if (spread < 0.015) means.push({ mean, size });
    }
  }
  onProgress?.(1);
  return means;
}

function wkmeans(samples: readonly Lab[], weights: readonly number[], kCount: number, frozen: readonly Lab[] = [], onProgress?: (fraction: number) => void): Lab[] {
  const count = samples.length;
  const pinned = Math.min(frozen.length, K_MAX);
  const k = Math.max(1, Math.min(K_MAX, Math.max(kCount, pinned, count === 0 ? pinned : 1)));
  const centers: Lab[] = [];
  for (let index = 0; index < pinned && centers.length < k; index += 1) {
    const seed = frozen[index] ?? zeroLab();
    centers.push({ L: seed.L, a: seed.a, b: seed.b });
  }
  if (count === 0) return centers.length > 0 ? centers : [{ L: 0, a: 0, b: 0 }];
  const distance = new Float64Array(count);
  if (centers.length === 0) {
    let first = 0;
    let bestWeight = -1;
    for (let index = 0; index < count; index += 1) {
      const weight = weights[index] ?? 0;
      if (weight > bestWeight) {
        bestWeight = weight;
        first = index;
      }
    }
    centers.push({ ...(samples[first] ?? zeroLab()) });
  }
  for (let index = 0; index < count; index += 1) {
    const sample = samples[index] ?? zeroLab();
    let best = Infinity;
    for (const center of centers) best = Math.min(best, Math.sqrt(labDistance2(sample, center)));
    distance[index] = best;
  }
  while (centers.length < k && centers.length < count + pinned) {
    let at = 0;
    let score = -1;
    for (let index = 0; index < count; index += 1) {
      const next = (distance[index] ?? 0) * Math.sqrt(weights[index] ?? 0);
      if (next > score) {
        score = next;
        at = index;
      }
    }
    if (score <= 0 && centers.length >= pinned) break;
    const center = samples[at] ?? zeroLab();
    centers.push({ L: center.L, a: center.a, b: center.b });
    for (let index = 0; index < count; index += 1) {
      distance[index] = Math.min(distance[index] ?? 0, Math.sqrt(labDistance2(samples[index] ?? zeroLab(), center)));
    }
  }
  const pinCount = Math.min(pinned, centers.length);
  for (let round = 0; round < 40; round += 1) {
    const bins = centers.map(() => ({ L: 0, a: 0, b: 0, w: 0 }));
    for (let index = 0; index < count; index += 1) {
      const sample = samples[index] ?? zeroLab();
      const slot = nearestLab(sample, centers);
      const bin = bins[slot];
      const weight = weights[index] ?? 0;
      if (bin === undefined) continue;
      bin.L += sample.L * weight;
      bin.a += sample.a * weight;
      bin.b += sample.b * weight;
      bin.w += weight;
    }
    for (let index = pinCount; index < centers.length; index += 1) {
      const bin = bins[index];
      if (bin === undefined || bin.w === 0) continue;
      centers[index] = { L: bin.L / bin.w, a: bin.a / bin.w, b: bin.b / bin.w };
    }
    onProgress?.((round + 1) / 40);
  }
  return centers;
}

function cleanLabels(labels: Uint8Array, width: number, height: number, kCount: number, minArea: number, onProgress?: (fraction: number) => void): void {
  for (let pass = 0; pass < 2; pass += 1) {
    for (let label = 0; label < kCount; label += 1) {
      const mask = new Uint8Array(labels.length);
      for (let index = 0; index < labels.length; index += 1) if (labels[index] === label) mask[index] = 1;
      const labeled = components(mask, width, height, (fraction) => onProgress?.(((pass * kCount + label) / (2 * Math.max(1, kCount))) + fraction * 0.5 / Math.max(1, kCount)));
      const small = new Uint8Array(labels.length);
      let any = false;
      for (let index = 0; index < labels.length; index += 1) {
        const id = labeled.ids[index] ?? 0;
        if (id > 0 && (labeled.sizes[id] ?? 0) < minArea) {
          small[index] = 1;
          any = true;
        }
      }
      if (!any) continue;
      const replacement = nearestOutside(labels, small, width, height, (fraction) => onProgress?.(((pass * kCount + label) / (2 * Math.max(1, kCount))) + 0.5 / Math.max(1, kCount) + fraction * 0.5 / Math.max(1, kCount)));
      for (let index = 0; index < labels.length; index += 1) if (small[index] === 1) labels[index] = replacement[index] ?? label;
      onProgress?.((pass * kCount + label + 1) / (2 * Math.max(1, kCount)));
    }
  }
  onProgress?.(1);
}

function nearestOutside(labels: Uint8Array, small: Uint8Array, width: number, height: number, onProgress?: (fraction: number) => void): Uint8Array {
  const nearest = new Uint8Array(labels.length);
  const seen = new Uint8Array(labels.length);
  const queue: number[] = [];
  for (let index = 0; index < small.length; index += 1) {
    if (small[index] === 1) continue;
    seen[index] = 1;
    nearest[index] = labels[index] ?? 0;
    queue.push(index);
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor] ?? 0;
    const x = index % width;
    const y = (index - x) / width;
    const around = [index - 1, index + 1, index - width, index + width];
    for (const next of around) {
      if (next < 0 || next >= labels.length || seen[next] === 1) continue;
      const nx = next % width;
      if (Math.abs(nx - x) + Math.abs((next - nx) / width - y) !== 1) continue;
      seen[next] = 1;
      nearest[next] = nearest[index] ?? 0;
      queue.push(next);
    }
    if (cursor % 16384 === 0) onProgress?.(cursor / Math.max(1, queue.length));
  }
  return nearest;
}

function smoothLabels(labels: Uint8Array, width: number, height: number, kCount: number, sigma: number, onProgress?: (fraction: number) => void): void {
  if (!(sigma > 0)) return;
  const kernel = gaussianKernel(sigma);
  const best = new Float64Array(labels.length);
  best.fill(-1);
  const next = labels.slice();
  const mask = new Float64Array(labels.length);
  const blurred = new Float64Array(labels.length);
  for (let label = 0; label < kCount; label += 1) {
    for (let index = 0; index < labels.length; index += 1) mask[index] = labels[index] === label ? 1 : 0;
    blurSeparable(mask, blurred, width, height, kernel, (fraction) => onProgress?.(((label + fraction) / Math.max(1, kCount)) * 0.9));
    for (let index = 0; index < labels.length; index += 1) {
      const value = blurred[index] ?? 0;
      if (value > (best[index] ?? -1)) {
        best[index] = value;
        next[index] = label;
      }
    }
    onProgress?.((label + 1) / Math.max(1, kCount));
  }
  labels.set(next);
}

const BACKDROP_LAB = 0.1;
const SUBJECT_ON_BORDER = 16;

/**
 * The outside flood starts at the frame and walks every pixel that is not a colour edge, so a subject that touches
 * the frame (gl-slack's left pills, si-ubuntu's left dot) is flooded as "outside" and left out of every box.
 * When the backdrop is known (transparent or one corner colour) and the flood holds more than a few pixels that
 * are neither transparent nor that colour,
 * the subjects cannot be boxed apart: return true so subjectBoxes keeps the whole frame.
 */
function outsideHoldsSubject(rgba: Uint8Array, lab: Float64Array, opaque: Uint8Array, outside: Uint8Array, width: number, height: number): boolean {
  const corner = cornerColor(rgba, width, height);
  const backdrop = corner === null ? null : rgbToOklab({ r: parseInt(corner.slice(1, 3), 16), g: parseInt(corner.slice(3, 5), 16), b: parseInt(corner.slice(5, 7), 16) });
  // No uniform corner colour and no transparency (a photo backdrop such as the dock wallpaper): nothing to compare to.
  if (backdrop === null && !opaque.some((value, index) => value === 0 && outside[index] === 1)) return false;
  let subject = 0;
  for (let index = 0; index < outside.length; index += 1) {
    if (outside[index] !== 1 || opaque[index] !== 1) continue;
    if (backdrop !== null && Math.sqrt(labDistance2(readLab(lab, index), backdrop)) <= BACKDROP_LAB) continue;
    subject += 1;
    if (subject > SUBJECT_ON_BORDER) return true;
  }
  return false;
}

function enclosedBoxes(rgba: Uint8Array, width: number, height: number, onProgress?: (fraction: number) => void): SubjectBox[] {
  const count = width * height;
  if (width < 2 || height < 2 || rgba.length < count * 4) return [];
  const lab = new Float64Array(count * 3);
  const opaque = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    opaque[index] = (rgba[offset + 3] ?? 0) >= 128 ? 1 : 0;
    const color = rgbToOklab({ r: rgba[offset] ?? 0, g: rgba[offset + 1] ?? 0, b: rgba[offset + 2] ?? 0 });
    lab[index * 3] = color.L;
    lab[index * 3 + 1] = color.a;
    lab[index * 3 + 2] = color.b;
    if (index % 16384 === 0) onProgress?.(0.2 * index / count);
  }
  const edge = new Uint8Array(count);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (opaque[index] !== 1) continue;
      const color = readLab(lab, index);
      let strong = false;
      for (const step of [-1, 1, -width, width]) {
        const next = index + step;
        const nx = x + (step === -1 ? -1 : step === 1 ? 1 : 0);
        const ny = y + (step === -width ? -1 : step === width ? 1 : 0);
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (opaque[next] !== 1) {
          strong = true;
          break;
        }
        if (Math.sqrt(labDistance2(color, readLab(lab, next))) > COLOR_FLOOR) {
          strong = true;
          break;
        }
      }
      if (strong) edge[index] = 1;
    }
    onProgress?.(0.2 + 0.2 * (y + 1) / height);
  }
  const outside = new Uint8Array(count);
  const queue: number[] = [];
  for (let x = 0; x < width; x += 1) {
    seedOutside(0 * width + x, edge, outside, queue);
    seedOutside((height - 1) * width + x, edge, outside, queue);
  }
  for (let y = 0; y < height; y += 1) {
    seedOutside(y * width, edge, outside, queue);
    seedOutside(y * width + width - 1, edge, outside, queue);
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor] ?? 0;
    const x = index % width;
    const y = (index - x) / width;
    const steps = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1]
    ];
    for (const step of steps) {
      const nx = step[0] ?? 0;
      const ny = step[1] ?? 0;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      seedOutside(ny * width + nx, edge, outside, queue);
    }
    if (cursor % 16384 === 0) onProgress?.(0.4 + 0.2 * cursor / Math.max(1, queue.length));
  }
  if (outsideHoldsSubject(rgba, lab, opaque, outside, width, height)) return [];
  const object = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    if (opaque[index] === 1 && outside[index] !== 1) object[index] = 1;
    if (index % 16384 === 0) onProgress?.(0.6 + 0.1 * index / count);
  }
  const labeled = components(object, width, height, (fraction) => onProgress?.(0.7 + fraction * 0.2));
  const boxes: SubjectBox[] = [];
  for (let id = 1; id <= labeled.count; id += 1) {
    if ((labeled.sizes[id] ?? 0) < 400) continue;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    for (let index = 0; index < count; index += 1) {
      if ((labeled.ids[index] ?? 0) !== id) continue;
      const x = index % width;
      const y = (index - x) / width;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (index % 16384 === 0) onProgress?.(0.9 + 0.1 * (id - 1 + index / count) / Math.max(1, labeled.count));
    }
    const pad = 2;
    const x = Math.max(0, minX - pad);
    const y = Math.max(0, minY - pad);
    boxes.push({ x, y, width: Math.min(width, maxX + 1 + pad) - x, height: Math.min(height, maxY + 1 + pad) - y });
  }
  onProgress?.(1);
  return mergeBoxes(boxes, 8);
}

async function enclosedBoxesAsync(
  rgba: Uint8Array,
  width: number,
  height: number,
  context: CooperativeContext,
  onProgress: (fraction: number) => void
): Promise<SubjectBox[]> {
  const count = width * height;
  if (width < 2 || height < 2 || rgba.length < count * 4) return [];
  const lab = new Float64Array(count * 3);
  const opaque = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    opaque[index] = (rgba[offset + 3] ?? 0) >= 128 ? 1 : 0;
    const color = rgbToOklab({ r: rgba[offset] ?? 0, g: rgba[offset + 1] ?? 0, b: rgba[offset + 2] ?? 0 });
    lab[index * 3] = color.L;
    lab[index * 3 + 1] = color.a;
    lab[index * 3 + 2] = color.b;
    if (index % 8192 === 0) {
      onProgress(0.2 * index / count);
      await cooperate(context);
    }
  }
  const edge = new Uint8Array(count);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (opaque[index] !== 1) continue;
      const color = readLab(lab, index);
      let strong = false;
      for (const step of [-1, 1, -width, width]) {
        const next = index + step;
        const nx = x + (step === -1 ? -1 : step === 1 ? 1 : 0);
        const ny = y + (step === -width ? -1 : step === width ? 1 : 0);
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (opaque[next] !== 1) {
          strong = true;
          break;
        }
        if (Math.sqrt(labDistance2(color, readLab(lab, next))) > COLOR_FLOOR) {
          strong = true;
          break;
        }
      }
      if (strong) edge[index] = 1;
    }
    onProgress(0.2 + 0.2 * (y + 1) / height);
    await cooperate(context);
  }
  const outside = new Uint8Array(count);
  const queue: number[] = [];
  for (let x = 0; x < width; x += 1) {
    seedOutside(x, edge, outside, queue);
    seedOutside((height - 1) * width + x, edge, outside, queue);
  }
  for (let y = 0; y < height; y += 1) {
    seedOutside(y * width, edge, outside, queue);
    seedOutside(y * width + width - 1, edge, outside, queue);
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor] ?? 0;
    const x = index % width;
    const y = (index - x) / width;
    const steps = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    for (const step of steps) {
      const nx = step[0] ?? 0;
      const ny = step[1] ?? 0;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      seedOutside(ny * width + nx, edge, outside, queue);
    }
    if (cursor % 4096 === 0) {
      onProgress(0.4 + 0.2 * cursor / Math.max(1, queue.length));
      await cooperate(context);
    }
  }
  if (outsideHoldsSubject(rgba, lab, opaque, outside, width, height)) return [];
  const object = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    if (opaque[index] === 1 && outside[index] !== 1) object[index] = 1;
    if (index % 8192 === 0) {
      onProgress(0.6 + 0.1 * index / count);
      await cooperate(context);
    }
  }
  const labeled = await componentsAsync(object, width, height, context);
  const boxes: SubjectBox[] = [];
  for (let id = 1; id <= labeled.count; id += 1) {
    if ((labeled.sizes[id] ?? 0) < 400) continue;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    for (let index = 0; index < count; index += 1) {
      if ((labeled.ids[index] ?? 0) === id) {
        const x = index % width;
        const y = (index - x) / width;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      if (index % 8192 === 0) await cooperate(context);
    }
    const pad = 2;
    const x = Math.max(0, minX - pad);
    const y = Math.max(0, minY - pad);
    boxes.push({ x, y, width: Math.min(width, maxX + 1 + pad) - x, height: Math.min(height, maxY + 1 + pad) - y });
    onProgress(0.7 + 0.3 * id / Math.max(1, labeled.count));
  }
  onProgress(1);
  return mergeBoxes(boxes, 8);
}

function seedOutside(index: number, edge: Uint8Array, outside: Uint8Array, queue: number[]): void {
  if (edge[index] === 1 || outside[index] === 1) return;
  outside[index] = 1;
  queue.push(index);
}

function mergeBoxes(boxes: SubjectBox[], gap: number): SubjectBox[] {
  const open = boxes.map((box) => ({ ...box }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let left = 0; left < open.length; left += 1) {
      for (let right = left + 1; right < open.length; right += 1) {
        const a = open[left];
        const b = open[right];
        if (a === undefined || b === undefined) continue;
        const apart = a.x > b.x + b.width + gap || b.x > a.x + a.width + gap || a.y > b.y + b.height + gap || b.y > a.y + a.height + gap;
        if (apart) continue;
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        open[left] = { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
        open.splice(right, 1);
        merged = true;
        break;
      }
      if (merged) break;
    }
  }
  return open;
}

function coreMask(lab: Float64Array, alpha: Uint8Array, width: number, height: number, tau: number, onProgress?: (fraction: number) => void): Uint8Array {
  const core = new Uint8Array(width * height);
  const limit = tau * tau;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (alpha[index] === 0) continue;
      const color = readLab(lab, index);
      let worst = 0;
      let flat = true;
      for (let dy = -1; dy <= 1 && flat; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = Math.min(width - 1, Math.max(0, x + dx));
          const ny = Math.min(height - 1, Math.max(0, y + dy));
          const next = ny * width + nx;
          if (alpha[next] === 0) {
            flat = false;
            break;
          }
          worst = Math.max(worst, labDistance2(color, readLab(lab, next)));
          if (worst >= limit) flat = false;
        }
      }
      if (flat && worst < limit) core[index] = 1;
    }
    onProgress?.((y + 1) / height);
  }
  return core;
}

function components(mask: Uint8Array, width: number, height: number, onProgress?: (fraction: number) => void): { readonly ids: Int32Array; readonly sizes: Int32Array; readonly count: number } {
  const ids = new Int32Array(mask.length);
  const sizes: number[] = [0];
  const stack: number[] = [];
  let visited = 0;
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] !== 1 || ids[start] !== 0) continue;
    const id = sizes.length;
    sizes.push(0);
    stack.push(start);
    ids[start] = id;
    while (stack.length > 0) {
      const index = stack.pop() ?? 0;
      sizes[id] = (sizes[id] ?? 0) + 1;
      const x = index % width;
      const y = (index - x) / width;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (mask[next] !== 1 || ids[next] !== 0) continue;
          ids[next] = id;
          stack.push(next);
        }
      }
      visited += 1;
      if (visited % 16384 === 0) onProgress?.(visited / mask.length);
    }
    if (start % 16384 === 0) onProgress?.(start / mask.length);
  }
  onProgress?.(1);
  return { ids, sizes: Int32Array.from(sizes), count: sizes.length - 1 };
}

function bicubicLab(linear: Float64Array, width: number, height: number, sx: number, sy: number): Lab {
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const fx = sx - x0;
  const fy = sy - y0;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let ky = -1; ky <= 2; ky += 1) {
    const wy = keys(fy - ky);
    const y = reflect101(y0 + ky, height);
    for (let kx = -1; kx <= 2; kx += 1) {
      const weight = wy * keys(fx - kx);
      const x = reflect101(x0 + kx, width);
      const offset = (y * width + x) * 3;
      red += (linear[offset] ?? 0) * weight;
      green += (linear[offset + 1] ?? 0) * weight;
      blue += (linear[offset + 2] ?? 0) * weight;
    }
  }
  return rgbToOklab({ r: linearToSrgb(red), g: linearToSrgb(green), b: linearToSrgb(blue) });
}

function blurSeparable(source: Float64Array, target: Float64Array, width: number, height: number, kernel: Float64Array, onProgress?: (fraction: number) => void): void {
  const radius = (kernel.length - 1) >> 1;
  const temp = new Float64Array(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let tap = -radius; tap <= radius; tap += 1) sum += (source[y * width + reflect101(x + tap, width)] ?? 0) * (kernel[tap + radius] ?? 0);
      temp[y * width + x] = sum;
    }
    onProgress?.(0.5 * (y + 1) / height);
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let tap = -radius; tap <= radius; tap += 1) sum += (temp[reflect101(y + tap, height) * width + x] ?? 0) * (kernel[tap + radius] ?? 0);
      target[y * width + x] = sum;
    }
    onProgress?.(0.5 + 0.5 * (y + 1) / height);
  }
}

function gaussianKernel(sigma: number): Float64Array {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float64Array(radius * 2 + 1);
  let sum = 0;
  for (let index = -radius; index <= radius; index += 1) {
    const weight = Math.exp(-(index * index) / (2 * sigma * sigma));
    kernel[index + radius] = weight;
    sum += weight;
  }
  for (let index = 0; index < kernel.length; index += 1) kernel[index] = (kernel[index] ?? 0) / sum;
  return kernel;
}

function projectLab(color: Lab, left: Lab, right: Lab): { readonly t: number; readonly distance: number } {
  const dL = right.L - left.L;
  const da = right.a - left.a;
  const db = right.b - left.b;
  const length = dL * dL + da * da + db * db;
  const raw = length === 0 ? 0 : ((color.L - left.L) * dL + (color.a - left.a) * da + (color.b - left.b) * db) / length;
  const t = Math.min(1, Math.max(0, raw));
  const mixed = { L: left.L + t * dL, a: left.a + t * da, b: left.b + t * db };
  return { t, distance: Math.sqrt(labDistance2(color, mixed)) };
}

function nearestLab(color: Lab, centers: readonly Lab[]): number {
  let best = 0;
  let score = Infinity;
  for (let index = 0; index < centers.length; index += 1) {
    const center = centers[index];
    if (center === undefined) continue;
    const gap = labDistance2(color, center);
    if (gap < score) {
      score = gap;
      best = index;
    }
  }
  return best;
}

function bitList(mask: number, kCount: number): number[] {
  const bits: number[] = [];
  for (let label = 0; label < kCount; label += 1) if ((mask & (1 << label)) !== 0) bits.push(label);
  return bits;
}

function squareOffsets(radius: number): { x: number; y: number }[] {
  const offsets: { x: number; y: number }[] = [];
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) offsets.push({ x, y });
  }
  return offsets;
}

function diskOffsets(radius: number): { x: number; y: number }[] {
  const offsets: { x: number; y: number }[] = [];
  const limit = radius * radius;
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) if (x * x + y * y <= limit) offsets.push({ x, y });
  }
  return offsets;
}

function readLab(lab: Float64Array, index: number): Lab {
  return { L: lab[index * 3] ?? 0, a: lab[index * 3 + 1] ?? 0, b: lab[index * 3 + 2] ?? 0 };
}

function countOf(mask: Uint8Array): number {
  let count = 0;
  for (const value of mask) if (value === 1) count += 1;
  return count;
}

function zeroLab(): Lab {
  return { L: 0, a: 0, b: 0 };
}

function reflect101(index: number, length: number): number {
  if (length <= 1) return 0;
  const span = length * 2 - 2;
  let wrapped = index % span;
  if (wrapped < 0) wrapped += span;
  return wrapped >= length ? span - wrapped : wrapped;
}

function keys(distance: number): number {
  const t = Math.abs(distance);
  if (t <= 1) return (1.25 * t - 2.25) * t * t + 1;
  if (t < 2) return ((-0.75 * t + 3.75) * t - 6) * t + 3;
  return 0;
}

function srgbToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel: number): number {
  const value = Math.min(1, Math.max(0, channel));
  const encoded = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, encoded)) * 255);
}

function hex(red: number, green: number, blue: number): string {
  return "#" + [red, green, blue].map((value) => Math.min(255, Math.max(0, value)).toString(16).padStart(2, "0")).join("");
}
