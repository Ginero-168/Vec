const JPEG_BLOCK_SIZE = 8;
const NOISY_SAMPLE_RESIDUAL = 2;
const MIN_NOISY_FRACTION = 0.075;
const MIN_MEAN_RESIDUAL = 0.5;
const FLAT_BLOCK_VARIANCE = 256;
const RANGE_SIGMA = 14;
const SPATIAL_SIGMA = 1.35;
const PASSES = 2;
export const MIN_SIDE = 48;
const RADIUS = 2;

/** Remove low-amplitude JPEG-like noise while leaving clean and transparent rasters alone. */
export function denoiseJpegArtifacts(rgba: Uint8Array, width: number, height: number): Uint8Array {
  if (!wouldDenoise(rgba, width, height)) return rgba;

  let current = correctBlockOffsets(rgba, width, height);
  for (let pass = 0; pass < PASSES; pass += 1) current = bilateralPass(current, width, height);
  return current;
}

export function wouldDenoise(rgba: Uint8Array, width: number, height: number): boolean {
  // Below MIN_SIDE the anti-aliased edges alone read as noise (clean 32 px icons tripped both tests), and a clean
  // input must never be touched, so small rasters are left alone.
  if (Math.min(width, height) < MIN_SIDE) return false;
  return isOpaqueRaster(rgba, width, height) && hasCompressionNoise(rgba, width, height);
}

function isOpaqueRaster(rgba: Uint8Array, width: number, height: number): boolean {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 5 || height < 5 || rgba.length !== width * height * 4) return false;
  const pixels = width * height;
  let opaque = 0;
  for (let offset = 3; offset < rgba.length; offset += 4) if ((rgba[offset] ?? 0) >= 250) opaque += 1;
  return opaque >= pixels * 0.995;
}

/** Estimate high-frequency error only where all four neighbors agree on a smooth area. */
function hasCompressionNoise(rgba: Uint8Array, width: number, height: number): boolean {
  let residualSum = 0;
  let noisySamples = 0;
  let eligibleSamples = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const center = (y * width + x) * 4;
      const left = center - 4;
      const right = center + 4;
      const up = center - width * 4;
      const down = center + width * 4;
      if (maxRgbGap(rgba, center, left) > 32 || maxRgbGap(rgba, center, right) > 32 || maxRgbGap(rgba, center, up) > 32 || maxRgbGap(rgba, center, down) > 32) continue;

      let residual = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        const laplacian = 4 * (rgba[center + channel] ?? 0)
          - (rgba[left + channel] ?? 0)
          - (rgba[right + channel] ?? 0)
          - (rgba[up + channel] ?? 0)
          - (rgba[down + channel] ?? 0);
        residual += Math.abs(laplacian) / 4;
      }
      residual /= 3;
      residualSum += residual;
      eligibleSamples += 1;
      if (residual >= NOISY_SAMPLE_RESIDUAL) noisySamples += 1;
    }
  }
  const residualNoise = eligibleSamples > 0
    && noisySamples / eligibleSamples >= MIN_NOISY_FRACTION
    && residualSum / eligibleSamples >= MIN_MEAN_RESIDUAL;
  return residualNoise || hasBlockBoundaryNoise(rgba, width, height);
}

function hasBlockBoundaryNoise(rgba: Uint8Array, width: number, height: number): boolean {
  let boundarySum = 0;
  let boundaryCount = 0;
  let interiorSum = 0;
  let interiorCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 1; x < width; x += 1) {
      const right = (y * width + x) * 4;
      const left = right - 4;
      if (maxRgbGap(rgba, left, right) > 32) continue;
      const gap = meanRgbGap(rgba, left, right);
      if (x % JPEG_BLOCK_SIZE === 0) {
        boundarySum += gap;
        boundaryCount += 1;
      } else {
        interiorSum += gap;
        interiorCount += 1;
      }
    }
  }
  for (let y = 1; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const down = (y * width + x) * 4;
      const up = down - width * 4;
      if (maxRgbGap(rgba, up, down) > 32) continue;
      const gap = meanRgbGap(rgba, up, down);
      if (y % JPEG_BLOCK_SIZE === 0) {
        boundarySum += gap;
        boundaryCount += 1;
      } else {
        interiorSum += gap;
        interiorCount += 1;
      }
    }
  }
  if (boundaryCount === 0 || interiorCount === 0) return false;
  const boundaryMean = boundarySum / boundaryCount;
  const interiorMean = interiorSum / interiorCount;
  return boundaryMean >= 2 && boundaryMean - interiorMean >= 1.25 && boundaryMean >= interiorMean * 1.25;
}

