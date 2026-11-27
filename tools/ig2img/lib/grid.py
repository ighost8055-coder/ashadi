"""grid.py - draw a measuring grid over a reference image so the reverse-engineer agent
reads element positions off a ruler instead of eyeballing them.

  python grid.py <in-image> <out-png>

Thin lines every 5%, stronger lines + labels every 10% (0-100, top/left origin), in a
colour that stays visible on both light and dark areas. Prints the image's pixel size
as JSON on stdout: {"w": 1080, "h": 1350}.
"""
import json
import sys

from PIL import Image, ImageDraw, ImageFont


def main(src: str, dst: str) -> None:
    im = Image.open(src).convert("RGB")
    w, h = im.size
    # Work at a readable size: long edge ~1600 px.
    scale = 1600 / max(w, h)
    big = im.resize((round(w * scale), round(h * scale)), Image.LANCZOS) if scale > 1.05 or scale < 0.95 else im.copy()
    W, H = big.size
    over = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    try:
        font = ImageFont.truetype("arial.ttf", max(12, W // 75))
    except OSError:
        font = ImageFont.load_default()

    for pct in range(0, 101, 5):
        major = pct % 10 == 0
        col = (255, 0, 160, 210) if major else (0, 220, 255, 120)
        width = 2 if major else 1
        x = round(pct / 100 * (W - 1))
        y = round(pct / 100 * (H - 1))
        d.line([(x, 0), (x, H)], fill=col, width=width)
        d.line([(0, y), (W, y)], fill=col, width=width)
        if major and 0 < pct < 100:
            for (tx, ty) in ((x + 3, 3), (3, y + 2)):
                label = str(pct)
                bb = d.textbbox((tx, ty), label, font=font)
                d.rectangle([bb[0] - 2, bb[1] - 1, bb[2] + 2, bb[3] + 1], fill=(0, 0, 0, 170))
                d.text((tx, ty), label, fill=(255, 255, 255, 255), font=font)

    Image.alpha_composite(big.convert("RGBA"), over).convert("RGB").save(dst, "PNG")
    print(json.dumps({"w": w, "h": h}))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
