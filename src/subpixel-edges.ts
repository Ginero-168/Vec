/**
 * Sub-pixel edge placement and coverage-based contour fitting for Vec vectorizer.
 *
 * Implements:
 * 1. Coverage map estimation from anti-aliased rasters.
 * 2. 50%-coverage iso-contour fitting via Marching Squares with linear interpolation.
 * 3. Primitive fitting on coverage (circles and rounded rectangles) removing radial bias.
 * 4. Edge-band control-point refinement minimizing render-vs-input boundary offset.
 */

export type Point = { x: number; y: number };

export type Cubic = { p0: Point; p1: Point; p2: Point; p3: Point };

export type Subpath = { cubics: Cubic[]; closed: boolean };

export type CoverageMap = {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
};

/**
 * Bilinear sampling of RGBA channels at sub-pixel coordinate (x, y).
 * Coordinates are mapped with pixel centers at (x + 0.5, y + 0.5).
 */
export function sampleBilinearRgba(
  rgba: Uint8Array,
  width: number,
  height: number,
  px: number,
  py: number
): [number, number, number, number] {
  const x = Math.max(0, Math.min(width - 1, px - 0.5));
  const y = Math.max(0, Math.min(height - 1, py - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = x - x0;
  const fy = y - y0;

  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;

  const idx00 = (y0 * width + x0) * 4;
  const idx10 = (y0 * width + x1) * 4;
  const idx01 = (y1 * width + x0) * 4;
  const idx11 = (y1 * width + x1) * 4;

  const r =
    (rgba[idx00] ?? 0) * w00 +
    (rgba[idx10] ?? 0) * w10 +
    (rgba[idx01] ?? 0) * w01 +
    (rgba[idx11] ?? 0) * w11;
  const g =
    (rgba[idx00 + 1] ?? 0) * w00 +
    (rgba[idx10 + 1] ?? 0) * w10 +
    (rgba[idx01 + 1] ?? 0) * w01 +
    (rgba[idx11 + 1] ?? 0) * w11;
  const b =
    (rgba[idx00 + 2] ?? 0) * w00 +
    (rgba[idx10 + 2] ?? 0) * w10 +
    (rgba[idx01 + 2] ?? 0) * w01 +
    (rgba[idx11 + 2] ?? 0) * w11;
  const a =
    (rgba[idx00 + 3] ?? 0) * w00 +
    (rgba[idx10 + 3] ?? 0) * w10 +
    (rgba[idx01 + 3] ?? 0) * w01 +
    (rgba[idx11 + 3] ?? 0) * w11;

  return [r, g, b, a];
}

/**
 * Builds a coverage scalar field in [0, 1] for a given target color or alpha.
 */
export function buildCoverageMap(
  rgba: Uint8Array,
  width: number,
  height: number,
  targetColor?: readonly [number, number, number] | string,
  bgColor?: readonly [number, number, number] | string
): CoverageMap {
  const count = width * height;
  const data = new Float32Array(count);

  let hasAlpha = false;
  for (let i = 0; i < count; i++) {
    if ((rgba[i * 4 + 3] ?? 0) < 250) {
      hasAlpha = true;
      break;
    }
  }

  if (hasAlpha) {
    for (let i = 0; i < count; i++) {
      data[i] = (rgba[i * 4 + 3] ?? 0) / 255;
    }
    return { width, height, data };
  }

  const target = parseRgb(targetColor ?? [0, 0, 0]);
  const bg = parseRgb(bgColor ?? [255, 255, 255]);
  const dr = target[0] - bg[0];
  const dg = target[1] - bg[1];
  const db = target[2] - bg[2];
  const normSq = dr * dr + dg * dg + db * db;

  if (normSq < 1) {
    data.fill(1);
    return { width, height, data };
  }

  for (let i = 0; i < count; i++) {
    const r = rgba[i * 4] ?? 0;
    const g = rgba[i * 4 + 1] ?? 0;
    const b = rgba[i * 4 + 2] ?? 0;
    const proj = ((r - bg[0]) * dr + (g - bg[1]) * dg + (b - bg[2]) * db) / normSq;
    data[i] = Math.max(0, Math.min(1, proj));
  }

  return { width, height, data };
}

function parseRgb(color: readonly [number, number, number] | string): [number, number, number] {
  if (typeof color !== "string") return [color[0], color[1], color[2]];
  const clean = color.trim().replace(/^#/, "");
  if (clean.length === 3) {
    return [
      parseInt(clean[0]! + clean[0]!, 16),
      parseInt(clean[1]! + clean[1]!, 16),
      parseInt(clean[2]! + clean[2]!, 16)
    ];
  }
  if (clean.length === 6) {
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16)
    ];
  }
  return [0, 0, 0];
}

/**
 * Linearly interpolate zero-crossing along an edge between p1 and p2.
 */
function interpEdge(p1: Point, p2: Point, v1: number, v2: number, iso: number): Point {
  if (Math.abs(v2 - v1) < 1e-6) return { x: (p1.x + p2.x) * 0.5, y: (p1.y + p2.y) * 0.5 };
  const t = Math.max(0, Math.min(1, (iso - v1) / (v2 - v1)));
  return {
    x: p1.x + t * (p2.x - p1.x),
    y: p1.y + t * (p2.y - p1.y)
  };
}

export type ContourSegment = { a: Point; b: Point };

/**
 * Extracts 50%-coverage iso-contour segments using Marching Squares with sub-pixel interpolation.
 */
export function extractIsoSegments(
  field: Float32Array | Float64Array,
  width: number,
  height: number,
  iso = 0.5
): ContourSegment[] {
  const segments: ContourSegment[] = [];

  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const idx00 = y * width + x;
      const idx10 = y * width + (x + 1);
      const idx11 = (y + 1) * width + (x + 1);
      const idx01 = (y + 1) * width + x;

      const v00 = field[idx00] ?? 0;
      const v10 = field[idx10] ?? 0;
      const v11 = field[idx11] ?? 0;
      const v01 = field[idx01] ?? 0;

      let code = 0;
      if (v00 >= iso) code |= 1;
      if (v10 >= iso) code |= 2;
      if (v11 >= iso) code |= 4;
      if (v01 >= iso) code |= 8;

      if (code === 0 || code === 15) continue;

      const p00: Point = { x: x + 0.5, y: y + 0.5 };
      const p10: Point = { x: x + 1.5, y: y + 0.5 };
      const p11: Point = { x: x + 1.5, y: y + 1.5 };
      const p01: Point = { x: x + 0.5, y: y + 1.5 };

      const top = () => interpEdge(p00, p10, v00, v10, iso);
      const right = () => interpEdge(p10, p11, v10, v11, iso);
      const bottom = () => interpEdge(p01, p11, v01, v11, iso);
      const left = () => interpEdge(p00, p01, v00, v01, iso);

      switch (code) {
        case 1:
        case 14:
          segments.push({ a: left(), b: top() });
          break;
        case 2:
        case 13:
          segments.push({ a: top(), b: right() });
          break;
        case 3:
        case 12:
          segments.push({ a: left(), b: right() });
          break;
        case 4:
        case 11:
          segments.push({ a: right(), b: bottom() });
          break;
        case 5: {
          const avg = (v00 + v10 + v11 + v01) * 0.25;
          if (avg >= iso) {
            segments.push({ a: left(), b: top() });
            segments.push({ a: right(), b: bottom() });
          } else {
            segments.push({ a: left(), b: bottom() });
            segments.push({ a: top(), b: right() });
          }
          break;
        }
        case 6:
        case 9:
          segments.push({ a: top(), b: bottom() });
          break;
        case 7:
        case 8:
          segments.push({ a: left(), b: bottom() });
          break;
        case 10: {
          const avg = (v00 + v10 + v11 + v01) * 0.25;
          if (avg >= iso) {
            segments.push({ a: top(), b: right() });
            segments.push({ a: left(), b: bottom() });
          } else {
            segments.push({ a: left(), b: top() });
            segments.push({ a: right(), b: bottom() });
          }
          break;
        }
      }
    }
  }

  return segments;
}

