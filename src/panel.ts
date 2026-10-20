import * as childProcess from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

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
  /** Linked source file the panel can read itself (empty when Illustrator must render pixels). */
  readonly linkedPath: string;
};

type Settings = {
  readonly preset: "logo" | "icon" | "photo";
  readonly maxColors: number;
  readonly simplify: number;
  /** Discard patches smaller than this many px (removes paper grain / JPEG noise). */
  readonly speckle: number;
};

type Job = {
  readonly id: string;
  readonly directory: string;
  readonly pngPath: string;
  readonly svgPath: string;
  readonly settings: Settings;
  readonly startedAt: number;
  cancelled: boolean;
  child: childProcess.ChildProcess | null;
};

type State =
  | { readonly kind: "empty" }
  | { readonly kind: "loading" }
  | { readonly kind: "selected"; readonly selection: Selection }
  | { readonly kind: "capturing"; readonly selection: Selection; readonly job: Job }
  | { readonly kind: "preparing"; readonly selection: Selection; readonly job: Job }
  | { readonly kind: "tracing"; readonly selection: Selection; readonly job: Job }
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
    smoothValue: getOutput("smooth-value")
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
  if (parts.length !== 12) throw new Error("ข้อมูลภาพที่เลือกไม่ครบ (host.jsx กับ panel.js ไม่ตรงรุ่น — ปิดแล้วเปิด Panel ใหม่)");
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
    fromResult: parts[10] === "1",
    linkedPath: parts[11] ?? ""
  };
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
    startedAt: Date.now(),
    cancelled: false,
    child: null
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

/** Upper bound for pixels handed to the tracer. Above this, extra pixels cost time and memory
 * but do not improve a flat-colour trace measurably (see docs/perf-rounds.md). */
const MAX_TRACE_PIXELS = 4_000_000;
const DIRECT_FORMATS = new Set([".png", ".jpg", ".jpeg"]);

function vtracerArguments(job: Job, input: string): string[] {
  const args = [input, job.svgPath];
  const preset = job.settings.preset;
  if (preset === "photo") {
    args.push("--preset", "photo", "--max-colors", String(job.settings.maxColors));
  } else {
    args.push("--preset", "poster", "--hierarchical", "stacked", "--max-colors", String(job.settings.maxColors));
    if (preset === "icon") args.push("--mode", "polygon");
  }
  args.push("--filter-speckle", String(job.settings.speckle));
  args.push("--color-precision", String(colorPrecision(job.settings.maxColors)));
  if (job.settings.simplify > 0) args.push("--simplify", String(job.settings.simplify));
  args.push("--optimize", "1");
  return args;
}

/** Clustering precision (significant bits per RGB channel) that matches the requested palette size.
 * Measured on the balloon test (docs/perf-rounds.md): 4 bits gives the cleanest flat shapes with the
 * best edge F1 and ~1/10 the anchors of 6 bits; more bits mostly adds blotchy texture regions. */
function colorPrecision(maxColors: number): number {
  if (maxColors <= 4) return 3;
  if (maxColors <= 10) return 4;
  if (maxColors <= 20) return 5;
  return 6;
}

/** Run a helper process without blocking the panel. The job keeps a handle so Cancel can kill it. */
function runProcess(job: Job, binary: string, args: readonly string[], failure: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (job.cancelled) {
      reject(new CancelledError());
      return;
    }
    const child = childProcess.spawn(binary, args as string[], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    job.child = child;
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < 8000) stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 4000) stderr += chunk.toString("utf8").slice(0, 4000 - stderr.length);
    });
    child.once("error", (error) => {
      job.child = null;
      reject(new Error(failure + ": " + error.message));
    });
    child.once("close", (code) => {
      job.child = null;
      if (job.cancelled) reject(new CancelledError());
      else if (code === 0) resolve(stdout);
      else reject(new Error(failure + (stderr ? ": " + stderr.trim() : " (exit " + String(code) + ")")));
    });
  });
}

class CancelledError extends Error {
  constructor() {
    super("ยกเลิกแล้ว");
  }
}

type Prepared = { readonly input: string; readonly width: number; readonly height: number; readonly note: string };

/** Turn whatever Illustrator gave us (linked file or captured PNG) into a tracer input that is at
 * most MAX_TRACE_PIXELS, using an external process so neither Illustrator nor the panel decodes it. */
