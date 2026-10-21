export type PresetName = "logo" | "icon" | "ui" | "illustration" | "photo";

export type PresetProfile = {
  readonly maxColors: number;
  /** OKLab distance below which two clusters merge. */
  readonly sensitivity: number;
  /** Low-chroma neighbors closer than this collapse into one region. */
  readonly smoothContrast: number;
  /** Turn, in radians, that stays a corner instead of a curve. */
  readonly cornerAngle: number;
  /** Smooth slider position, 0 (crisp) through 3 (very smooth). */
  readonly smooth: number;
};

export const PRESETS: Record<PresetName, PresetProfile> = {
  logo: { maxColors: 8, sensitivity: 0.06, smoothContrast: 0.07, cornerAngle: 0.9, smooth: 1.6 },
  icon: { maxColors: 6, sensitivity: 0.05, smoothContrast: 0.05, cornerAngle: 0.55, smooth: 0.4 },
  ui: { maxColors: 12, sensitivity: 0.04, smoothContrast: 0.075, cornerAngle: 0.6, smooth: 0.5 },
  illustration: { maxColors: 16, sensitivity: 0.05, smoothContrast: 0.055, cornerAngle: 0.75, smooth: 1.2 },
  photo: { maxColors: 24, sensitivity: 0.03, smoothContrast: 0.04, cornerAngle: 0.85, smooth: 1.4 }
};

export function isPresetName(value: string): value is PresetName {
  return value === "logo" || value === "icon" || value === "ui" || value === "illustration" || value === "photo";
}

export function presetProfile(value: string): PresetProfile {
  return isPresetName(value) ? PRESETS[value] : PRESETS.logo;
}

/** Map the 0–3 smooth slider onto a curve-fit tolerance in source pixels. */
export function curveError(smooth: number): number {
  const t = Math.min(3, Math.max(0, smooth)) / 3;
  return 0.2 + t * 1.3;
}

/**
 * Internal supersampling. Screenshots and icons gain a finer grid so coverage
 * can sit the boundary between pixels. Photos stay at 1×.
 */
export function chooseUpscale(width: number, height: number, preset: PresetName): number {
  const minor = Math.min(width, height);
  if (preset === "photo") return minor <= 400 ? 2 : 1;
  if (preset === "icon") return minor <= 700 ? 4 : 2;
  if (preset === "logo") return minor <= 400 ? 3 : minor <= 900 ? 2 : 1;
  if (preset === "ui") return minor <= 400 ? 3 : 2;
  return minor <= 400 ? 3 : minor <= 1200 ? 2 : 1;
}

/**
 * Smooth ramps become gradient fills for photographs, illustrations, and the
 * large low-contrast backgrounds of a UI screenshot. Logos and icons stay flat.
 */
export function gradientsDefault(preset: PresetName): boolean {
  return preset === "photo" || preset === "illustration" || preset === "ui";
}

/** Edge-preserving smoothing for JPEG blocks. Photographs opt in; flat logos do not. */
export function prefilterDefault(preset: PresetName): boolean {
  return preset === "photo";
}