/**
 * Chains segments into closed oriented polygon rings.
 */
export function chainSegmentsIntoLoops(segments: readonly ContourSegment[]): Point[][] {
  if (segments.length === 0) return [];

  const key = (p: Point) => Math.round(p.x * 100) + "," + Math.round(p.y * 100);
  const byStart = new Map<string, ContourSegment[]>();

  for (const seg of segments) {
    const k = key(seg.a);
    const list = byStart.get(k);
    if (list === undefined) byStart.set(k, [seg]);
    else list.push(seg);
  }

  const visited = new Set<ContourSegment>();
  const loops: Point[][] = [];

  for (const seg of segments) {
    if (visited.has(seg)) continue;
    const loop: Point[] = [seg.a];
    let current = seg;
    visited.add(current);

    while (true) {
      loop.push(current.b);
      const candidates = byStart.get(key(current.b));
      let next: ContourSegment | null = null;
      if (candidates !== undefined) {
        for (const cand of candidates) {
          if (!visited.has(cand)) {
            next = cand;
            break;
          }
        }
      }

      if (next === null) {
        let nearest: ContourSegment | null = null;
        let nearestDist = 0.25;
        for (const cand of segments) {
          if (visited.has(cand)) continue;
          const d = Math.hypot(cand.a.x - current.b.x, cand.a.y - current.b.y);
          if (d < nearestDist) {
            nearestDist = d;
            nearest = cand;
          }
        }
        next = nearest;
      }

      if (next === null) break;
      visited.add(next);
      current = next;
      if (Math.hypot(current.b.x - loop[0]!.x, current.b.y - loop[0]!.y) < 0.2) {
        break;
      }
    }

    if (loop.length >= 4) loops.push(loop);
  }

  return loops;
}

