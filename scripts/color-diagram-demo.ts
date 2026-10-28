import { mountColorDiagram } from "../src/color-diagram.ts";
import { createDimmedPreview } from "../src/palette-edit.ts";
import type { SegmentColorStage, RGB } from "../src/segment.ts";

export function generateSampleStage(): SegmentColorStage {
  const width = 240;
  const height = 90;
  const count = width * height;

  const palette: RGB[] = [
    { r: 226, g: 148, b: 52 },  // 0: Orange #e29434
    { r: 223, g: 78, b: 64 },   // 1: Red #df4e40
    { r: 101, g: 199, b: 91 },  // 2: Green #65c75b
    { r: 30, g: 116, b: 232 },  // 3: Blue #1e74e8
    { r: 152, g: 85, b: 203 },  // 4: Purple #9855cb
    { r: 245, g: 245, b: 247 }, // 5: White #f5f5f7
    { r: 42, g: 45, b: 55 },    // 6: Dark Charcoal #2a2d37
    { r: 126, g: 126, b: 131 }  // 7: Metal Gray #7e7e83
  ];

  const labels = new Int16Array(count);
  const punchLabels = new Int16Array(count);
  const opaque = new Uint8Array(count);
  const colors = new Uint8Array(count * 4);
  const sourceRgba = new Uint8Array(count * 4);

  // Background
  labels.fill(6);
  punchLabels.fill(6);
  opaque.fill(255);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      let label = 6;

      // Icon 1: Chrome (Red, Green, Yellow/Orange, Blue) at x 15..55, y 20..70
      const d1 = Math.hypot(x - 35, y - 45);
      if (d1 < 22) {
        if (d1 < 9) label = 3;
        else if (y < 45 && x >= 35) label = 0;
        else if (x < 35 && y > 35) label = 2;
        else label = 1;
      }

      // Icon 2: Settings Gear at x 65..105, y 20..70
      const d2 = Math.hypot(x - 85, y - 45);
      if (d2 < 22) {
        if (d2 < 14) label = 5;
        else label = 7;
      }

      // Icon 3: Calendar / Apps at x 115..155, y 20..70
      const d3 = Math.hypot(x - 135, y - 45);
      if (d3 < 20) {
        if (x > 125 && x < 133 && y > 38 && y < 46) label = 0;
        else if (x > 137 && x < 145 && y > 38 && y < 46) label = 4;
        else if (x > 125 && x < 133 && y > 49 && y < 57) label = 2;
        else if (x > 137 && x < 145 && y > 49 && y < 57) label = 1;
        else label = 5;
      }

      // Icon 4: Illustrator Ai at x 165..205, y 20..70
      const d4 = Math.hypot(x - 185, y - 45);
      if (d4 < 22) {
        if ((x > 175 && x < 183 && y > 35 && y < 55) || (x > 187 && x < 195 && y > 35 && y < 55)) {
          label = 0;
        } else {
          label = 6;
        }
      }

      // Bottom orange spark
      if (x > 133 && x < 137 && y > 76 && y < 80) {
        label = 0;
      }

      labels[idx] = label;
      punchLabels[idx] = label;

      const c = palette[label]!;
      const offset = idx * 4;

      const jitter = ((x * 17 + y * 31) % 9) - 4;
      const sr = Math.max(0, Math.min(255, c.r + jitter * 2));
      const sg = Math.max(0, Math.min(255, c.g + jitter));
      const sb = Math.max(0, Math.min(255, c.b + jitter * 2));

      sourceRgba[offset] = sr;
      sourceRgba[offset + 1] = sg;
      sourceRgba[offset + 2] = sb;
      sourceRgba[offset + 3] = 255;

      colors[offset] = c.r;
      colors[offset + 1] = c.g;
      colors[offset + 2] = c.b;
      colors[offset + 3] = 255;
    }
  }

  return {
    colors,
    labels,
    punchLabels,
    palette,
    opaque,
    spread: 0,
    sourceRgba
  };
}

function initDemo(): void {
  const container = document.getElementById("diagram-container");
  const previewCanvas = document.getElementById("preview-canvas") as HTMLCanvasElement;
  const previewCtx = previewCanvas.getContext("2d");

  const baseStage = generateSampleStage();
  previewCanvas.width = 240;
  previewCanvas.height = 90;

  function renderPreviewRaster(rgba: Uint8Array): void {
    if (!previewCtx) return;
    const imgData = previewCtx.createImageData(240, 90);
    imgData.data.set(rgba);
    previewCtx.putImageData(imgData, 0, 0);
  }

  const diagram = mountColorDiagram(container, {
    onSelectCluster: (clusterIndex, dimmedRaster) => {
      if (dimmedRaster) {
        renderPreviewRaster(dimmedRaster);
      } else {
        renderPreviewRaster(baseStage.colors);
      }
    },
    onPreviewUpdate: (raster) => {
      renderPreviewRaster(raster);
    },
    onApply: () => {
      console.log("Apply clicked, rerunning downstream steps 3-8!");
    },
    onDiscard: () => {
      renderPreviewRaster(baseStage.colors);
    }
  });

  diagram.update(baseStage, { maxColors: 6 });

  // Synchronously select cluster 0 and display the Discard/Apply bar
  diagram.showApplyBar(true);
  diagram.selectCluster(0);

  const dimmed = createDimmedPreview(baseStage, 0);
  renderPreviewRaster(dimmed);
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", initDemo);
} else {
  initDemo();
}
