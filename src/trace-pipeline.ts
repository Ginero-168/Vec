import { fairPaths, relaxPaths } from "./edit.ts";
import { cornerColor, flatPlates, flatPlatesAsync, type FlatPlate } from "./flat-trace.ts";
import { controlsFor, paletteFromRaster, traceRequest, type LabControls } from "./lab-model.ts";
import { buildLabRasterStages, buildLabRasterStagesAsync, flatPreviewFromPlates, flatRasterStages, vectorStagesFromPlan, type LabRasterStages, type LabStepId, type PipelineProgress } from "./lab-pipeline.ts";
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
  readonly rasterStages?: LabRasterStages;
};

export function planTrace(
  source: Buffer,
  settings: PipelineSettings,
  controls?: LabControls,
  previousStages: LabRasterStages | null = null,
  from: LabStepId = "colors",
  onProgress?: PipelineProgress
): TracePlan | null {
  const decoded = readRgbaPng(source);
  if (decoded === null) return null;
  if (controls !== undefined) {
    if (settings.preset === "logo" || settings.preset === "icon") {
      onProgress?.("colors", 0);
      const plan = planFlat(decoded.rgba, decoded.width, decoded.height, settings, controls, undefined, (fraction) => onProgress?.("colors", fraction * 0.95));
      onProgress?.("colors", 1);
      onProgress?.("backdrop", 1);
      onProgress?.("punch", 1);
      return plan;
    }
    const rasterStages = buildLabRasterStages(decoded.rgba, decoded.width, decoded.height, controls, previousStages, from, onProgress);
    return planSegmentedWithControls(decoded.rgba, decoded.width, decoded.height, settings, controls, rasterStages);
  }
  if (settings.preset === "logo" || settings.preset === "icon") return planFlat(decoded.rgba, decoded.width, decoded.height, settings);
  return planSegmented(decoded.rgba, decoded.width, decoded.height, settings);
}

