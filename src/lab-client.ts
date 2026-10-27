import { listAnchors } from "./edit";
import {
  colorCount,
  controlsFor,
  paletteFromRaster,
  styleVectors,
  traceRequest,
  transparentFraction,
  type LabControls
} from "./lab-model";
import { revealSentinel, punchRgba } from "./punch-rgba";
import { scoreSvg } from "./score";
import { segmentViews } from "./segment";
import type { TracePreset, TraceRequest } from "./trace";

type StepId = "capture" | "colors" | "backdrop" | "punch" | "trace" | "fit" | "fair" | "seal";

const TITLES: Readonly<Record<StepId, string>> = {
  capture: "1 · ต้นฉบับ",
  colors: "2 · จัดกลุ่มสี",
  backdrop: "3 · ลบพื้นหลัง",
  punch: "4 · ตัดขอบโปร่ง",
  trace: "5 · ลากเส้น",
  fit: "6 · ทิ้งแผ่นและจับรูป",
  fair: "7 · เกลาเส้น",
  seal: "8 · ปิดช่อง"
};

const mode = byId<HTMLSelectElement>("mode");
const form = byId<HTMLFormElement>("controls");
const frame = byId<HTMLDivElement>("frame");
const stageTitle = byId<HTMLElement>("stage-title");
const explain = byId<HTMLParagraphElement>("explain");
const status = byId<HTMLParagraphElement>("status");
const chips = byId<HTMLUListElement>("chips");
const sourcePhoto = byId<HTMLImageElement>("source-photo");
const stageRaster = byId<HTMLCanvasElement>("stage-raster");
const stageVector = byId<HTMLDivElement>("stage-vector");
const maxColors = byId<HTMLInputElement>("max-colors");
const snap = byId<HTMLInputElement>("snap");
const speck = byId<HTMLInputElement>("speck");
const backdrop = byId<HTMLInputElement>("backdrop");
const spread = byId<HTMLInputElement>("spread");
const spreadNow = byId<HTMLParagraphElement>("spread-now");
const opaque = byId<HTMLInputElement>("opaque");
const lock = byId<HTMLInputElement>("lock");
const traceColors = byId<HTMLInputElement>("trace-colors");
const precision = byId<HTMLInputElement>("precision");
const speckle = byId<HTMLInputElement>("speckle");
const simplify = byId<HTMLInputElement>("simplify");
const clustering = byId<HTMLSelectElement>("clustering");
const watershed = byId<HTMLInputElement>("watershed");
const stacking = byId<HTMLSelectElement>("stacking");
const dropPlate = byId<HTMLInputElement>("drop-plate");
const fit = byId<HTMLInputElement>("fit");
const smooth = byId<HTMLInputElement>("smooth");
const smoothHint = byId<HTMLParagraphElement>("smooth-hint");
const corner = byId<HTMLInputElement>("corner");
const cornerHint = byId<HTMLParagraphElement>("corner-hint");
const seal = byId<HTMLInputElement>("seal");
const sealWidth = byId<HTMLInputElement>("seal-width");
const pixels = byId<HTMLInputElement>("pixels");
const metricColors = byId<HTMLElement>("metric-colors");
const metricAnchors = byId<HTMLElement>("metric-anchors");
const metricTime = byId<HTMLElement>("metric-time");

let selected: StepId = "capture";
let source = new Uint8Array();
let width = 0;
let height = 0;
let svg = "";
let svgKey = "";
let heldVectors: ReturnType<typeof styleVectors> | null = null;
let heldRaw = "";
let traceMs = 0;
let frameId = 0;
let traceTimer = 0;
let traceSerial = 0;

form.addEventListener("submit", (event) => event.preventDefault());
form.addEventListener("input", onEdit);
form.addEventListener("change", onEdit);
mode.addEventListener("change", () => {
  apply(controlsFor(currentMode()));
  schedule();
});
byId<HTMLButtonElement>("reset").addEventListener("click", () => {
  apply(controlsFor(currentMode()));
  schedule();
});
pixels.addEventListener("change", () => frame.classList.toggle("pixelated", pixels.checked));
for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>(".film button"))) {
  button.addEventListener("click", () => {
    const step = button.dataset.step;
    if (isStep(step)) selected = step;
    showChrome();
    schedule();
  });
}

