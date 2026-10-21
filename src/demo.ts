import { createColorEditor } from "./editor-ui";
import { guidedFilter } from "./color/denoise";
import { countSvgFills, segmentImage } from "./color/segment";
import { makeStripeSample } from "./color/sample";
import { rgbHex } from "./color/model";
import { traceSegmentation } from "./color/trace";

const root = document.getElementById("editor-root");
const preview = document.getElementById("preview");
const previewEmpty = document.getElementById("preview-empty");
const status = document.getElementById("status");
const phase = document.getElementById("phase");
if (!(root instanceof HTMLElement) || !(preview instanceof HTMLImageElement) || !(previewEmpty instanceof HTMLElement) || !(status instanceof HTMLElement) || !(phase instanceof HTMLElement)) {
  throw new Error("หน้าตัวอย่างไม่ครบ");
}
const rootEl: HTMLElement = root;
const previewEl: HTMLImageElement = preview;
const previewEmptyEl: HTMLElement = previewEmpty;
const statusEl: HTMLElement = status;
const phaseEl: HTMLElement = phase;

const image = makeStripeSample();
const maxColors = 8;

function showStatus(value: string): void {
  statusEl.textContent = value;
}

const editor = createColorEditor(rootEl, {
  onChange(colorCount) {
    phaseEl.textContent = "แก้สี · " + colorCount + " สี";
  },
  onVectorPreview() {
    const segmentation = editor.segmentation();
    const clean = cleanOptions();
    const traced = traceSegmentation(segmentation, {
      preset: "logo",
      smooth: 1.2,
      upscale: 2,
      cleanShapes: clean.strength,
      cleanText: clean.text,
      smoothMask: segmentation.smoothMask
    });
    previewEl.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(traced.svg);
    previewEl.hidden = false;
    previewEmptyEl.hidden = true;
    const vectorColors = countSvgFills(traced.svg);
    phaseEl.textContent = "พร้อมใส่ผล · " + editor.colorCount() + " สี";
    showStatus("แผนที่สี " + editor.colorCount() + " · เวกเตอร์ " + vectorColors + " สี · " + traced.pathCount + " เส้น · " + traced.nodeCount + " จุด");
  },
  onResegment() {
    void (async () => {
      const ok = await editor.confirmDiscard("การแยกสีใหม่จากภาพตัวอย่างจะล้าง Zap, ดินสอ, เทสี และการรวมสีที่ทำไว้");
      if (!ok) return;
      editor.load(segmentImage(image.rgba, image.width, image.height, maxColors));
      phaseEl.textContent = "แก้สี · " + editor.colorCount() + " สี";
      showStatus("แยกสีใหม่ · " + editor.colorCount() + " สี");
    })();
  },
  onExportSwatches(palette) {
    const lines = palette.map((color, index) => index + 1 + " " + rgbHex(color)).join(" · ");
    showStatus("กลุ่ม Swatches จะถูกสร้างใน Illustrator (" + palette.length + " สี): " + lines);
  }
});

editor.load(segmentImage(image.rgba, image.width, image.height, maxColors));
phaseEl.textContent = "แก้สี · " + editor.colorCount() + " สี";
showStatus("ภาพตัวอย่างลายทาง มีเศษสีขอบให้ Zap");

const compareStatus = document.getElementById("compare-status");
const compareOriginal = document.getElementById("compare-original");
const compareResult = document.getElementById("compare-result");
const cleanShapesInput = document.getElementById("clean-shapes");
const cleanStrengthInput = document.getElementById("clean-strength");
const cleanStrengthValue = document.getElementById("clean-strength-value");
const cleanTextInput = document.getElementById("clean-text");
const gradientsInput = document.getElementById("gradients");
const prefilterInput = document.getElementById("prefilter");

function cleanOptions(): { strength: number; text: boolean } {
  const enabled = cleanShapesInput instanceof HTMLInputElement && cleanShapesInput.checked;
  const strength = enabled && cleanStrengthInput instanceof HTMLInputElement ? Number(cleanStrengthInput.value) / 100 : 0;
  const text = enabled && cleanTextInput instanceof HTMLInputElement && cleanTextInput.checked;
  return { strength: Number.isFinite(strength) ? strength : 0, text };
}

