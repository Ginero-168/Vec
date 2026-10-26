export type TraceFacts = {
  readonly paths: number;
  readonly anchors: number;
  readonly holes: number;
  readonly colors: number;
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

export function scoreSvg(svg: string): TraceFacts {
  const colors = new Set<string>();
  let paths = 0;
  let anchors = 0;
  let holes = 0;
  for (const attrs of pathAttributes(svg)) {
    const data = readAttr(attrs, "d");
    if (data === null || data.trim() === "") continue;
    paths += 1;
    const fill = normalizeFill(fillOf(attrs));
    if (fill !== null) colors.add(fill);
    const measured = measurePath(data);
    anchors += measured.anchors;
    holes += measured.holes;
  }
  return { paths, anchors, holes, colors: colors.size };
}

function pathAttributes(svg: string): string[] {
  const found: string[] = [];
  const pattern = /<path\b([^>]*)>/gi;
  let match = pattern.exec(svg);
  while (match !== null) {
    found.push(match[1] ?? "");
    match = pattern.exec(svg);
  }
  return found;
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

function measurePath(data: string): { readonly anchors: number; readonly holes: number } {
  const commands = tokenize(data);
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let prevControl: Point | null = null;
  let anchors = 0;
  let open: Point[] = [];
  const subs: Subpath[] = [];

  function finish(): void {
    if (open.length === 0) return;
    subs.push({ points: open, area: signedArea(open) });
    open = [];
  }

  function addAnchor(x: number, y: number, curve: boolean): void {
    const closing = open.length > 0 && Math.hypot(x - sx, y - sy) < 0.05;
    if (!closing) anchors += 1;
    if (curve) {
      // Curve samples are appended by the caller, including the endpoint.
    } else if (!closing || open.length === 0) {
      open.push({ x, y });
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
      for (const t of [0.25, 0.5, 0.75, 1]) open.push(bezier(start, cubic.p1, cubic.p2, cubic.p3, t));
      prevControl = cubic.control;
      addAnchor(cubic.p3.x, cubic.p3.y, true);
    } else if (op === "a") {
      const end = arcEnd(relative, args, cx, cy);
      addAnchor(end.x, end.y, false);
    } else if (op === "z") {
      if (Math.hypot(cx - sx, cy - sy) >= 0.05) open.push({ x: sx, y: sy });
      cx = sx;
      cy = sy;
      finish();
    }
  }
  finish();
  return { anchors, holes: countHoles(subs) };
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
