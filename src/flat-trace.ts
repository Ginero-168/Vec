import { labDistance2, oklabToRgb, rgbToOklab, type Lab, type RGB } from "./color.ts";
import { MIN_SIDE as NOISE_JUDGED_SIDE, wouldDenoise } from "./denoise.ts";
import { mergeNearCenters } from "./jpeg-clean.ts";

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
  // The letters of a full-bleed mark are enclosed by its border colour like separate logos on a backdrop; split into
  // per-letter plates, each kept its square of the mark's colour and the rest of the square was lost.
  if (fullBleed(rgba, width, height)) return [{ x: 0, y: 0, width, height }];
  const found = enclosedBoxes(rgba, width, height, onProgress);
  if (found.length <= 1) return [{ x: 0, y: 0, width, height }];
  return found;
}

async function subjectBoxesAsync(rgba: Uint8Array, width: number, height: number, context: CooperativeContext, onProgress: (fraction: number) => void): Promise<SubjectBox[]> {
  if (fullBleed(rgba, width, height)) return [{ x: 0, y: 0, width, height }];
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

/** How far (per sRGB channel) a pixel may sit from the corner colour and still be the backdrop; JPEG backdrops paint
 * as several near-white labels. */
export const BACKDROP_TOLERANCE = 24;

/** The opaque pixels within BACKDROP_TOLERANCE of `color` that are 4-connected to the frame: the backdrop flood. */
export function floodBorder(rgba: Uint8Array, width: number, height: number, color: readonly [number, number, number]): { readonly seen: Uint8Array; readonly count: number } {
  const [tr, tg, tb] = color;
  const near = (pixel: number) => (rgba[pixel * 4 + 3] ?? 0) >= 250
    && Math.abs((rgba[pixel * 4] ?? 0) - tr) <= BACKDROP_TOLERANCE
    && Math.abs((rgba[pixel * 4 + 1] ?? 0) - tg) <= BACKDROP_TOLERANCE
    && Math.abs((rgba[pixel * 4 + 2] ?? 0) - tb) <= BACKDROP_TOLERANCE;
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  const push = (pixel: number) => {
    if (seen[pixel] === 1 || !near(pixel)) return;
    seen[pixel] = 1;
    stack.push(pixel);
  };
  for (let x = 0; x < width; x += 1) { push(x); push((height - 1) * width + x); }
  for (let y = 0; y < height; y += 1) { push(y * width); push(y * width + width - 1); }
  let count = 0;
  while (stack.length > 0) {
    const pixel = stack.pop() ?? 0;
    count += 1;
    const x = pixel % width;
    if (x > 0) push(pixel - 1);
    if (x < width - 1) push(pixel + 1);
    if (pixel >= width) push(pixel - width);
    if (pixel < (height - 1) * width) push(pixel + width);
  }
  return { seen, count };
}

/**
 * Whether the border colour `color`, flooded as `seen` (`count` pixels), is the subject rather than a backdrop. Vec's
 * output is placed on a white artboard, and removing the backdrop is meant to remove the canvas the mark sits on.
 * - Nothing visible would be left on that artboard: no opaque pixel outside the flood is more than BACKDROP_TOLERANCE
 *   from white (si-javascript: a yellow square to every edge, its letters white or cut out).
 * - Or the border colour is not the artboard (more than BACKDROP_TOLERANCE from white on some channel) and covers more
 *   of the canvas than everything else together: the mark's own plate runs to every edge (a yellow square with dark
 *   letters, a white glyph on a dark tile). A coloured frame round a white canvas covers far less and stays a backdrop.
 */
export function borderIsSubject(rgba: Uint8Array, width: number, height: number, color: readonly [number, number, number], seen: Uint8Array, count: number): boolean {
  if (!leavesVisibleSubject(rgba, seen)) return true;
  const white = color.every((channel) => 255 - channel <= BACKDROP_TOLERANCE);
  return !white && count * 2 > width * height;
}

function leavesVisibleSubject(rgba: Uint8Array, seen: Uint8Array): boolean {
  for (let pixel = 0; pixel < seen.length; pixel += 1) {
    if (seen[pixel] === 1 || (rgba[pixel * 4 + 3] ?? 0) < 250) continue;
    if (255 - (rgba[pixel * 4] ?? 0) > BACKDROP_TOLERANCE || 255 - (rgba[pixel * 4 + 1] ?? 0) > BACKDROP_TOLERANCE || 255 - (rgba[pixel * 4 + 2] ?? 0) > BACKDROP_TOLERANCE) return true;
  }
  return false;
}

/** borderIsSubject on the source raster, before it is split into subjects: a full-bleed mark is one subject. */
function fullBleed(rgba: Uint8Array, width: number, height: number): boolean {
  const corner = cornerColor(rgba, width, height);
  if (corner === null) return false;
  const color = [parseInt(corner.slice(1, 3), 16), parseInt(corner.slice(3, 5), 16), parseInt(corner.slice(5, 7), 16)] as const;
  const { seen, count } = floodBorder(rgba, width, height, color);
  return count < width * height && borderIsSubject(rgba, width, height, color, seen, count);
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
    const red = source[offset] ?? 0;
    const green = source[offset + 1] ?? 0;
    const blue = source[offset + 2] ?? 0;
    opacity[index] = source[offset + 3] ?? 0;
    alpha[index] = (opacity[index] ?? 0) >= 128 ? 255 : 0;
    const redLinear = SRGB_LINEAR[red] ?? 0;
    const greenLinear = SRGB_LINEAR[green] ?? 0;
    const blueLinear = SRGB_LINEAR[blue] ?? 0;
    const labOffset = index * 3;
    writeOklab(lab, labOffset, redLinear, greenLinear, blueLinear);
    linear[labOffset] = redLinear;
    linear[labOffset + 1] = greenLinear;
    linear[labOffset + 2] = blueLinear;
    if (index % Math.max(1, width * 2) === 0) onProgress?.(0.04 * index / count);
  }
  let core = coreMask(lab, alpha, width, height, CORE_TAU, (fraction) => onProgress?.(0.04 + fraction * 0.1));
  if (countOf(core) < 8) core = coreMask(lab, alpha, width, height, 0.08, (fraction) => onProgress?.(0.14 + fraction * 0.1));
  const userK = maxColors > 0 ? Math.min(K_MAX, Math.max(2, Math.round(maxColors))) : 0;
  const sampled = buildPalette(lab, core, width, height, userK, (fraction) => onProgress?.(0.24 + fraction * 0.08));
  const found = recoverThinColors(lab, alpha, core, width, height, sampled);
  // A preprocess that returned new pixels cleaned a lossy raster: fold the near-duplicate centres its noise split.
  const centers = source !== rgba ? mergeNearCenters(found, lab, core) : found;
  const edges = edgeRule(rgba, source, width, height, centers, sampled.length);
  const labels = assignLabels(linear, lab, core, alpha, opacity, width, height, centers, (fraction) => onProgress?.(0.32 + fraction * 0.54), edges);
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
      const red = source[offset] ?? 0;
      const green = source[offset + 1] ?? 0;
      const blue = source[offset + 2] ?? 0;
      opacity[index] = source[offset + 3] ?? 0;
      alpha[index] = (opacity[index] ?? 0) >= 128 ? 255 : 0;
      const redLinear = SRGB_LINEAR[red] ?? 0;
      const greenLinear = SRGB_LINEAR[green] ?? 0;
      const blueLinear = SRGB_LINEAR[blue] ?? 0;
      const labOffset = index * 3;
      writeOklab(lab, labOffset, redLinear, greenLinear, blueLinear);
      linear[labOffset] = redLinear;
      linear[labOffset + 1] = greenLinear;
      linear[labOffset + 2] = blueLinear;
    }
    onProgress(0.04 * (y + 1) / height);
    await cooperate(context);
  }
  let core = await coreMaskAsync(lab, alpha, width, height, CORE_TAU, context);
  if (countOf(core) < 8) core = await coreMaskAsync(lab, alpha, width, height, 0.08, context);
  onProgress(0.14);
  const userK = maxColors > 0 ? Math.min(K_MAX, Math.max(2, Math.round(maxColors))) : 0;
  const sampled = buildPalette(lab, core, width, height, userK);
  const found = recoverThinColors(lab, alpha, core, width, height, sampled);
  const centers = source !== rgba ? mergeNearCenters(found, lab, core) : found;
  onProgress(0.26);
  const edges = edgeRule(rgba, source, width, height, centers, sampled.length);
  const labels = await assignLabelsAsync(linear, lab, core, alpha, opacity, width, height, centers, context, (fraction) => onProgress(0.26 + fraction * 0.64), edges);
  const colors = fillColors(source, alpha, core, labels, width, height, centers);
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
      const colorOffset = index * 3;
      const lightness = lab[colorOffset]!;
      const greenRed = lab[colorOffset + 1]!;
      const blueYellow = lab[colorOffset + 2]!;
      let worst = 0;
      let flat = true;
      for (let dy = -1; dy <= 1 && flat; dy += 1) {
        for (let dx = -1; dx <= 1 && flat; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = Math.min(width - 1, Math.max(0, x + dx));
          const ny = Math.min(height - 1, Math.max(0, y + dy));
          const next = ny * width + nx;
          if (alpha[next] === 0) {
            flat = false;
            break;
          }
          const nextOffset = next * 3;
          const dL = lightness - lab[nextOffset]!;
          const da = greenRed - lab[nextOffset + 1]!;
          const db = blueYellow - lab[nextOffset + 2]!;
          const distance = dL * dL + da * da + db * db;
          if (distance > worst) worst = distance;
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
  onProgress: (fraction: number) => void,
  edges?: LossyEdges
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
  const bicubic = bicubicTable(width, height);
  const bitLists = new Map<number, readonly number[]>();
  const tile = 48;
  for (let y0 = 0; y0 < height; y0 += tile) {
    const y1 = Math.min(height, y0 + tile);
    for (let y = y0; y < y1; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (alpha[y * width + x] === 0) continue;
        const mask = allow[y * width + x] ?? 0;
        let bits = bitLists.get(mask);
        if (bits === undefined) {
          bits = bitList(mask, kCount);
          bitLists.set(mask, bits);
        }
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
            labels[at] = edges === undefined
              ? explain(bicubicLabAt(linear, width, bicubic, ux, uy), bits, centers)
              : explainLossy(edges, width, bicubic, ux, uy, bits, centers);
          }
        }
      }
      onProgress(0.18 + 0.25 * (y + 1) / height);
      await cooperate(context);
    }
  }
  await cleanLabelsAsync(labels, upW, upH, kCount, Math.floor(SPECK_SOURCE * UP * UP), context, (fraction) => onProgress(0.43 + fraction * 0.2));
  if (smoothsLabels(edges)) await smoothLabelsAsync(labels, upW, upH, kCount, SMOOTH_SOURCE * UP, context, (fraction) => onProgress(0.63 + fraction * 0.28));
  else if (edges !== undefined) {
    foldThinMixes(labels, upW, upH, edges.centers, edges.sampled ?? edges.centers.length, (ux, uy, ends) => explainLossy(edges, width, bicubic, ux, uy, ends, centers));
    const before = labels.slice();
    if (Math.min(width, height) >= NOISE_JUDGED_SIDE) {
      await smoothLabelsAsync(labels, upW, upH, kCount, FINE_SIGMA, context, () => {});
      keepFineDetail(before, labels, upW, upH);
    }
  }
  cutTransparent(labels, opacity, width, height);
  onProgress(1);
  return labels;
}

