import * as fs from "fs";
import { spawnSync } from "child_process";
import { encodePng } from "./color/png";

const FONT: Record<string, string[]> = {
  V: ["10001", "10001", "10001", "10001", "01010", "01010", "00100"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"]
};

function image(width: number, height: number, paint: (x: number, y: number, set: (r: number, g: number, b: number) => void) => void): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      rgba[offset + 3] = 255;
      paint(x, y, (r, g, b) => {
        rgba[offset] = r;
        rgba[offset + 1] = g;
        rgba[offset + 2] = b;
      });
    }
  }
  return rgba;
}

function fill(rgba: Uint8Array, width: number, x0: number, y0: number, w: number, h: number, r: number, g: number, b: number): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const offset = (y * width + x) * 4;
      rgba[offset] = r;
      rgba[offset + 1] = g;
      rgba[offset + 2] = b;
      rgba[offset + 3] = 255;
    }
  }
}

function disc(rgba: Uint8Array, width: number, height: number, cx: number, cy: number, radius: number, r: number, g: number, b: number): void {
  for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(height - 1, Math.ceil(cy + radius)); y++) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(width - 1, Math.ceil(cx + radius)); x++) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > radius * radius) continue;
      const offset = (y * width + x) * 4;
      rgba[offset] = r;
      rgba[offset + 1] = g;
      rgba[offset + 2] = b;
      rgba[offset + 3] = 255;
    }
  }
}

function text(rgba: Uint8Array, width: number, originX: number, originY: number, letters: string, scale: number): void {
  let cursor = originX;
  for (const letter of letters) {
    const rows = FONT[letter];
    if (!rows) continue;
    rows.forEach((row, rowIndex) => {
      for (let col = 0; col < row.length; col++) {
        if (row[col] !== "1") continue;
        fill(rgba, width, cursor + col * scale, originY + rowIndex * scale, scale, scale, 26, 26, 26);
      }
    });
    cursor += 6 * scale;
  }
}

function write(name: string, width: number, height: number, rgba: Uint8Array): void {
  fs.writeFileSync("fixtures/" + name, encodePng(width, height, rgba));
}

const logoW = 320;
const logoH = 180;
const logo = image(logoW, logoH, (_x, _y, set) => set(244, 239, 230));
disc(logo, logoW, logoH, 78, 90, 52, 31, 75, 58);
fill(logo, logoW, 150, 48, 140, 84, 228, 87, 46);
text(logo, logoW, 168, 70, "VEC", 6);
write("logo-flat.png", logoW, logoH, logo);

const cartW = 280;
const cartH = 200;
const cartoon = image(cartW, cartH, (x, y, set) => {
  if (y > 130) set(144, 190, 109);
  else set(142, 202, 230);
});
disc(cartoon, cartW, cartH, 150, 108, 48, 246, 215, 176);
disc(cartoon, cartW, cartH, 150, 108, 48, 20, 20, 20);
disc(cartoon, cartW, cartH, 150, 108, 44, 246, 215, 176);
disc(cartoon, cartW, cartH, 134, 100, 6, 20, 20, 20);
disc(cartoon, cartW, cartH, 166, 100, 6, 20, 20, 20);
for (let x = 128; x <= 172; x++) {
  const y = 124 + Math.round(Math.sin(((x - 128) / 44) * Math.PI) * 8);
  fill(cartoon, cartW, x, y, 2, 2, 20, 20, 20);
}
fill(cartoon, cartW, 40, 40, 36, 28, 255, 214, 90);
write("cartoon-line.png", cartW, cartH, cartoon);

