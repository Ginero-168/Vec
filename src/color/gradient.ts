import type { Rgb } from "./model";
import { deltaE76, rgbToCieLab } from "./oklab";

export type VecGradientStop = { readonly offset: number; readonly color: Rgb };

export type VecGradient =
  | {
      readonly kind: "linear";
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly stops: readonly VecGradientStop[];
    }
  | {
      readonly kind: "radial";
      readonly cx: number;
      readonly cy: number;
      readonly r: number;
      readonly stops: readonly VecGradientStop[];
    };

type Sample = { x: number; y: number; r: number; g: number; b: number };

/**
 * Find smooth ramps in the source and return one gradient per label, or undefined
 * when that label should stay a flat swatch. Paths are not created or moved.
 */
export function detectGradients(
  rgba: Uint8Array,
  labels: Uint16Array,
  palette: readonly Rgb[],
  width: number,
  height: number
): (VecGradient | undefined)[] {
  const result: (VecGradient | undefined)[] = palette.map(() => undefined);
  if (palette.length === 0 || rgba.length < width * height * 4) return result;
  const populations = new Int32Array(palette.length);
  const minX = new Int32Array(palette.length);
  const minY = new Int32Array(palette.length);
  const maxX = new Int32Array(palette.length);
  const maxY = new Int32Array(palette.length);
  minX.fill(width);
  minY.fill(height);
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i] ?? 65535;
    if (label >= palette.length) continue;
    populations[label] = (populations[label] ?? 0) + 1;
    const x = i % width;
    const y = (i - x) / width;
    if (x < (minX[label] ?? width)) minX[label] = x;
    if (y < (minY[label] ?? height)) minY[label] = y;
    if (x > (maxX[label] ?? 0)) maxX[label] = x;
    if (y > (maxY[label] ?? 0)) maxY[label] = y;
  }
  for (let label = 0; label < palette.length; label++) {
    const population = populations[label] ?? 0;
    if (population < 80) continue;
    const flat = palette[label];
    if (!flat) continue;
    const samples = labelSamples(rgba, labels, label, width, population);
    if (samples.length < 24) continue;
    const chosen = bestRamp(samples, flat, minX[label] ?? 0, minY[label] ?? 0, maxX[label] ?? 0, maxY[label] ?? 0);
    if (!chosen) continue;
    result[label] = chosen;
  }
  return result;
}

/** sRGB sample of a gradient, matching the SVG stop interpolation Illustrator imports. */
export function colorAtGradient(gradient: VecGradient, x: number, y: number): Rgb {
  let t = 0;
  if (gradient.kind === "linear") {
    const dx = gradient.x2 - gradient.x1;
    const dy = gradient.y2 - gradient.y1;
    const length2 = dx * dx + dy * dy;
    t = length2 < 1e-8 ? 0 : ((x - gradient.x1) * dx + (y - gradient.y1) * dy) / length2;
  } else {
    t = gradient.r < 1e-6 ? 0 : Math.hypot(x - gradient.cx, y - gradient.cy) / gradient.r;
  }
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  return sampleStops(gradient.stops, t);
}

export function sampleStops(stops: readonly VecGradientStop[], t: number): Rgb {
  if (stops.length === 0) return { r: 0, g: 0, b: 0 };
  const first = stops[0];
  if (!first) return { r: 0, g: 0, b: 0 };
  if (stops.length === 1) return first.color;
  let previous = first;
  for (let i = 1; i < stops.length; i++) {
    const next = stops[i];
    if (!next) continue;
    if (t <= next.offset) {
      const span = next.offset - previous.offset;
      const u = span < 1e-6 ? 0 : (t - previous.offset) / span;
      return {
        r: Math.round(previous.color.r + (next.color.r - previous.color.r) * u),
        g: Math.round(previous.color.g + (next.color.g - previous.color.g) * u),
        b: Math.round(previous.color.b + (next.color.b - previous.color.b) * u)
      };
    }
    previous = next;
  }
  return previous.color;
}


