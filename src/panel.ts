import type { ChildProcess } from "child_process";
import * as childProcess from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { expandPrimitives, fairPaths, listAnchors, moveAnchor, paintDisc, paletteFromRaster, parseBatchFields, removeShape } from "./edit";
import { readRgbaPng, encodeRgbaPng, punchTransparency } from "./png-alpha";
import { dropCanvasBackground, dropFill, fitShapes, groupPathsByFill, holeNote, scoreSvg, sealGaps, shapeNote, type TraceFacts } from "./score";
import { presetDefaults, vtracerArguments, type Stacking, type TracePreset } from "./trace";

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
  readonly corner: number;
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

type State =
  | { readonly kind: "empty" }
  | { readonly kind: "loading" }
  | { readonly kind: "selected"; readonly selection: Selection }
  | { readonly kind: "capturing"; readonly selection: Selection; readonly job: Job }
  | { readonly kind: "tracing"; readonly selection: Selection; readonly job: Job; readonly child: ChildProcess }
  | ({ readonly kind: "preview" } & Preview)
  | ({ readonly kind: "applying" } & Preview);

type Tool = "none" | "drag" | "erase" | "brush";

type Ui = {
  readonly selection: HTMLElement;
  readonly status: HTMLElement;
  readonly phase: HTMLElement;
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
  readonly colors: HTMLInputElement;
  readonly colorsValue: HTMLOutputElement;
  readonly smooth: HTMLInputElement;
  readonly smoothValue: HTMLOutputElement;
  readonly corner: HTMLInputElement;
  readonly cornerValue: HTMLOutputElement;
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

function getUi(): Ui {
  const preview = getElement("preview");
  const preset = getElement("preset");
  const stacking = getElement("stacking");
  const brushCanvas = getElement("brush-canvas");
  if (!(preview instanceof HTMLImageElement)) throw new Error("Expected preview image");
  if (!(preset instanceof HTMLSelectElement)) throw new Error("Expected preset selector");
  if (!(stacking instanceof HTMLSelectElement)) throw new Error("Expected stacking selector");
  if (!(brushCanvas instanceof HTMLCanvasElement)) throw new Error("Expected brush canvas");
  return {
    selection: getElement("selection"),
    status: getElement("status"),
    phase: getElement("phase"),
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
    colors: getInput("colors"),
    colorsValue: getOutput("colors-value"),
    smooth: getInput("smooth"),
    smoothValue: getOutput("smooth-value"),
    corner: getInput("corner"),
    cornerValue: getOutput("corner-value"),
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

function fittedSource(svg: string, droppedColor: string | null, settings: Settings): string {
  let next = svg;
  if (droppedColor !== null) next = dropFill(next, droppedColor);
  if (settings.removeBackground) next = dropCanvasBackground(next);
  return fitShapes(next);
}

function styledSvg(fitted: string, settings: Settings): string {
  return groupPathsByFill(sealGaps(fairPaths(fitted, { smoothness: settings.smoothness, cornerDegrees: settings.corner })));
}

function runVtracer(binary: string, job: Job, inputPath: string, palette: readonly string[] | undefined, onStart: (child: ChildProcess) => void): Promise<void> {
  const request = palette === undefined ? job.settings : { ...job.settings, palette };
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(binary, vtracerArguments(inputPath, job.svgPath, request), { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
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
  const corner = Number(ui.corner.value);
  const stacking = ui.stacking.value === "stacked" ? "stacked" : "cutout";
  if (!Number.isInteger(maxColors) || maxColors < 0 || maxColors > 64) throw new Error("จำนวนสีไม่ถูกต้อง");
  if (!Number.isFinite(smoothness) || smoothness < 0 || smoothness > 3) throw new Error("ค่าความเรียบไม่ถูกต้อง");
  if (!Number.isInteger(corner) || corner < 0 || corner > 90) throw new Error("ค่าคมของมุมไม่ถูกต้อง");
  return { preset, maxColors, smoothness, corner, removeBackground: ui.backdrop.checked, stacking };
}

function colorLabel(value: string): string {
  return value === "0" ? "อัตโนมัติ" : value;
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

function settingsNote(settings: Settings): string {
  return "preset=" + settings.preset + ";colors=" + settings.maxColors + ";smooth=" + settings.smoothness + ";corner=" + settings.corner + ";stacking=" + settings.stacking + ";background=" + (settings.removeBackground ? "removed" : "kept");
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
  let fittedSvg: string | null = null;
  let edited = false;
  const host = illustratorHost();
  const extensionPath = host === null ? "" : host.getSystemPath(SystemPath.EXTENSION);

  function message(value: string, isError = false): void {
    ui.status.textContent = value;
    ui.status.classList.toggle("error", isError);
  }

  function syncOutputs(): void {
    ui.colorsValue.value = colorLabel(ui.colors.value);
    ui.smoothValue.value = (Number(ui.smooth.value) / 10).toFixed(1);
    ui.cornerValue.value = ui.corner.value + "°";
  }

  function commitSvg(svgText: string, focus: { pathIndex: number; anchorIndex: number } | null = null): void {
    if (state.kind !== "preview") return;
    pendingFocus = focus;
    if (state.job !== null) fs.writeFileSync(state.job.svgPath, svgText);
    state = { ...state, svgText, facts: scoreSvg(svgText), dataUrl: svgDataUrl(svgText) };
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
    showSelection(ui, currentSelection(state));
    const busy = batching || state.kind === "loading" || state.kind === "capturing" || state.kind === "tracing" || state.kind === "applying";
    ui.refresh.disabled = busy;
    ui.trace.disabled = busy || state.kind === "empty";
    ui.batch.disabled = busy;
    ui.trace.textContent = currentSelection(state)?.fromResult ? "สร้างเวอร์ชันใหม่" : "สร้างตัวอย่าง";
    ui.apply.disabled = state.kind !== "preview" || state.job === null;
    ui.cancel.hidden = state.kind !== "tracing" && !batching;
    ui.phase.textContent = state.kind === "loading" ? "ตรวจภาพ" : state.kind === "capturing" ? "อ่านภาพ" : state.kind === "tracing" ? "กำลังแปลง" : state.kind === "applying" ? "กำลังใส่ผล" : batching ? "แปลงหลายภาพ" : state.kind === "preview" ? "พร้อมใส่ผล" : "พร้อม";
    const showing = state.kind === "preview" || state.kind === "applying";
    ui.viewPixels.hidden = !showing;
    ui.viewVectors.hidden = !showing;
    ui.zoomIn.hidden = !showing;
    ui.zoomOut.hidden = !showing;
    ui.editTools.hidden = !showing;
    ui.viewPixels.setAttribute("aria-pressed", view === "pixels" ? "true" : "false");
    ui.viewVectors.setAttribute("aria-pressed", view === "vector" ? "true" : "false");
    ui.toolDrag.setAttribute("aria-pressed", tool === "drag" ? "true" : "false");
    ui.toolErase.setAttribute("aria-pressed", tool === "erase" ? "true" : "false");
    ui.toolBrush.setAttribute("aria-pressed", tool === "brush" ? "true" : "false");
    ui.brushTrace.disabled = !showing || brushPixels === null || previewOf(state)?.job == null;
    ui.preview.classList.toggle("zoom-2", showing && zoom === 2);
    ui.preview.classList.toggle("zoom-4", showing && zoom === 4);
    ui.brushCanvas.classList.toggle("zoom-2", showing && zoom === 2);
    ui.brushCanvas.classList.toggle("zoom-4", showing && zoom === 4);
    const editingVectors = showing && view === "vector" && (tool === "drag" || tool === "erase");
    const brushing = showing && tool === "brush";
    if (state.kind === "preview" || state.kind === "applying") {
      ui.previewEmpty.hidden = true;
      showFacts(ui, state.facts);
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
        const editable = tool === "drag" ? expandPrimitives(state.svgText) : state.svgText;
        if (tool === "drag" && editable !== state.svgText && state.kind === "preview") {
          commitSvg(editable);
          return;
        }
        mountStage(editable);
      } else {
        ui.stage.hidden = true;
        ui.brushCanvas.hidden = true;
        ui.preview.hidden = false;
        ui.preview.src = view === "pixels" ? state.pngUrl : state.dataUrl;
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

  async function vectorize(selection: Selection, job: Job, palette?: readonly string[]): Promise<void> {
    if (!fs.existsSync(job.pngPath) || fs.statSync(job.pngPath).size === 0) throw new Error("Illustrator ไม่ได้ส่งภาพ PNG กลับมา");
    const binary = path.join(extensionPath, "bin", process.platform === "win32" ? "vtracer.exe" : "vtracer");
    if (!fs.existsSync(binary)) throw new Error("ไม่พบ VTracer binary ใน extension/bin");
    const sourcePng = fs.readFileSync(job.pngPath);
    const punched = punchTransparency(sourcePng);
    const traceInput = path.join(job.directory, "trace.png");
    fs.writeFileSync(traceInput, punched.png);
    message("กำลังสร้างเส้นเวกเตอร์…");
    await runVtracer(binary, job, traceInput, palette, (child) => {
      state = { kind: "tracing", selection, job, child };
      render();
    });
    fittedSvg = fittedSource(fs.readFileSync(job.svgPath, "utf8"), punched.droppedColor, job.settings);
    edited = false;
    const svgText = styledSvg(fittedSvg, job.settings);
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
    message("เทียบพิกเซลกับเวกเตอร์ แล้วกดใส่ใน Illustrator");
    render();
  }

  async function refresh(): Promise<void> {
    if (host === null) {
      message("เปิด Panel นี้จาก Adobe Illustrator เท่านั้น", true);
      return;
    }
    if (state.kind === "loading" || state.kind === "capturing" || state.kind === "tracing" || state.kind === "applying" || batching) return;
    if (state.kind === "preview" && state.job !== null) cleanJob(state.job);
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
    if (host === null) {
      message("เปิด Panel นี้จาก Adobe Illustrator เท่านั้น", true);
      return;
    }
    if (state.kind !== "selected" && state.kind !== "preview") return;
    const selection = state.selection;
    if (state.kind === "preview" && state.job !== null) cleanJob(state.job);
    const job = newJob(readSettings(ui));
    try {
      state = { kind: "capturing", selection, job };
      message("กำลังอ่านภาพจาก Illustrator…");
      render();
      await callHost(host, "VP_capture", [selection.uuid, job.pngPath, selection.documentIdentity]);
      await vectorize(selection, job);
    } catch (error) {
      cleanJob(job);
      state = { kind: "selected", selection };
      message(errorMessage(error), true);
      render();
    }
  }

  async function apply(): Promise<boolean> {
    if (host === null || state.kind !== "preview" || state.job === null) return false;
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
    if (batching || state.kind === "loading" || state.kind === "capturing" || state.kind === "tracing" || state.kind === "applying") return;
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
        const job = newJob(readSettings(ui));
        message("กำลังแปลงภาพ " + String(finished + 1) + "/" + String(list.items.length) + " · " + selection.itemName);
        state = { kind: "capturing", selection, job };
        render();
        try {
          await callHost(host, "VP_capture", [item.uuid, job.pngPath, list.documentIdentity, "1"]);
          await vectorize(selection, job);
          const placed = await apply();
          if (!placed) return;
          finished += 1;
        } catch (error) {
          cleanJob(job);
          throw error;
        }
      }
      message(stopBatch ? "หยุดที่ภาพ " + String(finished) : "แปลงครบ " + String(finished) + " ภาพ");
    } catch (error) {
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
      message(palette === null ? "สีมากกว่า 32 สี จึงให้ VTracer จัดกลุ่มสีเอง" : "ใช้สีจากแปรง " + String(palette.length) + " สี");
      await vectorize(selection, job, palette ?? undefined);
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

  function refair(): void {
    if (state.kind !== "preview" || fittedSvg === null) return;
    if (edited) {
      message("แก้ชิ้นแล้ว จึงไม่ปรับมุมทับ จนกว่าจะแปลงใหม่", true);
      return;
    }
    const settings = readSettings(ui);
    const next = styledSvg(fittedSvg, settings);
    if (state.job !== null) state = { ...state, job: { ...state.job, settings } };
    commitSvg(next);
  }

  function loadFixture(): void {
    const radians = (15 * Math.PI) / 180;
    let stair = "M88,18";
    for (let step = 0; step < 14; step += 1) stair += " h1 v1";
    const kink = "M88,78 L98,78 L" + (98 + 10 * Math.cos(radians)).toFixed(2) + "," + (78 - 10 * Math.sin(radians)).toFixed(2);
    const svgText = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100" viewBox="0 0 160 100"><path fill="#d6363e" d="M8,8 H58 V58 H8 Z"/><path fill="#2e66d6" d="' + stair + '"/><path fill="#f2b830" d="' + kink + '"/></svg>';
    fittedSvg = svgText;
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
    const shown = styledSvg(svgText, readSettings(ui));
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
      dataUrl: svgDataUrl(shown),
      pngUrl,
      svgText: shown,
      raster: { width, height, rgba },
      facts: scoreSvg(shown)
    };
    message("ตัวอย่างในเบราว์เซอร์: ลากจุด ลบชิ้น หรือระบายสีได้");
    render();
  }

  ui.refresh.addEventListener("click", () => { void refresh(); });
  ui.trace.addEventListener("click", () => { void trace(); });
  ui.apply.addEventListener("click", () => { void apply(); });
  ui.batch.addEventListener("click", () => { void batch(); });
  ui.brushTrace.addEventListener("click", () => { void retraceBrush(); });
  ui.cancel.addEventListener("click", () => {
    stopBatch = true;
    if (state.kind !== "tracing") return;
    state.job.cancelled = true;
    state.child.kill();
    message("กำลังยกเลิก…");
  });
  ui.colors.addEventListener("input", syncOutputs);
  ui.smooth.addEventListener("input", () => {
    syncOutputs();
    refair();
  });
  ui.corner.addEventListener("input", () => {
    syncOutputs();
    refair();
  });
  ui.preset.addEventListener("change", () => {
    const preset = ui.preset.value;
    if (preset !== "logo" && preset !== "icon" && preset !== "photo") return;
    const defaults = presetDefaults(preset);
    ui.colors.value = String(defaults.maxColors);
    ui.smooth.value = String(Math.round(defaults.smoothness * 10));
    ui.corner.value = String(defaults.corner);
    ui.backdrop.checked = defaults.removeBackground;
    ui.stacking.value = defaults.stacking;
    syncOutputs();
    refair();
  });
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
  });

  syncOutputs();
  if (host !== null) {
    cleanStaleJobs();
    render();
    void refresh();
  } else if (new URLSearchParams(window.location.search).get("fixture") === "1") {
    loadFixture();
  } else {
    render();
    message("เปิด Panel นี้จาก Adobe Illustrator เท่านั้น", true);
  }
}

start();
