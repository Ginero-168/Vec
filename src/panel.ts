import type { ChildProcess } from "child_process";
import * as childProcess from "child_process";
import type { Worker } from "worker_threads";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { expandPrimitives, listAnchors, moveAnchor, paintDisc, paletteFromRaster, parseBatchFields, removeShape } from "./edit";
import { encodeRgbaPng, readRgbaPng } from "./png-alpha";
import { holeNote, scoreSvg, shapeNote, type TraceFacts } from "./score";
import { controlsFor, type LabControls } from "./lab-model";
import {
  emptyPresetState,
  hasPresetEdits,
  modifiedPresetControlCount,
  modifiedPresetControls,
  PRESET_CONTROL_FIELDS,
  PRESET_PRESENTATION,
  resetPresetControl,
  resetPresetControls,
  selectPreset,
  updatePresetControls,
  type PresetControlField,
  type PresetState
} from "./preset-state";
import { CONTROL_STEPS, earliestChangedStep, LAB_STEPS, fairLabVector, sealLabVector, styleLabVectors, type LabRasterStages, type LabStepId } from "./lab-pipeline";
import { createProgressReporter, type ProgressReporter, type StepProgress } from "./progress";
import type { SegmentColorStage } from "./segment";
import { cappedPalette, planTraceAsync, replanTracePlan, settingsFromControls, vectorStagesForPlan, type PipelineSettings, type PlannedPlate, type TracePlan } from "./trace-pipeline";
import { resolveVtracer, vtracerArguments, type TracePreset, type TraceRequest } from "./trace";

interface CepBridge {
  evalScript(script: string, callback: (result: string) => void): void;
  getSystemPath(kind: string): string;
}

declare const CSInterface: { new (): CepBridge };
declare const SystemPath: { readonly EXTENSION: string };

class HostTimeoutError extends Error {
  constructor() {
    super("Illustrator ไม่ตอบกลับภายในเวลาที่กำหนด");
  }
}

type Selection = {
  readonly documentName: string;
  readonly documentIdentity: string;
  readonly itemName: string;
  readonly itemType: string;
  readonly uuid: string;
  readonly bounds: readonly [number, number, number, number];
  readonly widthPt: number;
  readonly heightPt: number;
  readonly embedded: boolean;
  readonly fromResult: boolean;
};

type Job = {
  readonly id: string;
  readonly directory: string;
  readonly pngPath: string;
  readonly svgPath: string;
  readonly settings: PipelineSettings;
  readonly controls: LabControls;
  cancelled: boolean;
};

type Raster = { readonly width: number; readonly height: number; readonly rgba: Uint8Array };

type Preview = {
  readonly selection: Selection;
  readonly job: Job | null;
  readonly dataUrl: string;
  readonly pngUrl: string;
  readonly svgText: string;
  readonly raster: Raster | null;
  readonly facts: TraceFacts;
};

type PlanWorkerMessage =
  | { readonly kind: "plan"; readonly plan: TracePlan | null }
  | { readonly kind: "progress"; readonly progress: StepProgress }
  | { readonly kind: "error"; readonly error: string };

type PlanRunner = { readonly cancel: () => void };

type WorkerConstructor = new (filename: string) => Worker;

/** Longest a worker round trip may take before the panel gives up and shows an error. */
const PLAN_TIMEOUT_MS = 180_000;
const PROGRESS_LABELS: Readonly<Record<LabStepId, string>> = {
  capture: "อ่านภาพ",
  colors: "แยกสี",
  backdrop: "ลบพื้นหลัง",
  punch: "เจาะช่อง",
  trace: "แปลงเวกเตอร์ (VTracer)",
  fit: "ปรับเส้น",
  fair: "เกลี่ยเส้น",
  seal: "ปิดรอยต่อ"
};

let workerConstructor: WorkerConstructor | null | undefined;

/**
 * CEP's embedded Node (NW.js-style integration) may not expose worker_threads.
 * A top-level import made the whole panel script throw on load, leaving the
 * static HTML with no click handlers. Load it lazily and remember a failure.
 */
function loadWorkerConstructor(): WorkerConstructor | null {
  if (workerConstructor !== undefined) return workerConstructor;
  try {
    const module = require("worker_threads") as { Worker?: unknown };
    workerConstructor = typeof module.Worker === "function" ? module.Worker as WorkerConstructor : null;
  } catch {
    workerConstructor = null;
  }
  return workerConstructor;
}

type State =
  | { readonly kind: "empty" }
  | { readonly kind: "loading" }
  | { readonly kind: "selected"; readonly selection: Selection }
  | { readonly kind: "capturing"; readonly selection: Selection; readonly job: Job }
  | { readonly kind: "planning"; readonly selection: Selection; readonly job: Job; readonly runner: PlanRunner; readonly from: LabStepId }
  | { readonly kind: "tracing"; readonly selection: Selection; readonly job: Job; readonly child: ChildProcess }
  | ({ readonly kind: "preview" } & Preview)
  | ({ readonly kind: "applying" } & Preview);

type Tool = "none" | "drag" | "erase" | "brush";

type ControlElements = {
  readonly mode: HTMLSelectElement;
  readonly maxColors: HTMLInputElement;
  readonly snapBlends: HTMLInputElement;
  readonly speckArea: HTMLInputElement;
  readonly removeBackground: HTMLInputElement;
  readonly backdropSpread: HTMLInputElement;
  readonly opaqueAt: HTMLInputElement;
  readonly traceColors: HTMLInputElement;
  readonly lockPalette: HTMLInputElement;
  readonly colorPrecision: HTMLInputElement;
  readonly filterSpeckle: HTMLInputElement;
  readonly clustering: HTMLSelectElement;
  readonly watershedDetail: HTMLInputElement;
  readonly simplify: HTMLInputElement;
  readonly stacking: HTMLSelectElement;
  readonly dropPlate: HTMLInputElement;
  readonly fitGeometry: HTMLInputElement;
  readonly smoothness: HTMLInputElement;
  readonly corner: HTMLInputElement;
  readonly seal: HTMLInputElement;
  readonly sealWidth: HTMLInputElement;
};

function parsePlanWorkerMessage(value: unknown): PlanWorkerMessage | null {
  if (!isRecord(value)) return null;
  if (value.kind === "error" && typeof value.error === "string") return { kind: "error", error: value.error };
  if (value.kind === "progress" && isRecord(value.progress)) {
    const payload = value.progress;
    const step = LAB_STEPS.find((candidate) => candidate === payload.step);
    const fraction = payload.fraction;
    const percent = payload.percent;
    if (step === undefined || typeof fraction !== "number" || !Number.isFinite(fraction) || fraction < 0 || fraction > 1 || typeof percent !== "number" || !Number.isFinite(percent) || percent < 0 || percent > 100) return null;
    return { kind: "progress", progress: { step, fraction, percent } };
  }
  if (value.kind !== "plan") return null;
  const plan = parseTracePlan(value.plan);
  if (value.plan !== null && plan === null) return null;
  return { kind: "plan", plan };
}

function parseTracePlan(value: unknown): TracePlan | null {
  if (!isRecord(value) || !Number.isInteger(value.width) || !Number.isInteger(value.height) || !Array.isArray(value.plates)) return null;
  if (typeof value.width !== "number" || typeof value.height !== "number") return null;
  if (value.droppedColor !== null && typeof value.droppedColor !== "string") return null;
  const plates: PlannedPlate[] = [];
  for (const candidate of value.plates) {
    const plate = parsePlannedPlate(candidate);
    if (plate === null) return null;
    plates.push(plate);
  }
  let rasterStages: LabRasterStages | undefined;
  if (value.rasterStages !== undefined) {
    rasterStages = parseRasterStages(value.rasterStages) ?? undefined;
    if (rasterStages === undefined) return null;
  }
  return {
    width: value.width,
    height: value.height,
    droppedColor: value.droppedColor,
    plates,
    ...(rasterStages === undefined ? {} : { rasterStages })
  };
}

function parsePlannedPlate(value: unknown): PlannedPlate | null {
  if (!isRecord(value) || !(value.png instanceof Uint8Array)) return null;
  if (typeof value.scale !== "number" || typeof value.originX !== "number" || typeof value.originY !== "number") return null;
  if (value.borderColor !== null && typeof value.borderColor !== "string") return null;
  const request = parseTraceRequest(value.request);
  if (request === null) return null;
  return {
    png: Buffer.from(value.png),
    scale: value.scale,
    originX: value.originX,
    originY: value.originY,
    borderColor: value.borderColor,
    request
  };
}

function parseTraceRequest(value: unknown): TraceRequest | null {
  if (!isRecord(value)) return null;
  const preset = value.preset;
  const stacking = value.stacking;
  if (preset !== "logo" && preset !== "icon" && preset !== "photo" && preset !== "poster") return null;
  if (stacking !== "cutout" && stacking !== "stacked") return null;
  if (typeof value.maxColors !== "number" || typeof value.smoothness !== "number" || typeof value.removeBackground !== "boolean") return null;
  const request: TraceRequest = { preset, stacking, maxColors: value.maxColors, smoothness: value.smoothness, removeBackground: value.removeBackground };
  if (value.palette !== undefined) {
    if (!Array.isArray(value.palette) || !value.palette.every((color) => typeof color === "string")) return null;
    return {
      ...request,
      palette: value.palette,
      ...optionalRequestFields(value)
    };
  }
  return { ...request, ...optionalRequestFields(value) };
}

function optionalRequestFields(value: Record<string, unknown>): Pick<TraceRequest, "colorPrecision" | "filterSpeckle" | "clustering" | "watershedDetail" | "simplify"> {
  const result: {
    colorPrecision?: number;
    filterSpeckle?: number;
    clustering?: "watershed" | "off";
    watershedDetail?: number;
    simplify?: number;
  } = {};
  if (typeof value.colorPrecision === "number") result.colorPrecision = value.colorPrecision;
  if (typeof value.filterSpeckle === "number") result.filterSpeckle = value.filterSpeckle;
  if (value.clustering === "watershed" || value.clustering === "off") result.clustering = value.clustering;
  if (typeof value.watershedDetail === "number") result.watershedDetail = value.watershedDetail;
  if (typeof value.simplify === "number") result.simplify = value.simplify;
  return result;
}

