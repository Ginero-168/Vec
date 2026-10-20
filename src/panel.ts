import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { pathToFileURL } from "url";
import { aspectMismatch, ImagePrepError, readRasterSize } from "./image-prep";
import { MAX_DECODE_PIXELS, MAX_TRACE_PIXELS } from "./limits";
import { TraceRunner } from "./trace-client";
import type { TraceRequest, TraceStage } from "./trace-job";

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
  readonly acquire: "file" | "capture";
  readonly linkedPath: string;
  readonly clipped: boolean;
  readonly viaGroup: boolean;
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
  readonly svgPath: string;
  readonly settings: Settings;
  cancelled: boolean;
};

type State =
  | { readonly kind: "empty" }
  | { readonly kind: "checking"; readonly previous: Selection | null }
  | { readonly kind: "selected"; readonly selection: Selection }
  | { readonly kind: "capturing"; readonly selection: Selection; readonly job: Job }
  | { readonly kind: "tracing"; readonly selection: Selection; readonly job: Job; readonly stage: TraceStage }
  | { readonly kind: "preview"; readonly selection: Selection; readonly job: Job; readonly previewUrl: string }
  | { readonly kind: "applying"; readonly selection: Selection; readonly job: Job; readonly previewUrl: string };

type Ui = {
  readonly root: HTMLElement;
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
  readonly steps: Readonly<Record<"check" | "read" | "trace" | "apply", HTMLElement>>;
};

const EMPTY_SELECTION = "เลือกภาพ raster หนึ่งภาพบน artboard";

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
    root: getElement("panel-root"),
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
    steps: {
      check: getElement("step-check"),
      read: getElement("step-read"),
      trace: getElement("step-trace"),
      apply: getElement("step-apply")
    }
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
  if (parts.length !== 15) throw new Error("ข้อมูลภาพที่เลือกไม่ครบ");
  const itemType = parts[3];
  if (itemType !== "PlacedItem" && itemType !== "RasterItem") throw new Error("รองรับภาพ raster ที่เลือกหนึ่งภาพ");
  const uuid = parts[4];
  if (!uuid) throw new Error("ภาพที่เลือกไม่มี Illustrator UUID");
  const acquire = parts[11];
  if (acquire !== "file" && acquire !== "capture") throw new Error("โหมดอ่านภาพไม่รู้จัก");
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
    fromResult: parts[10] === "1",
    acquire,
    linkedPath: parts[12] ?? "",
    clipped: parts[13] === "1",
    viaGroup: parts[14] === "1"
  };
}

function parseCapture(parts: string[]): { mode: "file" | "capture"; filePath: string; bytes: number } {
  const mode = parts[0];
  const filePath = parts[1] ?? "";
  if ((mode !== "file" && mode !== "capture") || filePath === "") throw new Error("ข้อมูลภาพจาก Illustrator ไม่ครบ");
  const bytes = Number(parts[2] ?? "0");
  if (!Number.isFinite(bytes) || bytes <= 0) throw new Error("ไฟล์ภาพว่าง");
  return { mode, filePath, bytes };
}

function callHost(host: CepBridge, method: "VP_snapshot" | "VP_capture" | "VP_commit", args: readonly string[] = []): Promise<string[]> {
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

async function cleanStaleJobs(): Promise<void> {
  try {
    const root = os.tmpdir();
    const names = await fs.promises.readdir(root);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const name of names) {
      if (!name.startsWith("vector-panel-")) continue;
      const directory = path.join(root, name);
      const stat = await fs.promises.stat(directory);
      if (stat.isDirectory() && stat.mtimeMs < cutoff) await fs.promises.rm(directory, { recursive: true, force: true });
    }
  } catch (_) {
    // Temp cleanup is best effort and must not stop the panel from opening.
  }
}

function vtracerArguments(job: Job): string[] {
  const args = [job.pngPath, job.svgPath];
  const preset = job.settings.preset;
  if (preset === "photo") {
    args.push("--preset", "photo", "--max-colors", String(job.settings.maxColors));
  } else {
    args.push("--preset", "poster", "--hierarchical", "cutout", "--max-colors", String(job.settings.maxColors));
    if (preset === "icon") args.push("--mode", "polygon");
  }
  if (job.settings.simplify > 0) args.push("--simplify", String(job.settings.simplify));
  args.push("--optimize", "1");
  return args;
}