/**
 * Fits a circle directly on the anti-aliased coverage field in the annular edge band.
 * Removes the +0.24 px dilated-mask bias and produces true boundary radius (bias ~0).
 */
export function fitCircleOnCoverage(
  initial: { readonly cx: number; readonly cy: number; readonly r: number },
  rgba: Uint8Array,
  width: number,
  height: number,
  targetColor?: readonly [number, number, number] | string
): { readonly cx: number; readonly cy: number; readonly r: number } | null {
  const { cx, cy, r: r0 } = initial;
  if (!(r0 > 1.5)) return null;

  // Estimate inside and outside color by sampling 16 angles at r0 - 1.8 and r0 + 1.8
  const numAngles = 16;
  const sampleDist = 1.8;
  const rIn = Math.max(0.5, r0 - sampleDist);
  const rOut = r0 + sampleDist;

  let inR = 0, inG = 0, inB = 0, inA = 0;
  let outR = 0, outG = 0, outB = 0, outA = 0;

  for (let k = 0; k < numAngles; k++) {
    const theta = (2 * Math.PI * k) / numAngles;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const cin = sampleBilinearRgba(rgba, width, height, cx + rIn * cosT, cy + rIn * sinT);
    const cout = sampleBilinearRgba(rgba, width, height, cx + rOut * cosT, cy + rOut * sinT);
    inR += cin[0]; inG += cin[1]; inB += cin[2]; inA += cin[3];
    outR += cout[0]; outG += cout[1]; outB += cout[2]; outA += cout[3];
  }

  let cIn: [number, number, number, number] = [inR / numAngles, inG / numAngles, inB / numAngles, inA / numAngles];
  let cOut: [number, number, number, number] = [outR / numAngles, outG / numAngles, outB / numAngles, outA / numAngles];

  if (targetColor !== undefined) {
    const tgt = parseRgb(targetColor);
    const distIn = (cIn[0] - tgt[0]) ** 2 + (cIn[1] - tgt[1]) ** 2 + (cIn[2] - tgt[2]) ** 2;
    const distOut = (cOut[0] - tgt[0]) ** 2 + (cOut[1] - tgt[1]) ** 2 + (cOut[2] - tgt[2]) ** 2;
    if (distOut < distIn) {
      const tmp = cIn;
      cIn = cOut;
      cOut = tmp;
    }
  }

  const dAlpha = cIn[3] - cOut[3];
  const dr = cIn[0] - cOut[0];
  const dg = cIn[1] - cOut[1];
  const db = cIn[2] - cOut[2];
  const normSq = dr * dr + dg * dg + db * db;

  const useAlpha = Math.abs(dAlpha) >= 20;
  if (!useAlpha && normSq < 36) return null;

  const band = 2.0;
  const minX = Math.max(0, Math.floor(cx - r0 - band));
  const maxX = Math.min(width - 1, Math.ceil(cx + r0 + band));
  const minY = Math.max(0, Math.floor(cy - r0 - band));
  const maxY = Math.min(height - 1, Math.ceil(cy + r0 + band));

  let sumW = 0;
  let sumWR = 0;
  let sumWX = 0;
  let sumWY = 0;
  let sampleCount = 0;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const d = Math.hypot(px - cx, py - cy);
      if (Math.abs(d - r0) > band) continue;

      const idx = (y * width + x) * 4;
      let cov = 0;

      if (useAlpha) {
        cov = Math.max(0, Math.min(1, ((rgba[idx + 3] ?? 0) - cOut[3]) / dAlpha));
      } else {
        const pr = rgba[idx] ?? 0;
        const pg = rgba[idx + 1] ?? 0;
        const pb = rgba[idx + 2] ?? 0;
        cov = Math.max(0, Math.min(1, ((pr - cOut[0]) * dr + (pg - cOut[1]) * dg + (pb - cOut[2]) * db) / normSq));
      }

      if (cov <= 0.05 || cov >= 0.95) continue;

      const rPred = d + (cov - 0.5);
      const weight = cov * (1 - cov);

      sumW += weight;
      sumWR += weight * rPred;
      const cosA = (px - cx) / d;
      const sinA = (py - cy) / d;
      sumWX += weight * (rPred - r0) * cosA;
      sumWY += weight * (rPred - r0) * sinA;
      sampleCount++;
    }
  }

  if (sampleCount < 16 || sumW < 1e-4) return null;

  const refinedR = sumWR / sumW;
  const dCx = sumWX / sumW;
  const dCy = sumWY / sumW;

  if (Math.abs(refinedR - r0) > 0.35 || Math.hypot(dCx, dCy) > 0.35) return null;

  return {
    cx: Math.round((cx + dCx) * 100) / 100,
    cy: Math.round((cy + dCy) * 100) / 100,
    r: Math.round(refinedR * 100) / 100
  };
}

