import assert from "node:assert/strict";
import test from "node:test";
import { framePlacementTransform } from "./placement-geometry.ts";

test("maps the full viewBox frame onto the original placement bounds", () => {
  assert.deepEqual(framePlacementTransform([0, 162, 704, 0], [20, 540, 372, 459]), {
    scaleX: 0.5,
    scaleY: 0.5,
    translateX: 20,
    translateY: 459
  });
});

test("maps a cropped viewBox frame independently onto cropped placement bounds", () => {
  const transform = framePlacementTransform([14, 118, 610, 22], [125, 470, 423, 422]);
  assert.equal(transform.scaleX, 0.5);
  assert.equal(transform.scaleY, 0.5);
  assert.equal(transform.translateX, 118);
  assert.equal(transform.translateY, 411);
  assert.deepEqual([
    14 * transform.scaleX + transform.translateX,
    118 * transform.scaleY + transform.translateY,
    610 * transform.scaleX + transform.translateX,
    22 * transform.scaleY + transform.translateY
  ], [125, 470, 423, 422]);
});

test("rejects degenerate and non-finite frames or placement bounds", () => {
  assert.throws(() => framePlacementTransform([0, 10, 0, 0], [0, 10, 20, 0]), RangeError);
  assert.throws(() => framePlacementTransform([0, 10, 20, 0], [0, 10, 20, Number.NaN]), RangeError);
});
