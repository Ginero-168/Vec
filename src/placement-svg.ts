const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const MAX_PLACEMENT_NUMBER = 1_000_000_000_000;
const PATH_COMMANDS = "MmLlHhVvCcSsQqTtAaZz";
const CURVE_KAPPA = 0.5522847498307936;

export type SvgValidation =
  | { readonly kind: "valid" }
  | { readonly kind: "invalid"; readonly reason: "empty" | "bom" | "encoding" | "malformed-xml" | "wrong-root" | "missing-namespace" | "invalid-dimensions" | "non-finite" | "unsafe-content" | "path-commands" | "stale-content" };

type SvgTag =
  | { readonly kind: "open"; readonly name: string; readonly attributes: ReadonlyMap<string, string>; readonly selfClosing: boolean }
  | { readonly kind: "close"; readonly name: string };

type SvgElement = { readonly name: string; readonly attributes: ReadonlyMap<string, string> };

type SimpleSvg = {
  readonly rootAttributes: ReadonlyMap<string, string>;
  readonly children: readonly SvgElement[];
};

type NumberToken = { readonly kind: "number"; readonly value: number };
type CommandToken = { readonly kind: "command"; readonly value: string };
type PathToken = NumberToken | CommandToken;

type Point = { readonly x: number; readonly y: number };
type Cubic = { readonly control1: Point; readonly control2: Point; readonly end: Point };

function validEntities(value: string): boolean {
  const entityPattern = /&(#(?:x[\da-f]+|\d+)|amp|lt|gt|quot|apos);/gi;
  let remainder = value;
  let match = entityPattern.exec(value);
  while (match !== null) {
    const entity = match[1] ?? "";
    if (entity.startsWith("#")) {
      const isHex = entity[1]?.toLowerCase() === "x";
      const digits = entity.slice(isHex ? 2 : 1);
      const point = Number.parseInt(digits, isHex ? 16 : 10);
      const validPoint = point === 9 || point === 10 || point === 13 || (point >= 32 && point <= 0xd7ff) || (point >= 0xe000 && point <= 0xfffd) || (point >= 0x10000 && point <= 0x10ffff);
      if (!Number.isFinite(point) || !validPoint) return false;
    }
    remainder = remainder.replace(match[0], "");
    match = entityPattern.exec(value);
  }
  return !remainder.includes("&");
}

function parseAttributes(source: string): ReadonlyMap<string, string> | null {
  const attributes = new Map<string, string>();
  let cursor = 0;
  while (cursor < source.length) {
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (cursor >= source.length) break;
    const nameMatch = /^[A-Za-z_][A-Za-z0-9_.:-]*/.exec(source.slice(cursor));
    if (nameMatch === null) return null;
    const name = nameMatch[0];
    if (attributes.has(name)) return null;
    cursor += name.length;
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (source[cursor] !== "=") return null;
    cursor += 1;
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    const quote = source[cursor];
    if (quote !== "\"" && quote !== "'") return null;
    cursor += 1;
    const end = source.indexOf(quote, cursor);
    if (end < 0) return null;
    const value = source.slice(cursor, end);
    if (value.includes("<") || !validEntities(value)) return null;
    attributes.set(name, value);
    cursor = end + 1;
  }
  return attributes;
}

function parseTag(source: string, start: number): { readonly tag: SvgTag; readonly end: number } | null {
  let end = start + 1;
  let quote: string | null = null;
  while (end < source.length) {
    const character = source[end];
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === ">") {
      break;
    }
    end += 1;
  }
  if (end >= source.length || quote !== null) return null;
  let body = source.slice(start + 1, end).trim();
  if (body.startsWith("/")) {
    const name = body.slice(1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)) return null;
    return { tag: { kind: "close", name }, end: end + 1 };
  }
  const nameMatch = /^[A-Za-z_][A-Za-z0-9_.:-]*/.exec(body);
  if (nameMatch === null) return null;
  const name = nameMatch[0];
  body = body.slice(name.length);
  const trimmed = body.trimEnd();
  const selfClosing = trimmed.endsWith("/");
  if (selfClosing) body = trimmed.slice(0, -1);
  const attributes = parseAttributes(body);
  if (attributes === null) return null;
  return { tag: { kind: "open", name, attributes, selfClosing }, end: end + 1 };
}

