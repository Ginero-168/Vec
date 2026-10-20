export type Pt = { x: number; y: number };

type Seg =
  | { kind: "L"; to: Pt }
  | { kind: "C"; c1: Pt; c2: Pt; to: Pt };

type Subpath = { start: Pt; segs: Seg[]; closed: boolean };

export type PathStats = {
  readonly paths: number;
  readonly nodes: number;
  readonly corners45: number;
  readonly fills: number;
};

const KAPPA = 0.5522847498307936;

function same(a: Pt, b: Pt): boolean {
  return Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4;
}

function readNumber(d: string, i: number): { n: number; i: number } | null {
  const nlen = d.length;
  let j = i;
  if (d[j] === "+" || d[j] === "-") j++;
  let saw = false;
  const mark = j;
  while (j < nlen && d[j]! >= "0" && d[j]! <= "9") {
    saw = true;
    j++;
  }
  if (j < nlen && d[j] === ".") {
    j++;
    while (j < nlen && d[j]! >= "0" && d[j]! <= "9") {
      saw = true;
      j++;
    }
  }
  if (!saw || j === mark) return null;
  if (j < nlen && (d[j] === "e" || d[j] === "E")) {
    let k = j + 1;
    if (d[k] === "+" || d[k] === "-") k++;
    const expStart = k;
    while (k < nlen && d[k]! >= "0" && d[k]! <= "9") k++;
    if (k > expStart) j = k;
  }
  return { n: Number(d.slice(i, j)), i: j };
}

