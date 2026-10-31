/**
 * Which inks a traced plate actually paints, read back at the plate's source pixel centres, so a trace can be checked
 * against the labels it was traced from. VTracer's SVG is a stack of filled paths (later on top), each one
 * `<path d=".." fill="#RRGGBB" transform="translate(x,y)"/>` in plate pixels, filled by the nonzero rule.
 */
import { readRgbaPng } from "./png-alpha.ts";

type Ring = readonly (readonly [number, number])[];

const PATH = /<path\b[^>]*?\bd="([^"]*)"[^>]*>/gi;
const STEPS = 16;

/** The paint (0xRRGGBB, after `fills`) of the topmost path over each source pixel centre, or -1 where none is. */
export function paintedInks(svg: string, columns: number, rows: number, scale: number, fills: Readonly<Record<string, string>> = {}): Int32Array {
  const painted = new Int32Array(columns * rows).fill(-1);
  for (const match of svg.matchAll(PATH)) {
    const tag = match[0];
    const fill = /\bfill="(#[0-9a-f]{6})"/i.exec(tag)?.[1];
    if (fill === undefined) continue;
    const ink = parseInt((fills[fill.toUpperCase()] ?? fill).slice(1), 16);
    const shift = /translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/.exec(tag);
    const rings = pathRings(match[1] ?? "", shift === null ? 0 : Number(shift[1]), shift === null ? 0 : Number(shift[2]));
    fillRings(rings, painted, columns, rows, scale, ink);
  }
  return painted;
}

/** The plate's own colour (0xRRGGBB, after `fills`) at each source pixel centre, or -1 where it is clear. */
export function plateInks(rgba: Uint8Array, plateWidth: number, plateHeight: number, scale: number, fills: Readonly<Record<string, string>> = {}): Int32Array {
  const columns = Math.floor(plateWidth / scale), rows = Math.floor(plateHeight / scale), half = scale >> 1;
  const back = new Map(Object.entries(fills).map(([stand, own]) => [parseInt(stand.slice(1), 16), parseInt(own.slice(1), 16)]));
  const inks = new Int32Array(columns * rows);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const at = ((y * scale + half) * plateWidth + x * scale + half) * 4;
      if ((rgba[at + 3] ?? 0) === 0) { inks[y * columns + x] = -1; continue; }
      const ink = ((rgba[at] ?? 0) << 16) | ((rgba[at + 1] ?? 0) << 8) | (rgba[at + 2] ?? 0);
      inks[y * columns + x] = back.get(ink) ?? ink;
    }
  }
  return inks;
}

/** Source pixels whose traced paint is not the plate's own colour there (painted where clear, clear where painted, or another ink). */
export function inkMismatches(traced: Int32Array, plate: Int32Array): number {
  let wrong = 0;
  for (let index = 0; index < plate.length; index += 1) if (traced[index] !== plate[index]) wrong += 1;
  return wrong;
}

