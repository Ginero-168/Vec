import assert from "node:assert/strict";
import { test } from "node:test";
import { cornerColor, hasClearPixel, labelImage, subjectBoxes } from "./flat-trace.ts";
import { mergePlates } from "./trace-finish.ts";
import { lossyCleanup, mergeNearCenters } from "./jpeg-clean.ts";
import { rgbToOklab } from "./color.ts";
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

test("an anti-aliased square keeps a square corner in the cut label map", () => {
  // Interior 6..13 opaque, half-covered side pixels, quarter-covered corner pixels: the true corner is at (5.5, 5.5).
  const painted = labelImage(square(20, (x, y) => inside(x, y, 6, 13) ? 255 : edgeOf(x, y, 6, 13)), 20, 20, 8);
  const opaque = (x: number, y: number) => (painted.rgba[(y * painted.width + x) * 4 + 3] ?? 0) > 0;
  assert.ok(opaque(44, 44) && opaque(45, 44) && opaque(44, 45), "sub-pixels at the corner stay opaque");
  assert.ok(!opaque(43, 44) && !opaque(44, 43) && !opaque(43, 43), "nothing grows past the corner");
  assert.ok(opaque(44, 80) && !opaque(43, 80) && opaque(80, 44) && !opaque(80, 43), "straight sides at the half-coverage line");
});

test("an anti-aliased L shape keeps its concave corner", () => {
  // Opaque 4..15 x 4..15 minus the quadrant right of x = 10.5 and above y = 9.5: the notch sides are half-covered
  // pixels and the corner pixel (10, 9) is three-quarters covered.
  const notch = (x: number, y: number) => x >= 10 && y <= 9;
  const alpha = (x: number, y: number) => {
    if (!inside(x, y, 4, 15)) return edgeOf(x, y, 4, 15);
    if (notch(x, y)) return x === 10 && y === 9 ? 192 : x === 10 || y === 9 ? 128 : 0;
    return 255;
  };
  const painted = labelImage(square(20, alpha), 20, 20, 8);
  const opaque = (x: number, y: number) => (painted.rgba[(y * painted.width + x) * 4 + 3] ?? 0) > 0;
  // The notch corner sits at (10.5, 9.5) source px = (84, 76) sub-pixels.
  assert.ok(opaque(83, 76) && opaque(83, 75) && opaque(84, 76) && opaque(85, 76), "the concave corner is filled to the vertex");
  assert.ok(!opaque(84, 75) && !opaque(85, 74), "the notch stays clear up to the vertex");
});

test("anti-aliased seams between touching shapes stay filled where they meet the outline", () => {
  // Three flats meet a transparent quadrant (x >= 11, y >= 10), as in an exported logo: the seams between the flats are
  // 207-alpha pixels, the outline pixels are quarter-covered. Seam pixels next to the junction must not be cut.
  const alpha = (x: number, y: number) => {
    if (!inside(x, y, 4, 15)) return 0;
    if (y <= 8) return x === 10 ? 207 : 255;
    if (y === 9) return x <= 9 ? 207 : x === 10 ? 98 : 64;
    return x <= 9 ? 255 : x === 10 ? 64 : 0;
  };
  const painted = labelImage(square(20, alpha), 20, 20, 8);
  const open: string[] = [];
  for (const [px, py] of [[10, 8], [10, 7], [9, 9], [8, 9]]) {
    for (let dy = 0; dy < 8; dy += 1) for (let dx = 0; dx < 8; dx += 1) {
      if ((painted.rgba[((py * 8 + dy) * painted.width + px * 8 + dx) * 4 + 3] ?? 0) === 0) open.push(`${px},${py}:${dx},${dy}`);
    }
  }
  assert.deepEqual(open, []);
});