function skipWhitespaceAndComments(source: string, start: number): number | null {
  let cursor = start;
  while (cursor < source.length) {
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (!source.startsWith("<!--", cursor)) return cursor;
    const end = source.indexOf("-->", cursor + 4);
    if (end < 0 || source.slice(cursor + 4, end).includes("--")) return null;
    cursor = end + 3;
  }
  return cursor;
}

function parseSimpleSvg(source: string, allowUntransformedGroups = true): SimpleSvg | null {
  let cursor = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  cursor = skipWhitespaceAndComments(source, cursor) ?? -1;
  if (cursor < 0) return null;
  if (source.startsWith("<?xml", cursor)) {
    const declarationEnd = source.indexOf("?>", cursor + 5);
    if (declarationEnd < 0) return null;
    const declaration = source.slice(cursor, declarationEnd + 2);
    const encoding = /\bencoding\s*=\s*(['"])(.*?)\1/i.exec(declaration)?.[2];
    if (encoding !== undefined && encoding.toLowerCase() !== "utf-8") return null;
    cursor = skipWhitespaceAndComments(source, declarationEnd + 2) ?? -1;
    if (cursor < 0) return null;
  }
  if (source[cursor] !== "<") return null;
  const root = parseTag(source, cursor);
  if (root === null || root.tag.kind !== "open" || root.tag.name !== "svg" || root.tag.selfClosing) return null;
  const children: SvgElement[] = [];
  const groups: string[] = [];
  cursor = root.end;
  while (cursor < source.length) {
    cursor = skipWhitespaceAndComments(source, cursor) ?? -1;
    if (cursor < 0 || cursor >= source.length) return null;
    if (source[cursor] !== "<") return null;
    const parsed = parseTag(source, cursor);
    if (parsed === null) return null;
    if (parsed.tag.kind === "close") {
      if (parsed.tag.name === "g") {
        if (groups.length === 0) return null;
        groups.pop();
        cursor = parsed.end;
        continue;
      }
      if (parsed.tag.name !== "svg") return null;
      if (groups.length !== 0) return null;
      cursor = parsed.end;
      cursor = skipWhitespaceAndComments(source, cursor) ?? -1;
      if (cursor !== source.length) return null;
      return { rootAttributes: root.tag.attributes, children };
    }
    if (parsed.tag.name === "g") {
      if (!allowUntransformedGroups) return null;
      if (!hasOnlyAttributes(parsed.tag.attributes, ["id"])) return null;
      if (!parsed.tag.selfClosing) groups.push("g");
      cursor = parsed.end;
      continue;
    }
    if (!parsed.tag.selfClosing && parsed.tag.name !== "path") return null;
    if (parsed.tag.name !== "path" && parsed.tag.name !== "rect" && parsed.tag.name !== "circle" && parsed.tag.name !== "ellipse") return null;
    cursor = parsed.end;
    if (!parsed.tag.selfClosing) {
      cursor = skipWhitespaceAndComments(source, cursor) ?? -1;
      if (cursor < 0 || source[cursor] !== "<") return null;
      const closing = parseTag(source, cursor);
      if (closing === null || closing.tag.kind !== "close" || closing.tag.name !== "path") return null;
      cursor = closing.end;
    }
    children.push({ name: parsed.tag.name, attributes: parsed.tag.attributes });
  }
  return null;
}

function finiteNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const trimmed = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) && Math.abs(number) <= MAX_PLACEMENT_NUMBER ? number : null;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_PLACEMENT_NUMBER) throw new Error("SVG contains an out-of-range number");
  const rounded = Math.round(value * 1000) / 1000;
  if (Object.is(rounded, -0) || rounded === 0) return "0";
  return rounded.toFixed(3).replace(/\.?0+$/, "");
}