apply(controlsFor("icon"));
void load().catch((error: unknown) => {
  status.textContent = error instanceof Error ? error.message : "เปิดภาพไม่ได้";
});

function onEdit(event: Event): void {
  if (event.target === stacking) sealWidth.value = stacking.value === "cutout" ? "2" : "0.8";
  syncOutputs();
  schedule();
}

function schedule(): void {
  cancelAnimationFrame(frameId);
  frameId = requestAnimationFrame(() => render());
}

async function load(): Promise<void> {
  if (!sourcePhoto.complete || sourcePhoto.naturalWidth === 0) {
    await new Promise<void>((resolve, reject) => {
      sourcePhoto.addEventListener("load", () => resolve(), { once: true });
      sourcePhoto.addEventListener("error", () => reject(new Error("เปิดภาพต้นฉบับไม่ได้")), { once: true });
    });
  }
  width = sourcePhoto.naturalWidth;
  height = sourcePhoto.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) throw new Error("อ่านพิกเซลไม่ได้");
  context.drawImage(sourcePhoto, 0, 0);
  source = new Uint8Array(context.getImageData(0, 0, width, height).data);
  render();
}

function render(): void {
  if (source.length === 0) return;
  const controls = readControls();
  const started = performance.now();
  const views = segmentViews(source, width, height, {
    mode: controls.mode,
    maxColors: controls.maxColors,
    removeBackground: controls.removeBackground,
    snapBlends: controls.snapBlends,
    speckArea: controls.speckArea,
    backdropSpread: controls.backdropSpread
  });
  const punched = punchRgba(views.backdrop, width, height, controls.opaqueAt);
  const punchShown = revealSentinel(punched.rgba, punched.droppedColor);
  const rasterMs = performance.now() - started;
  paintCanvas("thumb-capture", source);
  paintCanvas("thumb-colors", views.colors);
  paintCanvas("thumb-backdrop", views.backdrop);
  paintCanvas("thumb-punch", punchShown);
  const request = traceRequest(controls, paletteFromRaster(punched.rgba, punched.droppedColor));
  const key = rasterKey(punched.rgba, request);
  const styled = svg !== "" ? styleVectors(svg, controls, punched.droppedColor) : null;
  const current = svgKey === key && styled !== null;
  if (current && styled !== null) {
    heldVectors = styled;
    heldRaw = svg;
    setSvgThumb("thumb-trace", svg);
    setSvgThumb("thumb-fit", styled.fitted);
    setSvgThumb("thumb-fair", styled.faired);
    setSvgThumb("thumb-seal", styled.sealed);
  } else if (styled !== null) {
    setSvgThumb("thumb-fit", styled.fitted);
    setSvgThumb("thumb-fair", styled.faired);
    setSvgThumb("thumb-seal", styled.sealed);
  }
  const vectors = styled ?? heldVectors;
  const rawSvg = current ? svg : heldRaw;
  const vectorStep = selected === "trace" || selected === "fit" || selected === "fair" || selected === "seal";
  const vectorSvg = !vectorStep || vectors === null ? "" : selected === "trace" ? rawSvg : vectors[vectorField(selected)];
  const shownRaster = rasterOf(selected, views.colors, views.backdrop, punchShown);
  showChrome();
  if (shownRaster !== null) {
    sourcePhoto.hidden = true;
    stageVector.hidden = true;
    stageRaster.hidden = false;
    paintCanvasElement(stageRaster, shownRaster);
  } else {
    sourcePhoto.hidden = true;
    stageRaster.hidden = true;
    stageVector.hidden = false;
    if (vectorSvg !== "") stageVector.innerHTML = sizedSvg(vectorSvg);
  }
  frame.classList.toggle("waiting", shownRaster === null && svgKey !== key);
  const facts = vectorSvg === "" ? null : scoreSvg(vectorSvg);
  metricColors.textContent = shownRaster !== null ? String(colorCount(shownRaster)) : facts === null ? "–" : String(facts.colors);
  metricAnchors.textContent = facts === null ? "–" : String(listAnchors(vectorSvg).length);
  metricTime.textContent = Math.round(rasterMs) + " ms";
  explain.textContent = description(selected, controls, views.spread, views.paletteSize, views.backdrop, punchShown, punched.droppedColor, vectors);
  spreadNow.textContent = "ขอบภาพนี้กระจาย " + views.spread.toFixed(1) + " เกณฑ์ที่ลบได้คือค่าที่เลื่อนอยู่";
  paintChips(shownRaster !== null ? paletteFromRaster(shownRaster, null) : facts?.palette ?? []);
  status.textContent = svgKey === key ? "จัดสี " + Math.round(rasterMs) + " ms · ลากเส้น " + String(traceMs) + " ms" : "จัดสี " + Math.round(rasterMs) + " ms · กำลังลากเส้น";
  if (svgKey !== key) queueTrace(key, punched.rgba, request, punched.droppedColor);
}

