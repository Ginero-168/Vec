import { fairPaths, fitRasterCorners, relaxPaths, sharpenConfirmed, sharpenCorners, type ColourAt, type CornerCheck } from "./edit.ts";
import { dropCanvasBackground, dropFill, fitShapes, groupPathsByFill, sealGaps, unifyNearFills } from "./score.ts";
import { scaleSvg, translateSvg } from "./svg-scale.ts";
import type { Stacking, TracePreset } from "./trace.ts";

export type PlacedPlate = {
  readonly scale: number;
  readonly originX: number;
  readonly originY: number;
  readonly borderColor: string | null;
  /** Set when the plate's source has transparent pixels (see FlatPlate.cutOut). */
  readonly cutOut?: boolean;
  /** The source raster the plate was cut from, when the caller still has it; lets sharpening check corners. */
  readonly source?: SourceRaster;
};

export type SourceRaster = { readonly rgba: Uint8Array; readonly width: number; readonly height: number };

const SHAPE = /<path\b[^>]*\/>|<path\b[^>]*>[\s\S]*?<\/path>|<circle\b[^>]*\/>|<ellipse\b[^>]*\/>|<rect\b[^>]*\/>/gi;

export function mergePlates(
  svgs: readonly string[],
  plates: readonly PlacedPlate[],
  width: number,
  height: number,
  droppedColor: string | null,
  removeBackground: boolean,
  fitGeometry = true
): string {
  const drawings: string[] = [];
  for (let index = 0; index < svgs.length; index += 1) {
    const plate = plates[index];
    const svg = svgs[index];
    if (plate === undefined || svg === undefined) continue;
    let next = scaleSvg(svg, 1 / plate.scale);
    if (droppedColor !== null) next = dropFill(next, droppedColor);
    if (removeBackground) next = dropCanvasBackground(next, plate.borderColor);
    next = translateSvg(next, plate.originX, plate.originY);
    drawings.push((next.match(SHAPE) ?? []).join(""));
  }
  const merged =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    String(width) +
    '" height="' +
    String(height) +
    '" viewBox="0 0 ' +
    String(width) +
    " " +
    String(height) +
    '">' +
    drawings.join("") +
    "</svg>";
  // A traced fillet up to two source pixels is VTracer's rounding on large inputs; on small icons a two-pixel bend is
  // real geometry, so the fillet limit shrinks to 1.25 px at 128 px and below. Corners rounded inside long cubics are
  // only judged on inputs of 128 px and up, where VTracer's rounding is much smaller than the shapes' own radii.
  const size = Math.max(width, height);
  const fillet = Math.min(2, Math.max(1.25, size / 128));
  const curl = size >= 128 ? Math.min(2, size / 128) : 0;
  if (!fitGeometry) return merged;
  const cutOut = plates.length > 0 && plates.every((plate) => plate.cutOut === true);
  // Near-identical fills are an anti-aliasing fringe's palette slot on a cut-out; on an opaque backdrop they can be
  // real neighbouring shades (JPEG), and merging them raised MAE.
  const fitted = fitShapes(cutOut ? unifyNearFills(merged) : merged);
  // Only cut-out (transparent-backdrop) sources: their edges come from the corner-preserving transparent cut. On an
  // opaque backdrop (white, JPEG) the traced bends follow anti-aliasing or compression noise, and sharpening them
  // made false corners (si-spotify-128-white-q60) and raised MAE (om-gear-32-white +1.0). The corner colour alone
  // does not tell: a logo filling its crop has four different opaque corners and no border colour either.
  if (cutOut) return sharpenCorners(fitted, fillet, 35, curl);
  // Below 96 px (the JPEG cleanup's line too) a bend of a pixel or two is the icon's own geometry and a corner's
  // pixels are shared with its neighbours: sharpening there cost om-gear-32-white +1.0 MAE and om-grinning-64-q60 +0.14.
  const check = size >= MIN_CHECKED_SIDE ? sourceCheck(plates) : null;
  if (check === null) return fitted;
  const sharpened = sharpenConfirmed(fitted, fillet, 35, curl, check);
  const colour = sourceColour(plates);
  return colour === null ? sharpened : fitRasterCorners(sharpened, colour, check);
}

function sourceColour(plates: readonly PlacedPlate[]): ColourAt | null {
  const source = plates.find((plate) => plate.source !== undefined)?.source;
  if (source === undefined) return null;
  const { rgba, width, height } = source;
  return (x, y) => {
    const fx = x - 0.5;
    const fy = y - 0.5;
    if (fx < 0 || fy < 0 || fx > width - 1 || fy > height - 1) return null;
    const x0 = Math.min(width - 2, Math.floor(fx));
    const y0 = Math.min(height - 2, Math.floor(fy));
    const ax = fx - x0;
    const ay = fy - y0;
    const out: [number, number, number] = [0, 0, 0];
    for (let channel = 0; channel < 3; channel += 1) {
      const at = (yy: number, xx: number) => rgba[(yy * width + xx) * 4 + channel] ?? 0;
      out[channel] = (at(y0, x0) * (1 - ax) + at(y0, x0 + 1) * ax) * (1 - ay) + (at(y0 + 1, x0) * (1 - ax) + at(y0 + 1, x0 + 1) * ax) * ay;
    }
    return out;
  };
}

