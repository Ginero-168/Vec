import * as fs from "fs";
import { PNG } from "pngjs";

export type Raster = {
  readonly width: number;
  readonly height: number;
  readonly data: Buffer;
};

export type Oklab = { readonly L: number; readonly a: number; readonly b: number };

export function readPng(file: string): Raster {
  const png = PNG.sync.read(fs.readFileSync(file));
  return { width: png.width, height: png.height, data: png.data };
}

export function writePng(file: string, raster: Raster): void {
  const png = new PNG({ width: raster.width, height: raster.height });
  png.data = raster.data;
  fs.writeFileSync(file, PNG.sync.write(png));
}

/** Area average. Partial coverage is weighted by alpha, which keeps anti-aliased edges. */
export function areaDownscale(src: Raster, maxEdge: number): Raster {
  const longEdge = Math.max(src.width, src.height);
  if (maxEdge <= 0 || longEdge <= maxEdge) return src;
  const scale = maxEdge / longEdge;
  const dw = Math.max(1, Math.round(src.width * scale));
  const dh = Math.max(1, Math.round(src.height * scale));
  const dst = Buffer.alloc(dw * dh * 4);
  const sw = src.width;
  const sh = src.height;
  const sd = src.data;
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor((y * sh) / dh);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor((x * sw) / dw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / dw));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let weight = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * sw + x0) * 4;
        for (let xx = x0; xx < x1; xx++) {
          const al = sd[i + 3] ?? 0;
          a += al;
          n++;
          if (al > 0) {
            r += (sd[i] ?? 0) * al;
            g += (sd[i + 1] ?? 0) * al;
            b += (sd[i + 2] ?? 0) * al;
            weight += al;
          }
          i += 4;
        }
      }
      const o = (y * dw + x) * 4;
      dst[o] = weight > 0 ? Math.round(r / weight) : 0;
      dst[o + 1] = weight > 0 ? Math.round(g / weight) : 0;
      dst[o + 2] = weight > 0 ? Math.round(b / weight) : 0;
      dst[o + 3] = n > 0 ? Math.round(a / n) : 0;
    }
  }
  return { width: dw, height: dh, data: dst };
}

/** 2× bilinear upscale. Used after a downscale so coverage ramps sit between pixels. */
export function bilinear2x(src: Raster): Raster {
  const sw = src.width;
  const sh = src.height;
  const dw = sw * 2;
  const dh = sh * 2;
  const dst = Buffer.alloc(dw * dh * 4);
  const sd = src.data;
  const at = (x: number, y: number, c: number): number => {
    const xx = Math.max(0, Math.min(sw - 1, x));
    const yy = Math.max(0, Math.min(sh - 1, y));
    return sd[(yy * sw + xx) * 4 + c] ?? 0;
  };
  for (let y = 0; y < dh; y++) {
    const sy = (y + 0.5) / 2 - 0.5;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = (x + 0.5) / 2 - 0.5;
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      const o = (y * dw + x) * 4;
      for (let c = 0; c < 4; c++) {
        const v =
          at(x0, y0, c) * (1 - fx) * (1 - fy) +
          at(x0 + 1, y0, c) * fx * (1 - fy) +
          at(x0, y0 + 1, c) * (1 - fx) * fy +
          at(x0 + 1, y0 + 1, c) * fx * fy;
        dst[o + c] = Math.round(v);
      }
    }
  }
  return { width: dw, height: dh, data: dst };
}

/**
 * 3×3 mean of neighbors within a color distance. Outline and rope pixels
 * differ from their surroundings, so they stay put while grain averages out.
 */
