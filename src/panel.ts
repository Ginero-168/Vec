import * as childProcess from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createColorEditor, type ColorEditor } from "./editor-ui";
import type { Rgb } from "./color/model";
import { decodePng, encodePng } from "./color/png";
import { countSvgFills, renderRgba, segmentImage, segmentationToSvg } from "./color/segment";

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
  readonly itemType: "PlacedItem" | "RasterItem";
  readonly uuid: string;
  readonly bounds: readonly [number, number, number, number];
  readonly widthPt: number;
  readonly heightPt: number;
  readonly embedded: boolean;
  readonly fromResult: boolean;
};

type Settings = {
  readonly preset: "logo" | "icon" | "photo";
  readonly maxColors: number;
  readonly simplify: number;
};

type Job = {
  readonly id: string;
  readonly directory: string;
  readonly pngPath: string;
  readonly flatPath: string;
  readonly svgPath: string;
  settings: Settings;
  cancelled: boolean;
};

type State =
  | { readonly kind: "empty" }
  | { readonly kind: "loading" }
  | { readonly kind: "selected"; readonly selection: Selection }
  | { readonly kind: "capturing"; readonly selection: Selection; readonly job: Job }
  | { readonly kind: "editing"; readonly selection: Selection; readonly job: Job }
  | { readonly kind: "tracing"; readonly selection: Selection; readonly job: Job; readonly child: childProcess.ChildProcess | null }
  | { readonly kind: "preview"; readonly selection: Selection; readonly job: Job; readonly dataUrl: string }
  | { readonly kind: "applying"; readonly selection: Selection; readonly job: Job; readonly dataUrl: string };

type Ui = {
  readonly selection: HTMLElement;
  readonly status: HTMLElement;
  readonly phase: HTMLElement;
  readonly preview: HTMLImageElement;
  readonly previewEmpty: HTMLElement;
  readonly refresh: HTMLButtonElement;
  readonly trace: HTMLButtonElement;
  readonly cancel: HTMLButtonElement;
  readonly apply: HTMLButtonElement;
  readonly preset: HTMLSelectElement;
  readonly colors: HTMLInputElement;
  readonly colorsValue: HTMLOutputElement;
  readonly smooth: HTMLInputElement;
  readonly smoothValue: HTMLOutputElement;
  readonly editorRoot: HTMLElement;
};

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

