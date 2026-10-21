import * as assert from "node:assert/strict";
import * as fs from "fs";
import { test } from "node:test";
import { decodePng } from "./png";
import { segmentImage } from "./segment";
import { traceSegmentation } from "./trace";

test("the 1612x649 screenshot stays under 2.5s for segment and trace", () => {
  const decoded = decodePng(fs.readFileSync("fixtures/user-test-original.png"));
  const once = () => {
    const started = performance.now();
    const segmentation = segmentImage(decoded.data, decoded.width, decoded.height, 12, { preset: "ui" });
    traceSegmentation(segmentation, {
      preset: "ui",
      smooth: 0.5,
      source: decoded.data,
      coverage: segmentation.coverage,
      partner: segmentation.partner
    });
    return performance.now() - started;
  };
  const first = once();
  const second = once();
  const ms = Math.min(first, second);
  assert.ok(ms < 2500, "segment+trace " + first.toFixed(0) + "ms then " + second.toFixed(0) + "ms");
});
