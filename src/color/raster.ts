import type { Rgb } from "./model";
import type { VecCommand, VecShape } from "./trace";

type Point = { x: number; y: number };

/** Rasterize the tracer's filled shapes. The SVG subset is M, L, C, Z with even-odd fills. */
export function rasterizeShapes(shapes: readonly VecShape[], width: number, height: number, pad = 0): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (const shape of shapes) {
    const polygons: Point[][] = [];
    for (const subpath of shape.subpaths) {
      const polygon: Point[] = [{ x: subpath.start.x, y: subpath.start.y }];
      let x = subpath.start.x;
      let y = subpath.start.y;
      for (const command of subpath.commands) {
        if (command.op === "L") {
          polygon.push({ x: command.x, y: command.y });
          x = command.x;
          y = command.y;
        } else {
          flattenCubic({ x, y }, command, polygon);
          x = command.x;
          y = command.y;
        }
      }
      if (polygon.length >= 3) polygons.push(polygon);
    }
    fillEvenOdd(rgba, width, height, polygons, shape.color, pad);
  }
  return rgba;
}

/** Rasterize one source-pixel window at `scale` (4 is a 400% zoom) from the vector fills. */
export function rasterizeWindow(
  shapes: readonly VecShape[],
  originX: number,
  originY: number,
  cropWidth: number,
  cropHeight: number,
  scale: number
): Uint8Array {
  const zoom = Math.max(1, scale);
  const placed = shapes.map((shape) => ({
    color: shape.color,
    area: shape.area,
    subpaths: shape.subpaths.map((subpath) => ({
      start: { x: (subpath.start.x - originX) * zoom, y: (subpath.start.y - originY) * zoom },
      commands: subpath.commands.map((command) => scaleCommand(command, originX, originY, zoom))
    }))
  }));
  return rasterizeShapes(placed, Math.max(1, Math.round(cropWidth * zoom)), Math.max(1, Math.round(cropHeight * zoom)));
}

function scaleCommand(command: VecCommand, originX: number, originY: number, zoom: number): VecCommand {
  if (command.op === "L") {
    return { op: "L", x: (command.x - originX) * zoom, y: (command.y - originY) * zoom };
  }
  return {
    op: "C",
    x1: (command.x1 - originX) * zoom,
    y1: (command.y1 - originY) * zoom,
    x2: (command.x2 - originX) * zoom,
    y2: (command.y2 - originY) * zoom,
    x: (command.x - originX) * zoom,
    y: (command.y - originY) * zoom
  };
}

function flattenCubic(start: Point, command: Extract<VecCommand, { op: "C" }>, out: Point[], depth = 0): void {
  const end = { x: command.x, y: command.y };
  const controlA = { x: command.x1, y: command.y1 };
  const controlB = { x: command.x2, y: command.y2 };
  if (depth >= 10 || flatEnough(start, controlA, controlB, end, 0.25)) {
    out.push(end);
    return;
  }
  const ab = midpoint(start, controlA);
  const bc = midpoint(controlA, controlB);
  const cd = midpoint(controlB, end);
  const abc = midpoint(ab, bc);
  const bcd = midpoint(bc, cd);
  const mid = midpoint(abc, bcd);
  flattenCubic(start, { op: "C", x1: ab.x, y1: ab.y, x2: abc.x, y2: abc.y, x: mid.x, y: mid.y }, out, depth + 1);
  flattenCubic(mid, { op: "C", x1: bcd.x, y1: bcd.y, x2: cd.x, y2: cd.y, x: end.x, y: end.y }, out, depth + 1);
}

function flatEnough(p0: Point, p1: Point, p2: Point, p3: Point, tolerance: number): boolean {
  return pointSegmentDistance(p1, p0, p3) <= tolerance && pointSegmentDistance(p2, p0, p3) <= tolerance;
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function pointSegmentDistance(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-8) return Math.hypot(point.x - from.x, point.y - from.y);
  return Math.abs((point.x - from.x) * dy - (point.y - from.y) * dx) / length;
}

function fillEvenOdd(rgba: Uint8Array, width: number, height: number, polygons: readonly Point[][], color: Rgb, pad: number): void {
  const edges: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const polygon of polygons) {
    for (let i = 0; i < polygon.length; i++) {
      const from = polygon[i];
      const to = polygon[(i + 1) % polygon.length];
      if (!from || !to || from.y === to.y) continue;
      edges.push({ x0: from.x, y0: from.y, x1: to.x, y1: to.y });
    }
  }
  const crossings: number[] = [];
  for (let y = 0; y < height; y++) {
    const scan = y + 0.5;
    crossings.length = 0;
    for (const edge of edges) {
      const crosses = (edge.y0 <= scan && edge.y1 > scan) || (edge.y1 <= scan && edge.y0 > scan);
      if (!crosses) continue;
      const t = (scan - edge.y0) / (edge.y1 - edge.y0);
      crossings.push(edge.x0 + t * (edge.x1 - edge.x0));
    }
    if (crossings.length < 2) continue;
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const left = crossings[i];
      const right = crossings[i + 1];
      if (left === undefined || right === undefined || right <= left) continue;
      const from = Math.max(0, Math.ceil(left - 0.5 - pad));
      const to = Math.min(width - 1, Math.floor(right - 0.5 + pad));
      for (let x = from; x <= to; x++) {
        const offset = (y * width + x) * 4;
        rgba[offset] = color.r;
        rgba[offset + 1] = color.g;
        rgba[offset + 2] = color.b;
        rgba[offset + 3] = 255;
      }
    }
  }
}
