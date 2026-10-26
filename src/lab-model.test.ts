import assert from "node:assert/strict";
import { test } from "node:test";
import { controlsFor, styleVectors, traceRequest } from "./lab-model.ts";

test("icon and photo presets expose the cutoffs the panel uses", () => {
  const icon = controlsFor("icon");
  assert.equal(icon.opaqueAt, 200);
  assert.equal(icon.maxColors, 8);
  assert.equal(icon.sealWidth, 2);
  assert.equal(icon.removeBackground, true);
  const photo = controlsFor("photo");
  assert.equal(photo.opaqueAt, 128);
  assert.equal(photo.maxColors, 32);
  assert.equal(photo.clustering, "watershed");
  assert.equal(photo.sealWidth, 0.8);
  assert.equal(photo.removeBackground, false);
});

test("a locked palette is what VTracer receives, and an unlocked count is a max-colors cap", () => {
  const locked = traceRequest(controlsFor("icon"), ["#112233", "#abcdef"]);
  assert.deepEqual(locked.palette, ["#112233", "#abcdef"]);
  assert.equal(locked.maxColors, 0);
  const open = traceRequest({ ...controlsFor("icon"), lockPalette: false, traceColors: 5 }, ["#112233"]);
  assert.equal(open.palette, undefined);
  assert.equal(open.maxColors, 5);
});

test("sealing adds a stroke and leaving it off keeps the path bare", () => {
  const svg = '<svg viewBox="0 0 40 4"><path d="M0,0 H10 V1 H20 V0 H30 V1 H40" fill="#ff0000"/></svg>';
  const rough = controlsFor("logo");
  const sealed = styleVectors(svg, { ...rough, seal: true, sealWidth: 2, dropPlate: false, fitGeometry: false }, null);
  const open = styleVectors(svg, { ...rough, seal: false, dropPlate: false, fitGeometry: false }, null);
  assert.match(sealed.sealed, /stroke-width="2"/);
  assert.equal(/stroke-width=/.test(open.sealed), false);
});

test("the sentinel fill is removed before fairing", () => {
  const svg = '<svg viewBox="0 0 10 10"><path d="M0,0 H10 V10 H0 Z" fill="#ff00ff"/><path d="M2,2 H6 V6 H2 Z" fill="#ff0000"/></svg>';
  const styled = styleVectors(svg, { ...controlsFor("logo"), dropPlate: false, fitGeometry: false, seal: false }, "#ff00ff");
  assert.equal(styled.fitted.includes("#ff00ff"), false);
  assert.match(styled.fitted, /#ff0000/);
});
