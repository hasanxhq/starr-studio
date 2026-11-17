"""A title's edition: Plex's Edition field, else the file name, as Kometa's edition overlays find it."""

from pathlib import Path

import pytest
from ruamel.yaml import YAML

from starr_studio.overlay_engine.editions import EDITIONS, edition, edition_from
from starr_studio.overlay_engine.facts_plex import facts_from_metadata


@pytest.mark.parametrize(
    "path, want",
    [
        ("/movies/Blade Runner (1982)/Blade Runner (1982) {edition-Final Cut} [Bluray-2160p].mkv", "Final Cut"),
        ("/movies/Aliens (1986) {edition-Special Edition}/Aliens.mkv", "Special Edition"),
        ("/movies/The Lord of the Rings (2002) {edition-Extended Edition}/LOTR.mkv", "Extended"),
        ("/movies/Apocalypse Now (1979) {edition-4K Redux}/x.mkv", None),  # not on Kometa's list
        ("/movies/Superman II (1980) Richard Donner Cut/x.mkv", None),  # as in Kometa: its word "Rich" never matches "Richard"
        ("/movies/Kingdom of Heaven (2005) Directors Cut/x.mkv", "Director's Cut"),
        ("/movies/Kingdom of Heaven (2005) directors cut/x.mkv", None),  # Kometa's original-naming regex is case-sensitive
        ("/movies/Dune (2021)/Dune (2021) IMAX WEB-DL.mkv", "IMAX"),
        ("/movies/Avatar (2009)/Avatar (2009) DSNP WEB-DL IMAX.mkv", "IMAX Enhanced"),
        ("/movies/Seven Samurai (1954) [CC]/x.mkv", "Criterion"),
        ("/movies/Zack Snyder's Justice League (2021) Open-Matte/x.mkv", "Open Matte"),
        ("/movies/Moonlight (2016)/Moonlight (2016) Bluray-1080p.mkv", None),
    ],
)
def test_editions_from_file_names(path, want):
    assert edition_from(None, [path]) == want


def test_the_heaviest_edition_wins_as_in_kometas_group():
    assert edition_from(None, ["/m/X (2001) {edition-Directors Cut Remastered}/x.mkv"]) == "Director's Cut"
    assert edition_from(None, ["/m/X (2001) {edition-Remastered}/x.mkv", "/m/X (2001) {edition-Extended}/x.mkv"]) == "Extended"


def test_plexs_edition_field_is_matched_like_kometas_edition_filter():
    part = {"Media": [{"Part": [{"file": "/m/X (2001) {edition-Remastered}/x.mkv"}]}]}
    assert edition({"editionTitle": "Extended Cut", **part}) == "Extended"  # field or path, heaviest wins
    assert edition({"editionTitle": "OG Theatrical 4 Hour Cut"}) == "Theatrical Cut"  # any case, anywhere in the field
    assert edition({"editionTitle": "Richard Donner Cut"}) == "Richard Donner"
    assert edition({"editionTitle": "Fan Cut"}) == "Fan Cut"  # on no list: the user's words
    assert edition(part) == "Remastered"
    assert edition({}) is None
    assert facts_from_metadata({"ratingKey": "1", "type": "movie", "editionTitle": "unrated"}).edition == "Unrated"


KOMETA_RESOLUTION = Path(__file__).resolve().parents[1] / "kometa" / "defaults" / "overlays" / "resolution.yml"


def _kometa_edition_rows() -> list[tuple[str, str, str | None]]:
    data = YAML(typ="safe").load(KOMETA_RESOLUTION.read_text(encoding="utf-8"))
    regex_by_key = {
        row["key"]: row["value"]
        for row in data["templates"]["edition"]["conditionals"]["regex"]["conditions"]
    }
    rows: list[tuple[int, str, str, str, str | None]] = []
    for overlay_name, block in data["overlays"].items():
        variables = block.get("variables") or {}
        if variables.get("type") != "edition":
            continue
        key = variables["key"]
        rows.append((int(variables["weight"]), overlay_name, key, variables["search"], regex_by_key.get(key)))
    rows.sort(key=lambda row: -row[0])
    return [
        (overlay_name.removesuffix("-Edition").removesuffix("-Cut"), key, search, extra)
        for _, overlay_name, key, search, extra in rows
    ]


@pytest.mark.skipif(not KOMETA_RESOLUTION.is_file(), reason="needs the reference clone of Kometa in kometa/")
def test_editions_match_kometa_resolution_yml():
    """Studio's edition list matches Kometa's resolution.yml overlay defaults (names, search words, regexes)."""
    kometa = _kometa_edition_rows()
    assert len(EDITIONS) == len(kometa)
    for (label, search, extra), (k_name, k_key, k_search, k_extra) in zip(EDITIONS, kometa, strict=True):
        assert search == k_search, (label, k_name)
        assert extra == k_extra, (label, k_key)