function fitLinear(samples: readonly Sample[]): { gradient: VecGradient; residual: number; flat: number; range: number } | null {
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let sxr = 0;
  let syr = 0;
  let sxg = 0;
  let syg = 0;
  let sxb = 0;
  let syb = 0;
  for (const sample of samples) {
    sx += sample.x;
    sy += sample.y;
    sxx += sample.x * sample.x;
    syy += sample.y * sample.y;
    sxy += sample.x * sample.y;
    sr += sample.r;
    sg += sample.g;
    sb += sample.b;
    sxr += sample.x * sample.r;
    syr += sample.y * sample.r;
    sxg += sample.x * sample.g;
    syg += sample.y * sample.g;
    sxb += sample.x * sample.b;
    syb += sample.y * sample.b;
  }
  const n = samples.length;
  const ridge = 1e-3;
  const matrix = [
    [sxx + ridge, sxy, sx],
    [sxy, syy + ridge, sy],
    [sx, sy, n]
  ];
  const red = solve3(matrix, [sxr, syr, sr]);
  const green = solve3(matrix, [sxg, syg, sg]);
  const blue = solve3(matrix, [sxb, syb, sb]);
  if (!red || !green || !blue) return null;
  const gx = 0.2126 * red[0] + 0.7152 * green[0] + 0.0722 * blue[0];
  const gy = 0.2126 * red[1] + 0.7152 * green[1] + 0.0722 * blue[1];
  const length = Math.hypot(gx, gy);
  if (length < 1e-4) return null;
  const ux = gx / length;
  const uy = gy / length;
  let tMin = Infinity;
  let tMax = -Infinity;
  const ts: number[] = [];
  for (const sample of samples) {
    const t = sample.x * ux + sample.y * uy;
    ts.push(t);
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }
  if (tMax - tMin < 6) return null;
  const predict = (t: number): Rgb => {
    const x = ux * t;
    const y = uy * t;
    return {
      r: Math.round(Math.min(255, Math.max(0, red[0] * x + red[1] * y + red[2]))),
      g: Math.round(Math.min(255, Math.max(0, green[0] * x + green[1] * y + green[2]))),
      b: Math.round(Math.min(255, Math.max(0, blue[0] * x + blue[1] * y + blue[2])))
    };
  };
  const linearStops: VecGradientStop[] = [
    { offset: 0, color: predict(tMin) },
    { offset: 1, color: predict(tMax) }
  ];
  const linearGradient: VecGradient = { kind: "linear", x1: ux * tMin, y1: uy * tMin, x2: ux * tMax, y2: uy * tMax, stops: linearStops };
  const linearScore = residuals(samples, linearGradient);
  const sampledStops = stopsAlong(samples, ts, tMin, tMax, 8);
  const sampledGradient: VecGradient = { ...linearGradient, stops: sampledStops };
  const sampledScore = residuals(samples, sampledGradient);
  const chosen = sampledScore.residual + 0.4 < linearScore.residual ? sampledGradient : linearGradient;
  const score = chosen === linearGradient ? linearScore : sampledScore;
  return { gradient: chosen, ...score };
}

function fitRadial(samples: readonly Sample[]): { gradient: VecGradient; residual: number; flat: number; range: number } | null {
  let cx = 0;
  let cy = 0;
  let minL = Infinity;
  let maxL = -Infinity;
  let darkX = 0;
  let darkY = 0;
  let lightX = 0;
  let lightY = 0;
  for (const sample of samples) {
    cx += sample.x;
    cy += sample.y;
    const luma = 0.2126 * sample.r + 0.7152 * sample.g + 0.0722 * sample.b;
    if (luma < minL) {
      minL = luma;
      darkX = sample.x;
      darkY = sample.y;
    }
    if (luma > maxL) {
      maxL = luma;
      lightX = sample.x;
      lightY = sample.y;
    }
  }
  cx /= samples.length;
  cy /= samples.length;
  let best: { gradient: VecGradient; residual: number; flat: number; range: number } | null = null;
  for (const center of [
    [cx, cy],
    [darkX, darkY],
    [lightX, lightY]
  ]) {
    const originX = center[0] ?? cx;
    const originY = center[1] ?? cy;
    let maxR = 1;
    const radii: number[] = [];
    for (const sample of samples) {
      const radius = Math.hypot(sample.x - originX, sample.y - originY);
      radii.push(radius);
      if (radius > maxR) maxR = radius;
    }
    if (maxR < 6) continue;
    const stops = stopsAlong(samples, radii, 0, maxR);
    const gradient: VecGradient = { kind: "radial", cx: originX, cy: originY, r: maxR, stops };
    const scored = { gradient, ...residuals(samples, gradient) };
    if (!best || scored.residual < best.residual) best = scored;
  }
  return best;
}