async function nearestCoreLabelAsync(coreLabel: Int16Array, width: number, height: number, context: CooperativeContext): Promise<Int16Array> {
  const nearest = new Int16Array(coreLabel.length);
  nearest.fill(-1);
  const queue = new Int32Array(coreLabel.length);
  let tail = 0;
  for (let index = 0; index < coreLabel.length; index += 1) {
    const label = coreLabel[index] ?? -1;
    if (label < 0) continue;
    nearest[index] = label;
    queue[tail] = index;
    tail += 1;
    if (index % 8192 === 0) await cooperate(context);
  }
  for (let cursor = 0; cursor < tail; cursor += 1) {
    const index = queue[cursor]!;
    const label = nearest[index]!;
    const x = index % width;
    if (x > 0 && nearest[index - 1]! < 0) {
      nearest[index - 1] = label;
      queue[tail] = index - 1;
      tail += 1;
    }
    if (x + 1 < width && nearest[index + 1]! < 0) {
      nearest[index + 1] = label;
      queue[tail] = index + 1;
      tail += 1;
    }
    if (index >= width && nearest[index - width]! < 0) {
      nearest[index - width] = label;
      queue[tail] = index - width;
      tail += 1;
    }
    if (index + width < coreLabel.length && nearest[index + width]! < 0) {
      nearest[index + width] = label;
      queue[tail] = index + width;
      tail += 1;
    }
    if (cursor % 4096 === 0) await cooperate(context);
  }
  return nearest;
}

