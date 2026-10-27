type Point = { readonly x: number; readonly y: number };
type Cubic = { readonly p0: Point; readonly p1: Point; readonly p2: Point; readonly p3: Point };
type Segment = { readonly kind: "cubic"; readonly curve: Cubic } | { readonly kind: "line"; readonly from: Point; readonly to: Point };

export type SquircleMeasure = {
  readonly area: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly loops: number;
  readonly samples: readonly Point[];
};

const RADIUS_RATIO = 0.2237;
const A = 1.52866498;
const P = 0.89648972;
const M = 0.29214939;

/** Return the 12-anchor G2 template only when it fits better than a circular round rectangle. */
export function fitSquircle(measured: SquircleMeasure, roundRectRadius: number | null): string | null {
  const width = measured.maxX - measured.minX;
  const height = measured.maxY - measured.minY;
  const side = (width + height) / 2;
  if (measured.loops !== 1 || measured.samples.length < 24 || side < 20) return null;
  if (Math.abs(width - height) / side > 0.018) return null;

  const cx = (measured.minX + measured.maxX) / 2;
  const cy = (measured.minY + measured.maxY) / 2;
  const model = template({ cx, cy, side });
  const observed = resampleClosed(measured.samples, 512);
  if (observed.length < 32) return null;
  const templateFit = boundaryDistance(observed, model.samples);
  const templateArea = polygonArea(model.samples);
  const areaError = Math.abs(measured.area - templateArea) / templateArea;
  if (areaError > 0.025) return null;

  const meanLimit = Math.max(0.22, side * 0.0012);
  const maxLimit = Math.max(0.7, side * 0.0032);
  if (templateFit.mean > meanLimit || templateFit.max > maxLimit) return null;

  if (roundRectRadius !== null) {
    const roundRect = circularRoundRect({ cx, cy, side, radius: roundRectRadius });
    const roundFit = boundaryDistance(observed, roundRect);
    const advantage = Math.max(0.012, side * 0.00008);
    if (templateFit.mean + advantage >= roundFit.mean) return null;
  }

  return model.path;
}

function template(frame: { readonly cx: number; readonly cy: number; readonly side: number }): { readonly path: string; readonly samples: readonly Point[] } {
  const left = frame.cx - frame.side / 2;
  const top = frame.cy - frame.side / 2;
  const right = left + frame.side;
  const bottom = top + frame.side;
  const radius = frame.side * RADIUS_RATIO;
  const a = A * radius;
  const p = P * radius;
  const m = M * radius;
  const point = (x: number, y: number): Point => ({ x, y });
  const cubic = (p0: Point, p1: Point, p2: Point, p3: Point): Segment => ({ kind: "cubic", curve: { p0, p1, p2, p3 } });
  const line = (from: Point, to: Point): Segment => ({ kind: "line", from, to });
  const start = point(left + a, top);
  const segments: Segment[] = [
    cubic(start, point(left + p, top), point(left + 2 * m, top), point(left + m, top + m)),
    cubic(point(left + m, top + m), point(left, top + 2 * m), point(left, top + p), point(left, top + a)),
    line(point(left, top + a), point(left, bottom - a)),
    cubic(point(left, bottom - a), point(left, bottom - p), point(left, bottom - 2 * m), point(left + m, bottom - m)),
    cubic(point(left + m, bottom - m), point(left + 2 * m, bottom), point(left + p, bottom), point(left + a, bottom)),
    line(point(left + a, bottom), point(right - a, bottom)),
    cubic(point(right - a, bottom), point(right - p, bottom), point(right - 2 * m, bottom), point(right - m, bottom - m)),
    cubic(point(right - m, bottom - m), point(right, bottom - 2 * m), point(right, bottom - p), point(right, bottom - a)),
    line(point(right, bottom - a), point(right, top + a)),
    cubic(point(right, top + a), point(right, top + p), point(right, top + 2 * m), point(right - m, top + m)),
    cubic(point(right - m, top + m), point(right - 2 * m, top), point(right - p, top), point(right - a, top)),
    line(point(right - a, top), start)
  ];
  const path = "M" + fmt(start.x) + "," + fmt(start.y) + segments.map((segment) => {
    if (segment.kind === "line") return "L" + fmt(segment.to.x) + "," + fmt(segment.to.y);
    const curve = segment.curve;
    return "C" + fmt(curve.p1.x) + "," + fmt(curve.p1.y)
      + " " + fmt(curve.p2.x) + "," + fmt(curve.p2.y)
      + " " + fmt(curve.p3.x) + "," + fmt(curve.p3.y);
  }).join("") + "Z";
  return { path, samples: flatten(segments, 64) };
}

