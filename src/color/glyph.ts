import { sharedJunction } from "./iso";
import { TRANSPARENT, type Rgb } from "./model";
import { oklabDistance, rgbToOklab, type Lab } from "./oklab";
import { traceMask, type PotraceCommand, type PotracePath } from "./potrace";

type Point = { x: number; y: number };

export type GlyphScope = "text" | "regions";

export type GlyphOutline = {
  readonly label: number;
  readonly outside: number;
  readonly area: number;
  readonly pixels: Int32Array;
  /** One compound path per component, in source pixels. Holes are further paths. */
  readonly paths: readonly PotracePath[];
};

export type GlyphIndex = {
  replace(points: readonly Point[], closed: boolean, inside: number, outside: number): GlyphHit | null;
  pairInBox(x0: number, y0: number, boxWidth: number, boxHeight: number): { ink: Rgb; bg: Rgb } | null;
  readonly outlines: readonly GlyphOutline[];
  /** Paint each outlined component with its surrounding label so that shape extends underneath. */
  reassign(labels: Uint16Array): Uint16Array;
};

export type GlyphHit = {
  readonly points: Point[];
  /** Coverage of this glyph, 0 on the background and 1 on the ink. */
  readonly coverage: (x: number, y: number) => number;
};

type Component = {
  readonly label: number;
  readonly outside: number;
  readonly ink: Lab;
  readonly bg: Lab;
  readonly originX: number;
  readonly originY: number;
  readonly field: Float32Array;
  readonly fieldW: number;
  readonly fieldH: number;
  rings: Point[][] | null;
  readonly coverage: (x: number, y: number) => number;
};

/**
 * Thin, high-contrast strokes (letters). Their outline is Potrace on an
 * upsampled soft mask: bicubic coverage, a gradient signed-distance smooth,
 * then a 0.5 threshold. One compound path, no stem seams.
 */
export function buildGlyphIndex(
  rgba: Uint8Array,
  labels: Uint16Array,
  palette: readonly Rgb[],
  width: number,
  height: number,
  scope: GlyphScope = "text"
): GlyphIndex {
  const found = findThinComponents(rgba, labels, palette, width, height, scope);
  return {
    outlines: found.outlines,
    reassign(source) {
      const copy = new Uint16Array(source);
      for (const outline of found.outlines) {
        if (outline.paths.length === 0) continue;
        for (let i = 0; i < outline.pixels.length; i++) {
          const pixel = outline.pixels[i];
          if (pixel === undefined) continue;
          copy[pixel] = outline.outside;
        }
      }
      return copy;
    },
    replace(points, closed, inside, outside) {
      if (found.outlines.length > 0) return null;
      return replaceChain(found.components, found.owner, points, closed, inside, outside, rgba, labels, palette, width, height);
    },
    pairInBox(x0, y0, boxWidth, boxHeight) {
      let best: Component | null = null;
      let bestCount = 0;
      const seen = new Set<number>();
      for (let y = y0; y < y0 + boxHeight; y++) {
        if (y < 0 || y >= height) continue;
        for (let x = x0; x < x0 + boxWidth; x++) {
          if (x < 0 || x >= width) continue;
          const id = found.owner[y * width + x] ?? -1;
          if (id < 0 || seen.has(id)) continue;
          seen.add(id);
          let count = 0;
          const component = found.components[id];
          if (!component) continue;
          for (let yy = y0; yy < y0 + boxHeight; yy++) {
            if (yy < 0 || yy >= height) continue;
            for (let xx = x0; xx < x0 + boxWidth; xx++) {
              if (xx < 0 || xx >= width) continue;
              if ((found.owner[yy * width + xx] ?? -1) === id) count++;
            }
          }
          if (count > bestCount) {
            bestCount = count;
            best = component;
          }
        }
      }
      if (!best || bestCount < 8) return null;
      const ink = palette[best.label];
      const bg = palette[best.outside];
      if (!ink || !bg) return null;
      return { ink, bg };
    }
  };
}

/** 4× bicubic upsample of ink-vs-background coverage, thresholded at 0.5. */
export function halfCoverageMask(
  rgba: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  boxWidth: number,
  boxHeight: number,
  ink: Rgb,
  bg: Rgb,
  scale: number
): Uint8Array {
  const pad = 2;
  const originX = x0 - pad;
  const originY = y0 - pad;
  const fieldW = boxWidth + pad * 2;
  const fieldH = boxHeight + pad * 2;
  const inkLab = rgbToOklab(ink.r, ink.g, ink.b);
  const bgLab = rgbToOklab(bg.r, bg.g, bg.b);
  const field = new Float32Array(fieldW * fieldH);
  for (let iy = 0; iy < fieldH; iy++) {
    for (let ix = 0; ix < fieldW; ix++) field[iy * fieldW + ix] = sourceCoverage(originX + ix, originY + iy, width, height, rgba, inkLab, bgLab);
  }
  const zoom = Math.max(1, scale);
  const mask = new Uint8Array(boxWidth * zoom * boxHeight * zoom);
  for (let fy = 0; fy < boxHeight * zoom; fy++) {
    for (let fx = 0; fx < boxWidth * zoom; fx++) {
      const sx = x0 + (fx + 0.5) / zoom;
      const sy = y0 + (fy + 0.5) / zoom;
      const value = bicubic(field, fieldW, fieldH, sx - originX - 0.5, sy - originY - 0.5);
      if (value >= 0.5) mask[fy * boxWidth * zoom + fx] = 1;
    }
  }
  return mask;
}

function sourceCoverage(x: number, y: number, width: number, height: number, rgba: Uint8Array, ink: Lab, bg: Lab): number {
  if (x < 0 || y < 0 || x >= width || y >= height) return 0;
  const offset = (y * width + x) * 4;
  if ((rgba[offset + 3] ?? 0) < 128) return 0;
  const lab = rgbToOklab(rgba[offset] ?? 0, rgba[offset + 1] ?? 0, rgba[offset + 2] ?? 0);
  const t = projectCoverage(lab, bg, ink);
  if (offSegment(lab, bg, ink, t) > 0.14) return 0;
  return t;
}