async function prepareInput(job: Job, sourcePath: string): Promise<Prepared> {
  const ext = path.extname(sourcePath).toLowerCase();
  if (process.platform !== "darwin") {
    if (!DIRECT_FORMATS.has(ext)) throw new Error("รองรับไฟล์ลิงก์ PNG/JPEG บนระบบนี้เท่านั้น");
    return { input: sourcePath, width: 0, height: 0, note: "ส่งไฟล์ตรง" };
  }
  const info = await runProcess(job, "/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", sourcePath], "อ่านขนาดภาพไม่สำเร็จ");
  const width = Number(/pixelWidth:\s*(\d+)/.exec(info)?.[1] ?? NaN);
  const height = Number(/pixelHeight:\s*(\d+)/.exec(info)?.[1] ?? NaN);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error("อ่านขนาดภาพไม่ได้: " + path.basename(sourcePath));
  const pixels = width * height;
  if (pixels <= MAX_TRACE_PIXELS && DIRECT_FORMATS.has(ext)) return { input: sourcePath, width, height, note: width + "×" + height };
  const scale = Math.min(1, Math.sqrt(MAX_TRACE_PIXELS / pixels));
  const side = Math.max(1, Math.floor(Math.max(width, height) * scale));
  await runProcess(job, "/usr/bin/sips", ["-s", "format", "png", "-Z", String(side), sourcePath, "--out", job.pngPath], "ย่อภาพไม่สำเร็จ");
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  return { input: job.pngPath, width: w, height: h, note: width + "×" + height + " → " + w + "×" + h };
}

/** Insert an invisible rectangle that spans the SVG canvas. host.jsx uses it to register the imported
 * group with the source raster, then deletes it. Runs in Node (async I/O), not on Illustrator's thread. */
async function addCanvasFrame(svgPath: string): Promise<void> {
  const text = await fs.promises.readFile(svgPath, "utf8");
  const svgTag = /<svg\b[^>]*>/.exec(text);
  if (!svgTag) throw new Error("ผลจาก VTracer ไม่ใช่ SVG");
  const width = /\swidth="([\d.]+)"/.exec(svgTag[0])?.[1];
  const height = /\sheight="([\d.]+)"/.exec(svgTag[0])?.[1];
  if (!width || !height) throw new Error("SVG ไม่มีขนาด canvas");
  const frame = '<rect id="vp-canvas" x="0" y="0" width="' + width + '" height="' + height + '" fill="none" stroke="none"/>';
  const at = svgTag.index + svgTag[0].length;
  await fs.promises.writeFile(svgPath, text.slice(0, at) + "\n" + frame + text.slice(at), "utf8");
}

type SvgStats = { readonly paths: number; readonly nodes: number; readonly kb: number };

async function svgStats(svgPath: string): Promise<SvgStats> {
  const text = await fs.promises.readFile(svgPath, "utf8");
  const paths = (text.match(/<path\b/g) ?? []).length;
  let nodes = 0;
  for (const match of text.matchAll(/\bd="([^"]*)"/g)) nodes += (match[1]?.match(/[MLCQSTHVAmlcqsthva]/g) ?? []).length;
  return { paths, nodes, kb: Math.round(text.length / 1024) };
}

function readSettings(ui: Ui): Settings {
  const preset = ui.preset.value;
  if (preset !== "logo" && preset !== "icon" && preset !== "photo") throw new Error("Preset ไม่ถูกต้อง");
  const maxColors = Number(ui.colors.value);
  const simplify = Number(ui.smooth.value) / 10;
  if (!Number.isInteger(maxColors) || maxColors < 2 || maxColors > 32) throw new Error("จำนวนสีไม่ถูกต้อง");
  if (!Number.isFinite(simplify) || simplify < 0 || simplify > 3) throw new Error("ค่าความเรียบไม่ถูกต้อง");
  return { preset, maxColors, simplify, speckle: preset === "photo" ? 8 : 16 };
}

