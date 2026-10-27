export type TraceFacts = {
  readonly paths: number;
  readonly anchors: number;
  readonly holes: number;
  readonly colors: number;
  readonly palette: readonly string[];
  readonly circles: number;
  readonly ellipses: number;
  readonly rects: number;
  readonly roundRects: number;
};

type Point = { readonly x: number; readonly y: number };

type Subpath = { readonly points: readonly Point[]; readonly area: number };

const ARG_COUNT: Readonly<Record<string, number>> = {
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  t: 2,
  a: 7,
  z: 0
};

export function holeNote(holes: number): string | null {
  if (!Number.isInteger(holes) || holes <= 0) return null;
  return "มีรู " + String(holes) + " จุด";
}

export function shapeNote(facts: TraceFacts): string | null {
  const parts: string[] = [];
  if (facts.circles > 0) parts.push("วงกลม " + String(facts.circles));
  if (facts.ellipses > 0) parts.push("วงรี " + String(facts.ellipses));
  const sharpRects = Math.max(0, facts.rects - facts.roundRects);
  if (sharpRects > 0) parts.push("สี่เหลี่ยม " + String(sharpRects));
  if (facts.roundRects > 0) parts.push("สี่เหลี่ยมมุมมน " + String(facts.roundRects));
  return parts.length === 0 ? null : parts.join(" · ");
}

export function scoreSvg(svg: string): TraceFacts {
  const palette: string[] = [];
  const seen = new Set<string>();
  let paths = 0;
  let anchors = 0;
  let holes = 0;
  let circles = 0;
  let ellipses = 0;
  let rects = 0;
  let roundRects = 0;
  for (const tag of pathTags(svg)) {
    const name = elementName(tag.source);
    const attrs = tagAttrs(tag.source);
    const fill = normalizeFill(fillOf(attrs));
    if (name === "path") {
      const data = readAttr(attrs, "d");
      if (data === null || data.trim() === "") continue;
      paths += 1;
      rememberFill(fill, seen, palette);
      const measured = measurePath(data);
      anchors += measured.anchors;
      holes += measured.holes;
      continue;
    }
    if (measurePrimitive(name, attrs) === null) continue;
    paths += 1;
    anchors += 4;
    rememberFill(fill, seen, palette);
    if (name === "circle") circles += 1;
    else if (name === "ellipse") ellipses += 1;
    else if (name === "rect") {
      rects += 1;
      const rx = Number(readAttr(attrs, "rx") ?? "0");
      const ry = Number(readAttr(attrs, "ry") ?? "0");
      if ((Number.isFinite(rx) && rx > 0.5) || (Number.isFinite(ry) && ry > 0.5)) roundRects += 1;
    }
  }
  return { paths, anchors, holes, colors: palette.length, palette, circles, ellipses, rects, roundRects };
}

function rememberFill(fill: string | null, seen: Set<string>, palette: string[]): void {
  if (fill === null || seen.has(fill)) return;
  seen.add(fill);
  palette.push(fill);
}

export function dropCanvasBackground(svg: string, borderColor?: string | null): string {
  if (borderColor === undefined || borderColor === null || borderColor.trim() === "") return svg;
  const border = normalizeFill(borderColor);
  if (border === null) return svg;
  const size = canvasSize(svg);
  if (size === null) return svg;
  const matches = pathTags(svg);
  if (matches.length < 2) return svg;
  let chosen: PathTag | null = null;
  let chosenArea = 0;
  for (const tag of matches) {
    const measured = measureTag(tag);
    if (measured === null) continue;
    const fill = normalizeFill(fillOf(tagAttrs(tag.source)));
    if (fill === null || !samePaint(fill, border)) continue;
    if (edgesTouched(measured, size.width, size.height) < 3) continue;
    if (chosen === null || measured.area > chosenArea) {
      chosen = tag;
      chosenArea = measured.area;
    }
  }
  if (chosen === null) return svg;
  return svg.slice(0, chosen.index) + svg.slice(chosen.index + chosen.length);
}