function isCommand(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

function skipSep(d: string, i: number): number {
  while (i < d.length) {
    const ch = d[i];
    if (ch === " " || ch === "," || ch === "\n" || ch === "\r" || ch === "\t") i++;
    else break;
  }
  return i;
}

function parsePathData(d: string): { subpaths: Subpath[]; unsupported: boolean } {
  const subpaths: Subpath[] = [];
  let i = 0;
  let cmd = "";
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let prevC: Pt | null = null;
  let prevQ: Pt | null = null;
  let current: Subpath | null = null;
  let unsupported = false;

  const finish = (): void => {
    if (current !== null && (current.segs.length > 0 || current.closed)) subpaths.push(current);
    current = null;
  };

  while (i < d.length) {
    i = skipSep(d, i);
    if (i >= d.length) break;
    const ch = d[i];
    if (ch !== undefined && isCommand(ch)) {
      cmd = ch;
      i++;
      if (cmd === "Z" || cmd === "z") {
        if (current !== null && !same({ x: cx, y: cy }, { x: sx, y: sy })) {
          current.segs.push({ kind: "L", to: { x: sx, y: sy } });
        }
        if (current !== null) current.closed = true;
        cx = sx;
        cy = sy;
        prevC = null;
        prevQ = null;
        finish();
        cmd = "";
      }
      continue;
    }
    const take = (count: number): number[] | null => {
      const values: number[] = [];
      let p = i;
      for (let n = 0; n < count; n++) {
        p = skipSep(d, p);
        const num = readNumber(d, p);
        if (num === null) return null;
        values.push(num.n);
        p = num.i;
      }
      i = p;
      return values;
    };
    const rel = cmd === cmd.toLowerCase();
    if (cmd === "M" || cmd === "m") {
      const v = take(2);
      if (v === null) break;
      finish();
      cx = rel ? cx + (v[0] ?? 0) : (v[0] ?? 0);
      cy = rel ? cy + (v[1] ?? 0) : (v[1] ?? 0);
      sx = cx;
      sy = cy;
      current = { start: { x: cx, y: cy }, segs: [], closed: false };
      prevC = null;
      prevQ = null;
      cmd = rel ? "l" : "L";
      continue;
    }
    if (current === null) break;
    if (cmd === "L" || cmd === "l") {
      const v = take(2);
      if (v === null) break;
      cx = rel ? cx + (v[0] ?? 0) : (v[0] ?? 0);
      cy = rel ? cy + (v[1] ?? 0) : (v[1] ?? 0);
      current.segs.push({ kind: "L", to: { x: cx, y: cy } });
      prevC = null;
      prevQ = null;
      continue;
    }
    if (cmd === "H" || cmd === "h") {
      const v = take(1);
      if (v === null) break;
      cx = rel ? cx + (v[0] ?? 0) : (v[0] ?? 0);
      current.segs.push({ kind: "L", to: { x: cx, y: cy } });
      prevC = null;
      prevQ = null;
      continue;
    }
    if (cmd === "V" || cmd === "v") {
      const v = take(1);
      if (v === null) break;
      cy = rel ? cy + (v[0] ?? 0) : (v[0] ?? 0);
      current.segs.push({ kind: "L", to: { x: cx, y: cy } });
      prevC = null;
      prevQ = null;
      continue;
    }
    if (cmd === "C" || cmd === "c") {
      const v = take(6);
      if (v === null) break;
      const c1x = rel ? cx + (v[0] ?? 0) : (v[0] ?? 0);
      const c1y = rel ? cy + (v[1] ?? 0) : (v[1] ?? 0);
      const c2x = rel ? cx + (v[2] ?? 0) : (v[2] ?? 0);
      const c2y = rel ? cy + (v[3] ?? 0) : (v[3] ?? 0);
      cx = rel ? cx + (v[4] ?? 0) : (v[4] ?? 0);
      cy = rel ? cy + (v[5] ?? 0) : (v[5] ?? 0);
      current.segs.push({ kind: "C", c1: { x: c1x, y: c1y }, c2: { x: c2x, y: c2y }, to: { x: cx, y: cy } });
      prevC = { x: c2x, y: c2y };
      prevQ = null;
      continue;
    }
    if (cmd === "S" || cmd === "s") {
      const v = take(4);
      if (v === null) break;
      const c1 = prevC === null ? { x: cx, y: cy } : { x: 2 * cx - prevC.x, y: 2 * cy - prevC.y };
      const c2x = rel ? cx + (v[0] ?? 0) : (v[0] ?? 0);
      const c2y = rel ? cy + (v[1] ?? 0) : (v[1] ?? 0);
      cx = rel ? cx + (v[2] ?? 0) : (v[2] ?? 0);
      cy = rel ? cy + (v[3] ?? 0) : (v[3] ?? 0);
      current.segs.push({ kind: "C", c1, c2: { x: c2x, y: c2y }, to: { x: cx, y: cy } });
      prevC = { x: c2x, y: c2y };
      prevQ = null;
      continue;
    }
    if (cmd === "Q" || cmd === "q" || cmd === "T" || cmd === "t" || cmd === "A" || cmd === "a") {
      unsupported = true;
      break;
    }
    break;
  }
  finish();
  return { subpaths, unsupported };
}

function fmt(n: number, precision: number): string {
  const text = n.toFixed(precision).replace(/\.?0+$/, "");
  return text === "-0" ? "0" : text;
}

function emitSubpaths(subpaths: readonly Subpath[], precision: number): string {
  let out = "";
  for (const sub of subpaths) {
    out += (out.length > 0 ? "" : "") + "M" + fmt(sub.start.x, precision) + "," + fmt(sub.start.y, precision);
    let x = sub.start.x;
    let y = sub.start.y;
    for (const seg of sub.segs) {
      if (seg.kind === "L") {
        out += "L" + fmt(seg.to.x, precision) + "," + fmt(seg.to.y, precision);
      } else {
        out +=
          "C" +
          fmt(seg.c1.x, precision) + "," + fmt(seg.c1.y, precision) + "," +
          fmt(seg.c2.x, precision) + "," + fmt(seg.c2.y, precision) + "," +
          fmt(seg.to.x, precision) + "," + fmt(seg.to.y, precision);
      }
      x = seg.to.x;
      y = seg.to.y;
    }
    if (sub.closed && !same({ x, y }, sub.start)) out += "L" + fmt(sub.start.x, precision) + "," + fmt(sub.start.y, precision);
    if (sub.closed) out += "Z";
  }
  return out;
}

function cubicAt(a: Pt, c1: Pt, c2: Pt, b: Pt, t: number): Pt {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  return {
    x: uu * u * a.x + 3 * uu * t * c1.x + 3 * u * tt * c2.x + tt * t * b.x,
    y: uu * u * a.y + 3 * uu * t * c1.y + 3 * u * tt * c2.y + tt * t * b.y
  };
}

function sampleSeg(from: Pt, seg: Seg, steps: number): Pt[] {
  const pts: Pt[] = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    pts.push(seg.kind === "L" ? { x: from.x + (seg.to.x - from.x) * t, y: from.y + (seg.to.y - from.y) * t } : cubicAt(from, seg.c1, seg.c2, seg.to, t));
  }
  return pts;
}

