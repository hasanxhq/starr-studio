"""The overlay engine's style format (starr_studio/overlay_engine/style.py)."""

from pathlib import Path

import pytest
from fontTools.ttLib import TTFont
from PIL import Image

from starr_studio.overlay_engine.fonts import FONTS, font_path
from starr_studio.overlay_engine.style import LOGOS, Row, StyleError, load_style

STYLES = Path(__file__).parent.parent / "starr_studio" / "overlay_engine" / "styles"
LOGO_DIR = Path(__file__).parent.parent / "starr_studio" / "overlay_engine" / "logos"

MINIMAL = """
studio_style: 1
name: Test
options:
  accent: { type: colour, default: "#E50914", label: Accent }
elements:
  - type: text
    text: "{imdb}"
    size: 40
    box: { left: 40, top: 40 }
    show_when: { has: imdb }
"""


def style_with(element: str, options: str = "") -> str:
    return f"studio_style: 1\nname: Test\n{options}elements:\n{element}"


def test_shipped_styles_load():
    names = [load_style(p.read_text()).name for p in sorted(STYLES.glob("*.yml"))]
    assert "Modern streaming" in names


def test_modern_streaming_defaults_and_options():
    style = load_style((STYLES / "modern-streaming.yml").read_text())
    assert style.option_values() == {"accent": "#E50914", "band": 65, "new_days": 14, "ratings": ["imdb", "rt_critic"]}
    assert style.option_values({"ratings": ["tmdb"], "band": 80})["ratings"] == ["tmdb"]
    with pytest.raises(ValueError, match="isn't among"):
        style.option_values({"ratings": ["letterboxd"]})
    with pytest.raises(ValueError, match="outside"):
        style.option_values({"band": 120})
    with pytest.raises(ValueError, match="unknown option"):
        style.option_values({"colour": "#000000"})
    scores = next(e for e in style.elements if e.id == "scores")
    assert isinstance(scores, Row) and [c.type for c in scores.children] == ["row"] * 4


def test_fonts_and_logos_ship():
    for name, file in FONTS.items():
        assert TTFont(font_path(name))["name"].getDebugName(1).startswith("Inter"), file
    for logo in LOGOS:
        assert Image.open(LOGO_DIR / f"{logo}.png").height == 128


def test_a_minimal_style():
    style = load_style(MINIMAL)
    assert style.elements[0].type == "text" and style.option_values() == {"accent": "#E50914"}


@pytest.mark.parametrize(
    ("element", "problem"),
    [
        ('  - { type: text, text: "{rating}", size: 40, box: { left: 0, top: 0 } }', "unknown placeholder"),
        ('  - { type: text, text: x, size: 40, font: Comic Sans, box: { left: 0, top: 0 } }', "unknown font"),
        ("  - { type: text, text: x, size: 40 }", "needs a box"),
        ("  - { type: text, text: x, size: 40, box: { left: 0 } }", "needs top, bottom or centre_y"),
        ("  - { type: text, text: x, size: 40, box: { left: 0, centre_x: 0, top: 0 } }", "centre_x can't go with"),
        ("  - { type: rect, fill: { colour: red }, box: { left: 0, top: 0, width: 10, height: 10 } }", "isn't a colour"),
        ("  - { type: rect, fill: { colour: '#000000' }, box: { left: 0, top: 0, width: 10px, height: 10 } }", "percentage"),
        ("  - { type: rect, fill: { colour: $nope }, box: { left: 0, top: 0, width: 10, height: 10 } }", "isn't an option"),
        ("  - { type: logo, image: letterboxd, height: 60, box: { left: 0, top: 0 } }", "unknown logo"),
        ("  - { type: text, text: x, size: 40, box: { left: 0, top: 0 }, show_when: { rating: 7 } }", "unknown key"),
        ("  - { type: text, text: x, size: 40, box: { left: 0, top: 0 }, show_when: { has: score } }", "unknown fact"),
        ("  - { type: text, text: x, size: 40, box: { left: 0, top: 0 }, show_when: { imdb: { above: 7 } } }", "min and/or max"),
        ("  - { type: text, text: x, size: 40, box: { left: 0, top: 0 }, show_when: { option: { colour: red } } }", "isn't an option"),
        ("  - { type: text, text: x, size: 40, box: { left: 0, top: 0 }, show_when: { added_within_days: soon } }", "whole number"),
        ("  - { type: text, text: x, size: 40, box: { left: 0, top: 0 }, colour: '#FFFFFF', wobble: 3 }", "Extra inputs"),
        ("  - { type: row, box: { left: 0, top: 0 }, children: [ { type: text, text: x, size: 4, box: { left: 0, top: 0 } } ] }", "leave its box out"),
        ("  - { type: group, box: { left: 0, top: 0 }, children: [ { type: text, text: x, size: 4 } ] }", "needs a box"),
    ],
)
def test_bad_styles_say_why(element, problem):
    with pytest.raises(StyleError, match=problem):
        load_style(style_with(element))


def test_not_yaml_or_wrong_version():
    with pytest.raises(StyleError, match="not valid YAML"):
        load_style("studio_style: [1")
    with pytest.raises(StyleError, match="studio_style"):
        load_style(MINIMAL.replace("studio_style: 1", "studio_style: 2"))
    with pytest.raises(StyleError, match="mapping"):
        load_style("- just a list")
