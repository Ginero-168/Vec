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
  readonly originX?: number;
  readonly originY?: number;
  /** The source raster the plate was cut from (plate pixel x * scale + scale / 2 is source pixel originX + x). */
  readonly source?: { readonly rgba: Uint8Array; readonly width: number; readonly height: number };
  readonly png?: Uint8Array;
  readonly fills?: Readonly<Record<string, string>>;
  /** Index (in the same plate list) of this plate traced with its own colours, kept to fall back on. */
  readonly plain?: number;
  /** This plate is only another plate's fallback trace (see `plain`): never drawn on its own. */
  readonly backup?: boolean;
};

/**
 * For each plate traced with stand-in inks (separateNearInks), keep that trace only when it paints better than the
 * plain trace of the same plate (the c603683 one) by all three of these measures; otherwise use the plain trace.
 * 1. The plate's labels (labelMismatches): fewer pixels off their label.
 * 2. The source (sourceMismatches): fewer source pixels where its ink is the farther of the two traces' inks from the
 *    pixel's own colour. The labels alone are blind on thin art, where a near ink's label takes in the anti-aliased
 *    rims of both inks and so holds far more pixels than the source gives that ink: a trace that paints the major ink
 *    in the minor one then agrees with the labels.
 * 3. The inks' own pixels (worstInkLoss): no ink's share of its exact-colour source pixels painted in that ink drops by
 *    more than RECALL_TOLERANCE, whatever another ink gains, so a small ink is not traded for a large ink's few pixels.
 * Ties keep the plain trace. A plate without its source raster is judged on its labels only. Backup plates are dropped
 * from the result.
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
    if (decoded === null) { keptSvgs.push(plainSvg); keptPlates.push(plate); continue; }
    const [labelSeparated, labelPlain] = labelMismatches(svg, plainSvg, decoded, plate.scale, plate.fills);
    let better = labelSeparated < labelPlain;
    if (better && plate.source !== undefined) {
      const traced = sourceTraces(svg, plainSvg, decoded, plate.scale, plate.fills, plate.source, plate.originX ?? 0, plate.originY ?? 0);
      const [sourceSeparated, sourcePlain] = sourceMismatches(traced);
      better = sourceSeparated < sourcePlain && worstInkLoss(traced) <= RECALL_TOLERANCE;
    }
    keptSvgs.push(better ? svg : plainSvg);
    keptPlates.push(plate);
  }
  return { svgs: keptSvgs, plates: keptPlates };
}

type Decoded = { readonly rgba: Uint8Array; readonly width: number; readonly height: number };

/** Mismatches of the stand-in and plain traces against the plate's labels, on a half-source-pixel grid (fix18). */
function labelMismatches(svg: string, plainSvg: string, decoded: Decoded, scale: number, fills: Readonly<Record<string, string>>): [number, number] {
  const step = Math.max(1, scale >> 1);
  const columns = Math.floor(decoded.width / step), rows = Math.floor(decoded.height / step);
  const labels = plateInks(decoded.rgba, decoded.width, decoded.height, step, fills);
  return [inkMismatches(paintedInks(svg, columns, rows, step, fills), labels), inkMismatches(paintedInks(plainSvg, columns, rows, step), labels)];
}

/** Both traces and the plate's labels read back at each source pixel the plate covers, with that pixel's colour. */
export type SourceTraces = { readonly separated: Int32Array; readonly plain: Int32Array; readonly labels: Int32Array; readonly colours: Int32Array };

export function sourceTraces(
  svg: string, plainSvg: string, decoded: Decoded, scale: number, fills: Readonly<Record<string, string>>,
  source: Decoded, originX: number, originY: number
): SourceTraces {
  const columns = Math.floor(decoded.width / scale), rows = Math.floor(decoded.height / scale);
  const colours = new Int32Array(columns * rows).fill(-2);
  for (let y = 0; y < rows; y += 1) {
    const sy = y + originY;
    if (sy < 0 || sy >= source.height) continue;
    for (let x = 0; x < columns; x += 1) {
      const sx = x + originX;
      if (sx < 0 || sx >= source.width) continue;
      const at = (sy * source.width + sx) * 4;
      colours[y * columns + x] = (source.rgba[at + 3] ?? 0) === 0 ? -1 : ((source.rgba[at] ?? 0) << 16) | ((source.rgba[at + 1] ?? 0) << 8) | (source.rgba[at + 2] ?? 0);
    }
  }
  return {
    separated: paintedInks(svg, columns, rows, scale, fills),
    plain: paintedInks(plainSvg, columns, rows, scale),
    labels: plateInks(decoded.rgba, decoded.width, decoded.height, scale, fills),
    colours
  };
}

const apart = (left: number, right: number) => Math.abs(((left >> 16) & 255) - ((right >> 16) & 255))
  + Math.abs(((left >> 8) & 255) - ((right >> 8) & 255)) + Math.abs((left & 255) - (right & 255));

/** Source pixels each trace gets wrong where the two traces differ (see chooseTraces): [stand-in, plain]. */
export function sourceMismatches({ separated, plain, labels, colours }: SourceTraces): [number, number] {
  let separatedWrong = 0, plainWrong = 0;
  for (let cell = 0; cell < colours.length; cell += 1) {
    const colour = colours[cell]!, left = separated[cell]!, right = plain[cell]!;
    if (colour === -2 || left === right) continue;
    if (left === -1 || right === -1) {
      const clear = labels[cell] === -1;
      if ((left === -1) !== clear) separatedWrong += 1;
      if ((right === -1) !== clear) plainWrong += 1;
      continue;
    }
    if (colour === -1) continue;
    const near = apart(left, colour), far = apart(right, colour);
    if (near > far) separatedWrong += 1; else if (far > near) plainWrong += 1;
  }
  return [separatedWrong, plainWrong];
}

/**
 * The recall an ink may lose to the stand-in trace: the scorer's tolerance for a minor ink's drop when the other ink
 * gains (Vecy, fix18 gate: about 0.03 of the ink's pixels).
 */
export const RECALL_TOLERANCE = 0.03;

/**
 * The largest drop, over the inks either trace paints, of the share of that ink's exact-colour source pixels painted in
 * that ink, from the plain trace to the stand-in trace (0 when no ink drops).
 */
export function worstInkLoss({ separated, plain, colours }: SourceTraces): number {
  const inks = new Set<number>();
  for (const traced of [separated, plain]) for (const ink of traced) if (ink >= 0) inks.add(ink);
  const own = new Map<number, [number, number, number]>([...inks].map((ink) => [ink, [0, 0, 0]]));
  for (let cell = 0; cell < colours.length; cell += 1) {
    const tally = own.get(colours[cell]!);
    if (tally === undefined) continue;
    tally[0] += 1;
    if (separated[cell] === colours[cell]) tally[1] += 1;
    if (plain[cell] === colours[cell]) tally[2] += 1;
  }
  let worst = 0;
  for (const [pixels, separatedHits, plainHits] of own.values()) if (pixels > 0) worst = Math.max(worst, (plainHits - separatedHits) / pixels);
  return worst;
}