function parseRasterStages(value: unknown): LabRasterStages | null {
  if (!isRecord(value) || !(value.colors instanceof Uint8Array) || !(value.backdrop instanceof Uint8Array) || !(value.punchInput instanceof Uint8Array) || !(value.punch instanceof Uint8Array) || !(value.traceInput instanceof Uint8Array)) return null;
  if (value.mode !== "logo" && value.mode !== "icon" && value.mode !== "photo" && value.mode !== "poster") return null;
  if (value.droppedColor !== null && typeof value.droppedColor !== "string") return null;
  if (typeof value.spread !== "number" || typeof value.paletteSize !== "number") return null;
  const segmentation = parseSegmentColorStage(value.segmentation);
  if (value.segmentation !== null && segmentation === null) return null;
  return {
    mode: value.mode,
    colors: value.colors,
    backdrop: value.backdrop,
    punchInput: value.punchInput,
    punch: value.punch,
    traceInput: value.traceInput,
    droppedColor: value.droppedColor,
    spread: value.spread,
    paletteSize: value.paletteSize,
    segmentation
  };
}

function parseSegmentColorStage(value: unknown): SegmentColorStage | null {
  if (!isRecord(value) || !(value.colors instanceof Uint8Array) || !(value.labels instanceof Int16Array) || !(value.punchLabels instanceof Int16Array) || !(value.opaque instanceof Uint8Array) || !Array.isArray(value.palette) || typeof value.spread !== "number") return null;
  if (!value.palette.every((color) => isRecord(color) && typeof color.r === "number" && typeof color.g === "number" && typeof color.b === "number")) return null;
  return value as unknown as SegmentColorStage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type ControlStatusUi = { readonly marker: HTMLElement; readonly reset: HTMLButtonElement };

const PRESET_CONTROL_LABELS: Readonly<Record<PresetControlField, string>> = {
  maxColors: "เพดานจำนวนสี",
  snapBlends: "ยุบสีผสม",
  speckArea: "ขนาดจุดฝุ่น",
  removeBackground: "ลบพื้นหลัง",
  backdropSpread: "เกณฑ์ขอบพื้นหลัง",
  opaqueAt: "เกณฑ์ความทึบ",
  traceColors: "จำนวนสีตอนลากเส้น",
  lockPalette: "ล็อกชุดสี",
  colorPrecision: "ความละเอียดสี",
  filterSpeckle: "กรองจุดเล็ก",
  clustering: "การแยกโซน",
  watershedDetail: "รายละเอียด watershed",
  simplify: "ความคลาดเคลื่อนของเส้น",
  stacking: "การวางรูป",
  dropPlate: "ทิ้งแผ่นสี",
  fitGeometry: "จับรูปทรง",
  smoothness: "ความเรียบ",
  corner: "ความคมของมุม",
  seal: "ถมรอยระหว่างชิ้น",
  sealWidth: "ความหนาของรอยที่ถม"
};

type Ui = {
  readonly selection: HTMLElement;
  readonly presetsSection: HTMLElement;
  readonly presetCards: readonly HTMLButtonElement[];
  readonly presetConfirm: HTMLElement;
  readonly presetConfirmText: HTMLElement;
  readonly presetConfirmApply: HTMLButtonElement;
  readonly presetConfirmCancel: HTMLButtonElement;
  readonly controlsSection: HTMLElement;
  readonly presetOrigin: HTMLElement;
  readonly controlStatus: ReadonlyMap<PresetControlField, ControlStatusUi>;
  readonly status: HTMLElement;
  readonly phase: HTMLElement;
  readonly progressStatus: HTMLElement;
  readonly progressBar: HTMLProgressElement;
  readonly progressLabel: HTMLElement;
  readonly progressValue: HTMLElement;
  readonly preview: HTMLImageElement;
  readonly previewEmpty: HTMLElement;
  readonly stage: HTMLElement;
  readonly brushCanvas: HTMLCanvasElement;
  readonly refresh: HTMLButtonElement;
  readonly trace: HTMLButtonElement;
  readonly cancel: HTMLButtonElement;
  readonly apply: HTMLButtonElement;
  readonly batch: HTMLButtonElement;
  readonly preset: HTMLSelectElement;
  readonly reset: HTMLButtonElement;
  readonly stepButtons: readonly HTMLButtonElement[];
  readonly stepFields: readonly HTMLFieldSetElement[];
  readonly controls: ControlElements;
  readonly facts: HTMLElement;
  readonly factPaths: HTMLElement;
  readonly factAnchors: HTMLElement;
  readonly factHoles: HTMLElement;
  readonly factColors: HTMLElement;
  readonly factNote: HTMLElement;
  readonly palette: HTMLElement;
  readonly viewPixels: HTMLButtonElement;
  readonly viewVectors: HTMLButtonElement;
  readonly zoomIn: HTMLButtonElement;
  readonly zoomOut: HTMLButtonElement;
  readonly editTools: HTMLElement;
  readonly toolDrag: HTMLButtonElement;
  readonly toolErase: HTMLButtonElement;
  readonly toolBrush: HTMLButtonElement;
  readonly brushTrace: HTMLButtonElement;
};

const SVG_NS = "http://www.w3.org/2000/svg";
const SAFE_ATTRS = ["viewBox", "width", "height", "fill", "stroke", "stroke-width", "stroke-linejoin", "d", "cx", "cy", "r", "rx", "ry", "x", "y", "transform", "opacity", "fill-rule", "id"];

function getElement(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (value === null) throw new Error("Missing panel element: " + id);
  return value;
}

function getButton(id: string): HTMLButtonElement {
  const value = getElement(id);
  if (!(value instanceof HTMLButtonElement)) throw new Error("Expected button: " + id);
  return value;
}

function getInput(id: string): HTMLInputElement {
  const value = getElement(id);
  if (!(value instanceof HTMLInputElement)) throw new Error("Expected input: " + id);
  return value;
}

function getOutput(id: string): HTMLOutputElement {
  const value = getElement(id);
  if (!(value instanceof HTMLOutputElement)) throw new Error("Expected output: " + id);
  return value;
}

function getProgress(id: string): HTMLProgressElement {
  const value = getElement(id);
  if (!(value instanceof HTMLProgressElement)) throw new Error("Expected progress bar: " + id);
  return value;
}

function getUi(): Ui {
  const preview = getElement("preview");
  const preset = getElement("preset");
  const brushCanvas = getElement("brush-canvas");
  if (!(preview instanceof HTMLImageElement)) throw new Error("Expected preview image");
  if (!(preset instanceof HTMLSelectElement)) throw new Error("Expected preset selector");
  if (!(brushCanvas instanceof HTMLCanvasElement)) throw new Error("Expected brush canvas");
  const clustering = getElement("clustering");
  if (!(clustering instanceof HTMLSelectElement)) throw new Error("Expected clustering selector");
  const stacking = getElement("stacking");
  if (!(stacking instanceof HTMLSelectElement)) throw new Error("Expected stacking selector");
  const controls: ControlElements = {
    mode: preset,
    maxColors: getInput("max-colors"),
    snapBlends: getInput("snap"),
    speckArea: getInput("speck"),
    removeBackground: getInput("backdrop"),
    backdropSpread: getInput("spread"),
    opaqueAt: getInput("opaque"),
    traceColors: getInput("trace-colors"),
    lockPalette: getInput("lock"),
    colorPrecision: getInput("precision"),
    filterSpeckle: getInput("speckle"),
    clustering,
    watershedDetail: getInput("watershed"),
    simplify: getInput("simplify"),
    stacking,
    dropPlate: getInput("drop-plate"),
    fitGeometry: getInput("fit"),
    smoothness: getInput("smooth"),
    corner: getInput("corner"),
    seal: getInput("seal"),
    sealWidth: getInput("seal-width")
  };
  const controlStatus = new Map<PresetControlField, ControlStatusUi>();
  for (const field of PRESET_CONTROL_FIELDS) {
    const element = controls[field];
    const label = element instanceof HTMLInputElement && element.type === "checkbox" ? element.closest("label") : null;
    const anchor = label ?? element;
    const marker = document.createElement("div");
    marker.id = "control-state-" + field;
    marker.className = "control-state";
    marker.hidden = true;
    const note = document.createElement("span");
    note.textContent = "แก้ไขแล้ว";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "control-reset";
    reset.textContent = "คืนค่า preset";
    reset.setAttribute("aria-label", "คืนค่า preset: " + PRESET_CONTROL_LABELS[field]);
    marker.append(note, reset);
    anchor.insertAdjacentElement("afterend", marker);
    controlStatus.set(field, { marker, reset });
  }
  return {
    selection: getElement("selection"),
    presetsSection: getElement("presets-section"),
    presetCards: Array.from(document.querySelectorAll<HTMLButtonElement>("#preset-gallery .preset-card")),
    presetConfirm: getElement("preset-confirm"),
    presetConfirmText: getElement("preset-confirm-text"),
    presetConfirmApply: getButton("preset-confirm-apply"),
    presetConfirmCancel: getButton("preset-confirm-cancel"),
    controlsSection: getElement("controls-section"),
    presetOrigin: getElement("preset-origin"),
    controlStatus,
    status: getElement("status"),
    phase: getElement("phase"),
    progressStatus: getElement("progress-status"),
    progressBar: getProgress("progress-bar"),
    progressLabel: getElement("progress-label"),
    progressValue: getElement("progress-value"),
    preview,
    previewEmpty: getElement("preview-empty"),
    stage: getElement("vector-stage"),
    brushCanvas,
    refresh: getButton("refresh"),
    trace: getButton("trace"),
    cancel: getButton("cancel"),
    apply: getButton("apply"),
    batch: getButton("batch"),
    preset,
    reset: getButton("reset-controls"),
    stepButtons: Array.from(document.querySelectorAll<HTMLButtonElement>("#step-tabs button")),
    stepFields: Array.from(document.querySelectorAll<HTMLFieldSetElement>("#step-controls fieldset")),
    controls,
    facts: getElement("facts"),
    factPaths: getElement("fact-paths"),
    factAnchors: getElement("fact-anchors"),
    factHoles: getElement("fact-holes"),
    factColors: getElement("fact-colors"),
    factNote: getElement("fact-note"),
    palette: getElement("palette"),
    viewPixels: getButton("view-pixels"),
    viewVectors: getButton("view-vectors"),
    zoomIn: getButton("zoom-in"),
    zoomOut: getButton("zoom-out"),
    editTools: getElement("edit-tools"),
    toolDrag: getButton("tool-drag"),
    toolErase: getButton("tool-erase"),
    toolBrush: getButton("tool-brush"),
    brushTrace: getButton("brush-trace")
  };
}

function illustratorHost(): CepBridge | null {
  const cep = (window as Window & { __adobe_cep__?: unknown }).__adobe_cep__;
  if (cep === undefined || typeof CSInterface === "undefined") return null;
  return new CSInterface();
}

function parseHostResult(raw: string): string[] {
  if (raw === "EvalScript error.") throw new Error("Illustrator เรียกสคริปต์ไม่สำเร็จ");
  const parts = raw.split("|");
  const kind = parts[0];
  if (kind === "ERR") throw new Error(decodeURIComponent(parts[1] ?? "Illustrator error"));
  if (kind !== "OK") throw new Error("Illustrator ส่งข้อมูลรูปแบบที่ไม่รู้จัก");
  return parts.slice(1).map((part) => decodeURIComponent(part));
}

function parsePositiveNumber(raw: string | undefined, label: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error("ค่าจาก Illustrator ไม่ถูกต้อง: " + label);
  return value;
}

function parseFiniteNumber(raw: string | undefined, label: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error("ค่าจาก Illustrator ไม่ถูกต้อง: " + label);
  return value;
}

function parseSelection(parts: string[]): Selection {
  if (parts.length !== 11) throw new Error("ข้อมูลภาพที่เลือกไม่ครบ");
  const itemType = parts[3] ?? "";
  if (itemType === "") throw new Error("ข้อมูลภาพที่เลือกไม่ครบ");
  const uuid = parts[4];
  if (!uuid) throw new Error("ภาพที่เลือกไม่มี Illustrator UUID");
  const left = parseFiniteNumber(parts[5], "left");
  const top = parseFiniteNumber(parts[6], "top");
  const right = parseFiniteNumber(parts[7], "right");
  const bottom = parseFiniteNumber(parts[8], "bottom");
  return {
    documentName: parts[0] ?? "",
    documentIdentity: parts[1] ?? "",
    itemName: parts[2] ?? "",
    itemType,
    uuid,
    bounds: [left, top, right, bottom],
    widthPt: parsePositiveNumber(String(right - left), "width"),
    heightPt: parsePositiveNumber(String(top - bottom), "height"),
    embedded: parts[9] === "1",
    fromResult: parts[10] === "1"
  };
}

function callHost(host: CepBridge, method: "VP_snapshot" | "VP_capture" | "VP_commit" | "VP_list", args: readonly string[] = []): Promise<string[]> {
  const encoded = args.map((value) => '"' + encodeURIComponent(value) + '"').join(",");
  const script = method + "(" + encoded + ")";
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = window.setTimeout(() => {
      if (finished) return;
      finished = true;
      reject(new HostTimeoutError());
    }, 180000);
    host.evalScript(script, (raw) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      try {
        resolve(parseHostResult(raw));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function newJob(settings: PipelineSettings, controls: LabControls): Job {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vector-panel-"));
  return {
    id: crypto.randomBytes(8).toString("hex"),
    directory,
    pngPath: path.join(directory, "source.png"),
    svgPath: path.join(directory, "result.svg"),
    settings,
    controls,
    cancelled: false
  };
}

function cleanJob(job: Job): void {
  try {
    fs.rmSync(job.directory, { recursive: true, force: true });
  } catch (_) {
    // A later startup can remove a temp directory left by a filesystem error.
  }
}

function cleanStaleJobs(): void {
  try {
    const root = os.tmpdir();
    for (const name of fs.readdirSync(root)) {
      if (!name.startsWith("vector-panel-")) continue;
      const directory = path.join(root, name);
      const stat = fs.statSync(directory);
      if (stat.isDirectory() && Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1000) {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  } catch (_) {
    // Temp cleanup is best effort and must not stop the panel from opening.
  }
}

function runVtracer(binary: string, job: Job, inputPath: string, outputPath: string, request: TraceRequest, onStart: (child: ChildProcess) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(binary, vtracerArguments(inputPath, outputPath, request), { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    onStart(child);
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 4000) stderr += chunk.toString("utf8").slice(0, 4000 - stderr.length);
    });
    child.once("error", (error) => reject(error));
    child.once("close", (code) => {
      if (job.cancelled) {
        reject(new Error("ยกเลิกแล้ว"));
      } else if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        resolve();
      } else {
        reject(new Error("VTracer แปลงภาพไม่สำเร็จ" + (stderr ? ": " + stderr.trim() : "")));
      }
    });
  });
}

function readControls(ui: Ui): LabControls {
  const fields = ui.controls;
  const mode = fields.mode.value;
  if (mode !== "logo" && mode !== "icon" && mode !== "photo" && mode !== "poster") throw new Error("Preset ไม่ถูกต้อง");
  return {
    mode,
    maxColors: Number(fields.maxColors.value),
    snapBlends: fields.snapBlends.checked,
    speckArea: Number(fields.speckArea.value),
    removeBackground: fields.removeBackground.checked,
    backdropSpread: Number(fields.backdropSpread.value),
    opaqueAt: Number(fields.opaqueAt.value),
    traceColors: Number(fields.traceColors.value),
    lockPalette: fields.lockPalette.checked,
    colorPrecision: Number(fields.colorPrecision.value),
    filterSpeckle: Number(fields.filterSpeckle.value),
    clustering: fields.clustering.value === "watershed" ? "watershed" : "off",
    watershedDetail: Number(fields.watershedDetail.value),
    simplify: Number(fields.simplify.value),
    stacking: fields.stacking.value === "stacked" ? "stacked" : "cutout",
    dropPlate: fields.dropPlate.checked,
    fitGeometry: fields.fitGeometry.checked,
    smoothness: Number(fields.smoothness.value),
    corner: Number(fields.corner.value),
    seal: fields.seal.checked,
    sealWidth: Number(fields.sealWidth.value)
  };
}

function applyControls(ui: Ui, controls: LabControls): void {
  const fields = ui.controls;
  fields.mode.value = controls.mode;
  fields.maxColors.value = String(controls.maxColors);
  fields.snapBlends.checked = controls.snapBlends;
  fields.speckArea.value = String(controls.speckArea);
  fields.removeBackground.checked = controls.removeBackground;
  fields.backdropSpread.value = String(controls.backdropSpread);
  fields.opaqueAt.value = String(controls.opaqueAt);
  fields.traceColors.value = String(controls.traceColors);
  fields.lockPalette.checked = controls.lockPalette;
  fields.colorPrecision.value = String(controls.colorPrecision);
  fields.filterSpeckle.value = String(controls.filterSpeckle);
  fields.clustering.value = controls.clustering;
  fields.watershedDetail.value = String(controls.watershedDetail);
  fields.simplify.value = String(controls.simplify);
  fields.stacking.value = controls.stacking;
  fields.dropPlate.checked = controls.dropPlate;
  fields.fitGeometry.checked = controls.fitGeometry;
  fields.smoothness.value = String(controls.smoothness);
  fields.corner.value = String(controls.corner);
  fields.seal.checked = controls.seal;
  fields.sealWidth.value = String(controls.sealWidth);
  syncControlOutputs(ui);
}

function syncControlOutputs(ui: Ui): void {
  const fields = ui.controls;
  const values: Readonly<Record<string, string>> = {
    "max-colors": fields.maxColors.value === "0" ? "อัตโนมัติ" : fields.maxColors.value,
    speck: fields.speckArea.value,
    spread: fields.backdropSpread.value,
    opaque: fields.opaqueAt.value,
    "trace-colors": fields.traceColors.value,
    precision: fields.colorPrecision.value,
    speckle: fields.filterSpeckle.value,
    simplify: Number(fields.simplify.value).toFixed(2),
    watershed: fields.watershedDetail.value,
    smooth: Number(fields.smoothness.value).toFixed(1),
    corner: fields.corner.value + "°",
    "seal-width": Number(fields.sealWidth.value).toFixed(1)
  };
  for (const [id, value] of Object.entries(values)) {
    const output = getOutput(id + "-value");
    output.value = value;
    output.textContent = value;
  }
  fields.traceColors.disabled = fields.lockPalette.checked;
  fields.watershedDetail.disabled = fields.clustering.value !== "watershed";
  fields.sealWidth.disabled = !fields.seal.checked;
}

function svgDataUrl(svg: string): string {
  return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
}

function pngDataUrl(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return "data:image/png;base64," + Buffer.from(bytes).toString("base64");
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index] ?? 0);
  return "data:image/png;base64," + btoa(binary);
}

