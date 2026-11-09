"""The collection builder in a music library: artist, album and track collections from Plex filters, and square art (music plan)."""

from __future__ import annotations

import pytest
from ruamel.yaml import YAML

from fakeplex import FakePlex
from starr_studio.ready_made_routes import _library_types
from test_builder_routes import body
from test_ready_made_routes import make_client, wait_for_flags, wait_for_run
from test_ready_made_routes import root as movie_root  # noqa: F401 (a fixture)

ROCK = {"match": "all", "rules": [{"field": "album_genre", "modifier": "", "value": ["Rock"]}]}


@pytest.fixture
def root(movie_root):  # noqa: F811
    config = movie_root / "config" / "config.yml"
    config.write_text(config.read_text().replace("libraries:\n  Movies: {}\n", "libraries:\n  Movies: {}\n  Music: {}\n"))
    return movie_root


@pytest.fixture
def plex():
    fake = FakePlex()
    fake.add_music_section("3", "Music")
    fake.TAGS["3"] = {"genre": [{"key": "77", "title": "Rock"}]}
    _library_types._key = None  # the process-wide cache of Plex library types must see the music section, and forget it after
    yield fake
    _library_types._key = None


def music(title: str = "Rock Albums", **extra) -> dict:
    return body(title, ROCK, library="Music", **extra)


def built_music(root) -> dict:
    return YAML(typ="safe").load((root / "config" / "studio" / "Music" / "built.yml").read_text())["collections"]


def test_fields_offer_music_rules_and_both_levels(root, plex):
    with make_client(root, plex)[0] as client:
        fields = client.get("/api/v1/builder/fields", params={"library": "Music"}).json()
        client.get("/api/v1/builder/values", params={"library": "Music", "field": "album_genre"})
    assert fields["library_type"] == "artist"
    assert {"artist_genre", "album_genre", "track_plays"} <= {f["key"] for f in fields["fields"]}
    assert "resolution" not in {f["key"] for f in fields["fields"]}
    levels = {level["key"]: [s["key"] for s in level["sorts"]] for level in fields["levels"]}
    assert "album_artist.asc" in levels["album"] and "album_artist.asc" not in levels["artist"]
    asked = next(r for r in reversed(plex.requests) if r.url.path == "/library/sections/3/genre")
    assert asked.url.params["type"] == "9"  # album genres, not artist ones


def test_movie_fields_have_no_levels(root, plex):
    with make_client(root, plex)[0] as client:
        assert "levels" not in client.get("/api/v1/builder/fields", params={"library": "Movies"}).json()


def test_album_preview_asks_plex_for_albums_and_names_their_artist(root, plex):
    with make_client(root, plex)[0] as client:
        preview = client.post("/api/v1/builder/preview", json={"library": "Music", "filters": ROCK, "level": "album", "sort_by": "year.desc"}).json()
    assert preview["problems"] == [] and preview["count"] == 3
    assert preview["items"][0]["artist"] == "Radiohead"
    asked = next(r for r in reversed(plex.requests) if r.url.path == "/library/sections/3/all")
    assert asked.url.params["type"] == "9" and asked.url.params["album.genre"] == "77"


def test_an_artist_collection_is_a_smart_filter_without_arr_keys(root, plex):
    client, _, _ = make_client(root, plex)
    with client:
        wait_for_flags(client)
        made = client.post("/api/v1/collections", json=music("Rock Artists", build=False))
        assert made.status_code == 201, made.text
        assert made.json()["level"] is None
    collection = built_music(root)["Rock Artists"]
    assert collection["smart_filter"] == {"all": {"album_genre": ["Rock"]}}
    assert collection["minimum_items"] == 2
    assert not {"radarr_add_missing", "sonarr_add_missing", "builder_level"} & set(collection)