/** Corners of a binary mask, in source pixels. A turn over about 1px counts. */
export function maskCorners(mask: Uint8Array, maskWidth: number, maskHeight: number, originX: number, originY: number, scale: number): Point[] {
  const labels = new Uint16Array(mask.length);
  for (let i = 0; i < mask.length; i++) if (mask[i]) labels[i] = 1;
  const contours = traceBinary(labels, maskWidth, maskHeight);
  const corners: Point[] = [];
  const window = Math.max(2, scale);
  for (const contour of contours) {
    const count = contour.length;
    if (count < window * 2 + 2) continue;
    for (let i = 0; i < count; i++) {
      const previous = contour[(i - window + count) % count];
      const point = contour[i];
      const next = contour[(i + window) % count];
      if (!previous || !point || !next) continue;
      if (Math.abs(headingChange(previous, point, next)) < 1.05) continue;
      corners.push({ x: originX + point.x / scale, y: originY + point.y / scale });
    }
  }
  return corners;
}

function findThinComponents(
  rgba: Uint8Array,
  labels: Uint16Array,
  palette: readonly Rgb[],
  width: number,
  height: number,
  scope: GlyphScope
): { components: Component[]; owner: Int32Array; outlines: GlyphOutline[] } {
  const owner = new Int32Array(labels.length);
  owner.fill(-1);
  const components: Component[] = [];
  const outlines: GlyphOutline[] = [];
  const pixelCap = scope === "regions" ? Math.floor(width * height * 0.35) : 9000;
  const sideCap = scope === "regions" ? Math.max(width, height) : 180;
  const storeCap = scope === "text" ? 42000 : pixelCap;
  const storeSide = scope === "text" ? 340 : sideCap;
  const labs = palette.map((color) => rgbToOklab(color.r, color.g, color.b));
  const stack: number[] = [];
  const seen = -3;
  for (let start = 0; start < labels.length; start++) {
    const label = labels[start] ?? TRANSPARENT;
    if (label === TRANSPARENT || owner[start] !== -1) continue;
    const pixels: number[] = [];
    const adjacency = new Map<number, number>();
    stack.push(start);
    owner[start] = -2;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let dark = 0;
    let oversized = false;
    let truncated = false;
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      const x = current % width;
      const y = (current - x) / width;
      if (!truncated) {
        const spanX = Math.max(maxX, x) - Math.min(minX, x);
        const spanY = Math.max(maxY, y) - Math.min(minY, y);
        if (pixels.length >= storeCap || spanX > storeSide || spanY > storeSide) {
          truncated = true;
          oversized = true;
          owner[current] = seen;
        } else {
          pixels.push(current);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          const offset = current * 4;
          if (Math.max(rgba[offset] ?? 255, rgba[offset + 1] ?? 255, rgba[offset + 2] ?? 255) < 70) dark++;
          if (pixels.length > pixelCap || maxX - minX > sideCap || maxY - minY > sideCap) oversized = true;
        }
      }
      const neighbors = [current - 1, current + 1, current - width, current + width];
      for (const next of neighbors) {
        if (next < 0 || next >= labels.length) {
          if (!truncated) adjacency.set(TRANSPARENT, (adjacency.get(TRANSPARENT) ?? 0) + 1);
          continue;
        }
        const nx = next % width;
        if (Math.abs(nx - x) + Math.abs(Math.floor(next / width) - y) !== 1) {
          if (!truncated) adjacency.set(TRANSPARENT, (adjacency.get(TRANSPARENT) ?? 0) + 1);
          continue;
        }
        const neighbor = labels[next] ?? TRANSPARENT;
        if (neighbor === label) {
          if (owner[next] === -1) {
            owner[next] = truncated ? seen : -2;
            stack.push(next);
          }
        } else if (!truncated) adjacency.set(neighbor, (adjacency.get(neighbor) ?? 0) + 1);
      }
    }
    const display = oversized && !truncated && acceptDisplay(pixels, width, height, minX, minY, maxX, maxY, dark, adjacency, labs, label);
    if ((truncated || oversized) && !display) {
      for (const pixel of pixels) owner[pixel] = seen;
      continue;
    }
    const kind = display ? "stroke" : classifyComponent(pixels, width, height, minX, minY, maxX, maxY, dark, adjacency, labs, label, scope);
    if (!kind) {
      for (const pixel of pixels) owner[pixel] = seen;
      continue;
    }
    let outside = TRANSPARENT;
    let outsideCount = 0;
    for (const [neighbor, count] of adjacency) {
      if (count > outsideCount) {
        outside = neighbor;
        outsideCount = count;
      }
    }
    const ink = labs[label];
    const neighbor = outside === TRANSPARENT || outside >= labs.length ? null : labs[outside];
    if (!ink) {
      for (const pixel of pixels) owner[pixel] = seen;
      continue;
    }
    const bg = neighbor ?? (ink.l > 0.6 ? { l: 0.05, a: 0, b: 0 } : { l: 0.98, a: 0, b: 0 });
    if ((kind === "icon" || kind === "region") && !softBoundary(pixels, rgba, width, height, labels, label, ink, bg)) {
      for (const pixel of pixels) owner[pixel] = seen;
      continue;
    }
    const id = components.length;
    for (const pixel of pixels) owner[pixel] = id;
    const pad = 3;
    const originX = minX - pad;
    const originY = minY - pad;
    const fieldW = maxX - minX + 1 + pad * 2;
    const fieldH = maxY - minY + 1 + pad * 2;
    if (fieldW > 360 || fieldH > 360) {
      for (const pixel of pixels) owner[pixel] = seen;
      continue;
    }
    const field = new Float32Array(fieldW * fieldH);
    for (let iy = 0; iy < fieldH; iy++) {
      for (let ix = 0; ix < fieldW; ix++) {
        field[iy * fieldW + ix] = pixelCoverage(originX + ix, originY + iy, width, height, rgba, ink, bg, label, labels);
      }
    }
    const component: Component = {
      label,
      outside,
      ink,
      bg,
      originX,
      originY,
      field,
      fieldW,
      fieldH,
      rings: null,
      coverage(x, y) {
        return bicubic(field, fieldW, fieldH, x - originX - 0.5, y - originY - 0.5);
      }
    };
    const paths = coverageOutline(field, fieldW, fieldH, originX, originY);
    if (paths.length === 0) {
      for (const pixel of pixels) owner[pixel] = seen;
      continue;
    }
    components.push(component);
    outlines.push({
      label,
      outside,
      area: pixels.length,
      pixels: Int32Array.from(pixels),
      paths
    });
  }
  outlines.sort((left, right) => right.area - left.area);
  return { components, owner, outlines };
}

