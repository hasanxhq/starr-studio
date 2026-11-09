"""PlexServer reads music libraries: artists, albums and their tags (Phase 1 of docs/plans/music-library.md)."""

import asyncio

import httpx
import pytest
from fakeplex import REMOTE_URI, SERVER_TOKEN, FakePlex

from starr_studio.plex_library import PlexServer


@pytest.fixture
def plex() -> FakePlex:
    fake = FakePlex()
    fake.add_music_section()
    return fake


def _run(fake: FakePlex, check) -> None:
    async def go():
        async with httpx.AsyncClient(transport=fake.transport()) as client:
            await check(PlexServer(client, REMOTE_URI, SERVER_TOKEN))

    asyncio.run(go())


def _last(fake: FakePlex, path: str) -> httpx.Request:
    return next(r for r in reversed(fake.requests) if r.url.path == path)


def test_size_counts_artists_and_skips_photos(plex: FakePlex):
    async def check(server: PlexServer):
        assert await server.size("3", "artist") == 2
        assert _last(plex, "/library/sections/3/all").url.params["type"] == "8"
        assert await server.size("3", "photo") is None

    _run(plex, check)


def test_added_since_counts_albums(plex: FakePlex):
    plex.added["3"] = [100, 200, 300]

    async def check(server: PlexServer):
        assert await server.added_since("3", "artist", 200) == 2
        assert _last(plex, "/library/sections/3/all").url.params["type"] == "9"

    _run(plex, check)


def test_all_items_reads_artists_and_albums(plex: FakePlex):
    async def check(server: PlexServer):
        artists = await server.all_items("3", "artist")
        albums = await server.all_items("3", "album")
        assert await server.all_items("3", "photo") == []
        assert [a.title for a in artists] == ["Radiohead", "Björk"]
        assert all(a.artist is None for a in artists)
        assert [(a.title, a.artist) for a in albums] == [("OK Computer", "Radiohead"), ("Kid A", "Radiohead"), ("Homogenic", "Björk")]

    _run(plex, check)


def test_library_items_pages_artists(plex: FakePlex):
    async def check(server: PlexServer):
        items, total = await server.library_items("3", "artist", 0, 1)
        assert (total, [i.title for i in items]) == (2, ["Radiohead"])

    _run(plex, check)


def test_tag_values_read_the_music_level(plex: FakePlex):
    async def check(server: PlexServer):
        await server.tag_values("1", "genre", "album")
        assert _last(plex, "/library/sections/1/genre").url.params["type"] == "9"
        await server.tag_values("1", "genre", "track")
        assert _last(plex, "/library/sections/1/genre").url.params["type"] == "10"
        await server.tag_values("1", "genre", "movie")
        assert "type" not in _last(plex, "/library/sections/1/genre").url.params

    _run(plex, check)


def test_count_where_sends_the_artist_type(plex: FakePlex):
    async def check(server: PlexServer):
        await server.count_where("3", "artist", {"genre": "1"})
        assert _last(plex, "/library/sections/3/all").url.params["type"] == "8"

    _run(plex, check)
