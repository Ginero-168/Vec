import * as childProcess from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { punchTransparency } from "./png-alpha";
import { dropCanvasBackground, dropFill, fitShapes, groupPathsByFill, holeNote, scoreSvg, sealGaps, shapeNote, type TraceFacts } from "./score";
import { vtracerArguments, type Stacking, type TracePreset } from "./trace";

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
  readonly preset: TracePreset;
  readonly maxColors: number;
  readonly smoothness: number;
  readonly removeBackground: boolean;
  readonly stacking: Stacking;
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
  | { readonly kind: "loading" }
  | { readonly kind: "selected"; readonly selection: Selection }
  | { readonly kind: "capturing"; readonly selection: Selection; readonly job: Job }
  | { readonly kind: "tracing"; readonly selection: Selection; readonly job: Job; readonly child: childProcess.ChildProcess }
  | { readonly kind: "preview"; readonly selection: Selection; readonly job: Job; readonly dataUrl: string; readonly pngUrl: string; readonly facts: TraceFacts }
  | { readonly kind: "applying"; readonly selection: Selection; readonly job: Job; readonly dataUrl: string; readonly pngUrl: string; readonly facts: TraceFacts };

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
  readonly facts: HTMLElement;
  readonly factPaths: HTMLElement;
  readonly factAnchors: HTMLElement;
  readonly factHoles: HTMLElement;
  readonly factColors: HTMLElement;
  readonly factNote: HTMLElement;
  readonly palette: HTMLElement;
  readonly backdrop: HTMLInputElement;
  readonly stacking: HTMLSelectElement;
  readonly viewPixels: HTMLButtonElement;
  readonly viewVectors: HTMLButtonElement;
  readonly zoomIn: HTMLButtonElement;
  readonly zoomOut: HTMLButtonElement;
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
  const stacking = getElement("stacking");
  if (!(preview instanceof HTMLImageElement)) throw new Error("Expected preview image");
  if (!(preset instanceof HTMLSelectElement)) throw new Error("Expected preset selector");
  if (!(stacking instanceof HTMLSelectElement)) throw new Error("Expected stacking selector");
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
    facts: getElement("facts"),
    factPaths: getElement("fact-paths"),
    factAnchors: getElement("fact-anchors"),
    factHoles: getElement("fact-holes"),
    factColors: getElement("fact-colors"),
    factNote: getElement("fact-note"),
    palette: getElement("palette"),
    backdrop: getInput("backdrop"),
    stacking,
    viewPixels: getButton("view-pixels"),
    viewVectors: getButton("view-vectors"),
    zoomIn: getButton("zoom-in"),
    zoomOut: getButton("zoom-out")
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