function vtracerBinary(extensionPath: string): string {
  const override = process.env["VECTOR_PANEL_VTRACER"];
  if (override) return override;
  return path.join(extensionPath, "bin", process.platform === "win32" ? "vtracer.exe" : "vtracer");
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
  if (selection === null) {
    if (ui.selection.dataset["signature"] === "empty" && ui.selection.textContent === EMPTY_SELECTION) return;
    if (ui.selection.childElementCount === 0 && ui.selection.textContent === EMPTY_SELECTION) {
      ui.selection.dataset["signature"] = "empty";
      return;
    }
    ui.selection.dataset["signature"] = "empty";
    ui.selection.textContent = EMPTY_SELECTION;
    return;
  }
  const signature = [selection.uuid, selection.documentIdentity, selection.acquire, selection.viaGroup ? "1" : "0", selection.clipped ? "1" : "0", selection.fromResult ? "1" : "0"].join("|");
  if (ui.selection.dataset["signature"] === signature) return;
  ui.selection.dataset["signature"] = signature;
  ui.selection.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = selection.itemName || selection.itemType;
  const detail = document.createElement("small");
  let text = selection.documentName + " · " + (selection.embedded ? "embedded" : "linked") + " · " + Math.round(selection.widthPt) + " × " + Math.round(selection.heightPt) + " pt";
  if (selection.viaGroup) text += " · อยู่ในกลุ่ม";
  if (selection.clipped) text += " · มีคลิป";
  text += selection.acquire === "file" ? " · อ่านไฟล์ลิงก์" : " · ส่งออกจากเอกสาร";
  if (selection.fromResult) text += " · แปลงซ้ำเป็นเวอร์ชันใหม่";
  detail.textContent = text;
  ui.selection.append(title, detail);
}

