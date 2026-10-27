type Point = { readonly x: number; readonly y: number };
type Cubic = { readonly p0: Point; readonly p1: Point; readonly p2: Point; readonly p3: Point };
type PathMeasure = {
  readonly subpaths: readonly { readonly points: readonly Point[]; readonly closed: boolean; readonly area: number }[];
  readonly maxStraightLength: number;
};
type PathAttribute = { readonly value: string; readonly start: number; readonly end: number };
type ShapeMeasure = { readonly area: number; readonly path: PathMeasure | null };
type Model = { readonly cx: number; readonly cy: number; readonly radius: number; readonly exponent: number };
type Token = { readonly kind: "command"; readonly value: string } | { readonly kind: "number"; readonly value: number };

const SHAPE_TAG = /<path\b[^>]*\/>|<path\b[^>]*>[\s\S]*?<\/path>|<(?:circle|ellipse|rect)\b[^>]*\/>/gi;
const TOKEN = /[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g;

/**
 * Fits only the dominant outline in an icon trace. Apple documents the icon
 * mask as a rounded rectangle but does not publish its construction equation
 * (https://developer.apple.com/design/human-interface-guidelines/app-icons/);
 * this fit uses a Lamé superellipse, |x/r|^n + |y/r|^n = 1, with n near 5.
 */
export function fitAppIconSquircle(svg: string, options: { readonly protectFromGeometryFit?: boolean } = {}): string {
  const shapes: { readonly source: string; readonly index: number; readonly measure: ShapeMeasure }[] = [];
  for (const match of svg.matchAll(SHAPE_TAG)) {
    const source = match[0];
    const index = match.index;
    if (source === undefined || index === undefined) continue;
    const shape = measureShape(source);
    if (shape === null) return svg;
    shapes.push({ source, index, measure: shape });
  }
  if (shapes.length === 0) return svg;

  let largest = shapes[0];
  for (const shape of shapes.slice(1)) {
    if (largest !== undefined && shape.measure.area > largest.measure.area) largest = shape;
  }
  if (largest === undefined || !largest.source.toLowerCase().startsWith("<path")) return svg;
  const path = largest.measure.path;
  const subpath = path?.subpaths[0];
  if (path === null || path === undefined || path.subpaths.length !== 1 || subpath === undefined || !subpath.closed) return svg;
  const bounds = pointBounds(subpath.points);
  if (path.maxStraightLength > Math.min(bounds.width, bounds.height) * 0.12) return svg;
  const fitted = fitModel(subpath.points, subpath.area);
  if (fitted === null) return svg;

  const attribute = readAttribute(largest.source, "d");
  if (attribute === null) return svg;
  const data = squirclePath(fitted);
  let replacement = largest.source.slice(0, attribute.start) + data + largest.source.slice(attribute.end);
  if (options.protectFromGeometryFit === true) {
    const close = replacement.lastIndexOf(">");
    if (close < 0) return svg;
    replacement = replacement.slice(0, close) + ' data-vec-squircle-fit="true"' + replacement.slice(close);
  }
  const index = largest.index;
  return svg.slice(0, index) + replacement + svg.slice(index + largest.source.length);
}

function measureShape(source: string): ShapeMeasure | null {
  const name = /^<([a-z]+)/i.exec(source)?.[1]?.toLowerCase();
  if (name === "path") {
    const attribute = readAttribute(source, "d");
    if (attribute === null) return null;
    const path = parsePath(attribute.value);
    if (path === null) return null;
    return { area: path.subpaths.reduce((sum, part) => sum + Math.abs(part.area), 0), path };
  }
  if (name === "circle") {
    const radius = readNumber(source, "r");
    return radius === null || radius <= 0 ? null : { area: Math.PI * radius * radius, path: null };
  }
  if (name === "ellipse") {
    const rx = readNumber(source, "rx");
    const ry = readNumber(source, "ry");
    return rx === null || ry === null || rx <= 0 || ry <= 0 ? null : { area: Math.PI * rx * ry, path: null };
  }
  if (name === "rect") {
    const width = readNumber(source, "width");
    const height = readNumber(source, "height");
    if (width === null || height === null || width <= 0 || height <= 0) return null;
    const rx = Math.min(width / 2, readNumber(source, "rx") ?? 0);
    const ry = Math.min(height / 2, readNumber(source, "ry") ?? rx);
    return { area: width * height - (4 - Math.PI) * rx * ry, path: null };
  }
  return null;
}

function fitModel(points: readonly Point[], area: number): Model | null {
  if (points.length < 24) return null;
  const samples = evenlySample(points, 2048);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of samples) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const initialRadius = (width + height) / 4;
  if (initialRadius < 12 || width / height < 0.94 || width / height > 1.06) return null;
  const areaRatio = area / (width * height);
  if (areaRatio < 0.88 || areaRatio > 0.995) return null;

  let parameters = [(minX + maxX) / 2, (minY + maxY) / 2, initialRadius, 5];
  let steps = [initialRadius * 0.006, initialRadius * 0.006, initialRadius * 0.006, 0.15];
  for (let round = 0; round < 9; round += 1) {
    for (let dimension = 0; dimension < parameters.length; dimension += 1) {
      const current = parameters[dimension] ?? 0;
      const step = steps[dimension] ?? 0;
      const baseValue = current;
      let bestValue = current;
      let bestError = modelLoss(samples, parameters);
      for (let offset = -2; offset <= 2; offset += 1) {
        const value = baseValue + offset * step;
        if (dimension === 2 && value <= 0) continue;
        if (dimension === 3 && (value < 3.5 || value > 6.5)) continue;
        const candidate = parameters.slice();
        candidate[dimension] = value;
        const error = modelLoss(samples, candidate);
        if (error < bestError) {
          bestError = error;
          bestValue = value;
        }
      }
      parameters[dimension] = bestValue;
    }
    steps = steps.map((step) => step / 2);
  }

  const cx = parameters[0] ?? 0;
  const cy = parameters[1] ?? 0;
  const radius = parameters[2] ?? 0;
  const exponent = parameters[3] ?? 0;
  if (exponent < 4.1 || exponent > 6.1) return null;
  const errors = samples.map((point) => Math.abs(radialError(point, { cx, cy, radius, exponent })));
  const meanError = errors.reduce((sum, error) => sum + error, 0) / errors.length;
  const maxError = Math.max(...errors);
  if (meanError > Math.max(0.4, radius * 0.003) || maxError > Math.max(0.8, radius * 0.008)) return null;
  // Pixel-center contours below 80px carry a slight outward cell-boundary bias.
  return { cx, cy, radius: radius < 40 ? radius - 0.06 : radius, exponent };
}