function stopsAlong(samples: readonly Sample[], parameter: readonly number[], min: number, max: number, binsCount = 4): VecGradientStop[] {
  const bins: Sample[][] = [];
  for (let i = 0; i < binsCount; i++) bins.push([]);
  const span = max - min || 1;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const t = parameter[i];
    if (!sample || t === undefined) continue;
    const bin = Math.min(binsCount - 1, Math.max(0, Math.floor(((t - min) / span) * binsCount)));
    bins[bin]?.push(sample);
  }
  const stops: VecGradientStop[] = [];
  for (let bin = 0; bin < binsCount; bin++) {
    const group = bins[bin] ?? [];
    if (group.length === 0) continue;
    let r = 0;
    let g = 0;
    let b = 0;
    for (const sample of group) {
      r += sample.r;
      g += sample.g;
      b += sample.b;
    }
    stops.push({
      offset: binsCount === 1 ? 0 : bin / (binsCount - 1),
      color: { r: Math.round(r / group.length), g: Math.round(g / group.length), b: Math.round(b / group.length) }
    });
  }
  return stops;
}

function residuals(samples: readonly Sample[], gradient: VecGradient): { residual: number; flat: number; range: number } {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const sample of samples) {
    r += sample.r;
    g += sample.g;
    b += sample.b;
  }
  const flatColor = { r: r / samples.length, g: g / samples.length, b: b / samples.length };
  const flatLab = rgbToCieLab(flatColor.r, flatColor.g, flatColor.b);
  let flatSum = 0;
  let fitSum = 0;
  let minE = Infinity;
  let maxE = 0;
  const origin = samples[0];
  const originLab = origin ? rgbToCieLab(origin.r, origin.g, origin.b) : flatLab;
  for (const sample of samples) {
    const source = rgbToCieLab(sample.r, sample.g, sample.b);
    flatSum += deltaE76(source, flatLab);
    const predicted = colorAtGradient(gradient, sample.x + 0.5, sample.y + 0.5);
    fitSum += deltaE76(source, rgbToCieLab(predicted.r, predicted.g, predicted.b));
    const end = deltaE76(source, originLab);
    if (end < minE) minE = end;
    if (end > maxE) maxE = end;
  }
  return { residual: fitSum / samples.length, flat: flatSum / samples.length, range: maxE - minE };
}

/**
 * Keep the flat swatch outside a ramp that only covers part of a shape.
 * Stops before and after the ramp repeat the palette color, so the rest of
 * the fill matches the flat trace and only the ramp changes.
 */
