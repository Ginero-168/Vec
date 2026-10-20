import * as childProcess from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { analyzeSvg, processSvg, selfCheckGeometry } from "./geometry";
import {
  areaDownscale,
  bilinear2x,
  detectPalette,
  gatedDenoise,
  gradientMagnitude,
  readPng,
  snapToPalette,
  writePng,
  type Raster
} from "./raster";

export type SpeedPreset = "fast" | "balanced" | "detail";
export type LegacyPreset = "legacy-logo" | "legacy-icon" | "legacy-photo";
export type PresetName = SpeedPreset | LegacyPreset;

export type EngineSpec = {
  readonly id: string;
  readonly legacy: boolean;
  readonly maxEdge: number;
  readonly denoise: "off" | "gated";
  readonly denoisePasses: number;
  readonly denoiseThreshold: number;
  readonly supersample: 1 | 2;
  readonly paletteMode: "auto" | "fixed" | "off";
  readonly paletteMin: number;
  readonly paletteCap: number;
  readonly paletteRule: "knee" | "rmse";
  readonly paletteRmse: number;
  readonly snapPalette: boolean;
  readonly passPalette: boolean;
  readonly vtracerPreset: "poster" | "photo" | "bw" | "none";
  readonly hierarchical: "stacked" | "cutout";
  readonly mode: "spline" | "polygon";
  readonly clustering: "color-cluster" | "watershed" | "bw";
  readonly filterSpeckle: number;
  readonly colorPrecision: number;
  readonly gradientStep: number;
  readonly cornerThreshold: number;
  readonly simplify: number;
  readonly optimize: 0 | 1 | 2;
  readonly pathPrecision: number;
  readonly adaptive: boolean;
  readonly weakGradient: number;
  readonly weakScale: number;
  readonly ellipseFit: boolean;
  readonly ellipseTolerance: number;
};

export type TraceReport = {
  readonly ok: true;
  readonly specId: string;
  readonly paletteSize: number;
  readonly palette: readonly string[];
  readonly triedK: readonly number[];
  readonly inertia: readonly number[];
  readonly workingWidth: number;
  readonly workingHeight: number;
  readonly preprocessMs: number;
  readonly vtracerMs: number;
  readonly postMs: number;
  readonly pipelineMs: number;
  readonly peakRssKb: number;
  readonly svgBytes: number;
  readonly paths: number;
  readonly nodes: number;
  readonly corners45: number;
  readonly fills: number;
  readonly args: readonly string[];
  readonly resolved: EngineSpec;
};

export const PRESET_UI: Record<SpeedPreset, { readonly colors: number; readonly simplify: number; readonly autoPalette: boolean }> = {
  fast: { colors: 16, simplify: 1.6, autoPalette: true },
  balanced: { colors: 16, simplify: 1.6, autoPalette: true },
  detail: { colors: 24, simplify: 1.4, autoPalette: true }
};

const SPEED: Record<SpeedPreset, Omit<EngineSpec, "paletteCap" | "simplify"> & { readonly paletteCap: number; readonly simplify: number }> = {
  fast: {
    id: "fast",
    legacy: false,
    maxEdge: 2109,
    denoise: "gated",
    denoisePasses: 2,
    denoiseThreshold: 34,
    supersample: 1,
    paletteMode: "auto",
    paletteMin: 2,
    paletteCap: 16,
    paletteRule: "rmse",
    paletteRmse: 0.02,
    snapPalette: true,
    passPalette: true,
    vtracerPreset: "poster",
    hierarchical: "stacked",
    mode: "spline",
    clustering: "color-cluster",
    filterSpeckle: 5,
    colorPrecision: 8,
    gradientStep: 48,
    cornerThreshold: 80,
    simplify: 1.6,
    optimize: 1,
    pathPrecision: 2,
    adaptive: true,
    weakGradient: 90,
    weakScale: 2.2,
    ellipseFit: true,
    ellipseTolerance: 0.9
  },
  balanced: {
    id: "balanced",
    legacy: false,
    maxEdge: 2109,
    denoise: "gated",
    denoisePasses: 2,
    denoiseThreshold: 34,
    supersample: 1,
    paletteMode: "auto",
    paletteMin: 2,
    paletteCap: 16,
    paletteRule: "rmse",
    paletteRmse: 0.02,
    snapPalette: true,
    passPalette: true,
    vtracerPreset: "poster",
    hierarchical: "stacked",
    mode: "spline",
    clustering: "color-cluster",
    filterSpeckle: 5,
    colorPrecision: 8,
    gradientStep: 48,
    cornerThreshold: 90,
    simplify: 1.6,
    optimize: 1,
    pathPrecision: 2,
    adaptive: true,
    weakGradient: 90,
    weakScale: 2.2,
    ellipseFit: true,
    ellipseTolerance: 0.9
  },
  detail: {
    id: "detail",
    legacy: false,
    maxEdge: 2800,
    denoise: "gated",
    denoisePasses: 1,
    denoiseThreshold: 28,
    supersample: 1,
    paletteMode: "auto",
    paletteMin: 2,
    paletteCap: 24,
    paletteRule: "rmse",
    paletteRmse: 0.016,
    snapPalette: true,
    passPalette: true,
    vtracerPreset: "poster",
    hierarchical: "stacked",
    mode: "spline",
    clustering: "color-cluster",
    filterSpeckle: 5,
    colorPrecision: 8,
    gradientStep: 48,
    cornerThreshold: 130,
    simplify: 1.4,
    optimize: 1,
    pathPrecision: 2,
    adaptive: true,
    weakGradient: 90,
    weakScale: 2.2,
    ellipseFit: true,
    ellipseTolerance: 0.9
  }
};

