import { createColorEditor } from "./editor-ui";
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
    const traced = traceSegmentation(segmentation, { preset: "logo", smooth: 1.2, upscale: 2 });
    previewEl.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(traced.svg);
    previewEl.hidden = false;
    previewEmptyEl.hidden = true;
    const vectorColors = countSvgFills(traced.svg);
    phaseEl.textContent = "พร้อมใส่ผล · " + editor.colorCount() + " สี";
    showStatus("แผนที่สี " + editor.colorCount() + " · เวกเตอร์ " + vectorColors + " สี · " + traced.pathCount + " เส้น");
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
if (compareStatus instanceof HTMLElement && compareOriginal instanceof HTMLImageElement && compareResult instanceof HTMLImageElement) {
  const statusNode: HTMLElement = compareStatus;
  const originalNode: HTMLImageElement = compareOriginal;
  const resultNode: HTMLImageElement = compareResult;
  void (async () => {
    statusNode.textContent = "กำลังแยกสีและลากเส้นจากภาพหน้าจอ…";
    try {
      const decoded = await loadFixturePixels("../fixtures/user-test-original.png");
      const started = performance.now();
      const segmentation = segmentImage(decoded.rgba, decoded.width, decoded.height, 12, { preset: "ui" });
      const traced = traceSegmentation(segmentation, {
        preset: "ui",
        smooth: 0.5,
        originalLabels: segmentation.labels,
        coverage: segmentation.coverage,
        partner: segmentation.partner
      });
      const seconds = ((performance.now() - started) / 1000).toFixed(2);
      resultNode.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(traced.svg);
      originalNode.hidden = false;
      resultNode.hidden = false;
      statusNode.textContent =
        "ข้อความ / หน้าจอ · " +
        segmentation.palette.length +
        " สี · " +
        traced.pathCount +
        " เส้น · " +
        traced.nodeCount +
        " จุด · " +
        seconds +
        " วินาที บนเครื่องนี้";
    } catch (error) {
      statusNode.textContent = error instanceof Error ? error.message : "เทียบภาพไม่สำเร็จ";
    }
  })();
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
