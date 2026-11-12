"""Overlay engine Phase 2: apply, skip, notice replaced posters, restore, dry run (docs/plans/overlay-engine.md, 3.4)."""

import asyncio
from io import BytesIO
from pathlib import Path

import httpx
import pytest
from fakeplex import REMOTE_URI, SERVER_TOKEN, FakePlex, overlay_poster
from PIL import Image

from starr_studio.db import open_database
from starr_studio.overlay_engine.apply import Context, apply, restore, studio_posters
from starr_studio.overlay_engine.originals import OriginalsStore
from starr_studio.overlay_engine.plex_posters import sha256
from starr_studio.overlay_engine.style import load_style
from starr_studio.plex_library import PlexServer

STYLES = Path(__file__).parent.parent / "starr_studio" / "overlay_engine" / "styles"
DOT = 'studio_style: 1\nname: Dot\noptions:\n  colour: { type: colour, default: "#FFFFFF", label: Colour }\nelements:\n  - { type: rect, box: { left: 0, top: 0, width: 100, height: 100 }, fill: { colour: $colour } }\n'


@pytest.fixture
def fake():
    plex = FakePlex()
    plex.add_overlay_section()
    return plex


@pytest.fixture
def ctx(tmp_path, fake):
    server = PlexServer(httpx.AsyncClient(transport=fake.transport()), REMOTE_URI, SERVER_TOKEN)
    return Context(server, open_database(tmp_path / "studio.db"), OriginalsStore(tmp_path / "originals"), "90", tmp_path / "Movies Original Posters")


def run(coro):
    return asyncio.run(coro)


def go(ctx, keys, *, excluded=(), values=None, **flags):
    return run(apply(ctx, keys, load_style(DOT), "dot", values, set(excluded), **flags))


def pixel(data: bytes, xy=(50, 50)):
    return Image.open(BytesIO(data)).convert("RGB").getpixel(xy)


def near(a, b, slack=12):
    return all(abs(x - y) <= slack for x, y in zip(a, b))


def test_dry_run_changes_nothing(ctx, fake):
    [outcome] = go(ctx, ["4635"], dry_run=True)
    assert (outcome.kind, outcome.done, outcome.title) == ("draw", False, "Poor Things")
    assert fake.uploads == [] and studio_posters(ctx.db) == [] and ctx.originals.current("4635") is None


def test_apply_then_skip_then_repair_then_option_change(ctx, fake):
    first = fake.posters["4635"]
    [outcome] = go(ctx, ["4635"])
    assert (outcome.kind, outcome.done) == ("draw", True)
    assert ctx.originals.current("4635").sha256 == sha256(first)  # the poster Plex showed is kept
    [(key, uploaded)] = fake.uploads
    assert key == "4635" and near(pixel(uploaded), (255, 255, 255)) and near(pixel(uploaded, (500, 700)), (40, 90, 160))
    assert studio_posters(ctx.db, "90") == ["4635"] and studio_posters(ctx.db, "1") == []

    assert go(ctx, ["4635"])[0].kind == "skip" and len(fake.uploads) == 1
    assert go(ctx, ["4635"], force=True)[0].kind == "redraw" and len(fake.uploads) == 2
    [outcome] = go(ctx, ["4635"], values={"colour": "#FF0000"})
    assert outcome.kind == "redraw" and near(pixel(fake.uploads[-1][1]), (255, 0, 0))
    assert near(pixel(fake.uploads[-1][1], (500, 700)), (40, 90, 160))  # drawn on the original, not on Studio's last poster


def test_a_poster_plex_re_encoded_is_still_studios(ctx, fake):
    go(ctx, ["4635"])
    buf = BytesIO()
    Image.open(BytesIO(fake.posters["4635"])).save(buf, "JPEG", quality=70)
    fake.posters["4635"] = buf.getvalue()
    assert go(ctx, ["4635"])[0].kind == "skip"


def test_a_replaced_poster_becomes_the_original(ctx, fake):
    go(ctx, ["4635"])
    old = ctx.originals.current("4635")
    fake.replace_poster("4635", overlay_poster((200, 30, 30)))
    [outcome] = go(ctx, ["4635"])
    assert (outcome.kind, outcome.done) == ("replaced", True)
    assert near(pixel(fake.uploads[-1][1], (500, 700)), (200, 30, 30))
    assert ctx.originals.current("4635").sha256 != old.sha256 and old.path.is_file()  # the old original is never deleted


def test_draws_on_kometas_untouched_backup(ctx, fake):
    ctx.kometa_backups.mkdir()
    backup = overlay_poster((30, 160, 60))
    (ctx.kometa_backups / "4635.jpg").write_bytes(backup)
    [outcome] = go(ctx, ["4635"])
    assert outcome.message == "Drawn on Kometa's untouched poster."
    assert ctx.originals.current("4635").sha256 == sha256(backup)
    assert near(pixel(fake.uploads[-1][1], (500, 700)), (30, 160, 60))


def test_maintainerrs_titles_are_never_touched(ctx, fake):
    fake.requests.clear()
    outcomes = go(ctx, ["4635", "4331"], excluded={"4331"})
    assert [o.kind for o in outcomes] == ["draw", "excluded"]
    assert not any("/4331" in r.url.path for r in fake.requests) and [k for k, _ in fake.uploads] == ["4635"]


def test_one_title_failing_does_not_stop_the_others(ctx, fake):
    outcomes = go(ctx, ["4635", "999999"])
    assert [o.kind for o in outcomes] == ["draw", "error"] and outcomes[1].message


def test_restore_puts_the_original_back(ctx, fake):
    original = fake.posters["4635"]
    go(ctx, ["4635"])
    [outcome] = run(restore(ctx, ["4635"], dry_run=True))
    assert (outcome.kind, outcome.done) == ("restore", False) and len(fake.uploads) == 1
    [outcome] = run(restore(ctx, ["4635"]))
    assert (outcome.kind, outcome.done) == ("restore", True)
    assert fake.uploads[-1] == ("4635", original) and studio_posters(ctx.db) == []
    assert run(restore(ctx, ["4635"]))[0].kind == "unchanged" and len(fake.uploads) == 2

    # Applying again after a restore keeps the first original rather than the copy Plex re-encoded.
    buf = BytesIO()
    Image.open(BytesIO(fake.posters["4635"])).save(buf, "JPEG", quality=70)
    fake.posters["4635"] = buf.getvalue()
    assert go(ctx, ["4635"])[0].kind == "draw" and len(list((ctx.originals.root / "4635").glob("?" * 16 + ".jpg"))) == 1


def test_restore_leaves_someone_elses_poster_alone(ctx, fake):
    go(ctx, ["4635"])
    theirs = overlay_poster((200, 30, 30))
    fake.replace_poster("4635", theirs)
    [outcome] = run(restore(ctx, ["4635"]))
    assert outcome.kind == "unchanged" and fake.posters["4635"] == theirs and len(fake.uploads) == 1
    assert studio_posters(ctx.db) == []


def test_modern_streaming_applies(ctx, fake):
    style = load_style((STYLES / "modern-streaming.yml").read_text())
    [outcome] = run(apply(ctx, ["8586"], style, "modern-streaming", None, set()))
    assert outcome.done and Image.open(BytesIO(fake.uploads[-1][1])).size == (1000, 1500)