/**
 * Fits a rounded rectangle directly on the coverage field.
 */
export function fitRoundedRectOnCoverage(
  initial: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly r: number;
  },
  rgba: Uint8Array,
  imgWidth: number,
  imgHeight: number,
  targetColor?: readonly [number, number, number] | string
): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly r: number;
} | null {
  const { x, y, width, height, r } = initial;
  const halfW = width / 2;
  const halfH = height / 2;
  const cx = x + halfW;
  const cy = y + halfH;

  const refineEdge = (samplePoints: Point[], normal: Point): number => {
    let sumShift = 0;
    let weightSum = 0;
    for (const pt of samplePoints) {
      const sh = findSubpixelShift(rgba, imgWidth, imgHeight, pt, normal, 1.5, targetColor);
      if (Math.abs(sh) <= 1.2) {
        sumShift += sh;
        weightSum += 1;
      }
    }
    return weightSum >= 3 ? sumShift / weightSum : 0;
  };

  const leftSamples: Point[] = [];
  const rightSamples: Point[] = [];
  const topSamples: Point[] = [];
  const bottomSamples: Point[] = [];

  const spanY = Math.max(2, halfH - r - 2);
  const spanX = Math.max(2, halfW - r - 2);

  for (let s = -spanY; s <= spanY; s += 2) {
    leftSamples.push({ x: cx - halfW, y: cy + s });
    rightSamples.push({ x: cx + halfW, y: cy + s });
  }
  for (let s = -spanX; s <= spanX; s += 2) {
    topSamples.push({ x: cx + s, y: cy - halfH });
    bottomSamples.push({ x: cx + s, y: cy + halfH });
  }

  const dLeft = refineEdge(leftSamples, { x: -1, y: 0 });
  const dRight = refineEdge(rightSamples, { x: 1, y: 0 });
  const dTop = refineEdge(topSamples, { x: 0, y: -1 });
  const dBottom = refineEdge(bottomSamples, { x: 0, y: 1 });

  const newX0 = cx - halfW - dLeft;
  const newX1 = cx + halfW + dRight;
  const newY0 = cy - halfH - dTop;
  const newY1 = cy + halfH + dBottom;

  return {
    x: Math.round(newX0 * 100) / 100,
    y: Math.round(newY0 * 100) / 100,
    width: Math.round((newX1 - newX0) * 100) / 100,
    height: Math.round((newY1 - newY0) * 100) / 100,
    r: Math.round(r * 100) / 100
  };
}

/**
 * Finds the sub-pixel shift along `normal` where the anti-aliased edge reaches 50% coverage.
 */
