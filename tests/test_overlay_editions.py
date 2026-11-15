"""A title's edition: Plex's Edition field, else the file name, as Kometa's edition overlays find it."""

import pytest

from starr_studio.overlay_engine.editions import edition, edition_from
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
