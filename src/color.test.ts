import assert from "node:assert/strict";
import { test } from "node:test";
import { deltaE2000, rgbToLab, rgbToOklab, oklabToRgb } from "./color.ts";

test("identical Lab colors have CIEDE2000 of zero", () => {
  const lab = rgbToLab({ r: 40, g: 20, b: 15 });
  assert.equal(deltaE2000(lab, lab), 0);
});

test("Sharma 2005 pair is about 2.0425", () => {
  const delta = deltaE2000({ L: 50, a: 2.6772, b: -79.7751 }, { L: 50, a: 0, b: -82.7485 });
  assert.ok(Math.abs(delta - 2.0425) < 0.001, String(delta));
});

test("OKLab round-trips primary colors", () => {
  for (const color of [
    { r: 0, g: 0, b: 0 },
    { r: 255, g: 255, b: 255 },
    { r: 220, g: 40, b: 40 },
    { r: 40, g: 80, b: 220 }
  ]) {
    const back = oklabToRgb(rgbToOklab(color));
    assert.ok(Math.abs(back.r - color.r) <= 1 && Math.abs(back.g - color.g) <= 1 && Math.abs(back.b - color.b) <= 1);
  }
});