function syncCleanControls(): void {
  const enabled = cleanShapesInput instanceof HTMLInputElement && cleanShapesInput.checked;
  if (cleanStrengthInput instanceof HTMLInputElement) cleanStrengthInput.disabled = !enabled;
  if (cleanTextInput instanceof HTMLInputElement) cleanTextInput.disabled = !enabled;
  if (cleanStrengthValue instanceof HTMLOutputElement && cleanStrengthInput instanceof HTMLInputElement) cleanStrengthValue.value = cleanStrengthInput.value;
}

if (compareStatus instanceof HTMLElement && compareOriginal instanceof HTMLImageElement && compareResult instanceof HTMLImageElement) {
  const statusNode: HTMLElement = compareStatus;
  const originalNode: HTMLImageElement = compareOriginal;
  const resultNode: HTMLImageElement = compareResult;
  let decoded: { rgba: Uint8Array; width: number; height: number } | null = null;
  let compareToken = 0;
  const renderCompare = async () => {
    const token = ++compareToken;
    statusNode.textContent = "กำลังแยกสีและลากเส้นจากภาพหน้าจอ…";
    try {
      if (!decoded) decoded = await loadFixturePixels("../fixtures/user-test-original.png");
      if (token !== compareToken) return;
      const source = decoded;
      const pixels = prefilterInput instanceof HTMLInputElement && prefilterInput.checked ? guidedFilter(source.rgba, source.width, source.height) : source.rgba;
      const started = performance.now();
      const segmentation = segmentImage(pixels, source.width, source.height, 12, { preset: "ui" });
      const clean = cleanOptions();
      const traced = traceSegmentation(segmentation, {
        preset: "ui",
        smooth: 0.5,
        cleanShapes: clean.strength,
        cleanText: clean.text,
        gradients: gradientsInput instanceof HTMLInputElement && gradientsInput.checked,
        originalLabels: segmentation.labels,
        coverage: segmentation.coverage,
        partner: segmentation.partner,
        source: pixels
      });
      if (token !== compareToken) return;
      const seconds = ((performance.now() - started) / 1000).toFixed(2);
      resultNode.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(traced.svg);
      originalNode.hidden = false;
      resultNode.hidden = false;
      const cleanLabel = clean.strength > 0 ? " · รูปทรงเรียบ " + Math.round(clean.strength * 100) : "";
      const gradientLabel = gradientsInput instanceof HTMLInputElement && gradientsInput.checked ? " · ไล่สี" : "";
      const filterLabel = prefilterInput instanceof HTMLInputElement && prefilterInput.checked ? " · เกลี่ย JPEG" : "";
      statusNode.textContent =
        "ข้อความ / หน้าจอ · " +
        segmentation.palette.length +
        " สี · " +
        traced.pathCount +
        " เส้น · " +
        traced.nodeCount +
        " จุด · " +
        seconds +
        " วินาที บนเครื่องนี้" +
        cleanLabel +
        gradientLabel +
        filterLabel;
    } catch (error) {
      if (token !== compareToken) return;
      statusNode.textContent = error instanceof Error ? error.message : "เทียบภาพไม่สำเร็จ";
    }
  };
  let cleanTimer = 0;
  const onClean = () => {
    syncCleanControls();
    window.clearTimeout(cleanTimer);
    cleanTimer = window.setTimeout(() => {
      void renderCompare();
    }, 180);
  };
  cleanShapesInput?.addEventListener("change", onClean);
  cleanStrengthInput?.addEventListener("input", onClean);
  cleanTextInput?.addEventListener("change", onClean);
  gradientsInput?.addEventListener("change", onClean);
  prefilterInput?.addEventListener("change", onClean);
  syncCleanControls();
  void renderCompare();
}

function loadFixturePixels(url: string): Promise<{ rgba: Uint8Array; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        reject(new Error("อ่านพิกเซลไม่ได้"));
        return;
      }
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      resolve({ rgba: new Uint8Array(pixels), width: canvas.width, height: canvas.height });
    };
    image.onerror = () => reject(new Error("ไม่พบภาพตัวอย่าง"));
    image.src = url;
  });
}