function plateauLinear(gradient: VecGradient, palette: Rgb, minX: number, minY: number, maxX: number, maxY: number): VecGradient {
  if (gradient.kind !== "linear") return gradient;
  const dx = gradient.x2 - gradient.x1;
  const dy = gradient.y2 - gradient.y1;
  const length2 = dx * dx + dy * dy;
  if (length2 < 1e-6) return gradient;
  const project = (x: number, y: number) => ((x - gradient.x1) * dx + (y - gradient.y1) * dy) / length2;
  const corners = [project(minX, minY), project(maxX, minY), project(minX, maxY), project(maxX, maxY)];
  let tMin = corners[0] ?? 0;
  let tMax = tMin;
  for (const t of corners) {
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }
  if (tMax - tMin < 1e-4) return gradient;
  const ramp0 = Math.min(1, Math.max(0, (0 - tMin) / (tMax - tMin)));
  const ramp1 = Math.min(1, Math.max(0, (1 - tMin) / (tMax - tMin)));
  if (ramp1 - ramp0 < 0.04) return gradient;
  const stops: VecGradientStop[] = [{ offset: 0, color: palette }];
  if (ramp0 > 0.02) stops.push({ offset: ramp0, color: palette });
  for (const stop of gradient.stops) {
    if (stop.offset <= 0.05) continue;
    stops.push({ offset: ramp0 + stop.offset * (ramp1 - ramp0), color: stop.color });
  }
  const last = stops[stops.length - 1];
  if (ramp1 < 0.98 && (!last || last.offset < 0.999)) stops.push({ offset: 1, color: palette });
  return {
    kind: "linear",
    x1: gradient.x1 + dx * tMin,
    y1: gradient.y1 + dy * tMin,
    x2: gradient.x1 + dx * tMax,
    y2: gradient.y1 + dy * tMax,
    stops
  };
}

type Scored = { gradient: VecGradient; residual: number; flat: number; range: number };

function acceptable(scored: Scored): boolean {
  return scored.range >= 8 && scored.flat >= 3 && scored.residual <= 8 && scored.residual <= scored.flat * 0.65;
}

/** Reject a ramp that changes hue. A neutral swatch may only shift lightness a little. */
function stopsStayInFamily(gradient: VecGradient, palette: Rgb): boolean {
  const origin = rgbToCieLab(palette.r, palette.g, palette.b);
  const originChroma = Math.hypot(origin.a, origin.b);
  for (const stop of gradient.stops) {
    const lab = rgbToCieLab(stop.color.r, stop.color.g, stop.color.b);
    const chroma = Math.hypot(lab.a, lab.b);
    if (originChroma < 12 && chroma < 12) {
      if (Math.abs(lab.l - origin.l) > 16) return false;
      continue;
    }
    if (originChroma < 12 || chroma < 12) return false;
    const hue = Math.atan2(lab.b, lab.a) - Math.atan2(origin.b, origin.a);
    if (Math.abs(Math.atan2(Math.sin(hue), Math.cos(hue))) > 0.5) return false;
  }
  return true;
}

function bestRamp(samples: readonly Sample[], palette: Rgb, minX: number, minY: number, maxX: number, maxY: number): VecGradient | null {
  const found: Scored[] = [];
  let bestGain = 0;
  const consider = (subset: readonly Sample[], partial: boolean) => {
    if (subset.length < 24) return;
    const linear = fitLinear(subset);
    const radial = fitRadial(subset);
    let fit = linear;
    if (radial && linear && radial.residual < linear.residual * 0.82 && radial.range > 8) fit = radial;
    if (!fit) return;
    if (partial && fit.gradient.kind === "linear") {
      const plateau = plateauLinear(fit.gradient, palette, minX, minY, maxX, maxY);
      fit = { gradient: plateau, ...residuals(subset, plateau) };
    } else if (partial && fit.gradient.kind === "radial") {
      const radialFit = fit.gradient;
      const stops = radialFit.stops.map((stop, index) =>
        index === radialFit.stops.length - 1 ? { offset: stop.offset, color: palette } : stop
      );
      const plateau: VecGradient = { kind: "radial", cx: radialFit.cx, cy: radialFit.cy, r: radialFit.r, stops };
      fit = { gradient: plateau, ...residuals(subset, plateau) };
    }
    if (!fit || !acceptable(fit)) return;
    if (partial && !stopsStayInFamily(fit.gradient, palette)) return;
    if (fit.gradient.kind === "radial") {
      const origin = rgbToCieLab(palette.r, palette.g, palette.b);
      const center = fit.gradient.stops[0];
      if (center && Math.hypot(origin.a, origin.b) < 12) {
        const lab = rgbToCieLab(center.color.r, center.color.g, center.color.b);
        if (lab.l < origin.l - 8) return;
      }
    }
    const gain = (fit.flat - fit.residual) * Math.sqrt(subset.length);
    if (found.length === 0 || gain > bestGain) {
      found[0] = fit;
      bestGain = gain;
    }
  };
  consider(samples, false);
  let sampleMinY = samples[0]?.y ?? 0;
  let sampleMaxY = sampleMinY;
  let sampleMinX = samples[0]?.x ?? 0;
  let sampleMaxX = sampleMinX;
  for (const sample of samples) {
    if (sample.y < sampleMinY) sampleMinY = sample.y;
    if (sample.y > sampleMaxY) sampleMaxY = sample.y;
    if (sample.x < sampleMinX) sampleMinX = sample.x;
    if (sample.x > sampleMaxX) sampleMaxX = sample.x;
  }
  for (const span of [48, 96, 160]) {
    for (let origin = sampleMinY; origin <= sampleMaxY - span * 0.4; origin += 24) {
      consider(
        samples.filter((sample) => sample.y >= origin && sample.y < origin + span),
        true
      );
    }
    for (let origin = sampleMinX; origin <= sampleMaxX - span * 0.4; origin += 24) {
      consider(
        samples.filter((sample) => sample.x >= origin && sample.x < origin + span),
        true
      );
    }
  }
  const winner = found[0];
  return winner ? winner.gradient : null;
}