export function legacySpec(preset: LegacyPreset, maxColors: number, simplify: number): EngineSpec {
  return {
    id: preset,
    legacy: true,
    maxEdge: 0,
    denoise: "off",
    denoisePasses: 0,
    denoiseThreshold: 0,
    supersample: 1,
    paletteMode: "off",
    paletteMin: 2,
    paletteCap: maxColors,
    paletteRule: "knee",
    paletteRmse: 0.02,
    snapPalette: false,
    passPalette: false,
    vtracerPreset: preset === "legacy-photo" ? "photo" : "poster",
    hierarchical: preset === "legacy-photo" ? "stacked" : "cutout",
    mode: preset === "legacy-icon" ? "polygon" : "spline",
    clustering: "color-cluster",
    filterSpeckle: 0,
    colorPrecision: 6,
    gradientStep: 16,
    cornerThreshold: 60,
    simplify,
    optimize: 1,
    pathPrecision: 2,
    adaptive: false,
    weakGradient: 0,
    weakScale: 1,
    ellipseFit: false,
    ellipseTolerance: 1
  };
}

export function speedSpec(preset: SpeedPreset, maxColors: number, simplify: number, manualPalette: boolean): EngineSpec {
  const base = SPEED[preset];
  return {
    ...base,
    paletteMode: manualPalette ? "fixed" : "auto",
    paletteCap: maxColors,
    simplify
  };
}

export function parseSpec(raw: unknown): EngineSpec {
  if (raw === null || typeof raw !== "object") throw new Error("spec ต้องเป็น object");
  const record = raw as Record<string, unknown>;
  const preset = record["preset"];
  if (preset === "legacy-logo" || preset === "legacy-icon" || preset === "legacy-photo") {
    return legacySpec(preset, numberField(record, "maxColors", 8), numberField(record, "simplify", 1.5));
  }
  if (preset !== "fast" && preset !== "balanced" && preset !== "detail") throw new Error("preset ไม่ถูกต้อง");
  const manual = record["manualPalette"] === true;
  const base = speedSpec(preset, numberField(record, "maxColors", PRESET_UI[preset].colors), numberField(record, "simplify", PRESET_UI[preset].simplify), manual);
  return applyOverlay(base, record["overlay"]);
}

function numberField(record: Record<string, unknown>, key: string, fallback: number): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function applyOverlay(base: EngineSpec, overlay: unknown): EngineSpec {
  if (overlay === null || overlay === undefined) return base;
  if (typeof overlay !== "object") throw new Error("overlay ไม่ถูกต้อง");
  const next: EngineSpec = { ...base };
  const source = overlay as Record<string, unknown>;
  const assign = <K extends keyof EngineSpec>(key: K, value: EngineSpec[K]): void => {
    next[key] = value;
  };
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    assign(key as keyof EngineSpec, value as EngineSpec[keyof EngineSpec]);
  }
  return next;
}

function legacyArguments(input: string, output: string, spec: EngineSpec): string[] {
  const args = [input, output];
  if (spec.id === "legacy-photo") {
    args.push("--preset", "photo", "--max-colors", String(spec.paletteCap));
  } else {
    args.push("--preset", "poster", "--hierarchical", "cutout", "--max-colors", String(spec.paletteCap));
    if (spec.id === "legacy-icon") args.push("--mode", "polygon");
  }
  if (spec.simplify > 0) args.push("--simplify", String(roundNum(spec.simplify)));
  args.push("--optimize", "1");
  return args;
}

