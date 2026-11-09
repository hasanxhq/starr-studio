"""Draw the overlay engine's rating logos (starr_studio/overlay_engine/logos/*.png).

Simple stand-ins drawn here, not the brands' own artwork. Run from the repo root:
    uv run python scripts/make_overlay_logos.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path("starr_studio/overlay_engine/logos")
FONTS = Path("starr_studio/overlay_engine/fonts")
H = 128  # logos are 128 px tall; the engine scales them to the style's height
S = 4  # drawn 4x and scaled down, for smooth edges


def canvas(width):
    return Image.new("RGBA", (width * S, H * S), (0, 0, 0, 0))


def save(img, name):
    img.resize((img.width // S, H), Image.LANCZOS).save(OUT / f"{name}.png", optimize=True)


def chip(name, label, bg, fg):
    font = ImageFont.truetype(str(FONTS / "Inter-Black.ttf"), int(H * 0.56 * S))
    left, top, right, bottom = font.getbbox(label)
    width = (right - left) // S + H // 2
    img = canvas(width)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, img.width - 1, img.height - 1), int(H * 0.18 * S), fill=bg)
    d.text((img.width / 2, img.height / 2), label, font=font, fill=fg, anchor="mm")
    save(img, name)


def tomato():
    img = canvas(H)
    d = ImageDraw.Draw(img)
    r = H * S // 2
    d.ellipse((6 * S, 14 * S, H * S - 6 * S, H * S - 2 * S), fill=(250, 50, 10))
    cx = r
    d.polygon([(cx - 26 * S, 22 * S), (cx, 2 * S), (cx + 26 * S, 22 * S), (cx, 32 * S)], fill=(40, 160, 60))
    save(img, "rt_fresh")


def splat():
    img = canvas(H)
    d = ImageDraw.Draw(img)
    green = (10, 200, 85)
    d.ellipse((22 * S, 26 * S, 106 * S, 110 * S), fill=green)
    for x, y, r in ((24, 30, 16), (100, 34, 14), (20, 96, 14), (104, 98, 16), (64, 14, 12), (64, 116, 10)):
        d.ellipse(((x - r) * S, (y - r) * S, (x + r) * S, (y + r) * S), fill=green)
    save(img, "rt_rotten")


def bucket(name, spilled):
    img = canvas(H)
    d = ImageDraw.Draw(img)
    body = [(30, 44), (98, 44), (88, 122), (40, 122)]
    for i in range(4):  # red and white stripes
        x0 = 30 + i * 17
        stripe = [(x0, 44), (x0 + 17, 44), (x0 + 17 - 2.5, 122), (x0 - 2.5 + (i == 0) * 12.5, 122)]
        d.polygon([(x * S, y * S) for x, y in stripe], fill=(235, 40, 30) if i % 2 == 0 else (255, 255, 255))
    d.polygon([(x * S, y * S) for x, y in body], outline=(235, 40, 30), width=3 * S)
    popcorn = (250, 215, 90) if not spilled else (130, 200, 90)
    for x, y, r in ((40, 38, 14), (58, 30, 16), (78, 32, 15), (92, 40, 12), (64, 44, 12)):
        d.ellipse(((x - r) * S, (y - r) * S, (x + r) * S, (y + r) * S), fill=popcorn)
    if spilled:
        img = img.rotate(-28, resample=Image.BICUBIC, center=(H * S / 2, H * S / 2))
    save(img, name)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    chip("imdb", "IMDb", (245, 197, 24), (0, 0, 0))
    chip("tmdb", "TMDB", (13, 37, 63), (1, 180, 228))
    tomato()
    splat()
    bucket("rt_audience_upright", spilled=False)
    bucket("rt_audience_spilled", spilled=True)
    print(sorted(p.name for p in OUT.glob("*.png")))