function runVtracer(binary: string, job: Job, inputPath: string, onStart: (child: childProcess.ChildProcess) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(binary, vtracerArguments(inputPath, job.svgPath, job.settings), { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
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
  const smoothness = Number(ui.smooth.value) / 10;
  const stacking = ui.stacking.value === "stacked" ? "stacked" : "cutout";
  if (!Number.isInteger(maxColors) || maxColors < 0 || maxColors > 64) throw new Error("จำนวนสีไม่ถูกต้อง");
  if (!Number.isFinite(smoothness) || smoothness < 0 || smoothness > 3) throw new Error("ค่าความเรียบไม่ถูกต้อง");
  return { preset, maxColors, smoothness, removeBackground: ui.backdrop.checked, stacking };
}

function colorLabel(value: string): string {
  return value === "0" ? "อัตโนมัติ" : value;
}

function showFacts(ui: Ui, facts: TraceFacts | null): void {
  if (facts === null) {
    ui.facts.hidden = true;
    ui.factNote.hidden = true;
    ui.factNote.textContent = "";
    showPalette(ui, []);
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
  showPalette(ui, facts.palette);
}

function showPalette(ui: Ui, palette: readonly string[]): void {
  ui.palette.replaceChildren();
  if (palette.length === 0) {
    ui.palette.hidden = true;
    return;
  }
  for (const color of palette) {
    const item = document.createElement("li");
    if (/^#[0-9a-f]{6}$/.test(color)) item.style.backgroundColor = color;
    item.title = color;
    ui.palette.append(item);
  }
  ui.palette.hidden = false;
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
    case "tracing":
    case "preview":
    case "applying": return state.selection;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function start(): void {
  const ui = getUi();
  let state: State = { kind: "empty" };
  let view: "vector" | "pixels" = "vector";
  let zoom = 1;
  const extensionPath = typeof CSInterface === "undefined" ? "" : new CSInterface().getSystemPath(SystemPath.EXTENSION);
  const host = typeof CSInterface === "undefined" ? null : new CSInterface();

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
    ui.phase.textContent = state.kind === "loading" ? "ตรวจภาพ" : state.kind === "capturing" ? "อ่านภาพ" : state.kind === "tracing" ? "กำลังแปลง" : state.kind === "applying" ? "กำลังใส่ผล" : state.kind === "preview" ? "พร้อมใส่ผล" : "พร้อม";
    const showing = state.kind === "preview" || state.kind === "applying";
    ui.viewPixels.hidden = !showing;
    ui.viewVectors.hidden = !showing;
    ui.zoomIn.hidden = !showing;
    ui.zoomOut.hidden = !showing;
    ui.viewPixels.setAttribute("aria-pressed", view === "pixels" ? "true" : "false");
    ui.viewVectors.setAttribute("aria-pressed", view === "vector" ? "true" : "false");
    ui.preview.classList.toggle("zoom-2", showing && zoom === 2);
    ui.preview.classList.toggle("zoom-4", showing && zoom === 4);
    if (state.kind === "preview" || state.kind === "applying") {
      ui.preview.src = view === "pixels" ? state.pngUrl : state.dataUrl;
      ui.preview.hidden = false;
      ui.previewEmpty.hidden = true;
      showFacts(ui, state.facts);
    } else {
      ui.preview.removeAttribute("src");
      ui.preview.hidden = true;
      ui.previewEmpty.hidden = false;
      showFacts(ui, null);
    }
  }

  async function refresh(): Promise<void> {
    if (host === null) {
      message("เปิด Panel นี้จาก Adobe Illustrator เท่านั้น", true);
      return;
    }
    if (state.kind === "loading" || state.kind === "capturing" || state.kind === "tracing" || state.kind === "applying") return;
    if (state.kind === "preview") cleanJob(state.job);
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
    if (state.kind !== "selected" && state.kind !== "preview") return;
    const selection = state.selection;
    if (state.kind === "preview") cleanJob(state.job);
    let job: Job | null = null;
    try {
      job = newJob(readSettings(ui));
      state = { kind: "capturing", selection, job };
      message("กำลังอ่านภาพจาก Illustrator…");
      render();
      await callHost(host, "VP_capture", [selection.uuid, job.pngPath, selection.documentIdentity]);
      if (!fs.existsSync(job.pngPath) || fs.statSync(job.pngPath).size === 0) throw new Error("Illustrator ไม่ได้ส่งภาพ PNG กลับมา");
      const binary = path.join(extensionPath, "bin", process.platform === "win32" ? "vtracer.exe" : "vtracer");
      if (!fs.existsSync(binary)) throw new Error("ไม่พบ VTracer binary ใน extension/bin");
      const sourcePng = fs.readFileSync(job.pngPath);
      const punched = punchTransparency(sourcePng);
      const traceInput = path.join(job.directory, "trace.png");
      fs.writeFileSync(traceInput, punched.png);
      message("กำลังสร้างเส้นเวกเตอร์…");
      await runVtracer(binary, job, traceInput, (child) => {
        if (job === null) return;
        state = { kind: "tracing", selection, job, child };
        render();
      });
      let svgText = fs.readFileSync(job.svgPath, "utf8");
      if (punched.droppedColor !== null) svgText = dropFill(svgText, punched.droppedColor);
      if (job.settings.removeBackground) svgText = dropCanvasBackground(svgText);
      svgText = groupPathsByFill(sealGaps(fitShapes(svgText)));
      fs.writeFileSync(job.svgPath, svgText);
      const facts = scoreSvg(svgText);
      view = "vector";
      zoom = 1;
      const pngUrl = "data:image/png;base64," + sourcePng.toString("base64");
      state = { kind: "preview", selection, job, dataUrl: "data:image/svg+xml;base64," + Buffer.from(svgText, "utf8").toString("base64"), pngUrl, facts };
      message("เทียบพิกเซลกับเวกเตอร์ แล้วกดใส่ใน Illustrator");
      render();
    } catch (error) {
      if (job !== null) cleanJob(job);
      state = { kind: "selected", selection };
      message(errorMessage(error), true);
      render();
    }
  }

  async function apply(): Promise<void> {
    if (host === null || state.kind !== "preview") return;
    const { selection, job, dataUrl, pngUrl, facts } = state;
    state = { kind: "applying", selection, job, dataUrl, pngUrl, facts };
    message("กำลังนำ path เข้า Illustrator…");
    render();
    try {
      const settings = "preset=" + job.settings.preset + ";colors=" + job.settings.maxColors + ";smooth=" + job.settings.smoothness + ";stacking=" + job.settings.stacking + ";background=" + (job.settings.removeBackground ? "removed" : "kept");
      const result = await callHost(host, "VP_commit", [selection.uuid, job.svgPath, job.id, settings, selection.bounds.join(","), selection.documentIdentity]);
      message("ใส่ผลแล้ว: " + (result[1] ?? "0") + " paths · ต้นฉบับยังอยู่");
      cleanJob(job);
      state = { kind: "selected", selection };
    } catch (error) {
      if (error instanceof HostTimeoutError) {
        message("Illustrator ยังไม่ตอบกลับ ตรวจ Layers ก่อนเริ่มงานใหม่ เพื่อไม่สร้างผลซ้ำ", true);
        state = { kind: "selected", selection };
      } else {
        message(errorMessage(error), true);
        state = { kind: "preview", selection, job, dataUrl, pngUrl, facts };
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
    state.child.kill();
    message("กำลังยกเลิก…");
  });
  ui.colors.addEventListener("input", () => { ui.colorsValue.value = colorLabel(ui.colors.value); });
  ui.smooth.addEventListener("input", () => { ui.smoothValue.value = (Number(ui.smooth.value) / 10).toFixed(1); });
  ui.preset.addEventListener("change", () => {
    if (ui.preset.value === "photo") {
      ui.colors.value = "36";
      ui.smooth.value = "16";
      ui.backdrop.checked = false;
      ui.stacking.value = "stacked";
    } else if (ui.preset.value === "icon") {
      ui.colors.value = "8";
      ui.smooth.value = "20";
      ui.backdrop.checked = true;
      ui.stacking.value = "cutout";
    } else {
      ui.colors.value = "0";
      ui.smooth.value = "24";
      ui.backdrop.checked = true;
      ui.stacking.value = "cutout";
    }
    ui.colorsValue.value = colorLabel(ui.colors.value);
    ui.smoothValue.value = (Number(ui.smooth.value) / 10).toFixed(1);
  });
  ui.viewPixels.addEventListener("click", () => {
    view = "pixels";
    render();
  });
  ui.viewVectors.addEventListener("click", () => {
    view = "vector";
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

  window.addEventListener("beforeunload", () => {
    if (state.kind === "preview") cleanJob(state.job);
    if (state.kind === "tracing") {
      state.job.cancelled = true;
      state.child.kill();
      cleanJob(state.job);
    }
  });

  cleanStaleJobs();
  render();
  void refresh();
}

start();
