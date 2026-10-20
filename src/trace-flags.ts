// Flag choice measured on the balloon image in Illustrator 30.8.2 (perf/offload-trace):
// stacked + speckle, with colour precision chosen from the palette size.
// 8 colours uses 4 bits. That run had 0% gap pixels. cutout left about 6.3%.
export type TracePreset = "logo" | "icon" | "photo";

export function colorPrecision(maxColors: number): number {
  if (maxColors <= 4) return 3;
  if (maxColors <= 10) return 4;
  if (maxColors <= 20) return 5;
  return 6;
}

export function vtracerArguments(input: {
  readonly pngPath: string;
  readonly svgPath: string;
  readonly preset: TracePreset;
  readonly maxColors: number;
  readonly simplify: number;
}): string[] {
  const args = [input.pngPath, input.svgPath];
  if (input.preset === "photo") {
    args.push("--preset", "photo", "--max-colors", String(input.maxColors));
  } else {
    args.push("--preset", "poster", "--hierarchical", "stacked", "--max-colors", String(input.maxColors));
    if (input.preset === "icon") args.push("--mode", "polygon");
  }
  args.push("--filter-speckle", input.preset === "photo" ? "8" : "16");
  args.push("--color-precision", String(colorPrecision(input.maxColors)));
  if (input.simplify > 0) args.push("--simplify", String(input.simplify));
  args.push("--optimize", "1");
  return args;
}