function roundNum(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function modernArguments(input: string, output: string, spec: EngineSpec, palette: readonly string[]): string[] {
  const scale = spec.supersample;
  const args = [input, output];
  if (spec.vtracerPreset !== "none") args.push("--preset", spec.vtracerPreset);
  if (spec.clustering !== "color-cluster") args.push("--clustering", spec.clustering);
  args.push("--hierarchical", spec.hierarchical, "--mode", spec.mode);
  args.push("--filter-speckle", String(Math.max(0, Math.min(128, Math.round(spec.filterSpeckle * scale)))));
  args.push("--color-precision", String(spec.colorPrecision));
  args.push("--gradient-step", String(spec.gradientStep));
  args.push("--corner-threshold", String(spec.cornerThreshold));
  if (spec.simplify > 0) args.push("--simplify", roundNum(spec.simplify * scale));
  args.push("--optimize", String(spec.optimize));
  args.push("--path-precision", String(spec.pathPrecision));
  if (spec.passPalette && palette.length > 0) args.push("--palette", palette.join(","));
  else if (spec.paletteMode === "fixed") args.push("--max-colors", String(spec.paletteCap));
  return args;
}

function runVtracer(
  binary: string,
  args: readonly string[],
  onChild: ((child: childProcess.ChildProcess) => void) | undefined
): Promise<{ ms: number; peakRssKb: number }> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const rssFile = path.join(os.tmpdir(), "vtracer-rss-" + process.pid + "-" + started);
    // The bench has no cancel handle, so GNU time can report the tracer's peak RSS.
    // The panel passes onChild and must kill vtracer itself.
    const timed = onChild === undefined && fs.existsSync("/usr/bin/time");
    const command = timed ? "/usr/bin/time" : binary;
    const commandArgs = timed ? ["-o", rssFile, "-f", "%M", binary, ...args] : args;
    const child = childProcess.spawn(command, commandArgs, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    onChild?.(child);
    let peak = 0;
    const timer = setInterval(() => {
      const pid = child.pid;
      if (pid === undefined) return;
      const targets = [pid];
      try {
        const children = fs.readFileSync("/proc/" + pid + "/task/" + pid + "/children", "utf8").trim().split(/\s+/);
        for (const entry of children) if (entry) targets.push(Number(entry));
      } catch (_) {
        // No children file on this kernel, or the process already exited.
      }
      for (const target of targets) {
        try {
          const status = fs.readFileSync("/proc/" + target + "/status", "utf8");
          const match = /VmHWM:\s+(\d+)/.exec(status);
          if (match?.[1]) peak = Math.max(peak, Number(match[1]));
        } catch (_) {
          // The process can exit between polls.
        }
      }
    }, 10);
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 4000) stderr += chunk.toString("utf8").slice(0, 4000 - stderr.length);
    });
    child.once("error", (error) => {
      clearInterval(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearInterval(timer);
      if (timed) {
        try {
          const text = fs.readFileSync(rssFile, "utf8").trim();
          const value = Number(text.split(/\s+/)[0]);
          if (Number.isFinite(value)) peak = Math.max(peak, value);
        } catch (_) {
          // time did not write a report.
        }
        try { fs.rmSync(rssFile, { force: true }); } catch (_) { /* ignore */ }
      }
      if (code === 0) resolve({ ms: Date.now() - started, peakRssKb: peak });
      else reject(new Error("VTracer แปลงภาพไม่สำเร็จ" + (stderr ? ": " + stderr.trim() : "")));
    });
  });
}

function prepare(input: Raster, spec: EngineSpec): { raster: Raster; palette: readonly string[]; triedK: readonly number[]; inertia: readonly number[] } {
  let raster = spec.maxEdge > 0 ? areaDownscale(input, spec.maxEdge) : input;
  if (spec.denoise === "gated" && spec.denoisePasses > 0) {
    raster = gatedDenoise(raster, spec.denoiseThreshold, spec.denoisePasses);
  }
  let palette: readonly string[] = [];
  let triedK: readonly number[] = [];
  let inertia: readonly number[] = [];
  if (spec.paletteMode !== "off") {
    const exact = spec.paletteMode === "fixed" ? spec.paletteCap : null;
    const detected = detectPalette(raster, spec.paletteMin, spec.paletteCap, exact, spec.paletteRule, spec.paletteRmse);
    palette = detected.hex;
    triedK = detected.triedK;
    inertia = detected.inertia;
    if (spec.snapPalette && detected.lab.length > 0) raster = snapToPalette(raster, detected.lab);
  }
  if (spec.supersample === 2) raster = bilinear2x(raster);
  return { raster, palette, triedK, inertia };
}

