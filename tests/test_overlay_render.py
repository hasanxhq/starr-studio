"""The overlay engine's renderer (starr_studio/overlay_engine/render.py).

Golden images live in tests/fixtures/overlay_render/. After a deliberate change to how things are drawn, look at the
new images and refresh them with:  UPDATE_GOLDEN=1 .venv/bin/python -m pytest tests/test_overlay_render.py
"""

import os
from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image, ImageChops, ImageDraw, ImageStat

from starr_studio.overlay_engine.render import _face, check_svg_fragment, natural_size, place, render_poster, scene_svg
from starr_studio.overlay_engine.style import Box, load_style

GOLDEN = Path(__file__).parent / "fixtures" / "overlay_render"

# Modern streaming as rules.resolve gives it for Poor Things (4K, Dolby Vision, DD+ Atmos 5.1, IMDb 7.7, RT 92%),
# with the NEW tag shown, so every part of the style is drawn.
MODERN_POOR_THINGS = """
studio_style: 1
name: Modern streaming, resolved
elements:
  - { id: band, type: rect, box: { left: 0, right: 0, bottom: 0, height: 260 }, fill: { colour: "#000000", opacity: 0.65 } }
  - id: scores
    type: row
    box: { left: 48, bottom: 142 }
    gap: 36
    children:
      - type: row
        gap: 12
        children:
          - { type: logo, image: imdb, height: 64 }
          - { type: text, text: "7.7", size: 54 }
      - type: row
        gap: 12
        children:
          - { type: logo, image: rt_fresh, height: 64 }
          - { type: text, text: "92%", size: 54 }
  - id: quality
    type: row
    box: { left: 48, bottom: 44 }
    gap: 22
    children:
      - { type: text, text: 4K, size: 42, background: { stroke: { colour: "#FFFFFF", width: 3 }, radius: 8, padding: 13 } }
      - { type: text, text: DOLBY VISION, size: 42, colour: "#E1E1E1" }
      - { type: text, text: DD+ ATMOS 5.1, size: 42, colour: "#E1E1E1" }
  - { id: new, type: text, text: NEW, font: Inter ExtraBold, size: 40, box: { left: 40, top: 40 }, background: { fill: { colour: "#E50914" }, radius: 14, padding: [16, 40] } }
"""

# What Modern streaming doesn't use: gradient, shadow, frosted glass, column, group, raw svg, centre and % anchors.
EFFECTS = """
studio_style: 1
name: Effects
elements:
  - type: rect
    box: { left: 0, right: 0, bottom: 0, height: 45% }
    fill: { gradient: { direction: down, stops: [ { at: 0, colour: "#000000", opacity: 0 }, { at: 1, colour: "#000000", opacity: 0.9 } ] } }
  - type: text
    text: DTS:X 7.1
    size: 44
    box: { left: 60, top: 150 }
    blur_behind: { radius: 12 }
    background: { stroke: { colour: "#FFFFFF", width: 2, opacity: 0.3 }, radius: 48, padding: [26, 36] }
  - type: column
    box: { centre_x: 0, centre_y: 0 }
    gap: 16
    align: centre
    shadow: { dy: 4, blur: 6, opacity: 0.6 }
    children:
      - { type: text, text: Glyphs, size: 90, font: Inter Black, letter_spacing: 4 }
      - { type: logo, image: tmdb, height: 50 }
  - type: group
    box: { left: 40, bottom: 40, width: 300, height: 120 }
    opacity: 0.8
    children:
      - { type: rect, box: { left: 0, right: 0, top: 0, bottom: 0 }, fill: { colour: "#1D4ED8CC" }, radius: 20 }
      - { type: svg, svg: '<circle cx="50" cy="50" r="40" fill="#FACC15"/>', width: 100, height: 100, box: { left: 10, centre_y: 0 } }
      - { type: text, text: Group, size: 40, box: { right: 24, centre_y: 0 } }
"""