function getUi(): Ui {
  const preview = getElement("preview");
  const preset = getElement("preset");
  if (!(preview instanceof HTMLImageElement)) throw new Error("Expected preview image");
  if (!(preset instanceof HTMLSelectElement)) throw new Error("Expected preset selector");
  return {
    selection: getElement("selection"),
    status: getElement("status"),
    phase: getElement("phase"),
    preview,
    previewEmpty: getElement("preview-empty"),
    refresh: getButton("refresh"),
    trace: getButton("trace"),
    cancel: getButton("cancel"),
    apply: getButton("apply"),
    preset,
    colors: getInput("colors"),
    colorsValue: getOutput("colors-value"),
    smooth: getInput("smooth"),
    smoothValue: getOutput("smooth-value"),
    editorRoot: getElement("editor-root")
  };
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
  const itemType = parts[3];
  if (itemType !== "PlacedItem" && itemType !== "RasterItem") throw new Error("รองรับภาพ raster ที่เลือกหนึ่งภาพ");
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

function callHost(host: CepBridge, method: "VP_snapshot" | "VP_capture" | "VP_commit" | "VP_swatches", args: readonly string[] = []): Promise<string[]> {
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

function newJob(settings: Settings): Job {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vector-panel-"));
  return {
    id: crypto.randomBytes(8).toString("hex"),
    directory,
    pngPath: path.join(directory, "source.png"),
    flatPath: path.join(directory, "flat.png"),
    svgPath: path.join(directory, "result.svg"),
    settings,
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

function vtracerArguments(job: Job, maxColors: number): string[] {
  const args = [job.flatPath, job.svgPath];
  const preset = job.settings.preset;
  const colors = String(Math.max(2, maxColors));
  if (preset === "photo") {
    args.push("--preset", "photo", "--max-colors", colors);
  } else {
    args.push("--preset", "poster", "--hierarchical", "cutout", "--max-colors", colors);
    if (preset === "icon") args.push("--mode", "polygon");
  }
  if (job.settings.simplify > 0) args.push("--simplify", String(job.settings.simplify));
  args.push("--optimize", "1");
  return args;
}

function runVtracer(binary: string, job: Job, maxColors: number, onStart: (child: childProcess.ChildProcess) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(binary, vtracerArguments(job, maxColors), { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    onStart(child);
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 4000) stderr += chunk.toString("utf8").slice(0, 4000 - stderr.length);
    });
    child.once("error", (error) => reject(error));
    child.once("close", (code) => {
      if (job.cancelled) {
        reject(new Error("ยกเลิกแล้ว"));
      } else if (code === 0 && fs.existsSync(job.svgPath) && fs.statSync(job.svgPath).size > 0) {
        resolve();
      } else {
        reject(new Error("VTracer แปลงภาพไม่สำเร็จ" + (stderr ? ": " + stderr.trim() : "")));
      }
    });
  });
}

function readSettings(ui: Ui): Settings {
  const preset = ui.preset.value;
  if (preset !== "logo" && preset !== "icon" && preset !== "photo") throw new Error("Preset ไม่ถูกต้อง");
  const maxColors = Number(ui.colors.value);
  const simplify = Number(ui.smooth.value) / 10;
  if (!Number.isInteger(maxColors) || maxColors < 2 || maxColors > 32) throw new Error("จำนวนสีไม่ถูกต้อง");
  if (!Number.isFinite(simplify) || simplify < 0 || simplify > 3) throw new Error("ค่าความเรียบไม่ถูกต้อง");
  return { preset, maxColors, simplify };
}

function showSelection(ui: Ui, selection: Selection | null): void {
  ui.selection.replaceChildren();
  if (selection === null) {
    ui.selection.textContent = "เลือกภาพ raster หนึ่งภาพบน artboard";
    return;
  }
  const title = document.createElement("strong");
  title.textContent = selection.itemName || selection.itemType;
  const detail = document.createElement("small");
  detail.textContent = selection.documentName + " · " + (selection.embedded ? "embedded" : "linked") + " · " + Math.round(selection.widthPt) + " × " + Math.round(selection.heightPt) + " pt";
  if (selection.fromResult) detail.textContent += " · แปลงซ้ำเป็นเวอร์ชันใหม่";
  ui.selection.append(title, detail);
}

function currentSelection(state: State): Selection | null {
  switch (state.kind) {
    case "empty": return null;
    case "loading": return null;
    case "selected":
    case "capturing":
    case "editing":
    case "tracing":
    case "preview":
    case "applying": return state.selection;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

const RESET_CAPTURE = "การอ่านภาพแล้วแยกสีใหม่จะล้าง Zap, ดินสอ, เทสี และการรวมสีที่ทำไว้ ถ้าต้องการเส้นจากสีที่แก้อยู่ ให้กดดูเส้นแทน";
const RESET_SEGMENT = "การแยกสีใหม่จากภาพที่จับไว้จะล้างการแก้สีที่ทำด้วยมือ แล้วเริ่มนับสีจากภาพต้นฉบับอีกครั้ง";

function swatchPayload(palette: readonly Rgb[]): string {
  return palette.map((color) => color.r + "," + color.g + "," + color.b).join(";");
}

function start(): void {
  const ui = getUi();
  let state: State = { kind: "empty" };
  const extensionPath = typeof CSInterface === "undefined" ? "" : new CSInterface().getSystemPath(SystemPath.EXTENSION);
  const host = typeof CSInterface === "undefined" ? null : new CSInterface();
  const editor: ColorEditor = createColorEditor(ui.editorRoot, {
    onVectorPreview: () => { void vectorize(); },
    onResegment: () => { void resegment(); },
    onExportSwatches: (palette) => { void exportSwatches(palette); },
    onChange: (colorCount) => {
      if (state.kind === "editing") ui.phase.textContent = "แก้สี · " + colorCount + " สี";
      else if (state.kind === "preview") ui.phase.textContent = "พร้อมใส่ผล · " + colorCount + " สี";
    }
  });

  function message(value: string, isError = false): void {
    ui.status.textContent = value;
    ui.status.classList.toggle("error", isError);
  }

  function render(): void {
    showSelection(ui, currentSelection(state));
    const busy = state.kind === "loading" || state.kind === "capturing" || state.kind === "tracing" || state.kind === "applying";
    ui.refresh.disabled = busy;
    ui.trace.disabled = busy || state.kind === "empty";
    ui.trace.textContent = currentSelection(state)?.fromResult ? "สร้างเวอร์ชันใหม่" : "สร้างตัวอย่าง";
    ui.apply.disabled = state.kind !== "preview";
    ui.cancel.hidden = state.kind !== "tracing";
    ui.editorRoot.hidden = !editor.hasDocument();
    const count = editor.hasDocument() ? " · " + editor.colorCount() + " สี" : "";
    const phase = state.kind === "loading" ? "ตรวจภาพ" : state.kind === "capturing" ? "อ่านภาพ" : state.kind === "editing" ? "แก้สี" : state.kind === "tracing" ? "กำลังแปลง" : state.kind === "applying" ? "กำลังใส่ผล" : state.kind === "preview" ? "พร้อมใส่ผล" : "พร้อม";
    ui.phase.textContent = phase + (state.kind === "editing" || state.kind === "preview" || state.kind === "applying" ? count : "");
    if (state.kind === "preview" || state.kind === "applying") {
      ui.preview.src = state.dataUrl;
      ui.preview.hidden = false;
      ui.previewEmpty.hidden = true;
    } else {
      ui.preview.removeAttribute("src");
      ui.preview.hidden = true;
      ui.previewEmpty.hidden = false;
    }
  }

  function openSegmentation(job: Job): void {
    const decoded = decodePng(fs.readFileSync(job.pngPath));
    editor.load(segmentImage(decoded.data, decoded.width, decoded.height, job.settings.maxColors));
  }

  async function refresh(): Promise<void> {
    if (host === null) {
      message("เปิด Panel นี้จาก Adobe Illustrator เท่านั้น", true);
      return;
    }
    if (state.kind === "loading" || state.kind === "capturing" || state.kind === "tracing" || state.kind === "applying") return;
    if (!(await editor.confirmDiscard(RESET_CAPTURE))) return;
    if (state.kind === "preview" || state.kind === "editing") cleanJob(state.job);
    editor.clear();
    state = { kind: "loading" };
    render();
    try {
      const selection = parseSelection(await callHost(host, "VP_snapshot"));
      state = { kind: "selected", selection };
      message("ภาพพร้อมแปลง");
    } catch (error) {
      state = { kind: "empty" };
      message(errorMessage(error), true);
    }
    render();
  }

  async function trace(): Promise<void> {
    if (host === null) return;
    if (state.kind !== "selected" && state.kind !== "preview" && state.kind !== "editing") return;
    if (!(await editor.confirmDiscard(RESET_CAPTURE))) return;
    const selection = state.selection;
    if (state.kind === "preview" || state.kind === "editing") cleanJob(state.job);
    let job: Job | null = null;
    try {
      job = newJob(readSettings(ui));
      state = { kind: "capturing", selection, job };
      message("กำลังอ่านภาพจาก Illustrator…");
      render();
      await callHost(host, "VP_capture", [selection.uuid, job.pngPath, selection.documentIdentity]);
      if (!fs.existsSync(job.pngPath) || fs.statSync(job.pngPath).size === 0) throw new Error("Illustrator ไม่ได้ส่งภาพ PNG กลับมา");
      openSegmentation(job);
      state = { kind: "editing", selection, job };
      message("แยกได้ " + editor.colorCount() + " สี แก้บนแผนที่สี แล้วกดดูเส้นเมื่อพร้อม");
      render();
    } catch (error) {
      if (job !== null) cleanJob(job);
      editor.clear();
      state = { kind: "selected", selection };
      message(errorMessage(error), true);
      render();
    }
  }

  async function resegment(): Promise<void> {
    if (state.kind !== "editing" && state.kind !== "preview") return;
    if (!(await editor.confirmDiscard(RESET_SEGMENT))) return;
    const { selection, job } = state;
    try {
      job.settings = readSettings(ui);
      openSegmentation(job);
      state = { kind: "editing", selection, job };
      message("แยกสีใหม่ · " + editor.colorCount() + " สี");
    } catch (error) {
      message(errorMessage(error), true);
    }
    render();
  }

  async function vectorize(): Promise<void> {
    if ((state.kind !== "editing" && state.kind !== "preview") || !editor.hasDocument()) return;
    const { selection, job } = state;
    try {
      const segmentation = editor.segmentation();
      if (segmentation.palette.length === 0) throw new Error("ไม่มีสีให้แปลง");
      fs.writeFileSync(job.flatPath, encodePng(segmentation.width, segmentation.height, renderRgba(segmentation)));
      const binary = path.join(extensionPath, "bin", process.platform === "win32" ? "vtracer.exe" : "vtracer");
      let note = "";
      if (!fs.existsSync(binary)) {
        fs.writeFileSync(job.svgPath, segmentationToSvg(segmentation), "utf8");
        note = "ไม่พบ VTracer จึงแสดงสีที่แก้แบบพิกเซล";
      } else {
        message("กำลังสร้างเส้นจากสีที่แก้…");
        state = { kind: "tracing", selection, job, child: null };
        render();
        await runVtracer(binary, job, segmentation.palette.length, (child) => {
          state = { kind: "tracing", selection, job, child };
          render();
        });
      }
      const svg = fs.readFileSync(job.svgPath, "utf8");
      state = { kind: "preview", selection, job, dataUrl: "data:image/svg+xml;base64," + Buffer.from(svg, "utf8").toString("base64") };
      message((note ? note + " · " : "ดูตัวอย่างแล้วกดใส่ใน Illustrator · ") + "แผนที่สี " + editor.colorCount() + " · เวกเตอร์ " + countSvgFills(svg) + " สี");
      render();
    } catch (error) {
      state = { kind: "editing", selection, job };
      message(errorMessage(error), true);
      render();
    }
  }

  async function exportSwatches(palette: readonly Rgb[]): Promise<void> {
    if (host === null) {
      message("ใส่ Swatches ได้เมื่อเปิด Panel ใน Illustrator", true);
      return;
    }
    if (palette.length === 0) {
      message("ยังไม่มีสีให้ใส่", true);
      return;
    }
    const jobId = state.kind === "editing" || state.kind === "preview" || state.kind === "tracing" || state.kind === "applying" || state.kind === "capturing" ? state.job.id : "palette";
    try {
      const result = await callHost(host, "VP_swatches", ["Vector Panel " + jobId, swatchPayload(palette)]);
      message("ใส่ Swatches แล้ว " + (result[1] ?? String(palette.length)) + " สี ในกลุ่ม " + (result[0] ?? ""));
    } catch (error) {
      message(errorMessage(error), true);
    }
  }

  async function apply(): Promise<void> {
    if (host === null || state.kind !== "preview") return;
    const { selection, job, dataUrl } = state;
    state = { kind: "applying", selection, job, dataUrl };
    message("กำลังนำ path เข้า Illustrator…");
    render();
    try {
      const settings = "preset=" + job.settings.preset + ";colors=" + job.settings.maxColors + ";simplify=" + job.settings.simplify + ";edited=" + editor.colorCount();
      const result = await callHost(host, "VP_commit", [selection.uuid, job.svgPath, job.id, settings, selection.bounds.join(","), selection.documentIdentity]);
      message("ใส่ผลแล้ว: " + (result[1] ?? "0") + " paths · ต้นฉบับยังอยู่ · สี " + editor.colorCount());
      cleanJob(job);
      editor.clear();
      state = { kind: "selected", selection };
    } catch (error) {
      if (error instanceof HostTimeoutError) {
        message("Illustrator ยังไม่ตอบกลับ ตรวจ Layers ก่อนกดใส่ผลอีกครั้ง การแก้สียังอยู่", true);
        state = { kind: "editing", selection, job };
      } else {
        message(errorMessage(error), true);
        state = { kind: "preview", selection, job, dataUrl };
      }
    }
    render();
  }

  ui.refresh.addEventListener("click", () => { void refresh(); });
  ui.trace.addEventListener("click", () => { void trace(); });
  ui.apply.addEventListener("click", () => { void apply(); });
  ui.cancel.addEventListener("click", () => {
    if (state.kind !== "tracing") return;
    state.job.cancelled = true;
    state.child?.kill();
    message("กำลังยกเลิก…");
  });
  ui.colors.addEventListener("input", () => { ui.colorsValue.value = ui.colors.value; });
  ui.smooth.addEventListener("input", () => { ui.smoothValue.value = (Number(ui.smooth.value) / 10).toFixed(1); });
  ui.preset.addEventListener("change", () => {
    ui.colors.value = ui.preset.value === "photo" ? "24" : ui.preset.value === "icon" ? "4" : "8";
    ui.colorsValue.value = ui.colors.value;
  });

  window.addEventListener("beforeunload", () => {
    if (state.kind === "preview" || state.kind === "editing") cleanJob(state.job);
    if (state.kind === "tracing") {
      state.job.cancelled = true;
      state.child?.kill();
      cleanJob(state.job);
    }
  });

  cleanStaleJobs();
  render();
  void refresh();
}

start();