test("a thin faint stroke and a small faint hole survive the transparent cut", () => {
  const stroke = labelImage(square(20, (x, y) => x === 10 && y >= 3 && y < 17 ? 100 : 0), 20, 20, 8);
  const strokeRow = 10 * 8 + 4;
  const covered = [...Array(stroke.width).keys()].filter((x) => (stroke.rgba[(strokeRow * stroke.width + x) * 4 + 3] ?? 0) > 0);
  assert.ok(covered.length >= 2 && covered.length <= 5, "a 39% stroke keeps a centred strip: " + covered.join(","));
  assert.ok(covered.every((x) => x >= 80 && x < 88));
  const hole = labelImage(square(20, (x, y) => x === 10 && y === 10 ? 100 : inside(x, y, 4, 15) ? 255 : 0), 20, 20, 8);
  const holeRow = 10 * 8 + 4;
  const open = [...Array(8).keys()].filter((dx) => (hole.rgba[(holeRow * hole.width + 80 + dx) * 4 + 3] ?? 0) === 0);
  assert.ok(open.length >= 3 && open.length <= 6, "a 61% hole stays open: " + open.join(","));
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

function inside(x: number, y: number, low: number, high: number): boolean {
  return x >= low && x <= high && y >= low && y <= high;
}

// Coverage of a pixel in the one-pixel anti-aliased rim around the square low..high: 50% on sides, 25% at corners.
function edgeOf(x: number, y: number, low: number, high: number): number {
  const sideX = x === low - 1 || x === high + 1;
  const sideY = y === low - 1 || y === high + 1;
  const spanX = x >= low && x <= high;
  const spanY = y >= low && y <= high;
  if (sideX && sideY) return 64;
  if ((sideX && spanY) || (sideY && spanX)) return 128;
  return 0;
}

function square(size: number, alpha: (x: number, y: number) => number): Uint8Array {
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      rgba[offset] = 220;
      rgba[offset + 1] = 30;
      rgba[offset + 2] = 40;
      rgba[offset + 3] = alpha(x, y);
    }
  }
  return rgba;
}

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

test("traced fillets are sharpened only on cut-out sources, never on an opaque backdrop", () => {
  const traced = '<svg viewBox="0 0 20 20"><path d="M0,0L9.6,0C9.85,0 10,0.15 10,0.4L10,10L5,10L5,15L0,15Z" fill="#000000"/></svg>';
  const plate = (cutOut: boolean) => ({ scale: 1, originX: 0, originY: 0, borderColor: null, cutOut });
  const cut = mergePlates([traced], [plate(true)], 20, 20, null, false);
  assert.ok(!cut.includes("9.6,0"), cut);
  const backdrop = mergePlates([traced], [plate(false)], 20, 20, null, false);
  assert.ok(backdrop.includes("9.6,0"), backdrop);
});

test("on an opaque backdrop a traced fillet is sharpened only where the source pixels show a sharp corner", () => {
  // Traced at 8x: a 0.4 px fillet at (10,0) in source pixels, on a 128 px canvas.
  const traced = '<svg viewBox="0 0 1024 1024"><path d="M0,0L76.8,0C78.8,0 80,1.2 80,3.2L80,80L40,80L40,120L0,120Z" fill="#000000"/></svg>';
  const source = (radius: number) => {
    const rgba = new Uint8Array(128 * 128 * 4).fill(255);
    for (let y = 0; y < 128; y += 1) {
      for (let x = 0; x < 128; x += 1) {
        let covered = 0;
        for (let sy = 0; sy < 8; sy += 1) {
          for (let sx = 0; sx < 8; sx += 1) {
            const px = x + (sx + 0.5) / 8;
            const py = y + (sy + 0.5) / 8;
            const shape = (px < 10 && py < 10) || (px < 5 && py < 15);
            const tip = radius > 0 && px > 10 - radius && py < radius && Math.hypot(px - (10 - radius), py - radius) > radius;
            if (shape && !tip) covered += 1;
          }
        }
        rgba.fill(Math.round(255 * (1 - covered / 64)), (y * 128 + x) * 4, (y * 128 + x) * 4 + 3);
      }
    }
    return { rgba, width: 128, height: 128 };
  };
  const plate = (radius: number) => ({ scale: 8, originX: 0, originY: 0, borderColor: null, cutOut: false, source: source(radius) });
  const sharp = mergePlates([traced], [plate(0)], 128, 128, null, false);
  assert.ok(!sharp.includes("9.6,0"), sharp);
  const round = mergePlates([traced], [plate(3)], 128, 128, null, false);
  assert.ok(round.includes("9.6,0"), round);
});

test("on an opaque backdrop a fillet is not sharpened on a path whose ink is not the source colour inside it", () => {
  // An underlay (a light body drawn under its outline ring) reaching a sharp black corner: judged with its own
  // fill the black pixels count as full coverage and the sharp corner would always win.
  const traced = (fill: string) =>
    '<svg viewBox="0 0 1024 1024"><path d="M0,0L76.8,0C78.8,0 80,1.2 80,3.2L80,80L40,80L40,120L0,120Z" fill="' + fill + '"/></svg>';
  const rgba = new Uint8Array(128 * 128 * 4).fill(255);
  for (let y = 0; y < 15; y += 1) for (let x = 0; x < (y < 10 ? 10 : 5); x += 1) rgba.fill(0, (y * 128 + x) * 4, (y * 128 + x) * 4 + 3);
  const plate = { scale: 8, originX: 0, originY: 0, borderColor: null, cutOut: false, source: { rgba, width: 128, height: 128 } };
  const own = mergePlates([traced("#000000")], [plate], 128, 128, null, false);
  assert.ok(!own.includes("9.6,0"), own);
  const underlay = mergePlates([traced("#D0CFCE")], [plate], 128, 128, null, false);
  assert.ok(underlay.includes("9.6,0"), underlay);
});