function edgesTouched(measured: MeasuredPath, width: number, height: number): number {
  let left = false;
  let right = false;
  let top = false;
  let bottom = false;
  for (const point of measured.samples) {
    if (point.x <= 1) left = true;
    if (point.y <= 1) top = true;
    if (point.x >= width - 1) right = true;
    if (point.y >= height - 1) bottom = true;
  }
  return Number(left) + Number(right) + Number(top) + Number(bottom);
}

function samePaint(fill: string, border: string): boolean {
  if (fill === border) return true;
  const left = rgbOf(fill);
  const right = rgbOf(border);
  if (left === null || right === null) return false;
  return Math.abs(left[0] - right[0]) <= 18 && Math.abs(left[1] - right[1]) <= 18 && Math.abs(left[2] - right[2]) <= 18;
}

function rgbOf(fill: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(fill);
  if (match === null) return null;
  const hex = match[1] ?? "";
  return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
}

export function dropFill(svg: string, fill: string): string {
  const target = normalizeFill(fill);
  if (target === null) return svg;
  const tags = pathTags(svg);
  const matches = tags.filter((tag) => normalizeFill(fillOf(tagAttrs(tag.source))) === target);
  if (matches.length === 0 || matches.length >= tags.length) return svg;
  let result = svg;
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const tag = matches[index];
    if (tag === undefined) continue;
    result = result.slice(0, tag.index) + result.slice(tag.index + tag.length);
  }
  return result;
}

export function fitShapes(svg: string): string {
  const tags = pathTags(svg);
  if (tags.length === 0) return svg;
  let result = "";
  let cursor = 0;
  for (const tag of tags) {
    result += svg.slice(cursor, tag.index);
    result += fittedMarkup(tag) ?? tag.source;
    cursor = tag.index + tag.length;
  }
  return result + svg.slice(cursor);
}