function description(
  step: StepId,
  controls: LabControls,
  border: number,
  paletteSize: number,
  backdrop: Uint8Array,
  punchShown: Uint8Array,
  droppedColor: string | null,
  styled: ReturnType<typeof styleVectors> | null
): string {
  if (step === "capture") return "ภาพถ่าย " + width + "×" + height + " พิกเซล รวมวอลเปเปอร์เบลอ เงา และขอบจางของไอคอน";
  if (step === "colors") {
    const blend = controls.snapBlends ? " ขอบบางระหว่างสองสีถูกยุบเข้าหาสีหลัก" : " คงสีกลางไว้";
    return "เหลือ " + paletteSize + " สีจากภาพต้นฉบับ" + blend;
  }
  if (step === "backdrop") {
    if (!controls.removeBackground) return "สวิตช์ลบพื้นหลังปิดอยู่ พื้นทั้งเฟรมจึงยังอยู่ในภาพ";
    if (border > controls.backdropSpread) return "ขอบกระจาย " + border.toFixed(1) + " สูงกว่าเกณฑ์ " + String(controls.backdropSpread) + " พื้นจึงอยู่ครบ";
    return "ขอบกระจาย " + border.toFixed(1) + " อยู่ในเกณฑ์ " + String(controls.backdropSpread) + " ระบบลบพื้นไป " + Math.round(transparentFraction(backdrop) * 100) + "%";
  }
  if (step === "punch") {
    const cleared = Math.round(transparentFraction(punchShown) * 100);
    return "พิกเซลที่ความทึบต่ำกว่า " + String(controls.opaqueAt) + " ถูกตัดออก " + cleared + "%" + (droppedColor === null ? "" : " สีที่ทิ้งคือ " + droppedColor);
  }
  if (styled === null) return "กำลังลากเส้นจากภาพที่ตัดโปร่งแล้ว";
  if (step === "trace") return "VTracer ลากตามโซนสีที่เหลือ ความคลาดเคลื่อน " + controls.simplify.toFixed(2) + " px";
  if (step === "fit") {
    const facts = scoreSvg(styled.fitted);
    return "ทิ้งสีโปร่ง" + (controls.dropPlate ? " และแผ่นที่คลุมทั้งเฟรม" : "") + " จับได้วงกลม " + facts.circles + " วงรี " + facts.ellipses + " สี่เหลี่ยม " + facts.rects + " สี่เหลี่ยมมน " + facts.roundRects;
  }
  if (step === "fair") {
    return "จุดจาก " + listAnchors(styled.fitted).length + " เหลือ " + listAnchors(styled.faired).length + " ระยะยอม " + (0.4 + controls.smoothness * 2.2).toFixed(1) + " px";
  }
  return controls.seal ? "ถมรอยด้วยเส้นหนา " + controls.sealWidth.toFixed(1) + " px แล้วจัดเส้นสีเดียวกันเข้ากลุ่ม" : "ไม่ได้ถมรอย จัดเส้นสีเดียวกันเข้ากลุ่มอย่างเดียว";
}