function pathTokens(source: string): readonly PathToken[] | null {
  const tokens: PathToken[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    if (/[\s,]/.test(source[cursor] ?? "")) {
      cursor += 1;
      continue;
    }
    const character = source[cursor] ?? "";
    if (PATH_COMMANDS.includes(character)) {
      tokens.push({ kind: "command", value: character });
      cursor += 1;
      continue;
    }
    const numberMatch = /^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?/.exec(source.slice(cursor));
    if (numberMatch === null) return null;
    const value = Number(numberMatch[0]);
    if (!Number.isFinite(value) || Math.abs(value) > MAX_PLACEMENT_NUMBER) return null;
    tokens.push({ kind: "number", value });
    cursor += numberMatch[0].length;
  }
  return tokens;
}

function point(x: number, y: number): Point {
  return { x, y };
}

function reflected(control: Point, around: Point): Point {
  return point(2 * around.x - control.x, 2 * around.y - control.y);
}

function appendCubic(parts: string[], curve: Cubic): void {
  parts.push("C" + formatNumber(curve.control1.x) + " " + formatNumber(curve.control1.y) + " " + formatNumber(curve.control2.x) + " " + formatNumber(curve.control2.y) + " " + formatNumber(curve.end.x) + " " + formatNumber(curve.end.y));
}

function vectorAngle(ux: number, uy: number, vx: number, vy: number): number {
  const dot = ux * vx + uy * vy;
  const length = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
  const angle = Math.acos(Math.max(-1, Math.min(1, dot / length)));
  return ux * vy - uy * vx < 0 ? -angle : angle;
}

function arcToCubics(start: Point, rxValue: number, ryValue: number, rotationDegrees: number, largeArc: number, sweep: number, end: Point): readonly Cubic[] | null {
  let rx = Math.abs(rxValue);
  let ry = Math.abs(ryValue);
  if ((largeArc !== 0 && largeArc !== 1) || (sweep !== 0 && sweep !== 1)) return null;
  if (start.x === end.x && start.y === end.y) return [];
  if (rx === 0 || ry === 0) return [{ control1: end, control2: end, end }];
  const phi = (rotationDegrees % 360) * Math.PI / 180;
  const cosine = Math.cos(phi);
  const sine = Math.sin(phi);
  const halfX = (start.x - end.x) / 2;
  const halfY = (start.y - end.y) / 2;
  const xPrime = cosine * halfX + sine * halfY;
  const yPrime = -sine * halfX + cosine * halfY;
  const lambda = (xPrime * xPrime) / (rx * rx) + (yPrime * yPrime) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const x2 = xPrime * xPrime;
  const y2 = yPrime * yPrime;
  const denominator = rx2 * y2 + ry2 * x2;
  const numerator = Math.max(0, rx2 * ry2 - rx2 * y2 - ry2 * x2);
  const sign = largeArc === sweep ? -1 : 1;
  const coefficient = denominator === 0 ? 0 : sign * Math.sqrt(numerator / denominator);
  const centerPrimeX = coefficient * rx * yPrime / ry;
  const centerPrimeY = coefficient * -ry * xPrime / rx;
  const centerX = cosine * centerPrimeX - sine * centerPrimeY + (start.x + end.x) / 2;
  const centerY = sine * centerPrimeX + cosine * centerPrimeY + (start.y + end.y) / 2;
  const ux = (xPrime - centerPrimeX) / rx;
  const uy = (yPrime - centerPrimeY) / ry;
  const vx = (-xPrime - centerPrimeX) / rx;
  const vy = (-yPrime - centerPrimeY) / ry;
  const theta = vectorAngle(1, 0, ux, uy);
  let delta = vectorAngle(ux, uy, vx, vy);
  if (sweep === 0 && delta > 0) delta -= 2 * Math.PI;
  if (sweep === 1 && delta < 0) delta += 2 * Math.PI;
  const count = Math.ceil(Math.abs(delta) / (Math.PI / 2));
  const transform = (x: number, y: number): Point => point(centerX + cosine * x - sine * y, centerY + sine * x + cosine * y);
  const derivative = (angle: number): Point => point(-rx * Math.sin(angle), ry * Math.cos(angle));
  const curves: Cubic[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle1 = theta + delta * index / count;
    const angle2 = theta + delta * (index + 1) / count;
    const step = angle2 - angle1;
    const factor = 4 / 3 * Math.tan(step / 4);
    const p1 = transform(rx * Math.cos(angle1), ry * Math.sin(angle1));
    const p2 = transform(rx * Math.cos(angle2), ry * Math.sin(angle2));
    const d1 = derivative(angle1);
    const d2 = derivative(angle2);
    curves.push({
      control1: transform(rx * Math.cos(angle1) + factor * d1.x, ry * Math.sin(angle1) + factor * d1.y),
      control2: transform(rx * Math.cos(angle2) - factor * d2.x, ry * Math.sin(angle2) - factor * d2.y),
      end: p2
    });
  }
  if (curves.length > 0) {
    const last = curves[curves.length - 1];
    if (last !== undefined) curves[curves.length - 1] = { control1: last.control1, control2: last.control2, end };
  }
  return curves;
}