function showSelection(ui: Ui, selection: Selection | null, hint: string): void {
  ui.selection.replaceChildren();
  if (selection === null) {
    ui.selection.textContent = hint;
    return;
  }
  const title = document.createElement("strong");
  title.textContent = selection.itemName || selection.itemType;
  const detail = document.createElement("small");
  const kind = selection.linkedPath ? "linked (อ่านไฟล์ตรง)" : selection.embedded ? "embedded" : "linked";
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
    case "preparing":
    case "tracing":
    case "preview":
    case "applying": return state.selection;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

const PHASES: Record<State["kind"], string> = {
  empty: "พร้อม",
  loading: "ตรวจภาพ",
  selected: "พร้อม",
  capturing: "1/3 อ่านภาพ",
  preparing: "2/3 เตรียมภาพ",
  tracing: "3/3 กำลังแปลง",
  preview: "พร้อมใส่ผล",
  applying: "กำลังใส่ผล"
};

function isBusy(state: State): boolean {
  return state.kind === "loading" || state.kind === "capturing" || state.kind === "preparing" || state.kind === "tracing" || state.kind === "applying";
}

function start(): void {
  const ui = getUi();
  let state: State = { kind: "empty" };
  let selectionHint = "เลือกภาพ raster หนึ่งภาพบน artboard แล้วกดตรวจภาพ";
  const extensionPath = typeof CSInterface === "undefined" ? "" : new CSInterface().getSystemPath(SystemPath.EXTENSION);
  const host = typeof CSInterface === "undefined" ? null : new CSInterface();
  let phaseStartedAt = Date.now();
  let progressText = "";
  let ticker: number | null = null;

  /** Status line. Errors stay on screen (red) until the next user action replaces them. */
  function message(value: string, isError = false): void {
    progressText = "";
    ui.status.textContent = value;
    ui.status.classList.toggle("error", isError);
    if (isError) console.error("[VectorPanel] " + value);
    else console.log("[VectorPanel] " + value);
  }

  function progress(value: string): void {
    progressText = value;
    phaseStartedAt = Date.now();
    ui.status.classList.remove("error");
    tick();
  }

  function tick(): void {
    if (!progressText) return;
    const job = "job" in state ? state.job : null;
    const total = job ? " · รวม " + ((Date.now() - job.startedAt) / 1000).toFixed(1) + " s" : "";
    ui.status.textContent = progressText + " " + ((Date.now() - phaseStartedAt) / 1000).toFixed(1) + " s" + total;
  }

  function render(): void {
    showSelection(ui, currentSelection(state), selectionHint);
    const busy = isBusy(state);
    ui.refresh.disabled = busy;
    ui.trace.disabled = busy || state.kind === "empty";
    ui.trace.textContent = currentSelection(state)?.fromResult ? "สร้างเวอร์ชันใหม่" : "สร้างตัวอย่าง";
    ui.apply.disabled = state.kind !== "preview";
    ui.cancel.hidden = !(state.kind === "preparing" || state.kind === "tracing");
    ui.phase.textContent = PHASES[state.kind];
    ui.phase.classList.toggle("busy", busy);
    if (busy && ticker === null) ticker = window.setInterval(tick, 200);
    if (!busy && ticker !== null) {
      window.clearInterval(ticker);
      ticker = null;
    }
    if (state.kind === "preview" || state.kind === "applying") {
      if (ui.preview.dataset.src !== state.dataUrl) {
        ui.preview.src = state.dataUrl;
        ui.preview.dataset.src = state.dataUrl;
      }
      ui.preview.hidden = false;
      ui.previewEmpty.hidden = true;
    } else {
      ui.preview.removeAttribute("src");
      delete ui.preview.dataset.src;
      ui.preview.hidden = true;
      ui.previewEmpty.hidden = false;
    }
  }

  async function refresh(): Promise<void> {
    if (host === null) {
      message("เปิด Panel นี้จาก Adobe Illustrator เท่านั้น", true);
      return;
    }
    if (isBusy(state)) return;
    if (state.kind === "preview") cleanJob(state.job);
    state = { kind: "loading" };
    progress("กำลังตรวจภาพที่เลือก…");
    render();
    try {
      const selection = parseSelection(await callHost(host, "VP_snapshot"));
      state = { kind: "selected", selection };
      message("ภาพพร้อมแปลง");
    } catch (error) {
      state = { kind: "empty" };
      selectionHint = errorMessage(error);
      message(errorMessage(error), true);
    }
    render();
  }

  async function trace(): Promise<void> {
    if (host === null) return;
    if (state.kind !== "selected" && state.kind !== "preview") return;
    const selection = state.selection;
    if (state.kind === "preview") cleanJob(state.job);
    let job: Job | null = null;
    try {
      job = newJob(readSettings(ui));
      const current = job;
      state = { kind: "capturing", selection, job: current };
      progress(selection.linkedPath ? "1/3 อ่านตำแหน่งไฟล์ลิงก์…" : "1/3 Illustrator กำลังเรนเดอร์ภาพ (embedded)…");
      render();
      const captured = await callHost(host, "VP_capture", [selection.uuid, current.pngPath, selection.documentIdentity, String(MAX_TRACE_PIXELS)]);
      if (current.cancelled) throw new CancelledError();
      const sourcePath = captured[1] ?? "";
      if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error("Illustrator ไม่ได้ส่งภาพกลับมา");

      state = { kind: "preparing", selection, job: current };
      progress("2/3 เตรียมภาพ (นอก Illustrator)…");
      render();
      const prepared = await prepareInput(current, sourcePath);

      const binary = path.join(extensionPath, "bin", process.platform === "win32" ? "vtracer.exe" : "vtracer");
      if (!fs.existsSync(binary)) throw new Error("ไม่พบ VTracer binary ใน extension/bin");
      state = { kind: "tracing", selection, job: current };
      progress("3/3 กำลังสร้างเส้นเวกเตอร์ " + prepared.note + "…");
      render();
      await runProcess(current, binary, vtracerArguments(current, prepared.input), "VTracer แปลงภาพไม่สำเร็จ");
      await addCanvasFrame(current.svgPath);
      const stats = await svgStats(current.svgPath);
      const seconds = ((Date.now() - current.startedAt) / 1000).toFixed(1);
      state = { kind: "preview", selection, job: current, dataUrl: "file://" + encodeURI(current.svgPath) + "?v=" + current.id };
      message(stats.paths + " paths · " + stats.nodes + " nodes · " + seconds + " s — ดูตัวอย่างแล้วกดใส่ใน Illustrator");
      render();
    } catch (error) {
      if (job !== null) cleanJob(job);
      state = { kind: "selected", selection };
      message(errorMessage(error), !(error instanceof CancelledError));
      render();
    }
  }

  async function apply(): Promise<void> {
    if (host === null || state.kind !== "preview") return;
    const { selection, job, dataUrl } = state;
    state = { kind: "applying", selection, job, dataUrl };
    progress("กำลังนำ path เข้า Illustrator…");
    render();
    try {
      const settings = "preset=" + job.settings.preset + ";colors=" + job.settings.maxColors + ";simplify=" + job.settings.simplify;
      const result = await callHost(host, "VP_commit", [selection.uuid, job.svgPath, job.id, settings, selection.bounds.join(","), selection.documentIdentity]);
      message("ใส่ผลแล้ว: " + (result[1] ?? "0") + " paths · ต้นฉบับยังอยู่ · Undo หนึ่งครั้งเพื่อย้อน");
      cleanJob(job);
      state = { kind: "selected", selection };
    } catch (error) {
      if (error instanceof HostTimeoutError) {
        message("Illustrator ยังไม่ตอบกลับ ตรวจ Layers ก่อนเริ่มงานใหม่ เพื่อไม่สร้างผลซ้ำ", true);
        state = { kind: "selected", selection };
      } else {
        message(errorMessage(error), true);
        state = { kind: "preview", selection, job, dataUrl };
      }
    }
    render();
  }

  function cancel(): void {
    if (state.kind !== "preparing" && state.kind !== "tracing" && state.kind !== "capturing") return;
    state.job.cancelled = true;
    state.job.child?.kill();
    progress("กำลังยกเลิก…");
  }

  ui.refresh.addEventListener("click", () => { void refresh(); });
  ui.trace.addEventListener("click", () => { void trace(); });
  ui.apply.addEventListener("click", () => { void apply(); });
  ui.cancel.addEventListener("click", cancel);
  ui.colors.addEventListener("input", () => { ui.colorsValue.value = ui.colors.value; });
  ui.smooth.addEventListener("input", () => { ui.smoothValue.value = (Number(ui.smooth.value) / 10).toFixed(1); });
  ui.preset.addEventListener("change", () => {
    ui.colors.value = ui.preset.value === "photo" ? "24" : ui.preset.value === "icon" ? "4" : "8";
    ui.colorsValue.value = ui.colors.value;
  });

  window.addEventListener("beforeunload", () => {
    if ("job" in state) {
      state.job.cancelled = true;
      state.job.child?.kill();
      cleanJob(state.job);
    }
  });

  cleanStaleJobs();
  render();
  void refresh();
}

start();
