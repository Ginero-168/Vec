export type TracePreset = "logo" | "icon" | "photo" | "poster";
export type Stacking = "cutout" | "stacked";

export type TraceRequest = {
  readonly preset: TracePreset;
  readonly maxColors: number;
  readonly smoothness: number;
  readonly removeBackground: boolean;
  readonly stacking: Stacking;
  readonly palette?: readonly string[];
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

export function vtracerArguments(input: string, output: string, request: TraceRequest): string[] {
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
    simplifyTolerance(request.smoothness).toFixed(2)
  ];
  if (request.maxColors > 0) args.push("--max-colors", String(request.maxColors));
  if (request.palette !== undefined && request.palette.length > 0 && request.palette.length <= 32) {
    args.push("--palette", request.palette.join(","));
  }
  if (request.preset === "photo") {
    args.push("--preset", "photo", "--clustering", "watershed", "--watershed-detail", "128", "--color-precision", "8", "--filter-speckle", "1");
  } else if (request.preset === "poster") {
    args.push("--preset", "poster", "--color-precision", "4", "--filter-speckle", "0");
  } else if (request.preset === "icon") {
    args.push("--preset", "poster", "--color-precision", "5", "--filter-speckle", "0");
  } else {
    args.push("--preset", "poster", "--color-precision", "6", "--filter-speckle", "0");
  }
  return args;
}