export function findSubpixelShift(
  rgba: Uint8Array,
  width: number,
  height: number,
  p: Point,
  normal: Point,
  maxDist = 1.2,
  targetColor?: readonly [number, number, number] | string
): number {
  // Guard canvas boundaries: border-pinned points must not be pulled away
  if (p.x <= 0.6 || p.x >= width - 0.6 || p.y <= 0.6 || p.y >= height - 0.6) return 0;

  const normLen = Math.hypot(normal.x, normal.y);
  if (normLen < 1e-5) return 0;
  let nx = normal.x / normLen;
  let ny = normal.y / normLen;
  let flipped = false;

  const sampleDist = 1.8;
  let cIn = sampleBilinearRgba(rgba, width, height, p.x - sampleDist * nx, p.y - sampleDist * ny);
  let cOut = sampleBilinearRgba(rgba, width, height, p.x + sampleDist * nx, p.y + sampleDist * ny);

  // Check alpha
  const dAlpha = cIn[3] - cOut[3];
  if (Math.abs(dAlpha) >= 20) {
    if (dAlpha < 0) {
      // Normal points inward instead of outward
      nx = -nx;
      ny = -ny;
      flipped = !flipped;
    }
    const sVals = [-maxDist, -0.8, -0.4, 0.0, 0.4, 0.8, maxDist];
    const covs = sVals.map((s) => sampleBilinearRgba(rgba, width, height, p.x + s * nx, p.y + s * ny)[3] / 255);
    for (let i = 0; i < sVals.length - 1; i++) {
      const c0 = covs[i] ?? 0;
      const c1 = covs[i + 1] ?? 0;
      if ((c0 - 0.5) * (c1 - 0.5) <= 0 && Math.abs(c1 - c0) > 1e-4) {
        const raw = (sVals[i] ?? 0) + ((0.5 - c0) / (c1 - c0)) * ((sVals[i + 1] ?? 0) - (sVals[i] ?? 0));
        return flipped ? -raw : raw;
      }
    }
    return 0;
  }

  // Opaque RGB contrast
  let dr = cIn[0] - cOut[0];
  let dg = cIn[1] - cOut[1];
  let db = cIn[2] - cOut[2];
  let normSq = dr * dr + dg * dg + db * db;

  if (targetColor !== undefined) {
    const tgt = parseRgb(targetColor);
    const distIn = (cIn[0] - tgt[0]) ** 2 + (cIn[1] - tgt[1]) ** 2 + (cIn[2] - tgt[2]) ** 2;
    const distOut = (cOut[0] - tgt[0]) ** 2 + (cOut[1] - tgt[1]) ** 2 + (cOut[2] - tgt[2]) ** 2;
    if (distOut < distIn) {
      // Normal pointed inward
      nx = -nx;
      ny = -ny;
      flipped = !flipped;
      cIn = sampleBilinearRgba(rgba, width, height, p.x - sampleDist * nx, p.y - sampleDist * ny);
      cOut = sampleBilinearRgba(rgba, width, height, p.x + sampleDist * nx, p.y + sampleDist * ny);
      dr = cIn[0] - cOut[0];
      dg = cIn[1] - cOut[1];
      db = cIn[2] - cOut[2];
      normSq = dr * dr + dg * dg + db * db;
    }
  }

  if (normSq < 36.0) return 0; // Low contrast

  const steps = 11;
  const sVals: number[] = [];
  const covs: number[] = [];
  for (let k = 0; k < steps; k++) {
    const s = -maxDist + (2 * maxDist * k) / (steps - 1);
    sVals.push(s);
    const samp = sampleBilinearRgba(rgba, width, height, p.x + s * nx, p.y + s * ny);
    const proj = ((samp[0] - cOut[0]) * dr + (samp[1] - cOut[1]) * dg + (samp[2] - cOut[2]) * db) / normSq;
    covs.push(proj);
  }

  for (let i = 0; i < sVals.length - 1; i++) {
    const c0 = covs[i] ?? 0;
    const c1 = covs[i + 1] ?? 0;
    if ((c0 - 0.5) * (c1 - 0.5) <= 0 && Math.abs(c1 - c0) > 1e-4) {
      const raw = (sVals[i] ?? 0) + ((0.5 - c0) / (c1 - c0)) * ((sVals[i + 1] ?? 0) - (sVals[i] ?? 0));
      return flipped ? -raw : raw;
    }
  }

  return 0;
}

/**
 * Refines the control points and anchors of subpaths to the 50%-coverage contour.
 */