async function cleanLabelsAsync(labels: Uint8Array, width: number, height: number, kCount: number, minArea: number, context: CooperativeContext, onProgress: (fraction: number) => void): Promise<void> {
  const retry = new Uint8Array(kCount);
  for (let pass = 0; pass < 2; pass += 1) {
    for (let label = 0; label < kCount; label += 1) {
      if (pass === 1 && retry[label] !== 1) continue;
      const components = await smallLabelComponentsAsync(labels, label, width, height, minArea, context);
      const small = components.mask;
      if (components.any) {
        const replacement = await nearestOutsideAsync(labels, small, components.pixels, width, height, context);
        for (let cursor = 0; cursor < components.pixels.length; cursor += 1) {
          const index = components.pixels[cursor]!;
          const next = replacement[index] ?? label;
          if (next !== label) retry[next] = 1;
          labels[index] = next;
          if (cursor % 16384 === 0) await cooperate(context);
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

async function nearestOutsideAsync(labels: Uint8Array, small: Uint8Array, smallPixels: Uint32Array, width: number, height: number, context: CooperativeContext): Promise<Uint8Array> {
  const nearest = new Uint8Array(labels.length);
  const queue = new Int32Array(labels.length);
  let tail = 0;
  if (smallPixels.length <= labels.length / 32) {
    const boundary: number[] = [];
    for (let cursor = 0; cursor < smallPixels.length; cursor += 1) {
      const index = smallPixels[cursor]!;
      const x = index % width;
      if (x > 0 && small[index - 1] === 0) boundary.push(index - 1);
      if (x + 1 < width && small[index + 1] === 0) boundary.push(index + 1);
      if (index >= width && small[index - width] === 0) boundary.push(index - width);
      if (index + width < small.length && small[index + width] === 0) boundary.push(index + width);
      if (cursor % 4096 === 0) await cooperate(context);
    }
    boundary.sort((left, right) => left - right);
    let previous = -1;
    for (const index of boundary) {
      if (index === previous) continue;
      previous = index;
      nearest[index] = labels[index] ?? 0;
      queue[tail] = index;
      tail += 1;
    }
  } else {
    for (let index = 0; index < small.length; index += 1) {
      if (small[index] === 1) continue;
      const x = index % width;
      const touchesSmall =
        (x > 0 && small[index - 1] === 1) ||
        (x + 1 < width && small[index + 1] === 1) ||
        (index >= width && small[index - width] === 1) ||
        (index + width < small.length && small[index + width] === 1);
      if (touchesSmall) {
        nearest[index] = labels[index] ?? 0;
        queue[tail] = index;
        tail += 1;
      }
      if (index % 16384 === 0) await cooperate(context);
    }
  }
  for (let cursor = 0; cursor < tail; cursor += 1) {
    const index = queue[cursor] ?? 0;
    const x = index % width;
    const label = nearest[index] ?? 0;
    if (x > 0 && small[index - 1] === 1) {
      small[index - 1] = 2;
      nearest[index - 1] = label;
      queue[tail] = index - 1;
      tail += 1;
    }
    if (x + 1 < width && small[index + 1] === 1) {
      small[index + 1] = 2;
      nearest[index + 1] = label;
      queue[tail] = index + 1;
      tail += 1;
    }
    if (index >= width && small[index - width] === 1) {
      small[index - width] = 2;
      nearest[index - width] = label;
      queue[tail] = index - width;
      tail += 1;
    }
    if (index + width < labels.length && small[index + width] === 1) {
      small[index + width] = 2;
      nearest[index + width] = label;
      queue[tail] = index + width;
      tail += 1;
    }
    if (cursor % 4096 === 0) await cooperate(context);
  }
  return nearest;
}

async function smoothLabelsAsync(labels: Uint8Array, width: number, height: number, kCount: number, sigma: number, context: CooperativeContext, onProgress: (fraction: number) => void): Promise<void> {
  if (!(sigma > 0)) return;
  const kernel = gaussianKernel(sigma);
  const radius = (kernel.length - 1) >> 1;
  const { candidates, candidateSpans, neededSpans, xSamples, ySamples, activeLabels } = await smoothingMasksAsync(labels, width, height, radius, kCount, context);
  const { horizontalScores, scoreOffsets, vertical } = await smoothingScoresAsync(labels, width, kCount, kernel, activeLabels, candidateSpans, neededSpans, xSamples, ySamples, context);
  const next = labels.slice();
  const taps = kernel.length;
  for (let span = 0; span < candidateSpans.length; span += 3) {
    const row = candidateSpans[span]!;
    const start = candidateSpans[span + 1]!;
    const end = candidateSpans[span + 2]!;
    const yOffset = (row / width) * taps;
    for (let x = start; x < end; x += 1) {
      const index = row + x;
      let winner = activeLabels[0] ?? 0;
      let best = -1;
      for (let channel = 0; channel < activeLabels.length; channel += 1) {
        const label = activeLabels[channel]!;
        let sum = 0;
        if ((vertical[index]! & (1 << label)) !== 0) {
          for (let tap = 0; tap < taps; tap += 1) {
            const sampleY = ySamples[yOffset + tap]!;
            const sampleIndex = sampleY * width + x;
            const scoreOffset = scoreOffsets[sampleIndex]!;
            sum += horizontalScores[scoreOffset + channel]! * kernel[tap]!;
          }
        }
        if (sum > best) {
          best = sum;
          winner = label;
        }
      }
      if (activeLabels.length > 0) next[index] = winner;
    }
    onProgress((span + 3) / Math.max(3, candidateSpans.length));
    await cooperate(context);
  }
  for (let index = 0; index < labels.length; index += 1) {
    if (candidates[index] === 0 && labels[index] === 255) next[index] = 0;
    if (index % 16384 === 0) await cooperate(context);
  }
  labels.set(next);
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

function assignLabels(linear: Float64Array, lab: Float64Array, core: Uint8Array, alpha: Uint8Array, opacity: Uint8Array, width: number, height: number, centers: Lab[], onProgress?: (fraction: number) => void, edges?: LossyEdges): Uint8Array {
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
  const bicubic = bicubicTable(width, height);
  const bitLists = new Map<number, readonly number[]>();
  const tile = 48;
  for (let y0 = 0; y0 < height; y0 += tile) {
    const y1 = Math.min(height, y0 + tile);
    for (let y = y0; y < y1; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (alpha[y * width + x] === 0) continue;
        const mask = allow[y * width + x] ?? 0;
        let bits = bitLists.get(mask);
        if (bits === undefined) {
          bits = bitList(mask, kCount);
          bitLists.set(mask, bits);
        }
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
            labels[at] = edges === undefined
              ? explain(bicubicLabAt(linear, width, bicubic, ux, uy), bits, centers)
              : explainLossy(edges, width, bicubic, ux, uy, bits, centers);
          }
        }
      }
      onProgress?.(0.65 + 0.12 * (y + 1) / height);
    }
  }
  cleanLabels(labels, upW, upH, kCount, Math.floor(SPECK_SOURCE * UP * UP), (fraction) => onProgress?.(0.77 + fraction * 0.09));
  if (smoothsLabels(edges)) smoothLabels(labels, upW, upH, kCount, SMOOTH_SOURCE * UP, (fraction) => onProgress?.(0.86 + fraction * 0.1));
  else if (edges !== undefined) {
    foldThinMixes(labels, upW, upH, edges.centers, edges.sampled ?? edges.centers.length, (ux, uy, ends) => explainLossy(edges, width, bicubic, ux, uy, ends, centers));
    const before = labels.slice();
    if (Math.min(width, height) >= NOISE_JUDGED_SIDE) {
      smoothLabels(labels, upW, upH, kCount, FINE_SIGMA);
      keepFineDetail(before, labels, upW, upH);
    }
  }
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
  const queue = new Int32Array(coreLabel.length);
  let tail = 0;
  for (let index = 0; index < coreLabel.length; index += 1) {
    const label = coreLabel[index] ?? -1;
    if (label < 0) continue;
    nearest[index] = label;
    queue[tail] = index;
    tail += 1;
    if (index % 16384 === 0) onProgress?.(0.4 * index / coreLabel.length);
  }
  for (let cursor = 0; cursor < tail; cursor += 1) {
    const index = queue[cursor]!;
    const label = nearest[index]!;
    const x = index % width;
    if (x > 0 && nearest[index - 1]! < 0) {
      nearest[index - 1] = label;
      queue[tail] = index - 1;
      tail += 1;
    }
    if (x + 1 < width && nearest[index + 1]! < 0) {
      nearest[index + 1] = label;
      queue[tail] = index + 1;
      tail += 1;
    }
    if (index >= width && nearest[index - width]! < 0) {
      nearest[index - width] = label;
      queue[tail] = index - width;
      tail += 1;
    }
    if (index + width < coreLabel.length && nearest[index + width]! < 0) {
      nearest[index + width] = label;
      queue[tail] = index + width;
      tail += 1;
    }
    if (cursor % 4096 === 0) onProgress?.(0.4 + 0.6 * cursor / Math.max(1, tail));
  }
  onProgress?.(1);
  return nearest;
}

// A lossy (JPEG) edge is decided mostly in gamma-encoded sRGB, where the encoder and every rasteriser mixed it: a pixel
// half covered by blue on white is the sRGB midpoint of the two. Interpolating in linear light and splitting at the
// OKLab midpoint put the switch near 57% blue instead, and on the 2-3 px wide ramps q60 leaves, that moved each
// saturated ink 0.1-0.2 px into white (gl-figma-128-q60's blue circle +0.18 px). The split weighs sRGB and OKLab equally (0.5):
// q60 also quantises luma, and on long straight ink/white edges that pulls the sRGB 50% point up to 0.2 px into the
// ink; the pure sRGB split grew gl-microsoft-128-q60's white gap 10% (worst IoU 0.984 -> 0.906). Weights 0.5-0.8 keep
// that gap at IoU 0.95-0.98; 0.85 and up do not. 0.5 is the neutral point of that 0.5-0.8 passing band (equal say for
// both midpoints), not a bench optimum. Clean rasters split at the pure sRGB midpoint (see edgeRule).
const LOSSY_SRGB_WEIGHT = 0.5;

/**
 * How a sub-pixel between two inks is decided. Every rasteriser mixes an edge pixel in gamma-encoded sRGB (resvg, the
 * bench's renderer, as well), so a pixel half covered by ink is the sRGB midpoint of the two inks, and the edge is
 * where the sRGB-interpolated colour passes that midpoint. A clean raster is split there exactly (weight 1). The old
 * rule, linear-light interpolation and the OKLab midpoint, put the switch away from 50 % coverage by an amount that
 * depends on the two colours: the 8x plate sat up to 1.5 plate px outside (si-spotify) or 1.6 px inside (si-ubuntu)
 * the ground truth. A lossy raster that was cleaned keeps LOSSY_SRGB_WEIGHT; one too small to clean (< 96 px) keeps
 * the old rule, since its luma quantisation was never measured against the sRGB split; so does a raster with
 * transparency (below), which also keeps alpha output unchanged.
 */
function edgeRule(rgba: Uint8Array, source: Uint8Array, width: number, height: number, centers: readonly Lab[], sampled: number): LossyEdges | undefined {
  if (source !== rgba) return lossyEdges(source, width * height, centers);
  if (wouldDenoise(rgba, width, height)) return undefined;
  // A raster with transparency keeps the old rule: the sRGB split reads colour alone, and a pixel's coverage of the
  // transparent backdrop lives in its alpha (a lone 39 % stroke has the same colour as the clear pixels around it).
  for (let index = 3; index < rgba.length; index += 4) if ((rgba[index] ?? 0) !== 255) return undefined;
  return { ...lossyEdges(source, width * height, centers, 1), sampled };
}

/**
 * The label smoothing (a Gaussian-weighted majority vote, sigma SMOOTH_SOURCE) is for edges decided from noisy
 * pixels. On a clean raster the sRGB split already follows the smooth 50 % isoline of the bicubic interpolant, and the
 * vote only moves it: a majority filter pulls a boundary toward its centre of curvature and thins narrow features
 * (si-spotify's white arcs lost 1.5 plate px; tw-apple-64's ink offset +0.71 -> +0.02 plate px without it).
 */
function smoothsLabels(edges: LossyEdges | undefined): boolean {
  return edges === undefined || edges.weight !== 1;
}

// How far (sRGB units) a centre may sit off the line between two others and still be their mix: the tolerance the
// backdrop halo peel uses for the same question (trace-pipeline HALO_RESIDUAL).
const MIX_RESIDUAL = 16;

/**
 * What a ring label folds into. A centre within MIX_RESIDUAL of a solid label is that colour (a near-duplicate
 * k-means split off along its anti-aliased edge: gl-chrome's #FBC525 beside #FBC116, tw-pizza's second red and
 * white), so it is that label alone. Otherwise the two solid labels it mixes: the pair whose sRGB segment passes
 * within MIX_RESIDUAL of its centre (closest first), or null.
 */
function ringEnds(centers: readonly RGB[], label: number, solid: readonly boolean[]): readonly number[] | null {
  const color = centers[label]!;
  let twin = -1, nearest = MIX_RESIDUAL;
  centers.forEach((other, index) => {
    const distance = Math.hypot(other.r - color.r, other.g - color.g, other.b - color.b);
    if (solid[index] && distance <= nearest) [twin, nearest] = [index, distance];
  });
  if (twin >= 0) return [twin];
  let ends: readonly [number, number] | null = null, smallest = Infinity;
  for (let a = 0; a < centers.length; a += 1) for (let b = a + 1; b < centers.length; b += 1) {
    if (!solid[a] || !solid[b]) continue;
    const from = centers[a]!, to = centers[b]!;
    const dr = to.r - from.r, dg = to.g - from.g, db = to.b - from.b;
    const length = dr * dr + dg * dg + db * db;
    if (length === 0) continue;
    const t = Math.min(1, Math.max(0, ((color.r - from.r) * dr + (color.g - from.g) * dg + (color.b - from.b) * db) / length));
    const residual = Math.hypot(color.r - from.r - t * dr, color.g - from.g - t * dg, color.b - from.b - t * db);
    if (residual <= MIX_RESIDUAL && residual < smallest) {
      smallest = residual;
      ends = [a, b];
    }
  }
  return ends;
}

/**
 * On the unsmoothed clean-raster path, a label is an anti-aliasing ring when no part of it is wider than the band an
 * edge leaves in the sub-pixel labels, and its centre is an sRGB mix of two solid labels. A rasteriser mixes one pixel
 * row; the labels are decided on the bicubic interpolant, whose step response rises between the pixel centres either
 * side of that row, so the band is at most two source pixels (2 UP sub-pixels) wide (si-mcdonalds-128-white's frame
 * column: 11 sub-pixels). A label with any part that contains a square of side 2 UP + 1 (survives an erosion by it) is
 * solid: a real colour even when it is a mix of two others (om-gear's greys all lie on the black-white line). Centres
 * recovered from thin strokes (index >= `sampled`) are never rings: recoverThinColors already rejected pixels that
 * mix their two sides, and om-gear-32's one-pixel #888888 ring is real. Each sub-pixel of a ring is split again
 * between its two ends alone (`split`, the same sRGB midpoint rule), so the edge lands at 50 % coverage instead of at
 * the far side of the ring. The majority-vote smoothing used to erase such rings; without it they were traced as a
 * separate pale layer along every light ink (gl-slack-256-white's #50CCF2, si-mcdonalds-128-white).
 */
export function foldThinMixes(labels: Uint8Array, width: number, height: number, centers: readonly RGB[], sampled: number, split: (x: number, y: number, ends: readonly number[]) => number): void {
  // One pass for each label's bounding box; a label narrower or shorter than the square cannot contain it.
  const count = centers.length;
  const minX = new Int32Array(count).fill(width), minY = new Int32Array(count).fill(height);
  const maxX = new Int32Array(count).fill(-1), maxY = new Int32Array(count).fill(-1);
  for (let y = 0, index = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1, index += 1) {
      const label = labels[index]!;
      if (label >= count) continue;
      if (x < minX[label]!) minX[label] = x;
      if (x > maxX[label]!) maxX[label] = x;
      if (y < minY[label]!) minY[label] = y;
      if (y > maxY[label]!) maxY[label] = y;
    }
  }
  const side = 2 * UP + 1;
  const present = centers.map((_, label) => maxX[label]! >= 0);
  const solid = centers.map((_, label) => present[label] === true && (label >= sampled || containsSquare(labels, width, label, minX[label]!, minY[label]!, maxX[label]!, maxY[label]!, side)));
  const ringOf: (readonly number[] | null)[] = centers.map((_, label) => (!present[label] || solid[label] ? null : ringEnds(centers, label, solid)));
  if (!ringOf.some((ends) => ends !== null)) return;
  for (let index = 0; index < labels.length; index += 1) {
    const ends = ringOf[labels[index]!];
    if (ends === null || ends === undefined) continue;
    labels[index] = ends.length === 1 ? ends[0]! : split(index % width, Math.floor(index / width), ends);
  }
}

/** Whether `label` holds a side x side square of sub-pixels inside its bounding box (an erosion by it leaves a cell). */
function containsSquare(labels: Uint8Array, width: number, label: number, x0: number, y0: number, x1: number, y1: number, side: number): boolean {
  if (x1 - x0 + 1 < side || y1 - y0 + 1 < side) return false;
  const span = x1 - x0 + 1;
  const column = new Int32Array(span);
  for (let y = y0; y <= y1; y += 1) {
    let run = 0;
    const row = y * width;
    for (let x = x0; x <= x1; x += 1) {
      run = labels[row + x] === label ? run + 1 : 0;
      const at = x - x0;
      // column[at]: consecutive rows, ending here, whose horizontal run ending at x is at least `side`.
      column[at] = run >= side ? column[at]! + 1 : 0;
      if (column[at]! >= side) return true;
    }
  }
  return false;
}

// `sampled`: how many leading centres buildPalette took from flat core pixels; the rest are recovered thin strokes.
type LossyEdges = { readonly srgb: Float64Array; readonly centers: readonly RGB[]; readonly weight: number; readonly sampled?: number };

function lossyEdges(source: Uint8Array, count: number, centers: readonly Lab[], weight = LOSSY_SRGB_WEIGHT): LossyEdges {
  const srgb = new Float64Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    srgb[index * 3] = source[index * 4] ?? 0;
    srgb[index * 3 + 1] = source[index * 4 + 1] ?? 0;
    srgb[index * 3 + 2] = source[index * 4 + 2] ?? 0;
  }
  return { srgb, centers: centers.map((center) => oklabToRgb(center)), weight };
}

function explainLossy(edges: LossyEdges, width: number, table: BicubicTable, x: number, y: number, bits: readonly number[], centers: readonly Lab[]): number {
  const xOffset = x * 4;
  const yOffset = y * 4;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let ky = 0; ky < 4; ky += 1) {
    const weightY = table.yWeights[yOffset + ky]!;
    const sampleY = table.yIndices[yOffset + ky]!;
    for (let kx = 0; kx < 4; kx += 1) {
      const weight = weightY * table.xWeights[xOffset + kx]!;
      const offset = (sampleY * width + table.xIndices[xOffset + kx]!) * 3;
      red += edges.srgb[offset]! * weight;
      green += edges.srgb[offset + 1]! * weight;
      blue += edges.srgb[offset + 2]! * weight;
    }
  }
  const rgb = { r: Math.min(255, Math.max(0, red)), g: Math.min(255, Math.max(0, green)), b: Math.min(255, Math.max(0, blue)) };
  return explain(rgbToOklab(rgb), bits, centers, (a, b, oklab) => {
    const from = edges.centers[a]!;
    const to = edges.centers[b]!;
    const dr = to.r - from.r, dg = to.g - from.g, db = to.b - from.b;
    const length = dr * dr + dg * dg + db * db;
    const srgb = length === 0 ? oklab : ((rgb.r - from.r) * dr + (rgb.g - from.g) * dg + (rgb.b - from.b) * db) / length;
    return edges.weight * srgb + (1 - edges.weight) * oklab;
  });
}