function deflection(a: Pt, b: Pt, c: Pt): number {
  const v1x = b.x - a.x;
  const v1y = b.y - a.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const n1 = Math.hypot(v1x, v1y);
  const n2 = Math.hypot(v2x, v2y);
  if (n1 < 1e-9 || n2 < 1e-9) return 0;
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / (n1 * n2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

function pointLineDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dx * (a.y - p.y) - dy * (a.x - p.x)) / len;
}

function flattenCubic(a: Pt, c1: Pt, c2: Pt, b: Pt, tol: number, out: Pt[], depth: number): void {
  const d1 = pointLineDistance(c1, a, b);
  const d2 = pointLineDistance(c2, a, b);
  if ((d1 <= tol && d2 <= tol) || depth > 8) {
    out.push(b);
    return;
  }
  const ab1 = { x: (a.x + c1.x) / 2, y: (a.y + c1.y) / 2 };
  const b1b2 = { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2 };
  const b2b = { x: (c2.x + b.x) / 2, y: (c2.y + b.y) / 2 };
  const m1 = { x: (ab1.x + b1b2.x) / 2, y: (ab1.y + b1b2.y) / 2 };
  const m2 = { x: (b1b2.x + b2b.x) / 2, y: (b1b2.y + b2b.y) / 2 };
  const mid = { x: (m1.x + m2.x) / 2, y: (m1.y + m2.y) / 2 };
  flattenCubic(a, ab1, m1, mid, tol, out, depth + 1);
  flattenCubic(mid, m2, b2b, b, tol, out, depth + 1);
}

function maxErrorToCubic(samples: readonly Pt[], a: Pt, c1: Pt, c2: Pt, b: Pt): number {
  const poly: Pt[] = [a];
  flattenCubic(a, c1, c2, b, 0.35, poly, 0);
  let max = 0;
  for (const p of samples) {
    let best = Infinity;
    for (let i = 1; i < poly.length; i++) {
      const u = poly[i - 1];
      const v = poly[i];
      if (u === undefined || v === undefined) continue;
      const dx = v.x - u.x;
      const dy = v.y - u.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 < 1e-12 ? 0 : Math.min(1, Math.max(0, ((p.x - u.x) * dx + (p.y - u.y) * dy) / len2));
      const dist = Math.hypot(p.x - (u.x + dx * t), p.y - (u.y + dy * t));
      if (dist < best) best = dist;
    }
    if (best > max) max = best;
  }
  return max;
}

function unit(x: number, y: number): Pt | null {
  const n = Math.hypot(x, y);
  if (n < 1e-9) return null;
  return { x: x / n, y: y / n };
}

function startTangent(from: Pt, seg: Seg): Pt {
  if (seg.kind === "L") return unit(seg.to.x - from.x, seg.to.y - from.y) ?? { x: 1, y: 0 };
  return unit(seg.c1.x - from.x, seg.c1.y - from.y) ?? unit(seg.to.x - from.x, seg.to.y - from.y) ?? { x: 1, y: 0 };
}

function endTangent(from: Pt, seg: Seg): Pt {
  if (seg.kind === "L") return unit(seg.to.x - from.x, seg.to.y - from.y) ?? { x: 1, y: 0 };
  return unit(seg.to.x - seg.c2.x, seg.to.y - seg.c2.y) ?? unit(seg.to.x - from.x, seg.to.y - from.y) ?? { x: 1, y: 0 };
}