function pathRings(data: string, dx: number, dy: number): Ring[] {
  const tokens = data.match(/[MmLlHhVvCcSsQqTtZz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? [];
  const rings: [number, number][][] = [];
  let ring: [number, number][] = [];
  let x = 0, y = 0, startX = 0, startY = 0, command = "M", at = 0;
  const number = () => Number(tokens[at++]);
  const close = () => { if (ring.length > 2) rings.push(ring); ring = []; };
  while (at < tokens.length) {
    if (/[A-Za-z]/.test(tokens[at]!)) command = tokens[at++]!;
    const relative = command === command.toLowerCase();
    const ox = relative ? x : 0, oy = relative ? y : 0;
    switch (command.toUpperCase()) {
      case "M": close(); x = ox + number(); y = oy + number(); startX = x; startY = y; ring.push([x + dx, y + dy]); command = relative ? "l" : "L"; break;
      case "L": x = ox + number(); y = oy + number(); ring.push([x + dx, y + dy]); break;
      case "H": x = ox + number(); ring.push([x + dx, y + dy]); break;
      case "V": y = oy + number(); ring.push([x + dx, y + dy]); break;
      case "C": {
        const x1 = ox + number(), y1 = oy + number(), x2 = ox + number(), y2 = oy + number(), x3 = ox + number(), y3 = oy + number();
        for (let step = 1; step <= STEPS; step += 1) {
          const t = step / STEPS, u = 1 - t;
          ring.push([u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3 + dx, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3 + dy]);
        }
        x = x3; y = y3; break;
      }
      case "Z": x = startX; y = startY; close(); break;
      default: return rings; // S, Q, T: VTracer does not write them
    }
  }
  close();
  return rings;
}

function fillRings(rings: readonly Ring[], painted: Int32Array, columns: number, rows: number, scale: number, ink: number): void {
  let minY = Infinity, maxY = -Infinity;
  for (const ring of rings) for (const [, y] of ring) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const first = Math.max(0, Math.ceil(minY / scale - 0.5)), last = Math.min(rows - 1, Math.floor(maxY / scale - 0.5));
  for (let row = first; row <= last; row += 1) {
    const cy = (row + 0.5) * scale;
    const crossings: [number, number][] = [];
    for (const ring of rings) {
      for (let index = 0; index < ring.length; index += 1) {
        const a = ring[index]!, b = ring[(index + 1) % ring.length]!;
        if ((a[1] <= cy) === (b[1] <= cy)) continue;
        crossings.push([a[0] + ((cy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), b[1] > a[1] ? 1 : -1]);
      }
    }
    crossings.sort((left, right) => left[0] - right[0]);
    let winding = 0;
    for (let index = 0; index + 1 < crossings.length; index += 1) {
      winding += crossings[index]![1];
      if (winding === 0) continue;
      const from = Math.max(0, Math.ceil(crossings[index]![0] / scale - 0.5)), to = Math.min(columns - 1, Math.floor(crossings[index + 1]![0] / scale - 0.5));
      for (let column = from; column <= to; column += 1) painted[row * columns + column] = ink;
    }
  }
}

/** What chooseTraces needs of a plate: its traced raster (plate pixels), scale, stand-in fills and backup link. */
export type CoveragePlate = {
  readonly scale: number;
  readonly png?: Uint8Array;
  readonly fills?: Readonly<Record<string, string>>;
  /** Index (in the same plate list) of this plate traced with its own colours, kept to fall back on. */
  readonly plain?: number;
  /** This plate is only another plate's fallback trace (see `plain`): never drawn on its own. */
  readonly backup?: boolean;
};

/**
 * For each plate traced with stand-in inks (separateNearInks), keep that trace only when it paints more of the
 * plate's own pixels in their own ink than the plain trace of the same plate does; otherwise use the plain trace
 * (the c603683 one). The stand-in exists to keep a second ink the tracer would fold away, so it has earned its place
 * only if the inks it paints match the labels better: both traces are read back on the same grid against the same
 * labels, and the plain one wins ties. No threshold is needed: the comparison is between the two candidates. The grid
 * is half a source pixel (two samples per pixel each way), so a seam sliver that misses every pixel centre still counts.
 * Backup plates are dropped from the result.
 */
export function chooseTraces<Plate extends CoveragePlate>(svgs: readonly string[], plates: readonly Plate[]): { readonly svgs: string[]; readonly plates: Plate[] } {
  const keptSvgs: string[] = [], keptPlates: Plate[] = [];
  for (const [index, plate] of plates.entries()) {
    if (plate.backup === true) continue;
    const svg = svgs[index];
    if (svg === undefined) continue;
    const plainSvg = plate.plain === undefined ? undefined : svgs[plate.plain];
    if (plate.fills === undefined || plainSvg === undefined || plate.png === undefined) {
      keptSvgs.push(svg); keptPlates.push(plate); continue;
    }
    const decoded = readRgbaPng(Buffer.from(plate.png.buffer, plate.png.byteOffset, plate.png.byteLength));
    const step = Math.max(1, plate.scale >> 1);
    if (decoded === null) { keptSvgs.push(plainSvg); keptPlates.push(plate); continue; }
    const columns = Math.floor(decoded.width / step), rows = Math.floor(decoded.height / step);
    const labels = plateInks(decoded.rgba, decoded.width, decoded.height, step, plate.fills);
    const separated = inkMismatches(paintedInks(svg, columns, rows, step, plate.fills), labels);
    const plain = inkMismatches(paintedInks(plainSvg, columns, rows, step), labels);
    keptSvgs.push(separated < plain ? svg : plainSvg);
    keptPlates.push(plate);
  }
  return { svgs: keptSvgs, plates: keptPlates };
}