function settingsNote(settings: PipelineSettings): string {
  return "preset=" + settings.preset + ";colors=" + settings.maxColors + ";smooth=" + settings.smoothness + ";corner=" + settings.corner + ";stacking=" + settings.stacking + ";background=" + (settings.removeBackground ? "removed" : "kept");
}

function sameControls(left: LabControls, right: LabControls): boolean {
  return CONTROL_STEPS.every(({ field }) => left[field] === right[field]);
}

function showFacts(ui: Ui, facts: TraceFacts | null): void {
  if (facts === null) {
    ui.facts.hidden = true;
    ui.factNote.hidden = true;
    ui.factNote.textContent = "";
    return;
  }
  ui.factPaths.textContent = String(facts.paths);
  ui.factAnchors.textContent = String(facts.anchors);
  ui.factHoles.textContent = String(facts.holes);
  ui.factColors.textContent = String(facts.colors);
  ui.facts.hidden = false;
  const note = [holeNote(facts.holes), shapeNote(facts)].filter((item) => item !== null).join(" · ");
  ui.factNote.hidden = note === "";
  ui.factNote.textContent = note;
}

function showSelection(ui: Ui, selection: Selection | null): void {
  ui.selection.replaceChildren();
  if (selection === null) {
    ui.selection.textContent = "เลือกภาพหรือกลุ่มบน artboard";
    return;
  }
  const title = document.createElement("strong");
  title.textContent = selection.itemName || selection.itemType;
  const detail = document.createElement("small");
  const kind = selection.itemType === "GroupItem" ? "กลุ่ม" : selection.itemType === "PlacedItem" ? "linked" : selection.embedded ? "embedded" : "raster";
  detail.textContent = selection.documentName + " · " + kind + " · " + Math.round(selection.widthPt) + " × " + Math.round(selection.heightPt) + " pt";
  if (selection.fromResult) detail.textContent += " · แปลงซ้ำเป็นเวอร์ชันใหม่";
  ui.selection.append(title, detail);
}