function fitCubic(samples: readonly Pt[], tan1: Pt, tan2: Pt): { c1: Pt; c2: Pt } | null {
  const n = samples.length;
  const p0 = samples[0];
  const p3 = samples[n - 1];
  if (p0 === undefined || p3 === undefined || n < 2) return null;
  const u = new Float64Array(n);
  let total = 0;
  for (let i = 1; i < n; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];
    if (prev === undefined || cur === undefined) continue;
    total += Math.hypot(cur.x - prev.x, cur.y - prev.y);
    u[i] = total;
  }
  if (total < 1e-6) return null;
  for (let i = 0; i < n; i++) u[i] = (u[i] ?? 0) / total;
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  for (let i = 0; i < n; i++) {
    const t = u[i] ?? 0;
    const mt = 1 - t;
    const b1 = 3 * mt * mt * t;
    const b2 = 3 * mt * t * t;
    const b0 = mt * mt * mt;
    const b3 = t * t * t;
    const targetX = (samples[i]?.x ?? 0) - (b0 * p0.x + b3 * p3.x);
    const targetY = (samples[i]?.y ?? 0) - (b0 * p0.y + b3 * p3.y);
    const v1x = b1 * tan1.x;
    const v1y = b1 * tan1.y;
    const v2x = b2 * -tan2.x;
    const v2y = b2 * -tan2.y;
    c00 += v1x * v1x + v1y * v1y;
    c01 += v1x * v2x + v1y * v2y;
    c11 += v2x * v2x + v2y * v2y;
    x0 += v1x * targetX + v1y * targetY;
    x1 += v2x * targetX + v2y * targetY;
  }
  const det = c00 * c11 - c01 * c01;
  const fallback = total / 3;
  let alpha = fallback;
  let beta = fallback;
  if (Math.abs(det) > 1e-10) {
    alpha = (x0 * c11 - x1 * c01) / det;
    beta = (x1 * c00 - x0 * c01) / det;
  }
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha > total * 3) alpha = fallback;
  if (!Number.isFinite(beta) || beta <= 0 || beta > total * 3) beta = fallback;
  return {
    c1: { x: p0.x + tan1.x * alpha, y: p0.y + tan1.y * alpha },
    c2: { x: p3.x - tan2.x * beta, y: p3.y - tan2.y * beta }
  };
}

type Sample = { p: Pt; tol: number };
type Span = { seg: Seg; origin: Sample[] };
type Ring = { points: Pt[]; spans: Span[]; closed: boolean };

function toRing(sub: Subpath): Ring {
  const points: Pt[] = [sub.start];
  const segs: Seg[] = [];
  for (const seg of sub.segs) {
    if (sub.closed && same(seg.to, sub.start) && segs.length === sub.segs.length - 1 && points.length > 1) {
      segs.push(seg);
      break;
    }
    if (same(seg.to, points[points.length - 1] ?? seg.to) && seg.kind === "L") continue;
    points.push(seg.to);
    segs.push(seg);
  }
  if (sub.closed && points.length > 1 && same(points[points.length - 1] ?? sub.start, sub.start)) {
    points.pop();
  }
  const spans: Span[] = [];
  for (let i = 0; i < segs.length; i++) {
    const from = points[i] ?? points[0];
    const seg = segs[i];
    if (from === undefined || seg === undefined) continue;
    const origin = sampleSeg(from, seg, 8).slice(0, -1).map((p) => ({ p, tol: 0.5 }));
    spans.push({ seg, origin });
  }
  return { points, spans, closed: sub.closed };
}

function fromRing(ring: Ring): Subpath {
  const start = ring.points[0];
  if (start === undefined) return { start: { x: 0, y: 0 }, segs: [], closed: ring.closed };
  return { start, segs: ring.spans.map((span) => span.seg), closed: ring.closed };
}

function sampleGrad(grad: Float32Array, width: number, height: number, p: Pt): number {
  const x = Math.max(0, Math.min(width - 1, Math.round(p.x)));
  const y = Math.max(0, Math.min(height - 1, Math.round(p.y)));
  return grad[y * width + x] ?? 0;
}

export type SimplifyOptions = {
  readonly simplify: number;
  readonly cornerThreshold: number;
  readonly weakGradient: number;
  readonly weakScale: number;
  readonly adaptive: boolean;
};

function assignedTolerance(origin: Sample[], grad: Float32Array, width: number, height: number, opt: SimplifyOptions): Sample[] {
  return origin.map((sample) => {
    const strength = sampleGrad(grad, width, height, sample.p);
    const tol = strength < opt.weakGradient ? opt.simplify * opt.weakScale : opt.simplify;
    return { p: sample.p, tol };
  });
}

