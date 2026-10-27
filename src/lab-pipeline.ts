import { fairPaths, relaxPaths } from "./edit.ts";
import { flatPlates } from "./flat-trace.ts";
import { controlsFor, type LabControls } from "./lab-model.ts";
import { punchRgba, revealSentinel } from "./punch-rgba.ts";
import { dropCanvasBackground, dropFill, fitShapes, groupPathsByFill, sealGaps } from "./score.ts";
import { segmentBackdropStage, segmentColorStage, type SegmentColorStage } from "./segment.ts";
import { mergePlates, type PlacedPlate } from "./trace-finish.ts";

export const LAB_STEPS = ["capture", "colors", "backdrop", "punch", "trace", "fit", "fair", "seal"] as const;
export type LabStepId = (typeof LAB_STEPS)[number];

export type LabRasterStages = {
  readonly mode: LabControls["mode"];
  readonly colors: Uint8Array;
  readonly backdrop: Uint8Array;
  readonly punchInput: Uint8Array;
  readonly punch: Uint8Array;
  readonly traceInput: Uint8Array;
  readonly droppedColor: string | null;
  readonly spread: number;
  readonly paletteSize: number;
  readonly segmentation: SegmentColorStage | null;
};

export type LabVectorStages = {
  readonly trace: string;
  readonly fitted: string;
  readonly faired: string;
  readonly sealed: string;
};

export type ControlStep = {
  readonly field: keyof LabControls;
  readonly step: LabStepId;
};

export const CONTROL_STEPS: readonly ControlStep[] = [
  { field: "mode", step: "colors" },
  { field: "maxColors", step: "colors" },
  { field: "snapBlends", step: "colors" },
  { field: "speckArea", step: "colors" },
  { field: "removeBackground", step: "backdrop" },
  { field: "backdropSpread", step: "backdrop" },
  { field: "opaqueAt", step: "punch" },
  { field: "traceColors", step: "trace" },
  { field: "lockPalette", step: "trace" },
  { field: "colorPrecision", step: "trace" },
  { field: "filterSpeckle", step: "trace" },
  { field: "clustering", step: "trace" },
  { field: "watershedDetail", step: "trace" },
  { field: "simplify", step: "trace" },
  { field: "stacking", step: "trace" },
  { field: "dropPlate", step: "fit" },
  { field: "fitGeometry", step: "fit" },
  { field: "smoothness", step: "fair" },
  { field: "corner", step: "fair" },
  { field: "seal", step: "seal" },
  { field: "sealWidth", step: "seal" }
];

export function earliestChangedStep(previous: LabControls, next: LabControls): LabStepId {
  let earliest = LAB_STEPS.length - 1;
  for (const control of CONTROL_STEPS) {
    if (previous[control.field] !== next[control.field]) {
      const stepIndex = LAB_STEPS.indexOf(control.step);
      earliest = Math.min(earliest, stepIndex);
    }
  }
  return LAB_STEPS[earliest] ?? "seal";
}

export function buildLabRasterStages(
  source: Uint8Array,
  width: number,
  height: number,
  controls: LabControls,
  previous: LabRasterStages | null = null,
  from: LabStepId = "colors"
): LabRasterStages {
  if (controls.mode === "logo" || controls.mode === "icon") {
    if (previous?.mode === controls.mode && LAB_STEPS.indexOf(from) > LAB_STEPS.indexOf("colors")) return previous;
    const colors = source;
    return {
      mode: controls.mode,
      colors,
      backdrop: colors,
      punchInput: source,
      punch: colors,
      traceInput: source,
      droppedColor: null,
      spread: 0,
      paletteSize: 0,
      segmentation: null
    };
  }

  const fromIndex = LAB_STEPS.indexOf(from);
  const sameMode = previous?.mode === controls.mode;
  const canReuseColors = sameMode && previous?.segmentation !== null && previous?.segmentation !== undefined && fromIndex > LAB_STEPS.indexOf("colors");
  const segmentation = canReuseColors && previous !== null
    ? previous.segmentation
    : segmentColorStage(source, width, height, {
      mode: controls.mode,
      maxColors: controls.maxColors,
      snapBlends: controls.snapBlends,
      speckArea: controls.speckArea,
      removeBackground: false,
      opaqueAt: controlsFor(controls.mode).opaqueAt
    });
  const colors = segmentation.colors;
  const canReuseBackdrop = sameMode && previous !== null && fromIndex > LAB_STEPS.indexOf("backdrop");
  const backdropStage = canReuseBackdrop
    ? { backdrop: previous.backdrop, punchInput: previous.punchInput }
    : segmentBackdropStage(source, width, height, segmentation, controls.removeBackground, controls.backdropSpread);
  const backdrop = backdropStage.backdrop;
  const punchInput = backdropStage.punchInput;
  const spread = segmentation.spread;
  const paletteSize = segmentation.palette.length;
  const canReusePunch = sameMode && previous !== null && fromIndex > LAB_STEPS.indexOf("punch");
  if (canReusePunch && previous !== null) return previous;

  const punched = punchRgba(punchInput, width, height, controls.opaqueAt);
  return {
    mode: controls.mode,
    colors,
    backdrop,
    punchInput,
    punch: revealSentinel(punched.rgba, punched.droppedColor),
    traceInput: punched.rgba,
    droppedColor: punched.droppedColor,
    spread,
    paletteSize,
    segmentation
  };
}

