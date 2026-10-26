export type TracePreset = "logo" | "icon" | "photo";
export type Stacking = "cutout" | "stacked";

export type TraceRequest = {
  readonly preset: TracePreset;
  readonly maxColors: number;
  readonly smoothness: number;
  readonly removeBackground: boolean;
  readonly stacking: Stacking;
};

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
  if (request.preset === "photo") {
    args.push("--preset", "photo", "--color-precision", "6");
  } else if (request.preset === "icon") {
    args.push("--preset", "poster", "--color-precision", "5", "--filter-speckle", "2");
  } else {
    args.push("--preset", "poster", "--color-precision", "6", "--filter-speckle", "2");
  }
  return args;
}