function meanRgbGap(rgba: Uint8Array, a: number, b: number): number {
  return (
    Math.abs((rgba[a] ?? 0) - (rgba[b] ?? 0))
    + Math.abs((rgba[a + 1] ?? 0) - (rgba[b + 1] ?? 0))
    + Math.abs((rgba[a + 2] ?? 0) - (rgba[b + 2] ?? 0))
  ) / 3;
}

function maxRgbGap(rgba: Uint8Array, a: number, b: number): number {
  return Math.max(
    Math.abs((rgba[a] ?? 0) - (rgba[b] ?? 0)),
    Math.abs((rgba[a + 1] ?? 0) - (rgba[b + 1] ?? 0)),
    Math.abs((rgba[a + 2] ?? 0) - (rgba[b + 2] ?? 0))
  );
}

/** Correct small DC shifts between JPEG blocks, but only in blocks without an internal edge. */
function correctBlockOffsets(source: Uint8Array, width: number, height: number): Uint8Array {
  const columns = Math.ceil(width / JPEG_BLOCK_SIZE);
  const rows = Math.ceil(height / JPEG_BLOCK_SIZE);
  const blockCount = columns * rows;
  const means = new Float64Array(blockCount * 3);
  const variances = new Float64Array(blockCount);

  for (let blockY = 0; blockY < rows; blockY += 1) {
    for (let blockX = 0; blockX < columns; blockX += 1) {
      const block = blockY * columns + blockX;
      const x0 = blockX * JPEG_BLOCK_SIZE;
      const y0 = blockY * JPEG_BLOCK_SIZE;
      const x1 = Math.min(width, x0 + JPEG_BLOCK_SIZE);
      const y1 = Math.min(height, y0 + JPEG_BLOCK_SIZE);
      let red = 0;
      let green = 0;
      let blue = 0;
      let pixels = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const offset = (y * width + x) * 4;
          red += source[offset] ?? 0;
          green += source[offset + 1] ?? 0;
          blue += source[offset + 2] ?? 0;
          pixels += 1;
        }
      }
      const meanOffset = block * 3;
      const meanRed = red / pixels;
      const meanGreen = green / pixels;
      const meanBlue = blue / pixels;
      means[meanOffset] = meanRed;
      means[meanOffset + 1] = meanGreen;
      means[meanOffset + 2] = meanBlue;
      let variance = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const offset = (y * width + x) * 4;
          variance += ((source[offset] ?? 0) - meanRed) ** 2;
          variance += ((source[offset + 1] ?? 0) - meanGreen) ** 2;
          variance += ((source[offset + 2] ?? 0) - meanBlue) ** 2;
        }
      }
      variances[block] = variance / (pixels * 3);
    }
  }

  const output = source.slice();
  for (let blockY = 0; blockY < rows; blockY += 1) {
    for (let blockX = 0; blockX < columns; blockX += 1) {
      const block = blockY * columns + blockX;
      if ((variances[block] ?? Number.POSITIVE_INFINITY) > FLAT_BLOCK_VARIANCE) continue;
      const meanOffset = block * 3;
      const red = means[meanOffset] ?? 0;
      const green = means[meanOffset + 1] ?? 0;
      const blue = means[meanOffset + 2] ?? 0;
      let weightSum = 0;
      let redSum = 0;
      let greenSum = 0;
      let blueSum = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const neighborY = blockY + dy;
        if (neighborY < 0 || neighborY >= rows) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const neighborX = blockX + dx;
          if (neighborX < 0 || neighborX >= columns) continue;
          const neighbor = neighborY * columns + neighborX;
          if ((variances[neighbor] ?? Number.POSITIVE_INFINITY) > FLAT_BLOCK_VARIANCE) continue;
          const neighborOffset = neighbor * 3;
          const neighborRed = means[neighborOffset] ?? 0;
          const neighborGreen = means[neighborOffset + 1] ?? 0;
          const neighborBlue = means[neighborOffset + 2] ?? 0;
          const distance = (red - neighborRed) ** 2 + (green - neighborGreen) ** 2 + (blue - neighborBlue) ** 2;
          if (distance > 64 * 64) continue;
          const weight = Math.exp(-distance / (2 * 20 * 20)) / (1 + dx * dx + dy * dy);
          weightSum += weight;
          redSum += neighborRed * weight;
          greenSum += neighborGreen * weight;
          blueSum += neighborBlue * weight;
        }
      }
      if (weightSum === 0) continue;
      const redDelta = Math.max(-12, Math.min(12, redSum / weightSum - red));
      const greenDelta = Math.max(-12, Math.min(12, greenSum / weightSum - green));
      const blueDelta = Math.max(-12, Math.min(12, blueSum / weightSum - blue));
      const x0 = blockX * JPEG_BLOCK_SIZE;
      const y0 = blockY * JPEG_BLOCK_SIZE;
      const x1 = Math.min(width, x0 + JPEG_BLOCK_SIZE);
      const y1 = Math.min(height, y0 + JPEG_BLOCK_SIZE);
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const offset = (y * width + x) * 4;
          output[offset] = clampByte((source[offset] ?? 0) + redDelta);
          output[offset + 1] = clampByte((source[offset + 1] ?? 0) + greenDelta);
          output[offset + 2] = clampByte((source[offset + 2] ?? 0) + blueDelta);
        }
      }
    }
  }
  return output;
}