/** The label that explains `sample`: the nearest centre, or the nearer end of the nearest two-centre mix. `mix` gives
 * the sample's position between two centres when the OKLab projection is not the right measure (lossy edges). */
function explain(sample: Lab, bits: readonly number[], centers: readonly Lab[], mix?: (a: number, b: number, oklab: number) => number): number {
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
        best = (mix === undefined ? projected.t : mix(a, b, projected.t)) < 0.5 ? a : b;
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
  const retry = new Uint8Array(kCount);
  for (let pass = 0; pass < 2; pass += 1) {
    for (let label = 0; label < kCount; label += 1) {
      if (pass === 1 && retry[label] !== 1) continue;
      const components = smallLabelComponents(labels, label, width, height, minArea, (fraction) => onProgress?.(((pass * kCount + label) / (2 * Math.max(1, kCount))) + fraction * 0.5 / Math.max(1, kCount)));
      const small = components.mask;
      if (!components.any) continue;
      const replacement = nearestOutside(labels, small, components.pixels, width, height, (fraction) => onProgress?.(((pass * kCount + label) / (2 * Math.max(1, kCount))) + 0.5 / Math.max(1, kCount) + fraction * 0.5 / Math.max(1, kCount)));
      for (const index of components.pixels) {
        const next = replacement[index] ?? label;
        if (next !== label) retry[next] = 1;
        labels[index] = next;
      }
      onProgress?.((pass * kCount + label + 1) / (2 * Math.max(1, kCount)));
    }
  }
  onProgress?.(1);
}