function withinTolerance(samples: readonly Sample[], a: Pt, seg: Seg): boolean {
  if (seg.kind === "L") {
    return samples.every((sample) => pointLineDistance(sample.p, a, seg.to) <= sample.tol + 1e-6);
  }
  const pts = samples.map((sample) => sample.p);
  const err = maxErrorToCubic(pts, a, seg.c1, seg.c2, seg.to);
  if (err === 0) return true;
  // Reject when any original sample, not the average, leaves its own budget.
  const flat: Pt[] = [a];
  flattenCubic(a, seg.c1, seg.c2, seg.to, 0.3, flat, 0);
  for (const sample of samples) {
    let best = Infinity;
    for (let i = 1; i < flat.length; i++) {
      const u = flat[i - 1];
      const v = flat[i];
      if (u === undefined || v === undefined) continue;
      const dx = v.x - u.x;
      const dy = v.y - u.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 < 1e-12 ? 0 : Math.min(1, Math.max(0, ((sample.p.x - u.x) * dx + (sample.p.y - u.y) * dy) / len2));
      best = Math.min(best, Math.hypot(sample.p.x - (u.x + dx * t), sample.p.y - (u.y + dy * t)));
    }
    if (best > sample.tol + 1e-6) return false;
  }
  return true;
}

function simplifyRing(ring: Ring, grad: Float32Array, width: number, height: number, opt: SimplifyOptions): Ring {
  if (!opt.adaptive || opt.simplify <= 0) return ring;
  const points = ring.points.map((p) => ({ x: p.x, y: p.y }));
  const spans = ring.spans.map((span) => ({ seg: span.seg, origin: assignedTolerance(span.origin, grad, width, height, opt) }));
  const closed = ring.closed;
  const count = (): number => points.length;
  for (let pass = 0; pass < 6; pass++) {
    let removed = false;
    let i = 0;
    while (i < count()) {
      const n = count();
      if (n <= (closed ? 4 : 2)) break;
      if (!closed && (i === 0 || i === n - 1)) {
        i++;
        continue;
      }
      const prev = (i - 1 + n) % n;
      const next = (i + 1) % n;
      const a = points[prev];
      const b = points[i];
      const c = points[next];
      const spanIn = closed ? spans[prev] : spans[i - 1];
      const spanOut = spans[i];
      if (a === undefined || b === undefined || c === undefined || spanIn === undefined || spanOut === undefined) {
        i++;
        continue;
      }
      if (deflection(a, b, c) >= opt.cornerThreshold) {
        i++;
        continue;
      }
      const origin = spanIn.origin.concat(spanOut.origin);
      const line: Seg = { kind: "L", to: { x: c.x, y: c.y } };
      let replacement: Seg | null = withinTolerance(origin, a, line) ? line : null;
      if (replacement === null) {
        const fit = fitCubic(origin.map((sample) => sample.p), startTangent(a, spanIn.seg), endTangent(b, spanOut.seg));
        if (fit !== null) {
          const cubic: Seg = { kind: "C", c1: fit.c1, c2: fit.c2, to: { x: c.x, y: c.y } };
          if (withinTolerance(origin, a, cubic)) replacement = cubic;
        }
      }
      if (replacement === null) {
        i++;
        continue;
      }
      const merged: Span = { seg: replacement, origin };
      points.splice(i, 1);
      if (closed) {
        spans[prev] = merged;
        spans.splice(i === 0 ? 0 : i, 1);
      } else {
        spans[i - 1] = merged;
        spans.splice(i, 1);
      }
      removed = true;
      if (i >= points.length) break;
    }
    if (!removed) break;
  }
  if (closed && spans.length !== points.length) return ring;
  if (!closed && spans.length !== points.length - 1) return ring;
  return { points, spans, closed };
}

function signedArea(points: readonly Pt[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a === undefined || b === undefined) continue;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function ellipseError(points: readonly Pt[], cx: number, cy: number, rx: number, ry: number, rot: number): number {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  let max = 0;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    const r = Math.hypot(lx / rx, ly / ry);
    if (r < 1e-6) {
      max = Math.max(max, Math.max(rx, ry));
      continue;
    }
    const ex = (lx / r) * rx;
    const ey = (ly / r) * ry;
    max = Math.max(max, Math.hypot(lx - ex, ly - ey));
  }
  return max;
}

