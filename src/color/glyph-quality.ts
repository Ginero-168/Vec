import { halfCoverageMask, maskCorners } from "./glyph";
import type { Rgb } from "./model";
import { rasterizeWindow } from "./raster";
import type { VecCommand, VecShape } from "./trace";

type Point = { x: number; y: number };

export type GlyphQuality = {
  readonly iou: number;
  readonly hausdorffP95: number;
  readonly spikes: number;
  /** Interior gaps in the ink that are not counters of the source mask. */
  readonly cracks: number;
};

/** Compare a text box to the 4× bicubic half-coverage mask of the original. */
export function measureGlyphBox(
  shapes: readonly VecShape[],
  rgba: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  boxWidth: number,
  boxHeight: number,
  ink: Rgb,
  bg: Rgb
): GlyphQuality {
  const scale = 4;
  const mask = halfCoverageMask(rgba, width, height, x0, y0, boxWidth, boxHeight, ink, bg, scale);
  const raster = rasterizeWindow(shapes, x0, y0, boxWidth, boxHeight, scale);
  const zoomWidth = Math.max(1, boxWidth * scale);
  const zoomHeight = Math.max(1, boxHeight * scale);
  let intersection = 0;
  let union = 0;
  const reference: Point[] = [];
  const vector: Point[] = [];
  for (let y = 0; y < zoomHeight; y++) {
    for (let x = 0; x < zoomWidth; x++) {
      const index = y * zoomWidth + x;
      const covered = mask[index] === 1;
      const offset = index * 4;
      const filled =
        (raster[offset + 3] ?? 0) > 0 && raster[offset] === ink.r && raster[offset + 1] === ink.g && raster[offset + 2] === ink.b;
      if (covered || filled) union++;
      if (covered && filled) intersection++;
      if (covered && maskBoundary(mask, zoomWidth, zoomHeight, x, y)) reference.push({ x, y });
      if (filled && rasterBoundary(raster, zoomWidth, zoomHeight, x, y, ink)) vector.push({ x, y });
    }
  }
  const distances = directedDistances(reference, vector).concat(directedDistances(vector, reference));
  distances.sort((left, right) => left - right);
  const hausdorff = distances.length === 0 ? 99 : (distances[Math.min(distances.length - 1, Math.floor(distances.length * 0.95))] ?? 99) / scale;
  const corners = maskCorners(mask, zoomWidth, zoomHeight, x0, y0, scale);
  return {
    iou: union === 0 ? 0 : intersection / union,
    hausdorffP95: hausdorff,
    spikes: spikeCount(shapes, x0, y0, x0 + boxWidth, y0 + boxHeight, ink, corners),
    cracks: interiorCracks(mask, raster, ink, zoomWidth, zoomHeight)
  };
}

/** Missed ink that sits inside the letter instead of on its silhouette. */
function interiorCracks(mask: Uint8Array, raster: Uint8Array, ink: Rgb, width: number, height: number): number {
  const missed = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (mask[index] !== 1) continue;
      const offset = index * 4;
      const filled = (raster[offset + 3] ?? 0) > 0 && raster[offset] === ink.r && raster[offset + 1] === ink.g && raster[offset + 2] === ink.b;
      if (!filled) missed[index] = 1;
    }
  }
  const seen = new Uint8Array(missed.length);
  let cracks = 0;
  for (let start = 0; start < missed.length; start++) {
    if (!missed[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let area = 0;
    let interior = true;
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      area++;
      const x = current % width;
      const y = (current - x) / width;
      const neighbors = [current - 1, current + 1, current - width, current + width];
      for (const next of neighbors) {
        const nx = next % width;
        const ny = (next - nx) / width;
        if (next < 0 || next >= missed.length || Math.abs(nx - x) + Math.abs(ny - y) !== 1) {
          interior = false;
          continue;
        }
        if (mask[next] !== 1) interior = false;
        if (!missed[next] || seen[next]) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    if (interior && area >= 4 && area <= 240) cracks++;
  }
  return cracks;
}

function maskBoundary(mask: Uint8Array, width: number, height: number, x: number, y: number): boolean {
  const neighbors = [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1]
  ];
  for (const neighbor of neighbors) {
    const nx = neighbor[0] ?? 0;
    const ny = neighbor[1] ?? 0;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height || mask[ny * width + nx] !== 1) return true;
  }
  return false;
}

