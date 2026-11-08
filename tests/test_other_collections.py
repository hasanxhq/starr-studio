"""Tests for GET /api/v1/libraries/{library}/other-collections."""

from __future__ import annotations

import json
from pathlib import Path

from fakeplex import FakePlex
from starr_studio import collections as col
from starr_studio.maintainerr import OwnedCollection
from test_ready_made_routes import make_client, root  # noqa: F401 (root is a fixture)


def test_built_collection_in_plex_is_left_out(root):
    client, plex, _ = make_client(root)
    with client:
        db = client.app.state.db
        plex.COLLECTIONS["1"] = []

        # 1a. Matched by rating key
        key1 = plex.add_collection("1", "Built Collection In Plex", items=10)
        row1_id = col.insert_built(db, "Movies", "key1", "Built One", {"filters": {"match": "all", "rules": []}})
        col.record_plex_state(db, row1_id, exists=True, rating_key=key1, items=10, thumb=None, built=True, error=None)

        # 1b. Matched by title when rating key is not recorded
        plex.add_collection("1", "Built By Title", items=5)
        col.insert_built(db, "Movies", "key2", "built by title", {"filters": {"match": "all", "rules": []}})

        # Add a normal plex collection to ensure others isn't just empty
        plex.add_collection("1", "Regular Movie Collection", items=2)

        resp = client.get("/api/v1/libraries/Movies/other-collections")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["plex_error"] is None
        titles = [c["title"] for c in data["others"]]
        assert "Built Collection In Plex" not in titles
        assert "Built By Title" not in titles
        assert "built by title" not in titles
        assert titles == ["Regular Movie Collection"]


def test_ready_made_row_in_plex_shows_once_with_category_and_rating_key(root):
    client, plex, _ = make_client(root)
    with client:
        db = client.app.state.db
        plex.COLLECTIONS["1"] = []

        # Ready-made in DB and in Plex
        key = plex.add_collection(
            "1",
            "Marvel Cinematic Universe",
            labels=["Studio"],
            items=23,
            thumb="/library/collections/201/thumb/1700000000",
        )
        row_id = col.mark_present(
            db,
            "Movies",
            [col.Pick(col.Ref("franchise", "Marvel", "mcu"), "Marvel", "Marvel Cinematic Universe")],
        )[0]
        col.record_plex_state(
            db,
            row_id,
            exists=True,
            rating_key=key,
            items=23,
            thumb="/library/collections/201/thumb/1700000000",
            built=False,
            error=None,
        )

        resp = client.get("/api/v1/libraries/Movies/other-collections")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["plex_error"] is None
        assert len(data["others"]) == 1
        item = data["others"][0]
        assert item == {
            "made_by": "ready_made",
            "title": "Marvel Cinematic Universe",
            "rating_key": key,
            "items": 23,
            "thumb": "/library/collections/201/thumb/1700000000",
            "smart": False,
            "category": "franchise",
            "last_change": None,
        }


def test_picked_ready_made_not_yet_in_plex_shows_with_rating_key_null(root):
    client, plex, _ = make_client(root)
    with client:
        db = client.app.state.db
        plex.COLLECTIONS["1"] = []

        # Picked (desired=1) but not in Plex (plex_exists=0, plex_rating_key=None)
        col.mark_present(
            db,
            "Movies",
            [col.Pick(col.Ref("oscars", "", "best_picture"), "Best Picture", "Oscar Best Picture")],
        )

        resp = client.get("/api/v1/libraries/Movies/other-collections")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["plex_error"] is None
        assert len(data["others"]) == 1
        assert data["others"][0] == {
            "made_by": "ready_made",
            "title": "Oscar Best Picture",
            "rating_key": None,
            "items": None,
            "thumb": None,
            "smart": False,
            "category": "oscars",
            "last_change": None,
        }


def test_kometa_and_plex_unlabelled_collections(root):
    client, plex, _ = make_client(root)
    with client:
        plex.COLLECTIONS["1"] = []

        # Kometa labelled collection with no row
        key_k = plex.add_collection("1", "Kometa Top 250", labels=["Kometa"], items=250)
        # Unlabelled collection made in Plex
        key_p = plex.add_collection("1", "Handmade Favorites", labels=[], items=12)

        resp = client.get("/api/v1/libraries/Movies/other-collections")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["plex_error"] is None

        by_title = {c["title"]: c for c in data["others"]}
        assert by_title["Kometa Top 250"] == {
            "made_by": "kometa",
            "title": "Kometa Top 250",
            "rating_key": key_k,
            "items": 250,
            "thumb": None,
            "smart": False,
            "category": None,
            "last_change": None,
        }
        assert by_title["Handmade Favorites"] == {
            "made_by": "plex",
            "title": "Handmade Favorites",
            "rating_key": key_p,
            "items": 12,
            "thumb": None,
            "smart": False,
            "category": None,
            "last_change": None,
        }


