"""Phase 0 spike (docs/plans/overlay-engine.md): Modern streaming C as SVG, rendered by resvg.

Throwaway code: it answers whether one SVG can be drawn the same by the browser and by resvg, and how fast.
Writes nothing to Plex. Run with:
    uv run --no-project --with resvg-py --with uharfbuzz --with fonttools --with pillow --with numpy \
        python -I scripts/spike_overlay/build.py <out dir> <kometa fonts dir> <originals dir>

Two text modes:
  text  - SVG <text>, laid out by each renderer
  paths - text shaped here with HarfBuzz and written as glyph outlines, so both renderers draw the same shapes
"""

import json
import shutil
import sys
import time
from html import escape
from io import BytesIO
from pathlib import Path

import resvg_py
import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image

OUT, FONT_DIR, ORIGINALS = (Path(a) for a in sys.argv[1:4])
W, H = 1000, 1500

ITEMS = [
    dict(key="4635", title="Poor Things", res="4K", hdr="DOLBY VISION", audio="DD+ 5.1", imdb="7.7", rt="92", added_days=400),
    dict(key="4331", title="Oldboy", res="4K", hdr="HDR10", audio="DD+ 7.1", imdb="8.3", rt="82", added_days=3),
    dict(key="8586", title="Moonlight", res="1080P", hdr=None, audio="AAC 5.1", imdb="7.4", rt="98", added_days=9),
]

FONTS = {700: "Inter-Bold", 800: "Inter-ExtraBold", 900: "Inter-Black"}


class Face:
    def __init__(self, name):
        self.file = FONT_DIR / f"{name}.ttf"
        data = self.file.read_bytes()
        self.hb_font = hb.Font(hb.Face(data))
        self.tt = TTFont(BytesIO(data))
        self.upem = self.tt["head"].unitsPerEm
        self.cap = self.tt["OS/2"].sCapHeight
        self.glyphs = self.tt.getGlyphSet()
        self.order = self.tt.getGlyphOrder()

    def shape(self, text):
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(self.hb_font, buf, {"kern": True, "liga": True})
        return buf.glyph_infos, buf.glyph_positions

    def width(self, text, size):
        _, pos = self.shape(text)
        return sum(p.x_advance for p in pos) * size / self.upem

    def path(self, text, size, x, baseline):
        infos, pos = self.shape(text)
        scale = size / self.upem
        pen = SVGPathPen(self.glyphs)
        cursor = 0
        for info, p in zip(infos, pos):
            name = self.order[info.codepoint]
            gx, gy = x + (cursor + p.x_offset) * scale, baseline - p.y_offset * scale
            self.glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, gx, gy)))
            cursor += p.x_advance
        return pen.getCommands()


FACES = {w: Face(n) for w, n in FONTS.items()}


class Svg:
    def __init__(self, mode, poster):
        self.mode, self.parts, self.defs, self.texts = mode, [], [], []
        if poster:
            self.parts.append(f'<image href="{poster}" x="0" y="0" width="{W}" height="{H}" preserveAspectRatio="xMidYMid slice"/>')

    def text(self, s, size, weight, x, centre_y, fill="#FFFFFF", anchor="start"):
        """Text whose capitals are centred on centre_y; returns its width."""
        face = FACES[weight]
        width = face.width(s, size)
        if anchor == "middle":
            x -= width / 2
        elif anchor == "end":
            x -= width
        baseline = centre_y + face.cap * size / face.upem / 2
        if self.mode == "paths":
            self.parts.append(f'<path d="{face.path(s, size, x, baseline)}" fill="{fill}"/>')
        else:
            self.parts.append(f'<text x="{x:.2f}" y="{baseline:.2f}" font-family="Inter" font-weight="{weight}" font-size="{size}" fill="{fill}" style="font-kerning:normal">{escape(s)}</text>')
        self.texts.append(dict(text=s, size=size, weight=weight, x=x, baseline=baseline, width=width, fill=fill))
        return width

    def rect(self, x, y, w, h, r=0, **attrs):
        extra = " ".join(f'{k.replace("_", "-")}="{v}"' for k, v in attrs.items())
        self.parts.append(f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" rx="{r}" {extra}/>')

    def render(self):
        css = "".join(f"@font-face{{font-family:'Inter';font-weight:{w};src:url('fonts/{n}.ttf')}}" for w, n in FONTS.items())
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
            f"<style>{css}</style><defs>{''.join(self.defs)}</defs>{''.join(self.parts)}</svg>"
        )


def imdb_chip(svg, x, centre_y, h=64):
    w = FACES[900].width("IMDb", h * 0.56) + h * 0.5
    svg.rect(x, centre_y - h / 2, w, h, r=round(h * 0.18), fill="#F5C518")
    svg.text("IMDb", h * 0.56, 900, x + w / 2, centre_y, fill="#000000", anchor="middle")
    return w


