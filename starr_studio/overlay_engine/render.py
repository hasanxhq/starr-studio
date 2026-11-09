"""Draws resolved elements (rules.resolve) as one SVG scene, and onto a poster.

The scene is the same SVG for the browser and the server. Text is shaped here with HarfBuzz and written as glyph
outlines, so both draw identical shapes (Phase 0 measured them within a pixel). On the server resvg draws only the
overlay on a transparent canvas and Pillow lays it on the poster: decoding the whole poster inside resvg was 5x slower.
Frosted glass (blur_behind) gets just the crop of the poster under it.

Layout follows style.py's size rules. A group with no width or height in its box fills its parent that way.
"""

import base64
import xml.etree.ElementTree as ET
from collections.abc import Callable
from functools import lru_cache
from io import BytesIO
from pathlib import Path

import resvg_py
import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image

from .fonts import font_path
from .style import POSTER_HEIGHT, POSTER_WIDTH, Box, Column, Fill, Group, Logo, Rect, Row, Stroke, Svg, Text

LOGO_DIR = Path(__file__).parent / "logos"
SVG_NS = "http://www.w3.org/2000/svg"
# What a style's raw svg element may hold: shapes and paint, nothing that loads, links or runs anything.
SVG_TAGS = {"g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "defs", "linearGradient", "radialGradient", "stop"}

# backdrop(x0, y0, x1, y1) -> (href, x, y, width, height): an image covering at least that part of the poster
Backdrop = Callable[[int, int, int, int], tuple[str, float, float, float, float]]


def _n(value: float) -> str:
    return f"{value:.2f}".rstrip("0").rstrip(".")


class _Face:
    def __init__(self, name: str):
        data = font_path(name).read_bytes()
        tt = TTFont(BytesIO(data))
        self.hb_font = hb.Font(hb.Face(data))
        self.glyphs, self.order = tt.getGlyphSet(), tt.getGlyphOrder()
        self.upem, self.cap = tt["head"].unitsPerEm, tt["OS/2"].sCapHeight

    def shape(self, text: str):
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(self.hb_font, buf, {"kern": True, "liga": True})
        return buf.glyph_infos, buf.glyph_positions

    def width(self, text: str, size: float, spacing: float) -> float:
        _, positions = self.shape(text)
        return sum(p.x_advance for p in positions) * size / self.upem + spacing * max(len(positions) - 1, 0)

    def path(self, text: str, size: float, spacing: float, x: float, baseline: float) -> str:
        infos, positions = self.shape(text)
        scale = size / self.upem
        pen = SVGPathPen(self.glyphs, ntos=_n)
        for info, p in zip(infos, positions):
            self.glyphs[self.order[info.codepoint]].draw(TransformPen(pen, (scale, 0, 0, -scale, x + p.x_offset * scale, baseline - p.y_offset * scale)))
            x += p.x_advance * scale + spacing
        return pen.getCommands()


@lru_cache
def _face(name: str) -> _Face:
    return _Face(name)


@lru_cache
def _logo(name: str) -> tuple[str, float]:
    """The logo as a data URI, and its width per unit of height."""
    data = (LOGO_DIR / f"{name}.png").read_bytes()
    with Image.open(BytesIO(data)) as image:
        aspect = image.width / image.height
    return "data:image/png;base64," + base64.b64encode(data).decode(), aspect


def _length(value, extent: float) -> float | None:
    if value is None:
        return None
    return float(value[:-1]) * extent / 100 if isinstance(value, str) and value.endswith("%") else float(value)


def _padding(text: Text) -> tuple[float, float, float, float]:
    """top, right, bottom, left"""
    pad = text.background.padding if text.background else 0
    if not isinstance(pad, list):
        return (float(pad),) * 4
    if len(pad) == 2:
        return float(pad[0]), float(pad[1]), float(pad[0]), float(pad[1])
    return tuple(float(p) for p in pad)


def _text_size(text: Text) -> tuple[float, float]:
    face, size = _face(text.font), float(text.size)
    top, right, bottom, left = _padding(text)
    return face.width(text.text, size, float(text.letter_spacing)) + left + right, face.cap * size / face.upem + top + bottom


def natural_size(el, parent: tuple[float, float] = (POSTER_WIDTH, POSTER_HEIGHT)) -> tuple[float, float]:
    """An element's own size, before its box stretches or sets it."""
    if isinstance(el, Text):
        return _text_size(el)
    if isinstance(el, Logo):
        return float(el.height) * _logo(el.image)[1], float(el.height)
    if isinstance(el, Svg):
        return float(el.width), float(el.height)
    if isinstance(el, (Row, Column)):
        sizes = [natural_size(c) for c in el.children]
        main, cross = (0, 1) if isinstance(el, Row) else (1, 0)
        total = sum(s[main] for s in sizes) + float(el.gap) * (len(sizes) - 1)
        widest = max(s[cross] for s in sizes)
        return (total, widest) if isinstance(el, Row) else (widest, total)
    if isinstance(el, Group):
        return parent
    return 0.0, 0.0  # a rect is as big as its box says


def _span(start, end, centre, size, natural: float, origin: float, extent: float, poster: float) -> tuple[float, float]:
    start, end, centre, size = (_length(v, poster) for v in (start, end, centre, size))
    if start is not None and end is not None:
        return origin + start, extent - start - end
    length = natural if size is None else size
    if start is not None:
        return origin + start, length
    if end is not None:
        return origin + extent - end - length, length
    return origin + (extent - length) / 2 + centre, length


def place(box: Box, natural: tuple[float, float], parent: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    """x, y, width, height of a box inside its parent's x, y, width, height."""
    px, py, pw, ph = parent
    x, w = _span(box.left, box.right, box.centre_x, box.width, natural[0], px, pw, POSTER_WIDTH)
    y, h = _span(box.top, box.bottom, box.centre_y, box.height, natural[1], py, ph, POSTER_HEIGHT)
    return x, y, w, h


def check_svg_fragment(fragment: str) -> str:
    """The fragment re-written from its parsed form, if it only draws shapes; ValueError if not."""
    try:
        root = ET.fromstring(f'<g xmlns="{SVG_NS}">{fragment}</g>')
    except ET.ParseError as error:
        raise ValueError(f"svg isn't valid: {error}") from error
    for node in root.iter():
        tag = node.tag.removeprefix(f"{{{SVG_NS}}}")
        if tag not in SVG_TAGS:
            raise ValueError(f"svg: <{tag}> isn't allowed; use {', '.join(sorted(SVG_TAGS))}")
        for name, value in node.attrib.items():
            if name.lower().startswith("on") or "href" in name.lower() or name == "style" or ("url(" in value and "url(#" not in value):
                raise ValueError(f"svg: attribute {name}={value!r} isn't allowed")
    ET.register_namespace("", SVG_NS)
    return ET.tostring(root, encoding="unicode")


class _Scene:
    def __init__(self, backdrop: Backdrop | None):
        self.parts: list[str] = []
        self.defs: list[str] = []
        self.backdrop = backdrop
        self.count = 0

    def new_id(self, kind: str) -> str:
        self.count += 1
        return f"studio-{kind}-{self.count}"

    def paint(self, fill: Fill | None, stroke: Stroke | None) -> str:
        attrs = []
        if fill is None:
            attrs.append('fill="none"')
        elif fill.gradient:
            gid = self.new_id("gradient")
            x1, y1, x2, y2 = {"down": (0, 0, 0, 1), "up": (0, 1, 0, 0), "right": (0, 0, 1, 0), "left": (1, 0, 0, 0)}[fill.gradient.direction]
            stops = "".join(f'<stop offset="{_n(s.at)}" stop-color="{s.colour}" stop-opacity="{_n(float(s.opacity))}"/>' for s in fill.gradient.stops)
            self.defs.append(f'<linearGradient id="{gid}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}">{stops}</linearGradient>')
            attrs.append(f'fill="url(#{gid})" fill-opacity="{_n(float(fill.opacity))}"')
        else:
            attrs.append(f'fill="{fill.colour}" fill-opacity="{_n(float(fill.opacity))}"')
        if stroke:
            attrs.append(f'stroke="{stroke.colour}" stroke-width="{_n(float(stroke.width))}" stroke-opacity="{_n(float(stroke.opacity))}"')
        return " ".join(attrs)

    def rect(self, x, y, w, h, radius, paint: str) -> None:
        self.parts.append(f'<rect x="{_n(x)}" y="{_n(y)}" width="{_n(w)}" height="{_n(h)}" rx="{_n(radius)}" {paint}/>')

    def frost(self, el, x, y, w, h) -> None:
        """Frosted glass: the poster under the element's shape, blurred and tinted."""
        blur = el.blur_behind
        radius = float(el.radius if isinstance(el, Rect) else el.background.radius if isinstance(el, Text) and el.background else 0)
        sigma = float(blur.radius)
        margin = 3 * sigma  # so the blur's edge doesn't fade into transparent
        x0, y0 = max(int(x - margin), 0), max(int(y - margin), 0)
        x1, y1 = min(int(x + w + margin) + 1, POSTER_WIDTH), min(int(y + h + margin) + 1, POSTER_HEIGHT)
        if self.backdrop is None or x1 <= x0 or y1 <= y0:
            return
        href, ix, iy, iw, ih = self.backdrop(x0, y0, x1, y1)
        clip, blur_id = self.new_id("clip"), self.new_id("blur")
        self.defs.append(f'<clipPath id="{clip}"><rect x="{_n(x)}" y="{_n(y)}" width="{_n(w)}" height="{_n(h)}" rx="{_n(radius)}"/></clipPath>')
        self.defs.append(f'<filter id="{blur_id}" filterUnits="userSpaceOnUse" x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}"><feGaussianBlur stdDeviation="{_n(sigma)}"/></filter>')
        self.parts.append(f'<g clip-path="url(#{clip})"><image href="{href}" x="{_n(ix)}" y="{_n(iy)}" width="{_n(iw)}" height="{_n(ih)}" preserveAspectRatio="none" filter="url(#{blur_id})"/></g>')
        self.rect(x, y, w, h, radius, f'fill="{blur.tint}" fill-opacity="{_n(float(blur.tint_opacity))}"')

    def element(self, el, x: float, y: float, w: float, h: float) -> None:
        if el.blur_behind:
            self.frost(el, x, y, w, h)
        attrs = []
        if float(el.opacity) != 1:
            attrs.append(f'opacity="{_n(float(el.opacity))}"')
        if el.shadow:
            s = el.shadow
            sid = self.new_id("shadow")
            m = 3 * float(s.blur) + max(abs(float(s.dx)), abs(float(s.dy))) + h / 2  # room for the blur, the offset and descenders
            self.defs.append(
                f'<filter id="{sid}" filterUnits="userSpaceOnUse" x="{_n(x - m)}" y="{_n(y - m)}" width="{_n(w + 2 * m)}" height="{_n(h + 2 * m)}">'
                f'<feDropShadow dx="{_n(float(s.dx))}" dy="{_n(float(s.dy))}" stdDeviation="{_n(float(s.blur))}" flood-color="{s.colour}" flood-opacity="{_n(float(s.opacity))}"/></filter>'
            )
            attrs.append(f'filter="url(#{sid})"')
        if attrs:
            self.parts.append(f"<g {' '.join(attrs)}>")
        self.content(el, x, y, w, h)
        if attrs:
            self.parts.append("</g>")

    def content(self, el, x: float, y: float, w: float, h: float) -> None:
        if isinstance(el, Rect):
            self.rect(x, y, w, h, float(el.radius), self.paint(el.fill, el.stroke))
        elif isinstance(el, Text):
            if el.background and (el.background.fill or el.background.stroke):
                self.rect(x, y, w, h, float(el.background.radius), self.paint(el.background.fill, el.background.stroke))
            face, size, spacing = _face(el.font), float(el.size), float(el.letter_spacing)
            top, right, bottom, left = _padding(el)
            text_x = x + left + (w - left - right - face.width(el.text, size, spacing)) / 2
            baseline = y + top + (h - top - bottom + face.cap * size / face.upem) / 2
            self.parts.append(f'<path d="{face.path(el.text, size, spacing, text_x, baseline)}" fill="{el.colour}"/>')
        elif isinstance(el, Logo):
            href, aspect = _logo(el.image)
            lh = float(el.height)
            self.parts.append(f'<image href="{href}" x="{_n(x + (w - lh * aspect) / 2)}" y="{_n(y + (h - lh) / 2)}" width="{_n(lh * aspect)}" height="{_n(lh)}"/>')
        elif isinstance(el, Svg):
            self.parts.append(f'<svg x="{_n(x)}" y="{_n(y)}" width="{_n(w)}" height="{_n(h)}" viewBox="0 0 {_n(float(el.width))} {_n(float(el.height))}" overflow="visible">{check_svg_fragment(el.svg)}</svg>')
        elif isinstance(el, (Row, Column)):
            row = isinstance(el, Row)
            at = x if row else y
            for child in el.children:
                cw, ch = natural_size(child)
                offset = {"start": 0, "centre": 0.5, "end": 1}[el.align] * ((h - ch) if row else (w - cw))
                self.element(child, *((at, y + offset) if row else (x + offset, at)), cw, ch)
                at += (cw if row else ch) + float(el.gap)
        elif isinstance(el, Group):
            for child in el.children:
                self.element(child, *place(child.box, natural_size(child, (w, h)), (x, y, w, h)))

    def svg(self) -> str:
        return (
            f'<svg xmlns="{SVG_NS}" width="{POSTER_WIDTH}" height="{POSTER_HEIGHT}" viewBox="0 0 {POSTER_WIDTH} {POSTER_HEIGHT}">'
            f"<defs>{''.join(self.defs)}</defs>{''.join(self.parts)}</svg>"
        )


def _draw(elements: list, backdrop: Backdrop | None, background: str = "") -> str:
    scene = _Scene(backdrop)
    scene.parts.append(background)
    poster = (0.0, 0.0, float(POSTER_WIDTH), float(POSTER_HEIGHT))
    for el in elements:
        scene.element(el, *place(el.box, natural_size(el), poster))
    return scene.svg()


def scene_svg(elements: list, poster_href: str | None = None) -> str:
    """The whole scene for a browser: the poster (if given) under the overlay. Frosted glass needs the poster."""
    full = None if poster_href is None else (lambda *_: (poster_href, 0, 0, POSTER_WIDTH, POSTER_HEIGHT))
    background = "" if poster_href is None else f'<image href="{poster_href}" x="0" y="0" width="{POSTER_WIDTH}" height="{POSTER_HEIGHT}" preserveAspectRatio="none"/>'
    return _draw(elements, full, background)


def render_poster(elements: list, poster: bytes, quality: int = 90) -> bytes:
    """The poster with the overlay drawn on it, as a 1000x1500 JPEG (stretched to that size, as Kometa does)."""
    with Image.open(BytesIO(poster)) as source:
        image = source.convert("RGB").resize((POSTER_WIDTH, POSTER_HEIGHT), Image.LANCZOS).convert("RGBA")

    def crop(x0, y0, x1, y1):
        buf = BytesIO()
        image.crop((x0, y0, x1, y1)).convert("RGB").save(buf, "PNG", compress_level=1)
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode(), x0, y0, x1 - x0, y1 - y0

    overlay = bytes(resvg_py.svg_to_bytes(svg_string=_draw(elements, crop), skip_system_fonts=True))
    with Image.open(BytesIO(overlay)) as layer:
        image.alpha_composite(layer.convert("RGBA"))
    out = BytesIO()
    image.convert("RGB").save(out, "JPEG", quality=quality)
    return out.getvalue()