function nearestOutside(labels: Uint8Array, small: Uint8Array, smallPixels: Uint32Array, width: number, height: number, onProgress?: (fraction: number) => void): Uint8Array {
  const nearest = new Uint8Array(labels.length);
  const queue = new Int32Array(labels.length);
  let tail = 0;
  if (smallPixels.length <= labels.length / 32) {
    const boundary: number[] = [];
    for (const index of smallPixels) {
      const x = index % width;
      if (x > 0 && small[index - 1] === 0) boundary.push(index - 1);
      if (x + 1 < width && small[index + 1] === 0) boundary.push(index + 1);
      if (index >= width && small[index - width] === 0) boundary.push(index - width);
      if (index + width < small.length && small[index + width] === 0) boundary.push(index + width);
    }
    boundary.sort((left, right) => left - right);
    let previous = -1;
    for (const index of boundary) {
      if (index === previous) continue;
      previous = index;
      nearest[index] = labels[index] ?? 0;
      queue[tail] = index;
      tail += 1;
    }
  } else {
    for (let index = 0; index < small.length; index += 1) {
      if (small[index] === 1) continue;
      const x = index % width;
      const touchesSmall =
        (x > 0 && small[index - 1] === 1) ||
        (x + 1 < width && small[index + 1] === 1) ||
        (index >= width && small[index - width] === 1) ||
        (index + width < small.length && small[index + width] === 1);
      if (!touchesSmall) continue;
      nearest[index] = labels[index] ?? 0;
      queue[tail] = index;
      tail += 1;
    }
  }
  for (let cursor = 0; cursor < tail; cursor += 1) {
    const index = queue[cursor] ?? 0;
    const x = index % width;
    const label = nearest[index] ?? 0;
    if (x > 0 && small[index - 1] === 1) {
      small[index - 1] = 2;
      nearest[index - 1] = label;
      queue[tail] = index - 1;
      tail += 1;
    }
    if (x + 1 < width && small[index + 1] === 1) {
      small[index + 1] = 2;
      nearest[index + 1] = label;
      queue[tail] = index + 1;
      tail += 1;
    }
    if (index >= width && small[index - width] === 1) {
      small[index - width] = 2;
      nearest[index - width] = label;
      queue[tail] = index - width;
      tail += 1;
    }
    if (index + width < labels.length && small[index + width] === 1) {
      small[index + width] = 2;
      nearest[index + width] = label;
      queue[tail] = index + width;
      tail += 1;
    }
    if (cursor % 16384 === 0) onProgress?.(cursor / Math.max(1, tail));
  }
  return nearest;
}

/**
 * The clean-raster (sRGB split) path's light smoothing: a majority vote with sigma half a source pixel, against the
 * per-sub-pixel stair-steps the split leaves along a straight or round edge. Two limits keep it to that job.
 * - It moves an edge by one sub-pixel at most (FINE_BAND): the split already put the edge within a sub-pixel of 50 %
 *   coverage, so a larger move is the vote overriding the coverage.
 * - It leaves the parts of a label no wider than the band an edge leaves (2 UP sub-pixels, the AA-ring bound in
 *   foldThinMixes), on both sides of their edge: there the vote reads both of the part's edges at once and eats it,
 *   so a tip or a hairline at 32-64 px shrank (si-spotify-32-white's arcs, om-grinning-64-white's eyes); kept on its
 *   own side only, the wide neighbour's vote fattened it instead.
 * - It runs only where the JPEG test can judge the raster (short side >= denoise MIN_SIDE): a smaller JPEG reads as
 *   clean, and the vote then evens its noise into the edges (gl-figma-64-q60 is 43 px wide).
 */
const FINE_SIGMA = UP / 2;
const FINE_BAND = 1;

function keepFineDetail(before: Uint8Array, labels: Uint8Array, width: number, height: number): void {
  const wide = openedBySquare(before, width, height, 2 * UP + 1);
  for (let index = 0; index < labels.length; index += 1) {
    if (labels[index] === before[index]) continue;
    const own = before[index]!;
    const x = index % width, y = (index - x) / width;
    let edge = false, thin = wide[index] !== 1;
    for (let dy = -FINE_BAND; dy <= FINE_BAND && !thin; dy += 1) {
      const yy = y + dy;
      if (yy < 0 || yy >= height) continue;
      for (let dx = -FINE_BAND; dx <= FINE_BAND; dx += 1) {
        const xx = x + dx;
        if (xx < 0 || xx >= width) continue;
        if (before[yy * width + xx] !== own) edge = true;
        if (wide[yy * width + xx] !== 1) { thin = true; break; }
      }
    }
    if (thin || !edge) labels[index] = own;
  }
}

/** 1 where a pixel lies in a side x side square that one label fills: the label's morphological opening. */
function openedBySquare(labels: Uint8Array, width: number, height: number, side: number): Uint8Array {
  const radius = (side - 1) / 2;
  // Erosion: a run of `side` equal labels centred on the pixel, horizontally, then vertically over those rows.
  const row = new Uint8Array(labels.length);
  for (let y = 0; y < height; y += 1) {
    let start = 0;
    for (let x = 1; x <= width; x += 1) {
      if (x < width && labels[y * width + x] === labels[y * width + start]) continue;
      for (let at = start + radius; at < x - radius; at += 1) row[y * width + at] = 1;
      start = x;
    }
  }
  const centre = new Uint8Array(labels.length);
  for (let x = 0; x < width; x += 1) {
    let start = 0;
    for (let y = 1; y <= height; y += 1) {
      const here = y * width + x, above = here - width;
      if (y < height && row[here] === 1 && row[above] === 1 && labels[here] === labels[above]) continue;
      if (row[start * width + x] === 1) for (let at = start + radius; at < y - radius; at += 1) centre[at * width + x] = 1;
      start = y;
    }
  }
  // Dilation by the same square (separable): every pixel of a fitted square, which holds that one label.
  return dilateLine(dilateLine(centre, width, height, radius, 1, width), height, width, radius, width, 1);
}

/** Binary dilation along one axis: `count` lines of `length` pixels, `step` apart along a line, `stride` between lines. */
function dilateLine(mask: Uint8Array, length: number, count: number, radius: number, step: number, stride: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  const prefix = new Int32Array(length + 1);
  for (let line = 0; line < count; line += 1) {
    const base = line * stride;
    for (let at = 0; at < length; at += 1) prefix[at + 1] = prefix[at]! + mask[base + at * step]!;
    for (let at = 0; at < length; at += 1) {
      if (prefix[Math.min(length, at + radius + 1)]! - prefix[Math.max(0, at - radius)]! > 0) out[base + at * step] = 1;
    }
  }
  return out;
}