/**
 * On an opaque backdrop the traced bends cannot be trusted alone (anti-aliasing and JPEG noise bend them), so a
 * corner is sharpened only when the source pixels around it are better explained by the sharp corner than by the
 * traced rounding. Each source pixel's coverage by the path is measured both ways (8x8 samples, the cap toggled for
 * the sharp corner) and compared with the pixel's own mix between the path's ink and the colour outside it. The
 * label map cannot decide this: its upsampling rounds every corner, convex and concave, by about a source pixel.
 */
function sourceCheck(plates: readonly PlacedPlate[]): CornerCheck | null {
  const source = plates.find((plate) => plate.source !== undefined)?.source;
  if (source === undefined) return null;
  const { rgba, width, height } = source;
  return (fill, cap, inside) => {
    const ink = parseFill(fill);
    if (ink === null || cap.length < 3) return false;
    const xs = cap.map((point) => point.x);
    const ys = cap.map((point) => point.y);
    const left = Math.max(0, Math.floor(Math.min(...xs)) - REACH);
    const right = Math.min(width - 1, Math.floor(Math.max(...xs)) + REACH);
    const top = Math.max(0, Math.floor(Math.min(...ys)) - REACH);
    const bottom = Math.min(height - 1, Math.floor(Math.max(...ys)) + REACH);
    const pixels: { at: number; round: number; sharp: number }[] = [];
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        let round = 0;
        let sharp = 0;
        for (let sy = 0; sy < SAMPLES; sy += 1) {
          for (let sx = 0; sx < SAMPLES; sx += 1) {
            const px = x + (sx + 0.5) / SAMPLES;
            const py = y + (sy + 0.5) / SAMPLES;
            const covered = inside(px, py);
            if (covered) round += 1;
            if (covered !== insidePolygon(cap, px, py)) sharp += 1;
          }
        }
        pixels.push({ at: (y * width + x) * 4, round: round / SAMPLES ** 2, sharp: sharp / SAMPLES ** 2 });
      }
    }
    // The colour outside the path here: the mean of nearby pixels neither version covers.
    const outside = [0, 0, 0];
    let outsideCount = 0;
    for (const pixel of pixels) {
      if (pixel.round > 0 || pixel.sharp > 0) continue;
      for (let channel = 0; channel < 3; channel += 1) outside[channel]! += rgba[pixel.at + channel] ?? 0;
      outsideCount += 1;
    }
    if (outsideCount === 0) return false;
    const away = outside.map((sum) => sum / outsideCount);
    const span = ink.map((value, channel) => value - away[channel]!);
    const spanSquared = span.reduce((sum, value) => sum + value * value, 0);
    if (spanSquared < MIN_CONTRAST ** 2) return false;
    let roundError = 0;
    let sharpError = 0;
    for (const pixel of pixels) {
      if (pixel.round === pixel.sharp) continue;
      let dot = 0;
      for (let channel = 0; channel < 3; channel += 1) dot += ((rgba[pixel.at + channel] ?? 0) - away[channel]!) * span[channel]!;
      const coverage = Math.max(0, Math.min(1, dot / spanSquared));
      roundError += (coverage - pixel.round) ** 2;
      sharpError += (coverage - pixel.sharp) ** 2;
    }
    return sharpError < SHARP_MARGIN * roundError;
  };
}

const MIN_CHECKED_SIDE = 96;
/** Source pixels searched around a cap, beyond its bounds. */
const REACH = 2;
const SAMPLES = 8;
/** Sharp must explain the pixels clearly better than the rounding: near ties flipped round corners (tw-apple-128-q60, om-gear-256-white, gl-figma-128-white). */
const SHARP_MARGIN = 0.75;
/** Ink and outside colours closer than this (RGB distance) cannot be told apart by coverage. */
const MIN_CONTRAST = 48;

function parseFill(fill: string): readonly [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(fill);
  if (match?.[1] === undefined) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function insidePolygon(points: readonly { readonly x: number; readonly y: number }[], x: number, y: number): boolean {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const a = points[index];
    const b = points[previous];
    if (a === undefined || b === undefined) continue;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function assembleTrace(
  svgs: readonly string[],
  plates: readonly PlacedPlate[],
  width: number,
  height: number,
  preset: TracePreset,
  droppedColor: string | null,
  removeBackground: boolean,
  smoothness: number,
  corner: number,
  stacking: Stacking
): string {
  const fitted = mergePlates(svgs, plates, width, height, droppedColor, removeBackground);
  if (preset === "logo" || preset === "icon") return groupPathsByFill(relaxPaths(fitted, 0.15));
  const stroke = stacking === "cutout" ? 2 : 0.8;
  return groupPathsByFill(sealGaps(fairPaths(fitted, { smoothness, cornerDegrees: corner }), stroke));
}
