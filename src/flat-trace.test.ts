import assert from "node:assert/strict";
import { test } from "node:test";
import { labelImage, subjectBoxes } from "./flat-trace.ts";
import { encodeRgbaPng } from "./png-alpha.ts";
import { cappedPalette, planTrace } from "./trace-pipeline.ts";

test("a full palette keeps the sentinel in the last slot", () => {
  const colors = ["#ff00ff"];
  for (let index = 0; index < 40; index += 1) colors.push("#" + index.toString(16).padStart(6, "0"));
  const locked = cappedPalette(colors, "#ff00ff");
  assert.equal(locked.length, 32);
  assert.equal(locked.at(-1), "#ff00ff");
  assert.equal(cappedPalette(["#112233"], null).length, 1);
});

test("one subject keeps the whole frame and two separated marks split", () => {
  const single = fill(80, 80, 0, 0, 0, 0);
  paint(single, 80, 10, 10, 30, 30, 255, 255, 255);
  const one = subjectBoxes(single.rgba, 80, 80);
  assert.equal(one.length, 1);
  assert.deepEqual(one[0], { x: 0, y: 0, width: 80, height: 80 });

  const pair = fill(120, 70, 0, 0, 0, 0);
  paint(pair, 120, 8, 16, 28, 28, 255, 255, 255);
  paint(pair, 120, 80, 16, 28, 28, 255, 255, 255);
  const boxes = subjectBoxes(pair.rgba, 120, 70);
  assert.equal(boxes.length, 2);
});

test("a hard color split lands within half a pixel of the middle", () => {
  const image = fill(32, 16, 220, 32, 32, 255);
  for (let y = 0; y < 16; y += 1) {
    for (let x = 16; x < 32; x += 1) setPixel(image, 32, x, y, 32, 32, 220, 255);
  }
  const painted = labelImage(image.rgba, 32, 16, 2);
  const row = 8 * 8 + 4;
  let cross = -1;
  for (let x = 0; x < painted.width; x += 1) {
    const offset = (row * painted.width + x) * 4;
    if ((painted.rgba[offset] ?? 255) < (painted.rgba[offset + 2] ?? 0)) {
      cross = x;
      break;
    }
  }
  assert.ok(Math.abs(cross / 8 - 16) <= 0.5);
});

test("a small red flat stays in the palette and gray is not painted green", () => {
  const image = fill(48, 48, 150, 150, 150, 255);
  paint(image, 48, 4, 4, 8, 8, 220, 16, 16);
  const painted = labelImage(image.rgba, 48, 48, 0);
  assert.ok(painted.palette.some((color) => channel(color, 0) > 180 && channel(color, 1) < 80));

  const mixed = fill(40, 36, 136, 136, 136, 255);
  paint(mixed, 40, 2, 12, 14, 14, 0, 170, 40);
  paint(mixed, 40, 24, 12, 14, 14, 122, 46, 168);
  const result = labelImage(mixed.rgba, 40, 36, 0);
  const green = pixel(result.rgba, result.width, 2 * 8 + 7, 12 * 8 + 7);
  const purple = pixel(result.rgba, result.width, 24 * 8 + 7, 12 * 8 + 7);
  assert.ok(green.g > green.r && green.g > green.b);
  assert.ok(purple.b > purple.g && purple.r > purple.g);
});

test("a logo plan is one 8x plate with the prototype trace settings", () => {
  const image = fill(24, 24, 220, 30, 30, 255);
  for (let y = 0; y < 24; y += 1) {
    for (let x = 12; x < 24; x += 1) setPixel(image, 24, x, y, 20, 30, 200, 255);
  }
  const plan = planTrace(encodeRgbaPng(24, 24, image.rgba), {
    preset: "logo",
    maxColors: 0,
    smoothness: 2.4,
    corner: 35,
    removeBackground: false,
    stacking: "cutout"
  });
  assert.ok(plan !== null);
  const plate = plan?.plates[0];
  assert.ok(plate !== undefined);
  assert.equal(plate?.scale, 8);
  assert.equal(plate?.request.maxColors, 0);
  assert.equal(plate?.request.simplify, 2.4);
  assert.equal(plate?.request.filterSpeckle, 9);
  assert.equal(plate?.request.colorPrecision, 8);
  assert.equal(plate?.request.clustering, "off");
  assert.ok((plate?.request.palette?.length ?? 0) >= 2);
});

type Image = { rgba: Uint8Array };

function fill(width: number, height: number, red: number, green: number, blue: number, alpha: number): Image {
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    rgba[index * 4] = red;
    rgba[index * 4 + 1] = green;
    rgba[index * 4 + 2] = blue;
    rgba[index * 4 + 3] = alpha;
  }
  return { rgba };
}

function paint(image: Image, width: number, x: number, y: number, w: number, h: number, red: number, green: number, blue: number): void {
  for (let row = y; row < y + h; row += 1) {
    for (let column = x; column < x + w; column += 1) setPixel(image, width, column, row, red, green, blue, 255);
  }
}

function setPixel(image: Image, width: number, x: number, y: number, red: number, green: number, blue: number, alpha: number): void {
  const offset = (y * width + x) * 4;
  image.rgba[offset] = red;
  image.rgba[offset + 1] = green;
  image.rgba[offset + 2] = blue;
  image.rgba[offset + 3] = alpha;
}

function pixel(rgba: Uint8Array, width: number, x: number, y: number): { r: number; g: number; b: number } {
  const offset = (y * width + x) * 4;
  return { r: rgba[offset] ?? 0, g: rgba[offset + 1] ?? 0, b: rgba[offset + 2] ?? 0 };
}

function channel(hex: string, index: number): number {
  return Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
}
