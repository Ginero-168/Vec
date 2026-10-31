import { fairPaths, relaxPaths } from "./edit.ts";
import { BACKDROP_TOLERANCE, borderIsSubject, cornerColor, flatPlates, floodBorder, hasClearPixel, flatPlatesAsync, TRACER_LAYER_DIFFERENCE, type FlatPlate } from "./flat-trace.ts";
import { lossyCleanup } from "./jpeg-clean.ts";
import { MIN_SIDE, wouldDenoise } from "./denoise.ts";
import { controlsFor, paletteFromRaster, traceRequest, type LabControls } from "./lab-model.ts";
import { buildLabRasterStages, buildLabRasterStagesAsync, flatPreviewFromPlates, flatRasterStages, vectorStagesFromPlan, type LabRasterStages, type LabStepId, type PipelineProgress } from "./lab-pipeline.ts";
import { encodeRgbaPng, punchTransparency, readRgbaPng } from "./png-alpha.ts";
import { dropCanvasBackground, dropFill, fitShapes, groupPathsByFill, sealGaps } from "./score.ts";
import { segmentRaster } from "./segment.ts";
import { scaleSvg } from "./svg-scale.ts";
import { assembleTrace, mergePlates, type PlacedPlate } from "./trace-finish.ts";
import { chooseTraces, setCoveragePngDecoder } from "./trace-coverage.ts";
import { type Stacking, type TracePreset, type TraceRequest } from "./trace.ts";
import { edgeFirstSvg, type EdgeLabels } from "./edge-first.ts";
import { NEAR_FILL } from "./score.ts";

// The stand-in plates planFlat makes are checked against their traced raster after tracing (chooseTraces).
setCoveragePngDecoder(readRgbaPng);

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
  /** The flat plates as one source-resolution label map, for the edge-first finish (edge-first.ts). */
  readonly edgeFirst?: { readonly labels: EdgeLabels; readonly lossy: boolean };
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
  const plates = await flatPlatesAsync(decoded.rgba, decoded.width, decoded.height, settings.maxColors, lossyCleanup(decoded.rgba, decoded.width, decoded.height),
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
  // chooseTraces decides each stand-in plate once, here: the traces it keeps go on without their fallbacks (so the
  // merges below keep them as they are), and the edge-first finish keeps apart the inks whose stand-ins it kept.
  const chosen = chooseTraces(svgs, plan.plates);
  const settled = chosen.plates.map((plate): PlannedPlate => { const { plain, ...rest } = plate; void plain; return rest; });
  const stages = vectorStagesFromPlan(chosen.svgs, settled, plan.width, plan.height, plan.droppedColor, controls, onProgress);
  const source = plan.plates.find((plate) => plate.source !== undefined)?.source;
  const defaults = controlsFor(controls.mode);
  // The edge-first finish replaces the flat finish where that runs at its defaults (fairLabVector's relax branch).
  // Below denoise's MIN_SIDE the edge-first finish has no basis for its lossy/clean choice (the integration window and
  // fit tolerance): wouldDenoise refuses to judge rasters that small, since their anti-aliased edges alone read as noise.
  // Those keep the flat finish.
  if (plan.edgeFirst === undefined || source === undefined || plan.droppedColor !== null || (controls.mode !== "logo" && controls.mode !== "icon")
    || Math.min(plan.width, plan.height) < MIN_SIDE
    || controls.smoothness !== defaults.smoothness || controls.corner !== defaults.corner) return stages;
  // On a lossy source a kept ink's fringes are still chroma-subsampling mixes that fold, and its lines are kept as
  // lines (edge-first's enclosed-line rule): the kept inks matter on clean sources only.
  const keep = plan.edgeFirst.lossy ? new Set<number>() : keptApart(plan.edgeFirst.labels.inks, svgs, chosen);
  return { ...stages, sealed: edgeFirstSvg(plan.edgeFirst.labels, source.rgba, plan.edgeFirst.lossy, keep) };
}

/**
 * The label inks f19 kept apart: on each plate whose stand-in trace chooseTraces kept, the inks that moved to stand-ins
 * and the near inks they were moved away from (separateNearInks' pairs: further apart than the layer difference and
 * closer than INK_FOLD_REACH).
 */
