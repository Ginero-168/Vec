import os
import sys
from PIL import Image, ImageDraw

out = sys.argv[1]
names = ["logo-flat", "cartoon-line", "anime-ink", "photo-scene", "pixel-icon", "jpeg-on", "screen-ui"]
labels = ["Flat logo", "Line-art cartoon", "Anime ink", "Photo scene", "Pixel icon", "JPEG, filter on", "Screenshot ui"]
cell_w, cell_h, label_h = 320, 160, 22
sheet = Image.new("RGB", (cell_w * 2 + 16, (cell_h + label_h) * len(names) + 8), (24, 24, 28))
draw = ImageDraw.Draw(sheet)
root = os.path.join(out, "bench")
for index, (name, label) in enumerate(zip(names, labels)):
    y = 6 + index * (cell_h + label_h)
    draw.text((8, y), label + "   source", fill=(230, 226, 220))
    draw.text((cell_w + 14, y), label + "   vec", fill=(230, 226, 220))
    for col, suffix in ((0, "-src.png"), (1, ".png")):
        image = Image.open(os.path.join(root, name + suffix)).convert("RGB")
        image.thumbnail((cell_w - 10, cell_h - 6))
        sheet.paste(image, (6 + col * (cell_w + 8), y + label_h))
path = os.path.join(out, "contact-sheet.png")
sheet.save(path)
print("contact", sheet.size, path)
