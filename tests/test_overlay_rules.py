from pathlib import Path

import pytest

from starr_studio.overlay_engine import style as style_module
from starr_studio.overlay_engine.facts import TitleFacts
from starr_studio.overlay_engine.rules import matches, placeholder_text, resolve
from starr_studio.overlay_engine.style import Style, load_style

NOW = 1_800_000_000
DAY = 86400
STYLE = load_style((Path(style_module.__file__).parent / "styles" / "modern-streaming.yml").read_text())


def facts(**kw) -> TitleFacts:
    return TitleFacts(**{"rating_key": "1", "type": "movie", "title": "T", **kw})


POOR_THINGS = facts(title="Poor Things", resolution="4K", hdr="DOLBY VISION", audio_codec="DD+", channels="5.1", atmos=True, imdb=7.7, rt_critic=92, added_at=NOW - 400 * DAY)
MOONLIGHT = facts(title="Moonlight", resolution="1080P", audio_codec="AAC", channels="5.1", rt_critic=45, added_at=NOW - 3 * DAY, imdb=7.4)


def walk(elements):
    for e in elements:
        yield e
        yield from walk(getattr(e, "children", []))


def texts(elements):
    return [e.text for e in walk(elements) if e.type == "text"]


def ids(elements):
    return [e.id for e in elements]


def test_poor_things():
    out = resolve(STYLE, POOR_THINGS, now=NOW)
    assert ids(out) == ["band", "scores", "quality"]
    assert out[0].fill.opacity == 0.65
    scores = out[1].children
    assert [[c.type for c in row.children] for row in scores] == [["logo", "text"], ["logo", "text"]]
    assert [c.image for row in scores for c in row.children if c.type == "logo"] == ["imdb", "rt_fresh"]
    assert texts(out) == ["7.7", "92%", "4K", "DOLBY VISION", "DD+ ATMOS 5.1"]
    assert all(e.show_when is None for e in walk(out))


def test_moonlight():
    out = resolve(STYLE, MOONLIGHT, now=NOW)
    assert ids(out) == ["band", "scores", "quality", "new"]
    assert texts(out) == ["7.4", "45%", "1080P", "AAC 5.1", "NEW"]
    assert [e.image for e in walk(out) if e.type == "logo"] == ["imdb", "rt_rotten"]
    assert out[3].background.fill.colour == "#E50914"
    assert "new" not in ids(resolve(STYLE, MOONLIGHT, {"new_days": 0}, now=NOW))
    assert "new" in ids(resolve(STYLE, MOONLIGHT, {"new_days": 3}, now=NOW))


def test_empty_scores_row_dropped():
    out = resolve(STYLE, MOONLIGHT, {"ratings": ["tmdb"]}, now=NOW)
    assert "scores" not in ids(out)


def test_input_unchanged_and_refs_gone():
    before = STYLE.model_dump()
    out = resolve(STYLE, MOONLIGHT, now=NOW)
    assert STYLE.model_dump() == before
    assert "$" not in repr([e.model_dump() for e in out])


def test_braces_in_title():
    style = Style.model_validate({"studio_style": 1, "name": "x", "elements": [
        {"type": "text", "text": "{title}", "size": 10, "box": {"left": 0, "top": 0}}]})
    assert texts(resolve(style, facts(title="{Untitled} {imdb}"))) == ["{Untitled} {imdb}"]


@pytest.mark.parametrize("name, kw, expected", [
    ("imdb", {"imdb": 8.0}, "8.0"), ("tmdb", {"tmdb": 7.6}, "7.6"),
    ("rt_critic", {"rt_critic": 92}, "92"), ("year", {"year": 2023}, "2023"), ("imdb", {}, None),
    ("runtime", {"runtime_minutes": 101}, "1h 41m"), ("runtime", {"runtime_minutes": 45}, "45m"), ("runtime", {"runtime_minutes": 120}, "2h"),
    ("runtime", {}, None),
    ("audio", {"audio_codec": "DD+", "channels": "5.1"}, "DD+ 5.1"),
    ("audio", {"audio_codec": "TRUEHD", "channels": "7.1", "atmos": True}, "TRUEHD ATMOS 7.1"),
    ("audio", {"audio_codec": "DTS-HD MA", "channels": "7.1", "dts_x": True}, "DTS:X 7.1"),
    ("audio", {"audio_codec": "DD+"}, "DD+"), ("audio", {}, None),
    ("hdr", {"hdr": "HDR10"}, "HDR10"), ("hdr", {}, None), ("title", {}, "T"),
])
def test_placeholder_text(name, kw, expected):
    assert placeholder_text(name, facts(**kw)) == expected


def m(rule, f=None, values=None):
    return matches(rule, f or facts(), values or {}, NOW)


def test_matches():
    f = facts(resolution="4K", imdb=7.5, atmos=True, edition="Extended")
    assert m({"resolution": "4k"}, f) and not m({"resolution": "1080P"}, f)
    assert m({"resolution": ["1080P", "4k"]}, f)
    assert m({"imdb": {"min": 7.5}}, f) and m({"imdb": {"min": 7, "max": 7.5}}, f) and not m({"imdb": {"max": 7}}, f)
    assert not m({"rt_critic": {"min": 0}}, f) and not m({"hdr": "HDR10"}, f) and not m({"hdr": ["HDR10"]}, f)
    assert m({"atmos": True}, f) and not m({"dts_x": True}, f)
    assert m({"has": "atmos"}, f) and not m({"has": "dts_x"}, f) and m({"has": ["imdb", "edition"]}, f) and not m({"has": ["imdb", "hdr"]}, f)
    assert m({"resolution": "4K", "imdb": {"min": 9}}, f) is False
    assert m({"any": [{"resolution": "SD"}, {"atmos": True}]}, f) and not m({"all": [{"resolution": "SD"}, {"atmos": True}]}, f)
    assert m({"not": {"any": [{"resolution": "SD"}]}}, f)


def test_added_within_days():
    assert m({"added_within_days": 14}, facts(added_at=NOW - 14 * DAY)) and not m({"added_within_days": 14}, facts(added_at=NOW - 14 * DAY - 1))
    assert not m({"added_within_days": 0}, facts(added_at=NOW)) and not m({"added_within_days": 14})


def test_option():
    values = {"ratings": ["imdb", "tmdb"], "style": "a"}
    assert m({"option": {"ratings": "tmdb"}}, values=values) and not m({"option": {"ratings": "rt_critic"}}, values=values)
    assert m({"option": {"ratings": "imdb", "style": "a"}}, values=values) and not m({"option": {"ratings": "imdb", "style": "b"}}, values=values)