function bilateralPass(source: Uint8Array, width: number, height: number): Uint8Array {
  const output = source.slice();
  const rangeWeights = makeRangeWeights();
  const spatialWeights = makeSpatialWeights();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const center = (y * width + x) * 4;
      const red = source[center] ?? 0;
      const green = source[center + 1] ?? 0;
      const blue = source[center + 2] ?? 0;
      let totalWeight = 0;
      let redSum = 0;
      let greenSum = 0;
      let blueSum = 0;
      for (let dy = -RADIUS; dy <= RADIUS; dy += 1) {
        const sampleY = y + dy;
        if (sampleY < 0 || sampleY >= height) continue;
        for (let dx = -RADIUS; dx <= RADIUS; dx += 1) {
          const sampleX = x + dx;
          if (sampleX < 0 || sampleX >= width) continue;
          const sample = (sampleY * width + sampleX) * 4;
          const sampleRed = source[sample] ?? 0;
          const sampleGreen = source[sample + 1] ?? 0;
          const sampleBlue = source[sample + 2] ?? 0;
          const distance = (red - sampleRed) ** 2 + (green - sampleGreen) ** 2 + (blue - sampleBlue) ** 2;
          const rangeIndex = Math.min(rangeWeights.length - 1, Math.round(distance * 16 / (RANGE_SIGMA * RANGE_SIGMA)));
          const spatialIndex = (dy + RADIUS) * (RADIUS * 2 + 1) + dx + RADIUS;
          const weight = (spatialWeights[spatialIndex] ?? 0) * (rangeWeights[rangeIndex] ?? 0);
          totalWeight += weight;
          redSum += sampleRed * weight;
          greenSum += sampleGreen * weight;
          blueSum += sampleBlue * weight;
        }
      }
      if (totalWeight === 0) continue;
      output[center] = Math.round(redSum / totalWeight);
      output[center + 1] = Math.round(greenSum / totalWeight);
      output[center + 2] = Math.round(blueSum / totalWeight);
    }
  }
  return output;
}

function makeRangeWeights(): Float32Array {
  const weights = new Float32Array(2049);
  for (let index = 0; index < weights.length; index += 1) weights[index] = Math.exp(-index / 32);
  return weights;
}

function makeSpatialWeights(): Float32Array {
  const diameter = RADIUS * 2 + 1;
  const weights = new Float32Array(diameter * diameter);
  for (let dy = -RADIUS; dy <= RADIUS; dy += 1) {
    for (let dx = -RADIUS; dx <= RADIUS; dx += 1) {
      weights[(dy + RADIUS) * diameter + dx + RADIUS] = Math.exp(-(dx * dx + dy * dy) / (2 * SPATIAL_SIGMA * SPATIAL_SIGMA));
    }
  }
  return weights;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