function rasterBoundary(raster: Uint8Array, width: number, height: number, x: number, y: number, ink: Rgb): boolean {
  const neighbors = [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1]
  ];
  for (const neighbor of neighbors) {
    const nx = neighbor[0] ?? 0;
    const ny = neighbor[1] ?? 0;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) return true;
    const offset = (ny * width + nx) * 4;
    const filled = (raster[offset + 3] ?? 0) > 0 && raster[offset] === ink.r && raster[offset + 1] === ink.g && raster[offset + 2] === ink.b;
    if (!filled) return true;
  }
  return false;
}

function directedDistances(from: readonly Point[], to: readonly Point[]): number[] {
  if (from.length === 0 || to.length === 0) return from.length === 0 && to.length === 0 ? [] : [99 * 4];
  const buckets = new Map<string, Point[]>();
  for (const point of to) {
    const key = Math.round(point.x / 4) + "," + Math.round(point.y / 4);
    const list = buckets.get(key);
    if (list) list.push(point);
    else buckets.set(key, [point]);
  }
  const distances: number[] = [];
  for (const point of from) {
    const cx = Math.round(point.x / 4);
    const cy = Math.round(point.y / 4);
    let best = 64;
    for (let oy = -2; oy <= 2; oy++) {
      for (let ox = -2; ox <= 2; ox++) {
        const list = buckets.get(cx + ox + "," + (cy + oy));
        if (!list) continue;
        for (const other of list) {
          const distance = Math.hypot(other.x - point.x, other.y - point.y);
          if (distance < best) best = distance;
        }
      }
    }
    distances.push(best);
  }
  return distances;
}

function spikeCount(
  shapes: readonly VecShape[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  ink: Rgb,
  corners: readonly Point[]
): number {
  let spikes = 0;
  for (const shape of shapes) {
    if (shape.color.r !== ink.r || shape.color.g !== ink.g || shape.color.b !== ink.b) continue;
    for (const subpath of shape.subpaths) {
      const samples = sampleCommands(subpath.start, subpath.commands, 0.35);
      for (let i = 1; i < samples.length - 1; i++) {
        const before = samples[i - 1];
        const point = samples[i];
        const after = samples[i + 1];
        if (!before || !point || !after) continue;
        if (point.x < x0 - 1 || point.x > x1 + 1 || point.y < y0 - 1 || point.y > y1 + 1) continue;
        const turn = Math.abs(heading(before, point, after));
        if (turn <= (120 * Math.PI) / 180) continue;
        let trueCorner = false;
        for (const corner of corners) {
          if (Math.hypot(corner.x - point.x, corner.y - point.y) <= 1) {
            trueCorner = true;
            break;
          }
        }
        if (!trueCorner) spikes++;
      }
    }
  }
  return spikes;
}

function sampleCommands(start: Point, commands: readonly VecCommand[], spacing: number): Point[] {
  const samples: Point[] = [{ x: start.x, y: start.y }];
  let x = start.x;
  let y = start.y;
  for (const command of commands) {
    if (command.op === "L") {
      const length = Math.hypot(command.x - x, command.y - y);
      const steps = Math.max(1, Math.ceil(length / spacing));
      for (let step = 1; step <= steps; step++) {
        const t = step / steps;
        samples.push({ x: x + (command.x - x) * t, y: y + (command.y - y) * t });
      }
    } else {
      const length = Math.hypot(command.x - x, command.y - y) + Math.hypot(command.x1 - x, command.y1 - y) + Math.hypot(command.x - command.x2, command.y - command.y2);
      const steps = Math.max(2, Math.ceil(length / spacing));
      for (let step = 1; step <= steps; step++) {
        const t = step / steps;
        const u = 1 - t;
        samples.push({
          x: u * u * u * x + 3 * u * u * t * command.x1 + 3 * u * t * t * command.x2 + t * t * t * command.x,
          y: u * u * u * y + 3 * u * u * t * command.y1 + 3 * u * t * t * command.y2 + t * t * t * command.y
        });
      }
    }
    x = command.x;
    y = command.y;
  }
  return samples;
}

function heading(a: Point, b: Point, c: Point): number {
  const incoming = Math.atan2(b.y - a.y, b.x - a.x);
  const outgoing = Math.atan2(c.y - b.y, c.x - b.x);
  let delta = outgoing - incoming;
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}