export function refineSubpathsInEdgeBand(
  subpaths: readonly Subpath[],
  rgba: Uint8Array,
  width: number,
  height: number,
  fillColor?: string
): Subpath[] {
  return subpaths.map((subpath) => {
    const cubics = subpath.cubics;
    const n = cubics.length;
    if (n < 2) return subpath;

    const shifts: number[] = [];
    const normals: Point[] = [];

    // Compute normal and shift for each anchor point
    for (let i = 0; i < n; i++) {
      const cur = cubics[i];
      const prev = cubics[(i - 1 + n) % n];
      if (cur === undefined || prev === undefined) {
        shifts.push(0);
        normals.push({ x: 0, y: 0 });
        continue;
      }

      const p0 = cur.p0;
      const tOut = { x: cur.p1.x - p0.x, y: cur.p1.y - p0.y };
      const tIn = { x: p0.x - prev.p2.x, y: p0.y - prev.p2.y };
      const tx = tOut.x + tIn.x;
      const ty = tOut.y + tIn.y;
      const tLen = Math.hypot(tx, ty);

      if (tLen < 1e-4) {
        shifts.push(0);
        normals.push({ x: 0, y: 0 });
        continue;
      }

      const norm = { x: -ty / tLen, y: tx / tLen };
      const shift = findSubpixelShift(rgba, width, height, p0, norm, 1.2, fillColor);
      shifts.push(shift);
      normals.push(norm);
    }

    // Apply shifts to anchors and control handles
    const refinedCubics: Cubic[] = [];
    for (let i = 0; i < n; i++) {
      const cur = cubics[i];
      const sh0 = shifts[i] ?? 0;
      const norm0 = normals[i] ?? { x: 0, y: 0 };
      const nextIdx = (i + 1) % n;
      const sh1 = shifts[nextIdx] ?? 0;
      const norm1 = normals[nextIdx] ?? { x: 0, y: 0 };

      if (cur === undefined) continue;

      let p0 = { x: cur.p0.x + sh0 * norm0.x, y: cur.p0.y + sh0 * norm0.y };
      let p1 = { x: cur.p1.x + sh0 * norm0.x, y: cur.p1.y + sh0 * norm0.y };
      let p2 = { x: cur.p2.x + sh1 * norm1.x, y: cur.p2.y + sh1 * norm1.y };
      let p3 = { x: cur.p3.x + sh1 * norm1.x, y: cur.p3.y + sh1 * norm1.y };

      // Midpoint control-point optimization along the cubic
      const chordLen = Math.hypot(p3.x - p0.x, p3.y - p0.y);
      if (chordLen >= 1.5) {
        const midX = 0.125 * p0.x + 0.375 * p1.x + 0.375 * p2.x + 0.125 * p3.x;
        const midY = 0.125 * p0.y + 0.375 * p1.y + 0.375 * p2.y + 0.125 * p3.y;
        const tx = 0.75 * (p3.x + p2.x - p1.x - p0.x);
        const ty = 0.75 * (p3.y + p2.y - p1.y - p0.y);
        const tLen = Math.hypot(tx, ty);
        if (tLen > 1e-4) {
          const normMid = { x: -ty / tLen, y: tx / tLen };
          const shMid = findSubpixelShift(rgba, width, height, { x: midX, y: midY }, normMid, 0.8, fillColor);
          if (Math.abs(shMid) > 0.01 && Math.abs(shMid) <= 0.6) {
            const delta = (shMid * 4 / 3) * 0.5;
            p1 = { x: p1.x + delta * normMid.x, y: p1.y + delta * normMid.y };
            p2 = { x: p2.x + delta * normMid.x, y: p2.y + delta * normMid.y };
          }
        }
      }

      refinedCubics.push({ p0, p1, p2, p3 });
    }

    return { cubics: refinedCubics, closed: subpath.closed };
  });
}

const SHAPE_PATTERN = /<path\b[^>]*\/>|<path\b[^>]*>[\s\S]*?<\/path>|<circle\b[^>]*\/>|<ellipse\b[^>]*\/>|<rect\b[^>]*\/>/gi;

function readD(tag: string): { readonly value: string; readonly start: number; readonly end: number } | null {
  const match = /\bd\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag);
  if (match === null || match[1] === undefined || match.index === undefined) return null;
  const value = match[2] ?? "";
  const open = match.index + match[0].indexOf(match[1]);
  return { value, start: open + 1, end: open + 1 + value.length };
}

function parseTokens(data: string): { cmd: string; args: number[] }[] | null {
  const tokenRegex = /([MmLlHhVvCcSsQqTtAaZz])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
  const tokens: { cmd: string; args: number[] }[] = [];
  let currentCmd: string | null = null;
  let currentArgs: number[] = [];

  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(data)) !== null) {
    const cmd = match[1];
    const num = match[2];
    if (cmd !== undefined) {
      if (currentCmd !== null) tokens.push({ cmd: currentCmd, args: currentArgs });
      currentCmd = cmd;
      currentArgs = [];
    } else if (num !== undefined) {
      currentArgs.push(Number(num));
    }
  }
  if (currentCmd !== null) tokens.push({ cmd: currentCmd, args: currentArgs });
  return tokens;
}