function normalizePathData(source: string): string | null {
  const tokens = pathTokens(source);
  if (tokens === null || tokens.length === 0) return null;
  const parts: string[] = [];
  let cursor = 0;
  let activeCommand: string | null = null;
  let current = point(0, 0);
  let subpathStart = point(0, 0);
  let previousCommand = "";
  let previousCubicControl = current;
  let previousQuadraticControl = current;
  let hasMove = false;

  while (cursor < tokens.length) {
    const token = tokens[cursor];
    if (token?.kind === "command") {
      activeCommand = token.value;
      cursor += 1;
      if (activeCommand.toUpperCase() === "Z") {
        if (!hasMove) return null;
        parts.push("Z");
        current = subpathStart;
        previousCommand = "Z";
        activeCommand = null;
      }
      continue;
    }
    if (activeCommand === null) return null;
    const inputCommand = activeCommand;
    const command = inputCommand.toUpperCase();
    const relative = inputCommand !== command;
    const count = command === "H" || command === "V" ? 1 : command === "M" || command === "L" || command === "T" ? 2 : command === "S" || command === "Q" ? 4 : command === "C" ? 6 : command === "A" ? 7 : 0;
    if (count === 0 || cursor + count > tokens.length) return null;
    const values: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const value = tokens[cursor + index];
      if (value?.kind !== "number") return null;
      values.push(value.value);
    }
    cursor += count;
    const x = (value: number): number => relative ? current.x + value : value;
    const y = (value: number): number => relative ? current.y + value : value;

    if (command === "M") {
      current = point(x(values[0] ?? 0), y(values[1] ?? 0));
      subpathStart = current;
      parts.push("M" + formatNumber(current.x) + " " + formatNumber(current.y));
      hasMove = true;
      activeCommand = relative ? "l" : "L";
      previousCommand = "M";
      previousCubicControl = current;
      previousQuadraticControl = current;
      continue;
    }
    if (!hasMove) return null;
    if (command === "L" || command === "H" || command === "V") {
      const end = command === "H" ? point(x(values[0] ?? 0), current.y) : command === "V" ? point(current.x, y(values[0] ?? 0)) : point(x(values[0] ?? 0), y(values[1] ?? 0));
      parts.push("L" + formatNumber(end.x) + " " + formatNumber(end.y));
      current = end;
      previousCommand = command;
      previousCubicControl = current;
      previousQuadraticControl = current;
      continue;
    }
    if (command === "C") {
      const control1 = point(x(values[0] ?? 0), y(values[1] ?? 0));
      const control2 = point(x(values[2] ?? 0), y(values[3] ?? 0));
      const end = point(x(values[4] ?? 0), y(values[5] ?? 0));
      appendCubic(parts, { control1, control2, end });
      current = end;
      previousCubicControl = control2;
      previousQuadraticControl = current;
      previousCommand = "C";
      continue;
    }
    if (command === "S") {
      const control1 = previousCommand === "C" || previousCommand === "S" ? reflected(previousCubicControl, current) : current;
      const control2 = point(x(values[0] ?? 0), y(values[1] ?? 0));
      const end = point(x(values[2] ?? 0), y(values[3] ?? 0));
      appendCubic(parts, { control1, control2, end });
      current = end;
      previousCubicControl = control2;
      previousQuadraticControl = current;
      previousCommand = "S";
      continue;
    }
    if (command === "Q" || command === "T") {
      const control = command === "Q"
        ? point(x(values[0] ?? 0), y(values[1] ?? 0))
        : previousCommand === "Q" || previousCommand === "T" ? reflected(previousQuadraticControl, current) : current;
      const end = command === "Q" ? point(x(values[2] ?? 0), y(values[3] ?? 0)) : point(x(values[0] ?? 0), y(values[1] ?? 0));
      appendCubic(parts, {
        control1: point(current.x + (control.x - current.x) * 2 / 3, current.y + (control.y - current.y) * 2 / 3),
        control2: point(end.x + (control.x - end.x) * 2 / 3, end.y + (control.y - end.y) * 2 / 3),
        end
      });
      current = end;
      previousQuadraticControl = control;
      previousCubicControl = current;
      previousCommand = command;
      continue;
    }
    if (command === "A") {
      const end = point(x(values[5] ?? 0), y(values[6] ?? 0));
      const curves = arcToCubics(current, values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0, values[4] ?? 0, end);
      if (curves === null) return null;
      if (curves.length === 0) {
        current = end;
      } else if (values[0] === 0 || values[1] === 0) {
        parts.push("L" + formatNumber(end.x) + " " + formatNumber(end.y));
        current = end;
      } else {
        for (const curve of curves) appendCubic(parts, curve);
        current = end;
      }
      previousCubicControl = current;
      previousQuadraticControl = current;
      previousCommand = "A";
      continue;
    }
    return null;
  }
  return parts.length === 0 ? null : parts.join(" ");
}