function circularRoundRect(frame: { readonly cx: number; readonly cy: number; readonly side: number; readonly radius: number }): readonly Point[] {
  const left = frame.cx - frame.side / 2;
  const top = frame.cy - frame.side / 2;
  const right = left + frame.side;
  const bottom = top + frame.side;
  const radius = Math.min(frame.side / 2, frame.radius);
  const centers = [
    { x: right - radius, y: top + radius, start: -Math.PI / 2 },
    { x: right - radius, y: bottom - radius, start: 0 },
    { x: left + radius, y: bottom - radius, start: Math.PI / 2 },
    { x: left + radius, y: top + radius, start: Math.PI }
  ];
  const samples: Point[] = [];
  const appendLine = (from: Point, to: Point): void => {
    for (let index = 0; index < 32; index += 1) {
      const t = index / 32;
      samples.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
    }
  };
  const appendArc = (center: Point, start: number): void => {
    for (let index = 0; index < 64; index += 1) {
      const angle = start + index / 64 * Math.PI / 2;
      samples.push({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
    }
  };
  const first = { x: left + radius, y: top };
  appendLine(first, { x: right - radius, y: top });
  appendArc(centers[0] ?? { x: right - radius, y: top + radius }, -Math.PI / 2);
  appendLine({ x: right, y: top + radius }, { x: right, y: bottom - radius });
  appendArc(centers[1] ?? { x: right - radius, y: bottom - radius }, 0);
  appendLine({ x: right - radius, y: bottom }, { x: left + radius, y: bottom });
  appendArc(centers[2] ?? { x: left + radius, y: bottom - radius }, Math.PI / 2);
  appendLine({ x: left, y: bottom - radius }, { x: left, y: top + radius });
  appendArc(centers[3] ?? { x: left + radius, y: top + radius }, Math.PI);
  return samples;
}

function flatten(segments: readonly Segment[], steps: number): Point[] {
  const points: Point[] = [];
  for (const segment of segments) {
    const from = segment.kind === "line" ? segment.from : segment.curve.p0;
    for (let index = 0; index < steps; index += 1) {
      const t = index / steps;
      points.push(segment.kind === "line" ? lerp(from, segment.to, t) : bezier(segment.curve, t));
    }
  }
  return points;
}

function resampleClosed(points: readonly Point[], count: number): Point[] {
  if (points.length < 2) return [];
  const lengths: number[] = [];
  let perimeter = 0;
  for (let index = 0; index < points.length; index += 1) {
    const from = points[index];
    const to = points[(index + 1) % points.length];
    if (from === undefined || to === undefined) return [];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    lengths.push(length);
    perimeter += length;
  }
  if (!(perimeter > 0)) return [];
  const output: Point[] = [];
  let segment = 0;
  let segmentStart = 0;
  for (let index = 0; index < count; index += 1) {
    const target = perimeter * index / count;
    while (segment < lengths.length - 1 && segmentStart + (lengths[segment] ?? 0) < target) {
      segmentStart += lengths[segment] ?? 0;
      segment += 1;
    }
    const from = points[segment];
    const to = points[(segment + 1) % points.length];
    const length = lengths[segment] ?? 0;
    if (from === undefined || to === undefined || length === 0) return [];
    output.push(lerp(from, to, (target - segmentStart) / length));
  }
  return output;
}

function boundaryDistance(left: readonly Point[], right: readonly Point[]): { readonly mean: number; readonly max: number } {
  const directed = (source: readonly Point[], target: readonly Point[]): { readonly mean: number; readonly max: number } => {
    let sum = 0;
    let max = 0;
    for (const point of source) {
      let best = Infinity;
      for (let index = 0; index < target.length; index += 1) {
        const start = target[index];
        const end = target[(index + 1) % target.length];
        if (start === undefined || end === undefined) continue;
        best = Math.min(best, distanceToSegment(point, start, end));
      }
      sum += best;
      max = Math.max(max, best);
    }
    return { mean: sum / source.length, max };
  };
  const first = directed(left, right);
  const second = directed(right, left);
  return { mean: (first.mean + second.mean) / 2, max: Math.max(first.max, second.max) };
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const projection = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + projection * dx), point.y - (start.y + projection * dy));
}

function polygonArea(points: readonly Point[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (current === undefined || next === undefined) continue;
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area) / 2;
}

function lerp(from: Point, to: Point, t: number): Point {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

function bezier(curve: Cubic, t: number): Point {
  const u = 1 - t;
  return {
    x: u ** 3 * curve.p0.x + 3 * u * u * t * curve.p1.x + 3 * u * t * t * curve.p2.x + t ** 3 * curve.p3.x,
    y: u ** 3 * curve.p0.y + 3 * u * u * t * curve.p1.y + 3 * u * t * t * curve.p2.y + t ** 3 * curve.p3.y
  };
}

function fmt(value: number): string {
  return String(Math.round(value * 10000) / 10000);
}