function fitEllipse(points: readonly Pt[]): { cx: number; cy: number; rx: number; ry: number; rot: number; error: number } | null {
  const n = points.length;
  if (n < 8) return null;
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  sxx /= n;
  syy /= n;
  sxy /= n;
  const trace = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.max(0, trace * trace - 4 * det);
  const l1 = (trace + Math.sqrt(disc)) / 2;
  const l2 = (trace - Math.sqrt(disc)) / 2;
  if (l1 <= 1e-6 || l2 <= 1e-6) return null;
  const rot = Math.abs(sxy) < 1e-8 && sxx >= syy ? 0 : Math.atan2(l1 - sxx, sxy);
  const rx = Math.sqrt(2 * l1);
  const ry = Math.sqrt(2 * l2);
  if (rx < 2 || ry < 2) return null;
  return { cx, cy, rx, ry, rot, error: ellipseError(points, cx, cy, rx, ry, rot) };
}

function ellipseRing(cx: number, cy: number, rx: number, ry: number, rot: number, clockwise: boolean): Ring {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const map = (x: number, y: number): Pt => ({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos });
  const sign = clockwise ? -1 : 1;
  const k = KAPPA;
  const raw = [
    map(rx, 0),
    map(rx, sign * ry * k),
    map(rx * k, sign * ry),
    map(0, sign * ry),
    map(-rx * k, sign * ry),
    map(-rx, sign * ry * k),
    map(-rx, 0),
    map(-rx, -sign * ry * k),
    map(-rx * k, -sign * ry),
    map(0, -sign * ry),
    map(rx * k, -sign * ry),
    map(rx, -sign * ry * k),
    map(rx, 0)
  ];
  const start = raw[0];
  if (start === undefined) return { points: [], spans: [], closed: true };
  const points: Pt[] = [start, raw[3]!, raw[6]!, raw[9]!];
  const spans: Span[] = [];
  for (let i = 0; i < 4; i++) {
    const c1 = raw[i * 3 + 1];
    const c2 = raw[i * 3 + 2];
    const to = raw[i * 3 + 3];
    if (c1 === undefined || c2 === undefined || to === undefined) continue;
    const seg: Seg = { kind: "C", c1, c2, to };
    const from = points[i];
    const origin = from === undefined ? [] : sampleSeg(from, seg, 6).slice(0, -1).map((p) => ({ p, tol: 0.5 }));
    spans.push({ seg, origin });
  }
  return { points, spans, closed: true };
}

function contourPoints(ring: Ring): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < ring.spans.length; i++) {
    const from = ring.points[i];
    const span = ring.spans[i];
    if (from === undefined || span === undefined) continue;
    const samples = sampleSeg(from, span.seg, 6);
    for (let s = 0; s < samples.length - 1; s++) {
      const p = samples[s];
      if (p !== undefined) pts.push(p);
    }
  }
  return pts;
}

function maybeEllipse(ring: Ring, tolerance: number): Ring {
  if (!ring.closed || ring.points.length < 6) return ring;
  const samples = contourPoints(ring);
  const fit = fitEllipse(samples);
  if (fit === null || fit.error > tolerance) return ring;
  const area = signedArea(samples);
  return ellipseRing(fit.cx, fit.cy, fit.rx, fit.ry, fit.rot, area < 0);
}

export function processSvg(
  svg: string,
  grad: Float32Array | null,
  width: number,
  height: number,
  opt: SimplifyOptions & { readonly ellipseFit: boolean; readonly ellipseTolerance: number; readonly precision: number }
): { svg: string; stats: PathStats } {
  const fills = new Set<string>();
  let paths = 0;
  const next = svg.replace(/<path\b([^>]*)>/g, (full, attrs: string) => {
    paths++;
    const fill = /fill="([^"]+)"/.exec(attrs);
    if (fill?.[1]) fills.add(fill[1].toLowerCase());
    const found = /\bd="([^"]*)"/.exec(attrs);
    const d = found?.[1];
    if (d === undefined) return full;
    const parsed = parsePathData(d);
    if (parsed.unsupported) return full;
    const subpaths = parsed.subpaths.map((sub) => {
      let ring = toRing(sub);
      if (grad !== null) ring = simplifyRing(ring, grad, width, height, opt);
      if (opt.ellipseFit) ring = maybeEllipse(ring, opt.ellipseTolerance);
      return fromRing(ring);
    });
    const emitted = emitSubpaths(subpaths, opt.precision);
    const updated = attrs.replace(/\bd="[^"]*"/, ' d="' + emitted + '"');
    return "<path" + updated + ">";
  });
  return { svg: next, stats: analyzeSvg(next, fills.size, paths) };
}