def test_maintainerr_collection_wins_over_kometa_label(root):
    client, plex, _ = make_client(root)
    with client:
        plex.COLLECTIONS["1"] = []

        # Collection in Plex with Kometa label
        key = plex.add_collection("1", "Leaving Soon", labels=["Kometa"], items=8)

        # But Maintainerr owns this rating key
        client.app.state.maintainerr.snapshot.collections = [
            OwnedCollection(id=1, title="Leaving Soon", library_key="1", rating_key=key, active=True, overlays=False)
        ]

        resp = client.get("/api/v1/libraries/Movies/other-collections")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert len(data["others"]) == 1
        assert data["others"][0] == {
            "made_by": "maintainerr",
            "title": "Leaving Soon",
            "rating_key": key,
            "items": 8,
            "thumb": None,
            "smart": False,
            "category": None,
            "last_change": None,
        }


def test_sorting_by_title_casefold(root):
    client, plex, _ = make_client(root)
    with client:
        db = client.app.state.db
        plex.COLLECTIONS["1"] = []

        # Add collections with mixed casing across types
        plex.add_collection("1", "beta collection", labels=[])
        plex.add_collection("1", "Alpha collection", labels=["Kometa"])
        col.mark_present(
            db,
            "Movies",
            [col.Pick(col.Ref("genre", "Genre", "Action"), "Genre", "delta genre")],
        )
        plex.add_collection("1", "Charlie collection", labels=[])

        resp = client.get("/api/v1/libraries/Movies/other-collections")
        assert resp.status_code == 200, resp.text
        titles = [c["title"] for c in resp.json()["others"]]
        assert titles == ["Alpha collection", "beta collection", "Charlie collection", "delta genre"]


def test_plex_unreachable_returns_200_with_ready_made_rows_and_plex_error(root):
    client, plex, _ = make_client(root)
    with client:
        db = client.app.state.db
        col.mark_present(
            db,
            "Movies",
            [
                col.Pick(col.Ref("genre", "Genre", "Action"), "Genre", "Action Movies"),
                col.Pick(col.Ref("decade", "Decade", "1990"), "Decade", "1990s"),
            ],
        )

        # Plex is disconnected/unreachable
        plex.reachable.clear()

        resp = client.get("/api/v1/libraries/Movies/other-collections")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["plex_error"] is not None
        assert "Plex can't be reached" in data["plex_error"]
        titles = [c["title"] for c in data["others"]]
        assert titles == ["1990s", "Action Movies"]
        for c in data["others"]:
            assert c["made_by"] == "ready_made"


def test_plex_not_connected_returns_200_with_plex_error(root):
    # Remove plex: config from config.yml
    config_file = root / "config" / "config.yml"
    config_file.write_text("libraries:\n  Movies: {}\n")

    client, _, _ = make_client(root)
    with client:
        db = client.app.state.db
        col.mark_present(
            db,
            "Movies",
            [col.Pick(col.Ref("genre", "Genre", "Sci-Fi"), "Genre", "Sci-Fi Movies")],
        )

        resp = client.get("/api/v1/libraries/Movies/other-collections")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["plex_error"] == "Kometa isn't connected to Plex yet"
        assert len(data["others"]) == 1
        assert data["others"][0]["title"] == "Sci-Fi Movies"
        assert data["others"][0]["made_by"] == "ready_made"


def test_plex_missing_library_returns_200_with_plex_error(root):
    # config.yml has Movies and TV Shows
    config_file = root / "config" / "config.yml"
    config_file.write_text(
        f"plex:\n  url: https://203-0-113-7.abc123.plex.direct:32400\n  token: srv-token\n"
        "libraries:\n  Movies: {}\n  OtherLib: {}\n"
    )

    client, plex, _ = make_client(root)
    with client:
        # Plex has no section for OtherLib
        resp = client.get("/api/v1/libraries/OtherLib/other-collections")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["plex_error"] == "Plex has no library called 'OtherLib'"
        assert data["others"] == []


