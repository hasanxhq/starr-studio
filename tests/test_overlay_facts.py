"""Overlay engine: facts from Plex metadata and the overlay_facts cache."""

import asyncio
import json
from pathlib import Path

import httpx
import pytest
from fakeplex import REMOTE_URI, SERVER_TOKEN, FakePlex

from starr_studio.db import connect, load_migrations, open_database
from starr_studio.overlay_engine.facts import TitleFacts
from starr_studio.overlay_engine.facts_plex import facts_from_metadata, library_facts, title_facts
from starr_studio.plex_library import PlexServer

_FIXTURES = Path(__file__).parent / "fixtures" / "overlay_facts"
_SAMPLES: dict = json.loads((_FIXTURES / "metadata.json").read_text())

EXPECTED = {
    "4635": dict(
        resolution="4K", hdr="DOLBY VISION", audio_codec="DD+", channels="5.1", atmos=True,
        imdb=7.7, rt_critic=92, rt_audience=80, tmdb=7.6,
    ),
    "4331": dict(resolution="4K", hdr="HDR10", audio_codec="DD+", channels="7.1", atmos=False),
    "3770": dict(resolution="1080P", hdr=None, audio_codec="DTS-HD MA", channels="7.1", atmos=False),
    "8586": dict(resolution="1080P", hdr=None, audio_codec="AAC", channels="5.1", atmos=False),
    "7356": dict(resolution="4K", hdr=None, audio_codec="TRUEHD", channels="7.1", atmos=True),
}


def _metadata_calls(requests: list[httpx.Request]) -> int:
    return sum(1 for r in requests if r.url.path.startswith("/library/metadata/") and r.method == "GET")


@pytest.fixture
def db(tmp_path):
    return open_database(tmp_path / "studio.db")


@pytest.fixture
def overlay_server():
    fake = FakePlex()
    fake.add_overlay_section()
    return fake


async def _server(fake: FakePlex) -> PlexServer:
    client = httpx.AsyncClient(transport=fake.transport())
    return PlexServer(client, REMOTE_URI, SERVER_TOKEN)


def _check_fields(facts: TitleFacts, key: str) -> None:
    want = EXPECTED[key]
    assert facts.resolution == want["resolution"]
    assert facts.hdr == want["hdr"]
    assert facts.audio_codec == want["audio_codec"]
    assert facts.channels == want["channels"]
    assert facts.atmos == want["atmos"]
    if "imdb" in want:
        assert facts.imdb == want["imdb"]
        assert facts.rt_critic == want["rt_critic"]
        assert facts.rt_audience == want["rt_audience"]
        assert facts.tmdb == want["tmdb"]


@pytest.mark.parametrize("key", list(EXPECTED))
def test_facts_from_metadata_samples(key):
    facts = facts_from_metadata(_SAMPLES[key])
    _check_fields(facts, key)


def test_library_facts_fetches_every_title_then_uses_cache(db, overlay_server):
    fake = overlay_server
    fake.requests.clear()

    async def run():
        server = await _server(fake)
        try:
            first = await library_facts(server, db, "90", "movie")
            assert set(first) == set(EXPECTED)
            for key in EXPECTED:
                _check_fields(first[key], key)
            assert _metadata_calls(fake.requests) == len(EXPECTED)

            fake.requests.clear()
            second = await library_facts(server, db, "90", "movie")
            assert _metadata_calls(fake.requests) == 0
            assert second == first
        finally:
            await server.client.aclose()

    asyncio.run(run())


def test_library_facts_refetches_when_updated_at_moves(db, overlay_server):
    fake = overlay_server

    async def run():
        server = await _server(fake)
        try:
            await library_facts(server, db, "90", "movie")
            fake.requests.clear()
            fake.OVERLAY_LISTING[0]["updatedAt"] = fake.OVERLAY_LISTING[0]["updatedAt"] + 1
            await library_facts(server, db, "90", "movie")
            assert _metadata_calls(fake.requests) == 1
        finally:
            await server.client.aclose()

    asyncio.run(run())


def test_library_facts_drops_titles_gone_from_section(db, overlay_server):
    fake = overlay_server

    async def run():
        server = await _server(fake)
        try:
            await library_facts(server, db, "90", "movie")
            removed_key = fake.OVERLAY_LISTING.pop()["ratingKey"]
            fake.SIZES["90"] = len(fake.OVERLAY_LISTING)
            await library_facts(server, db, "90", "movie")
            row = db.execute("SELECT 1 FROM overlay_facts WHERE rating_key = ?", (removed_key,)).fetchone()
            assert row is None
        finally:
            await server.client.aclose()

    asyncio.run(run())


def test_title_facts_caches_and_honours_force(db, overlay_server):
    fake = overlay_server

    async def run():
        server = await _server(fake)
        try:
            fake.requests.clear()
            one = await title_facts(server, db, "4635")
            _check_fields(one, "4635")
            assert _metadata_calls(fake.requests) == 1

            fake.requests.clear()
            two = await title_facts(server, db, "4635")
            assert two == one
            assert _metadata_calls(fake.requests) == 0

            fake.requests.clear()
            three = await title_facts(server, db, "4635", force=True)
            assert three == one
            assert _metadata_calls(fake.requests) == 1
        finally:
            await server.client.aclose()

    asyncio.run(run())


def test_overlay_facts_migration_on_fresh_db(tmp_path):
    from starr_studio.db import schema_version

    conn = open_database(tmp_path / "studio.db")
    names = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert "overlay_facts" in names
    assert schema_version(conn) == len(load_migrations())


def test_overlay_facts_migration_on_existing_chain(tmp_path):
    """Migration 0019 applies after 0018 (same as a running install)."""
    conn = connect(tmp_path / "studio.db")
    migrations = load_migrations()
    from starr_studio.db import apply_migrations, schema_version

    apply_migrations(conn, migrations[:18])
    assert "overlay_facts" not in {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    apply_migrations(conn, migrations)
    assert schema_version(conn) == len(migrations)
    assert "overlay_facts" in {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}


def test_stale_cache_json_refetch(db, overlay_server):
    db.execute(
        "INSERT INTO overlay_facts (rating_key, library_key, updated_at, facts, fetched_at) VALUES (?, ?, ?, ?, ?)",
        ("4635", "90", 1, '{"bad": true}', 1),
    )
    db.commit()
    fake = overlay_server

    async def run():
        server = await _server(fake)
        try:
            facts = await title_facts(server, db, "4635")
            _check_fields(facts, "4635")
        finally:
            await server.client.aclose()

    asyncio.run(run())


def test_plex_dts_names():
    from starr_studio.overlay_engine.facts_plex import _audio_codec_name

    assert _audio_codec_name("dca", "dts") == "DTS"  # Slumdog Millionaire on the maintainer's Plex
    assert _audio_codec_name("dca", "ma") == "DTS-HD MA"
    assert _audio_codec_name("dca", "hra") == "DTS-HD HRA"
    assert _audio_codec_name("dca-ma") == "DTS-HD MA"