function smoothLabels(labels: Uint8Array, width: number, height: number, kCount: number, sigma: number, onProgress?: (fraction: number) => void): void {
  if (!(sigma > 0)) return;
  const kernel = gaussianKernel(sigma);
  const radius = (kernel.length - 1) >> 1;
  const { candidates, candidateSpans, ySamples, activeLabels, neededSpans, xSamples } = smoothingMasks(labels, width, height, radius, kCount);
  const { horizontalScores, scoreOffsets, vertical } = smoothingScores(labels, width, kCount, kernel, activeLabels, candidateSpans, neededSpans, xSamples, ySamples);
  const next = labels.slice();
  const taps = kernel.length;
  for (let span = 0; span < candidateSpans.length; span += 3) {
    const row = candidateSpans[span]!;
    const start = candidateSpans[span + 1]!;
    const end = candidateSpans[span + 2]!;
    const yOffset = (row / width) * taps;
    for (let x = start; x < end; x += 1) {
      const index = row + x;
      let winner = activeLabels[0] ?? 0;
      let best = -1;
      for (let channel = 0; channel < activeLabels.length; channel += 1) {
        const label = activeLabels[channel]!;
        let sum = 0;
        if ((vertical[index]! & (1 << label)) !== 0) {
          for (let tap = 0; tap < taps; tap += 1) {
            const sampleY = ySamples[yOffset + tap]!;
            const sampleIndex = sampleY * width + x;
            const scoreOffset = scoreOffsets[sampleIndex]!;
            sum += horizontalScores[scoreOffset + channel]! * kernel[tap]!;
          }
        }
        if (sum > best) {
          best = sum;
          winner = label;
        }
      }
      if (activeLabels.length > 0) next[index] = winner;
    }
    onProgress?.((span + 3) / Math.max(3, candidateSpans.length));
  }
  for (let index = 0; index < labels.length; index += 1) {
    if (candidates[index] === 0 && labels[index] === 255) next[index] = 0;
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

function labDistanceGreaterThan(lab: Float64Array, leftOffset: number, rightOffset: number, threshold: number): boolean {
  const dL = lab[leftOffset]! - lab[rightOffset]!;
  const da = lab[leftOffset + 1]! - lab[rightOffset + 1]!;
  const db = lab[leftOffset + 2]! - lab[rightOffset + 2]!;
  return Math.sqrt(dL * dL + da * da + db * db) > threshold;
}

function enclosedBoxes(rgba: Uint8Array, width: number, height: number, onProgress?: (fraction: number) => void): SubjectBox[] {
  const count = width * height;
  if (width < 2 || height < 2 || rgba.length < count * 4) return [];
  const lab = new Float64Array(count * 3);
  const opaque = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    opaque[index] = (rgba[offset + 3] ?? 0) >= 128 ? 1 : 0;
    const red = rgba[offset] ?? 0;
    const green = rgba[offset + 1] ?? 0;
    const blue = rgba[offset + 2] ?? 0;
    writeOklab(lab, index * 3, SRGB_LINEAR[red] ?? 0, SRGB_LINEAR[green] ?? 0, SRGB_LINEAR[blue] ?? 0);
    if (index % 16384 === 0) onProgress?.(0.2 * index / count);
  }
  const edge = new Uint8Array(count);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (opaque[index] !== 1) continue;
      const colorOffset = index * 3;
      let strong = false;
      if (x > 0) {
        const next = index - 1;
        strong = opaque[next] !== 1 || labDistanceGreaterThan(lab, colorOffset, next * 3, COLOR_FLOOR);
      }
      if (!strong && x + 1 < width) {
        const next = index + 1;
        strong = opaque[next] !== 1 || labDistanceGreaterThan(lab, colorOffset, next * 3, COLOR_FLOOR);
      }
      if (!strong && y > 0) {
        const next = index - width;
        strong = opaque[next] !== 1 || labDistanceGreaterThan(lab, colorOffset, next * 3, COLOR_FLOOR);
      }
      if (!strong && y + 1 < height) {
        const next = index + width;
        strong = opaque[next] !== 1 || labDistanceGreaterThan(lab, colorOffset, next * 3, COLOR_FLOOR);
      }
      if (strong) edge[index] = 1;
    }
    onProgress?.(0.2 + 0.2 * (y + 1) / height);
  }
  const outside = new Uint8Array(count);
  const queue = new Int32Array(count);
  let tail = 0;
  for (let x = 0; x < width; x += 1) {
    tail = seedOutside(x, edge, outside, queue, tail);
    tail = seedOutside((height - 1) * width + x, edge, outside, queue, tail);
  }
  for (let y = 0; y < height; y += 1) {
    tail = seedOutside(y * width, edge, outside, queue, tail);
    tail = seedOutside(y * width + width - 1, edge, outside, queue, tail);
  }
  for (let cursor = 0; cursor < tail; cursor += 1) {
    const index = queue[cursor]!;
    const x = index % width;
    if (x > 0) tail = seedOutside(index - 1, edge, outside, queue, tail);
    if (x + 1 < width) tail = seedOutside(index + 1, edge, outside, queue, tail);
    if (index >= width) tail = seedOutside(index - width, edge, outside, queue, tail);
    if (index + width < count) tail = seedOutside(index + width, edge, outside, queue, tail);
    if (cursor % 16384 === 0) onProgress?.(0.4 + 0.2 * cursor / Math.max(1, tail));
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
    const red = rgba[offset] ?? 0;
    const green = rgba[offset + 1] ?? 0;
    const blue = rgba[offset + 2] ?? 0;
    writeOklab(lab, index * 3, SRGB_LINEAR[red] ?? 0, SRGB_LINEAR[green] ?? 0, SRGB_LINEAR[blue] ?? 0);
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
      const colorOffset = index * 3;
      let strong = false;
      if (x > 0) {
        const next = index - 1;
        strong = opaque[next] !== 1 || labDistanceGreaterThan(lab, colorOffset, next * 3, COLOR_FLOOR);
      }
      if (!strong && x + 1 < width) {
        const next = index + 1;
        strong = opaque[next] !== 1 || labDistanceGreaterThan(lab, colorOffset, next * 3, COLOR_FLOOR);
      }
      if (!strong && y > 0) {
        const next = index - width;
        strong = opaque[next] !== 1 || labDistanceGreaterThan(lab, colorOffset, next * 3, COLOR_FLOOR);
      }
      if (!strong && y + 1 < height) {
        const next = index + width;
        strong = opaque[next] !== 1 || labDistanceGreaterThan(lab, colorOffset, next * 3, COLOR_FLOOR);
      }
      if (strong) edge[index] = 1;
    }
    onProgress(0.2 + 0.2 * (y + 1) / height);
    await cooperate(context);
  }
  const outside = new Uint8Array(count);
  const queue = new Int32Array(count);
  let tail = 0;
  for (let x = 0; x < width; x += 1) {
    tail = seedOutside(x, edge, outside, queue, tail);
    tail = seedOutside((height - 1) * width + x, edge, outside, queue, tail);
  }
  for (let y = 0; y < height; y += 1) {
    tail = seedOutside(y * width, edge, outside, queue, tail);
    tail = seedOutside(y * width + width - 1, edge, outside, queue, tail);
  }
  for (let cursor = 0; cursor < tail; cursor += 1) {
    const index = queue[cursor]!;
    const x = index % width;
    if (x > 0) tail = seedOutside(index - 1, edge, outside, queue, tail);
    if (x + 1 < width) tail = seedOutside(index + 1, edge, outside, queue, tail);
    if (index >= width) tail = seedOutside(index - width, edge, outside, queue, tail);
    if (index + width < count) tail = seedOutside(index + width, edge, outside, queue, tail);
    if (cursor % 4096 === 0) {
      onProgress(0.4 + 0.2 * cursor / Math.max(1, tail));
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

function seedOutside(index: number, edge: Uint8Array, outside: Uint8Array, queue: Int32Array, tail: number): number {
  if (edge[index] === 1 || outside[index] === 1) return tail;
  outside[index] = 1;
  queue[tail] = index;
  return tail + 1;
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
      const colorOffset = index * 3;
      const lightness = lab[colorOffset]!;
      const greenRed = lab[colorOffset + 1]!;
      const blueYellow = lab[colorOffset + 2]!;
      let worst = 0;
      let flat = true;
      for (let dy = -1; dy <= 1 && flat; dy += 1) {
        for (let dx = -1; dx <= 1 && flat; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = Math.min(width - 1, Math.max(0, x + dx));
          const ny = Math.min(height - 1, Math.max(0, y + dy));
          const next = ny * width + nx;
          if (alpha[next] === 0) {
            flat = false;
            break;
          }
          const nextOffset = next * 3;
          const dL = lightness - lab[nextOffset]!;
          const da = greenRed - lab[nextOffset + 1]!;
          const db = blueYellow - lab[nextOffset + 2]!;
          const distance = dL * dL + da * da + db * db;
          if (distance > worst) worst = distance;
          if (worst >= limit) flat = false;
        }
      }
      if (flat && worst < limit) core[index] = 1;
    }
    onProgress?.((y + 1) / height);
  }
  return core;
}

type LabelRun = { readonly y: number; readonly start: number; readonly end: number; readonly id: number };

type SmallLabelComponents = { readonly mask: Uint8Array; readonly any: boolean; readonly pixels: Uint32Array };

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

function smallLabelComponents(labels: Uint8Array, label: number, width: number, height: number, minArea: number, onProgress?: (fraction: number) => void): SmallLabelComponents {
  const parent: number[] = [0];
  const size: number[] = [0];
  const runs: LabelRun[] = [];
  let previous: LabelRun[] = [];
  for (let y = 0; y < height; y += 1) {
    const current: LabelRun[] = [];
    const row = y * width;
    const rowLabels = labels.subarray(row, row + width);
    let x = 0;
    let previousStart = 0;
    while (x < width) {
      const start = rowLabels.indexOf(label, x);
      if (start < 0) break;
      x = start + 1;
      while (x < width && rowLabels[x] === label) x += 1;
      const id = parent.length;
      parent.push(id);
      size.push(x - start);
      const run = { y, start, end: x, id };
      runs.push(run);
      current.push(run);
      while (previousStart < previous.length && (previous[previousStart]?.end ?? 0) < start) previousStart += 1;
      for (let index = previousStart; index < previous.length; index += 1) {
        const other = previous[index];
        if (other === undefined || other.start > x) break;
        let left = id;
        while ((parent[left] ?? left) !== left) left = parent[left] ?? left;
        let right = other.id;
        while ((parent[right] ?? right) !== right) right = parent[right] ?? right;
        if (left === right) continue;
        if ((size[left] ?? 0) < (size[right] ?? 0)) [left, right] = [right, left];
        parent[right] = left;
        size[left] = (size[left] ?? 0) + (size[right] ?? 0);
      }
    }
    previous = current;
    onProgress?.((y + 1) / height);
  }

  const small = new Uint8Array(labels.length);
  const pixels: number[] = [];
  let any = false;
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index];
    if (run === undefined) continue;
    let root = run.id;
    while ((parent[root] ?? root) !== root) root = parent[root] ?? root;
    if ((size[root] ?? 0) >= minArea) continue;
    any = true;
    const row = run.y * width;
    for (let x = run.start; x < run.end; x += 1) {
      const pixel = row + x;
      small[pixel] = 1;
      pixels.push(pixel);
    }
    if (index % 4096 === 0) onProgress?.(0.5 + 0.5 * (index + 1) / Math.max(1, runs.length));
  }
  onProgress?.(1);
  return { mask: small, any, pixels: Uint32Array.from(pixels) };
}

