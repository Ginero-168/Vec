import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCoverageMap,
  extractIsoSegments,
  chainSegmentsIntoLoops,
  fitCircleOnCoverage,
  fitRoundedRectOnCoverage,
  refineSvgEdges,
  findSubpixelShift,
  type Point
} from "./subpixel-edges.ts";

test("synthetic AA disc contour fitting lands within 0.05 px of truth with radius bias ~0", () => {
  const width = 128;
  const height = 128;
  const cx = 64.0;
  const cy = 64.0;
  const trueRadius = 40.0;

  // Generate synthetic anti-aliased disc: pixel centers at (x + 0.5, y + 0.5)
  const coverage = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      coverage[y * width + x] = Math.max(0, Math.min(1, trueRadius - d + 0.5));
    }
  }

  // 1. Extract 50%-coverage iso-contour via Marching Squares
  const segments = extractIsoSegments(coverage, width, height, 0.5);
  assert.ok(segments.length > 100, "Must extract continuous contour segments");

  let sumR = 0;
  let sumErr = 0;
  let maxErr = 0;
  let ptCount = 0;

  for (const seg of segments) {
    for (const pt of [seg.a, seg.b]) {
      const d = Math.hypot(pt.x - cx, pt.y - cy);
      sumR += d;
      const err = Math.abs(d - trueRadius);
      sumErr += err;
      if (err > maxErr) maxErr = err;
      ptCount++;
    }
  }

  const fittedRadius = sumR / ptCount;
  const meanErr = sumErr / ptCount;
  const radiusBias = Math.abs(fittedRadius - trueRadius);

  // Assertions specified by prompt: fitted boundary within 0.05 px of truth; radius bias ~0
  assert.ok(meanErr < 0.05, `Mean boundary error ${meanErr} must be < 0.05 px`);
  assert.ok(radiusBias < 0.01, `Radius bias ${radiusBias} must be ~0 (< 0.01 px)`);
});

test("synthetic AA rectangle contour fitting lands within 0.05 px of truth", () => {
  const width = 128;
  const height = 128;
  const x0 = 24.0;
  const y0 = 32.0;
  const x1 = 104.0;
  const y1 = 96.0;

  const coverage = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const covX = Math.max(0, Math.min(1, Math.min(px - x0 + 0.5, x1 - px + 0.5)));
      const covY = Math.max(0, Math.min(1, Math.min(py - y0 + 0.5, y1 - py + 0.5)));
      coverage[y * width + x] = covX * covY;
    }
  }

  const segments = extractIsoSegments(coverage, width, height, 0.5);
  assert.ok(segments.length > 50, "Must extract rect segments");

  let sumErr = 0;
  let ptCount = 0;

  for (const seg of segments) {
    for (const pt of [seg.a, seg.b]) {
      let distToEdge: number;
      if (pt.x >= x0 && pt.x <= x1 && pt.y >= y0 && pt.y <= y1) {
        distToEdge = Math.min(pt.x - x0, x1 - pt.x, pt.y - y0, y1 - pt.y);
      } else {
        const dx = Math.max(x0 - pt.x, 0, pt.x - x1);
        const dy = Math.max(y0 - pt.y, 0, pt.y - y1);
        distToEdge = Math.hypot(dx, dy);
      }
      sumErr += distToEdge;
      ptCount++;
    }
  }

  const meanErr = sumErr / ptCount;
  assert.ok(meanErr < 0.05, `Rect boundary error ${meanErr} must be < 0.05 px`);
});

test("primitive circle fit on coverage eliminates the +0.24 px dilated mask bias", () => {
  const width = 128;
  const height = 128;
  const cx = 64.0;
  const cy = 64.0;
  const trueRadius = 50.0;

  // Synthetic disc raster
  const rgba = new Uint8Array(width * height * 4);
  rgba.fill(255); // White background
  const green = [30, 215, 96];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const cov = Math.max(0, Math.min(1, trueRadius - d + 0.5));
      const idx = (y * width + x) * 4;
      rgba[idx] = Math.round(255 * (1 - cov) + green[0]! * cov);
      rgba[idx + 1] = Math.round(255 * (1 - cov) + green[1]! * cov);
      rgba[idx + 2] = Math.round(255 * (1 - cov) + green[2]! * cov);
      rgba[idx + 3] = 255;
    }
  }

  // Simulate an initial circle with the notorious +0.24 px dilated-mask bias
  const biasedInitial = { cx: 64.0, cy: 64.0, r: 50.24 };
  const refined = fitCircleOnCoverage(biasedInitial, rgba, width, height, green as [number, number, number]);

  assert.ok(refined !== null, "Refined circle must be returned");
  assert.ok(Math.abs(refined.cx - cx) < 0.05, "Center X must match truth");
  assert.ok(Math.abs(refined.cy - cy) < 0.05, "Center Y must match truth");
  const bias = Math.abs(refined.r - trueRadius);
  assert.ok(bias < 0.02, `Fitted radius ${refined.r} must eliminate bias (error ${bias} < 0.02 px)`);
});

test("edge-band control point refinement snaps biased path onto 50% coverage contour", () => {
  const width = 128;
  const height = 128;
  const cx = 64.0;
  const cy = 64.0;
  const trueRadius = 40.0;

  const rgba = new Uint8Array(width * height * 4);
  rgba.fill(255);
  const color = [220, 50, 50];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const cov = Math.max(0, Math.min(1, trueRadius - d + 0.5));
      const idx = (y * width + x) * 4;
      rgba[idx] = Math.round(255 * (1 - cov) + color[0]! * cov);
      rgba[idx + 1] = Math.round(255 * (1 - cov) + color[1]! * cov);
      rgba[idx + 2] = Math.round(255 * (1 - cov) + color[2]! * cov);
      rgba[idx + 3] = 255;
    }
  }

  // Path with biased coordinates (e.g. 40.25 px)
  const rBiased = 40.25;
  const kappa = 0.5522847498;
  const ox = rBiased * kappa;

  const biasedSvg =
    `<svg width="128" height="128">` +
    `<path d="` +
    `M${cx},${cy - rBiased}` +
    `C${cx + ox},${cy - rBiased} ${cx + rBiased},${cy - ox} ${cx + rBiased},${cy}` +
    `C${cx + rBiased},${cy + ox} ${cx + ox},${cy + rBiased} ${cx},${cy + rBiased}` +
    `C${cx - ox},${cy + rBiased} ${cx - rBiased},${cy + ox} ${cx - rBiased},${cy}` +
    `C${cx - rBiased},${cy - ox} ${cx - ox},${cy - rBiased} ${cx},${cy - rBiased}Z` +
    `" fill="#DC3232"/>` +
    `</svg>`;

  const refinedSvg = refineSvgEdges(biasedSvg, rgba, width, height);

  // Check that the coordinates in the refined SVG moved closer to trueRadius = 40.0
  const match = /M([0-9.]+),([0-9.]+)/.exec(refinedSvg);
  assert.ok(match !== null, "Must match refined path M command");
  const refinedY = Number(match[2]);
  const refinedRadius = cy - refinedY;

  assert.ok(
    Math.abs(refinedRadius - trueRadius) < Math.abs(rBiased - trueRadius),
    `Refined radius ${refinedRadius} must be closer to truth ${trueRadius} than biased ${rBiased}`
  );
  assert.ok(
    Math.abs(refinedRadius - trueRadius) < 0.06,
    `Refined radius error ${Math.abs(refinedRadius - trueRadius)} must be < 0.06 px`
  );
});