export function flatRasterStages(mode: LabControls["mode"], source: Uint8Array, colors: Uint8Array): LabRasterStages {
  return {
    mode,
    colors,
    backdrop: colors,
    punchInput: source,
    punch: colors,
    traceInput: source,
    droppedColor: null,
    spread: 0,
    paletteSize: 0,
    segmentation: null
  };
}

export function fitLabVector(svg: string, controls: LabControls, droppedColor: string | null, borderColor: string | null): string {
  let fitted = svg;
  if (droppedColor !== null) fitted = dropFill(fitted, droppedColor);
  if (controls.dropPlate) fitted = dropCanvasBackground(fitted, borderColor);
  if (controls.fitGeometry) fitted = fitShapes(fitted);
  return fitted;
}

export function fairLabVector(fitted: string, controls: LabControls): string {
  const defaults = controlsFor(controls.mode);
  if ((controls.mode === "logo" || controls.mode === "icon") && controls.smoothness === defaults.smoothness && controls.corner === defaults.corner) {
    return relaxPaths(fitted, 0.15);
  }
  return fairPaths(fitted, { smoothness: controls.smoothness, cornerDegrees: controls.corner });
}

export function sealLabVector(faired: string, controls: LabControls): string {
  const sealed = controls.seal ? sealGaps(faired, controls.sealWidth) : faired;
  return groupPathsByFill(sealed);
}

export function styleLabVectors(
  svg: string,
  controls: LabControls,
  droppedColor: string | null,
  borderColor: string | null = null
): { readonly fitted: string; readonly faired: string; readonly sealed: string } {
  const fitted = fitLabVector(svg, controls, droppedColor, borderColor);
  if (controls.mode === "logo" || controls.mode === "icon") {
    return { fitted, faired: fitted, sealed: groupPathsByFill(fitted) };
  }
  const faired = fairLabVector(fitted, controls);
  const sealed = sealLabVector(faired, controls);
  return { fitted, faired, sealed };
}

export function vectorStagesFromPlan(
  svgs: readonly string[],
  plates: readonly PlacedPlate[],
  width: number,
  height: number,
  droppedColor: string | null,
  controls: LabControls
): LabVectorStages {
  const trace = mergePlates(svgs, plates, width, height, null, false, false);
  const fitted = mergePlates(svgs, plates, width, height, droppedColor, controls.dropPlate, controls.fitGeometry);
  const faired = fairLabVector(fitted, controls);
  const sealed = sealLabVector(faired, controls);
  return { trace, fitted, faired, sealed };
}

export function flatPreviewFromPlates(plates: ReturnType<typeof flatPlates>, width: number, height: number): Uint8Array {
  const preview = new Uint8Array(width * height * 4);
  for (const plate of plates) {
    for (let y = 0; y < plate.sourceHeight; y += 1) {
      for (let x = 0; x < plate.sourceWidth; x += 1) {
        const sourceOffset = ((y * 8 + 4) * plate.width + x * 8 + 4) * 4;
        const targetOffset = ((plate.originY + y) * width + plate.originX + x) * 4;
        preview[targetOffset] = plate.rgba[sourceOffset] ?? 0;
        preview[targetOffset + 1] = plate.rgba[sourceOffset + 1] ?? 0;
        preview[targetOffset + 2] = plate.rgba[sourceOffset + 2] ?? 0;
        preview[targetOffset + 3] = plate.rgba[sourceOffset + 3] ?? 0;
      }
    }
  }
  return preview;
}
