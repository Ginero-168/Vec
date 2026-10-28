import { controlsFor, type LabControls } from "./lab-model.ts";
import { TRACE_PRESETS, type TracePreset } from "./trace.ts";

export type PresetControlField = Exclude<keyof LabControls, "mode">;

export const PRESET_CONTROL_FIELDS = [
  "maxColors",
  "snapBlends",
  "speckArea",
  "removeBackground",
  "backdropSpread",
  "opaqueAt",
  "traceColors",
  "lockPalette",
  "colorPrecision",
  "filterSpeckle",
  "clustering",
  "watershedDetail",
  "simplify",
  "stacking",
  "dropPlate",
  "fitGeometry",
  "smoothness",
  "corner",
  "seal",
  "sealWidth"
] satisfies readonly PresetControlField[];

export const PRESET_PRESENTATION = [
  { preset: "logo", label: "โลโก้", detail: "สีแบน · ตัดพื้นหลัง", thumbnail: "img/presets/logo.svg" },
  { preset: "icon", label: "ไอคอน", detail: "ขอบคม · รูปทรงชัด", thumbnail: "img/presets/icon.svg" },
  { preset: "photo", label: "ภาพถ่าย", detail: "หลายสี · เก็บรายละเอียด", thumbnail: "img/presets/photo.svg" },
  { preset: "poster", label: "โปสเตอร์", detail: "สีจำกัด · เส้นเด่น", thumbnail: "img/presets/poster.svg" }
] as const satisfies readonly { readonly preset: (typeof TRACE_PRESETS)[number]; readonly label: string; readonly detail: string; readonly thumbnail: string }[];

export type PresetState =
  | { readonly kind: "unselected" }
  | { readonly kind: "selected"; readonly preset: TracePreset; readonly defaults: LabControls; readonly controls: LabControls };
export type SelectedPresetState = Extract<PresetState, { readonly kind: "selected" }>;

export function emptyPresetState(): PresetState {
  return { kind: "unselected" };
}

export function selectPreset(preset: TracePreset): SelectedPresetState {
  const controls = controlsFor(preset);
  return { kind: "selected", preset, defaults: controls, controls };
}

export function updatePresetControls(state: PresetState, controls: LabControls): PresetState {
  if (state.kind === "unselected") return state;
  return { ...state, controls: { ...controls, mode: state.preset } };
}

export function modifiedPresetControls(state: PresetState): readonly PresetControlField[] {
  if (state.kind === "unselected") return [];
  return PRESET_CONTROL_FIELDS.filter((field) => state.controls[field] !== state.defaults[field]);
}

export function modifiedPresetControlCount(state: PresetState): number {
  return modifiedPresetControls(state).length;
}

export function resetPresetControl<K extends PresetControlField>(state: PresetState, field: K): PresetState {
  if (state.kind === "unselected") return state;
  return { ...state, controls: { ...state.controls, [field]: state.defaults[field] } };
}

export function resetPresetControls(state: PresetState): PresetState {
  if (state.kind === "unselected") return state;
  return { ...state, controls: state.defaults };
}

export function hasPresetEdits(state: PresetState): boolean {
  return modifiedPresetControlCount(state) > 0;
}