function classifyComponent(
  pixels: number[],
  width: number,
  height: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  dark: number,
  adjacency: Map<number, number>,
  labs: Lab[],
  label: number,
  scope: GlyphScope
): "thin" | "stroke" | "icon" | "region" | null {
  if (acceptComponent(pixels, width, height, minX, minY, maxX, maxY, dark, adjacency, labs, label)) return "thin";
  if (acceptStroke(pixels, width, height, minX, minY, maxX, maxY, dark, adjacency, labs, label)) return "stroke";
  if (scope !== "regions") return null;
  if (acceptIcon(pixels, width, height, minX, minY, maxX, maxY, adjacency, labs, label)) return "icon";
  if (acceptRegion(pixels, width, height, minX, minY, maxX, maxY)) return "region";
  return null;
}

/** A single large dark letter, such as the black “a”, kept off the shared-edge fitter. */
function acceptDisplay(
  pixels: number[],
  width: number,
  height: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  dark: number,
  adjacency: Map<number, number>,
  labs: Lab[],
  label: number
): boolean {
  if (pixels.length < 4000 || pixels.length > 42000) return false;
  if (dark * 2 <= pixels.length) return false;
  const side = Math.max(maxX - minX, maxY - minY);
  if (side < 80 || side > 340) return false;
  if (minX <= 1 || minY <= 1 || maxX >= width - 2 || maxY >= height - 2) return false;
  const fill = pixels.length / Math.max(1, (maxX - minX + 1) * (maxY - minY + 1));
  if (fill < 0.2 || fill > 0.55) return false;
  return neighborContrast(adjacency, labs, label, 0.2, 0.55);
}

/** Thicker high-contrast ink, such as the black “a”, that the thin-stroke test rejects. */
function acceptStroke(
  pixels: number[],
  width: number,
  height: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  dark: number,
  adjacency: Map<number, number>,
  labs: Lab[],
  label: number
): boolean {
  if (pixels.length < 40 || pixels.length > 4500) return false;
  if (dark * 2 <= pixels.length) return false;
  if (Math.max(maxX - minX, maxY - minY) > 120) return false;
  if (minX <= 0 || minY <= 0 || maxX >= width - 1 || maxY >= height - 1) return false;
  const box = Math.max(1, maxX - minX + 1) * Math.max(1, maxY - minY + 1);
  if (pixels.length / box > 0.58) return false;
  const radius = inradiusStats(pixels, width, height);
  if (radius.median > 6.5 || radius.max > 14) return false;
  return neighborContrast(adjacency, labs, label, 0.16, 0.45);
}

/** Compact filled icons. Large panels and flat backgrounds stay on the shared-edge fitter. */
function acceptIcon(
  pixels: number[],
  width: number,
  height: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  adjacency: Map<number, number>,
  labs: Lab[],
  label: number
): boolean {
  if (pixels.length < 80 || pixels.length > 2200) return false;
  const side = Math.max(maxX - minX, maxY - minY);
  if (side > 96 || side < 8) return false;
  if (minX <= 0 || minY <= 0 || maxX >= width - 1 || maxY >= height - 1) return false;
  const radius = inradiusStats(pixels, width, height);
  if (radius.median < 2.2 || radius.median > 48) return false;
  const box = Math.max(1, maxX - minX + 1) * Math.max(1, maxY - minY + 1);
  if (pixels.length / box > 0.9) return false;
  const aspect = Math.max(maxX - minX, maxY - minY) / Math.max(1, Math.min(maxX - minX, maxY - minY));
  if (aspect > 2.4) return false;
  return neighborContrast(adjacency, labs, label, 0.18, 0.4);
}

function acceptRegion(pixels: number[], width: number, height: number, minX: number, minY: number, maxX: number, maxY: number): boolean {
  if (pixels.length < 12 || pixels.length > width * height * 0.35) return false;
  const side = Math.max(maxX - minX, maxY - minY);
  return side <= Math.max(width, height) * 0.92;
}

function neighborContrast(adjacency: Map<number, number>, labs: Lab[], label: number, minDistance: number, minShare: number): boolean {
  let total = 0;
  let dominant = TRANSPARENT;
  let dominantCount = 0;
  for (const [neighbor, count] of adjacency) {
    total += count;
    if (count > dominantCount) {
      dominant = neighbor;
      dominantCount = count;
    }
  }
  if (total <= 0 || dominantCount / total < minShare) return false;
  const own = labs[label];
  if (!own) return false;
  if (dominant === TRANSPARENT || dominant >= labs.length) return true;
  const other = labs[dominant];
  if (!other) return false;
  return oklabDistance(own, other) >= minDistance;
}

/**
 * Bicubic coverage, signed-distance smoothing, then Potrace.
 * Small text is traced at 4×, the same scale as the glyph gate. A display
 * letter uses 2× so the contour still fits the trace budget.
 * One compound path, no stem seams.
 */
function coverageOutline(field: Float32Array, fieldW: number, fieldH: number, originX: number, originY: number): PotracePath[] {
  const side = Math.max(fieldW, fieldH);
  const scale = side > 150 ? 2 : 4;
  const maskW = fieldW * scale;
  const maskH = fieldH * scale;
  if (maskW > 1400 || maskH > 1400) return [];
  const mask = softMask(field, fieldW, fieldH, scale);
  const traced = traceMask(mask, maskW, maskH, {
    alphamax: 1,
    opttolerance: 0.2,
    turdsize: Math.round(1.5 * scale * scale),
    straightness: 0.5 * scale
  });
  const paths: PotracePath[] = [];
  for (const path of traced) {
    const scaled = scalePath(path, originX, originY, scale);
    if (scaled.commands.length >= 3 && (scaled.area >= 8 || traced.length === 1)) paths.push(scaled);
  }
  return paths;
}