async function smallLabelComponentsAsync(labels: Uint8Array, label: number, width: number, height: number, minArea: number, context: CooperativeContext): Promise<SmallLabelComponents> {
  const parent: number[] = [0];
  const size: number[] = [0];
  const runs: LabelRun[] = [];
  let previous: LabelRun[] = [];
  for (let y = 0; y < height; y += 1) {
    const current: LabelRun[] = [];
    const row = y * width;
    const rowLabels = labels.subarray(row, row + width);
    let x = 0;
    let previousStart = 0;
    while (x < width) {
      const start = rowLabels.indexOf(label, x);
      if (start < 0) break;
      x = start + 1;
      while (x < width && rowLabels[x] === label) x += 1;
      const id = parent.length;
      parent.push(id);
      size.push(x - start);
      const run = { y, start, end: x, id };
      runs.push(run);
      current.push(run);
      while (previousStart < previous.length && (previous[previousStart]?.end ?? 0) < start) previousStart += 1;
      for (let index = previousStart; index < previous.length; index += 1) {
        const other = previous[index];
        if (other === undefined || other.start > x) break;
        let left = id;
        while ((parent[left] ?? left) !== left) left = parent[left] ?? left;
        let right = other.id;
        while ((parent[right] ?? right) !== right) right = parent[right] ?? right;
        if (left === right) continue;
        if ((size[left] ?? 0) < (size[right] ?? 0)) [left, right] = [right, left];
        parent[right] = left;
        size[left] = (size[left] ?? 0) + (size[right] ?? 0);
      }
    }
    previous = current;
    await cooperate(context);
  }

  const small = new Uint8Array(labels.length);
  const pixels: number[] = [];
  let any = false;
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index];
    if (run === undefined) continue;
    let root = run.id;
    while ((parent[root] ?? root) !== root) root = parent[root] ?? root;
    if ((size[root] ?? 0) < minArea) {
      any = true;
      const row = run.y * width;
      for (let x = run.start; x < run.end; x += 1) {
        const pixel = row + x;
        small[pixel] = 1;
        pixels.push(pixel);
      }
    }
    if (index % 4096 === 0) await cooperate(context);
  }
  return { mask: small, any, pixels: Uint32Array.from(pixels) };
}

type BicubicTable = {
  readonly xIndices: Int32Array;
  readonly xWeights: Float64Array;
  readonly yIndices: Int32Array;
  readonly yWeights: Float64Array;
};

function bicubicTable(width: number, height: number): BicubicTable {
  const upWidth = width * UP;
  const upHeight = height * UP;
  const xIndices = new Int32Array(upWidth * 4);
  const xWeights = new Float64Array(upWidth * 4);
  const yIndices = new Int32Array(upHeight * 4);
  const yWeights = new Float64Array(upHeight * 4);
  for (let x = 0; x < upWidth; x += 1) {
    const sx = (x + 0.5) / UP - 0.5;
    const x0 = Math.floor(sx);
    const fx = sx - x0;
    const offset = x * 4;
    for (let tap = 0; tap < 4; tap += 1) {
      const kx = tap - 1;
      xIndices[offset + tap] = reflect101(x0 + kx, width);
      xWeights[offset + tap] = keys(fx - kx);
    }
  }
  for (let y = 0; y < upHeight; y += 1) {
    const sy = (y + 0.5) / UP - 0.5;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    const offset = y * 4;
    for (let tap = 0; tap < 4; tap += 1) {
      const ky = tap - 1;
      yIndices[offset + tap] = reflect101(y0 + ky, height);
      yWeights[offset + tap] = keys(fy - ky);
    }
  }
  return { xIndices, xWeights, yIndices, yWeights };
}

function bicubicLabAt(linear: Float64Array, width: number, table: BicubicTable, x: number, y: number): Lab {
  const xOffset = x * 4;
  const yOffset = y * 4;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let ky = 0; ky < 4; ky += 1) {
    const weightY = table.yWeights[yOffset + ky]!;
    const sampleY = table.yIndices[yOffset + ky]!;
    for (let kx = 0; kx < 4; kx += 1) {
      const weight = weightY * table.xWeights[xOffset + kx]!;
      const sampleX = table.xIndices[xOffset + kx]!;
      const offset = (sampleY * width + sampleX) * 3;
      red += linear[offset]! * weight;
      green += linear[offset + 1]! * weight;
      blue += linear[offset + 2]! * weight;
    }
  }
  return rgbToOklab({ r: linearToSrgb(red), g: linearToSrgb(green), b: linearToSrgb(blue) });
}

type SmoothingMasks = {
  readonly candidates: Uint8Array;
  readonly needed: Uint8Array;
  readonly candidateSpans: Int32Array;
  readonly neededSpans: Int32Array;
  readonly xSamples: Int32Array;
  readonly ySamples: Int32Array;
  readonly activeLabels: readonly number[];
};

type SmoothingScores = {
  readonly horizontalScores: Float64Array;
  readonly scoreOffsets: Int32Array;
  readonly vertical: Uint16Array;
};

function maskSpans(mask: Uint8Array, width: number, height: number): Int32Array {
  const spans: number[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    const rowMask = mask.subarray(row, row + width);
    let x = 0;
    while (x < width) {
      const start = rowMask.indexOf(1, x);
      if (start < 0) break;
      x = start + 1;
      while (x < width && rowMask[x] !== 0) x += 1;
      spans.push(row, start, x);
    }
  }
  return Int32Array.from(spans);
}

function dilateVertically(source: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const output = new Uint8Array(source.length);
  const counts = new Uint32Array(width);
  const initialEnd = Math.min(radius, height - 1);
  for (let y = 0; y <= initialEnd; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) counts[x] = counts[x]! + source[row + x]!;
  }
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) output[row + x] = counts[x]! > 0 ? 1 : 0;
    const remove = y - radius;
    const add = y + radius + 1;
    if (remove >= 0 || add < height) {
      const removeRow = remove * width;
      const addRow = add * width;
      for (let x = 0; x < width; x += 1) {
        if (remove >= 0) counts[x] = counts[x]! - source[removeRow + x]!;
        if (add < height) counts[x] = counts[x]! + source[addRow + x]!;
      }
    }
  }
  return output;
}

async function dilateVerticallyAsync(source: Uint8Array, width: number, height: number, radius: number, context: CooperativeContext): Promise<Uint8Array> {
  const output = new Uint8Array(source.length);
  const counts = new Uint32Array(width);
  const initialEnd = Math.min(radius, height - 1);
  for (let y = 0; y <= initialEnd; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) counts[x] = counts[x]! + source[row + x]!;
    await cooperate(context);
  }
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) output[row + x] = counts[x]! > 0 ? 1 : 0;
    const remove = y - radius;
    const add = y + radius + 1;
    if (remove >= 0 || add < height) {
      const removeRow = remove * width;
      const addRow = add * width;
      for (let x = 0; x < width; x += 1) {
        if (remove >= 0) counts[x] = counts[x]! - source[removeRow + x]!;
        if (add < height) counts[x] = counts[x]! + source[addRow + x]!;
      }
    }
    await cooperate(context);
  }
  return output;
}

function smoothingScores(
  labels: Uint8Array,
  width: number,
  kCount: number,
  kernel: Float64Array,
  activeLabels: readonly number[],
  candidateSpans: Int32Array,
  neededSpans: Int32Array,
  xSamples: Int32Array,
  ySamples: Int32Array
): SmoothingScores {
  const taps = kernel.length;
  const channels = activeLabels.length;
  let neededPixels = 0;
  for (let span = 0; span < neededSpans.length; span += 3) neededPixels += neededSpans[span + 2]! - neededSpans[span + 1]!;
  const horizontalScores = new Float64Array(neededPixels * channels);
  const scoreOffsets = new Int32Array(labels.length);
  const labelSlots = new Int16Array(kCount);
  labelSlots.fill(-1);
  for (let channel = 0; channel < channels; channel += 1) labelSlots[activeLabels[channel]!] = channel;
  const horizontal = new Uint16Array(labels.length);
  const vertical = new Uint16Array(labels.length);
  let pixel = 0;
  for (let span = 0; span < neededSpans.length; span += 3) {
    const row = neededSpans[span]!;
    const start = neededSpans[span + 1]!;
    const end = neededSpans[span + 2]!;
    for (let x = start; x < end; x += 1) {
      const index = row + x;
      let mask = 0;
      const xOffset = x * taps;
      const scoreOffset = pixel * channels;
      scoreOffsets[index] = scoreOffset;
      for (let tap = 0; tap < taps; tap += 1) {
        const sourceLabel = labels[row + xSamples[xOffset + tap]!]!;
        if (sourceLabel >= kCount) continue;
        mask |= 1 << sourceLabel;
        const channel = labelSlots[sourceLabel]!;
        if (channel >= 0) horizontalScores[scoreOffset + channel] = horizontalScores[scoreOffset + channel]! + kernel[tap]!;
      }
      horizontal[index] = mask;
      pixel += 1;
    }
  }
  for (let span = 0; span < candidateSpans.length; span += 3) {
    const row = candidateSpans[span]!;
    const start = candidateSpans[span + 1]!;
    const end = candidateSpans[span + 2]!;
    const yOffset = (row / width) * taps;
    for (let x = start; x < end; x += 1) {
      const index = row + x;
      let mask = 0;
      for (let tap = 0; tap < taps; tap += 1) mask |= horizontal[ySamples[yOffset + tap]! * width + x]!;
      vertical[index] = mask;
    }
  }
  return { horizontalScores, scoreOffsets, vertical };
}