export function gatedDenoise(src: Raster, threshold: number, passes: number): Raster {
  const limit = threshold * threshold;
  let current = src.data;
  const w = src.width;
  const h = src.height;
  for (let pass = 0; pass < passes; pass++) {
    const next = Buffer.alloc(current.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const a0 = current[i + 3] ?? 0;
        if (a0 < 128) {
          next[i] = current[i] ?? 0;
          next[i + 1] = current[i + 1] ?? 0;
          next[i + 2] = current[i + 2] ?? 0;
          next[i + 3] = a0;
          continue;
        }
        const r0 = current[i] ?? 0;
        const g0 = current[i + 1] ?? 0;
        const b0 = current[i + 2] ?? 0;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const j = (yy * w + xx) * 4;
            if ((current[j + 3] ?? 0) < 128) continue;
            const dr = (current[j] ?? 0) - r0;
            const dg = (current[j + 1] ?? 0) - g0;
            const db = (current[j + 2] ?? 0) - b0;
            if (dr * dr + dg * dg + db * db > limit) continue;
            r += current[j] ?? 0;
            g += current[j + 1] ?? 0;
            b += current[j + 2] ?? 0;
            n++;
          }
        }
        next[i] = n > 0 ? Math.round(r / n) : r0;
        next[i + 1] = n > 0 ? Math.round(g / n) : g0;
        next[i + 2] = n > 0 ? Math.round(b / n) : b0;
        next[i + 3] = a0;
      }
    }
    current = next;
  }
  return { width: w, height: h, data: current };
}

export function srgbToLinear(channel: number): number {
  const x = channel / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(channel: number): number {
  const x = channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(255, Math.max(0, x * 255)));
}

export function rgbToOklab(r: number, g: number, b: number): Oklab {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  };
}

export function oklabToRgb(lab: Oklab): readonly [number, number, number] {
  const l = lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
  const m = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
  const s = lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b;
  const l3 = l * l * l;
  const m3 = m * m * m;
  const s3 = s * s * s;
  const r = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const b = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;
  return [linearToSrgb(r), linearToSrgb(g), linearToSrgb(b)];
}

export function hexOf(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return "#" + h(r) + h(g) + h(b);
}

export type Palette = {
  readonly hex: readonly string[];
  readonly lab: readonly Oklab[];
  readonly inertia: readonly number[];
  readonly triedK: readonly number[];
};

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function collectSamples(raster: Raster): Float64Array {
  const w = raster.width;
  const h = raster.height;
  const data = raster.data;
  const opaque: number[] = [];
  const dark: number[] = [];
  const stride = Math.max(1, Math.floor(Math.sqrt((w * h) / 7000)));
  for (let y = 0; y < h; y += stride) {
    for (let x = 0; x < w; x += stride) {
      const i = (y * w + x) * 4;
      if ((data[i + 3] ?? 0) < 200) continue;
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const lab = rgbToOklab(r, g, b);
      if (luminance(r, g, b) < 48 && dark.length < 900) dark.push(lab.L, lab.a, lab.b);
      else opaque.push(lab.L, lab.a, lab.b);
    }
  }
  if (opaque.length > 6000 * 3) opaque.length = 6000 * 3;
  const merged = opaque.concat(dark);
  return Float64Array.from(merged);
}