function numberAttribute(attributes: ReadonlyMap<string, string>, name: string, fallback?: number): number {
  const raw = attributes.get(name);
  if (raw === undefined && fallback !== undefined) return fallback;
  const value = finiteNumber(raw);
  if (value === null) throw new Error("SVG contains an invalid " + name + " value");
  return value;
}

function rectPath(attributes: ReadonlyMap<string, string>): string {
  const x = numberAttribute(attributes, "x", 0);
  const y = numberAttribute(attributes, "y", 0);
  const width = numberAttribute(attributes, "width");
  const height = numberAttribute(attributes, "height");
  if (width <= 0 || height <= 0) throw new Error("SVG rectangle must have positive dimensions");
  const radiusX = Math.max(0, Math.min(numberAttribute(attributes, "rx", numberAttribute(attributes, "ry", 0)), width / 2));
  const radiusY = Math.max(0, Math.min(numberAttribute(attributes, "ry", radiusX), height / 2));
  if (radiusX === 0 || radiusY === 0) {
    return "M" + formatNumber(x) + " " + formatNumber(y) + " L" + formatNumber(x + width) + " " + formatNumber(y) + " L" + formatNumber(x + width) + " " + formatNumber(y + height) + " L" + formatNumber(x) + " " + formatNumber(y + height) + " Z";
  }
  const right = x + width;
  const bottom = y + height;
  const kx = CURVE_KAPPA * radiusX;
  const ky = CURVE_KAPPA * radiusY;
  return [
    "M" + formatNumber(x + radiusX) + " " + formatNumber(y),
    "L" + formatNumber(right - radiusX) + " " + formatNumber(y),
    "C" + formatNumber(right - radiusX + kx) + " " + formatNumber(y) + " " + formatNumber(right) + " " + formatNumber(y + radiusY - ky) + " " + formatNumber(right) + " " + formatNumber(y + radiusY),
    "L" + formatNumber(right) + " " + formatNumber(bottom - radiusY),
    "C" + formatNumber(right) + " " + formatNumber(bottom - radiusY + ky) + " " + formatNumber(right - radiusX + kx) + " " + formatNumber(bottom) + " " + formatNumber(right - radiusX) + " " + formatNumber(bottom),
    "L" + formatNumber(x + radiusX) + " " + formatNumber(bottom),
    "C" + formatNumber(x + radiusX - kx) + " " + formatNumber(bottom) + " " + formatNumber(x) + " " + formatNumber(bottom - radiusY + ky) + " " + formatNumber(x) + " " + formatNumber(bottom - radiusY),
    "L" + formatNumber(x) + " " + formatNumber(y + radiusY),
    "C" + formatNumber(x) + " " + formatNumber(y + radiusY - ky) + " " + formatNumber(x + radiusX - kx) + " " + formatNumber(y) + " " + formatNumber(x + radiusX) + " " + formatNumber(y),
    "Z"
  ].join(" ");
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  if (rx <= 0 || ry <= 0) throw new Error("SVG ellipse must have positive radii");
  const kx = CURVE_KAPPA * rx;
  const ky = CURVE_KAPPA * ry;
  return [
    "M" + formatNumber(cx + rx) + " " + formatNumber(cy),
    "C" + formatNumber(cx + rx) + " " + formatNumber(cy + ky) + " " + formatNumber(cx + kx) + " " + formatNumber(cy + ry) + " " + formatNumber(cx) + " " + formatNumber(cy + ry),
    "C" + formatNumber(cx - kx) + " " + formatNumber(cy + ry) + " " + formatNumber(cx - rx) + " " + formatNumber(cy + ky) + " " + formatNumber(cx - rx) + " " + formatNumber(cy),
    "C" + formatNumber(cx - rx) + " " + formatNumber(cy - ky) + " " + formatNumber(cx - kx) + " " + formatNumber(cy - ry) + " " + formatNumber(cx) + " " + formatNumber(cy - ry),
    "C" + formatNumber(cx + kx) + " " + formatNumber(cy - ry) + " " + formatNumber(cx + rx) + " " + formatNumber(cy - ky) + " " + formatNumber(cx + rx) + " " + formatNumber(cy),
    "Z"
  ].join(" ");
}

