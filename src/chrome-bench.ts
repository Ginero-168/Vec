import { segmentImage } from "./color/segment";
import { traceSegmentation } from "./color/trace";

const started = performance.now();
const image = new Image();
image.onload = () => {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  const node = document.getElementById("out");
  if (!context || !node) return;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const rgba = new Uint8Array(pixels.data.buffer);
  const decodeMs = performance.now() - started;
  const work = performance.now();
  const segmentation = segmentImage(rgba, canvas.width, canvas.height, 12, { preset: "ui" });
  const traced = traceSegmentation(segmentation, {
    preset: "ui",
    smooth: 0.5,
    source: rgba,
    coverage: segmentation.coverage,
    partner: segmentation.partner
  });
  const workMs = performance.now() - work;
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  node.textContent = JSON.stringify({
    width: canvas.width,
    height: canvas.height,
    decodeMs,
    workMs,
    totalMs: performance.now() - started,
    nodes: traced.nodeCount,
    heap: memory?.usedJSHeapSize ?? 0
  });
};
image.onerror = () => {
  const node = document.getElementById("out");
  if (node) node.textContent = "image failed";
};
image.src = "fixtures/user-test-original.png";