export async function traceFile(options: {
  readonly binary: string;
  readonly inputPath: string;
  readonly outputPath: string;
  readonly preparedPath: string;
  readonly spec: EngineSpec;
  readonly isCancelled?: () => boolean;
  readonly onChild?: (child: childProcess.ChildProcess) => void;
}): Promise<TraceReport> {
  const pipelineStarted = Date.now();
  const spec = options.spec;
  let palette: readonly string[] = [];
  let triedK: readonly number[] = [];
  let inertia: readonly number[] = [];
  let workingWidth = 0;
  let workingHeight = 0;
  let prepared: Raster | null = null;
  const preprocessStarted = Date.now();
  let traceInput = options.inputPath;
  if (!spec.legacy) {
    const preparedRaster = prepare(readPng(options.inputPath), spec);
    if (options.isCancelled?.()) throw new Error("ยกเลิกแล้ว");
    writePng(options.preparedPath, preparedRaster.raster);
    prepared = preparedRaster.raster;
    palette = preparedRaster.palette;
    triedK = preparedRaster.triedK;
    inertia = preparedRaster.inertia;
    workingWidth = preparedRaster.raster.width;
    workingHeight = preparedRaster.raster.height;
    traceInput = options.preparedPath;
  }
  const preprocessMs = Date.now() - preprocessStarted;
  const args = spec.legacy ? legacyArguments(traceInput, options.outputPath, spec) : modernArguments(traceInput, options.outputPath, spec, palette);
  const traced = await runVtracer(options.binary, args, options.onChild);
  if (options.isCancelled?.()) throw new Error("ยกเลิกแล้ว");
  const postStarted = Date.now();
  let svg = fs.readFileSync(options.outputPath, "utf8");
  let stats = analyzeSvg(svg);
  if (!spec.legacy && prepared !== null && (spec.adaptive || spec.ellipseFit)) {
    const scale = spec.supersample;
    const processed = processSvg(svg, gradientMagnitude(prepared), prepared.width, prepared.height, {
      simplify: spec.simplify * scale,
      cornerThreshold: spec.cornerThreshold,
      weakGradient: spec.weakGradient,
      weakScale: spec.weakScale,
      adaptive: spec.adaptive,
      ellipseFit: spec.ellipseFit,
      ellipseTolerance: spec.ellipseTolerance * scale,
      precision: spec.pathPrecision
    });
    svg = processed.svg;
    stats = processed.stats;
    fs.writeFileSync(options.outputPath, svg);
  }
  const postMs = Date.now() - postStarted;
  if (spec.legacy) {
    const size = readPng(options.inputPath);
    workingWidth = size.width;
    workingHeight = size.height;
  }
  return {
    ok: true,
    specId: spec.id,
    paletteSize: palette.length || stats.fills,
    palette,
    triedK,
    inertia,
    workingWidth,
    workingHeight,
    preprocessMs: spec.legacy ? 0 : preprocessMs,
    vtracerMs: traced.ms,
    postMs,
    pipelineMs: Date.now() - pipelineStarted,
    peakRssKb: traced.peakRssKb,
    svgBytes: Buffer.byteLength(svg),
    paths: stats.paths,
    nodes: stats.nodes,
    corners45: stats.corners45,
    fills: stats.fills,
    args,
    resolved: spec
  };
}

export function runSelfCheck(): string[] {
  const errors = selfCheckGeometry();
  const width = 32;
  const height = 32;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const left = x < 16;
      data[i] = left ? 220 : 20;
      data[i + 1] = left ? 40 : 20;
      data[i + 2] = left ? 20 : 20;
      data[i + 3] = 255;
    }
  }
  const raster: Raster = { width, height, data };
  const palette = detectPalette(raster, 2, 8, null);
  if (palette.hex.length < 2 || palette.hex.length > 4) errors.push("palette size " + palette.hex.length + " for a 2-color image");
  const small = areaDownscale(raster, 16);
  if (small.width !== 16 || small.height !== 16) errors.push("downscale " + small.width + "x" + small.height);
  return errors;
}
