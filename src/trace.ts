export const TRACE_PRESETS = ["logo", "icon", "photo", "poster"] as const;
export type TracePreset = (typeof TRACE_PRESETS)[number];
export type Stacking = "cutout" | "stacked";

export type TraceRequest = {
  readonly preset: TracePreset;
  readonly maxColors: number;
  readonly smoothness: number;
  readonly removeBackground: boolean;
  readonly stacking: Stacking;
  readonly palette?: readonly string[];
  readonly colorPrecision?: number;
  readonly filterSpeckle?: number;
  readonly clustering?: "watershed" | "off";
  readonly watershedDetail?: number;
  readonly simplify?: number;
};

export function presetDefaults(preset: TracePreset): {
  readonly maxColors: number;
  readonly smoothness: number;
  readonly corner: number;
  readonly removeBackground: boolean;
  readonly stacking: Stacking;
} {
  if (preset === "photo") return { maxColors: 48, smoothness: 2, corner: 20, removeBackground: false, stacking: "stacked" };
  if (preset === "poster") return { maxColors: 10, smoothness: 2.2, corner: 16, removeBackground: false, stacking: "stacked" };
  if (preset === "icon") return { maxColors: 8, smoothness: 2, corner: 55, removeBackground: true, stacking: "cutout" };
  return { maxColors: 0, smoothness: 2.4, corner: 35, removeBackground: true, stacking: "cutout" };
}

export function simplifyTolerance(smoothness: number): number {
  const clamped = Math.min(3, Math.max(0, smoothness));
  const tolerance = 2.2 - clamped * 0.75;
  return Math.round(Math.max(0.15, tolerance) * 100) / 100;
}

/** VTRACER_BIN overrides the bundled binary so Linux CI can point at its own build. */
export function resolveVtracer(fallback: string): string {
  const override = process.env.VTRACER_BIN?.trim();
  return override ? override : fallback;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function vtracerArguments(input: string, output: string, request: TraceRequest): string[] {
  const simplify = request.simplify ?? simplifyTolerance(request.smoothness);
  const args = [
    input,
    output,
    "--mode",
    "spline",
    "--optimize",
    "1",
    "--hierarchical",
    request.stacking,
    "--simplify",
    Math.min(2.5, Math.max(0.15, simplify)).toFixed(2)
  ];
  if (request.maxColors > 0) args.push("--max-colors", String(Math.round(request.maxColors)));
  if (request.palette !== undefined && request.palette.length > 0 && request.palette.length <= 32) {
    args.push("--palette", request.palette.join(","));
  }
  const precision = request.colorPrecision ?? (request.preset === "photo" ? 8 : request.preset === "poster" ? 4 : request.preset === "icon" ? 5 : 6);
  const speckle = request.filterSpeckle ?? (request.preset === "photo" ? 1 : 0);
  args.push("--preset", request.preset === "photo" ? "photo" : "poster", "--color-precision", String(clampInt(precision, 1, 8)), "--filter-speckle", String(clampInt(speckle, 0, 128)));
  const watershed = request.clustering === "watershed" || (request.clustering === undefined && request.preset === "photo");
  if (watershed) args.push("--clustering", "watershed", "--watershed-detail", String(clampInt(request.watershedDetail ?? 128, 1, 512)));
  return args;
}
