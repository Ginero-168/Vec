import type { Rgb } from "./model";

export const SAMPLE_ORANGE: Rgb = { r: 242, g: 107, b: 29 };
export const SAMPLE_CREAM: Rgb = { r: 244, g: 236, b: 220 };
export const SAMPLE_SPECKLE: Rgb = { r: 248, g: 140, b: 60 };
export const SAMPLE_FRINGE: Rgb = { r: 245, g: 120, b: 40 };

export type SampleImage = { readonly width: number; readonly height: number; readonly rgba: Uint8Array };

/**
 * Small anti-aliased balloon: two stripe colors, isolated light-orange speckles
 * on one stripe, and a 1px fringe where two stripes meet. Edges use coverage alpha
 * so the silhouette softens without inventing extra palette colors.
 */
export function makeStripeSample(): SampleImage {
  const width = 120;
  const height = 156;
  const rgba = new Uint8Array(width * height * 4);
  const cx = 60;
  const cy = 64;
  const rx = 50;
  const ry = 56;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let cover = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const px = x + (sx + 0.5) / 4;
          const py = y + (sy + 0.5) / 4;
          const nx = (px - cx) / rx;
          const ny = (py - cy) / ry;
          if (nx * nx + ny * ny <= 1) cover++;
        }
      }
      if (cover === 0) continue;
      const band = stripeBand(x + 0.5, cx, rx);
      const bandLeft = stripeBand(x - 0.5, cx, rx);
      const bandRight = stripeBand(x + 1.5, cx, rx);
      let color = band % 2 === 0 ? SAMPLE_ORANGE : SAMPLE_CREAM;
      if (band === 2 && bandLeft === 1) color = SAMPLE_FRINGE;
      if (band === 2 && bandLeft === 2 && bandRight === 2 && x % 5 === 1 && y % 6 === 2) color = SAMPLE_SPECKLE;
      const offset = (y * width + x) * 4;
      rgba[offset] = color.r;
      rgba[offset + 1] = color.g;
      rgba[offset + 2] = color.b;
      rgba[offset + 3] = Math.round((cover / 16) * 255);
    }
  }
  return { width, height, rgba };
}

function stripeBand(x: number, cx: number, rx: number): number {
  const u = (x - cx) / rx;
  return Math.max(0, Math.min(4, Math.floor((u + 1) * 2.5)));
}