function scalePath(path: PotracePath, originX: number, originY: number, scale: number): PotracePath {
  const mapX = (value: number) => originX + value / scale;
  const mapY = (value: number) => originY + value / scale;
  const commands: PotraceCommand[] = path.commands.map((command) => {
    if (command.op === "L") return { op: "L", x: mapX(command.x), y: mapY(command.y) };
    return {
      op: "C",
      x1: mapX(command.x1),
      y1: mapY(command.y1),
      x2: mapX(command.x2),
      y2: mapY(command.y2),
      x: mapX(command.x),
      y: mapY(command.y)
    };
  });
  return {
    area: Math.abs(path.area) / (scale * scale),
    start: { x: mapX(path.start.x), y: mapY(path.start.y) },
    commands
  };
}

/**
 * Bicubic coverage, a short box blur, then a 0.5 threshold.
 * The blur is a fraction of a source pixel so a straight edge stays put
 * and a one-pixel stair softens before Potrace sees it.
 */
function softMask(field: Float32Array, fieldW: number, fieldH: number, scale: number): Uint8Array {
  const maskW = fieldW * scale;
  const maskH = fieldH * scale;
  const coverage = upsampleBicubic(field, fieldW, fieldH, scale);
  if (Math.max(maskW, maskH) <= 480) boxBlur(coverage, maskW, maskH, 1);
  const mask = new Uint8Array(maskW * maskH);
  for (let i = 0; i < coverage.length; i++) if ((coverage[i] ?? 0) >= 0.5) mask[i] = 1;
  return mask;
}

function boxBlur(field: Float32Array, width: number, height: number, radius: number): void {
  const tmp = new Float32Array(field.length);
  const span = radius * 2 + 1;
  const widthLimit = width - 1;
  const heightLimit = height - 1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += field[row + Math.min(widthLimit, Math.max(0, x))] ?? 0;
    for (let x = 0; x < width; x++) {
      tmp[row + x] = sum / span;
      sum -= field[row + Math.min(widthLimit, Math.max(0, x - radius))] ?? 0;
      sum += field[row + Math.min(widthLimit, Math.max(0, x + radius + 1))] ?? 0;
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(heightLimit, Math.max(0, y)) * width + x] ?? 0;
    for (let y = 0; y < height; y++) {
      field[y * width + x] = sum / span;
      sum -= tmp[Math.min(heightLimit, Math.max(0, y - radius)) * width + x] ?? 0;
      sum += tmp[Math.min(heightLimit, Math.max(0, y + radius + 1)) * width + x] ?? 0;
    }
  }
}

/** Hard pixel edges stay on the shared-edge fitter. Antialiased marks use Potrace. */
function softBoundary(
  pixels: number[],
  rgba: Uint8Array,
  width: number,
  height: number,
  labels: Uint16Array,
  label: number,
  ink: Lab,
  bg: Lab
): boolean {
  let border = 0;
  let partial = 0;
  for (const pixel of pixels) {
    const x = pixel % width;
    const y = (pixel - x) / width;
    const neighbors = [pixel - 1, pixel + 1, pixel - width, pixel + width];
    let edge = false;
    for (const next of neighbors) {
      if (next < 0 || next >= labels.length) {
        edge = true;
        break;
      }
      const nx = next % width;
      if (Math.abs(nx - x) + Math.abs((next - nx) / width - y) !== 1) {
        edge = true;
        break;
      }
      if ((labels[next] ?? TRANSPARENT) !== label) {
        edge = true;
        break;
      }
    }
    if (!edge) continue;
    border++;
    const coverage = pixelCoverage(x, y, width, height, rgba, ink, bg, label, labels);
    if (coverage > 0.18 && coverage < 0.82) partial++;
  }
  if (border < 12) return true;
  return partial / border >= 0.1;
}

function acceptComponent(
  pixels: number[],
  width: number,
  height: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  dark: number,
  adjacency: Map<number, number>,
  labs: Lab[],
  label: number
): boolean {
  if (pixels.length < 8 || pixels.length > 1200) return false;
  if (Math.max(maxX - minX, maxY - minY) > 96) return false;
  if (dark * 2 > pixels.length) return false;
  const radius = inradiusStats(pixels, width, height);
  if (radius.median > 2.5 || radius.max > 7) return false;
  if (rayLike(pixels, width, minX, minY, maxX, maxY)) return false;
  let dominant = TRANSPARENT;
  let dominantCount = 0;
  for (const [neighbor, count] of adjacency) {
    if (count > dominantCount) {
      dominant = neighbor;
      dominantCount = count;
    }
  }
  const own = labs[label];
  if (!own) return false;
  if (dominant === TRANSPARENT || dominant >= labs.length) return true;
  const other = labs[dominant];
  if (!other) return false;
  return oklabDistance(own, other) >= 0.18;
}

function replaceChain(
  components: readonly Component[],
  owner: Int32Array,
  points: readonly Point[],
  closed: boolean,
  inside: number,
  outside: number,
  rgba: Uint8Array,
  labels: Uint16Array,
  palette: readonly Rgb[],
  width: number,
  height: number
): GlyphHit | null {
  if (points.length < 4) return null;
  const id = componentAlong(points, owner, labels, width, height, inside, outside);
  const component = id < 0 ? undefined : components[id];
  if (!component) return null;
  const rings = ensureRings(component);
  let best: Point[] | null = null;
  let bestDistance = Infinity;
  for (const ring of rings) {
    const distance = distanceQuantile(points, ring, 0.5);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = ring;
    }
  }
  if (!best) return null;
  if (closed) {
    if (distanceQuantile(points, best, 0.5) > 0.85) return null;
    return { points: best.map((point) => ({ x: point.x, y: point.y })), coverage: component.coverage };
  }
  const snapped = snapOpenChain(points, best);
  if (!snapped) return null;
  const first = snapped[0];
  const last = snapped[snapped.length - 1];
  const origin = points[0];
  const tail = points[points.length - 1];
  if (!first || !last || !origin || !tail) return null;
  const start = sharedJunction(origin, width, height, rgba, labels, palette);
  const end = sharedJunction(tail, width, height, rgba, labels, palette);
  first.x = start.x;
  first.y = start.y;
  last.x = end.x;
  last.y = end.y;
  return { points: snapped, coverage: component.coverage };
}

