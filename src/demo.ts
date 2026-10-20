import { createColorEditor } from "./editor-ui";
import { countSvgFills, segmentImage, segmentationToSvg } from "./color/segment";
import { makeStripeSample } from "./color/sample";
import { rgbHex } from "./color/model";

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
    const svg = segmentationToSvg(segmentation);
    previewEl.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    previewEl.hidden = false;
    previewEmptyEl.hidden = true;
    const vectorColors = countSvgFills(svg);
    phaseEl.textContent = "พร้อมใส่ผล · " + editor.colorCount() + " สี";
    showStatus("แผนที่สี " + editor.colorCount() + " · เวกเตอร์ " + vectorColors + " สี · ตัวอย่างนี้คือสีที่ส่งเข้าตัวทำเส้น ก่อนเกลี่ย");
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