def tomato(svg, x, centre_y, h=64):
    r = h / 2
    cx, cy = x + r, centre_y + 3
    svg.parts.append(f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{r - 3:.2f}" fill="#FA320A"/>')
    svg.parts.append(f'<polygon points="{cx-12:.1f},{cy-r+6:.1f} {cx:.1f},{cy-r-4:.1f} {cx+12:.1f},{cy-r+6:.1f} {cx:.1f},{cy-r+12:.1f}" fill="#28A03C"/>')
    return h


def streaming_c(item, mode, extras):
    """The maintainer's pick. extras=True adds what Kometa can't draw: gradient band, drop shadow, frosted glass."""
    svg = Svg(mode, f"posters/{item['key']}.jpg")
    if extras:
        svg.defs.append('<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.92"/></linearGradient>')
        svg.rect(0, H * 0.55, W, H * 0.45, fill="url(#fade)")
    else:
        svg.rect(0, H - 260, W, 260, fill="#000000", fill_opacity="0.65")
    # scores row
    x, cy = 48, H - 174
    x += imdb_chip(svg, x, cy) + 12
    x += svg.text(item["imdb"], 54, 700, x, cy) + 36
    x += tomato(svg, x, cy) + 12
    svg.text(f"{item['rt']}%", 54, 700, x, cy)
    # quality row: an outlined resolution box, then HDR and audio, each after the previous one
    x, cy = 48, H - 72
    face = FACES[700]
    cap = face.cap * 42 / face.upem
    tw = face.width(item["res"], 42)
    svg.rect(x, cy - cap / 2 - 13, tw + 26, cap + 26, r=8, fill="none", stroke="#FFFFFF", stroke_width=3)
    svg.text(item["res"], 42, 700, x + 13, cy)
    x += tw + 26 + 22
    for part in (item["hdr"], item["audio"]):
        if part:
            x += svg.text(part, 42, 700, x, cy, fill="#E1E1E1") + 22
    # NEW tag
    if item["added_days"] <= 14:
        if extras:
            svg.defs.append('<filter id="shadow" x="-20%" y="-30%" width="140%" height="180%"><feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000" flood-opacity="0.47"/></filter>')
            svg.parts.append('<g filter="url(#shadow)">')
        svg.rect(40, 40, 200, 72, r=14, fill="#E50914")
        if extras:
            svg.parts.append("</g>")
        svg.text("NEW", 40, 800, 140, 76, anchor="middle")
    if extras:
        # frosted glass pill, top right: the poster under it blurred, tinted, outlined
        label = item["audio"]
        pw = FACES[700].width(label, 44) + 72
        px, py, ph = W - 40 - pw, 40, 96
        m = 40  # blur margin so edges don't sample outside the image
        svg.defs.append(f'<clipPath id="pill"><rect x="{px:.2f}" y="{py}" width="{pw:.2f}" height="{ph}" rx="{ph/2}"/></clipPath>')
        svg.defs.append(f'<filter id="frost" filterUnits="userSpaceOnUse" x="{px-m:.2f}" y="{py-m}" width="{pw+2*m:.2f}" height="{ph+2*m}"><feGaussianBlur stdDeviation="12"/></filter>')
        svg.parts.append(f'<g clip-path="url(#pill)"><image href="posters/{item["key"]}.jpg" x="0" y="0" width="{W}" height="{H}" preserveAspectRatio="xMidYMid slice" filter="url(#frost)"/></g>')
        svg.rect(px, py, pw, ph, r=ph / 2, fill="#0E0E12", fill_opacity="0.41", stroke="#FFFFFF", stroke_opacity="0.31", stroke_width=2)
        svg.text(label, 44, 700, px + pw / 2, py + ph / 2, anchor="middle")
    return svg


def render(svg_text):
    started = time.perf_counter()
    png = bytes(resvg_py.svg_to_bytes(svg_string=svg_text, resources_dir=str(OUT), skip_system_fonts=True, font_files=[str(FONT_DIR / f"{n}.ttf") for n in FONTS.values()]))
    return png, (time.perf_counter() - started) * 1000


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "posters").mkdir(exist_ok=True)
    (OUT / "fonts").mkdir(exist_ok=True)
    for n in FONTS.values():
        shutil.copy(FONT_DIR / f"{n}.ttf", OUT / "fonts")
    timings, probes = [], []
    for item in ITEMS:
        # the poster at Kometa's canvas size, as the engine would keep it
        Image.open(ORIGINALS / f"{item['key']}.jpg").convert("RGB").resize((W, H), Image.LANCZOS).save(OUT / "posters" / f"{item['key']}.jpg", quality=95)
        for extras in (False, True):
            for mode in ("text", "paths"):
                name = f"{item['key']}-{'extras' if extras else 'c'}-{mode}"
                svg = streaming_c(item, mode, extras)
                text = svg.render()
                (OUT / f"{name}.svg").write_text(text)
                png, ms = render(text)
                (OUT / f"{name}.resvg.png").write_bytes(png)
                # overlay only (no poster, no frosted glass): the cheap path, composited onto the original with Pillow
                bare = streaming_c(item, mode, False)
                bare.parts = bare.parts[1:]
                overlay_png, overlay_ms = render(bare.render())
                started = time.perf_counter()
                poster = Image.open(OUT / "posters" / f"{item['key']}.jpg").convert("RGBA")
                poster.alpha_composite(Image.open(BytesIO(overlay_png)).convert("RGBA"))
                buf = BytesIO()
                poster.convert("RGB").save(buf, "JPEG", quality=90)
                compose_ms = (time.perf_counter() - started) * 1000
                timings.append(dict(name=name, full_ms=round(ms, 1), overlay_ms=round(overlay_ms, 1), compose_ms=round(compose_ms, 1)))
                # one probe per text element: alone on a transparent canvas, to measure where each renderer puts it
                for i, t in enumerate(svg.texts):
                    probe = Svg(mode, None)
                    probe.text(t["text"], t["size"], t["weight"], t["x"], t["baseline"] - FACES[t["weight"]].cap * t["size"] / FACES[t["weight"]].upem / 2)
                    pname = f"probe-{name}-{i}"
                    (OUT / f"{pname}.svg").write_text(probe.render())
                    (OUT / f"{pname}.resvg.png").write_bytes(render(probe.render())[0])
                    probes.append(dict(name=pname, text=t["text"], expected_x=round(t["x"], 2), expected_width=round(t["width"], 2)))
    (OUT / "timings.json").write_text(json.dumps(timings, indent=1))
    (OUT / "probes.json").write_text(json.dumps(probes, indent=1))
    print(f"{len(timings)} renders, {len(probes)} probes")


main()