function labelSamples(rgba: Uint8Array, labels: Uint16Array, label: number, width: number, population: number): Sample[] {
  const stride = Math.max(1, Math.floor(population / 480));
  const samples: Sample[] = [];
  let seen = 0;
  for (let index = 0; index < labels.length; index++) {
    if ((labels[index] ?? -1) !== label) continue;
    seen++;
    if (seen % stride !== 0) continue;
    const offset = index * 4;
    samples.push({
      x: index % width,
      y: (index - (index % width)) / width,
      r: rgba[offset] ?? 0,
      g: rgba[offset + 1] ?? 0,
      b: rgba[offset + 2] ?? 0
    });
  }
  return samples;
}

function solve3(matrix: number[][], rhs: number[]): [number, number, number] | null {
  const a = matrix.map((row, index) => [row[0] ?? 0, row[1] ?? 0, row[2] ?? 0, rhs[index] ?? 0]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    let best = Math.abs(a[col]?.[col] ?? 0);
    for (let row = col + 1; row < 3; row++) {
      const value = Math.abs(a[row]?.[col] ?? 0);
      if (value > best) {
        best = value;
        pivot = row;
      }
    }
    if (best < 1e-8) return null;
    if (pivot !== col) {
      const swap = a[col];
      a[col] = a[pivot] ?? [];
      a[pivot] = swap ?? [];
    }
    const row = a[col];
    if (!row) return null;
    const diag = row[col] ?? 1;
    for (let k = col; k < 4; k++) row[k] = (row[k] ?? 0) / diag;
    for (let other = 0; other < 3; other++) {
      if (other === col) continue;
      const target = a[other];
      if (!target) continue;
      const factor = target[col] ?? 0;
      for (let k = col; k < 4; k++) target[k] = (target[k] ?? 0) - factor * (row[k] ?? 0);
    }
  }
  return [a[0]?.[3] ?? 0, a[1]?.[3] ?? 0, a[2]?.[3] ?? 0];
}

export type RadialDisc = {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly color: Rgb;
  readonly gradient: VecGradient;
};

/**
 * A compact highlight sitting inside a larger swatch, such as a sun on a sky.
 * Returned separately so the underlying linear fill keeps its path.
 */
