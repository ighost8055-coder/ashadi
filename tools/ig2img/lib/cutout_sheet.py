"""Ashadi: cut real Kapruka product photos out of their grounds and lay them on ONE product sheet.

usage:  python -I lib/cutout_sheet.py <out_dir> <image1> [image2 ...]
writes: <out_dir>/cut-1.png ... and <out_dir>/product-sheet.png   (prints one JSON line with the paths)

Same method as the canva_fbt route (rembg isnet-general-use, drop the burned-in Kapruka tag, trim to the
product), so the image engine receives the products exactly as they look on the shop page.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

out = Path(sys.argv[1])
srcs = sys.argv[2:]
out.mkdir(parents=True, exist_ok=True)

cuts = []
try:
    from rembg import new_session, remove
    sess = new_session("isnet-general-use")
except Exception as e:            # rembg missing: fall back to the plain photo (still a real product picture)
    sess = None
    print(json.dumps({"warn": f"rembg unavailable ({e}); using the uncut photos"}), file=sys.stderr)

for i, s in enumerate(srcs, 1):
    im = Image.open(s).convert("RGB")
    if sess is None:
        res = im.convert("RGBA")
    else:
        cut = remove(im, session=sess).convert("RGBA")
        a = np.array(cut)[:, :, 3]
        lab, n = ndi.label(a > 40)
        if n:
            areas = ndi.sum(np.ones_like(a), lab, range(1, n + 1))
            keep = [k + 1 for k, ar in enumerate(areas) if ar >= 0.2 * max(areas)]
            mask = np.isin(lab, keep)
            mask = ndi.binary_fill_holes(mask) | ((a > 40) & ndi.binary_dilation(mask, iterations=3))
            arr = np.array(cut)
            arr[:, :, 3] = np.where(mask, arr[:, :, 3], 0)
            # the burned-in Kapruka tag (purple chip bottom-left of the shop photo)
            rgb = np.array(im).astype(int)
            H, W = rgb.shape[:2]
            reg = np.zeros((H, W), bool)
            reg[int(H * 0.90):, : int(W * 0.22)] = True
            tag = reg & (np.abs(rgb - np.array([75, 35, 134])).sum(axis=2) < 110)
            if tag.sum() > 300:
                tag = ndi.binary_fill_holes(ndi.binary_dilation(tag, iterations=4)) & reg
                arr[:, :, 3] = np.where(tag, 0, arr[:, :, 3])
            res = Image.fromarray(arr, "RGBA")
        else:
            res = cut
        bb = res.getbbox()
        if bb:
            res = res.crop(bb)
    p = out / f"cut-{i}.png"
    res.save(p)
    cuts.append(p)

# the sheet: neutral light ground, products side by side, equal height, generous gaps
TARGET_H, GAP, PAD = 720, 60, 60
tiles = []
for p in cuts:
    t = Image.open(p).convert("RGBA")
    w = max(1, int(t.width * (TARGET_H / t.height)))
    tiles.append(t.resize((w, TARGET_H), Image.LANCZOS))
total = sum(t.width for t in tiles) + GAP * (len(tiles) - 1) + 2 * PAD
sheet = Image.new("RGB", (max(total, 400), TARGET_H + 2 * PAD), (238, 238, 238))
x = PAD
for t in tiles:
    sheet.paste(t, (x, PAD), t)
    x += t.width + GAP
if sheet.width > 2400:
    sheet = sheet.resize((2400, int(sheet.height * 2400 / sheet.width)), Image.LANCZOS)
sp = out / "product-sheet.png"
sheet.save(sp)
print(json.dumps({"sheet": str(sp), "cuts": [str(c) for c in cuts]}))
