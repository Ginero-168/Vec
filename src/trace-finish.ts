import { fairPaths, relaxPaths, sharpenCorners } from "./edit.ts";
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
};

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
  return cutOut ? sharpenCorners(fitted, fillet, 35, curl) : fitted;
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
