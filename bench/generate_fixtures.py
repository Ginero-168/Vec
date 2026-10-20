#!/usr/bin/env python3
"""Build bench fixtures: the supplied photo balloon and a flat-color balloon."""

import shutil
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
FIXTURES = ROOT / "fixtures"
PHOTO = FIXTURES / "balloon-photo.png"
FLAT = FIXTURES / "balloon-flat.png"
SOURCE = Path("/home/ubuntu/.cursor/projects/workspace/uploads/balloon_f867.png")


def draw_flat() -> None:
    scale = 4
    width, height = 2000, 2500
    canvas = Image.new("RGBA", (width * scale, height * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    def s(v: float) -> int:
        return int(round(v * scale))

    sky = (142, 202, 230, 255)
    draw.rectangle((0, 0, width * scale, height * scale), fill=sky)
    # Sun: a true circle so ellipse fitting has a primitive to recover.
    draw.ellipse((s(120), s(140), s(460), s(480)), fill=(255, 209, 102, 255))
    # Balloon envelope, flat stripes, uniform dark outline.
    outline = (29, 26, 22, 255)
    draw.ellipse((s(620), s(220), s(1500), s(1480)), fill=outline)
    draw.ellipse((s(648), s(248), s(1472), s(1452)), fill=(232, 93, 4, 255))
    draw.polygon([(s(900), s(300)), (s(1120), s(300)), (s(1180), s(1400)), (s(840), s(1400))], fill=(244, 162, 97, 255))
    draw.polygon([(s(1120), s(300)), (s(1280), s(340)), (s(1320), s(1360)), (s(1180), s(1400))], fill=(220, 47, 2, 255))
    draw.ellipse((s(760), s(420), s(1040), s(700)), fill=(255, 183, 3, 255))
    # Basket and ropes.
    rope = (29, 26, 22, 255)
    draw.line((s(820), s(1420), s(900), s(1760)), fill=rope, width=s(10))
    draw.line((s(1300), s(1420), s(1220), s(1760)), fill=rope, width=s(10))
    draw.line((s(980), s(1460), s(980), s(1760)), fill=rope, width=s(8))
    draw.rounded_rectangle((s(860), s(1740), s(1260), s(1980)), radius=s(28), fill=(111, 78, 55, 255))
    draw.rounded_rectangle((s(900), s(1780), s(1220), s(1860)), radius=s(12), fill=(232, 201, 160, 255))
    # Ring medallion: a flat circle with a hole of the sky color.
    draw.ellipse((s(1540), s(1680), s(1860), s(2000)), fill=outline)
    draw.ellipse((s(1620), s(1760), s(1780), s(1920)), fill=sky)
    image = canvas.resize((width, height), Image.Resampling.BOX)
    image.save(FLAT, "PNG")


def main() -> None:
    FIXTURES.mkdir(parents=True, exist_ok=True)
    if not PHOTO.exists():
        if not SOURCE.exists():
            raise SystemExit("missing photo fixture and upload source")
        shutil.copyfile(SOURCE, PHOTO)
    draw_flat()
    photo = Image.open(PHOTO)
    flat = Image.open(FLAT)
    print(f"photo {photo.size} {photo.mode} {PHOTO.stat().st_size} bytes")
    print(f"flat {flat.size} {flat.mode} {FLAT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