export function sealGaps(svg: string, strokeWidth = 0.8): string {
  const width = Math.round(Math.min(4, Math.max(0.8, strokeWidth)) * 10) / 10;
  return svg.replace(/<(path|circle|ellipse|rect)\b([^>]*?)\s*(\/?)\s*>/gi, (full, name: string, attrs: string, slash: string) => {
    if (/\bstroke\s*=/i.test(attrs)) return full;
    const fill = fillOf(attrs);
    const paint = normalizeFill(fill);
    if (fill === null || paint === null) return full;
    return "<" + name + attrs + ' stroke="' + fill.replace(/"/g, "") + '" stroke-width="' + String(width) + '" stroke-linejoin="round"' + (slash === "/" ? "/" : "") + ">";
  });
}

function fittedMarkup(tag: PathTag): string | null {
  if (elementName(tag.source) !== "path") return null;
  const attrs = tagAttrs(tag.source);
  const data = readAttr(attrs, "d");
  if (data === null) return null;
  const measured = measurePath(data);
  if (measured.loops !== 1 || measured.samples.length < 4) return null;
  const fill = fillOf(attrs);
  const fillAttr = fill === null ? "" : ' fill="' + fill.replace(/"/g, "") + '"';
  const rect = fitRect(measured);
  if (rect !== null) return '<rect x="' + fmt(rect.x) + '" y="' + fmt(rect.y) + '" width="' + fmt(rect.width) + '" height="' + fmt(rect.height) + '"' + fillAttr + "/>";
  const round = fitRoundRect(measured);
  if (round !== null) return '<rect x="' + fmt(round.x) + '" y="' + fmt(round.y) + '" width="' + fmt(round.width) + '" height="' + fmt(round.height) + '" rx="' + fmt(round.r) + '" ry="' + fmt(round.r) + '"' + fillAttr + "/>";
  const circle = fitCircle(measured);
  if (circle !== null) return '<circle cx="' + fmt(circle.cx) + '" cy="' + fmt(circle.cy) + '" r="' + fmt(circle.r) + '"' + fillAttr + "/>";
  const ellipse = fitEllipse(measured);
  if (ellipse !== null) return '<ellipse cx="' + fmt(ellipse.cx) + '" cy="' + fmt(ellipse.cy) + '" rx="' + fmt(ellipse.rx) + '" ry="' + fmt(ellipse.ry) + '"' + fillAttr + "/>";
  const squircle = fitSquircle(measured);
  if (squircle !== null) return '<path d="' + squircle + '"' + fillAttr + "/>";
  return null;
}

function fitRect(measured: MeasuredPath): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null {
  const width = measured.maxX - measured.minX;
  const height = measured.maxY - measured.minY;
  if (!(width >= 2) || !(height >= 2)) return null;
  const tolerance = Math.max(0.6, Math.min(width, height) * 0.02);
  let left = false;
  let right = false;
  let top = false;
  let bottom = false;
  for (const point of measured.samples) {
    const nearLeft = Math.abs(point.x - measured.minX);
    const nearRight = Math.abs(point.x - measured.maxX);
    const nearTop = Math.abs(point.y - measured.minY);
    const nearBottom = Math.abs(point.y - measured.maxY);
    if (Math.min(nearLeft, nearRight, nearTop, nearBottom) > tolerance) return null;
    if (nearLeft <= tolerance) left = true;
    if (nearRight <= tolerance) right = true;
    if (nearTop <= tolerance) top = true;
    if (nearBottom <= tolerance) bottom = true;
  }
  const boxArea = width * height;
  if (!left || !right || !top || !bottom || !(boxArea > 0) || measured.area / boxArea < 0.92) return null;
  return { x: measured.minX, y: measured.minY, width, height };
}

function fitRoundRect(measured: MeasuredPath): { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly r: number } | null {
  const width = measured.maxX - measured.minX;
  const height = measured.maxY - measured.minY;
  const small = Math.min(width, height);
  if (!(width >= 6) || !(height >= 6)) return null;
  const maxRadius = small * 0.45;
  if (!(maxRadius >= 2)) return null;
  const limit = Math.max(0.9, small * 0.01);
  let best: { readonly r: number; readonly error: number } | null = null;
  for (let radius = 2; radius <= maxRadius + 1e-6; radius += 0.25) {
    const scored = roundRectError(measured, radius);
    if (scored === null) continue;
    if (best === null || scored < best.error) best = { r: radius, error: scored };
  }
  if (best === null || best.error > limit) return null;
  const expected = width * height - (4 - Math.PI) * best.r * best.r;
  if (!(expected > 0) || Math.abs(measured.area - expected) / expected > 0.08) return null;
  const flatShort = small - 2 * best.r;
  if (flatShort < Math.max(4, small * 0.12)) return null;
  const ratio = width / height;
  if (ratio > 0.92 && ratio < 1.08 && best.r > small * 0.3) return null;
  return { x: measured.minX, y: measured.minY, width, height, r: best.r };
}

function roundRectError(measured: MeasuredPath, radius: number): number | null {
  const halfW = (measured.maxX - measured.minX) / 2;
  const halfH = (measured.maxY - measured.minY) / 2;
  const cx = (measured.minX + measured.maxX) / 2;
  const cy = (measured.minY + measured.maxY) / 2;
  let maxError = 0;
  let arc = false;
  let side = false;
  for (const point of measured.samples) {
    const qx = Math.abs(point.x - cx) - (halfW - radius);
    const qy = Math.abs(point.y - cy) - (halfH - radius);
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
    const inside = Math.min(Math.max(qx, qy), 0);
    maxError = Math.max(maxError, Math.abs(outside + inside - radius));
    if (qx > 0.4 && qy > 0.4) arc = true;
    if ((qx <= 0.4 && qy > radius * 0.4) || (qy <= 0.4 && qx > radius * 0.4)) side = true;
  }
  return arc && side ? maxError : null;
}

function fitCircle(measured: MeasuredPath): { readonly cx: number; readonly cy: number; readonly r: number } | null {
  const points = measured.samples;
  if (points.length < 8) return null;
  let sumX = 0;
  let sumY = 0;
  let sumX2 = 0;
  let sumY2 = 0;
  let sumXY = 0;
  let sumX3 = 0;
  let sumY3 = 0;
  let sumX2Y = 0;
  let sumXY2 = 0;
  for (const point of points) {
    const x = point.x;
    const y = point.y;
    const x2 = x * x;
    const y2 = y * y;
    sumX += x;
    sumY += y;
    sumX2 += x2;
    sumY2 += y2;
    sumXY += x * y;
    sumX3 += x2 * x;
    sumY3 += y2 * y;
    sumX2Y += x2 * y;
    sumXY2 += x * y2;
  }
  const count = points.length;
  const a = count * sumX2 - sumX * sumX;
  const b = count * sumXY - sumX * sumY;
  const c = count * sumY2 - sumY * sumY;
  const d = 0.5 * (count * sumX3 + count * sumXY2 - sumX * sumX2 - sumX * sumY2);
  const e = 0.5 * (count * sumX2Y + count * sumY3 - sumY * sumX2 - sumY * sumY2);
  const denom = a * c - b * b;
  if (Math.abs(denom) < 1e-6) return null;
  const cx = (d * c - b * e) / denom;
  const cy = (a * e - b * d) / denom;
  let radius = 0;
  for (const point of points) radius += Math.hypot(point.x - cx, point.y - cy);
  radius /= count;
  if (!(radius > 1.5)) return null;
  let maxError = 0;
  for (const point of points) maxError = Math.max(maxError, Math.abs(Math.hypot(point.x - cx, point.y - cy) - radius));
  if (maxError > Math.max(1.25, radius * 0.04)) return null;
  const expected = Math.PI * radius * radius;
  if (Math.abs(measured.area - expected) / expected > 0.12) return null;
  return { cx, cy, r: radius };
}

function fitEllipse(measured: MeasuredPath): { readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number } | null {
  const rx = (measured.maxX - measured.minX) / 2;
  const ry = (measured.maxY - measured.minY) / 2;
  if (!(rx >= 2) || !(ry >= 2)) return null;
  const ratio = rx / ry;
  if (ratio > 0.92 && ratio < 1.08) return null;
  const cx = (measured.minX + measured.maxX) / 2;
  const cy = (measured.minY + measured.maxY) / 2;
  let maxError = 0;
  for (const point of measured.samples) {
    maxError = Math.max(maxError, Math.abs(Math.hypot((point.x - cx) / rx, (point.y - cy) / ry) - 1));
  }
  if (maxError > 0.04) return null;
  const expected = Math.PI * rx * ry;
  if (!(expected > 0) || Math.abs(measured.area - expected) / expected > 0.12) return null;
  return { cx, cy, rx, ry };
}

function fitSquircle(measured: MeasuredPath): string | null {
  const width = measured.maxX - measured.minX;
  const height = measured.maxY - measured.minY;
  if (!(width >= 8) || !(height >= 8) || measured.samples.length < 16) return null;
  const cx = (measured.minX + measured.maxX) / 2;
  const cy = (measured.minY + measured.maxY) / 2;
  const rx = width / 2;
  const ry = height / 2;
  let corners = 0;
  for (const point of measured.samples) {
    if ((point.x - cx) * (point.y - cy) !== 0 && Math.abs(point.x - cx) > rx * 0.45 && Math.abs(point.y - cy) > ry * 0.45) corners += 1;
  }
  if (corners < 4) return null;
  let bestN = 0;
  let bestError = Infinity;
  for (let n = 3.5; n <= 6.0001; n += 0.25) {
    const error = squircleError(measured.samples, cx, cy, rx, ry, n);
    if (error < bestError) {
      bestError = error;
      bestN = n;
    }
  }
  if (!(bestError <= 0.5)) return null;
  const expected = squircleArea(rx, ry, bestN);
  if (!(expected > 0) || Math.abs(measured.area - expected) / expected > 0.08) return null;
  const path = squirclePath(cx, cy, rx, ry, bestN);
  return pathError(path, cx, cy, rx, ry, bestN) <= 0.2 ? path : null;
}

function squircleError(samples: readonly Point[], cx: number, cy: number, rx: number, ry: number, n: number): number {
  let worst = 0;
  for (const point of samples) {
    const nx = Math.abs(point.x - cx) / rx;
    const ny = Math.abs(point.y - cy) / ry;
    const radial = (nx ** n + ny ** n) ** (1 / n);
    worst = Math.max(worst, Math.abs(radial - 1) * Math.min(rx, ry));
  }
  return worst;
}

function squircleArea(rx: number, ry: number, n: number): number {
  let area = 0;
  const steps = 720;
  let previous = squirclePoint(0, 0, rx, ry, n, 0);
  for (let step = 1; step <= steps; step += 1) {
    const point = squirclePoint(0, 0, rx, ry, n, step / steps);
    area += previous.x * point.y - point.x * previous.y;
    previous = point;
  }
  return Math.abs(area) / 2;
}

function squirclePoint(cx: number, cy: number, rx: number, ry: number, n: number, t: number): Point {
  const angle = t * Math.PI * 2;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const power = 2 / n;
  return {
    x: cx + rx * Math.sign(cosine) * Math.abs(cosine) ** power,
    y: cy + ry * Math.sign(sine) * Math.abs(sine) ** power
  };
}

function squirclePath(cx: number, cy: number, rx: number, ry: number, n: number): string {
  const count = 16;
  const points: Point[] = [];
  for (let index = 0; index < count; index += 1) points.push(squirclePoint(cx, cy, rx, ry, n, index / count));
  let path = "M" + fmt(points[0]?.x ?? cx) + "," + fmt(points[0]?.y ?? cy);
  for (let index = 0; index < count; index += 1) {
    const p0 = points[(index - 1 + count) % count] ?? { x: cx, y: cy };
    const p1 = points[index] ?? p0;
    const p2 = points[(index + 1) % count] ?? p1;
    const p3 = points[(index + 2) % count] ?? p2;
    path +=
      "C" +
      fmt(p1.x + (p2.x - p0.x) / 6) +
      "," +
      fmt(p1.y + (p2.y - p0.y) / 6) +
      " " +
      fmt(p2.x - (p3.x - p1.x) / 6) +
      "," +
      fmt(p2.y - (p3.y - p1.y) / 6) +
      " " +
      fmt(p2.x) +
      "," +
      fmt(p2.y);
  }
  return path + "Z";
}

function pathError(path: string, cx: number, cy: number, rx: number, ry: number, n: number): number {
  const measured = measurePath(path);
  return squircleError(measured.samples, cx, cy, rx, ry, n);
}

function fmt(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export function groupPathsByFill(svg: string): string {
  const matches = pathTags(svg);
  if (matches.length < 2) return svg;
  const placed: PlacedPath[] = [];
  for (const tag of matches) {
    const measured = measureTag(tag);
    const attrs = tagAttrs(tag.source);
    placed.push({
      tag,
      fill: normalizeFill(fillOf(attrs)) ?? "none",
      minX: measured?.minX ?? 0,
      minY: measured?.minY ?? 0,
      maxX: measured?.maxX ?? 0,
      maxY: measured?.maxY ?? 0
    });
  }
  for (let left = 0; left < placed.length; left += 1) {
    for (let right = left + 1; right < placed.length; right += 1) {
      const a = placed[left];
      const b = placed[right];
      if (a === undefined || b === undefined || a.fill === b.fill) continue;
      if (boxesOverlap(a, b)) return svg;
    }
  }
  const first = matches[0];
  const last = matches[matches.length - 1];
  if (first === undefined || last === undefined) return svg;
  const buckets = new Map<string, string[]>();
  for (const item of placed) {
    const group = buckets.get(item.fill);
    if (group === undefined) buckets.set(item.fill, [item.tag.source]);
    else group.push(item.tag.source);
  }
  const grouped = Array.from(buckets, ([fill, tags]) => {
    const id = "color-" + fill.replace(/[^0-9a-z]+/gi, "");
    return '<g id="' + id + '">' + tags.join("") + "</g>";
  }).join("");
  return svg.slice(0, first.index) + grouped + svg.slice(last.index + last.length);
}

type PathTag = { readonly index: number; readonly length: number; readonly source: string };

type PlacedPath = {
  readonly tag: PathTag;
  readonly fill: string;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

type MeasuredPath = {
  readonly anchors: number;
  readonly holes: number;
  readonly area: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly loops: number;
  readonly samples: readonly Point[];
};

function pathTags(svg: string): PathTag[] {
  const found: PathTag[] = [];
  const pattern = /<path\b[^>]*\/>|<path\b[^>]*>[\s\S]*?<\/path>|<circle\b[^>]*\/>|<ellipse\b[^>]*\/>|<rect\b[^>]*\/>/gi;
  let match = pattern.exec(svg);
  while (match !== null) {
    found.push({ index: match.index, length: match[0].length, source: match[0] });
    match = pattern.exec(svg);
  }
  return found;
}

function elementName(tag: string): string {
  return (/^<([a-z]+)/i.exec(tag)?.[1] ?? "").toLowerCase();
}

function tagAttrs(tag: string): string {
  const match = /^<(?:path|circle|ellipse|rect)\b([^>]*)>/i.exec(tag);
  return match?.[1] ?? "";
}

function canvasSize(svg: string): { readonly width: number; readonly height: number } | null {
  const tag = /<svg\b([^>]*)>/i.exec(svg);
  if (tag === null) return null;
  const attrs = tag[1] ?? "";
  const width = lengthOf(readAttr(attrs, "width"));
  const height = lengthOf(readAttr(attrs, "height"));
  if (width !== null && height !== null) return { width, height };
  const viewBox = readAttr(attrs, "viewBox");
  if (viewBox === null) return null;
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  const boxWidth = parts[2];
  const boxHeight = parts[3];
  if (boxWidth === undefined || boxHeight === undefined || !(boxWidth > 0) || !(boxHeight > 0)) return null;
  return { width: boxWidth, height: boxHeight };
}

function lengthOf(value: string | null): number | null {
  if (value === null) return null;
  const match = /^([0-9]*\.?[0-9]+)/.exec(value.trim());
  if (match === null) return null;
  const parsed = Number(match[1]);
  return parsed > 0 ? parsed : null;
}

function measureTag(tag: PathTag): MeasuredPath | null {
  const name = elementName(tag.source);
  const attrs = tagAttrs(tag.source);
  if (name !== "path") return measurePrimitive(name, attrs);
  const data = readAttr(attrs, "d");
  if (data === null || data.trim() === "") return null;
  return measurePath(data);
}

function measurePrimitive(name: string, attrs: string): MeasuredPath | null {
  const numberAttr = (key: string): number | null => {
    const raw = readAttr(attrs, key);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  if (name === "circle") {
    const radius = numberAttr("r");
    if (radius === null || !(radius > 0)) return null;
    const cx = numberAttr("cx") ?? 0;
    const cy = numberAttr("cy") ?? 0;
    return bounds(cx - radius, cy - radius, cx + radius, cy + radius, Math.PI * radius * radius);
  }
  if (name === "ellipse") {
    const rx = numberAttr("rx");
    const ry = numberAttr("ry");
    if (rx === null || ry === null || !(rx > 0) || !(ry > 0)) return null;
    const cx = numberAttr("cx") ?? 0;
    const cy = numberAttr("cy") ?? 0;
    return bounds(cx - rx, cy - ry, cx + rx, cy + ry, Math.PI * rx * ry);
  }
  if (name === "rect") {
    const width = numberAttr("width");
    const height = numberAttr("height");
    if (width === null || height === null || !(width > 0) || !(height > 0)) return null;
    const x = numberAttr("x") ?? 0;
    const y = numberAttr("y") ?? 0;
    return bounds(x, y, x + width, y + height, width * height);
  }
  return null;
}

function bounds(minX: number, minY: number, maxX: number, maxY: number, area: number): MeasuredPath {
  return {
    anchors: 4,
    holes: 0,
    area,
    minX,
    minY,
    maxX,
    maxY,
    loops: 1,
    samples: [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY }
    ]
  };
}

function boxesOverlap(a: PlacedPath, b: PlacedPath): boolean {
  const width = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const height = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  if (width <= 0.5 || height <= 0.5) return false;
  const areaA = Math.max(0, a.maxX - a.minX) * Math.max(0, a.maxY - a.minY);
  const areaB = Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);
  const smaller = Math.min(areaA, areaB);
  return smaller > 0 && (width * height) / smaller > 0.15;
}

function readAttr(attrs: string, name: string): string | null {
  const pattern = new RegExp("\\b" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", "i");
  const match = pattern.exec(attrs);
  if (match === null) return null;
  return match[1] ?? match[2] ?? "";
}

function fillOf(attrs: string): string | null {
  const direct = readAttr(attrs, "fill");
  if (direct !== null) return direct;
  const style = readAttr(attrs, "style");
  if (style === null) return null;
  const match = /(?:^|;)\s*fill\s*:\s*([^;]+)/i.exec(style);
  const paint = match?.[1];
  return paint === undefined ? null : paint.trim();
}

function normalizeFill(fill: string | null): string | null {
  if (fill === null) return "#000000";
  const value = fill.trim().toLowerCase();
  if (value === "" || value === "none") return null;
  const short = /^#([0-9a-f]{3})$/.exec(value);
  if (short !== null) {
    const hex = short[1] ?? "";
    return "#" + hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  return value;
}

function measurePath(data: string): MeasuredPath {
  const commands = tokenize(data);
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let prevControl: Point | null = null;
  let anchors = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let open: Point[] = [];
  const subs: Subpath[] = [];

  function track(point: Point): void {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }

  function finish(): void {
    if (open.length === 0) return;
    subs.push({ points: open, area: signedArea(open) });
    open = [];
  }

  function addAnchor(x: number, y: number, curve: boolean): void {
    const closing = open.length > 0 && Math.hypot(x - sx, y - sy) < 0.05;
    if (!closing) anchors += 1;
    if (!curve && (!closing || open.length === 0)) {
      const point = { x, y };
      open.push(point);
      track(point);
    }
    cx = x;
    cy = y;
  }

  for (const command of commands) {
    const op = command.cmd.toLowerCase();
    const relative = command.cmd === op;
    const args = command.args;
    if (op !== "c" && op !== "s" && op !== "q" && op !== "t") prevControl = null;
    if (op === "m") {
      finish();
      const x = relative ? cx + (args[0] ?? 0) : (args[0] ?? 0);
      const y = relative ? cy + (args[1] ?? 0) : (args[1] ?? 0);
      sx = x;
      sy = y;
      addAnchor(x, y, false);
    } else if (op === "l") {
      addAnchor(relative ? cx + (args[0] ?? 0) : (args[0] ?? 0), relative ? cy + (args[1] ?? 0) : (args[1] ?? 0), false);
    } else if (op === "h") {
      addAnchor(relative ? cx + (args[0] ?? 0) : (args[0] ?? 0), cy, false);
    } else if (op === "v") {
      addAnchor(cx, relative ? cy + (args[0] ?? 0) : (args[0] ?? 0), false);
    } else if (op === "c" || op === "s" || op === "q" || op === "t") {
      const start = { x: cx, y: cy };
      const cubic = curveControls(op, relative, args, start, prevControl);
      for (const t of [0.25, 0.5, 0.75, 1]) {
        const point = bezier(start, cubic.p1, cubic.p2, cubic.p3, t);
        open.push(point);
        track(point);
      }
      prevControl = cubic.control;
      addAnchor(cubic.p3.x, cubic.p3.y, true);
    } else if (op === "a") {
      const end = arcEnd(relative, args, cx, cy);
      addAnchor(end.x, end.y, false);
    } else if (op === "z") {
      if (Math.hypot(cx - sx, cy - sy) >= 0.05) {
        const point = { x: sx, y: sy };
        open.push(point);
        track(point);
      }
      cx = sx;
      cy = sy;
      finish();
    }
  }
  finish();
  const area = subs.reduce((sum, sub) => sum + Math.abs(sub.area), 0);
  return {
    anchors,
    holes: countHoles(subs),
    area,
    minX,
    minY,
    maxX,
    maxY,
    loops: subs.length,
    samples: subs.flatMap((sub) => sub.points)
  };
}

function curveControls(op: string, relative: boolean, args: readonly number[], start: Point, prevControl: Point | null): { readonly p1: Point; readonly p2: Point; readonly p3: Point; readonly control: Point } {
  const abs = (index: number, axis: "x" | "y"): number => {
    const value = args[index] ?? 0;
    return relative ? start[axis] + value : value;
  };
  if (op === "c") {
    const p1 = { x: abs(0, "x"), y: abs(1, "y") };
    const p2 = { x: abs(2, "x"), y: abs(3, "y") };
    const p3 = { x: abs(4, "x"), y: abs(5, "y") };
    return { p1, p2, p3, control: p2 };
  }
  if (op === "s") {
    const p1 = reflect(prevControl, start);
    const p2 = { x: abs(0, "x"), y: abs(1, "y") };
    const p3 = { x: abs(2, "x"), y: abs(3, "y") };
    return { p1, p2, p3, control: p2 };
  }
  if (op === "q") {
    const control = { x: abs(0, "x"), y: abs(1, "y") };
    const p3 = { x: abs(2, "x"), y: abs(3, "y") };
    return { p1: control, p2: control, p3, control };
  }
  const control = reflect(prevControl, start);
  const p3 = { x: abs(0, "x"), y: abs(1, "y") };
  return { p1: control, p2: control, p3, control };
}

function reflect(control: Point | null, point: Point): Point {
  if (control === null) return point;
  return { x: point.x * 2 - control.x, y: point.y * 2 - control.y };
}

function arcEnd(relative: boolean, args: readonly number[], cx: number, cy: number): Point {
  const x = args[5] ?? 0;
  const y = args[6] ?? 0;
  return { x: relative ? cx + x : x, y: relative ? cy + y : y };
}

function bezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y
  };
}

function countHoles(subs: readonly Subpath[]): number {
  let outer: Subpath | null = null;
  for (const sub of subs) {
    if (outer === null || Math.abs(sub.area) > Math.abs(outer.area)) outer = sub;
  }
  if (outer === null || Math.abs(outer.area) < 0.5) return 0;
  const sign = Math.sign(outer.area);
  let holes = 0;
  for (const sub of subs) {
    if (sub === outer || Math.abs(sub.area) < 0.5 || Math.sign(sub.area) === sign) continue;
    const center = centroid(sub.points);
    if (pointInPoly(center, outer.points)) holes += 1;
  }
  return holes;
}

function signedArea(points: readonly Point[]): number {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (current === undefined || next === undefined) continue;
    sum += current.x * next.y - next.x * current.y;
  }
  return sum / 2;
}

function centroid(points: readonly Point[]): Point {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  const count = points.length || 1;
  return { x: x / count, y: y / count };
}

function pointInPoly(point: Point, poly: readonly Point[]): boolean {
  let inside = false;
  for (let index = 0, previous = poly.length - 1; index < poly.length; previous = index, index += 1) {
    const current = poly[index];
    const prior = poly[previous];
    if (current === undefined || prior === undefined) continue;
    const crosses = current.y > point.y !== prior.y > point.y;
    if (!crosses) continue;
    const x = ((prior.x - current.x) * (point.y - current.y)) / (prior.y - current.y) + current.x;
    if (point.x < x) inside = !inside;
  }
  return inside;
}

type Command = { readonly cmd: string; readonly args: readonly number[] };

function tokenize(data: string): Command[] {
  const commands: Command[] = [];
  let index = 0;
  let cmd = "";
  while (index < data.length) {
    index = skipSeparators(data, index);
    if (index >= data.length) break;
    const char = data[index] ?? "";
    if (/[A-Za-z]/.test(char)) {
      cmd = char;
      index += 1;
      if (cmd === "z" || cmd === "Z") {
        commands.push({ cmd, args: [] });
        continue;
      }
    }
    if (cmd === "") break;
    const count = ARG_COUNT[cmd.toLowerCase()] ?? 0;
    if (count === 0) break;
    const args: number[] = [];
    let cursor = index;
    for (let slot = 0; slot < count; slot += 1) {
      const number = readNumber(data, cursor);
      if (number === null) break;
      args.push(number.value);
      cursor = number.index;
    }
    if (args.length < count) break;
    commands.push({ cmd, args });
    if (cmd === "M") cmd = "L";
    else if (cmd === "m") cmd = "l";
    index = cursor;
  }
  return commands;
}

function skipSeparators(data: string, index: number): number {
  let cursor = index;
  while (cursor < data.length) {
    const char = data[cursor] ?? "";
    if (char !== "," && char !== " " && char !== "\n" && char !== "\t" && char !== "\r") break;
    cursor += 1;
  }
  return cursor;
}

function readNumber(data: string, index: number): { readonly value: number; readonly index: number } | null {
  let cursor = index;
  while (cursor < data.length) {
    const char = data[cursor] ?? "";
    if (char !== "," && char !== " " && char !== "\n" && char !== "\t" && char !== "\r") break;
    cursor += 1;
  }
  const match = /^[+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?/.exec(data.slice(cursor));
  if (match === null) return null;
  const raw = match[0] ?? "";
  return { value: Number(raw), index: cursor + raw.length };
}