function modelLoss(points: readonly Point[], parameters: readonly number[]): number {
  const model = {
    cx: parameters[0] ?? 0,
    cy: parameters[1] ?? 0,
    radius: parameters[2] ?? 1,
    exponent: parameters[3] ?? 5
  };
  let sum = 0;
  for (const point of points) {
    const error = radialError(point, model);
    sum += error * error;
  }
  const exponentPrior = (model.exponent - 5) ** 2 * model.radius ** 2 * 0.001;
  return sum / points.length + exponentPrior;
}

function radialError(point: Point, model: Model): number {
  const dx = point.x - model.cx;
  const dy = point.y - model.cy;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return -model.radius;
  const cosine = Math.abs(dx / distance);
  const sine = Math.abs(dy / distance);
  const support = (cosine ** model.exponent + sine ** model.exponent) ** (1 / model.exponent);
  return distance - model.radius / support;
}

function squirclePath(model: Model): string {
  const handle = optimizedHandles(model.exponent);
  const anchors = Array.from({ length: 8 }, (_, index) => squirclePoint(model, index * Math.PI / 4));
  const tangents = anchors.map((point) => tangentAt(point, model));
  const first = anchors[0] ?? { x: model.cx + model.radius, y: model.cy };
  let data = "M" + fmt(first.x) + "," + fmt(first.y);
  for (let index = 0; index < anchors.length; index += 1) {
    const nextIndex = (index + 1) % anchors.length;
    const from = anchors[index] ?? first;
    const to = anchors[nextIndex] ?? first;
    const fromTangent = tangents[index] ?? { x: 0, y: 1 };
    const toTangent = tangents[nextIndex] ?? fromTangent;
    const fromLength = (index % 2 === 0 ? handle.axis : handle.diagonal) * model.radius;
    const toLength = (nextIndex % 2 === 0 ? handle.axis : handle.diagonal) * model.radius;
    const control1 = { x: from.x + fromTangent.x * fromLength, y: from.y + fromTangent.y * fromLength };
    const control2 = { x: to.x - toTangent.x * toLength, y: to.y - toTangent.y * toLength };
    data += "C" + fmt(control1.x) + "," + fmt(control1.y)
      + " " + fmt(control2.x) + "," + fmt(control2.y)
      + " " + fmt(to.x) + "," + fmt(to.y);
  }
  return data + "Z";
}