def poster() -> bytes:
    """A stand-in poster with detail for frosted glass to blur (real posters are the user's, not for the repo)."""
    image = Image.new("RGB", (600, 900))
    draw = ImageDraw.Draw(image)
    for y in range(900):
        draw.line([(0, y), (600, y)], fill=(40 + y // 6, 60, 160 - y // 8))
    for i in range(12):
        draw.ellipse((i * 50, 30 + i * 70, i * 50 + 120, 150 + i * 70), fill=(250 - i * 15, 120 + i * 10, 40))
    buf = BytesIO()
    image.save(buf, "JPEG", quality=95)
    return buf.getvalue()


@pytest.mark.parametrize(("name", "style"), [("modern-poor-things", MODERN_POOR_THINGS), ("effects", EFFECTS)])
def test_golden_images(name, style):
    jpeg = render_poster(load_style(style).elements, poster())
    got = Image.open(BytesIO(jpeg))
    assert got.size == (1000, 1500)
    golden = GOLDEN / f"{name}.png"
    if os.environ.get("UPDATE_GOLDEN"):
        golden.parent.mkdir(parents=True, exist_ok=True)
        got.save(golden)
    r, g, b = ImageChops.difference(got.convert("RGB"), Image.open(golden).convert("RGB")).split()
    diff = ImageChops.lighter(r, ImageChops.lighter(g, b))  # each pixel's largest channel difference
    mean, off = ImageStat.Stat(diff).mean[0], sum(diff.histogram()[41:]) / (1000 * 1500)
    # resvg and libjpeg builds differ slightly between machines: allow anti-aliasing noise, not a moved or missing shape
    assert mean < 1 and off < 0.002, f"{name}: mean {mean:.2f}, {off:.4%} pixels off"


def test_text_box_is_shaped_width_by_cap_height():
    face = _face("Inter Bold")
    text = load_style('studio_style: 1\nname: t\nelements:\n  - { type: text, text: "AV 7.7", size: 50, box: { left: 0, top: 0 } }').elements[0]
    width, height = natural_size(text)
    assert height == pytest.approx(face.cap * 50 / face.upem)
    assert width == pytest.approx(face.width("AV 7.7", 50, 0)) and width < face.width("A", 50, 0) + face.width("V 7.7", 50, 0)  # kerned


def test_rows_and_padding_add_up():
    style = load_style(MODERN_POOR_THINGS)
    quality = next(e for e in style.elements if e.id == "quality")
    sizes = [natural_size(c) for c in quality.children]
    four_k = natural_size(load_style('studio_style: 1\nname: t\nelements:\n  - { type: text, text: 4K, size: 42, box: { left: 0, top: 0 } }').elements[0])
    assert sizes[0] == pytest.approx((four_k[0] + 26, four_k[1] + 26))
    assert natural_size(quality) == pytest.approx((sum(s[0] for s in sizes) + 2 * 22, max(s[1] for s in sizes)))


@pytest.mark.parametrize(
    ("box", "expected"),
    [
        (dict(left=10, top=20), (110, 220, 50, 30)),
        (dict(right=10, bottom=20), (540, 450, 50, 30)),
        (dict(left=10, right=10, top=0), (110, 200, 480, 30)),
        (dict(centre_x=0, centre_y=-10), (325, 325, 50, 30)),
        (dict(left="10%", top="10%", width="5%"), (200, 350, 50, 30)),  # % of the poster, not the parent
    ],
)
def test_place(box, expected):
    assert place(Box(**box), (50, 30), (100, 200, 500, 300)) == pytest.approx(expected)


def test_svg_fragment_allow_list():
    assert "circle" in check_svg_fragment('<circle cx="5" cy="5" r="4" fill="url(#g)"/>')
    for bad in ("<script>alert(1)</script>", '<image href="http://x/y.png"/>', '<rect onclick="x()"/>', '<rect fill="url(http://x)"/>', '<g style="fill:red"/>', "<rect"):
        with pytest.raises(ValueError):
            check_svg_fragment(bad)


def test_browser_scene_has_the_poster_and_frost():
    svg = scene_svg(load_style(EFFECTS).elements, poster_href="/poster.jpg")
    assert svg.count('href="/poster.jpg"') == 2  # the background and the frosted glass
    assert "<text" not in svg  # text is outlines, so the browser draws the same shapes as resvg
    assert 'href="/poster.jpg"' not in scene_svg(load_style(EFFECTS).elements)
