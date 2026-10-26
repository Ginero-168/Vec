import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeRgbaPng, punchTransparency, readRgbaPng } from "./png-alpha.ts";

test("transparent pixels are replaced with a color the tracer can drop", () => {
  const rgba = new Uint8Array([
    255, 0, 0, 255,
    0, 0, 0, 0,
    0, 0, 255, 255,
    0, 0, 0, 10
  ]);
  const punched = punchTransparency(encodeRgbaPng(2, 2, rgba));
  assert.equal(punched.droppedColor, "#ff00ff");
  const image = readRgbaPng(punched.png);
  assert.ok(image);
  assert.deepEqual(Array.from(image.rgba), [
    255, 0, 0, 255,
    255, 0, 255, 255,
    0, 0, 255, 255,
    255, 0, 255, 255
  ]);
  assert.equal(punchTransparency(punched.png).droppedColor, null);
});

test("an opaque image and a non-png are left unchanged", () => {
  const rgba = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]);
  const png = encodeRgbaPng(2, 1, rgba);
  const punched = punchTransparency(png);
  assert.equal(punched.droppedColor, null);
  assert.equal(punched.png.equals(png), true);
  const junk = Buffer.from("not a png");
  assert.equal(punchTransparency(junk).png.equals(junk), true);
});