export async function planTraceAsync(
  source: Buffer,
  settings: PipelineSettings,
  controls?: LabControls,
  previousStages: LabRasterStages | null = null,
  from: LabStepId = "colors",
  onProgress?: PipelineProgress,
  shouldCancel?: () => boolean
): Promise<TracePlan | null> {
  if (shouldCancel?.() === true) throw new Error("ยกเลิกแล้ว");
  const decoded = readRgbaPng(source);
  if (decoded === null) return null;
  if (controls === undefined) {
    return planTrace(source, settings, controls, previousStages, from, onProgress);
  }
  if (settings.preset !== "logo" && settings.preset !== "icon") {
    const stages = await buildLabRasterStagesAsync(decoded.rgba, decoded.width, decoded.height, controls, previousStages, from, onProgress, shouldCancel);
    if (shouldCancel?.() === true) throw new Error("ยกเลิกแล้ว");
    return planSegmentedWithControls(decoded.rgba, decoded.width, decoded.height, settings, controls, stages);
  }
  onProgress?.("colors", 0);
  const plates = await flatPlatesAsync(decoded.rgba, decoded.width, decoded.height, settings.maxColors, undefined,
    (fraction) => onProgress?.("colors", fraction * 0.95), shouldCancel);
  if (shouldCancel?.() === true) throw new Error("ยกเลิกแล้ว");
  const plan = planFlat(decoded.rgba, decoded.width, decoded.height, settings, controls, plates);
  onProgress?.("colors", 1);
  onProgress?.("backdrop", 1);
  onProgress?.("punch", 1);
  return plan;
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

export function finishTrace(svgs: readonly string[], plan: TracePlan, settings: PipelineSettings, controls?: LabControls): string {
  if (controls !== undefined) return vectorStagesFromPlan(svgs, plan.plates, plan.width, plan.height, plan.droppedColor, controls).sealed;
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

export function traceRasterWithControls(
  source: Buffer,
  controls: LabControls,
  tracePlate: (png: Buffer, request: TraceRequest) => string
): string | null {
  const settings = settingsFromControls(controls);
  const plan = planTrace(source, settings, controls);
  if (plan === null) return null;
  return finishTrace(plan.plates.map((plate) => tracePlate(plate.png, plate.request)), plan, settings, controls);
}

export function vectorStagesForPlan(svgs: readonly string[], plan: TracePlan, controls: LabControls, onProgress?: PipelineProgress) {
  return vectorStagesFromPlan(svgs, plan.plates, plan.width, plan.height, plan.droppedColor, controls, onProgress);
}

export function settingsFromControls(controls: LabControls): PipelineSettings {
  return {
    preset: controls.mode,
    maxColors: controls.maxColors,
    smoothness: controls.smoothness,
    corner: controls.corner,
    removeBackground: controls.removeBackground,
    stacking: controls.stacking
  };
}

export function replanTracePlan(plan: TracePlan, controls: LabControls): TracePlan {
  const settings = settingsFromControls(controls);
  if (controls.mode === "logo" || controls.mode === "icon") {
    return {
      ...plan,
      plates: plan.plates.map((plate) => ({
        ...plate,
        request: flatRequestForControls(settings, plate.request.palette ?? [], plate.scale, controls)
      }))
    };
  }
  const stages = plan.rasterStages;
  if (stages === undefined) return plan;
  const palette = cappedPalette(paletteFromRaster(stages.traceInput, stages.droppedColor), stages.droppedColor);
  const request = { ...traceRequest(controls, palette), removeBackground: settings.removeBackground };
  return { ...plan, plates: plan.plates.map((plate) => ({ ...plate, request })) };
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

function planFlat(
  rgba: Uint8Array,
  width: number,
  height: number,
  settings: PipelineSettings,
  controls?: LabControls,
  preparedPlates?: readonly FlatPlate[],
  onProgress?: (fraction: number) => void
): TracePlan {
  const flat = preparedPlates ?? flatPlates(rgba, width, height, settings.maxColors, undefined, onProgress);
  const plates = flat.map((plate) => ({
      png: encodeRgbaPng(plate.width, plate.height, plate.rgba),
      scale: plate.scale,
      originX: plate.originX,
      originY: plate.originY,
      borderColor: plate.borderColor,
      request: controls === undefined
        ? flatRequest(settings, plate.palette, plate.scale)
        : flatRequestForControls(settings, plate.palette, plate.scale, controls)
    }));
  const rasterStages = controls === undefined ? undefined : flatRasterStages(controls.mode, rgba, flatPreviewFromPlates([...flat], width, height));
  return {
    width,
    height,
    droppedColor: null,
    plates,
    ...(rasterStages === undefined ? {} : { rasterStages })
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

function flatRequestForControls(settings: PipelineSettings, palette: readonly string[], scale: number, controls: LabControls): TraceRequest {
  const request = flatRequest(settings, palette, scale);
  const defaults = controlsFor(controls.mode);
  const paletteChanged = controls.lockPalette !== defaults.lockPalette || controls.traceColors !== defaults.traceColors;
  const traceSettings = paletteChanged ? traceRequest(controls, palette) : null;
  return {
    ...request,
    ...(traceSettings === null ? {} : { maxColors: traceSettings.maxColors, palette: traceSettings.palette }),
    ...(controls.colorPrecision === defaults.colorPrecision ? {} : { colorPrecision: controls.colorPrecision }),
    ...(controls.filterSpeckle === defaults.filterSpeckle ? {} : { filterSpeckle: controls.filterSpeckle }),
    ...(controls.clustering === defaults.clustering ? {} : { clustering: controls.clustering }),
    ...(controls.watershedDetail === defaults.watershedDetail ? {} : { watershedDetail: controls.watershedDetail }),
    ...(controls.simplify === defaults.simplify ? {} : { simplify: controls.simplify }),
    stacking: controls.stacking === defaults.stacking ? request.stacking : controls.stacking
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
  const segmented = segmentRaster(rgba, width, height, {
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

function planSegmentedWithControls(
  rgba: Uint8Array,
  width: number,
  height: number,
  settings: PipelineSettings,
  controls: LabControls,
  stages: LabRasterStages
): TracePlan {
  const png = encodeRgbaPng(width, height, stages.traceInput);
  const palette = cappedPalette(paletteFromRaster(stages.traceInput, stages.droppedColor), stages.droppedColor);
  const request = traceRequest(controls, palette);
  return {
    width,
    height,
    droppedColor: stages.droppedColor,
    rasterStages: stages,
    plates: [{
      png,
      scale: 1,
      originX: 0,
      originY: 0,
      borderColor: cornerColor(rgba, width, height),
      request: {
        ...request,
        removeBackground: settings.removeBackground
      }
    }]
  };
}
