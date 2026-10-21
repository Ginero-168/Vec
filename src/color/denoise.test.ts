import * as assert from "node:assert/strict";
import { test } from "node:test";
import { guidedFilter } from "./denoise";
import { segmentImage } from "./segment";

function blockyEdge(): { rgba: Uint8Array; width: number; height: number } {
  const width = 96;
  const height = 80;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const block = ((Math.floor(x / 8) + Math.floor(y / 8)) % 2) * 18 - 9;
      const ring = x > 44 && x < 52 ? Math.round(Math.sin((x - 48) * 1.7) * 22) : 0;
      const base = x < 48 ? 40 : 210;
      const value = Math.max(0, Math.min(255, base + block + ring));
      rgba[offset] = value;
      rgba[offset + 1] = value;
      rgba[offset + 2] = value;
      rgba[offset + 3] = 255;
    }
  }
  return { rgba, width, height };
}

function speckCount(labels: Uint16Array, width: number, height: number): number {
  const seen = new Uint8Array(labels.length);
  const stack: number[] = [];
  let specks = 0;
  for (let start = 0; start < labels.length; start++) {
    if (seen[start]) continue;
    const label = labels[start] ?? 0;
    stack.push(start);
    seen[start] = 1;
    let count = 0;
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      count++;
      const x = current % width;
      const y = (current - x) / width;
      const neighbors = [x > 0 ? current - 1 : -1, x + 1 < width ? current + 1 : -1, y > 0 ? current - width : -1, y + 1 < height ? current + width : -1];
      for (const next of neighbors) {
        if (next < 0 || seen[next] || (labels[next] ?? -1) !== label) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    if (count > 0 && count < 24) specks++;
  }
  return specks;
}

test("a guided filter removes JPEG blocks without moving a hard edge", () => {
  const image = blockyEdge();
  const noisy = segmentImage(image.rgba, image.width, image.height, 8, { preset: "photo" });
  const filtered = guidedFilter(image.rgba, image.width, image.height);
  const clean = segmentImage(filtered, image.width, image.height, 8, { preset: "photo" });
  const noisySpecks = speckCount(noisy.labels, image.width, image.height);
  const cleanSpecks = speckCount(clean.labels, image.width, image.height);
  assert.ok(cleanSpecks < noisySpecks, "specks " + cleanSpecks + " vs " + noisySpecks);
  let edge = 0;
  let samples = 0;
  for (let y = 8; y < image.height - 8; y++) {
    for (let x = 20; x < image.width - 8; x++) {
      const previous = clean.palette[clean.labels[y * image.width + x - 1] ?? 0];
      const current = clean.palette[clean.labels[y * image.width + x] ?? 0];
      if (!previous || !current) continue;
      if (previous.r < 110 && current.r > 150) {
        edge += x;
        samples++;
        break;
      }
    }
  }
  const mean = samples > 0 ? edge / samples : 0;
  assert.ok(Math.abs(mean - 48) <= 2, "edge at " + mean.toFixed(2));
});