function snapOpenChain(points: readonly Point[], ring: readonly Point[]): Point[] | null {
  const distances = points.map((point) => nearestDistance(point, ring));
  let close = 0;
  for (const distance of distances) if (distance <= 0.9) close++;
  if (close < points.length * 0.72) return null;
  const out: Point[] = [];
  let changed = false;
  let cursor = 0;
  while (cursor < points.length) {
    const distance = distances[cursor] ?? Infinity;
    if (distance > 0.9) {
      const point = points[cursor];
      if (point) out.push({ x: point.x, y: point.y });
      cursor++;
      continue;
    }
    let end = cursor;
    while (end < points.length && (distances[end] ?? Infinity) <= 0.9) end++;
    const run = points.slice(cursor, end);
    const arc = run.length >= 6 ? projectRun(ring, run) : null;
    if (arc) {
      changed = true;
      const start = out.length > 0 ? 1 : 0;
      for (let i = start; i < arc.length; i++) {
        const point = arc[i];
        if (point) out.push(point);
      }
    } else {
      for (const point of run) out.push({ x: point.x, y: point.y });
    }
    cursor = end;
  }
  return changed && out.length >= 2 ? out : null;
}

function projectRun(ring: readonly Point[], run: readonly Point[]): Point[] | null {
  const start = run[0];
  const end = run[run.length - 1];
  if (!start || !end) return null;
  const arc = extractArc(ring, start, end, run);
  if (!arc || arc.length < 2) return null;
  if (distanceQuantile(run, arc, 0.8) > 1.1) return null;
  if (polylineLength(arc) < polylineLength(run) * 0.55) return null;
  return arc;
}

function nearestDistance(point: Point, ring: readonly Point[]): number {
  let best = Infinity;
  for (const other of ring) {
    const distance = (other.x - point.x) ** 2 + (other.y - point.y) ** 2;
    if (distance < best) best = distance;
  }
  return Math.sqrt(best);
}

function distanceQuantile(guide: readonly Point[], ring: readonly Point[], quantile: number): number {
  if (guide.length === 0 || ring.length === 0) return Infinity;
  const step = Math.max(1, Math.floor(guide.length / 48));
  const distances: number[] = [];
  for (let i = 0; i < guide.length; i += step) {
    const point = guide[i];
    if (point) distances.push(nearestDistance(point, ring));
  }
  if (distances.length === 0) return Infinity;
  distances.sort((left, right) => left - right);
  return distances[Math.min(distances.length - 1, Math.floor(distances.length * quantile))] ?? Infinity;
}

function polylineLength(points: readonly Point[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    if (from && to) length += Math.hypot(to.x - from.x, to.y - from.y);
  }
  return length;
}

function componentAlong(
  points: readonly Point[],
  owner: Int32Array,
  labels: Uint16Array,
  width: number,
  height: number,
  inside: number,
  outside: number
): number {
  const step = Math.max(1, Math.floor(points.length / 8));
  for (let i = 0; i < points.length - 1; i += step) {
    const from = points[i];
    const to = points[i + 1];
    if (!from || !to) continue;
    const edge = unitEdge(from.x, from.y, to.x, to.y);
    if (!edge) continue;
    const insideIndex = edge.inside[1] * width + edge.inside[0];
    const outsideIndex = edge.outside[1] * width + edge.outside[0];
    if (insideIndex >= 0 && insideIndex < labels.length && (labels[insideIndex] ?? TRANSPARENT) === inside) {
      const id = owner[insideIndex] ?? -1;
      if (id >= 0) return id;
    }
    if (outsideIndex >= 0 && outsideIndex < labels.length && (labels[outsideIndex] ?? TRANSPARENT) === outside) {
      const id = owner[outsideIndex] ?? -1;
      if (id >= 0) return id;
    }
  }
  return -1;
}

function ensureRings(component: Component): Point[][] {
  if (component.rings) return component.rings;
  const scale = 4;
  const maskW = component.fieldW * scale;
  const maskH = component.fieldH * scale;
  const mask = new Uint16Array(maskW * maskH);
  for (let fy = 0; fy < maskH; fy++) {
    for (let fx = 0; fx < maskW; fx++) {
      const sx = component.originX + (fx + 0.5) / scale;
      const sy = component.originY + (fy + 0.5) / scale;
      if (component.coverage(sx, sy) >= 0.5) mask[fy * maskW + fx] = 1;
    }
  }
  const contours = traceBinary(mask, maskW, maskH);
  const rings = contours
    .filter((contour) => contour.length >= 8)
    .map((contour) => {
      const scaled = contour.map((point) => ({
        x: component.originX + point.x / scale,
        y: component.originY + point.y / scale
      }));
      const sampled = resampleClosed(scaled, 0.42);
      const simplified = simplifyRing(sampled, 0.16);
      return simplified.length > 700 ? simplified : regularizeWidth(simplified, component.coverage);
    });
  component.rings = rings;
  return rings;
}

function resampleClosed(points: Point[], spacing: number): Point[] {
  if (points.length < 4) return points;
  const first = points[0];
  if (!first) return points;
  const out: Point[] = [{ x: first.x, y: first.y }];
  let carried = 0;
  let previous = first;
  const count = points.length;
  for (let i = 1; i <= count; i++) {
    const next = points[i % count];
    if (!next) continue;
    let dx = next.x - previous.x;
    let dy = next.y - previous.y;
    let length = Math.hypot(dx, dy);
    let guard = 0;
    while (length > 1e-6 && carried + length >= spacing && guard++ < 8) {
      const t = (spacing - carried) / length;
      const x = previous.x + dx * t;
      const y = previous.y + dy * t;
      if (i === count && Math.hypot(x - first.x, y - first.y) < spacing * 0.6) {
        carried = spacing;
        break;
      }
      out.push({ x, y });
      previous = { x, y };
      dx = next.x - x;
      dy = next.y - y;
      length = Math.hypot(dx, dy);
      carried = 0;
    }
    carried += length;
    previous = next;
  }
  if (out.length >= 2) {
    const last = out[out.length - 1];
    if (last && Math.hypot(last.x - first.x, last.y - first.y) < spacing * 0.45) out.pop();
  }
  return out.length >= 4 ? out : points;
}

