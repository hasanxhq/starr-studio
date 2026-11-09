"""Tests for music-library smart filters (library type ``artist``)."""

import pytest

from starr_studio.smart_filters import (
    ALBUM_SORTS,
    ARTIST_SORTS,
    SmartFilterError,
    fields,
    plex_query,
    sorts,
    validate,
    validate_search,
)


def test_fields_artist_covers_music_attributes():
    by_key = {f.key: f for f in fields("artist")}

    assert by_key["artist_genre"].kind == "tag"
    assert by_key["artist_genre"].plex_tag == "genre"
    assert by_key["artist_genre"].level == "artist"
    assert by_key["artist_genre"].group == "Artist"

    assert by_key["album_year"].kind == "year"
    assert by_key["album_year"].level == "album"
    assert by_key["album_decade"].modifiers == (("", "is"),)

    assert by_key["album_record_label"].kind == "string"
    assert by_key["album_genre"].plex_tag == "genre"
    assert by_key["album_genre"].level == "album"

    assert by_key["track_plays"].kind == "number"
    assert by_key["track_mood"].plex_tag == "mood"
    assert by_key["track_mood"].level == "track"

    required = (
        "artist_title",
        "artist_genre",
        "artist_mood",
        "artist_style",
        "artist_country",
        "artist_collection",
        "artist_label",
        "artist_user_rating",
        "artist_added",
        "artist_last_played",
        "album_title",
        "album_year",
        "album_decade",
        "album_genre",
        "album_mood",
        "album_style",
        "album_record_label",
        "album_collection",
        "album_label",
        "album_user_rating",
        "album_critic_rating",
        "album_plays",
        "album_added",
        "album_released",
        "album_last_played",
        "track_title",
        "track_mood",
        "track_plays",
        "track_skips",
        "track_user_rating",
        "track_added",
        "track_last_played",
    )
    for key in required:
        assert key in by_key


def test_fields_artist_group_order():
    keys = [f.key for f in fields("artist")]
    assert keys.index("artist_title") < keys.index("album_title") < keys.index("track_title")
    assert keys[:3] == ["artist_title", "artist_genre", "artist_mood"]


def test_sorts_artist_and_album():
    artist_keys = [k for k, _ in sorts("artist")]
    assert artist_keys == list(ARTIST_SORTS)
    assert dict(sorts("artist"))["played.asc"] == "Date played (oldest first)"

    album_keys = [k for k, _ in sorts("artist", "album")]
    assert album_keys == list(ALBUM_SORTS)
    assert dict(sorts("artist", "album"))["album_artist.asc"] == "Artist (A–Z)"


def test_validate_rejects_movie_field_in_music():
    spec = {"match": "all", "rules": [{"field": "resolution", "modifier": "", "value": "1080"}]}
    problems = validate("artist", spec)
    assert any("doesn't work in music libraries" in p for p in problems)


def test_validate_rejects_music_field_in_movie():
    spec = {"match": "all", "rules": [{"field": "album_genre", "modifier": "", "value": "Rock"}]}
    problems = validate("movie", spec)
    assert any("only works in music libraries" in p for p in problems)


def test_validate_accepts_music_spec():
    spec = {
        "match": "all",
        "rules": [
            {"field": "album_genre", "modifier": "", "value": "Rock"},
            {"field": "album_year", "modifier": "gte", "value": 1990},
        ],
    }
    assert validate("artist", spec) == []


def test_validate_level_restrictions():
    spec = {"match": "all", "rules": [{"field": "artist_title", "modifier": "", "value": "Beatles"}]}
    assert any("Collection level is not used" in p for p in validate("movie", spec, level="album"))
    assert any("Unknown collection level" in p for p in validate("artist", spec, level="track"))

    assert validate("artist", spec, sort_by="year.asc", level="album") == []
    bad_sort = validate("artist", spec, sort_by="bitrate.asc", level="album")
    assert any("Unknown sort" in p for p in bad_sort)


def test_validate_search_delegates():
    spec = {"match": "all", "rules": [{"field": "genre", "modifier": "", "value": "Pop"}]}
    assert any("Plex search:" in p for p in validate_search("artist", spec))


class MusicTagStub:
    calls: list[tuple[str, str, str]] = []

    async def tag_values(self, library_key: str, tag: str, library_type: str = "", episode: bool = False):
        MusicTagStub.calls.append((library_key, tag, library_type))
        if tag == "genre" and library_type == "album":
            return [("Rock", "rock-key")]
        return []


@pytest.mark.anyio
async def test_plex_query_artist_type_and_album_level():
    stub = MusicTagStub()
    MusicTagStub.calls = []

    spec = {
        "match": "all",
        "rules": [{"field": "artist_title", "modifier": "begins", "value": "Miles"}],
    }
    params = await plex_query(stub, "5", "artist", spec)
    assert params[0] == ("type", "8")
    assert params[1] == ("sort", "titleSort")
    assert ("artist.title<", "Miles") in params

    album_spec = {
        "match": "all",
        "rules": [{"field": "album_genre", "modifier": "", "value": "Rock"}],
    }
    params_album = await plex_query(stub, "5", "artist", album_spec, sort_by="year.desc", level="album")
    assert params_album[0] == ("type", "9")
    assert params_album[1] == ("sort", "year:desc")
    assert ("album.genre", "rock-key") in params_album
    assert MusicTagStub.calls == [("5", "genre", "album")]


@pytest.mark.anyio
async def test_plex_query_unknown_tag_raises():
    stub = MusicTagStub()
    spec = {
        "match": "all",
        "rules": [{"field": "album_genre", "modifier": "", "value": "Missing"}],
    }
    with pytest.raises(SmartFilterError, match="not found"):
        await plex_query(stub, "5", "artist", spec, level="album")