export function findRadialDiscs(rgba: Uint8Array, labels: Uint16Array, palette: readonly Rgb[], width: number, height: number): RadialDisc[] {
  if (palette.length === 0 || rgba.length < width * height * 4) return [];
  const populations = new Int32Array(palette.length);
  const lumaSum = new Float64Array(palette.length);
  for (let index = 0; index < labels.length; index++) {
    const label = labels[index] ?? 65535;
    if (label >= palette.length) continue;
    populations[label] = (populations[label] ?? 0) + 1;
    const offset = index * 4;
    lumaSum[label] = (lumaSum[label] ?? 0) + 0.2126 * (rgba[offset] ?? 0) + 0.7152 * (rgba[offset + 1] ?? 0) + 0.0722 * (rgba[offset + 2] ?? 0);
  }
  const median = new Float64Array(palette.length);
  for (let label = 0; label < palette.length; label++) {
    const count = populations[label] ?? 0;
    median[label] = count > 0 ? (lumaSum[label] ?? 0) / count : 0;
  }
  const bright = new Uint8Array(labels.length);
  for (let index = 0; index < labels.length; index++) {
    const label = labels[index] ?? 65535;
    if (label >= palette.length) continue;
    const offset = index * 4;
    const luma = 0.2126 * (rgba[offset] ?? 0) + 0.7152 * (rgba[offset + 1] ?? 0) + 0.0722 * (rgba[offset + 2] ?? 0);
    if (luma > (median[label] ?? 0) + 16) bright[index] = 1;
  }
  const seen = new Uint8Array(labels.length);
  const stack: number[] = [];
  const discs: RadialDisc[] = [];
  for (let start = 0; start < bright.length && discs.length < 3; start++) {
    if (!bright[start] || seen[start]) continue;
    const label = labels[start] ?? 0;
    stack.push(start);
    seen[start] = 1;
    const pixels: number[] = [];
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let brightest = start;
    let brightestLuma = -1;
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      pixels.push(current);
      const x = current % width;
      const y = (current - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const offset = current * 4;
      const luma = 0.2126 * (rgba[offset] ?? 0) + 0.7152 * (rgba[offset + 1] ?? 0) + 0.0722 * (rgba[offset + 2] ?? 0);
      if (luma > brightestLuma) {
        brightestLuma = luma;
        brightest = current;
      }
      const nexts = [x > 0 ? current - 1 : -1, x + 1 < width ? current + 1 : -1, y > 0 ? current - width : -1, y + 1 < height ? current + width : -1];
      for (const next of nexts) {
        if (next < 0 || seen[next] || !bright[next] || (labels[next] ?? -1) !== label) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    const spanX = maxX - minX + 1;
    const spanY = maxY - minY + 1;
    const population = populations[label] ?? 1;
    if (pixels.length < 180 || pixels.length > population * 0.22) continue;
    if (spanX < 16 || spanY < 16 || spanX > 160 || spanY > 160) continue;
    const aspect = Math.max(spanX, spanY) / Math.max(1, Math.min(spanX, spanY));
    if (aspect > 1.65 || pixels.length / (spanX * spanY) < 0.45) continue;
    const stride = Math.max(1, Math.floor(pixels.length / 240));
    const samples: Sample[] = [];
    for (let i = 0; i < pixels.length; i += stride) {
      const index = pixels[i];
      if (index === undefined) continue;
      const offset = index * 4;
      samples.push({
        x: index % width,
        y: (index - (index % width)) / width,
        r: rgba[offset] ?? 0,
        g: rgba[offset + 1] ?? 0,
        b: rgba[offset + 2] ?? 0
      });
    }
    const radial = fitRadial(samples);
    if (!radial || radial.range < 6 || radial.residual > 6 || radial.residual > radial.flat * 0.6) continue;
    const cx = brightest % width;
    const cy = (brightest - cx) / width;
    const radius = 0.5 * Math.max(spanX, spanY);
    if (radial.gradient.kind !== "radial") continue;
    const edge = palette[label] ?? { r: 0, g: 0, b: 0 };
    const fitted = radial.gradient;
    const stops = fitted.stops.map((stop, index) => (index === fitted.stops.length - 1 ? { offset: stop.offset, color: edge } : stop));
    discs.push({
      cx,
      cy,
      r: radius,
      color: edge,
      gradient: { kind: "radial", cx, cy, r: radius, stops }
    });
  }
  return discs;
}