test("on an opaque backdrop a corner traced as one long bend is refitted with two lines when the source is sharp", () => {
  // Traced at 8x: a 3 px rounding at (60,60) in source pixels, too long for the fillet rules; the round left side
  // keeps the shape from fitting as a rectangle.
  const traced = '<svg viewBox="0 0 1024 1024"><path d="M480,160L480,456C480,476 476,480 456,480L320,480C232,480 160,408 160,320C160,232 232,160 320,160Z" fill="#000000"/></svg>';
  const source = (radius: number) => {
    const rgba = new Uint8Array(128 * 128 * 4).fill(255);
    for (let y = 0; y < 128; y += 1) {
      for (let x = 0; x < 128; x += 1) {
        let covered = 0;
        for (let sy = 0; sy < 8; sy += 1) {
          for (let sx = 0; sx < 8; sx += 1) {
            const px = x + (sx + 0.5) / 8;
            const py = y + (sy + 0.5) / 8;
            const shape = px >= 20 && px < 60 && py >= 20 && py < 60 && (px >= 40 || Math.hypot(px - 40, py - 40) <= 20);
            const tip = radius > 0 && px > 60 - radius && py > 60 - radius && Math.hypot(px - (60 - radius), py - (60 - radius)) > radius;
            if (shape && !tip) covered += 1;
          }
        }
        rgba.fill(Math.round(255 * (1 - covered / 64)), (y * 128 + x) * 4, (y * 128 + x) * 4 + 3);
      }
    }
    return { rgba, width: 128, height: 128 };
  };
  const plate = (radius: number) => ({ scale: 8, originX: 0, originY: 0, borderColor: null, cutOut: false, source: source(radius) });
  const sharp = mergePlates([traced], [plate(0)], 128, 128, null, false);
  const corner = /60(\.0\d*)?,60(\.0\d*)?|59\.9\d*,59\.9\d*|60(\.0\d*)?,59\.9\d*|59\.9\d*,60(\.0\d*)?/;
  assert.ok(corner.test(sharp), sharp);
  const round = mergePlates([traced], [plate(3)], 128, 128, null, false);
  assert.ok(round.includes("C60,59.5 59.5,60 57,60"), round);
});

test("a source is a cut-out only when it has see-through pixels", () => {
  const opaque = new Uint8Array(4 * 4).fill(255);
  assert.equal(hasClearPixel(opaque), false);
  opaque[7] = 0;
  assert.equal(hasClearPixel(opaque), true);
});

function centresWithPixels(inks: readonly (readonly [number, number, number, number])[]) {
  const centers = inks.map(([r, g, b]) => rgbToOklab({ r, g, b }));
  const total = inks.reduce((sum, ink) => sum + ink[3], 0);
  const lab = new Float64Array(total * 3);
  const core = new Uint8Array(total).fill(1);
  let at = 0;
  for (const [index, ink] of inks.entries()) {
    for (let count = 0; count < ink[3]; count += 1, at += 1) {
      const center = centers[index]!;
      lab[at * 3] = center.L; lab[at * 3 + 1] = center.a; lab[at * 3 + 2] = center.b;
    }
  }
  return { centers, lab, core };
}

test("JPEG palette cleanup folds near-identical inks and keeps distinct ones", () => {
  // Two reds about ΔE2000 1 apart (one ink split by noise) and a blue.
  const split = centresWithPixels([[220, 30, 40, 500], [222, 32, 41, 400], [30, 80, 200, 300]]);
  const merged = mergeNearCenters(split.centers, split.lab, split.core);
  assert.equal(merged.length, 2);
  // The fold is the pixel-weighted mean, so it lies between the two reds.
  const [red] = merged;
  assert.ok(red!.L >= Math.min(split.centers[0]!.L, split.centers[1]!.L) && red!.L <= Math.max(split.centers[0]!.L, split.centers[1]!.L));
  const distinct = centresWithPixels([[220, 30, 40, 500], [30, 80, 200, 300], [250, 200, 20, 200]]);
  assert.deepEqual(mergeNearCenters(distinct.centers, distinct.lab, distinct.core), distinct.centers);
});

