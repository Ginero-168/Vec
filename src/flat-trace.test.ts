import assert from "node:assert/strict";
import { test } from "node:test";
import { cornerColor, labelImage, subjectBoxes } from "./flat-trace.ts";
import { encodeRgbaPng } from "./png-alpha.ts";
import { cappedPalette, planTrace, punchBorderBackdrop } from "./trace-pipeline.ts";

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

test("a forced single color still keeps a dark red flat off brown", () => {
  const image = fill(36, 36, 83, 70, 59, 255);
  paint(image, 36, 8, 8, 20, 20, 46, 4, 2);
  const painted = labelImage(image.rgba, 36, 36, 1);
  const red = pixel(painted.rgba, painted.width, 18 * 8, 18 * 8);
  assert.ok(red.r > red.g + 20 && red.g < 40);
  assert.ok(painted.palette.some((color) => channel(color, 0) > 60 && channel(color, 1) > 40));
});

test("preprocess runs before the palette is read", () => {
  const image = fill(16, 16, 20, 40, 220, 255);
  const painted = labelImage(image.rgba, 16, 16, 2, (rgba) => {
    const next = new Uint8Array(rgba.length);
    for (let index = 0; index < rgba.length; index += 4) {
      next[index] = 220;
      next[index + 1] = 30;
      next[index + 2] = 40;
      next[index + 3] = 255;
    }
    return next;
  });
  const center = pixel(painted.rgba, painted.width, 8 * 8, 8 * 8);
  assert.ok(center.r > center.b);
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

test("a transparent corner means no backdrop colour", () => {
  const image = fill(20, 20, 235, 32, 39, 255);
  assert.equal(cornerColor(image.rgba, 20, 20), "#eb2027");
  setPixel(image, 20, 0, 0, 0, 0, 0, 0);
  assert.equal(cornerColor(image.rgba, 20, 20), null);
});

test("a subject touching the frame keeps the whole frame instead of being dropped", () => {
  const marks = fill(160, 70, 0, 0, 0, 0);
  paint(marks, 160, 0, 16, 28, 28, 54, 197, 240);
  paint(marks, 160, 60, 16, 28, 28, 224, 30, 90);
  paint(marks, 160, 120, 16, 28, 28, 46, 182, 125);
  assert.deepEqual(subjectBoxes(marks.rgba, 160, 70), [{ x: 0, y: 0, width: 160, height: 70 }]);
});

test("a two-pixel stroke gets its own palette colour but a one-pixel anti-aliased rim does not", () => {
  const image = fill(40, 40, 255, 255, 255, 255);
  paint(image, 40, 4, 4, 20, 20, 221, 46, 68);
  paint(image, 40, 3, 3, 22, 1, 238, 150, 161);
  paint(image, 40, 3, 24, 22, 1, 238, 150, 161);
  paint(image, 40, 3, 3, 1, 22, 238, 150, 161);
  paint(image, 40, 24, 3, 1, 22, 238, 150, 161);
  paint(image, 40, 31, 4, 2, 30, 0, 0, 0);
  const painted = labelImage(image.rgba, 40, 40, 8);
  assert.ok(painted.palette.some((color) => channel(color, 0) < 40 && channel(color, 1) < 40 && channel(color, 2) < 40), painted.palette.join(","));
  assert.ok(!painted.palette.some((color) => channel(color, 0) > 225 && channel(color, 1) > 120 && channel(color, 1) < 180), painted.palette.join(","));
});

test("a two-pixel anti-aliased ring between two flats does not become its own colour", () => {
  // JPEG and soft edges leave a ring that is wider than one pixel; it is still a mix of the colours on either side.
  const image = fill(40, 40, 255, 255, 255, 255);
  paint(image, 40, 8, 8, 24, 24, 143, 235, 176);
  paint(image, 40, 10, 10, 20, 20, 30, 215, 96);
  const painted = labelImage(image.rgba, 40, 40, 8);
  assert.ok(!painted.palette.some((color) => channel(color, 0) > 110 && channel(color, 0) < 200 && channel(color, 1) > 200), painted.palette.join(","));
});

test("a soft transparent edge is cut at its sub-pixel contour, not on the pixel grid", () => {
  const image = fill(16, 16, 0, 0, 0, 0);
  for (let y = 0; y < 16; y += 1) {
    setPixel(image, 16, 5, y, 220, 30, 40, 64);
    for (let x = 6; x < 16; x += 1) setPixel(image, 16, x, y, 220, 30, 40, 255);
  }
  const painted = labelImage(image.rgba, 16, 16, 8);
  const row = 8 * 8 + 4;
  let first = -1;
  for (let x = 0; x < painted.width; x += 1) {
    if ((painted.rgba[(row * painted.width + x) * 4 + 3] ?? 0) > 0) { first = x; break; }
  }
  // The 50% opacity crossing lies between the 64 and 255 pixel centres, a third of the way in: 8 * 5.84 = 46.7.
  assert.equal(first, 47);
});

test("the backdrop punch peels a pale anti-aliasing halo but keeps pale content beyond one source pixel", () => {
  const width = 96;
  const image = fill(width, width, 255, 255, 255, 255);
  paint(image, width, 20, 20, 40, 40, 255, 235, 220);
  paint(image, width, 24, 24, 32, 32, 233, 84, 32);
  paint(image, width, 64, 20, 28, 40, 255, 235, 220);
  const out = punchBorderBackdrop(image.rgba, width, width, "#ffffff", 8);
  const alpha = (x: number, y: number) => out[(y * width + x) * 4 + 3];
  assert.equal(alpha(1, 1), 0);
  assert.equal(alpha(22, 40), 0, "4px halo ring around the subject");
  assert.equal(alpha(40, 40), 255, "subject");
  assert.equal(alpha(66, 40), 0, "edge of the pale block");
  assert.equal(alpha(78, 40), 255, "pale block interior, 14px from the backdrop");
});

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