async function smoothingScoresAsync(
  labels: Uint8Array,
  width: number,
  kCount: number,
  kernel: Float64Array,
  activeLabels: readonly number[],
  candidateSpans: Int32Array,
  neededSpans: Int32Array,
  xSamples: Int32Array,
  ySamples: Int32Array,
  context: CooperativeContext
): Promise<SmoothingScores> {
  const taps = kernel.length;
  const channels = activeLabels.length;
  let neededPixels = 0;
  for (let span = 0; span < neededSpans.length; span += 3) neededPixels += neededSpans[span + 2]! - neededSpans[span + 1]!;
  const horizontalScores = new Float64Array(neededPixels * channels);
  const scoreOffsets = new Int32Array(labels.length);
  const labelSlots = new Int16Array(kCount);
  labelSlots.fill(-1);
  for (let channel = 0; channel < channels; channel += 1) labelSlots[activeLabels[channel]!] = channel;
  const horizontal = new Uint16Array(labels.length);
  const vertical = new Uint16Array(labels.length);
  let pixel = 0;
  for (let span = 0; span < neededSpans.length; span += 3) {
    const row = neededSpans[span]!;
    const start = neededSpans[span + 1]!;
    const end = neededSpans[span + 2]!;
    for (let x = start; x < end; x += 1) {
      const index = row + x;
      let mask = 0;
      const xOffset = x * taps;
      const scoreOffset = pixel * channels;
      scoreOffsets[index] = scoreOffset;
      for (let tap = 0; tap < taps; tap += 1) {
        const sourceLabel = labels[row + xSamples[xOffset + tap]!]!;
        if (sourceLabel >= kCount) continue;
        mask |= 1 << sourceLabel;
        const channel = labelSlots[sourceLabel]!;
        if (channel >= 0) horizontalScores[scoreOffset + channel] = horizontalScores[scoreOffset + channel]! + kernel[tap]!;
      }
      horizontal[index] = mask;
      pixel += 1;
    }
    await cooperate(context);
  }
  for (let span = 0; span < candidateSpans.length; span += 3) {
    const row = candidateSpans[span]!;
    const start = candidateSpans[span + 1]!;
    const end = candidateSpans[span + 2]!;
    const yOffset = (row / width) * taps;
    for (let x = start; x < end; x += 1) {
      let mask = 0;
      for (let tap = 0; tap < taps; tap += 1) mask |= horizontal[ySamples[yOffset + tap]! * width + x]!;
      vertical[row + x] = mask;
    }
    await cooperate(context);
  }
  return { horizontalScores, scoreOffsets, vertical };
}

function smoothingMasks(labels: Uint8Array, width: number, height: number, radius: number, kCount: number): SmoothingMasks {
  const length = labels.length;
  const edges = new Uint8Array(length);
  const present = new Uint8Array(kCount);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const index = row + x;
      const label = labels[index]!;
      if (label < kCount) present[label] = 1;
      if (x + 1 < width && label !== labels[index + 1]!) {
        edges[index] = 1;
        edges[index + 1] = 1;
      }
      if (y + 1 < height && label !== labels[index + width]!) {
        edges[index] = 1;
        edges[index + width] = 1;
      }
    }
  }

  const horizontal = new Uint8Array(length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let count = 0;
    for (let x = 0; x <= Math.min(radius, width - 1); x += 1) count += edges[row + x]!;
    for (let x = 0; x < width; x += 1) {
      horizontal[row + x] = count > 0 ? 1 : 0;
      const remove = x - radius;
      const add = x + radius + 1;
      if (remove >= 0) count -= edges[row + remove]!;
      if (add < width) count += edges[row + add]!;
    }
  }
  const candidates = dilateVertically(horizontal, width, height, radius);
  const needed = dilateVertically(candidates, width, height, radius);

  const taps = radius * 2 + 1;
  const activeLabels: number[] = [];
  if (kCount > 0) activeLabels.push(0);
  for (let label = 1; label < kCount; label += 1) if (present[label] === 1) activeLabels.push(label);
  const xSamples = new Int32Array(width * taps);
  const ySamples = new Int32Array(height * taps);
  const candidateSpans = maskSpans(candidates, width, height);
  const neededSpans = maskSpans(needed, width, height);
  for (let x = 0; x < width; x += 1) {
    const offset = x * taps;
    for (let tap = 0; tap < taps; tap += 1) xSamples[offset + tap] = reflect101(x + tap - radius, width);
  }
  for (let y = 0; y < height; y += 1) {
    const offset = y * taps;
    for (let tap = 0; tap < taps; tap += 1) ySamples[offset + tap] = reflect101(y + tap - radius, height);
  }
  return { candidates, needed, candidateSpans, neededSpans, xSamples, ySamples, activeLabels };
}

async function smoothingMasksAsync(labels: Uint8Array, width: number, height: number, radius: number, kCount: number, context: CooperativeContext): Promise<SmoothingMasks> {
  const length = labels.length;
  const edges = new Uint8Array(length);
  const present = new Uint8Array(kCount);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const index = row + x;
      const label = labels[index]!;
      if (label < kCount) present[label] = 1;
      if (x + 1 < width && label !== labels[index + 1]!) {
        edges[index] = 1;
        edges[index + 1] = 1;
      }
      if (y + 1 < height && label !== labels[index + width]!) {
        edges[index] = 1;
        edges[index + width] = 1;
      }
    }
    await cooperate(context);
  }

  const horizontal = new Uint8Array(length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let count = 0;
    for (let x = 0; x <= Math.min(radius, width - 1); x += 1) count += edges[row + x]!;
    for (let x = 0; x < width; x += 1) {
      horizontal[row + x] = count > 0 ? 1 : 0;
      const remove = x - radius;
      const add = x + radius + 1;
      if (remove >= 0) count -= edges[row + remove]!;
      if (add < width) count += edges[row + add]!;
    }
    await cooperate(context);
  }
  const candidates = await dilateVerticallyAsync(horizontal, width, height, radius, context);
  const needed = await dilateVerticallyAsync(candidates, width, height, radius, context);

  const taps = radius * 2 + 1;
  const activeLabels: number[] = [];
  if (kCount > 0) activeLabels.push(0);
  for (let label = 1; label < kCount; label += 1) if (present[label] === 1) activeLabels.push(label);
  const xSamples = new Int32Array(width * taps);
  const ySamples = new Int32Array(height * taps);
  const candidateSpans = maskSpans(candidates, width, height);
  const neededSpans = maskSpans(needed, width, height);
  for (let x = 0; x < width; x += 1) {
    const offset = x * taps;
    for (let tap = 0; tap < taps; tap += 1) xSamples[offset + tap] = reflect101(x + tap - radius, width);
    await cooperate(context);
  }
  for (let y = 0; y < height; y += 1) {
    const offset = y * taps;
    for (let tap = 0; tap < taps; tap += 1) ySamples[offset + tap] = reflect101(y + tap - radius, height);
    await cooperate(context);
  }
  return { candidates, needed, candidateSpans, neededSpans, xSamples, ySamples, activeLabels };
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

const SRGB_LINEAR = Float64Array.from({ length: 256 }, (_, channel) => srgbToLinear(channel));

function writeOklab(lab: Float64Array, offset: number, red: number, green: number, blue: number): void {
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  lab[offset] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  lab[offset + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  lab[offset + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
}

function linearToSrgb(channel: number): number {
  const value = Math.min(1, Math.max(0, channel));
  const encoded = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, encoded)) * 255);
}

function hex(red: number, green: number, blue: number): string {
  return "#" + [red, green, blue].map((value) => Math.min(255, Math.max(0, value)).toString(16).padStart(2, "0")).join("");
}