function currentSelection(state: State): Selection | null {
  switch (state.kind) {
    case "empty": return null;
    case "loading": return null;
    case "selected":
    case "capturing":
    case "planning":
    case "tracing":
    case "preview":
    case "applying": return state.selection;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function previewOf(state: State): Preview | null {
  if (state.kind === "preview" || state.kind === "applying") return state;
  return null;
}

function copySvgElement(node: Element): Element | null {
  const name = node.localName;
  if (name !== "svg" && name !== "g" && name !== "path" && name !== "circle" && name !== "ellipse" && name !== "rect") return null;
  const next = document.createElementNS(SVG_NS, name);
  for (const attr of SAFE_ATTRS) {
    const value = node.getAttribute(attr);
    if (value !== null && !/^\s*javascript:/i.test(value)) next.setAttribute(attr, value);
  }
  for (const child of Array.from(node.children)) {
    const copied = copySvgElement(child);
    if (copied !== null) next.append(copied);
  }
  return next;
}

function adoptSvg(svgText: string): SVGSVGElement | null {
  const parsed = new DOMParser().parseFromString(svgText, "image/svg+xml");
  if (parsed.querySelector("parsererror") !== null) return null;
  const root = parsed.documentElement;
  if (root.localName !== "svg") return null;
  const copy = copySvgElement(root);
  return copy instanceof SVGSVGElement ? copy : null;
}

function pathDataAt(svg: string, pathIndex: number): string | null {
  const tags = svg.match(/<path\b[^>]*\/>|<path\b[^>]*>[\s\S]*?<\/path>/gi) ?? [];
  const tag = tags[pathIndex];
  if (tag === undefined) return null;
  const match = /\bd\s*=\s*"([^"]*)"|\bd\s*=\s*'([^']*)'/i.exec(tag);
  return match?.[1] ?? match?.[2] ?? null;
}

function svgPoint(svg: SVGSVGElement, event: PointerEvent): { x: number; y: number } | null {
  const matrix = svg.getScreenCTM();
  if (matrix === null) return null;
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const local = point.matrixTransform(matrix.inverse());
  return { x: local.x, y: local.y };
}