function optimizedHandles(exponent: number): { readonly axis: number; readonly diagonal: number } {
  const model: Model = { cx: 0, cy: 0, radius: 1, exponent };
  const anchors = Array.from({ length: 8 }, (_, index) => squirclePoint(model, index * Math.PI / 4));
  const tangents = anchors.map((point) => tangentAt(point, model));
  let values = [0.48, 0.2];
  let steps = [0.08, 0.04];
  const loss = (axis: number, diagonal: number): number => {
    let sum = 0;
    let count = 0;
    for (let index = 0; index < anchors.length; index += 1) {
      const nextIndex = (index + 1) % anchors.length;
      const from = anchors[index] ?? { x: 1, y: 0 };
      const to = anchors[nextIndex] ?? from;
      const fromTangent = tangents[index] ?? { x: 0, y: 1 };
      const toTangent = tangents[nextIndex] ?? fromTangent;
      const fromLength = (index % 2 === 0 ? axis : diagonal);
      const toLength = (nextIndex % 2 === 0 ? axis : diagonal);
      const cubic: Cubic = {
        p0: from,
        p1: { x: from.x + fromTangent.x * fromLength, y: from.y + fromTangent.y * fromLength },
        p2: { x: to.x - toTangent.x * toLength, y: to.y - toTangent.y * toLength },
        p3: to
      };
      for (let sample = 1; sample < 32; sample += 1) {
        const error = radialError(bezier(cubic, sample / 32), model);
        sum += error * error;
        count += 1;
      }
    }
    return sum / count;
  };
  for (let round = 0; round < 8; round += 1) {
    for (let dimension = 0; dimension < values.length; dimension += 1) {
      const baseValue = values[dimension] ?? 0;
      let bestValue = values[dimension] ?? 0;
      let bestError = loss(values[0] ?? 0, values[1] ?? 0);
      for (let offset = -2; offset <= 2; offset += 1) {
        const candidateValue = baseValue + offset * (steps[dimension] ?? 0);
        if (candidateValue < 0.08 || candidateValue > 0.7) continue;
        const axis = dimension === 0 ? candidateValue : values[0] ?? 0;
        const diagonal = dimension === 1 ? candidateValue : values[1] ?? 0;
        const error = loss(axis, diagonal);
        if (error < bestError) {
          bestError = error;
          bestValue = candidateValue;
        }
      }
      values[dimension] = bestValue;
    }
    steps = steps.map((step) => step / 2);
  }
  return { axis: values[0] ?? 0.48, diagonal: values[1] ?? 0.2 };
}

function squirclePoint(model: Model, angle: number): Point {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const power = 2 / model.exponent;
  return {
    x: model.cx + model.radius * Math.sign(cosine) * Math.abs(cosine) ** power,
    y: model.cy + model.radius * Math.sign(sine) * Math.abs(sine) ** power
  };
}

