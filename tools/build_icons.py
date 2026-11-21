"""Generate the app icons (favicon, PWA, apple-touch, social preview image)
from docs/branding/logo-source.png (rounded square icon on a white background).

    .venv/bin/python tools/build_icons.py
Requires pillow, numpy, scipy (build-time tool only, not in requirements.txt).
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs/branding/logo-source.png"
OUT = ROOT / "frontend/public/icons"
PUB = ROOT / "frontend/public"

im = Image.open(SRC).convert("RGBA")
arr = np.asarray(im).astype(int)
# background = white/near-white; the rounded square is everything connected and non-white
nonwhite = (arr[..., :3].min(axis=2) < 235) & (arr[..., 3] > 10)
labels, _ = ndimage.label(nonwhite)
big = np.bincount(labels.ravel())[1:].argmax() + 1
mask = ndimage.binary_fill_holes(labels == big)
ys, xs = np.where(mask)
x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
side = max(x1 - x0, y1 - y0)
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
box = (cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side)

alpha = Image.fromarray((mask * 255).astype("uint8")).filter(__import__("PIL.ImageFilter", fromlist=["x"]).GaussianBlur(1.2))
rgba = im.copy()
rgba.putalpha(alpha)
squircle = rgba.crop(box)  # rounded icon, transparent background
navy = tuple(int(v) for v in arr[cy, x0 + 12][:3])  # background colour on the left edge

def save(img, name, size):
    img.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)

# "any" icons (transparent rounded corners, fill the frame)
for n, s in (("icon-192.png", 192), ("icon-512.png", 512)):
    save(squircle, n, s)
# apple-touch: iOS rounds the corners itself, so it needs a full square without transparency
full = Image.new("RGB", squircle.size, navy)
full.paste(squircle, mask=squircle.split()[3])
save(full, "icon-180.png", 180)
# maskable: full navy frame, logo inside the safe zone, faded edges (no visible border)
m = Image.new("RGB", (1024, 1024), navy)
k = int(side * 0.05)
core = full.crop((k, k, side - k, side - k)).resize((660, 660), Image.LANCZOS)
fade = Image.new("L", (660, 660), 0)
ImageDraw.Draw(fade).rectangle((42, 42, 617, 617), fill=255)
fade = fade.filter(__import__("PIL.ImageFilter", fromlist=["x"]).GaussianBlur(24))
m.paste(core, (182, 182), fade)
m.resize((512, 512), Image.LANCZOS).save(OUT / "icon-maskable-512.png", optimize=True)

# favicon: the emblem (house + walker) alone, readable at 16-32 px
w = side
e = full.crop((int(w * 0.07), int(w * 0.02), int(w * 0.93), int(w * 0.80)))
em = Image.new("RGB", (max(e.size),) * 2, navy)
em.paste(e, ((em.width - e.width) // 2, (em.height - e.height) // 2))
r = Image.new("L", (512, 512), 0)
ImageDraw.Draw(r).rounded_rectangle((0, 0, 511, 511), radius=112, fill=255)
fav = em.resize((512, 512), Image.LANCZOS).convert("RGBA")
fav.putalpha(r)
fav.resize((32, 32), Image.LANCZOS).save(OUT / "favicon-32.png", optimize=True)
fav.save(PUB / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

# social preview image 1200x630
og = Image.new("RGB", (1200, 630), navy)
h = 560
og.paste(squircle.resize((h, h), Image.LANCZOS), ((1200 - h) // 2, 35), squircle.resize((h, h), Image.LANCZOS).split()[3])
og.save(OUT / "og-image.png", optimize=True)
print("navy", navy, "ok")
