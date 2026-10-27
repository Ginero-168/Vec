import { fairPaths, relaxPaths } from "./edit.ts";
import { cornerColor, flatPlates } from "./flat-trace.ts";
import { denoiseJpegArtifacts } from "./denoise.ts";
import { paletteFromRaster } from "./lab-model.ts";
import { encodeRgbaPng, punchTransparency, readRgbaPng } from "./png-alpha.ts";
import { dropCanvasBackground, dropFill, fitShapes, groupPathsByFill, sealGaps } from "./score.ts";
import { segmentRaster } from "./segment.ts";
import { scaleSvg } from "./svg-scale.ts";
import { assembleTrace, mergePlates, type PlacedPlate } from "./trace-finish.ts";
import { type Stacking, type TracePreset, type TraceRequest } from "./trace.ts";

export type PipelineSettings = {
  readonly preset: TracePreset;
  readonly maxColors: number;
  readonly smoothness: number;
  readonly corner: number;
  readonly removeBackground: boolean;
  readonly stacking: Stacking;
};

export type PlannedPlate = PlacedPlate & {
  readonly png: Buffer;
  readonly request: TraceRequest;
};

export type TracePlan = {
  readonly width: number;
  readonly height: number;
  readonly plates: readonly PlannedPlate[];
  readonly droppedColor: string | null;
};

export function planTrace(source: Buffer, settings: PipelineSettings): TracePlan | null {
  const decoded = readRgbaPng(source);
  if (decoded === null) return null;
  if (settings.preset === "logo" || settings.preset === "icon") return planFlat(decoded.rgba, decoded.width, decoded.height, settings);
  return planSegmented(decoded.rgba, decoded.width, decoded.height, settings);
}

export function fittedPlan(svgs: readonly string[], plan: TracePlan, removeBackground: boolean): string {
  return mergePlates(svgs, plan.plates, plan.width, plan.height, plan.droppedColor, removeBackground);
}

/** Plan, trace each plate, then fit and style. Poster runs segment → vtracer → fit → fair → seal. */
export function traceRaster(
  source: Buffer,
  settings: PipelineSettings,
  tracePlate: (png: Buffer, request: TraceRequest) => string
): string | null {
  const plan = planTrace(source, settings);
  if (plan === null) return null;
  return finishTrace(plan.plates.map((plate) => tracePlate(plate.png, plate.request)), plan, settings);
}

export function finishTrace(svgs: readonly string[], plan: TracePlan, settings: PipelineSettings): string {
  return assembleTrace(
    svgs,
    plan.plates,
    plan.width,
    plan.height,
    settings.preset,
    plan.droppedColor,
    settings.removeBackground,
    settings.smoothness,
    settings.corner,
    settings.stacking
  );
}

export function prepareTracePng(source: Buffer, settings: PipelineSettings): { readonly png: Buffer; readonly scale: number; readonly droppedColor: string | null; readonly palette: readonly string[] } {
  const plan = planTrace(source, settings);
  const plate = plan?.plates[0];
  if (plan === null || plate === undefined) return { png: source, scale: 1, droppedColor: null, palette: [] };
  return { png: plate.png, scale: plate.scale, droppedColor: plan.droppedColor, palette: plate.request.palette ?? [] };
}

export function fittedTraceSvg(svg: string, scale: number, droppedColor: string | null, settings: PipelineSettings, borderColor: string | null = null): string {
  let next = scaleSvg(svg, 1 / scale);
  if (droppedColor !== null) next = dropFill(next, droppedColor);
  if (settings.removeBackground) next = dropCanvasBackground(next, borderColor);
  return fitShapes(next);
}

export function styledTraceSvg(fitted: string, settings: PipelineSettings): string {
  if (settings.preset === "logo" || settings.preset === "icon") return groupPathsByFill(relaxPaths(fitted, 0.15));
  const stroke = settings.stacking === "cutout" ? 2 : 0.8;
  return groupPathsByFill(sealGaps(fairPaths(fitted, { smoothness: settings.smoothness, cornerDegrees: settings.corner }), stroke));
}

function planFlat(rgba: Uint8Array, width: number, height: number, settings: PipelineSettings): TracePlan {
  const plates = flatPlates(rgba, width, height, settings.maxColors);
  return {
    width,
    height,
    droppedColor: null,
    plates: plates.map((plate) => ({
      png: encodeRgbaPng(plate.width, plate.height, plate.rgba),
      scale: plate.scale,
      originX: plate.originX,
      originY: plate.originY,
      borderColor: plate.borderColor,
      request: flatRequest(settings, plate.palette, plate.scale)
    }))
  };
}

export function flatRequest(settings: PipelineSettings, palette: readonly string[], scale: number): TraceRequest {
  return {
    preset: settings.preset,
    maxColors: 0,
    smoothness: 0,
    removeBackground: settings.removeBackground,
    stacking: "stacked",
    palette: palette.slice(0, 32),
    colorPrecision: 8,
    filterSpeckle: Math.min(128, Math.floor(Math.sqrt(1.44) * scale)),
    clustering: "off",
    simplify: Math.round(0.3 * scale * 100) / 100
  };
}

/** Keep #ff00ff when a 32-color cap would otherwise slice it off. */
export function cappedPalette(colors: readonly string[], sentinel: string | null): string[] {
  const unique = [...new Set(colors.map((color) => color.toLowerCase()))];
  const mark = sentinel?.trim().toLowerCase() ?? "";
  if (!/^#[0-9a-f]{6}$/.test(mark) || !unique.includes(mark)) return unique.slice(0, 32);
  const rest = unique.filter((color) => color !== mark);
  return [...rest.slice(0, 31), mark];
}

function planSegmented(rgba: Uint8Array, width: number, height: number, settings: PipelineSettings): TracePlan {
  const segmentationSource = settings.preset === "photo" || settings.preset === "poster"
    ? denoiseJpegArtifacts(rgba, width, height)
    : rgba;
  const segmented = segmentRaster(segmentationSource, width, height, {
    mode: settings.preset,
    maxColors: settings.maxColors,
    removeBackground: settings.removeBackground,
    opaqueAt: settings.preset === "photo" || settings.preset === "poster" ? 128 : 200
  });
  const punched = punchTransparency(encodeRgbaPng(width, height, segmented), settings.preset === "photo" || settings.preset === "poster" ? 128 : 200);
  const decoded = readRgbaPng(punched.png);
  const palette = decoded === null ? [] : cappedPalette(paletteFromRaster(decoded.rgba, punched.droppedColor), punched.droppedColor);
  const locked = palette.length > 0;
  return {
    width,
    height,
    droppedColor: punched.droppedColor,
    plates: [
      {
        png: punched.png,
        scale: 1,
        originX: 0,
        originY: 0,
        borderColor: cornerColor(rgba, width, height),
        request: {
          preset: settings.preset,
          maxColors: locked ? 0 : settings.maxColors,
          smoothness: settings.smoothness,
          removeBackground: settings.removeBackground,
          stacking: settings.stacking,
          palette: locked ? palette : undefined
        }
      }
    ]
  };
}