test("JPEG palette cleanup folds a navy tint of a thin black outline into the black", () => {
  // q60 tints a black outline navy here and there: ΔE2000 about 7 apart, both near-black, too many pixels to be a
  // minor satellite. A dark but clearly coloured ink (deep red) stays.
  const tint = centresWithPixels([[255, 255, 255, 5000], [11, 5, 2, 60], [7, 4, 18, 18], [90, 10, 10, 50]]);
  const kept = mergeNearCenters(tint.centers, tint.lab, tint.core);
  assert.equal(kept.length, 3);
});

test("JPEG palette cleanup drops a small ringing centre between two inks", () => {
  // Cream halfway between an orange star and the white backdrop, with few pixels: compression overshoot.
  const ring = centresWithPixels([[255, 255, 255, 2000], [244, 144, 12, 1000], [250, 200, 134, 40]]);
  const kept = mergeNearCenters(ring.centers, ring.lab, ring.core);
  assert.equal(kept.length, 2);
});

test("JPEG cleanup is chosen once per source and never for clean or small rasters", () => {
  const flat = (size: number) => new Uint8Array(size * size * 4).fill(255);
  assert.equal(lossyCleanup(flat(128), 128, 128), undefined);
  const noisy = flat(64);
  for (let at = 0; at < noisy.length; at += 4) noisy[at] = 250 + ((at / 4) % 7);
  assert.equal(lossyCleanup(noisy, 64, 64), undefined, "64 px sources trace as before");
  // A tall 86x128 logo is judged by its long side (gl-figma-128-q60).
  const tall = new Uint8Array(86 * 128 * 4).fill(255);
  for (let at = 0; at < tall.length; at += 4) tall.fill(220 + (((at / 4) * 7919) % 29), at, at + 3);
  assert.notEqual(lossyCleanup(tall, 86, 128), undefined);
});

test("a lossy edge splits a half-covered pixel at its sRGB midpoint, not the OKLab one", () => {
  // Blue on white with one column at 50% coverage, mixed in sRGB as a JPEG encoder and a rasteriser mix it. The edge
  // belongs in the middle of that column (16.5 px). A preprocess that returns new pixels marks the raster as lossy.
  const blue = [26, 188, 254] as const;
  const image = fill(32, 16, 255, 255, 255, 255);
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) setPixel(image, 32, x, y, blue[0], blue[1], blue[2], 255);
    setPixel(image, 32, 16, y, Math.round((blue[0] + 255) / 2), Math.round((blue[1] + 255) / 2), 255, 255);
  }
  const blueRun = (painted: { rgba: Uint8Array; width: number }) => {
    const row = 8 * 8 + 4;
    let count = 0;
    for (let x = 0; x < painted.width; x += 1) if ((painted.rgba[(row * painted.width + x) * 4] ?? 255) < 140) count += 1;
    return count / 8;
  };
  const lossy = blueRun(labelImage(image.rgba, 32, 16, 2, (rgba) => rgba.slice()));
  assert.ok(Math.abs(lossy - 16.5) < 1 / 16, `lossy edge at ${lossy}`);
  // A clean raster is mixed the same way by its rasteriser, so it splits there too (the old linear/OKLab rule gave
  // blue 5/8 of the column).
  const clean = blueRun(labelImage(image.rgba, 32, 16, 2));
  assert.ok(Math.abs(clean - 16.5) < 1 / 16, `clean edge at ${clean}`);
});

test("a clean anti-aliased disc keeps its area on the plate", () => {
  // A disc rendered the way resvg renders it: coverage from 16x16 supersampling, mixed in sRGB. Without label smoothing
  // the plate follows the 50 % isoline; the majority vote pulled a boundary toward its centre of curvature.
  const size = 40, radius = 9.5, centre = 20.25;
  const image = fill(size, size, 255, 255, 255, 255);
  const ink = [220, 40, 60] as const;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    let inside = 0;
    for (let sy = 0; sy < 16; sy += 1) for (let sx = 0; sx < 16; sx += 1) {
      if (Math.hypot(x + (sx + 0.5) / 16 - centre, y + (sy + 0.5) / 16 - centre) <= radius) inside += 1;
    }
    const t = inside / 256;
    setPixel(image, size, x, y, Math.round(255 + (ink[0] - 255) * t), Math.round(255 + (ink[1] - 255) * t), Math.round(255 + (ink[2] - 255) * t), 255);
  }
  const painted = labelImage(image.rgba, size, size, 2);
  let cells = 0;
  for (let at = 0; at < painted.rgba.length; at += 4) if ((painted.rgba[at + 1] ?? 255) < 150) cells += 1;
  const area = cells / 64;
  const expected = Math.PI * radius * radius;
  assert.ok(Math.abs(area - expected) / expected < 0.01, `plate area ${area.toFixed(2)} vs ${expected.toFixed(2)}`);
});