const inkW = 200;
const inkH = 280;
const ink = image(inkW, inkH, (_x, _y, set) => set(250, 248, 244));
disc(ink, inkW, inkH, 100, 70, 62, 18, 18, 18);
disc(ink, inkW, inkH, 100, 108, 46, 250, 248, 244);
disc(ink, inkW, inkH, 100, 108, 46, 18, 18, 18);
disc(ink, inkW, inkH, 100, 112, 42, 250, 248, 244);
disc(ink, inkW, inkH, 84, 108, 8, 18, 18, 18);
disc(ink, inkW, inkH, 116, 108, 8, 18, 18, 18);
disc(ink, inkW, inkH, 84, 108, 3, 250, 248, 244);
disc(ink, inkW, inkH, 116, 108, 3, 250, 248, 244);
fill(ink, inkW, 70, 168, 60, 90, 18, 18, 18);
fill(ink, inkW, 78, 176, 44, 74, 250, 248, 244);
write("anime-ink.png", inkW, inkH, ink);

const photoW = 360;
const photoH = 220;
const photo = image(photoW, photoH, (x, y, set) => {
  const sky = y / 150;
  const sun = Math.max(0, 1 - Math.hypot(x - 260, y - 70) / 54);
  let r = 126 + sky * 120;
  let g = 182 + sky * 28;
  let b = 232 - sky * 70;
  r = r * (1 - sun) + 255 * sun;
  g = g * (1 - sun) + 236 * sun;
  b = b * (1 - sun) + 186 * sun;
  if (y > 150) {
    const hill = (y - 150) / 70;
    r = 61 - hill * 20;
    g = 107 - hill * 30;
    b = 79 - hill * 20;
  }
  const grain = ((x * 13 + y * 7) % 5) - 2;
  set(Math.max(0, Math.min(255, Math.round(r + grain))), Math.max(0, Math.min(255, Math.round(g + grain))), Math.max(0, Math.min(255, Math.round(b + grain))));
});
write("photo-scene.png", photoW, photoH, photo);

const icon = [
  "................",
  "......1111......",
  "..1122112211....",
  ".122332233221...",
  ".123333333321...",
  ".123333333321...",
  "..12333333321...",
  "...123333321....",
  "....1233321.....",
  ".....12321......",
  "......121.......",
  "......121.......",
  ".....12221......",
  "....1222221.....",
  "................",
  "................"
];
const palette: Record<string, [number, number, number]> = {
  ".": [238, 232, 214],
  "1": [42, 36, 32],
  "2": [196, 92, 58],
  "3": [242, 196, 92]
};
const scale = 8;
const pixel = new Uint8Array(16 * scale * 16 * scale * 4);
for (let y = 0; y < 16; y++) {
  const row = icon[y] ?? "";
  for (let x = 0; x < 16; x++) {
    const color = palette[row[x] ?? "."] ?? palette["."] ?? [0, 0, 0];
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        const offset = ((y * scale + dy) * 16 * scale + x * scale + dx) * 4;
        pixel[offset] = color[0];
        pixel[offset + 1] = color[1];
        pixel[offset + 2] = color[2];
        pixel[offset + 3] = 255;
      }
    }
  }
}
write("pixel-icon.png", 128, 128, pixel);

const jpegW = 160;
const jpegH = 120;
const jpegSrc = image(jpegW, jpegH, (x, y, set) => {
  const t = x / (jpegW - 1);
  let r = 40 + t * 180;
  let g = 70 + (1 - t) * 40;
  let b = 160 - t * 80;
  if (x > 78 && x < 118 && y > 28 && y < 88) {
    r = 230;
    g = 230;
    b = 230;
  }
  if (y > 88) {
    r = 40;
    g = 90;
    b = 50;
  }
  set(Math.round(r), Math.round(g), Math.round(b));
});
write("jpeg-source.png", jpegW, jpegH, jpegSrc);
const encoded = spawnSync("python3", ["-c", "from PIL import Image\nimage = Image.open('fixtures/jpeg-source.png').convert('RGB')\nimage.save('fixtures/jpeg-blocks.jpg', quality=12, subsampling=2)\nImage.open('fixtures/jpeg-blocks.jpg').convert('RGBA').save('fixtures/jpeg-blocks.png')"], { encoding: "utf8" });
if (encoded.status !== 0) throw new Error(encoded.stderr || "jpeg encode failed");
fs.unlinkSync("fixtures/jpeg-source.png");
process.stdout.write("fixtures ready\n");