function simplifyRing(points: readonly Point[], epsilon: number): Point[] {
  if (points.length < 8) return points.map((point) => ({ x: point.x, y: point.y }));
  let far = 1;
  let best = 0;
  const origin = points[0];
  if (!origin) return points.map((point) => ({ x: point.x, y: point.y }));
  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    if (!point) continue;
    const distance = (point.x - origin.x) ** 2 + (point.y - origin.y) ** 2;
    if (distance > best) {
      best = distance;
      far = i;
    }
  }
  const first = douglas(points, 0, far, epsilon);
  const second = douglas(points, far, points.length, epsilon);
  const merged = first.concat(second.slice(1));
  const last = merged[merged.length - 1];
  const head = merged[0];
  if (last && head && Math.hypot(last.x - head.x, last.y - head.y) < 0.02) merged.pop();
  return merged.length >= 4 ? merged : points.map((point) => ({ x: point.x, y: point.y }));
}

function douglas(points: readonly Point[], start: number, end: number, epsilon: number): Point[] {
  const from = points[start];
  const to = points[end] ?? points[0];
  if (!from || !to || end <= start + 1) return from ? [{ x: from.x, y: from.y }] : [];
  let farthest = start;
  let worst = 0;
  for (let i = start + 1; i < end; i++) {
    const point = points[i];
    if (!point) continue;
    const distance = pointLineDistance(point.x, point.y, from.x, from.y, to.x, to.y);
    if (distance > worst) {
      worst = distance;
      farthest = i;
    }
  }
  if (worst <= epsilon) return [{ x: from.x, y: from.y }, { x: to.x, y: to.y }];
  const left = douglas(points, start, farthest, epsilon);
  const right = douglas(points, farthest, end, epsilon);
  return left.concat(right.slice(1));
}

function regularizeWidth(points: Point[], coverage: (x: number, y: number) => number): Point[] {
  const count = points.length;
  if (count < 16) return points;
  const widths: number[] = [];
  const hits: { index: number; width: number; nx: number; ny: number }[] = [];
  for (let i = 0; i < count; i++) {
    const previous = points[(i - 2 + count) % count];
    const point = points[i];
    const next = points[(i + 2) % count];
    if (!previous || !point || !next) continue;
    if (Math.abs(headingChange(previous, point, next)) > 0.7) continue;
    const tx = next.x - previous.x;
    const ty = next.y - previous.y;
    const length = Math.hypot(tx, ty);
    if (length < 0.3) continue;
    const nx = -ty / length;
    const ny = tx / length;
    const width = rayWidth(points, i, nx, ny);
    if (width === null || width < 0.7 || width > 3.6) continue;
    widths.push(width);
    hits.push({ index: i, width, nx, ny });
  }
  if (widths.length < 8) return points;
  widths.sort((left, right) => left - right);
  const median = widths[Math.floor(widths.length / 2)] ?? 0;
  const out = points.map((point) => ({ x: point.x, y: point.y }));
  for (const hit of hits) {
    const shift = Math.max(-0.28, Math.min(0.28, (hit.width - median) / 2));
    if (Math.abs(shift) < 0.08) continue;
    const point = points[hit.index];
    if (!point) continue;
    const moved = clampCoverage({ x: point.x + hit.nx * shift, y: point.y + hit.ny * shift }, point, coverage);
    const slot = out[hit.index];
    if (slot) {
      slot.x = moved.x;
      slot.y = moved.y;
    }
  }
  return out;
}

function clampCoverage(moved: Point, origin: Point, coverage: (x: number, y: number) => number): Point {
  let x = moved.x;
  let y = moved.y;
  if (Math.hypot(x - origin.x, y - origin.y) > 0.36) return { x: origin.x, y: origin.y };
  for (let iteration = 0; iteration < 6; iteration++) {
    const value = coverage(x, y);
    if (Number.isNaN(value) || (value >= 0.2 && value <= 0.8)) return { x, y };
    const target = value < 0.2 ? 0.32 : 0.68;
    const dx = coverage(x + 0.2, y) - coverage(x - 0.2, y);
    const dy = coverage(x, y + 0.2) - coverage(x, y - 0.2);
    const gradient = dx * dx + dy * dy;
    if (gradient < 1e-8) break;
    const scale = ((target - value) / gradient) * 0.2;
    x += dx * scale;
    y += dy * scale;
    if (Math.hypot(x - origin.x, y - origin.y) > 0.4) return { x: origin.x, y: origin.y };
  }
  const value = coverage(x, y);
  if (!Number.isNaN(value) && value >= 0.2 && value <= 0.8) return { x, y };
  return { x: origin.x, y: origin.y };
}

function rayWidth(points: readonly Point[], index: number, nx: number, ny: number): number | null {
  const origin = points[index];
  if (!origin) return null;
  const count = points.length;
  let best = Infinity;
  for (let i = 0; i < count; i++) {
    const gap = Math.min(Math.abs(i - index), count - Math.abs(i - index));
    if (gap < 6) continue;
    const from = points[i];
    const to = points[(i + 1) % count];
    if (!from || !to) continue;
    const hit = raySegment(origin, nx, ny, from, to);
    if (hit !== null && hit < best) best = hit;
  }
  return best < 4 ? best : null;
}

function raySegment(origin: Point, nx: number, ny: number, from: Point, to: Point): number | null {
  const sx = to.x - from.x;
  const sy = to.y - from.y;
  const denom = nx * sy - ny * sx;
  if (Math.abs(denom) < 1e-8) return null;
  const qx = from.x - origin.x;
  const qy = from.y - origin.y;
  const t = (qx * sy - qy * sx) / denom;
  const u = (qx * ny - qy * nx) / denom;
  if (t < 0.45 || u < -0.02 || u > 1.02) return null;
  return t;
}

function extractArc(ring: readonly Point[], start: Point, end: Point, guide: readonly Point[]): Point[] | null {
  const from = nearestIndex(ring, start);
  const to = nearestIndex(ring, end);
  if (from === to) return null;
  const forward = sliceRing(ring, from, to, 1);
  const backward = sliceRing(ring, from, to, -1);
  const useForward = meanDistance(guide, forward) <= meanDistance(guide, backward);
  const arc = (useForward ? forward : backward).map((point) => ({ x: point.x, y: point.y }));
  if (arc.length < 2) return null;
  arc[0] = { x: start.x, y: start.y };
  arc[arc.length - 1] = { x: end.x, y: end.y };
  return arc;
}

