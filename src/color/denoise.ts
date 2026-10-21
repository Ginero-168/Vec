/**
 * Edge-preserving guided filter (He, Sun, Tang). A JPEG block is low variance
 * and gets averaged; a real edge keeps a high guide variance and stays put.
 */
export function guidedFilter(rgba: Uint8Array, width: number, height: number, radius = 3, eps = 140): Uint8Array {
  const pixels = width * height;
  const guide = new Float64Array(pixels);
  const red = new Float64Array(pixels);
  const green = new Float64Array(pixels);
  const blue = new Float64Array(pixels);
  for (let i = 0; i < pixels; i++) {
    const offset = i * 4;
    const r = rgba[offset] ?? 0;
    const g = rgba[offset + 1] ?? 0;
    const b = rgba[offset + 2] ?? 0;
    guide[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    red[i] = r;
    green[i] = g;
    blue[i] = b;
  }
  const meanI = boxMean(guide, width, height, radius);
  const meanII = boxMean(product(guide, guide), width, height, radius);
  const meanR = boxMean(red, width, height, radius);
  const meanG = boxMean(green, width, height, radius);
  const meanB = boxMean(blue, width, height, radius);
  const meanIR = boxMean(product(guide, red), width, height, radius);
  const meanIG = boxMean(product(guide, green), width, height, radius);
  const meanIB = boxMean(product(guide, blue), width, height, radius);
  const aR = new Float64Array(pixels);
  const aG = new Float64Array(pixels);
  const aB = new Float64Array(pixels);
  const bR = new Float64Array(pixels);
  const bG = new Float64Array(pixels);
  const bB = new Float64Array(pixels);
  for (let i = 0; i < pixels; i++) {
    const variance = (meanII[i] ?? 0) - (meanI[i] ?? 0) * (meanI[i] ?? 0);
    const denom = variance + eps;
    aR[i] = ((meanIR[i] ?? 0) - (meanI[i] ?? 0) * (meanR[i] ?? 0)) / denom;
    aG[i] = ((meanIG[i] ?? 0) - (meanI[i] ?? 0) * (meanG[i] ?? 0)) / denom;
    aB[i] = ((meanIB[i] ?? 0) - (meanI[i] ?? 0) * (meanB[i] ?? 0)) / denom;
    bR[i] = (meanR[i] ?? 0) - (aR[i] ?? 0) * (meanI[i] ?? 0);
    bG[i] = (meanG[i] ?? 0) - (aG[i] ?? 0) * (meanI[i] ?? 0);
    bB[i] = (meanB[i] ?? 0) - (aB[i] ?? 0) * (meanI[i] ?? 0);
  }
  const meanAR = boxMean(aR, width, height, radius);
  const meanAG = boxMean(aG, width, height, radius);
  const meanAB = boxMean(aB, width, height, radius);
  const meanBR = boxMean(bR, width, height, radius);
  const meanBG = boxMean(bG, width, height, radius);
  const meanBB = boxMean(bB, width, height, radius);
  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < pixels; i++) {
    const offset = i * 4;
    out[offset] = clampByte((meanAR[i] ?? 0) * (guide[i] ?? 0) + (meanBR[i] ?? 0));
    out[offset + 1] = clampByte((meanAG[i] ?? 0) * (guide[i] ?? 0) + (meanBG[i] ?? 0));
    out[offset + 2] = clampByte((meanAB[i] ?? 0) * (guide[i] ?? 0) + (meanBB[i] ?? 0));
    out[offset + 3] = rgba[offset + 3] ?? 255;
  }
  return out;
}

function product(left: Float64Array, right: Float64Array): Float64Array {
  const out = new Float64Array(left.length);
  for (let i = 0; i < left.length; i++) out[i] = (left[i] ?? 0) * (right[i] ?? 0);
  return out;
}

function boxMean(source: Float64Array, width: number, height: number, radius: number): Float64Array {
  const integral = new Float64Array((width + 1) * (height + 1));
  const stride = width + 1;
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += source[y * width + x] ?? 0;
      integral[(y + 1) * stride + x + 1] = (integral[y * stride + x + 1] ?? 0) + row;
    }
  }
  const out = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const sum =
        (integral[(y1 + 1) * stride + x1 + 1] ?? 0) -
        (integral[y0 * stride + x1 + 1] ?? 0) -
        (integral[(y1 + 1) * stride + x0] ?? 0) +
        (integral[y0 * stride + x0] ?? 0);
      out[y * width + x] = sum / ((y1 - y0 + 1) * (x1 - x0 + 1));
    }
  }
  return out;
}

function clampByte(value: number): number {
  if (value < 0) return 0;
  if (value > 255) return 255;
  return Math.round(value);
}