export function parseSvgPath(data: string): Subpath[] | null {
  const tokens = parseTokens(data);
  if (tokens === null) return null;

  const subpaths: Subpath[] = [];
  let current: Cubic[] = [];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;

  for (const token of tokens) {
    const op = token.cmd.toLowerCase();
    const rel = token.cmd === op;
    const args = token.args;

    if (op === "m" && args.length >= 2) {
      if (current.length > 0) {
        subpaths.push({ cubics: current, closed: false });
        current = [];
      }
      cx = rel ? cx + (args[0] ?? 0) : (args[0] ?? 0);
      cy = rel ? cy + (args[1] ?? 0) : (args[1] ?? 0);
      sx = cx;
      sy = cy;
      for (let k = 2; k + 1 < args.length; k += 2) {
        const x = rel ? cx + (args[k] ?? 0) : (args[k] ?? 0);
        const y = rel ? cy + (args[k + 1] ?? 0) : (args[k + 1] ?? 0);
        const p1 = { x: cx + (x - cx) / 3, y: cy + (y - cy) / 3 };
        const p2 = { x: cx + ((x - cx) * 2) / 3, y: cy + ((y - cy) * 2) / 3 };
        current.push({ p0: { x: cx, y: cy }, p1, p2, p3: { x, y } });
        cx = x;
        cy = y;
      }
    } else if (op === "c" && args.length >= 6) {
      for (let k = 0; k + 5 < args.length; k += 6) {
        const p1 = rel ? { x: cx + (args[k] ?? 0), y: cy + (args[k + 1] ?? 0) } : { x: args[k] ?? 0, y: args[k + 1] ?? 0 };
        const p2 = rel ? { x: cx + (args[k + 2] ?? 0), y: cy + (args[k + 3] ?? 0) } : { x: args[k + 2] ?? 0, y: args[k + 3] ?? 0 };
        const p3 = rel ? { x: cx + (args[k + 4] ?? 0), y: cy + (args[k + 5] ?? 0) } : { x: args[k + 4] ?? 0, y: args[k + 5] ?? 0 };
        current.push({ p0: { x: cx, y: cy }, p1, p2, p3 });
        cx = p3.x;
        cy = p3.y;
      }
    } else if (op === "l" && args.length >= 2) {
      for (let k = 0; k + 1 < args.length; k += 2) {
        const x = rel ? cx + (args[k] ?? 0) : (args[k] ?? 0);
        const y = rel ? cy + (args[k + 1] ?? 0) : (args[k + 1] ?? 0);
        const p1 = { x: cx + (x - cx) / 3, y: cy + (y - cy) / 3 };
        const p2 = { x: cx + ((x - cx) * 2) / 3, y: cy + ((y - cy) * 2) / 3 };
        current.push({ p0: { x: cx, y: cy }, p1, p2, p3: { x, y } });
        cx = x;
        cy = y;
      }
    } else if (op === "h" && args.length >= 1) {
      for (let k = 0; k < args.length; k++) {
        const x = rel ? cx + (args[k] ?? 0) : (args[k] ?? 0);
        const p1 = { x: cx + (x - cx) / 3, y: cy };
        const p2 = { x: cx + ((x - cx) * 2) / 3, y: cy };
        current.push({ p0: { x: cx, y: cy }, p1, p2, p3: { x, y: cy } });
        cx = x;
      }
    } else if (op === "v" && args.length >= 1) {
      for (let k = 0; k < args.length; k++) {
        const y = rel ? cy + (args[k] ?? 0) : (args[k] ?? 0);
        const p1 = { x: cx, y: cy + (y - cy) / 3 };
        const p2 = { x: cx, y: cy + ((y - cy) * 2) / 3 };
        current.push({ p0: { x: cx, y: cy }, p1, p2, p3: { x: cx, y } });
        cy = y;
      }
    } else if (op === "z") {
      if (current.length > 0) {
        subpaths.push({ cubics: current, closed: true });
        current = [];
      }
      cx = sx;
      cy = sy;
    }
  }

  if (current.length > 0) subpaths.push({ cubics: current, closed: false });
  return subpaths;
}

