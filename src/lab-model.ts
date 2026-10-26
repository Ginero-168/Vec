import { fairPaths } from "./edit.ts";
import { dropCanvasBackground, dropFill, fitShapes, groupPathsByFill, sealGaps } from "./score.ts";
import { presetDefaults, simplifyTolerance, type Stacking, type TracePreset, type TraceRequest } from "./trace.ts";

export type LabControls = {
  readonly mode: TracePreset;
  readonly maxColors: number;
  readonly snapBlends: boolean;
  readonly speckArea: number;
  readonly removeBackground: boolean;
  readonly backdropSpread: number;
  readonly opaqueAt: number;
  readonly traceColors: number;
  readonly lockPalette: boolean;
  readonly colorPrecision: number;
  readonly filterSpeckle: number;
  readonly clustering: "watershed" | "off";
  readonly watershedDetail: number;
  readonly simplify: number;
  readonly stacking: Stacking;
  readonly dropPlate: boolean;
  readonly fitGeometry: boolean;
  readonly smoothness: number;
  readonly corner: number;
  readonly seal: boolean;
  readonly sealWidth: number;
};

const SPECK: Readonly<Record<TracePreset, number>> = { logo: 18, icon: 12, photo: 6, poster: 28 };
const PRECISION: Readonly<Record<TracePreset, number>> = { logo: 6, icon: 5, photo: 8, poster: 4 };

export function controlsFor(mode: TracePreset): LabControls {
  const defaults = presetDefaults(mode);
  const segmentColors = Math.min(32, Math.max(2, defaults.maxColors || (mode === "photo" ? 32 : mode === "poster" ? 10 : 8)));
  return {
    mode,
    maxColors: segmentColors,
    snapBlends: mode === "logo" || mode === "icon",
    speckArea: SPECK[mode],
    removeBackground: defaults.removeBackground,
    backdropSpread: 22,
    opaqueAt: mode === "photo" || mode === "poster" ? 128 : 200,
    traceColors: defaults.maxColors > 0 ? defaults.maxColors : segmentColors,
    lockPalette: true,
    colorPrecision: PRECISION[mode],
    filterSpeckle: mode === "photo" ? 1 : 0,
    clustering: mode === "photo" ? "watershed" : "off",
    watershedDetail: 128,
    simplify: simplifyTolerance(defaults.smoothness),
    stacking: defaults.stacking,
    dropPlate: defaults.removeBackground,
    fitGeometry: true,
    smoothness: defaults.smoothness,
    corner: defaults.corner,
    seal: true,
    sealWidth: defaults.stacking === "cutout" ? 2 : 0.8
  };
}

export function traceRequest(controls: LabControls, palette: readonly string[]): TraceRequest {
  const locked = controls.lockPalette && palette.length > 0;
  return {
    preset: controls.mode,
    maxColors: locked ? 0 : controls.traceColors,
    smoothness: 0,
    removeBackground: controls.removeBackground,
    stacking: controls.stacking,
    palette: locked ? palette.slice(0, 32) : undefined,
    colorPrecision: controls.colorPrecision,
    filterSpeckle: controls.filterSpeckle,
    clustering: controls.clustering,
    watershedDetail: controls.watershedDetail,
    simplify: controls.simplify
  };
}

export function paletteFromRaster(rgba: Uint8Array, ignore: string | null): string[] {
  const seen = new Set<string>();
  for (let index = 0; index < rgba.length; index += 4) {
    if ((rgba[index + 3] ?? 0) < 250) continue;
    const color = "#" + byte(rgba[index] ?? 0) + byte(rgba[index + 1] ?? 0) + byte(rgba[index + 2] ?? 0);
    if (color === ignore) continue;
    seen.add(color);
  }
  return [...seen].sort();
}

export function colorCount(rgba: Uint8Array): number {
  return paletteFromRaster(rgba, null).length;
}

export function transparentFraction(rgba: Uint8Array): number {
  if (rgba.length === 0) return 0;
  let clear = 0;
  const pixels = rgba.length / 4;
  for (let index = 3; index < rgba.length; index += 4) if ((rgba[index] ?? 255) === 0) clear += 1;
  return clear / pixels;
}

export function styleVectors(svg: string, controls: LabControls, droppedColor: string | null): { readonly fitted: string; readonly faired: string; readonly sealed: string } {
  let fitted = svg;
  if (droppedColor !== null) fitted = dropFill(fitted, droppedColor);
  if (controls.dropPlate) fitted = dropCanvasBackground(fitted);
  if (controls.fitGeometry) fitted = fitShapes(fitted);
  const faired = fairPaths(fitted, { smoothness: controls.smoothness, cornerDegrees: controls.corner });
  const sealed = groupPathsByFill(controls.seal ? sealGaps(faired, controls.sealWidth) : faired);
  return { fitted, faired, sealed };
}

function byte(value: number): string {
  return value.toString(16).padStart(2, "0");
}
