import assert from "node:assert/strict";
import { test } from "node:test";
import { presetDefaults, simplifyTolerance, vtracerArguments } from "./trace.ts";

test("a higher smoothness uses a tighter curve tolerance", () => {
  assert.equal(simplifyTolerance(0), 2.2);
  assert.equal(simplifyTolerance(2.4), 0.4);
  assert.equal(simplifyTolerance(3), 0.15);
  assert.equal(simplifyTolerance(9), 0.15);
});

test("every preset fits splines and the icon preset is not forced to polygons", () => {
  const icon = vtracerArguments("in.png", "out.svg", {
    preset: "icon",
    maxColors: 8,
    smoothness: 2,
    removeBackground: true,
    stacking: "cutout"
  });
  assert.deepEqual(icon.slice(0, 2), ["in.png", "out.svg"]);
  assert.equal(icon.includes("polygon"), false);
  assert.equal(icon.includes("spline"), true);
  assert.ok(icon.includes("--color-precision"));
  assert.equal(icon[icon.indexOf("--color-precision") + 1], "5");
  assert.equal(icon[icon.indexOf("--simplify") + 1], "0.70");
  assert.equal(icon[icon.indexOf("--max-colors") + 1], "8");
  assert.equal(icon[icon.indexOf("--hierarchical") + 1], "cutout");

  const photo = vtracerArguments("in.png", "out.svg", {
    preset: "photo",
    maxColors: 36,
    smoothness: 1.6,
    removeBackground: false,
    stacking: "stacked"
  });
  assert.equal(photo.includes("cutout"), false);
  assert.equal(photo[photo.indexOf("--preset") + 1], "photo");
  assert.equal(photo[photo.indexOf("--hierarchical") + 1], "stacked");
  assert.equal(photo[photo.indexOf("--simplify") + 1], "1.00");
  assert.equal(photo[photo.indexOf("--color-precision") + 1], "8");
  assert.equal(photo[photo.indexOf("--filter-speckle") + 1], "1");
  assert.equal(photo[photo.indexOf("--clustering") + 1], "watershed");
  assert.equal(photo[photo.indexOf("--watershed-detail") + 1], "128");
  assert.deepEqual(presetDefaults("photo"), { maxColors: 48, smoothness: 2, corner: 20, removeBackground: false, stacking: "stacked" });
  const fixed = vtracerArguments("in.png", "out.svg", {
    preset: "logo",
    maxColors: 2,
    smoothness: 2,
    removeBackground: true,
    stacking: "cutout",
    palette: ["#112233", "#445566"]
  });
  assert.equal(fixed[fixed.indexOf("--palette") + 1], "#112233,#445566");

  const auto = vtracerArguments("in.png", "out.svg", {
    preset: "logo",
    maxColors: 0,
    smoothness: 2.4,
    removeBackground: true,
    stacking: "cutout"
  });
  assert.equal(auto.includes("--max-colors"), false);
  assert.equal(auto[auto.indexOf("--simplify") + 1], "0.40");
});