export function serializeSvgPath(subpaths: readonly Subpath[]): string {
  const fmt = (v: number) => {
    const r = Math.round(v * 100) / 100;
    return Object.is(r, -0) ? "0" : String(r);
  };
  return subpaths
    .map((subpath) => {
      if (subpath.cubics.length === 0) return "";
      const cmds = ["M" + fmt(subpath.cubics[0]?.p0.x ?? 0) + "," + fmt(subpath.cubics[0]?.p0.y ?? 0)];
      for (const c of subpath.cubics) {
        cmds.push(
          "C" +
            fmt(c.p1.x) +
            "," +
            fmt(c.p1.y) +
            " " +
            fmt(c.p2.x) +
            "," +
            fmt(c.p2.y) +
            " " +
            fmt(c.p3.x) +
            "," +
            fmt(c.p3.y)
        );
      }
      if (subpath.closed) cmds.push("Z");
      return cmds.join("");
    })
    .join("");
}

/**
 * Refines all paths and primitives in an SVG against the source raster.
 */
export function refineSvgEdges(
  svg: string,
  rgba: Uint8Array,
  width: number,
  height: number
): string {
  return svg.replace(SHAPE_PATTERN, (tag) => {
    const fillMatch = /\bfill\s*=\s*(["'])([^"']+)\1/i.exec(tag);
    const fillColor = fillMatch ? fillMatch[2] : undefined;

    // If it is a circle primitive: refine on coverage
    if (/^<circle\b/i.test(tag)) {
      const cxMatch = /\bcx\s*=\s*(["'])([\d.-]+)\1/i.exec(tag);
      const cyMatch = /\bcy\s*=\s*(["'])([\d.-]+)\1/i.exec(tag);
      const rMatch = /\br\s*=\s*(["'])([\d.-]+)\1/i.exec(tag);
      if (cxMatch && cyMatch && rMatch) {
        const cx = Number(cxMatch[2]);
        const cy = Number(cyMatch[2]);
        const r = Number(rMatch[2]);
        const refined = fitCircleOnCoverage({ cx, cy, r }, rgba, width, height, fillColor);
        if (refined !== null) {
          return tag
            .replace(cxMatch[0], `cx="${refined.cx}"`)
            .replace(cyMatch[0], `cy="${refined.cy}"`)
            .replace(rMatch[0], `r="${refined.r}"`);
        }
      }
      return tag;
    }

    // If it is a rect primitive with rounded corners: refine on coverage
    if (/^<rect\b/i.test(tag) && /\brx\s*=/i.test(tag)) {
      const xMatch = /\bx\s*=\s*(["'])([\d.-]+)\1/i.exec(tag);
      const yMatch = /\by\s*=\s*(["'])([\d.-]+)\1/i.exec(tag);
      const wMatch = /\bwidth\s*=\s*(["'])([\d.-]+)\1/i.exec(tag);
      const hMatch = /\bheight\s*=\s*(["'])([\d.-]+)\1/i.exec(tag);
      const rxMatch = /\brx\s*=\s*(["'])([\d.-]+)\1/i.exec(tag);
      if (xMatch && yMatch && wMatch && hMatch && rxMatch) {
        const initial = {
          x: Number(xMatch[2]),
          y: Number(yMatch[2]),
          width: Number(wMatch[2]),
          height: Number(hMatch[2]),
          r: Number(rxMatch[2])
        };
        const refined = fitRoundedRectOnCoverage(initial, rgba, width, height, fillColor);
        if (refined !== null) {
          return tag
            .replace(xMatch[0], `x="${refined.x}"`)
            .replace(yMatch[0], `y="${refined.y}"`)
            .replace(wMatch[0], `width="${refined.width}"`)
            .replace(hMatch[0], `height="${refined.height}"`)
            .replace(rxMatch[0], `rx="${refined.r}"`);
        }
      }
      return tag;
    }

    // If it is a path: refine control points in edge band
    if (!/^<path\b/i.test(tag)) return tag;
    const quoted = readD(tag);
    if (quoted === null) return tag;

    const parsed = parseSvgPath(quoted.value);
    if (parsed === null || parsed.length === 0) return tag;

    const refined = refineSubpathsInEdgeBand(parsed, rgba, width, height, fillColor);
    const next = serializeSvgPath(refined);
    if (next === quoted.value) return tag;
    return tag.slice(0, quoted.start) + next + tag.slice(quoted.end);
  });
}