function keptApart(inks: readonly string[], svgs: readonly string[], chosen: { readonly svgs: readonly string[]; readonly plates: readonly PlannedPlate[] }): Set<number> {
  const rgb = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  const apart = (left: readonly number[], right: readonly number[]) => left.reduce((sum, value, channel) => sum + Math.abs(value - right[channel]!), 0);
  const moved: number[][] = [];
  chosen.plates.forEach((plate, index) => {
    if (plate.fills === undefined || plate.plain === undefined || chosen.svgs[index] === svgs[plate.plain]) return;
    for (const ink of Object.values(plate.fills)) moved.push(rgb(ink));
  });
  const kept = new Set<number>();
  inks.forEach((hex, index) => {
    const own = rgb(hex);
    if (moved.some((ink) => apart(ink, own) === 0 || (apart(ink, own) > TRACER_LAYER_DIFFERENCE && apart(ink, own) < INK_FOLD_REACH))) kept.add(index);
  });
  return kept;
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
  const flat = preparedPlates ?? flatPlates(rgba, width, height, settings.maxColors, lossyCleanup(rgba, width, height), onProgress);
  // Near inks are separated only on a clean source. On a lossy one (judged on the whole image, at any size: the JPEG
  // cleanup skips small sources but their noise is there all the same) two near plate colours are mostly one ink that
  // the noise split, and tracing them apart brings the noise back as islands.
  const clean = !wouldDenoise(rgba, width, height);
  // A plate traced with stand-in inks also goes out as it was (a backup plate after the others), so the finish can
  // fall back to that trace where the stand-ins paint the plate worse (chooseTraces).
  const plates: PlannedPlate[] = [];
  // Each flat plate's own (punched, not stand-in) pixels, for the edge-first label map.
  const punchedPlates: Uint8Array[] = [];
  const backups: PlannedPlate[] = [];
  for (const plate of flat) {
    const punched = settings.removeBackground ? punchBackdrop(plate.rgba, plate.width, plate.height, plate.borderColor, plate.scale) : { rgba: plate.rgba, borderIsSubject: false };
    punchedPlates.push(punched.rgba);
    const separated = clean ? separateNearInks(punched.rgba, plate.palette, { rgba, width, height, originX: plate.originX, originY: plate.originY, scale: plate.scale, plateWidth: plate.width }) : null;
    const planned = (pixels: Uint8Array, palette: readonly string[]): PlannedPlate => ({
      png: encodeRgbaPng(plate.width, plate.height, pixels),
      scale: plate.scale,
      originX: plate.originX,
      originY: plate.originY,
      // A border colour that is the subject is no canvas plate either: dropCanvasBackground must keep it.
      borderColor: punched.borderIsSubject ? null : plate.borderColor,
      cutOut: plate.cutOut,
      source: { rgba, width, height },
      request: controls === undefined
        ? flatRequest(settings, palette, plate.scale)
        : flatRequestForControls(settings, palette, plate.scale, controls)
    });
    if (separated === null) { plates.push(planned(punched.rgba, plate.palette)); continue; }
    plates.push({ ...planned(separated.rgba, separated.palette), fills: separated.fills, plain: flat.length + backups.length });
    backups.push({ ...planned(punched.rgba, plate.palette), backup: true });
  }
  plates.push(...backups);
  const rasterStages = controls === undefined ? undefined : flatRasterStages(controls.mode, rgba, flatPreviewFromPlates([...flat], width, height));
  const labels = plateLabels(flat, punchedPlates, width, height);
  return {
    width,
    height,
    droppedColor: null,
    plates,
    ...(rasterStages === undefined ? {} : { rasterStages }),
    edgeFirst: { labels, lossy: !clean }
  };
}

/**
 * How far apart two inks must be for VTracer to keep them apart whatever it has folded into them. Its clustering
 * (visioncortex) merges regions smallest first, each into its nearest-colour neighbour, and keeps a region as its own
 * layer only when its colour is more than the layer difference (16) from that neighbour's. The colour it compares is
 * the region's whole pixel mean, including the smaller regions already layered on it: a ring of ink B that has taken in
 * the disc of ink A inside it, or a stripe of B that has taken in the strip of A beyond it, compares as a mix of the
 * two. A region is never smaller than one it takes in, so the other ink is at most half of a merge and leaves the mix
 * at least half the inks' difference from it. The mix has to stay one more than the layer difference away after the
 * tracer floors each channel's mean (up to 1 per channel, 3 in all), so the inks need twice (16 + 1 + 3) = 40 between
 * them. Two inks closer than that and further apart than the layer difference (which merges by design) can fold into
 * one layer and the one fill the palette snaps it to.
 */