function paintAttributes(attributes: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const style = new Map<string, string>();
  for (const declaration of (attributes.get("style") ?? "").split(";")) {
    const separator = declaration.indexOf(":");
    if (separator <= 0) continue;
    style.set(declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim());
  }
  for (const name of ["fill", "stroke", "stroke-width", "stroke-linejoin"] as const) {
    const value = attributes.get(name) ?? style.get(name);
    if (value === undefined || value === "") continue;
    if (name === "fill" || name === "stroke") {
      if (!/^(?:none|#[\da-f]{3,8}|[a-z]+)$/i.test(value)) throw new Error("SVG contains an unsupported paint value");
      result.set(name, value);
    } else if (name === "stroke-width") {
      const width = finiteNumber(value);
      if (width === null || width < 0) throw new Error("SVG contains an invalid stroke width");
      result.set(name, formatNumber(width));
    } else {
      if (value !== "miter" && value !== "round" && value !== "bevel") throw new Error("SVG contains an unsupported stroke join");
      result.set(name, value);
    }
  }
  return result;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function serializePathElement(data: string, paints: ReadonlyMap<string, string>): string {
  const attributes = ['d="' + escapeAttribute(data) + '"'];
  for (const name of ["fill", "stroke", "stroke-width", "stroke-linejoin"] as const) {
    const value = paints.get(name);
    if (value !== undefined) attributes.push(name + '="' + escapeAttribute(value) + '"');
  }
  return "<path " + attributes.join(" ") + "/>";
}

function serializeShape(element: SvgElement): string {
  const paints = paintAttributes(element.attributes);
  let data: string | null;
  if (element.name === "path") {
    const source = element.attributes.get("d");
    data = source === undefined ? null : normalizePathData(source);
  } else if (element.name === "rect") {
    data = rectPath(element.attributes);
  } else if (element.name === "circle") {
    data = ellipsePath(numberAttribute(element.attributes, "cx", 0), numberAttribute(element.attributes, "cy", 0), numberAttribute(element.attributes, "r"), numberAttribute(element.attributes, "r"));
  } else {
    data = ellipsePath(numberAttribute(element.attributes, "cx", 0), numberAttribute(element.attributes, "cy", 0), numberAttribute(element.attributes, "rx"), numberAttribute(element.attributes, "ry"));
  }
  if (data === null) throw new Error("SVG contains unsupported path data");
  return serializePathElement(data, paints);
}

function parseViewBox(value: string | undefined): readonly [number, number, number, number] | null {
  if (value === undefined) return null;
  const pieces = value.trim().split(/[\s,]+/);
  if (pieces.length !== 4) return null;
  const values = pieces.map((piece) => finiteNumber(piece));
  if (values.some((number) => number === null)) return null;
  const left = values[0];
  const top = values[1];
  const width = values[2];
  const height = values[3];
  if (left === undefined || top === undefined || width === undefined || height === undefined || left === null || top === null || width === null || height === null || width <= 0 || height <= 0) return null;
  return [left, top, width, height];
}

function formatFrame(viewBox: readonly [number, number, number, number]): string {
  const [x, y, width, height] = viewBox;
  return '<rect id="vp-frame" x="' + formatNumber(x) + '" y="' + formatNumber(y) + '" width="' + formatNumber(width) + '" height="' + formatNumber(height) + '" fill="none" stroke="none"/>';
}

export function serializeSvgForIllustrator(svgText: string): string {
  const source = svgText.charCodeAt(0) === 0xfeff ? svgText.slice(1) : svgText;
  const parsed = parseSimpleSvg(source);
  if (parsed === null) throw new Error("Cannot prepare malformed or unsupported SVG for Illustrator");
  if (parsed.rootAttributes.get("xmlns") !== SVG_NAMESPACE) throw new Error("SVG is missing its namespace");
  const viewBox = parseViewBox(parsed.rootAttributes.get("viewBox"));
  if (viewBox === null) throw new Error("SVG is missing a finite, positive viewBox");
  const width = finiteNumber(parsed.rootAttributes.get("width"));
  const height = finiteNumber(parsed.rootAttributes.get("height"));
  if (width === null || height === null || width <= 0 || height <= 0) throw new Error("SVG is missing explicit positive dimensions");
  const [x, y, viewWidth, viewHeight] = viewBox;
  const frame = formatFrame(viewBox);
  const body = parsed.children.map(serializeShape).join("");
  return XML_DECLARATION + "\n<svg xmlns=\"" + SVG_NAMESPACE + "\" width=\"" + formatNumber(viewWidth) + "\" height=\"" + formatNumber(viewHeight) + "\" viewBox=\"" + [x, y, viewWidth, viewHeight].map(formatNumber).join(" ") + "\">" + frame + body + "</svg>";
}

function hasOnlyAttributes(attributes: ReadonlyMap<string, string>, allowed: readonly string[]): boolean {
  for (const name of attributes.keys()) if (!allowed.includes(name)) return false;
  return true;
}

function isCanonicalNumber(value: string | undefined, parsed: number | null): boolean {
  return value !== undefined && parsed !== null && formatNumber(parsed) === value;
}

function isCanonicalPathData(data: string): boolean {
  const normalized = normalizePathData(data);
  return normalized !== null && normalized === data;
}

export function validateSvgForPlacement(svgText: string, expectedSvgText?: string): SvgValidation {
  if (svgText.trim() === "") return { kind: "invalid", reason: "empty" };
  if (svgText.charCodeAt(0) === 0xfeff) return { kind: "invalid", reason: "bom" };
  if (!svgText.startsWith(XML_DECLARATION + "\n")) {
    if (/\bencoding\s*=\s*(['"])(.*?)\1/i.test(svgText) && !/\bencoding\s*=\s*(['"])utf-8\1/i.test(svgText)) return { kind: "invalid", reason: "encoding" };
    return { kind: "invalid", reason: "malformed-xml" };
  }
  if (/\b(?:NaN|Infinity)\b/i.test(svgText)) return { kind: "invalid", reason: "non-finite" };
  const document = parseSimpleSvg(svgText, false);
  if (document === null) return { kind: "invalid", reason: "malformed-xml" };
  if (document.rootAttributes.get("xmlns") !== SVG_NAMESPACE) return { kind: "invalid", reason: "missing-namespace" };
  if (!hasOnlyAttributes(document.rootAttributes, ["xmlns", "width", "height", "viewBox"])) return { kind: "invalid", reason: "unsafe-content" };
  const width = finiteNumber(document.rootAttributes.get("width"));
  const height = finiteNumber(document.rootAttributes.get("height"));
  const viewBox = parseViewBox(document.rootAttributes.get("viewBox"));
  if (width === null || height === null || width <= 0 || height <= 0 || viewBox === null) return { kind: "invalid", reason: "invalid-dimensions" };
  const expectedViewBox = viewBox.map(formatNumber).join(" ");
  if (!isCanonicalNumber(document.rootAttributes.get("width"), width) || !isCanonicalNumber(document.rootAttributes.get("height"), height) || document.rootAttributes.get("viewBox") !== expectedViewBox || width !== viewBox[2] || height !== viewBox[3]) return { kind: "invalid", reason: "invalid-dimensions" };
  if (document.children.length < 2) return { kind: "invalid", reason: "unsafe-content" };
  const frame = document.children[0];
  if (frame === undefined || frame.name !== "rect" || !hasOnlyAttributes(frame.attributes, ["id", "x", "y", "width", "height", "fill", "stroke"])) return { kind: "invalid", reason: "unsafe-content" };
  const frameX = finiteNumber(frame.attributes.get("x"));
  const frameY = finiteNumber(frame.attributes.get("y"));
  const frameWidth = finiteNumber(frame.attributes.get("width"));
  const frameHeight = finiteNumber(frame.attributes.get("height"));
  if (!isCanonicalNumber(frame.attributes.get("x"), frameX) || !isCanonicalNumber(frame.attributes.get("y"), frameY) || !isCanonicalNumber(frame.attributes.get("width"), frameWidth) || !isCanonicalNumber(frame.attributes.get("height"), frameHeight)) return { kind: "invalid", reason: "unsafe-content" };
  if (frame.attributes.get("id") !== "vp-frame" || frame.attributes.get("fill") !== "none" || frame.attributes.get("stroke") !== "none" || frameX !== viewBox[0] || frameY !== viewBox[1] || frameWidth !== viewBox[2] || frameHeight !== viewBox[3]) return { kind: "invalid", reason: "unsafe-content" };
  for (const element of document.children.slice(1)) {
    if (element.name !== "path" || !hasOnlyAttributes(element.attributes, ["d", "fill", "stroke", "stroke-width", "stroke-linejoin"])) return { kind: "invalid", reason: "unsafe-content" };
    const data = element.attributes.get("d");
    if (data === undefined || !isCanonicalPathData(data)) return { kind: "invalid", reason: "path-commands" };
    const strokeWidth = element.attributes.get("stroke-width");
    if (strokeWidth !== undefined && !isCanonicalNumber(strokeWidth, finiteNumber(strokeWidth))) return { kind: "invalid", reason: "unsafe-content" };
    try {
      paintAttributes(element.attributes);
    } catch {
      return { kind: "invalid", reason: "unsafe-content" };
    }
  }
  if (expectedSvgText !== undefined && svgText !== serializeSvgForIllustrator(expectedSvgText)) return { kind: "invalid", reason: "stale-content" };
  return { kind: "valid" };
}