function currentSelection(state: State): Selection | null {
  switch (state.kind) {
    case "empty": return null;
    case "checking": return state.previous;
    case "selected":
    case "capturing":
    case "tracing":
    case "preview":
    case "applying": return state.selection;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function isBusy(state: State): boolean {
  return state.kind === "checking" || state.kind === "capturing" || state.kind === "tracing" || state.kind === "applying";
}

function phaseText(state: State): string {
  switch (state.kind) {
    case "checking": return "ตรวจภาพ";
    case "capturing": return "อ่านภาพ";
    case "tracing":
      if (state.stage === "trace") return "กำลังแปลง";
      if (state.stage === "svg") return "อ่านผล";
      return "เตรียมภาพ";
    case "applying": return "ใส่ผล";
    case "preview": return "พร้อมใส่ผล";
    default: return "พร้อม";
  }
}

function stepStates(state: State): Record<"check" | "read" | "trace" | "apply", string> {
  if (state.kind === "checking") return { check: "current", read: "idle", trace: "idle", apply: "idle" };
  if (state.kind === "capturing") return { check: "done", read: "current", trace: "idle", apply: "idle" };
  if (state.kind === "tracing" && state.stage === "prepare") return { check: "done", read: "current", trace: "idle", apply: "idle" };
  if (state.kind === "tracing") return { check: "done", read: "done", trace: "current", apply: "idle" };
  if (state.kind === "preview") return { check: "done", read: "done", trace: "done", apply: "ready" };
  if (state.kind === "applying") return { check: "done", read: "done", trace: "done", apply: "current" };
  return { check: "idle", read: "idle", trace: "idle", apply: "idle" };
}

function setPreview(ui: Ui, url: string | null): void {
  if (url) {
    if (ui.preview.getAttribute("src") !== url) ui.preview.src = url;
    ui.preview.hidden = false;
    ui.previewEmpty.hidden = true;
    return;
  }
  if (ui.preview.hidden && ui.previewEmpty.hidden === false) return;
  ui.preview.removeAttribute("src");
  ui.preview.hidden = true;
  ui.previewEmpty.hidden = false;
}

async function linkedFileDecision(filePath: string, selection: Selection): Promise<string | null> {
  let size: { width: number; height: number } | null = null;
  try {
    size = await readRasterSize(filePath);
  } catch {
    return "อ่านไฟล์ลิงก์ไม่ได้ กำลังส่งออกจากเอกสาร…";
  }
  if (size === null) return "อ่านขนาดไฟล์ลิงก์ไม่ได้ กำลังส่งออกจากเอกสาร…";
  if (size.width * size.height > MAX_DECODE_PIXELS) return "ภาพต้นทางใหญ่กว่างบถอดรหัส กำลังส่งออกจากเอกสาร…";
  if (aspectMismatch(size.width, size.height, selection.widthPt, selection.heightPt)) return "สัดส่วนไม่ตรงไฟล์ต้นทาง กำลังส่งออกจากเอกสาร…";
  return null;
}

function start(): void {
  const ui = getUi();
  let state: State = { kind: "empty" };
  const extensionPath = typeof CSInterface === "undefined" ? "" : new CSInterface().getSystemPath(SystemPath.EXTENSION);
  const host = typeof CSInterface === "undefined" ? null : new CSInterface();
  const runner = host === null ? null : new TraceRunner(path.join(extensionPath, "js", "trace-worker.js"));

  function message(value: string, isError = false): void {
    ui.status.textContent = value;
    ui.status.classList.toggle("error", isError);
    const role = isError ? "alert" : "status";
    if (ui.status.getAttribute("role") !== role) ui.status.setAttribute("role", role);
  }

  function render(): void {
    showSelection(ui, currentSelection(state));
    const busy = isBusy(state);
    ui.root.setAttribute("aria-busy", busy ? "true" : "false");
    ui.refresh.disabled = busy;
    ui.trace.disabled = busy || state.kind === "empty" || state.kind === "checking";
    ui.trace.textContent = currentSelection(state)?.fromResult ? "สร้างเวอร์ชันใหม่" : "สร้างตัวอย่าง";
    ui.apply.disabled = state.kind !== "preview";
    ui.cancel.disabled = state.kind !== "capturing" && state.kind !== "tracing";
    const phase = phaseText(state);
    if (ui.phase.textContent !== phase) ui.phase.textContent = phase;
    const steps = stepStates(state);
    (Object.keys(steps) as Array<keyof typeof steps>).forEach((key) => {
      const element = ui.steps[key];
      const value = steps[key];
      if (element.getAttribute("data-state") !== value) element.setAttribute("data-state", value);
      if (value === "current") {
        if (element.getAttribute("aria-current") !== "step") element.setAttribute("aria-current", "step");
      } else if (element.hasAttribute("aria-current")) {
        element.removeAttribute("aria-current");
      }
    });
    if (state.kind === "preview" || state.kind === "applying") setPreview(ui, state.previewUrl);
    else setPreview(ui, null);
  }

  async function refresh(): Promise<void> {
    if (host === null) {
      message("เปิด Panel นี้จาก Adobe Illustrator เท่านั้น", true);
      return;
    }
    if (isBusy(state)) return;
    const previous = currentSelection(state);
    const jobToClean = state.kind === "preview" ? state.job : null;
    state = { kind: "checking", previous };
    message("กำลังตรวจภาพ…");
    render();
    if (jobToClean) cleanJob(jobToClean);
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

  async function capturePixels(selection: Selection, job: Job, mode: "" | "capture"): Promise<{ mode: "file" | "capture"; filePath: string }> {
    if (host === null) throw new Error("เปิด Panel นี้จาก Adobe Illustrator เท่านั้น");
    const captured = parseCapture(await callHost(host, "VP_capture", [selection.uuid, job.pngPath, selection.documentIdentity, mode]));
    if (job.cancelled) throw new Error("ยกเลิกแล้ว");
    return captured;
  }

  async function trace(): Promise<void> {
    if (host === null || runner === null) return;
    if (state.kind !== "selected" && state.kind !== "preview") return;
    const selection = state.selection;
    const jobToClean = state.kind === "preview" ? state.job : null;
    let job: Job | null = null;
    try {
      if (jobToClean) cleanJob(jobToClean);
      job = newJob(readSettings(ui));
      state = { kind: "capturing", selection, job };
      message("กำลังอ่านภาพจาก Illustrator…");
      render();
      let captured = await capturePixels(selection, job, "");
      if (captured.mode === "file") {
        const reason = await linkedFileDecision(captured.filePath, selection);
        if (reason !== null) {
          if (job.cancelled) throw new Error("ยกเลิกแล้ว");
          message(reason);
          render();
          captured = await capturePixels(selection, job, "capture");
        }
      }
      const binary = vtracerBinary(extensionPath);
      if (!fs.existsSync(binary)) throw new Error("ไม่พบ VTracer binary ใน extension/bin");
      const request: TraceRequest = {
        binary,
        sourcePath: captured.filePath,
        pngPath: job.pngPath,
        svgPath: job.svgPath,
        flags: vtracerArguments(job).slice(2),
        maxPixels: MAX_TRACE_PIXELS,
        maxDecodePixels: MAX_DECODE_PIXELS
      };
      state = { kind: "tracing", selection, job, stage: "prepare" };
      message("กำลังเตรียมภาพ…");
      render();
      let result;
      try {
        result = await runner.run(request, (stage) => {
          if (state.kind !== "tracing" || state.job !== job) return;
          state = { kind: "tracing", selection, job, stage };
          message(stage === "trace" ? "กำลังสร้างเส้นเวกเตอร์…" : stage === "svg" ? "กำลังอ่านผลลัพธ์…" : "กำลังเตรียมภาพ…");
          render();
        });
      } catch (error) {
        if (captured.mode === "file" && error instanceof ImagePrepError && job !== null && !job.cancelled) {
          message("ถอดรหัสไฟล์ลิงก์ไม่สำเร็จ กำลังส่งออกจากเอกสาร…");
          state = { kind: "capturing", selection, job };
          render();
          captured = await capturePixels(selection, job, "capture");
          state = { kind: "tracing", selection, job, stage: "prepare" };
          message("กำลังเตรียมภาพ…");
          render();
          result = await runner.run({ ...request, sourcePath: captured.filePath }, (stage) => {
            if (state.kind !== "tracing" || state.job !== job) return;
            state = { kind: "tracing", selection, job, stage };
            message(stage === "trace" ? "กำลังสร้างเส้นเวกเตอร์…" : stage === "svg" ? "กำลังอ่านผลลัพธ์…" : "กำลังเตรียมภาพ…");
            render();
          });
        } else {
          throw error;
        }
      }
      if (job.cancelled) throw new Error("ยกเลิกแล้ว");
      state = { kind: "preview", selection, job, previewUrl: pathToFileURL(job.svgPath).href };
      message("ดูตัวอย่างแล้วกดใส่ใน Illustrator · SVG " + result.pathCount + " paths");
      render();
    } catch (error) {
      if (job !== null) cleanJob(job);
      const cancelled = errorMessage(error) === "ยกเลิกแล้ว";
      state = { kind: "selected", selection };
      message(cancelled ? "ยกเลิกแล้ว ภาพต้นฉบับไม่ถูกเปลี่ยน" : errorMessage(error), !cancelled);
      render();
    }
  }

  async function apply(): Promise<void> {
    if (host === null || state.kind !== "preview") return;
    const { selection, job, previewUrl } = state;
    state = { kind: "applying", selection, job, previewUrl };
    message("กำลังนำ path เข้า Illustrator…");
    render();
    try {
      const settings = "preset=" + job.settings.preset + ";colors=" + job.settings.maxColors + ";simplify=" + job.settings.simplify;
      const result = await callHost(host, "VP_commit", [selection.uuid, job.svgPath, job.id, settings, selection.bounds.join(","), selection.documentIdentity]);
      state = { kind: "selected", selection };
      render();
      cleanJob(job);
      message("ใส่ผลแล้ว: " + (result[1] ?? "0") + " paths · ต้นฉบับยังอยู่");
    } catch (error) {
      if (error instanceof HostTimeoutError) {
        message("Illustrator ยังไม่ตอบกลับ ตรวจ Layers ก่อนเริ่มงานใหม่ เพื่อไม่สร้างผลซ้ำ", true);
        state = { kind: "selected", selection };
      } else {
        message(errorMessage(error), true);
        state = { kind: "preview", selection, job, previewUrl };
      }
      render();
    }
  }

  ui.refresh.addEventListener("click", () => { void refresh(); });
  ui.trace.addEventListener("click", () => { void trace(); });
  ui.apply.addEventListener("click", () => { void apply(); });
  ui.cancel.addEventListener("click", () => {
    if (state.kind !== "capturing" && state.kind !== "tracing") return;
    state.job.cancelled = true;
    if (runner) runner.cancel();
    message(state.kind === "capturing" ? "กำลังยกเลิก… รอ Illustrator จบการอ่านภาพ" : "กำลังยกเลิก…");
  });
  ui.colors.addEventListener("input", () => { ui.colorsValue.value = ui.colors.value; });
  ui.smooth.addEventListener("input", () => { ui.smoothValue.value = (Number(ui.smooth.value) / 10).toFixed(1); });
  ui.preset.addEventListener("change", () => {
    ui.colors.value = ui.preset.value === "photo" ? "24" : ui.preset.value === "icon" ? "4" : "8";
    ui.colorsValue.value = ui.colors.value;
  });

  window.addEventListener("beforeunload", () => {
    if (runner) runner.dispose();
    if (state.kind === "preview" || state.kind === "applying") cleanJob(state.job);
    if (state.kind === "tracing" || state.kind === "capturing") {
      state.job.cancelled = true;
      cleanJob(state.job);
    }
  });

  render();
  void cleanStaleJobs();
  void refresh();
}

start();