function start(): void {
  const ui = getUi();
  let state: State = { kind: "empty" };
  let view: "vector" | "pixels" = "vector";
  let zoom = 1;
  let tool: Tool = "none";
  let brushColor: string | null = null;
  let brushPixels: Uint8Array | null = null;
  let batching = false;
  let stopBatch = false;
  let pendingFocus: { pathIndex: number; anchorIndex: number } | null = null;
  let edited = false;
  let selectedStep: LabStepId = "colors";
  let presetState: PresetState = emptyPresetState();
  let pendingPreset: TracePreset | null = null;
  const browserFixture = new URLSearchParams(window.location.search).get("fixture") === "1";
  let latestPlan: TracePlan | null = null;
  let latestSvgs: string[] = [];
  let latestVectors: ReturnType<typeof vectorStagesForPlan> | null = null;
  let latestPreview: Preview | null = null;
  let fixtureControls: LabControls | null = null;
  let retraceTimer = 0;
  let retraceQueued = false;
  let liveControls: LabControls | null = null;
  const host = illustratorHost();
  const extensionPath = host === null ? "" : host.getSystemPath(SystemPath.EXTENSION);
  let progressTimer = 0;
  let pendingProgress: StepProgress | null = null;
  let progressOperationLabel: string | null = null;
  let progressDone = false;
  let displayedProgress = -1;

  function flushProgress(): void {
    progressTimer = 0;
    if (pendingProgress === null) return;
    const progress = pendingProgress;
    pendingProgress = null;
    const percent = Math.min(100, Math.max(0, Math.round(progress.percent)));
    ui.progressStatus.hidden = false;
    ui.progressLabel.textContent = progressDone ? "เสร็จแล้ว" : progressOperationLabel ?? ("กำลัง" + PROGRESS_LABELS[progress.step]);
    ui.progressValue.textContent = String(percent) + "%";
    ui.progressBar.value = percent;
    displayedProgress = percent;
  }

  function queueProgress(progress: StepProgress): void {
    pendingProgress = progress;
    if (displayedProgress < 0 || progress.percent >= 100) {
      if (progressTimer !== 0) window.clearTimeout(progressTimer);
      flushProgress();
      return;
    }
    if (progressTimer === 0) progressTimer = window.setTimeout(flushProgress, 50);
  }

  function beginProgress(from: LabStepId, label: string | null = null): ProgressReporter {
    if (progressTimer !== 0) window.clearTimeout(progressTimer);
    progressTimer = 0;
    pendingProgress = null;
    progressOperationLabel = label;
    progressDone = false;
    displayedProgress = -1;
    ui.progressStatus.hidden = false;
    return createProgressReporter(from, queueProgress);
  }

  function finishProgress(progress: ProgressReporter): void {
    progress.finish();
    progressDone = true;
    pendingProgress = { step: "seal", fraction: 1, percent: 100 };
    flushProgress();
  }

  function hideProgress(): void {
    if (progressTimer !== 0) window.clearTimeout(progressTimer);
    progressTimer = 0;
    pendingProgress = null;
    progressDone = false;
    displayedProgress = -1;
    progressOperationLabel = null;
    ui.progressStatus.hidden = true;
  }

  function presetName(preset: TracePreset): string {
    return PRESET_PRESENTATION.find((option) => option.preset === preset)?.label ?? preset;
  }

  function runFixtureRetrace(): void {
    if (browserFixture) scheduleRetrace();
  }

  function activatePreset(preset: TracePreset): void {
    const selected = selectPreset(preset);
    presetState = selected;
    pendingPreset = null;
    applyControls(ui, selected.controls);
    selectedStep = "colors";
    render();
    if (host !== null) void trace();
    else runFixtureRetrace();
  }

  function choosePreset(preset: TracePreset): void {
    if (presetState.kind === "selected" && presetState.preset === preset) {
      pendingPreset = null;
      render();
      if (host !== null) void trace();
      else runFixtureRetrace();
      return;
    }
    if (hasPresetEdits(presetState)) {
      pendingPreset = preset;
      render();
      return;
    }
    activatePreset(preset);
  }

  function updatePresetUi(busy: boolean): void {
    const selectionAvailable = currentSelection(state) !== null && state.kind !== "loading";
    ui.presetsSection.hidden = !selectionAvailable;
    ui.controlsSection.hidden = !selectionAvailable || presetState.kind === "unselected";
    for (const card of ui.presetCards) {
      card.disabled = busy || !selectionAvailable;
      card.setAttribute("aria-pressed", presetState.kind === "selected" && card.dataset.preset === presetState.preset ? "true" : "false");
    }
    ui.presetConfirm.hidden = pendingPreset === null || busy;
    if (pendingPreset !== null && presetState.kind === "selected") {
      const count = modifiedPresetControlCount(presetState);
      ui.presetConfirmText.textContent = "เปลี่ยนจาก " + presetName(presetState.preset) + " เป็น " + presetName(pendingPreset) + " และเริ่มด้วยค่า preset ใหม่หรือไม่? (แก้ไขแล้ว " + String(count) + " ค่า)";
    }
    if (presetState.kind === "selected") {
      const count = modifiedPresetControlCount(presetState);
      ui.presetOrigin.textContent = "จาก preset: " + presetName(presetState.preset) + (count === 0 ? " • ยังไม่แก้ไข" : " • แก้ไขแล้ว " + String(count) + " ค่า");
    } else {
      ui.presetOrigin.textContent = "";
    }
    const modified = new Set(modifiedPresetControls(presetState));
    for (const field of PRESET_CONTROL_FIELDS) {
      const isModified = modified.has(field);
      const control = ui.controls[field];
      const label = control instanceof HTMLInputElement && control.type === "checkbox" ? control.closest("label") : null;
      control.classList.toggle("is-modified", isModified);
      label?.classList.toggle("is-modified", isModified);
      const status = ui.controlStatus.get(field);
      if (status !== undefined) {
        status.marker.hidden = !isModified;
        if (isModified) control.setAttribute("aria-describedby", status.marker.id);
        else control.removeAttribute("aria-describedby");
      }
    }
    ui.reset.disabled = busy || !hasPresetEdits(presetState);
  }

  function message(value: string, isError = false): void {
    ui.status.textContent = value;
    ui.status.classList.toggle("error", isError);
  }

  function showStep(): void {
    for (const button of ui.stepButtons) button.setAttribute("aria-pressed", button.dataset.step === selectedStep ? "true" : "false");
    for (const field of ui.stepFields) field.hidden = field.id !== "fields-" + selectedStep;
  }

  function syncOutputs(): void {
    syncControlOutputs(ui);
  }

  function commitSvg(svgText: string, focus: { pathIndex: number; anchorIndex: number } | null = null): void {
    if (state.kind !== "preview") return;
    pendingFocus = focus;
    if (state.job !== null) fs.writeFileSync(state.job.svgPath, svgText);
    state = { ...state, svgText, facts: scoreSvg(svgText), dataUrl: svgDataUrl(svgText) };
    latestPreview = state;
    render();
  }

  function showPalette(): void {
    const preview = previewOf(state);
    const palette = preview?.facts.palette ?? [];
    ui.palette.replaceChildren();
    if (palette.length === 0) {
      ui.palette.hidden = true;
      return;
    }
    for (const color of palette) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.title = color;
      button.setAttribute("aria-label", color);
      button.setAttribute("aria-pressed", color === brushColor ? "true" : "false");
      if (/^#[0-9a-f]{6}$/i.test(color)) button.style.backgroundColor = color;
      button.addEventListener("click", () => {
        brushColor = color;
        tool = "brush";
        view = "pixels";
        message("ระบายบนพิกเซล แล้วกดแปลงจากแปรง");
        render();
      });
      item.append(button);
      ui.palette.append(item);
    }
    ui.palette.hidden = false;
  }

  function mountStage(svgText: string): void {
    ui.stage.replaceChildren();
    const svg = adoptSvg(svgText);
    if (svg === null) return;
    const viewBox = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/) ?? [];
    const boxWidth = Number(viewBox[2] ?? svg.getAttribute("width") ?? 100);
    const radius = Math.max(2.5, (Number.isFinite(boxWidth) ? boxWidth : 100) / 48);
    svg.classList.toggle("zoom-2", zoom === 2);
    svg.classList.toggle("zoom-4", zoom === 4);
    let shapeIndex = 0;
    let pathIndex = 0;
    const shapes = svg.querySelectorAll("path, circle, ellipse, rect");
    shapes.forEach((shape) => {
      const currentShape = shapeIndex;
      shapeIndex += 1;
      shape.setAttribute("data-shape-index", String(currentShape));
      if (tool === "erase") {
        shape.addEventListener("pointerdown", (event) => {
          if (!(event instanceof PointerEvent) || event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          if (state.kind !== "preview") return;
          const next = removeShape(state.svgText, currentShape);
          if (next === state.svgText) {
            message("เหลือชิ้นสุดท้ายแล้ว", true);
            return;
          }
          edited = true;
          message("ลบชิ้นแล้ว");
          commitSvg(next);
        });
      }
      if (shape.localName !== "path" || tool !== "drag") return;
      const currentPath = pathIndex;
      pathIndex += 1;
      shape.setAttribute("data-path-index", String(currentPath));
      const parent = shape.parentElement ?? svg;
      for (const anchor of listAnchors(svgText).filter((item) => item.pathIndex === currentPath)) {
        const handle = document.createElementNS(SVG_NS, "circle");
        handle.setAttribute("class", "anchor-handle");
        handle.setAttribute("cx", String(anchor.x));
        handle.setAttribute("cy", String(anchor.y));
        handle.setAttribute("r", String(radius));
        handle.setAttribute("fill", "#cfb6ff");
        handle.setAttribute("stroke", "#241735");
        handle.setAttribute("stroke-width", String(Math.max(0.4, radius / 5)));
        handle.setAttribute("tabindex", "0");
        handle.setAttribute("role", "button");
        handle.setAttribute("aria-label", "จุดยึด " + String(anchor.anchorIndex + 1));
        parent.append(handle);
        let live = svgText;
        const follow = (next: string): void => {
          live = next;
          const data = pathDataAt(next, currentPath);
          if (data !== null) shape.setAttribute("d", data);
          const points = listAnchors(next);
          svg.querySelectorAll(".anchor-handle").forEach((node, index) => {
            const point = points[index];
            if (point === undefined) return;
            node.setAttribute("cx", String(point.x));
            node.setAttribute("cy", String(point.y));
          });
        };
        handle.addEventListener("pointerdown", (event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          handle.classList.add("dragging");
          handle.setPointerCapture(event.pointerId);
        });
        handle.addEventListener("pointermove", (event) => {
          if (!handle.hasPointerCapture(event.pointerId)) return;
          const point = svgPoint(svg, event);
          if (point === null) return;
          follow(moveAnchor(live, currentPath, anchor.anchorIndex, point.x, point.y));
        });
        handle.addEventListener("lostpointercapture", () => {
          handle.classList.remove("dragging");
          if (live === svgText) return;
          edited = true;
          commitSvg(live, { pathIndex: currentPath, anchorIndex: anchor.anchorIndex });
        });
        handle.addEventListener("keydown", (event) => {
          const step = event.shiftKey ? 8 : 1;
          const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
          const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
          if (dx === 0 && dy === 0) return;
          event.preventDefault();
          const current = listAnchors(live).find((item) => item.pathIndex === currentPath && item.anchorIndex === anchor.anchorIndex);
          if (current === undefined) return;
          edited = true;
          commitSvg(moveAnchor(live, currentPath, anchor.anchorIndex, current.x + dx, current.y + dy), { pathIndex: currentPath, anchorIndex: anchor.anchorIndex });
        });
      }
    });
    ui.stage.append(svg);
    if (pendingFocus !== null) {
      const target = pendingFocus;
      pendingFocus = null;
      const handles = svg.querySelectorAll(".anchor-handle");
      const index = listAnchors(svgText).findIndex((item) => item.pathIndex === target.pathIndex && item.anchorIndex === target.anchorIndex);
      const handle = handles[index];
      if (handle instanceof SVGElement) handle.focus();
    }
  }

  function drawBrush(): void {
    const preview = previewOf(state);
    if (preview?.raster == null) return;
    const pixels = brushPixels ?? preview.raster.rgba;
    if (ui.brushCanvas.width !== preview.raster.width) ui.brushCanvas.width = preview.raster.width;
    if (ui.brushCanvas.height !== preview.raster.height) ui.brushCanvas.height = preview.raster.height;
    const context = ui.brushCanvas.getContext("2d");
    if (context === null) return;
    const image = context.createImageData(preview.raster.width, preview.raster.height);
    image.data.set(pixels);
    context.putImageData(image, 0, 0);
  }

  function render(): void {
    showStep();
    showSelection(ui, currentSelection(state));
    const busy = batching || state.kind === "loading" || state.kind === "capturing" || state.kind === "planning" || state.kind === "tracing" || state.kind === "applying";
    updatePresetUi(busy);
    ui.refresh.disabled = busy;
    ui.trace.disabled = busy || state.kind === "empty" || presetState.kind === "unselected";
    ui.batch.disabled = busy || presetState.kind === "unselected";
    ui.trace.textContent = currentSelection(state)?.fromResult ? "สร้างเวอร์ชันใหม่" : "สร้างตัวอย่าง";
    ui.apply.disabled = state.kind !== "preview" || state.job === null || !sameControls(state.job.controls, readControls(ui));
    ui.cancel.hidden = state.kind !== "planning" && state.kind !== "tracing" && !batching;
    ui.phase.textContent = state.kind === "loading" ? "ตรวจภาพ" : state.kind === "capturing" ? "อ่านภาพ" : state.kind === "planning" ? "จัดสี" : state.kind === "tracing" ? "กำลังแปลง" : state.kind === "applying" ? "กำลังใส่ผล" : batching ? "แปลงหลายภาพ" : state.kind === "preview" ? "พร้อมใส่ผล" : "พร้อม";
    const currentPreview = previewOf(state);
    const preview = currentPreview ?? (state.kind === "planning" || state.kind === "tracing" ? latestPreview : null);
    const showing = preview !== null;
    const outputStep = selectedStep === "seal";
    ui.viewPixels.hidden = !showing || !outputStep;
    ui.viewVectors.hidden = !showing || !outputStep;
    ui.zoomIn.hidden = !showing;
    ui.zoomOut.hidden = !showing;
    ui.editTools.hidden = !showing || !outputStep || state.kind !== "preview";
    ui.viewPixels.setAttribute("aria-pressed", view === "pixels" ? "true" : "false");
    ui.viewVectors.setAttribute("aria-pressed", view === "vector" ? "true" : "false");
    ui.toolDrag.setAttribute("aria-pressed", tool === "drag" ? "true" : "false");
    ui.toolErase.setAttribute("aria-pressed", tool === "erase" ? "true" : "false");
    ui.toolBrush.setAttribute("aria-pressed", tool === "brush" ? "true" : "false");
    ui.brushTrace.disabled = !showing || brushPixels === null || preview?.job == null || state.kind !== "preview";
    ui.preview.classList.toggle("zoom-2", showing && zoom === 2);
    ui.preview.classList.toggle("zoom-4", showing && zoom === 4);
    ui.brushCanvas.classList.toggle("zoom-2", showing && zoom === 2);
    ui.brushCanvas.classList.toggle("zoom-4", showing && zoom === 4);
    const editingVectors = showing && outputStep && state.kind === "preview" && view === "vector" && (tool === "drag" || tool === "erase");
    const brushing = showing && outputStep && state.kind === "preview" && tool === "brush";
    if (preview !== null) {
      ui.previewEmpty.hidden = true;
      showFacts(ui, preview.facts);
      showPalette();
      if (brushing) {
        ui.preview.hidden = true;
        ui.stage.hidden = true;
        ui.brushCanvas.hidden = false;
        drawBrush();
      } else if (editingVectors) {
        ui.preview.hidden = true;
        ui.brushCanvas.hidden = true;
        ui.stage.hidden = false;
        const editable = tool === "drag" ? expandPrimitives(preview.svgText) : preview.svgText;
        if (tool === "drag" && editable !== preview.svgText && state.kind === "preview") {
          commitSvg(editable);
          return;
        }
        mountStage(editable);
      } else {
        ui.stage.hidden = true;
        ui.brushCanvas.hidden = true;
        ui.preview.hidden = false;
        if (!outputStep) {
          const raster = selectedStep === "capture" ? preview.raster?.rgba : latestPlan?.rasterStages?.[selectedStep === "colors" ? "colors" : selectedStep === "backdrop" ? "backdrop" : "punch"];
          const vector = selectedStep === "trace" ? latestVectors?.trace : selectedStep === "fit" ? latestVectors?.fitted : selectedStep === "fair" ? latestVectors?.faired : null;
          if (vector !== null && vector !== undefined) ui.preview.src = svgDataUrl(vector);
          else if (raster !== undefined && raster !== null && preview.raster !== null) {
            ui.preview.src = pngDataUrl(encodeRgbaPng(preview.raster.width, preview.raster.height, raster));
          } else ui.preview.removeAttribute("src");
        } else {
          ui.preview.src = view === "pixels" ? preview.pngUrl : preview.dataUrl;
        }
      }
    } else {
      ui.preview.removeAttribute("src");
      ui.preview.hidden = true;
      ui.stage.hidden = true;
      ui.brushCanvas.hidden = true;
      ui.previewEmpty.hidden = false;
      showFacts(ui, null);
      showPalette();
    }
  }

  function planInWorker(
    selection: Selection,
    job: Job,
    sourcePng: Buffer,
    previousPlan: TracePlan | null,
    from: LabStepId,
    progress: ProgressReporter
  ): Promise<TracePlan | null> {
    liveControls = job.controls;
    const Ctor = loadWorkerConstructor();
    let worker: Worker | null = null;
    if (Ctor !== null) {
      try {
        worker = new Ctor(path.join(extensionPath, "js", "pipeline-worker.js"));
      } catch {
        workerConstructor = null;
        worker = null;
      }
    }
    if (worker === null) return planInPanel(selection, job, sourcePng, previousPlan, from, progress);
    const activeWorker = worker;
    state = { kind: "planning", selection, job, runner: { cancel: () => { void activeWorker.terminate(); } }, from };
    message("กำลังจัดสีและเตรียมขั้นลากเส้น…");
    render();
    return new Promise((resolve, reject) => {
      let settled = false;
      let received = false;
      const timer = window.setTimeout(() => {
        fail(new Error("ขั้นจัดสีใช้เวลานานเกิน " + String(Math.round(PLAN_TIMEOUT_MS / 1000)) + " วินาที · ลองลดขนาดภาพหรือจำนวนสี"));
      }, PLAN_TIMEOUT_MS);
      const settle = (): boolean => {
        if (settled) return false;
        settled = true;
        window.clearTimeout(timer);
        void activeWorker.terminate();
        return true;
      };
      const finish = (plan: TracePlan | null): void => {
        if (settle()) resolve(plan);
      };
      const fail = (error: Error): void => {
        if (settle()) reject(error);
      };
      const fallback = (): void => {
        // The worker could not run in this host. Plan in the panel instead of hanging.
        workerConstructor = null;
        if (!settle()) return;
        if (job.cancelled) {
          reject(new Error("ยกเลิกแล้ว"));
          return;
        }
        planInPanel(selection, job, sourcePng, previousPlan, from, progress).then(resolve, reject);
      };
      activeWorker.on("message", (value: unknown) => {
        if (job.cancelled) {
          fail(new Error("ยกเลิกแล้ว"));
          return;
        }
        const result = parsePlanWorkerMessage(value);
        if (result === null) {
          fail(new Error("ผลจากขั้นจัดสีไม่ถูกต้อง"));
        } else if (result.kind === "progress") {
          progress.report(result.progress.step, result.progress.fraction);
        } else if (result.kind === "error") {
          received = true;
          fail(new Error(result.error));
        } else {
          received = true;
          finish(result.plan);
        }
      });
      activeWorker.once("error", () => {
        if (job.cancelled) fail(new Error("ยกเลิกแล้ว"));
        else fallback();
      });
      activeWorker.once("exit", (code) => {
        if (settled) return;
        if (job.cancelled) fail(new Error("ยกเลิกแล้ว"));
        else if (!received) fallback();
        else fail(new Error("ขั้นจัดสีหยุดก่อนจบ (" + String(code) + ")"));
      });
      try {
        activeWorker.postMessage({
          sourcePng: new Uint8Array(sourcePng),
          settings: job.settings,
          controls: job.controls,
          previousStages: previousPlan?.rasterStages ?? null,
          from
        });
      } catch {
        fallback();
      }
    });
  }

  /** Same planning as the worker, on the panel thread. Used only when worker_threads is unavailable. */
  async function planInPanel(
    selection: Selection,
    job: Job,
    sourcePng: Buffer,
    previousPlan: TracePlan | null,
    from: LabStepId,
    progress: ProgressReporter
  ): Promise<TracePlan | null> {
    let cancelled = false;
    state = { kind: "planning", selection, job, runner: { cancel: () => { cancelled = true; } }, from };
    message("กำลังจัดสีและเตรียมขั้นลากเส้น…");
    render();
    await new Promise<void>((resolve) => { window.setTimeout(resolve, 50); });
    if (job.cancelled) throw new Error("ยกเลิกแล้ว");
    const plan = await planTraceAsync(sourcePng, job.settings, job.controls, previousPlan?.rasterStages ?? null, from, (step, fraction) => progress.report(step, fraction), () => cancelled || job.cancelled);
    if (job.cancelled || cancelled) throw new Error("ยกเลิกแล้ว");
    return plan;
  }

  async function vectorize(
    selection: Selection,
    job: Job,
    palette?: readonly string[],
    previousPlan: TracePlan | null = null,
    from: LabStepId = "colors",
    progress: ProgressReporter = beginProgress(from)
  ): Promise<void> {
    if (!fs.existsSync(job.pngPath) || fs.statSync(job.pngPath).size === 0) throw new Error("Illustrator ไม่ได้ส่งภาพ PNG กลับมา");
    const binary = resolveVtracer(path.join(extensionPath, "bin", process.platform === "win32" ? "vtracer.exe" : "vtracer"));
    if (!fs.existsSync(binary)) throw new Error("ไม่พบ VTracer ที่ " + binary);
    const sourcePng = fs.readFileSync(job.pngPath);
    liveControls = job.controls;
    const flatMode = job.controls.mode === "logo" || job.controls.mode === "icon";
    const reuseExistingPlan = previousPlan !== null && (from === "trace" || (flatMode && LAB_STEPS.indexOf(from) > LAB_STEPS.indexOf("colors")));
    let plan = reuseExistingPlan
      ? replanTracePlan(previousPlan, job.controls)
      : await planInWorker(selection, job, sourcePng, previousPlan, from, progress);
    if (reuseExistingPlan && flatMode) {
      if (LAB_STEPS.indexOf(from) <= LAB_STEPS.indexOf("backdrop")) progress.report("backdrop", 1);
      if (LAB_STEPS.indexOf(from) <= LAB_STEPS.indexOf("punch")) progress.report("punch", 1);
    }
    const controls = liveControls ?? job.controls;
    job = { ...job, controls, settings: settingsFromControls(controls) };
    if (plan !== null) plan = replanTracePlan(plan, controls);
    if (plan === null || plan.plates.length === 0) throw new Error("อ่าน PNG ไม่ได้");
    progress.report("trace", 0);
    message("กำลังแยกโซนสี แล้วสร้างเส้นเวกเตอร์…");
    const svgs: string[] = [];
    for (let index = 0; index < plan.plates.length; index += 1) {
      const plate = plan.plates[index];
      if (plate === undefined) continue;
      const pngPath = path.join(job.directory, "trace-" + String(index) + ".png");
      const svgPath = path.join(job.directory, "trace-" + String(index) + ".svg");
      fs.writeFileSync(pngPath, plate.png);
      const brushed = palette !== undefined && job.settings.preset !== "logo" && job.settings.preset !== "icon";
      const request = brushed ? { ...plate.request, maxColors: 0, palette: cappedPalette(palette, "#ff00ff") } : plate.request;
      progress.report("trace", index / plan.plates.length);
      await runVtracer(binary, job, pngPath, svgPath, request, (child) => {
        state = { kind: "tracing", selection, job, child };
        render();
      });
      svgs.push(fs.readFileSync(svgPath, "utf8"));
      progress.report("trace", (index + 1) / plan.plates.length);
    }
    const finishedControls = liveControls ?? job.controls;
    job = { ...job, controls: finishedControls, settings: settingsFromControls(finishedControls) };
    edited = false;
    latestPlan = plan;
    latestSvgs = svgs;
    latestVectors = vectorStagesForPlan(svgs, plan, job.controls, progress.report);
    const svgText = latestVectors.sealed;
    fs.writeFileSync(job.svgPath, svgText);
    const decoded = readRgbaPng(sourcePng);
    brushPixels = null;
    tool = "none";
    view = "vector";
    zoom = 1;
    state = {
      kind: "preview",
      selection,
      job,
      dataUrl: svgDataUrl(svgText),
      pngUrl: pngDataUrl(sourcePng),
      svgText,
      raster: decoded === null ? null : { width: decoded.width, height: decoded.height, rgba: decoded.rgba },
      facts: scoreSvg(svgText)
    };
    selectedStep = "seal";
    latestPreview = state;
    liveControls = null;
    finishProgress(progress);
    message("เทียบพิกเซลกับเวกเตอร์ แล้วกดใส่ใน Illustrator");
    render();
  }

  async function refresh(): Promise<void> {
    if (host === null) {
      message("เปิด Panel นี้จาก Adobe Illustrator เท่านั้น", true);
      return;
    }
    if (state.kind === "loading" || state.kind === "capturing" || state.kind === "planning" || state.kind === "tracing" || state.kind === "applying" || batching) return;
    if (state.kind === "preview" && state.job !== null) cleanJob(state.job);
    latestPlan = null;
    latestSvgs = [];
    latestVectors = null;
    latestPreview = null;
    liveControls = null;
    const progress = beginProgress("capture", "ตรวจภาพ");
    state = { kind: "loading" };
    render();
    try {
      const selection = parseSelection(await callHost(host, "VP_snapshot"));
      progress.report("capture", 1);
      finishProgress(progress);
      state = { kind: "selected", selection };
      message("ภาพพร้อมแปลง");
    } catch (error) {
      hideProgress();
      state = { kind: "empty" };
      message(errorMessage(error), true);
    }
    render();
  }

  async function trace(): Promise<void> {
    if (host === null) {
      message("เปิด Panel นี้จาก Adobe Illustrator เท่านั้น", true);
      return;
    }
    if (state.kind !== "selected" && state.kind !== "preview") return;
    const selection = state.selection;
    if (state.kind === "preview" && state.job !== null) cleanJob(state.job);
    latestPlan = null;
    latestSvgs = [];
    latestVectors = null;
    latestPreview = null;
    liveControls = null;
    const controls = readControls(ui);
    let job = newJob(settingsFromControls(controls), controls);
    const progress = beginProgress("capture");
    try {
      state = { kind: "capturing", selection, job };
      message("กำลังอ่านภาพจาก Illustrator…");
      render();
      await callHost(host, "VP_capture", [selection.uuid, job.pngPath, selection.documentIdentity]);
      progress.report("capture", 1);
      const capturedControls = readControls(ui);
      job = { ...job, settings: settingsFromControls(capturedControls), controls: capturedControls, cancelled: false };
      retraceQueued = false;
      while (true) {
        try {
          await vectorize(selection, job, undefined, null, "colors", progress);
          break;
        } catch (error) {
          if (!job.cancelled || !retraceQueued) throw error;
          retraceQueued = false;
          const currentControls = readControls(ui);
          job = { ...job, settings: settingsFromControls(currentControls), controls: currentControls, cancelled: false };
          state = { kind: "capturing", selection, job };
          message("ใช้ค่าล่าสุด แล้วเริ่มลากเส้นใหม่…");
          render();
        }
      }
      if (retraceQueued) {
        retraceQueued = false;
        await retraceFromCapture();
      }
    } catch (error) {
      if (!job.cancelled || !retraceQueued) hideProgress();
      cleanJob(job);
      state = { kind: "selected", selection };
      latestPreview = null;
      liveControls = null;
      message(errorMessage(error), true);
      render();
    }
  }

  async function apply(): Promise<boolean> {
    if (host === null || state.kind !== "preview" || state.job === null) return false;
    if (!batching && !sameControls(state.job.controls, readControls(ui))) {
      message("กำลังปรับผลให้ตรงกับค่าล่าสุด…");
      scheduleRetrace();
      render();
      return false;
    }
    const preview = state;
    const job = state.job;
    state = { ...preview, kind: "applying" };
    message("กำลังนำ path เข้า Illustrator…");
    render();
    try {
      const result = await callHost(host, "VP_commit", [preview.selection.uuid, job.svgPath, job.id, settingsNote(job.settings), preview.selection.bounds.join(","), preview.selection.documentIdentity]);
      message("ใส่ผลแล้ว: " + (result[1] ?? "0") + " paths · ต้นฉบับยังอยู่");
      cleanJob(job);
      state = { kind: "selected", selection: preview.selection };
      render();
      return true;
    } catch (error) {
      if (error instanceof HostTimeoutError) {
        message("Illustrator ยังไม่ตอบกลับ ตรวจ Layers ก่อนเริ่มงานใหม่ เพื่อไม่สร้างผลซ้ำ", true);
        state = { kind: "selected", selection: preview.selection };
      } else {
        message(errorMessage(error), true);
        state = preview;
      }
      render();
      return false;
    }
  }

  async function batch(): Promise<void> {
    if (host === null) {
      message("เปิด Panel นี้จาก Adobe Illustrator เท่านั้น", true);
      return;
    }
    if (batching || state.kind === "loading" || state.kind === "capturing" || state.kind === "planning" || state.kind === "tracing" || state.kind === "applying") return;
    if (state.kind === "preview" && state.job !== null) cleanJob(state.job);
    batching = true;
    stopBatch = false;
    render();
    let finished = 0;
    try {
      const list = parseBatchFields(await callHost(host, "VP_list"));
      if (list.items.length === 0) throw new Error("ไม่พบภาพ raster ในเอกสาร");
      for (const item of list.items) {
        if (stopBatch) break;
        const selection: Selection = {
          documentName: list.documentName,
          documentIdentity: list.documentIdentity,
          itemName: item.name || "ภาพที่เลือก",
          itemType: item.itemType,
          uuid: item.uuid,
          bounds: item.bounds,
          widthPt: item.bounds[2] - item.bounds[0],
          heightPt: item.bounds[1] - item.bounds[3],
          embedded: item.embedded,
          fromResult: false
        };
        const controls = readControls(ui);
        const job = newJob(settingsFromControls(controls), controls);
        const progress = beginProgress("capture");
        message("กำลังแปลงภาพ " + String(finished + 1) + "/" + String(list.items.length) + " · " + selection.itemName);
        state = { kind: "capturing", selection, job };
        render();
        try {
          await callHost(host, "VP_capture", [item.uuid, job.pngPath, list.documentIdentity, "1"]);
          progress.report("capture", 1);
          await vectorize(selection, job, undefined, null, "colors", progress);
          const placed = await apply();
          if (!placed) return;
          finished += 1;
        } catch (error) {
          hideProgress();
          cleanJob(job);
          throw error;
        }
      }
      message(stopBatch ? "หยุดที่ภาพ " + String(finished) : "แปลงครบ " + String(finished) + " ภาพ");
    } catch (error) {
      hideProgress();
      message(errorMessage(error), true);
    } finally {
      batching = false;
      stopBatch = false;
      render();
    }
  }

  async function retraceBrush(): Promise<void> {
    if (state.kind !== "preview" || state.job === null || state.raster === null || brushPixels === null) {
      message("ระบายสีก่อนแปลงจากแปรง", true);
      return;
    }
    const palette = paletteFromRaster(brushPixels);
    const selection = state.selection;
    const job = state.job;
    try {
      fs.writeFileSync(job.pngPath, encodeRgbaPng(state.raster.width, state.raster.height, brushPixels));
      const flat = job.settings.preset === "logo" || job.settings.preset === "icon";
      message(flat ? "แปลงใหม่จากพิกเซลที่ระบาย" : palette === null ? "สีมากกว่า 32 สี จึงให้ VTracer จัดกลุ่มสีเอง" : "ใช้สีจากแปรง " + String(palette.length) + " สี");
      await vectorize(selection, job, flat ? undefined : palette ?? undefined);
    } catch (error) {
      message(errorMessage(error), true);
      render();
    }
  }

  function paintEvent(event: PointerEvent): void {
    const preview = previewOf(state);
    if (preview?.raster == null || brushColor === null || tool !== "brush") return;
    const rect = ui.brushCanvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = ((event.clientX - rect.left) * preview.raster.width) / rect.width;
    const y = ((event.clientY - rect.top) * preview.raster.height) / rect.height;
    const radius = Math.max(2, preview.raster.width / 28);
    brushPixels = paintDisc(brushPixels ?? preview.raster.rgba, preview.raster.width, preview.raster.height, x, y, radius, brushColor);
    drawBrush();
    ui.brushTrace.disabled = preview.job === null;
  }

  function chooseTool(next: Tool, note: string): void {
    tool = tool === next ? "none" : next;
    if (tool === "brush") view = "pixels";
    if (tool === "drag" || tool === "erase") view = "vector";
    message(tool === "none" ? "พร้อมใส่ผล" : note);
    render();
  }

  function scheduleRetrace(): void {
    window.clearTimeout(retraceTimer);
    retraceTimer = window.setTimeout(() => { void retraceFromCapture(); }, 150);
  }

  function updateStylePreview(from: LabStepId, controls: LabControls): void {
    if (state.kind !== "preview" || state.job === null || latestPlan === null || latestVectors === null) return;
    if (edited) {
      message("แก้ชิ้นแล้ว จึงไม่เขียนทับการแก้ไข จนกว่าจะแปลงใหม่", true);
      return;
    }
    const previous = state;
    const currentJob = previous.job;
    if (currentJob === null) return;
    const progress = beginProgress(from);
    const job = { ...currentJob, settings: settingsFromControls(controls), controls };
    let vectors = latestVectors;
    if (from === "fit") {
      vectors = vectorStagesForPlan(latestSvgs, latestPlan, controls, progress.report);
    } else if (from === "fair") {
      progress.report("fair", 0);
      const faired = fairLabVector(vectors.fitted, controls);
      progress.report("fair", 1);
      progress.report("seal", 0);
      vectors = { ...vectors, faired, sealed: sealLabVector(faired, controls) };
      progress.report("seal", 1);
    } else {
      progress.report("seal", 0);
      vectors = { ...vectors, sealed: sealLabVector(vectors.faired, controls) };
      progress.report("seal", 1);
    }
    latestVectors = vectors;
    fs.writeFileSync(job.svgPath, vectors.sealed);
    const nextPreview: Preview = { ...previous, job, svgText: vectors.sealed, facts: scoreSvg(vectors.sealed), dataUrl: svgDataUrl(vectors.sealed) };
    state = { kind: "preview", ...nextPreview };
    latestPreview = nextPreview;
    finishProgress(progress);
    message("ปรับขั้น " + from + " แล้ว");
    render();
  }

  async function retraceFromCapture(): Promise<void> {
    if (batching) return;
    if (state.kind === "planning") {
      const controls = readControls(ui);
      const baseline = liveControls ?? state.job.controls;
      if (sameControls(baseline, controls)) return;
      const changed = earliestChangedStep(baseline, controls);
      if (LAB_STEPS.indexOf(changed) > LAB_STEPS.indexOf("punch")) {
        liveControls = controls;
        message("ค่าขั้นถัดไปจะใช้ทันทีที่การจัดสีจบ");
        return;
      }
      liveControls = controls;
      retraceQueued = true;
      state.job.cancelled = true;
      state.runner.cancel();
      message("ค่าปรับเปลี่ยนแล้ว · กำลังหยุดการจัดสีเก่า…");
      return;
    }
    if (state.kind === "tracing") {
      const controls = readControls(ui);
      const baseline = liveControls ?? state.job.controls;
      if (sameControls(baseline, controls)) return;
      const changed = earliestChangedStep(baseline, controls);
      if (LAB_STEPS.indexOf(changed) >= LAB_STEPS.indexOf("fit")) {
        liveControls = controls;
        message("ค่าขั้น " + changed + " จะใช้หลังลากเส้นจบ");
        return;
      }
      liveControls = controls;
      retraceQueued = true;
      state.job.cancelled = true;
      state.child.kill();
      message("ค่าปรับเปลี่ยนแล้ว · กำลังหยุดเส้นเก่า…");
      return;
    }
    if (state.kind === "capturing") {
      retraceQueued = true;
      return;
    }
    if (state.kind === "applying" || batching) return;
    if (state.kind !== "preview") return;
    const current = state.job;
    const controls = readControls(ui);
    if (current === null) {
      if (fixtureControls === null || latestVectors === null || sameControls(fixtureControls, controls)) return;
      if (edited) {
        message("แก้ชิ้นแล้ว จึงไม่เขียนทับการแก้ไข จนกว่าจะแปลงใหม่", true);
        return;
      }
      const svg = latestVectors.trace;
      const styled = styleLabVectors(svg, controls, null, null);
      latestVectors = { trace: svg, ...styled };
      fixtureControls = controls;
      const nextPreview: Preview = { ...state, dataUrl: svgDataUrl(styled.sealed), svgText: styled.sealed, facts: scoreSvg(styled.sealed) };
      state = { kind: "preview", ...nextPreview };
      latestPreview = nextPreview;
      render();
      return;
    }
    if (!fs.existsSync(current.pngPath)) return;
    retraceQueued = false;
    const previous = state;
    if (sameControls(current.controls, controls)) return;
    const from = earliestChangedStep(current.controls, controls);
    if (LAB_STEPS.indexOf(from) >= LAB_STEPS.indexOf("fit")) {
      updateStylePreview(from, controls);
      return;
    }
    const job: Job = {
      id: current.id,
      directory: current.directory,
      pngPath: current.pngPath,
      svgPath: current.svgPath,
      settings: settingsFromControls(controls),
      controls,
      cancelled: false
    };
    try {
      message("กำลังคำนวณขั้น " + from + " แล้วลากเส้นใหม่…");
      await vectorize(previous.selection, job, undefined, latestPlan, from);
    } catch (error) {
      state = previous;
      latestPreview = previous;
      if (job.cancelled && retraceQueued) {
        retraceQueued = false;
        await retraceFromCapture();
        return;
      }
      hideProgress();
      liveControls = null;
      message(errorMessage(error), true);
      render();
    }
    if (retraceQueued) {
      retraceQueued = false;
      void retraceFromCapture();
    }
  }

  function loadFixture(): void {
    const radians = (15 * Math.PI) / 180;
    let stair = "M88,18";
    for (let step = 0; step < 14; step += 1) stair += " h1 v1";
    const kink = "M88,78 L98,78 L" + (98 + 10 * Math.cos(radians)).toFixed(2) + "," + (78 - 10 * Math.sin(radians)).toFixed(2);
    const svgText = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100" viewBox="0 0 160 100"><path fill="#d6363e" d="M8,8 H58 V58 H8 Z"/><path fill="#2e66d6" d="' + stair + '"/><path fill="#f2b830" d="' + kink + '"/></svg>';
    edited = false;
    const width = 80;
    const height = 48;
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const color = x < 27 ? [0xd6, 0x36, 0x3e] : x < 54 ? [0x2e, 0x66, 0xd6] : [0xf2, 0xb8, 0x30];
        const offset = (y * width + x) * 4;
        rgba[offset] = color[0] ?? 0;
        rgba[offset + 1] = color[1] ?? 0;
        rgba[offset + 2] = color[2] ?? 0;
        rgba[offset + 3] = 255;
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    let pngUrl = "";
    if (context !== null) {
      const image = context.createImageData(width, height);
      image.data.set(rgba);
      context.putImageData(image, 0, 0);
      pngUrl = canvas.toDataURL("image/png");
    }
    const styled = styleLabVectors(svgText, readControls(ui), null, null);
    latestVectors = { trace: svgText, ...styled };
    fixtureControls = readControls(ui);
    selectedStep = "seal";
    state = {
      kind: "preview",
      selection: {
        documentName: "ตัวอย่าง",
        documentIdentity: "fixture",
        itemName: "ภาพตัวอย่าง",
        itemType: "RasterItem",
        uuid: "fixture",
        bounds: [0, 100, 160, 0],
        widthPt: 160,
        heightPt: 100,
        embedded: true,
        fromResult: false
      },
      job: null,
      dataUrl: svgDataUrl(styled.sealed),
      pngUrl,
      svgText: styled.sealed,
      raster: { width, height, rgba },
      facts: scoreSvg(styled.sealed)
    };
    latestPreview = state;
    message("ตัวอย่างในเบราว์เซอร์: ลากจุด ลบชิ้น หรือระบายสีได้");
    render();
  }

  ui.refresh.addEventListener("click", () => { void refresh(); });
  for (const card of ui.presetCards) {
    card.addEventListener("click", () => {
      const option = PRESET_PRESENTATION.find((candidate) => candidate.preset === card.dataset.preset);
      if (option !== undefined) choosePreset(option.preset);
    });
  }
  ui.presetConfirmApply.addEventListener("click", () => {
    if (pendingPreset !== null) activatePreset(pendingPreset);
  });
  ui.presetConfirmCancel.addEventListener("click", () => {
    pendingPreset = null;
    render();
  });
  for (const [field, status] of ui.controlStatus) {
    status.reset.addEventListener("click", () => {
      if (presetState.kind === "unselected") return;
      const reset = resetPresetControl(presetState, field);
      presetState = reset;
      if (reset.kind === "selected") applyControls(ui, reset.controls);
      render();
      scheduleRetrace();
    });
  }
  ui.trace.addEventListener("click", () => { void trace(); });
  ui.apply.addEventListener("click", () => { void apply(); });
  ui.batch.addEventListener("click", () => { void batch(); });
  ui.brushTrace.addEventListener("click", () => { void retraceBrush(); });
  ui.cancel.addEventListener("click", () => {
    stopBatch = true;
    if (state.kind === "planning") {
      retraceQueued = false;
      window.clearTimeout(retraceTimer);
      state.job.cancelled = true;
      state.runner.cancel();
      hideProgress();
      message("กำลังยกเลิก…");
      return;
    }
    if (state.kind !== "tracing") return;
    retraceQueued = false;
    window.clearTimeout(retraceTimer);
    state.job.cancelled = true;
    state.child.kill();
    hideProgress();
    message("กำลังยกเลิก…");
  });
  const modeField = ui.controls.mode;
  for (const field of Object.values(ui.controls)) {
    if (field === modeField) continue;
    field.addEventListener("input", () => {
      if (field === ui.controls.stacking) ui.controls.sealWidth.value = field.value === "cutout" ? "2" : "0.8";
      syncOutputs();
      presetState = updatePresetControls(presetState, readControls(ui));
      render();
      scheduleRetrace();
    });
    field.addEventListener("change", () => {
      if (field === ui.controls.stacking) ui.controls.sealWidth.value = field.value === "cutout" ? "2" : "0.8";
      syncOutputs();
      presetState = updatePresetControls(presetState, readControls(ui));
      render();
      scheduleRetrace();
    });
  }
  ui.reset.addEventListener("click", () => {
    presetState = resetPresetControls(presetState);
    if (presetState.kind === "selected") applyControls(ui, presetState.controls);
    render();
    scheduleRetrace();
  });
  for (const button of ui.stepButtons) {
    button.addEventListener("click", () => {
      const step = LAB_STEPS.find((candidate) => candidate === button.dataset.step);
      if (step === undefined) return;
      selectedStep = step;
      render();
    });
  }
  ui.viewPixels.addEventListener("click", () => {
    view = "pixels";
    if (tool === "drag" || tool === "erase") tool = "none";
    render();
  });
  ui.viewVectors.addEventListener("click", () => {
    view = "vector";
    if (tool === "brush") tool = "none";
    render();
  });
  ui.zoomIn.addEventListener("click", () => {
    zoom = zoom === 1 ? 2 : 4;
    render();
  });
  ui.zoomOut.addEventListener("click", () => {
    zoom = zoom === 4 ? 2 : 1;
    render();
  });
  ui.toolDrag.addEventListener("click", () => { chooseTool("drag", "ลากจุด หรือใช้ปุ่มลูกศรเมื่อจุดถูกเลือก"); });
  ui.toolErase.addEventListener("click", () => { chooseTool("erase", "แตะชิ้นที่ต้องการลบ"); });
  ui.toolBrush.addEventListener("click", () => { chooseTool("brush", "เลือกสีจากแถบ แล้วระบายบนพิกเซล"); });
  ui.brushCanvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || brushColor === null) return;
    ui.brushCanvas.setPointerCapture(event.pointerId);
    paintEvent(event);
  });
  ui.brushCanvas.addEventListener("pointermove", (event) => {
    if (!ui.brushCanvas.hasPointerCapture(event.pointerId)) return;
    paintEvent(event);
  });

  window.addEventListener("beforeunload", () => {
    if ((state.kind === "preview" || state.kind === "applying") && state.job !== null) cleanJob(state.job);
    if (state.kind === "tracing") {
      state.job.cancelled = true;
      state.child.kill();
      cleanJob(state.job);
    }
    if (state.kind === "planning") {
      state.job.cancelled = true;
      state.runner.cancel();
      cleanJob(state.job);
    }
  });

  if (browserFixture) {
    const selected = selectPreset("logo");
    presetState = selected;
    applyControls(ui, selected.controls);
  } else {
    applyControls(ui, controlsFor(readControls(ui).mode));
  }
  if (host !== null) {
    cleanStaleJobs();
    render();
    void refresh();
  } else if (browserFixture) {
    loadFixture();
  } else {
    render();
    message("เปิด Panel นี้จาก Adobe Illustrator เท่านั้น", true);
  }
}

function showFatal(error: unknown): void {
  const status = document.getElementById("status");
  if (status === null) return;
  status.textContent = "Panel ขัดข้อง: " + (error instanceof Error ? error.message : String(error));
  status.classList.add("error");
}

window.addEventListener("error", (event) => { showFatal(event.error ?? event.message); });
window.addEventListener("unhandledrejection", (event) => { showFatal(event.reason); });

try {
  start();
} catch (error) {
  showFatal(error);
}
