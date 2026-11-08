"""Library build: ready-made picks and builder collections in one Kometa run (P3a)."""

from __future__ import annotations

from fakemaintainerr import FakeMaintainerr
from fakeplex import FakePlex

from starr_studio import collections as col
from test_builder_routes import body, make_client, wait_for_flags, wait_for_run
from test_ready_made_routes import root, wait_for_task  # noqa: F401


def test_save_without_build_writes_and_marks_changed(root):
    client, _, _ = make_client(root)
    with client:
        wait_for_flags(client)
        runs_before = len(client.get("/api/v1/runs").json()["runs"])
        saved = client.post("/api/v1/collections", json=body(build=False))
        assert saved.status_code == 201, saved.text
        row = saved.json()
        assert row["changed"] is True and row["run_id"] is None
        assert (root / "config" / "studio" / "Movies" / "built.yml").is_file()
        assert len(client.get("/api/v1/runs").json()["runs"]) == runs_before
        one = client.get(f"/api/v1/collections/{row['id']}").json()
        assert one["changed"] is True


def test_library_build_queues_one_run_for_builder_and_ready_made(root):
    client, _, _ = make_client(root)
    with client:
        wait_for_flags(client)
        a = client.post("/api/v1/collections", json=body(title="Alpha Picks", build=False)).json()
        b = client.post("/api/v1/collections", json=body(title="Beta Picks", build=False)).json()
        assert a["changed"] and b["changed"]
        result = client.post(
            "/api/v1/libraries/Movies/build",
            json={
                "ready_made": {"add": [{"category": "basic", "block": "", "key": "Newly Released"}], "remove": []},
                "collections": [a["id"], b["id"]],
            },
        ).json()
        assert result["run_id"] is not None
        names = {item["title"] for item in result["build"]}
        assert names == {"Newly Released", "Alpha Picks", "Beta Picks"}
        run = wait_for_run(client, result["run_id"])
        assert run["request"]["mode"] == "collections"
        assert run["request"]["libraries"] == ["Movies"]
        assert sorted(run["request"]["collections"]) == ["Alpha Picks", "Beta Picks", "Newly Released"]
        db = client.app.state.db
        for row_id in (a["id"], b["id"]):
            row = col.built_row(db, row_id)
            assert row["last_run_id"] == result["run_id"]
        rm = col.rows(db, "Movies", "basic")[0]
        assert rm["last_run_id"] == result["run_id"]


def test_blocked_title_is_left_out_of_the_run(root):
    plex = FakePlex()
    plex.add_collection("1", "Newly Released", labels=[], items=1)
    client, _, _ = make_client(root, plex)
    with client:
        wait_for_flags(client)
        ok = client.post("/api/v1/collections", json=body(title="Fine One", build=False)).json()
        plan = client.post(
            "/api/v1/libraries/Movies/build",
            json={
                "ready_made": {"add": [{"category": "basic", "block": "", "key": "Newly Released"}], "remove": []},
                "collections": [ok["id"]],
                "dry_run": True,
            },
        ).json()
        assert any(b["title"] == "Newly Released" for b in plan["blocked"])
        blocked = client.post(
            "/api/v1/libraries/Movies/build",
            json={
                "ready_made": {"add": [{"category": "basic", "block": "", "key": "Newly Released"}], "remove": []},
                "collections": [ok["id"]],
            },
        ).json()
        assert blocked["run_id"] is not None
        titles = {item["title"] for item in blocked["build"]}
        assert titles == {"Fine One"}
        assert any(b["title"] == "Newly Released" for b in blocked["blocked"])
        run = wait_for_run(client, blocked["run_id"])
        assert run["request"]["collections"] == ["Fine One"]


def test_maintainerr_and_unlabelled_removals_are_protected(root):
    from fakemaintainerr import MAINTAINERR_URL

    plex = FakePlex()
    plex.add_collection("1", "Hand Made Twin", labels=[], items=1)
    maintainerr = FakeMaintainerr()
    client, plex, maintainerr = make_client(root, plex, maintainerr)
    with client:
        wait_for_flags(client)
        assert client.put("/api/v1/settings/maintainerr", json={"url": MAINTAINERR_URL, "leave_overlays_alone": False}).status_code == 200

        db = client.app.state.db
        with db:
            ids = col.mark_present(
                db,
                "Movies",
                [
                    col.Pick(col.Ref("basic", "", "Studio Chart"), "Studio Chart", "Studio Chart"),
                    col.Pick(col.Ref("basic", "", "Spy Kids"), "Spy Kids", "Spy Kids"),
                    col.Pick(col.Ref("basic", "", "Hand Made Twin"), "Hand Made Twin", "Hand Made Twin"),
                ],
            )

        result = client.post(
            "/api/v1/libraries/Movies/build",
            json={
                "ready_made": {
                    "add": [],
                    "remove": [
                        {"category": "basic", "block": "", "key": "Studio Chart"},
                        {"category": "basic", "block": "", "key": "Spy Kids"},
                        {"category": "basic", "block": "", "key": "Hand Made Twin"},
                    ],
                },
                "collections": [],
            },
        ).json()
        assert result["run_id"] is None
        assert "104" in plex.deletions
        assert "102" not in plex.deletions
        twin_key = next(c["ratingKey"] for c in plex.COLLECTIONS["1"] if c["title"] == "Hand Made Twin")
        assert twin_key not in plex.deletions
        blocked_titles = {b["title"] for b in result["blocked"]}
        assert "Hand Made Twin" in blocked_titles and "Spy Kids" in blocked_titles
        assert "Hand Made Twin" not in {r["title"] for r in result["remove"]}
        remaining = {r["key"]: r["desired"] for r in col.rows(db, "Movies")}
        assert "Studio Chart" not in remaining
        assert remaining["Spy Kids"] == 0 and remaining["Hand Made Twin"] == 0