function sliceRing(ring: readonly Point[], from: number, to: number, step: 1 | -1): Point[] {
  const count = ring.length;
  const out: Point[] = [];
  for (let hop = 0; hop <= count; hop++) {
    const index = (from + hop * step + count * 2) % count;
    const point = ring[index];
    if (point) out.push(point);
    if (index === to) break;
  }
  return out;
}

function nearestIndex(points: readonly Point[], target: Point): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (!point) continue;
    const distance = (point.x - target.x) ** 2 + (point.y - target.y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

function meanDistance(guide: readonly Point[], ring: readonly Point[]): number {
  if (guide.length === 0 || ring.length === 0) return Infinity;
  const step = Math.max(1, Math.floor(guide.length / 24));
  let sum = 0;
  let count = 0;
  for (let i = 0; i < guide.length; i += step) {
    const point = guide[i];
    if (!point) continue;
    let best = Infinity;
    for (const other of ring) {
      const distance = (other.x - point.x) ** 2 + (other.y - point.y) ** 2;
      if (distance < best) best = distance;
    }
    sum += Math.sqrt(best);
    count++;
  }
  return count === 0 ? Infinity : sum / count;
}

function pixelCoverage(
  x: number,
  y: number,
  width: number,
  height: number,
  rgba: Uint8Array,
  ink: Lab,
  bg: Lab,
  inkLabel: number,
  labels: Uint16Array
): number {
  if (x < 0 || y < 0 || x >= width || y >= height) return 0;
  const index = y * width + x;
  const offset = index * 4;
  if ((rgba[offset + 3] ?? 0) < 128) return 0;
  const lab = rgbToOklab(rgba[offset] ?? 0, rgba[offset + 1] ?? 0, rgba[offset + 2] ?? 0);
  const t = projectCoverage(lab, bg, ink);
  if (offSegment(lab, bg, ink, t) > 0.14) {
    if (labels.length !== width * height) return 0;
    return (labels[index] ?? TRANSPARENT) === inkLabel ? 1 : 0;
  }
  return t;
}

function projectCoverage(lab: Lab, from: Lab, to: Lab): number {
  const dl = to.l - from.l;
  const da = to.a - from.a;
  const db = to.b - from.b;
  const length2 = dl * dl + da * da + db * db;
  if (length2 < 1e-10) return 0.5;
  const t = ((lab.l - from.l) * dl + (lab.a - from.a) * da + (lab.b - from.b) * db) / length2;
  return Math.min(1, Math.max(0, t));
}

function offSegment(lab: Lab, from: Lab, to: Lab, t: number): number {
  const point = {
    l: from.l + (to.l - from.l) * t,
    a: from.a + (to.a - from.a) * t,
    b: from.b + (to.b - from.b) * t
  };
  return Math.hypot(lab.l - point.l, lab.a - point.a, lab.b - point.b);
}

/** Separable bicubic upsample. Outside samples are zero, matching `bicubic`. */
function upsampleBicubic(field: Float32Array, fieldW: number, fieldH: number, scale: number): Float32Array {
  const maskW = fieldW * scale;
  const maskH = fieldH * scale;
  const weights = new Float32Array(scale * 4);
  const base = new Int32Array(scale);
  for (let phase = 0; phase < scale; phase++) {
    const sample = (phase + 0.5) / scale - 0.5;
    const origin = Math.floor(sample);
    base[phase] = origin;
    for (let tap = 0; tap < 4; tap++) weights[phase * 4 + tap] = cubicWeight(sample - (origin - 1 + tap));
  }
  const horizontal = new Float32Array(maskW * fieldH);
  for (let y = 0; y < fieldH; y++) {
    const row = y * fieldW;
    const dest = y * maskW;
    for (let x = 0; x < maskW; x++) {
      const phase = x % scale;
      const block = (x - phase) / scale;
      const origin = block + (base[phase] ?? 0);
      let sum = 0;
      let weightSum = 0;
      for (let tap = 0; tap < 4; tap++) {
        const weight = weights[phase * 4 + tap] ?? 0;
        weightSum += weight;
        const sx = origin - 1 + tap;
        if (sx < 0 || sx >= fieldW) continue;
        sum += (field[row + sx] ?? 0) * weight;
      }
      horizontal[dest + x] = weightSum === 0 ? 0 : sum / weightSum;
    }
  }
  const out = new Float32Array(maskW * maskH);
  for (let y = 0; y < maskH; y++) {
    const phase = y % scale;
    const block = (y - phase) / scale;
    const origin = block + (base[phase] ?? 0);
    for (let x = 0; x < maskW; x++) {
      let sum = 0;
      let weightSum = 0;
      for (let tap = 0; tap < 4; tap++) {
        const weight = weights[phase * 4 + tap] ?? 0;
        weightSum += weight;
        const sy = origin - 1 + tap;
        if (sy < 0 || sy >= fieldH) continue;
        sum += (horizontal[sy * maskW + x] ?? 0) * weight;
      }
      const value = weightSum === 0 ? 0 : sum / weightSum;
      out[y * maskW + x] = value < 0 ? 0 : value > 1 ? 1 : value;
    }
  }
  return out;
}

function bicubic(field: Float32Array, width: number, height: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  let sum = 0;
  let weightSum = 0;
  for (let j = -1; j <= 2; j++) {
    const yy = y0 + j;
    const wy = cubicWeight(y - yy);
    if (wy === 0) continue;
    const clampedY = Math.min(height - 1, Math.max(0, yy));
    for (let i = -1; i <= 2; i++) {
      const xx = x0 + i;
      const wx = cubicWeight(x - xx);
      if (wx === 0) continue;
      const weight = wx * wy;
      const sample = yy < 0 || xx < 0 || yy >= height || xx >= width ? 0 : (field[clampedY * width + Math.min(width - 1, Math.max(0, xx))] ?? 0);
      sum += sample * weight;
      weightSum += weight;
    }
  }
  if (weightSum <= 1e-8) return 0;
  return sum / weightSum;
}

function cubicWeight(distance: number): number {
  const t = Math.abs(distance);
  const a = -0.5;
  if (t < 1) return (a + 2) * t * t * t - (a + 3) * t * t + 1;
  if (t < 2) return a * t * t * t - 5 * a * t * t + 8 * a * t - 4 * a;
  return 0;
}

function inradiusStats(pixels: readonly number[], width: number, height: number): { median: number; max: number } {
  const alive = new Set(pixels);
  const distance = new Map<number, number>();
  const queue: number[] = [];
  for (const pixel of pixels) {
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
    if (!exposed) continue;
    distance.set(pixel, 1);
    queue.push(pixel);
  }
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    if (current === undefined) break;
    const currentDistance = distance.get(current) ?? 1;
    const x = current % width;
    const y = (current - x) / width;
    const neighbors = [current - 1, current + 1, current - width, current + width];
    for (const next of neighbors) {
      if (!alive.has(next) || distance.has(next)) continue;
      const nx = next % width;
      if (Math.abs(nx - x) + Math.abs(Math.floor(next / width) - y) !== 1) continue;
      distance.set(next, currentDistance + 1);
      queue.push(next);
    }
  }
  const values: number[] = [];
  let max = 1;
  for (const pixel of pixels) {
    const value = distance.get(pixel) ?? 1;
    values.push(value);
    if (value > max) max = value;
  }
  values.sort((left, right) => left - right);
  return { median: values[Math.floor(values.length / 2)] ?? 1, max };
}