def test_unknown_config_library_returns_404(root):
    client, _, _ = make_client(root)
    with client:
        resp = client.get("/api/v1/libraries/UnknownLibrary/other-collections")
        assert resp.status_code == 404, resp.text


def test_ready_made_matched_by_title_casefold(root):
    client, plex, _ = make_client(root)
    with client:
        db = client.app.state.db
        plex.COLLECTIONS["1"] = []

        # Ready-made in DB with title "Action Movies", but rating_key not yet set
        col.mark_present(
            db,
            "Movies",
            [col.Pick(col.Ref("genre", "Genre", "Action"), "Genre", "Action Movies")],
        )

        # In Plex, collection exists with "action movies"
        key = plex.add_collection("1", "action movies", items=15, thumb="/library/collections/202/thumb/1700000000")

        resp = client.get("/api/v1/libraries/Movies/other-collections")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert len(data["others"]) == 1
        assert data["others"][0] == {
            "made_by": "ready_made",
            "title": "action movies",
            "rating_key": key,
            "items": 15,
            "thumb": "/library/collections/202/thumb/1700000000",
            "smart": False,
            "category": "genre",
            "last_change": None,
        }


def test_smart_collection_flag_from_plex(root):
    client, plex, _ = make_client(root)
    with client:
        plex.COLLECTIONS["1"] = []

        # In FakePlex, collection with smart=1
        key = plex.add_collection("1", "PMM Smart Collection", labels=["PMM"], items=4)
        for c in plex.COLLECTIONS["1"]:
            if c["ratingKey"] == key:
                c["smart"] = "1"

        resp = client.get("/api/v1/libraries/Movies/other-collections")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert len(data["others"]) == 1
        assert data["others"][0]["smart"] is True
        assert data["others"][0]["made_by"] == "kometa"


def test_plex_unreachable_preserves_stored_state_for_existing_row(root):
    client, plex, _ = make_client(root)
    with client:
        db = client.app.state.db
        row_id = col.mark_present(
            db,
            "Movies",
            [col.Pick(col.Ref("genre", "Genre", "Drama"), "Genre", "Drama Movies")],
        )[0]
        col.record_plex_state(
            db,
            row_id,
            exists=True,
            rating_key="888",
            items=42,
            thumb="/thumb/drama",
            built=False,
            error=None,
        )

        # Plex is disconnected/unreachable
        plex.reachable.clear()

        resp = client.get("/api/v1/libraries/Movies/other-collections")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["plex_error"] is not None
        assert len(data["others"]) == 1
        assert data["others"][0] == {
            "made_by": "ready_made",
            "title": "Drama Movies",
            "rating_key": "888",
            "items": 42,
            "thumb": "/thumb/drama",
            "smart": False,
            "category": "genre",
            "last_change": None,
        }


def test_other_collections_last_change_on_ready_made_and_none_on_plex(root):
    client, plex, _ = make_client(root)
    with client:
        db = client.app.state.db
        plex.COLLECTIONS["1"] = []

        # 1. Ready-made pick with a run and changes event
        row_id = col.mark_present(
            db,
            "Movies",
            [col.Pick(col.Ref("franchise", "Marvel", "mcu"), "Marvel", "Marvel Cinematic Universe")],
        )[0]
        col.set_run(db, [row_id], 1)
        with db:
            db.execute("INSERT INTO runs (id, request) VALUES (1, '{}')")
            db.execute(
                "INSERT INTO run_events (run_id, event, payload) VALUES (1, 'changes', ?)",
                (json.dumps({"collection": "Marvel Cinematic Universe", "additions": [{"title": "Iron Man"}], "removals": []}),),
            )

        # 2. Plain Plex collection (no Studio label, not in db)
        plex.add_collection("1", "Family Favorites", labels=[], items=10)

        resp = client.get("/api/v1/libraries/Movies/other-collections")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        by_title = {c["title"]: c for c in data["others"]}
        assert by_title["Marvel Cinematic Universe"]["made_by"] == "ready_made"
        assert by_title["Marvel Cinematic Universe"]["last_change"] == {"added": 1, "removed": 0, "run_id": 1}
        assert by_title["Family Favorites"]["made_by"] == "plex"
        assert by_title["Family Favorites"]["last_change"] is None