def test_dry_run_writes_nothing(root):
    client, plex, _ = make_client(root)
    with client:
        wait_for_flags(client)
        before = list((root / "config").rglob("*.yml"))
        saved = client.post(
            "/api/v1/libraries/Movies/build",
            json={
                "ready_made": {"add": [{"category": "basic", "block": "", "key": "Newly Released"}], "remove": []},
                "collections": [],
                "dry_run": True,
            },
        ).json()
        assert saved["build"] and "run_id" not in saved
        assert col.rows(client.app.state.db, "Movies") == []
        assert list((root / "config").rglob("*.yml")) == before
        assert client.get("/api/v1/runs").json()["runs"] == []


def test_changed_clears_after_run_end(root):
    import asyncio

    from starr_studio.kometa_command import RunRequest
    from starr_studio.ready_made_runs import ReadyMadeRecorder

    client, plex, _ = make_client(root)
    with client:
        wait_for_flags(client)
        built = client.post("/api/v1/collections", json=body(build=False)).json()
        assert built["changed"]
        db = client.app.state.db
        with db:
            col.set_run(db, [built["id"]], 9)
            db.execute(
                "INSERT INTO runs (id, request, status, trigger, queued_at, started_at) VALUES (9, ?, 'running', 'build', '2026-11-03T00:00:00Z', '2026-11-03T00:00:01Z')",
                (RunRequest(mode="collections", libraries=["Movies"], collections=[built["title"]]).model_dump_json(),),
            )
        plex.add_collection("1", built["title"], labels=["Studio"], items=3)

        class Runner:
            current_run_id = 9

        recorder = ReadyMadeRecorder(db, Runner(), client.app.state.settings, client.app.state.http, client.app.state.tasks)

        async def finish():
            with db:
                db.execute("INSERT INTO run_events (run_id, event, payload) VALUES (9, 'run_end', '{}')")
            after = await recorder.before_run(
                RunRequest(mode="collections", libraries=["Movies"], collections=[built["title"]]),
                lambda _: None,
            )
            assert after is not None
            await after()

        asyncio.run(finish())
        row = col.built_row(db, built["id"])
        assert row["changed_at"] is None


def test_refused_build_restores_builder_definition(root):
    broken = root / "kometa" / "defaults" / "chart" / "broken.yml"
    broken.write_text(
        "#####\n# Broken #\n#####\n\ncollections:\n  Broken Pick:\n    tmdb_movie: BROKEN\n"
    )
    client, _, _ = make_client(root)
    with client:
        wait_for_flags(client)
        saved = client.post("/api/v1/collections", json=body(title="Keeps Definition", build=False)).json()
        before = col.built_row(client.app.state.db, saved["id"])["definition"]
        response = client.post(
            "/api/v1/libraries/Movies/build",
            json={
                "ready_made": {"add": [{"category": "broken", "block": "", "key": "Broken Pick"}], "remove": []},
                "collections": [saved["id"]],
            },
        )
        assert response.status_code == 422
        row = col.built_row(client.app.state.db, saved["id"])
        assert row["definition"] == before


def test_removal_plex_refuses_is_blocked_not_removed(root, monkeypatch):
    from starr_studio.plex_library import PlexServer, PlexUnavailable

    async def refuse(self, rating_key):
        raise PlexUnavailable("Plex timed out")

    monkeypatch.setattr(PlexServer, "delete_collection", refuse)
    client, _, _ = make_client(root)
    with client:
        wait_for_flags(client)
        db = client.app.state.db
        with db:
            col.mark_present(db, "Movies", [col.Pick(col.Ref("basic", "", "Studio Chart"), "Studio Chart", "Studio Chart")])
        result = client.post(
            "/api/v1/libraries/Movies/build",
            json={"ready_made": {"add": [], "remove": [{"category": "basic", "block": "", "key": "Studio Chart"}]}, "collections": []},
        ).json()
        assert result["remove"] == []
        assert [b["title"] for b in result["blocked"]] == ["Studio Chart"]
        assert col.rows(db, "Movies", "basic")