def test_an_album_collection_is_a_plex_search_at_album_level(root, plex):
    client, _, _ = make_client(root, plex)
    with client:
        wait_for_flags(client)
        made = client.post("/api/v1/collections", json=music(level="album", sort_by="year.desc", limit=10, build=False))
        assert made.status_code == 201, made.text
        assert made.json()["level"] == "album"
    collection = built_music(root)["Rock Albums"]
    assert collection["plex_search"] == {"all": {"album_genre": ["Rock"]}, "sort_by": "year.desc", "limit": 10}
    assert (collection["builder_level"], collection["sync_mode"], collection["collection_order"]) == ("album", "sync", "custom")
    assert "smart_filter" not in collection and "minimum_items" not in collection  # Kometa refuses minimum_items on albums
    assert not {"radarr_add_missing", "sonarr_add_missing"} & set(collection)


def test_music_refuses_lists_requests_and_movie_rules(root, plex):
    with make_client(root, plex)[0] as client:
        wait_for_flags(client)
        listed = client.post("/api/v1/collections", json=music(sources=[{"kind": "list", "builder": "tmdb_collection", "value": "10"}]))
        download = client.post("/api/v1/collections", json=music(download_missing=True))
        movie_rule = client.post("/api/v1/collections", json=body("Big", {"match": "all", "rules": [{"field": "resolution", "value": ["4k"]}]}, library="Music"))
        album_sort_on_artists = client.post("/api/v1/collections", json=music(sort_by="album_artist.asc"))
        level_on_movies = client.post("/api/v1/collections", json=body(level="album"))
    for response in (listed, download, movie_rule, album_sort_on_artists, level_on_movies):
        assert response.status_code == 422, response.text
    assert "Kometa has no lists for music" in listed.text
    assert "can't request music" in download.text
    assert "artists, albums and tracks" in level_on_movies.text


def test_track_level_has_its_own_sorts_and_preview(root, plex):
    with make_client(root, plex)[0] as client:
        fields = client.get("/api/v1/builder/fields", params={"library": "Music"}).json()
        preview = client.post("/api/v1/builder/preview", json={"library": "Music", "filters": ROCK, "level": "track", "sort_by": "duration.desc"}).json()
    tracks = next(level for level in fields["levels"] if level["key"] == "track")
    assert tracks["label"] == "Tracks" and "duration.desc" in [s["key"] for s in tracks["sorts"]]
    assert preview["problems"] == [] and preview["count"] == 4
    assert (preview["items"][0]["artist"], preview["items"][0]["album"]) == ("Radiohead", "OK Computer")
    asked = next(r for r in reversed(plex.requests) if r.url.path == "/library/sections/3/all")
    assert asked.url.params["type"] == "10" and asked.url.params["sort"] == "duration:desc"


def test_a_track_collection_with_square_art(root, plex):
    client, _, _ = make_client(root, plex)
    art = {"kind": "url", "url": "https://example.com/square.png"}
    with client:
        wait_for_flags(client)
        made = client.post("/api/v1/collections", json=music("Rock Tracks", level="track", square_art=art, build=False))
        assert made.status_code == 201, made.text
        assert (made.json()["level"], made.json()["square_art"]) == ("track", art)
        on_movies = client.post("/api/v1/collections", json=body(square_art=art))
    collection = built_music(root)["Rock Tracks"]
    assert (collection["builder_level"], collection["url_square_art"]) == ("track", art["url"])
    assert "smart_filter" not in collection and "minimum_items" not in collection
    assert on_movies.status_code == 422 and "square art" in on_movies.text


def test_a_run_puts_a_music_librarys_built_file_back(root, plex):
    # Fully managed: a hand edit to a music library's built.yml is undone before Kometa runs, as for movies and shows.
    client, _, _ = make_client(root, plex)
    with client:
        wait_for_flags(client)
        assert client.post("/api/v1/collections", json=music("Rock Artists", build=False)).status_code == 201
        built = root / "config" / "studio" / "Music" / "built.yml"
        original = built.read_text()
        built.write_text(original + "# changed by hand\n")
        run = wait_for_run(client, client.post("/api/v1/runs", json={"mode": "operations"}).json()["id"])
        assert built.read_text() == original
        assert "studio/Music/built.yml had been changed by hand" in client.get(f"/api/v1/runs/{run['id']}/log").text