function queueTrace(key: string, rgba: Uint8Array, request: TraceRequest, droppedColor: string | null): void {
  window.clearTimeout(traceTimer);
  const serial = ++traceSerial;
  traceTimer = window.setTimeout(() => {
    void sendTrace(serial, key, rgba, request, droppedColor);
  }, 120);
}

async function sendTrace(serial: number, key: string, rgba: Uint8Array, request: TraceRequest, droppedColor: string | null): Promise<void> {
  const started = performance.now();
  try {
    const response = await fetch("/api/trace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ png: await pngBase64(rgba), request })
    });
    if (serial !== traceSerial) return;
    const payload = await response.json() as { readonly svg?: string; readonly error?: string; readonly cancelled?: boolean };
    if (serial !== traceSerial || payload.cancelled === true) return;
    if (!response.ok || payload.svg === undefined) {
      status.textContent = payload.error ?? "ลากเส้นไม่สำเร็จ";
      return;
    }
    svg = payload.svg;
    svgKey = key;
    traceMs = Math.round(performance.now() - started);
    const styled = styleVectors(svg, readControls(), droppedColor);
    setSvgThumb("thumb-trace", svg);
    setSvgThumb("thumb-fit", styled.fitted);
    setSvgThumb("thumb-fair", styled.faired);
    setSvgThumb("thumb-seal", styled.sealed);
    render();
  } catch (error) {
    if (serial !== traceSerial) return;
    status.textContent = error instanceof Error ? error.message : "ลากเส้นไม่สำเร็จ";
  }
}

function showChrome(): void {
  stageTitle.textContent = TITLES[selected];
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>(".film button"))) {
    button.setAttribute("aria-pressed", button.dataset.step === selected ? "true" : "false");
  }
  for (const field of Array.from(document.querySelectorAll<HTMLFieldSetElement>("fieldset"))) field.hidden = field.id !== "fields-" + selected;
  traceColors.disabled = lock.checked;
  watershed.disabled = clustering.value !== "watershed";
  sealWidth.disabled = !seal.checked;
}

function rasterOf(step: StepId, colors: Uint8Array, backed: Uint8Array, punchShown: Uint8Array): Uint8Array | null {
  if (step === "capture") return source;
  if (step === "colors") return colors;
  if (step === "backdrop") return backed;
  if (step === "punch") return punchShown;
  return null;
}

function vectorField(step: StepId): "fitted" | "faired" | "sealed" {
  if (step === "fit") return "fitted";
  if (step === "fair") return "faired";
  return "sealed";
}

function paintCanvas(id: string, rgba: Uint8Array): void {
  paintCanvasElement(byId<HTMLCanvasElement>(id), rgba);
}

function paintCanvasElement(canvas: HTMLCanvasElement, rgba: Uint8Array): void {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext("2d");
  const copy = new Uint8ClampedArray(rgba.length);
  copy.set(rgba);
  context?.putImageData(new ImageData(copy, width, height), 0, 0);
}

function setSvgThumb(id: string, markup: string): void {
  const img = byId<HTMLImageElement>(id);
  const next = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup);
  if (img.src !== next) img.src = next;
}

function sizedSvg(markup: string): string {
  return markup.replace(/<svg\b([^>]*)>/i, (_full, attrs: string) => {
    const kept = attrs.replace(/\s(?:width|height)="[^"]*"/gi, "");
    return '<svg' + kept + ' width="100%">';
  });
}

function paintChips(colors: readonly string[]): void {
  chips.replaceChildren();
  for (const color of colors.slice(0, 24)) {
    const item = document.createElement("li");
    item.style.background = color;
    item.title = color;
    chips.append(item);
  }
}

function readControls(): LabControls {
  const preset = currentMode();
  const base = controlsFor(preset);
  return {
    ...base,
    maxColors: numberValue(maxColors),
    snapBlends: snap.checked,
    speckArea: numberValue(speck),
    removeBackground: backdrop.checked,
    backdropSpread: numberValue(spread),
    opaqueAt: numberValue(opaque),
    traceColors: numberValue(traceColors),
    lockPalette: lock.checked,
    colorPrecision: numberValue(precision),
    filterSpeckle: numberValue(speckle),
    clustering: clustering.value === "watershed" ? "watershed" : "off",
    watershedDetail: numberValue(watershed),
    simplify: numberValue(simplify),
    stacking: stacking.value === "stacked" ? "stacked" : "cutout",
    dropPlate: dropPlate.checked,
    fitGeometry: fit.checked,
    smoothness: numberValue(smooth),
    corner: numberValue(corner),
    seal: seal.checked,
    sealWidth: numberValue(sealWidth)
  };
}