function rayLike(pixels: readonly number[], width: number, minX: number, minY: number, maxX: number, maxY: number): boolean {
  const dx = maxX - minX;
  const dy = maxY - minY;
  const length = Math.hypot(dx, dy);
  if (length < 10) return false;
  let maxDistance = 0;
  for (const pixel of pixels) {
    const x = pixel % width;
    const y = (pixel - x) / width;
    maxDistance = Math.max(maxDistance, pointLineDistance(x, y, minX, minY, maxX, maxY));
  }
  return maxDistance <= 2.4 && length / Math.max(1, maxDistance) >= 8;
}

function pointLineDistance(x: number, y: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  if (length < 1e-8) return Math.hypot(x - x0, y - y0);
  return Math.abs((x - x0) * dy - (y - y0) * dx) / length;
}

function unitEdge(ax: number, ay: number, bx: number, by: number): { inside: [number, number]; outside: [number, number] } | null {
  const dx = Math.round(bx - ax);
  const dy = Math.round(by - ay);
  if (Math.abs(bx - ax - dx) > 0.05 || Math.abs(by - ay - dy) > 0.05) return null;
  const x = Math.round(ax);
  const y = Math.round(ay);
  if (dx === 1 && dy === 0) return { inside: [x, y], outside: [x, y - 1] };
  if (dx === -1 && dy === 0) return { inside: [x - 1, y - 1], outside: [x - 1, y] };
  if (dx === 0 && dy === 1) return { inside: [x - 1, y], outside: [x, y] };
  if (dx === 0 && dy === -1) return { inside: [x, y - 1], outside: [x - 1, y - 1] };
  return null;
}

function headingChange(a: Point, b: Point, c: Point): number {
  const incoming = Math.atan2(b.y - a.y, b.x - a.x);
  const outgoing = Math.atan2(c.y - b.y, c.x - b.x);
  let delta = outgoing - incoming;
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function traceBinary(labels: Uint16Array, width: number, height: number): Point[][] {
  const horizontal = new Uint8Array(width * (height + 1));
  const vertical = new Uint8Array((width + 1) * height);
  const contours: Point[][] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((labels[y * width + x] ?? 0) !== 1) continue;
      if (binarySample(labels, width, height, x, y - 1) === 1) continue;
      if ((horizontal[y * width + x] ?? 0) & 1) continue;
      const contour = walkBinary(labels, width, height, x, y, horizontal, vertical);
      if (contour && contour.length >= 4) contours.push(contour);
    }
  }
  return contours;
}

function walkBinary(
  labels: Uint16Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
  horizontal: Uint8Array,
  vertical: Uint8Array
): Point[] | null {
  let x = startX;
  let y = startY;
  let dir = 0;
  const points: Point[] = [];
  const limit = (width + 1) * (height + 1) * 2;
  for (let step = 0; step < limit; step++) {
    if (step > 0 && x === startX && y === startY && dir === 0) break;
    if (!markBinary(x, y, dir, width, height, horizontal, vertical)) break;
    points.push({ x, y });
    if (dir === 0) x += 1;
    else if (dir === 1) y += 1;
    else if (dir === 2) x -= 1;
    else y -= 1;
    const turn = [(dir + 1) & 3, dir, (dir + 3) & 3, (dir + 2) & 3];
    let next = -1;
    for (const candidate of turn) {
      const right = rightBinary(x, y, candidate);
      const other = leftBinary(x, y, candidate);
      if (binarySample(labels, width, height, right[0], right[1]) === 1 && binarySample(labels, width, height, other[0], other[1]) !== 1) {
        next = candidate;
        break;
      }
    }
    if (next < 0) break;
    dir = next;
  }
  return points.length >= 4 ? points : null;
}

function binarySample(labels: Uint16Array, width: number, height: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= width || y >= height) return 0;
  return labels[y * width + x] ?? 0;
}

function rightBinary(x: number, y: number, dir: number): [number, number] {
  if (dir === 0) return [x, y];
  if (dir === 1) return [x - 1, y];
  if (dir === 2) return [x - 1, y - 1];
  return [x, y - 1];
}

function leftBinary(x: number, y: number, dir: number): [number, number] {
  if (dir === 0) return [x, y - 1];
  if (dir === 1) return [x, y];
  if (dir === 2) return [x - 1, y];
  return [x - 1, y - 1];
}

function markBinary(x: number, y: number, dir: number, width: number, height: number, horizontal: Uint8Array, vertical: Uint8Array): boolean {
  if (dir === 0 || dir === 2) {
    const edgeX = dir === 0 ? x : x - 1;
    if (edgeX < 0 || y < 0 || edgeX >= width || y > height) return false;
    const index = y * width + edgeX;
    const bit = dir === 0 ? 1 : 2;
    if ((horizontal[index] ?? 0) & bit) return false;
    horizontal[index] = (horizontal[index] ?? 0) | bit;
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