const INK_FOLD_REACH = 2 * (TRACER_LAYER_DIFFERENCE + 1 + 3);

type SeparatedInks = { readonly rgba: Uint8Array; readonly palette: readonly string[]; readonly fills: Readonly<Record<string, string>> };

/** The source raster a plate was cut from, where the plate sits on it (plate pixel = (source - origin) * scale), and the plate's width. */
type InkSource = { readonly rgba: Uint8Array; readonly width: number; readonly height: number; readonly originX: number; readonly originY: number; readonly scale: number; readonly plateWidth: number };

/**
 * Trace a plate whose inks sit closer than INK_FOLD_REACH to each other (and further apart than the layer difference,
 * which VTracer merges by design) with stand-in colours that are not: the ink with fewer pixels moves away from the
 * other along their own difference until they are INK_FOLD_REACH apart. A stand-in that would come within reach of a
 * third ink it was out of reach of is not used (the other ink moves instead, or the pair stays). Both inks of a pair
 * must be inks of the source: the colour its own pixels most often have exactly. A flat ink is (its edge pixels each
 * differ); a colour a JPEG's noise split off an ink is a median that few decoded pixels hit. The returned fills map
 * each stand-in back to the plate colour (restoreFills). Null when no pair needs it.
 */
export function separateNearInks(rgba: Uint8Array, palette: readonly string[], source: InkSource): SeparatedInks | null {
  const inks = palette.map((hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [number, number, number]);
  if (inks.length < 2 || inks.some((ink) => ink.some((value) => !Number.isFinite(value)))) return null;
  const apart = (left: readonly number[], right: readonly number[]) => Math.abs(left[0]! - right[0]!) + Math.abs(left[1]! - right[1]!) + Math.abs(left[2]! - right[2]!);
  const pairs: [number, number][] = [];
  for (let left = 0; left < inks.length; left += 1) {
    for (let right = left + 1; right < inks.length; right += 1) {
      const distance = apart(inks[left]!, inks[right]!);
      if (distance > TRACER_LAYER_DIFFERENCE && distance < INK_FOLD_REACH) pairs.push([left, right]);
    }
  }
  if (pairs.length === 0) return null;
  const real = sourceInks(rgba, inks, new Set(pairs.flat()), source);
  pairs.splice(0, pairs.length, ...pairs.filter(([left, right]) => real.has(left) && real.has(right)));
  if (pairs.length === 0) return null;
  const counts = new Map<number, number>();
  for (let at = 0; at < rgba.length; at += 4) {
    if ((rgba[at + 3] ?? 0) === 0) continue;
    const key = ((rgba[at] ?? 0) << 16) | ((rgba[at + 1] ?? 0) << 8) | (rgba[at + 2] ?? 0);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const count = (ink: readonly number[]) => counts.get((ink[0]! << 16) | (ink[1]! << 8) | ink[2]!) ?? 0;
  const traced = inks.map((ink) => [...ink] as [number, number, number]);
  pairs.sort((a, b) => apart(inks[a[0]]!, inks[a[1]]!) - apart(inks[b[0]]!, inks[b[1]]!) || a[0] - b[0] || a[1] - b[1]);
  for (const [left, right] of pairs) {
    if (apart(traced[left]!, traced[right]!) >= INK_FOLD_REACH) continue;
    const minor = count(inks[left]!) <= count(inks[right]!) ? left : right;
    const major = minor === left ? right : left;
    for (const [moved, kept] of [[minor, major], [major, minor]] as const) {
      const stand = pushApart(traced[moved]!, traced[kept]!, INK_FOLD_REACH);
      if (stand === null) continue;
      const clear = traced.every((other, index) => index === moved || index === kept
        || apart(stand, other) >= INK_FOLD_REACH || apart(stand, other) >= apart(traced[moved]!, other));
      if (!clear) continue;
      traced[moved] = stand;
      break;
    }
  }
  const fills: Record<string, string> = {};
  const repaint = new Map<number, [number, number, number]>();
  const hex = (ink: readonly number[]) => "#" + ink.map((value) => value.toString(16).padStart(2, "0")).join("");
  for (const [index, ink] of inks.entries()) {
    const stand = traced[index]!;
    if (apart(stand, ink) === 0) continue;
    if (inks.some((other) => apart(other, stand) === 0)) return null;
    fills[hex(stand).toUpperCase()] = palette[index]!;
    repaint.set((ink[0] << 16) | (ink[1] << 8) | ink[2], stand);
  }
  if (repaint.size === 0) return null;
  const out = new Uint8Array(rgba);
  for (let at = 0; at < out.length; at += 4) {
    if ((out[at + 3] ?? 0) === 0) continue;
    const stand = repaint.get(((out[at] ?? 0) << 16) | ((out[at + 1] ?? 0) << 8) | (out[at + 2] ?? 0));
    if (stand === undefined) continue;
    out[at] = stand[0]; out[at + 1] = stand[1]; out[at + 2] = stand[2];
  }
  return { rgba: out, palette: traced.map((ink, index) => apart(ink, inks[index]!) === 0 ? palette[index]! : hex(ink)), fills };
}

/** The inks (of `wanted`) that are the most frequent exact source colour among the source pixels the plate gives them. */
function sourceInks(plate: Uint8Array, inks: readonly (readonly number[])[], wanted: ReadonlySet<number>, source: InkSource): Set<number> {
  const key = (at: number, from: Uint8Array) => ((from[at] ?? 0) << 16) | ((from[at + 1] ?? 0) << 8) | (from[at + 2] ?? 0);
  const ink = new Map<number, number>();
  for (const index of wanted) ink.set((inks[index]![0]! << 16) | (inks[index]![1]! << 8) | inks[index]![2]!, index);
  const tallies = new Map<number, Map<number, number>>();
  const { scale, plateWidth } = source, half = scale >> 1;
  const columns = Math.floor(plateWidth / scale), rows = Math.floor(plate.length / 4 / plateWidth / scale);
  for (let y = 0; y < rows; y += 1) {
    const sy = y + source.originY;
    if (sy < 0 || sy >= source.height) continue;
    for (let x = 0; x < columns; x += 1) {
      const sx = x + source.originX;
      if (sx < 0 || sx >= source.width) continue;
      const at = ((y * scale + half) * plateWidth + x * scale + half) * 4;
      if ((plate[at + 3] ?? 0) === 0) continue;
      const label = ink.get(key(at, plate));
      if (label === undefined) continue;
      const tally = tallies.get(label) ?? new Map<number, number>();
      const colour = key((sy * source.width + sx) * 4, source.rgba);
      tally.set(colour, (tally.get(colour) ?? 0) + 1);
      tallies.set(label, tally);
    }
  }
  const real = new Set<number>();
  for (const [label, tally] of tallies) {
    const own = tally.get((inks[label]![0]! << 16) | (inks[label]![1]! << 8) | inks[label]![2]!) ?? 0;
    if (own > 0 && [...tally.values()].every((count) => count <= own)) real.add(label);
  }
  return real;
}

/** `ink` moved away from `from` along their difference until they are at least `distance` apart, or null (clamped). */
function pushApart(ink: readonly number[], from: readonly number[], distance: number): [number, number, number] | null {
  const delta = [ink[0]! - from[0]!, ink[1]! - from[1]!, ink[2]! - from[2]!];
  const length = Math.abs(delta[0]!) + Math.abs(delta[1]!) + Math.abs(delta[2]!);
  if (length === 0) return null;
  for (let scale = distance / length; scale <= 255; scale += 1 / length) {
    const moved = delta.map((value, channel) => Math.min(255, Math.max(0, Math.round(from[channel]! + value * scale)))) as [number, number, number];
    const reached = Math.abs(moved[0] - from[0]!) + Math.abs(moved[1] - from[1]!) + Math.abs(moved[2] - from[2]!);
    if (reached >= distance) return moved;
    if (moved.every((value) => value === 0 || value === 255)) return null;
  }
  return null;
}

/**
 * The flat plates as one label map at source resolution: each source pixel takes the ink at its centre in the plate
 * (as flatPreviewFromPlates reads them), a later plate on top of an earlier one, as they are drawn. A pixel no plate
 * covers (clear after the backdrop punch) is the backdrop, -1.
 */
function plateLabels(flat: readonly FlatPlate[], punched: readonly Uint8Array[], width: number, height: number): EdgeLabels {
  const labels = new Int32Array(width * height).fill(-1);
  const inks: string[] = [];
  const index = new Map<number, number>();
  flat.forEach((plate, which) => {
    const rgba = punched[which]!, half = plate.scale >> 1;
    for (let y = 0; y < plate.sourceHeight; y += 1) {
      const sy = plate.originY + y;
      if (sy < 0 || sy >= height) continue;
      for (let x = 0; x < plate.sourceWidth; x += 1) {
        const sx = plate.originX + x;
        if (sx < 0 || sx >= width) continue;
        const at = ((y * plate.scale + half) * plate.width + x * plate.scale + half) * 4;
        if ((rgba[at + 3] ?? 0) === 0) continue;
        const key = ((rgba[at] ?? 0) << 16) | ((rgba[at + 1] ?? 0) << 8) | (rgba[at + 2] ?? 0);
        let ink = index.get(key);
        if (ink === undefined) { ink = inks.length; index.set(key, ink); inks.push("#" + key.toString(16).padStart(6, "0")); }
        labels[sy * width + sx] = ink;
      }
    }
  });
  // As the flat finish does for cut-outs (unifyNearFills): a fringe can win its own palette slot one step from the fill
  // it rims; on a cut-out such a near-identical ink is folded into the larger one (by the edge-first finish, which
  // knows which near inks the traces kept apart).
  if (flat.length > 0 && flat.every((plate) => plate.cutOut)) {
    const area = new Array<number>(inks.length).fill(0);
    for (const ink of labels) if (ink >= 0) area[ink]! += 1;
    const ranked = [...inks.keys()].sort((a, b) => area[b]! - area[a]! || a - b);
    const into = new Map<number, number>();
    const rgb = (ink: number) => [1, 3, 5].map((at) => parseInt(inks[ink]!.slice(at, at + 2), 16));
    for (const [rank, ink] of ranked.entries()) {
      const own = rgb(ink);
      const target = ranked.slice(0, rank).find((other) => !into.has(other) && rgb(other).every((value, channel) => Math.abs(value - own[channel]!) <= NEAR_FILL));
      if (target !== undefined) into.set(ink, target);
    }
    return { width, height, labels, inks, unify: inks.map((_, ink) => into.get(ink) ?? ink) };
  }
  return { width, height, labels, inks };
}

const HALO_MIX = 0.35;
const HALO_RESIDUAL = 16;

/**
 * Make the border-connected backdrop transparent before VTracer sees the flat plate (what punchRgba did before 2bf96ab).
 * Without it VTracer's stacked mode turns the largest cluster into a full-canvas base layer; when that is a subject
 * colour, dropCanvasBackground removes the white shell above it and the subject colour shows as a solid plate.
 * JPEG backdrops paint as several near-white labels, so pixels within BACKDROP_TOLERANCE of the corner colour count.
 * No-op unless the source corners are opaque and agree (plate.borderColor) and the painted corners agree too.
 */
export function punchBorderBackdrop(rgba: Uint8Array, width: number, height: number, sourceBorder: string | null, haloReach = 8): Uint8Array {
  return punchBackdrop(rgba, width, height, sourceBorder, haloReach).rgba;
}

/** punchBorderBackdrop, also saying when the border colour was kept because it is the subject (borderIsSubject). */
function punchBackdrop(rgba: Uint8Array, width: number, height: number, sourceBorder: string | null, haloReach: number): { rgba: Uint8Array; borderIsSubject: boolean } {
  // Gate on the SOURCE corners (plate.borderColor): the painted label map is opaque even where the input was transparent.
  if (sourceBorder === null) return { rgba, borderIsSubject: false };
  const corner = cornerColor(rgba, width, height);
  if (corner === null) return { rgba, borderIsSubject: false };
  const tr = parseInt(corner.slice(1, 3), 16), tg = parseInt(corner.slice(3, 5), 16), tb = parseInt(corner.slice(5, 7), 16);
  const halo = haloColors(rgba, [tr, tg, tb]);
  const isHalo = (pixel: number) => (rgba[pixel * 4 + 3] ?? 0) >= 250
    && halo.has(((rgba[pixel * 4] ?? 0) << 16) | ((rgba[pixel * 4 + 1] ?? 0) << 8) | (rgba[pixel * 4 + 2] ?? 0));
  const { seen, count: punched } = floodBorder(rgba, width, height, [tr, tg, tb]);
  const out = new Uint8Array(rgba);
  for (let pixel = 0; pixel < seen.length; pixel += 1) if (seen[pixel] === 1) out[pixel * 4 + 3] = 0;
  if (punched === width * height) return { rgba, borderIsSubject: false };
  if (borderIsSubject(rgba, width, height, [tr, tg, tb], seen, punched)) return { rgba, borderIsSubject: true };
  // Peel the halo: halo-coloured pixels within haloReach (about one source pixel) of the punched backdrop. The reach
  // keeps real light content that merely touches the backdrop, such as a pale fill behind a broken outline.
  if (halo.size > 0) {
    let frontier: number[] = [];
    for (let pixel = 0; pixel < width * height; pixel += 1) if (seen[pixel] === 1) frontier.push(pixel);
    // The backdrop also continues past the canvas frame. Where the subject runs into the frame there is no punched
    // backdrop between them, so a halo pixel on the frame is peeled from the frame side too.
    const fromFrame = (pixel: number) => {
      if (seen[pixel] === 1 || !isHalo(pixel)) return;
      seen[pixel] = 1;
      out[pixel * 4 + 3] = 0;
      frontier.push(pixel);
    };
    for (let x = 0; x < width; x += 1) { fromFrame(x); fromFrame((height - 1) * width + x); }
    for (let y = 0; y < height; y += 1) { fromFrame(y * width); fromFrame(y * width + width - 1); }
    for (let depth = 0; depth < haloReach && frontier.length > 0; depth += 1) {
      const next: number[] = [];
      for (const pixel of frontier) {
        const x = pixel % width;
        for (const step of [x > 0 ? pixel - 1 : -1, x < width - 1 ? pixel + 1 : -1, pixel - width, pixel + width]) {
          if (step < 0 || step >= width * height || seen[step] === 1 || !isHalo(step)) continue;
          seen[step] = 1;
          out[step * 4 + 3] = 0;
          next.push(step);
        }
      }
      frontier = next;
    }
  }
  return { rgba: out, borderIsSubject: false };
}

/**
 * Painted colours that are a light mix of the backdrop and another painted colour: the anti-aliasing and JPEG ringing
 * halo around the subject. Left opaque, the halo became its own ring layer whose outer edge never matched the subject
 * plate stacked under it, so slivers of the subject colour showed outside the ring.
 */
function haloColors(rgba: Uint8Array, backdrop: readonly number[]): Set<number> {
  const counts = new Map<number, number>();
  for (let offset = 0; offset < rgba.length; offset += 4) {
    if ((rgba[offset + 3] ?? 0) < 250) continue;
    const key = ((rgba[offset] ?? 0) << 16) | ((rgba[offset + 1] ?? 0) << 8) | (rgba[offset + 2] ?? 0);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (counts.size > 64) return new Set();
  }
  const colors = [...counts.keys()].map((key) => [(key >> 16) & 255, (key >> 8) & 255, key & 255]);
  const result = new Set<number>();
  for (const color of colors) {
    for (const other of colors) {
      if (other === color) continue;
      let dot = 0;
      let length = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        const span = (other[channel] ?? 0) - (backdrop[channel] ?? 0);
        dot += ((color[channel] ?? 0) - (backdrop[channel] ?? 0)) * span;
        length += span * span;
      }
      if (length < 64 * 64) continue;
      const t = dot / length;
      if (t <= 0 || t > HALO_MIX) continue;
      let residual = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        const mixed = (backdrop[channel] ?? 0) + t * ((other[channel] ?? 0) - (backdrop[channel] ?? 0));
        residual += ((color[channel] ?? 0) - mixed) ** 2;
      }
      if (Math.sqrt(residual) <= HALO_RESIDUAL) {
        result.add(((color[0] ?? 0) << 16) | ((color[1] ?? 0) << 8) | (color[2] ?? 0));
        break;
      }
    }
  }
  return result;
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
        cutOut: hasClearPixel(rgba),
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
      cutOut: hasClearPixel(rgba),
      request: {
        ...request,
        removeBackground: settings.removeBackground
      }
    }]
  };
}
