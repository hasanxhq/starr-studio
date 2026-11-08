"""SQLite collection rows: shared title rules."""

from starr_studio import collections as col

from test_collections_db import db  # noqa: F401


def test_studio_title_owner_ignores_own_row(db):
    with db:
        [own_id] = col.mark_present(
            db,
            "Movies",
            [col.Pick(col.Ref("genre", "Genre", "Action"), "Action Movies", "Action Movies")],
        )
        col.mark_present(
            db,
            "Movies",
            [col.Pick(col.Ref("built", "", "x"), "Other", "Other")],
        )
    assert col.studio_title_owner(db, "Movies", "Action Movies", own_id) is None
    assert col.studio_title_owner(db, "Movies", "Other", None)["title"] == "Other"