function nearestIndex(points: Float64Array, index: number, centers: Float64Array, k: number): { index: number; dist: number } {
  const L = points[index * 3] ?? 0;
  const a = points[index * 3 + 1] ?? 0;
  const b = points[index * 3 + 2] ?? 0;
  let best = 0;
  let bestD = Infinity;
  for (let c = 0; c < k; c++) {
    const dL = L - (centers[c * 3] ?? 0);
    const da = a - (centers[c * 3 + 1] ?? 0);
    const db = b - (centers[c * 3 + 2] ?? 0);
    const d = dL * dL + da * da + db * db;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return { index: best, dist: bestD };
}

function kmeans(points: Float64Array, k: number): { centers: Float64Array; inertia: number } {
  const n = Math.floor(points.length / 3);
  const centers = new Float64Array(k * 3);
  if (n === 0) return { centers, inertia: 0 };
  const used = new Set<number>();
  let first = 0;
  used.add(first);
  centers[0] = points[0] ?? 0;
  centers[1] = points[1] ?? 0;
  centers[2] = points[2] ?? 0;
  for (let c = 1; c < k; c++) {
    let far = 0;
    let farD = -1;
    for (let i = 0; i < n; i++) {
      if (used.has(i)) continue;
      const hit = nearestIndex(points, i, centers, c);
      if (hit.dist > farD) {
        farD = hit.dist;
        far = i;
      }
    }
    used.add(far);
    centers[c * 3] = points[far * 3] ?? 0;
    centers[c * 3 + 1] = points[far * 3 + 1] ?? 0;
    centers[c * 3 + 2] = points[far * 3 + 2] ?? 0;
  }
  const assign = new Int32Array(n);
  for (let iter = 0; iter < 12; iter++) {
    const sum = new Float64Array(k * 3);
    const count = new Int32Array(k);
    for (let i = 0; i < n; i++) {
      const hit = nearestIndex(points, i, centers, k);
      assign[i] = hit.index;
      const base = hit.index * 3;
      const point = i * 3;
      sum[base] = (sum[base] ?? 0) + (points[point] ?? 0);
      sum[base + 1] = (sum[base + 1] ?? 0) + (points[point + 1] ?? 0);
      sum[base + 2] = (sum[base + 2] ?? 0) + (points[point + 2] ?? 0);
      count[hit.index] = (count[hit.index] ?? 0) + 1;
    }
    for (let c = 0; c < k; c++) {
      const cnt = count[c] ?? 0;
      if (cnt === 0) {
        let far = 0;
        let farD = -1;
        for (let i = 0; i < n; i++) {
          const hit = nearestIndex(points, i, centers, k);
          if (hit.dist > farD) {
            farD = hit.dist;
            far = i;
          }
        }
        centers[c * 3] = points[far * 3] ?? 0;
        centers[c * 3 + 1] = points[far * 3 + 1] ?? 0;
        centers[c * 3 + 2] = points[far * 3 + 2] ?? 0;
      } else {
        centers[c * 3] = (sum[c * 3] ?? 0) / cnt;
        centers[c * 3 + 1] = (sum[c * 3 + 1] ?? 0) / cnt;
        centers[c * 3 + 2] = (sum[c * 3 + 2] ?? 0) / cnt;
      }
    }
  }
  let inertia = 0;
  for (let i = 0; i < n; i++) inertia += nearestIndex(points, i, centers, k).dist;
  return { centers, inertia: n > 0 ? inertia / n : 0 };
}

function rmseK(ks: readonly number[], inertias: readonly number[], rmse: number): number {
  const limit = rmse * rmse;
  for (let i = 0; i < ks.length; i++) {
    const k = ks[i];
    if (k !== undefined && (inertias[i] ?? Infinity) <= limit) return k;
  }
  return ks[ks.length - 1] ?? 8;
}

function elbowK(ks: readonly number[], inertias: readonly number[]): number {
  const n = ks.length;
  const firstK = ks[0];
  const lastK = ks[n - 1];
  if (firstK === undefined || lastK === undefined || n === 0) return 8;
  if (n === 1) return firstK;
  const y0 = inertias[0] ?? 0;
  const y1 = inertias[n - 1] ?? 0;
  let bestK = firstK;
  let best = -Infinity;
  for (let i = 0; i < n; i++) {
    const k = ks[i];
    if (k === undefined) continue;
    const x = (k - firstK) / (lastK - firstK || 1);
    const y = ((inertias[i] ?? 0) - y1) / (y0 - y1 || 1);
    const gap = 1 - x - y;
    if (gap > best) {
      best = gap;
      bestK = k;
    }
  }
  return bestK;
}

export function detectPalette(
  raster: Raster,
  minK: number,
  maxK: number,
  exact: number | null,
  rule: "knee" | "rmse" = "rmse",
  rmse = 0.02
): Palette {
  const cap = Math.max(2, Math.min(32, maxK));
  const floor = Math.max(2, Math.min(cap, minK));
  const samples = collectSamples(raster);
  const tried: number[] = [];
  const inertias: number[] = [];
  const fits = new Map<number, Float64Array>();
  if (exact !== null) {
    const k = Math.max(2, Math.min(32, exact));
    const fit = kmeans(samples, k);
    fits.set(k, fit.centers);
    tried.push(k);
    inertias.push(fit.inertia);
  } else {
    for (let k = floor; k <= cap; k += 2) {
      const fit = kmeans(samples, k);
      fits.set(k, fit.centers);
      tried.push(k);
      inertias.push(fit.inertia);
    }
    if (cap % 2 === 1 || (tried[tried.length - 1] ?? 0) !== cap) {
      const fit = kmeans(samples, cap);
      fits.set(cap, fit.centers);
      tried.push(cap);
      inertias.push(fit.inertia);
    }
  }
  const chosen = exact !== null ? Math.max(2, Math.min(32, exact)) : rule === "rmse" ? rmseK(tried, inertias, rmse) : elbowK(tried, inertias);
  const centers = fits.get(chosen) ?? kmeans(samples, chosen).centers;
  const lab: Oklab[] = [];
  const hex: string[] = [];
  const seen = new Set<string>();
  for (let c = 0; c < chosen; c++) {
    const color = { L: centers[c * 3] ?? 0, a: centers[c * 3 + 1] ?? 0, b: centers[c * 3 + 2] ?? 0 };
    const [r, g, b] = oklabToRgb(color);
    const text = hexOf(r, g, b);
    if (seen.has(text)) continue;
    seen.add(text);
    lab.push(color);
    hex.push(text);
  }
  return { hex, lab, inertia: inertias, triedK: tried };
}

export function snapToPalette(src: Raster, palette: readonly Oklab[]): Raster {
  const bins = 32;
  const lut = new Int16Array(bins * bins * bins);
  lut.fill(-1);
  const nearest = (r: number, g: number, b: number): number => {
    const lab = rgbToOklab(r, g, b);
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const c = palette[i];
      if (c === undefined) continue;
      const dL = lab.L - c.L;
      const da = lab.a - c.a;
      const db = lab.b - c.b;
      const d = dL * dL + da * da + db * db;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };
  const rgb = palette.map((c) => oklabToRgb(c));
  const dst = Buffer.from(src.data);
  const w = src.width;
  const h = src.height;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if ((dst[i + 3] ?? 0) < 128) continue;
      const r = dst[i] ?? 0;
      const g = dst[i + 1] ?? 0;
      const b = dst[i + 2] ?? 0;
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      let idx = lut[key] ?? -1;
      if (idx < 0) {
        idx = nearest(r, g, b);
        lut[key] = idx;
      }
      const color = rgb[idx];
      if (color === undefined) continue;
      dst[i] = color[0];
      dst[i + 1] = color[1];
      dst[i + 2] = color[2];
    }
  }
  return { width: w, height: h, data: dst };
}

export function gradientMagnitude(raster: Raster): Float32Array {
  const w = raster.width;
  const h = raster.height;
  const data = raster.data;
  const mag = new Float32Array(w * h);
  const lum = (x: number, y: number): number => {
    const xx = Math.max(0, Math.min(w - 1, x));
    const yy = Math.max(0, Math.min(h - 1, y));
    const i = (yy * w + xx) * 4;
    if ((data[i + 3] ?? 0) < 128) return 0;
    return 0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx =
        -lum(x - 1, y - 1) + lum(x + 1, y - 1) +
        -2 * lum(x - 1, y) + 2 * lum(x + 1, y) +
        -lum(x - 1, y + 1) + lum(x + 1, y + 1);
      const gy =
        -lum(x - 1, y - 1) - 2 * lum(x, y - 1) - lum(x + 1, y - 1) +
        lum(x - 1, y + 1) + 2 * lum(x, y + 1) + lum(x + 1, y + 1);
      mag[y * w + x] = Math.hypot(gx, gy);
    }
  }
  return mag;
}