function apply(controls: LabControls): void {
  mode.value = controls.mode;
  maxColors.value = String(controls.maxColors);
  snap.checked = controls.snapBlends;
  speck.value = String(controls.speckArea);
  backdrop.checked = controls.removeBackground;
  spread.value = String(controls.backdropSpread);
  opaque.value = String(controls.opaqueAt);
  traceColors.value = String(controls.traceColors);
  lock.checked = controls.lockPalette;
  precision.value = String(controls.colorPrecision);
  speckle.value = String(controls.filterSpeckle);
  simplify.value = String(controls.simplify);
  clustering.value = controls.clustering;
  watershed.value = String(controls.watershedDetail);
  stacking.value = controls.stacking;
  dropPlate.checked = controls.dropPlate;
  fit.checked = controls.fitGeometry;
  smooth.value = String(controls.smoothness);
  corner.value = String(controls.corner);
  seal.checked = controls.seal;
  sealWidth.value = String(controls.sealWidth);
  syncOutputs();
}

function syncOutputs(): void {
  setOutput(maxColors, maxColors.value);
  setOutput(speck, speck.value);
  setOutput(spread, spread.value);
  setOutput(opaque, opaque.value);
  setOutput(traceColors, traceColors.value);
  setOutput(precision, precision.value);
  setOutput(speckle, speckle.value);
  setOutput(simplify, Number(simplify.value).toFixed(2));
  setOutput(watershed, watershed.value);
  setOutput(smooth, Number(smooth.value).toFixed(1));
  setOutput(corner, corner.value + "°");
  setOutput(sealWidth, Number(sealWidth.value).toFixed(1));
  const tolerance = 0.4 + Number(smooth.value) * 2.2;
  smoothHint.textContent = "ระยะยอม " + tolerance.toFixed(1) + " px ช่วงที่ยาวถูกยืดเป็นเส้นตรง";
  cornerHint.textContent = "เก็บมุมที่เลี้ยวอย่างน้อย " + String(Math.max(0, 90 - Number(corner.value))) + "° และด้านยาวกว่า 3 px";
}

function setOutput(input: HTMLInputElement, text: string): void {
  const output = document.querySelector<HTMLOutputElement>("output[for='" + input.id + "']");
  if (output !== null) output.textContent = text;
  input.setAttribute("aria-valuetext", text);
}

async function pngBase64(rgba: Uint8Array): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("เข้ารหัส PNG ไม่ได้");
  const copy = new Uint8ClampedArray(rgba.length);
  copy.set(rgba);
  context.putImageData(new ImageData(copy, width, height), 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result === null) reject(new Error("เข้ารหัส PNG ไม่ได้"));
      else resolve(result);
    }, "image/png");
  });
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) binary += String.fromCharCode(...bytes.subarray(index, index + step));
  return btoa(binary);
}

function rasterKey(rgba: Uint8Array, request: TraceRequest): string {
  let hash = 2166136261;
  for (let index = 0; index < rgba.length; index += 97) hash = Math.imul(hash ^ (rgba[index] ?? 0), 16777619);
  return (hash >>> 0).toString(16) + ":" + JSON.stringify(request);
}

function currentMode(): TracePreset {
  if (mode.value === "logo" || mode.value === "icon" || mode.value === "photo" || mode.value === "poster") return mode.value;
  return "icon";
}

function numberValue(input: HTMLInputElement): number {
  return Number(input.value);
}

function isStep(value: string | undefined): value is StepId {
  return value === "capture" || value === "colors" || value === "backdrop" || value === "punch" || value === "trace" || value === "fit" || value === "fair" || value === "seal";
}

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(id);
  return node as T;
}