function anchorCount(sub: Subpath): number {
  if (sub.segs.length === 0) return 1;
  let n = 1;
  for (let i = 0; i < sub.segs.length; i++) {
    const seg = sub.segs[i];
    if (seg === undefined) continue;
    if (sub.closed && i === sub.segs.length - 1 && same(seg.to, sub.start)) continue;
    n++;
  }
  return n;
}

function cornersOf(sub: Subpath, threshold: number): number {
  const ring = toRing(sub);
  const pts = ring.points;
  const n = pts.length;
  if (n < 3) return 0;
  let corners = 0;
  const last = ring.closed ? n : n - 1;
  const first = ring.closed ? 0 : 1;
  for (let i = first; i < last; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    if (a === undefined || b === undefined || c === undefined) continue;
    if (deflection(a, b, c) >= threshold) corners++;
  }
  return corners;
}

export function analyzeSvg(svg: string, knownFills?: number, knownPaths?: number): PathStats {
  let paths = 0;
  let nodes = 0;
  let corners45 = 0;
  const fills = new Set<string>();
  const re = /<path\b([^>]*)>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(svg)) !== null) {
    paths++;
    const attrs = match[1] ?? "";
    const fill = /fill="([^"]+)"/.exec(attrs);
    if (fill?.[1]) fills.add(fill[1].toLowerCase());
    const d = /\bd="([^"]*)"/.exec(attrs)?.[1];
    if (d === undefined) continue;
    const parsed = parsePathData(d);
    for (const sub of parsed.subpaths) {
      nodes += anchorCount(sub);
      corners45 += cornersOf(sub, 45);
    }
  }
  return {
    paths: knownPaths ?? paths,
    nodes,
    corners45,
    fills: knownFills ?? fills.size
  };
}

export function selfCheckGeometry(): string[] {
  const errors: string[] = [];
  const circle = 'M10,0C10,5.523 5.523,10 0,10C-5.523,10 -10,5.523 -10,0C-10,-5.523 -5.523,-10 0,-10C5.523,-10 10,-5.523 10,0Z';
  const parsed = parsePathData(circle);
  if (parsed.subpaths.length !== 1) errors.push("circle subpaths " + parsed.subpaths.length);
  const ring = maybeEllipse(toRing(parsed.subpaths[0] ?? { start: { x: 0, y: 0 }, segs: [], closed: true }), 1.2);
  if (ring.points.length !== 4) errors.push("ellipse anchors " + ring.points.length);
  const noisy = parsePathData("M0,0L1,0.01L2,-0.02L3,0.01L4,0L8,0");
  const grad = new Float32Array(20 * 20);
  const simplified = simplifyRing(toRing(noisy.subpaths[0] ?? { start: { x: 0, y: 0 }, segs: [], closed: false }), grad, 20, 20, {
    simplify: 0.4,
    cornerThreshold: 60,
    weakGradient: 30,
    weakScale: 3,
    adaptive: true
  });
  if (simplified.points.length >= 6) errors.push("adaptive kept " + simplified.points.length);
  const sharp = parsePathData("M0,0L5,0L5,5");
  const kept = simplifyRing(toRing(sharp.subpaths[0] ?? { start: { x: 0, y: 0 }, segs: [], closed: false }), grad, 20, 20, {
    simplify: 2,
    cornerThreshold: 50,
    weakGradient: 30,
    weakScale: 3,
    adaptive: true
  });
  if (kept.points.length !== 3) errors.push("corner was removed, anchors " + kept.points.length);
  return errors;
}
