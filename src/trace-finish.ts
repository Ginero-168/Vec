import { fairPaths, relaxPaths } from "./edit.ts";
import { dropCanvasBackground, dropFill, fitShapes, groupPathsByFill, sealGaps } from "./score.ts";
import { scaleSvg, translateSvg } from "./svg-scale.ts";
import type { Stacking, TracePreset } from "./trace.ts";

export type PlacedPlate = {
  readonly scale: number;
  readonly originX: number;
  readonly originY: number;
  readonly borderColor: string | null;
  readonly preservePaths?: boolean;
};

const SHAPE = /<path\b[^>]*\/>|<path\b[^>]*>[\s\S]*?<\/path>|<circle\b[^>]*\/>|<ellipse\b[^>]*\/>|<rect\b[^>]*\/>/gi;

export function mergePlates(
  svgs: readonly string[],
  plates: readonly PlacedPlate[],
  width: number,
  height: number,
  droppedColor: string | null,
  removeBackground: boolean
): string {
  const drawings: string[] = [];
  for (let index = 0; index < svgs.length; index += 1) {
    const plate = plates[index];
    const svg = svgs[index];
    if (plate === undefined || svg === undefined) continue;
    let next = scaleSvg(svg, 1 / plate.scale);
    if (droppedColor !== null) next = dropFill(next, droppedColor);
    if (removeBackground && plate.preservePaths !== true) next = dropCanvasBackground(next, plate.borderColor);
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
  if (plates.some((plate) => plate.preservePaths)) return merged;
  return fitShapes(merged);
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
  if (preset === "logo" || preset === "icon") {
    if (plates.some((plate) => plate.preservePaths)) return groupPathsByFill(fitted);
    return groupPathsByFill(relaxPaths(fitted, 0.15));
  }
  const stroke = stacking === "cutout" ? 2 : 0.8;
  return groupPathsByFill(sealGaps(fairPaths(fitted, { smoothness, cornerDegrees: corner }), stroke));
}