function tangentAt(point: Point, model: Model): Point {
  const x = (point.x - model.cx) / model.radius;
  const y = (point.y - model.cy) / model.radius;
  const gx = Math.sign(x) * Math.abs(x) ** (model.exponent - 1);
  const gy = Math.sign(y) * Math.abs(y) ** (model.exponent - 1);
  const length = Math.hypot(gx, gy);
  if (length === 0) return { x: 0, y: 1 };
  return { x: -gy / length, y: gx / length };
}

function bezier(cubic: Cubic, t: number): Point {
  const u = 1 - t;
  return {
    x: u ** 3 * cubic.p0.x + 3 * u * u * t * cubic.p1.x + 3 * u * t * t * cubic.p2.x + t ** 3 * cubic.p3.x,
    y: u ** 3 * cubic.p0.y + 3 * u * u * t * cubic.p1.y + 3 * u * t * t * cubic.p2.y + t ** 3 * cubic.p3.y
  };
}

function parsePath(data: string): PathMeasure | null {
  const tokens: Token[] = [];
  for (const match of data.matchAll(TOKEN)) {
    const value = match[0];
    if (value === undefined) continue;
    if (/^[a-z]$/i.test(value)) tokens.push({ kind: "command", value });
    else {
      const number = Number(value);
      if (!Number.isFinite(number)) return null;
      tokens.push({ kind: "number", value: number });
    }
  }
  if (tokens.length === 0) return null;

  const counts: Readonly<Record<string, number>> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, z: 0 };
  const subpaths: { points: Point[]; closed: boolean; area: number }[] = [];
  let current: Point = { x: 0, y: 0 };
  let start: Point = current;
  let control: Point | null = null;
  let quadratic: Point | null = null;
  let currentPath: { points: Point[]; area: number } | null = null;
  let currentPathClosed = false;
  let command = "";
  let index = 0;
  let maxStraightLength = 0;

  const finish = (): void => {
    if (currentPath === null) return;
    currentPath.area = signedArea(currentPath.points);
    subpaths.push({ ...currentPath, closed: currentPathClosed });
    currentPath = null;
  };
  const begin = (point: Point): void => {
    finish();
    current = point;
    start = point;
    currentPath = { points: [point], area: 0 };
    currentPathClosed = false;
  };
  const appendLine = (point: Point): void => {
    if (currentPath === null) return;
    const length = distance(current, point);
    maxStraightLength = Math.max(maxStraightLength, length);
    if (length > 1e-8) currentPath.points.push(point);
    current = point;
  };
  const appendCubic = (p1: Point, p2: Point, p3: Point): void => {
    if (currentPath === null) return;
    const cubic = { p0: current, p1, p2, p3 };
    for (let step = 1; step <= 16; step += 1) currentPath.points.push(bezier(cubic, step / 16));
    current = p3;
  };
  const number = (): number | null => {
    const token = tokens[index];
    if (token?.kind !== "number") return null;
    index += 1;
    return token.value;
  };
  const pointArgs = (relative: boolean): Point | null => {
    const x = number();
    const y = number();
    if (x === null || y === null) return null;
    return relative ? { x: current.x + x, y: current.y + y } : { x, y };
  };

  while (index < tokens.length) {
    const token = tokens[index];
    if (token?.kind === "command") {
      command = token.value;
      index += 1;
      const op = command.toLowerCase();
      if (op === "z") {
        if (currentPath === null) return null;
        appendLine(start);
        currentPathClosed = true;
        current = start;
        control = null;
        quadratic = null;
        finish();
        command = "";
      } else if (!(op in counts)) return null;
      continue;
    }
    if (command === "") return null;
    const op = command.toLowerCase();
    const relative = command === op;
    const count = counts[op];
    if (count === undefined || count === 0) return null;
    const args: number[] = [];
    for (let argIndex = 0; argIndex < count; argIndex += 1) {
      const value = number();
      if (value === null) return null;
      args.push(value);
    }

    if (op === "m") {
      const point = relative ? { x: current.x + (args[0] ?? 0), y: current.y + (args[1] ?? 0) } : { x: args[0] ?? 0, y: args[1] ?? 0 };
      begin(point);
      command = relative ? "l" : "L";
    } else if (op === "l") {
      const point = relative ? { x: current.x + (args[0] ?? 0), y: current.y + (args[1] ?? 0) } : { x: args[0] ?? 0, y: args[1] ?? 0 };
      appendLine(point);
      control = null;
      quadratic = null;
    } else if (op === "h") {
      appendLine({ x: relative ? current.x + (args[0] ?? 0) : (args[0] ?? 0), y: current.y });
      control = null;
      quadratic = null;
    } else if (op === "v") {
      appendLine({ x: current.x, y: relative ? current.y + (args[0] ?? 0) : (args[0] ?? 0) });
      control = null;
      quadratic = null;
    } else if (op === "c") {
      const offset = (x: number, y: number): Point => relative ? { x: current.x + x, y: current.y + y } : { x, y };
      const p1 = offset(args[0] ?? 0, args[1] ?? 0);
      const p2 = offset(args[2] ?? 0, args[3] ?? 0);
      const p3 = offset(args[4] ?? 0, args[5] ?? 0);
      appendCubic(p1, p2, p3);
      control = p2;
      quadratic = null;
    } else if (op === "s") {
      const p1 = control === null ? current : { x: 2 * current.x - control.x, y: 2 * current.y - control.y };
      const offset = (x: number, y: number): Point => relative ? { x: current.x + x, y: current.y + y } : { x, y };
      const p2 = offset(args[0] ?? 0, args[1] ?? 0);
      const p3 = offset(args[2] ?? 0, args[3] ?? 0);
      appendCubic(p1, p2, p3);
      control = p2;
      quadratic = null;
    } else if (op === "q" || op === "t") {
      const p1: Point | null = op === "t" ? (quadratic === null ? current : { x: 2 * current.x - quadratic.x, y: 2 * current.y - quadratic.y }) : pointArgs(relative);
      const p2: Point | null = pointArgs(relative);
      if (p1 === null || p2 === null) return null;
      const c1 = { x: current.x + (2 / 3) * (p1.x - current.x), y: current.y + (2 / 3) * (p1.y - current.y) };
      const c2 = { x: p2.x + (2 / 3) * (p1.x - p2.x), y: p2.y + (2 / 3) * (p1.y - p2.y) };
      appendCubic(c1, c2, p2);
      control = null;
      quadratic = p1;
    }
    if (op !== "c" && op !== "s") control = null;
    if (op !== "q" && op !== "t") quadratic = null;
  }
  finish();
  return subpaths.length === 0 ? null : { subpaths, maxStraightLength };
}

function readAttribute(tag: string, name: string): PathAttribute | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp("\\b" + escaped + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1", "i").exec(tag);
  if (match === null || match[1] === undefined || match[2] === undefined || match.index === undefined) return null;
  const quoteStart = match.index + match[0].indexOf(match[1]);
  return { value: match[2], start: quoteStart + 1, end: quoteStart + 1 + match[2].length };
}

function readNumber(tag: string, name: string): number | null {
  const attribute = readAttribute(tag, name);
  if (attribute === null) return null;
  const value = Number(attribute.value);
  return Number.isFinite(value) ? value : null;
}

function evenlySample(points: readonly Point[], max: number): Point[] {
  if (points.length <= max) return [...points];
  const sampled: Point[] = [];
  for (let index = 0; index < max; index += 1) sampled.push(points[Math.floor(index * points.length / max)] ?? points[0] ?? { x: 0, y: 0 });
  return sampled;
}

function signedArea(points: readonly Point[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (current !== undefined && next !== undefined) area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function pointBounds(points: readonly Point[]): { readonly width: number; readonly height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { width: maxX - minX, height: maxY - minY };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function fmt(value: number): string {
  return String(Math.round(value * 1000000) / 1000000);
}
