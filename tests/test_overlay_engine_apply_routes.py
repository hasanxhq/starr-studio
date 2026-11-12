"""POST /api/v1/overlay-engine/apply and /restore, GET /titles (Phase 2 routes)."""

import time
from dataclasses import dataclass

from fakeplex import FakePlex

from starr_studio.maintainerr import OwnedCollection

from starr_studio.overlay_engine.apply import Context, Outcome

from tests.test_overlays import make_client

APPLY = "/api/v1/overlay-engine/apply"
RESTORE = "/api/v1/overlay-engine/restore"
TITLES = "/api/v1/overlay-engine/titles"


@dataclass
class Captured:
    ctx: Context | None = None
    rating_keys: list[str] | None = None
    style_name: str | None = None
    values: dict | None = None
    excluded: set[str] | None = None
    dry_run: bool | None = None
    force: bool | None = None


def test_apply_passes_context_and_maintainerr_exclusions(tmp_path, monkeypatch):
    fake = FakePlex()
    captured = Captured()

    async def fake_apply(ctx, rating_keys, style, style_name, values, excluded, *, dry_run=False, force=False):
        captured.ctx = ctx
        captured.rating_keys = rating_keys
        captured.style_name = style_name
        captured.values = values
        captured.excluded = excluded
        captured.dry_run = dry_run
        captured.force = force
        return [Outcome(rating_keys[0], "Marvel film 1", "skip", "up to date", False)]

    monkeypatch.setattr("starr_studio.overlay_engine_routes.apply_titles", fake_apply)
    client, config = make_client(tmp_path, fake_plex=fake)
    col_key = fake.add_collection("1", "Maintainerr picks", items=0)
    fake.ITEMS[col_key] = [{"ratingKey": "201", "type": "movie", "title": "Marvel film 1"}]
    with client:
        client.app.state.maintainerr.snapshot.collections = [
            OwnedCollection(id=1, title="Maintainerr picks", library_key="1", rating_key=col_key, active=True, overlays=True)
        ]
        response = client.post(
            APPLY,
            json={"library": "Movies", "rating_keys": ["4635"], "style": "modern-streaming", "values": {"band": 50}},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["dry_run"] is True
    assert body["outcomes"][0]["kind"] == "skip"
    assert captured.rating_keys == ["4635"]
    assert captured.style_name == "modern-streaming"
    assert captured.values == {"band": 50}
    assert captured.excluded == {"201"}
    assert captured.dry_run is True and captured.force is False
    assert captured.ctx.library_key == "1"
    assert captured.ctx.kometa_backups == config / "overlays" / "Movies Original Posters"
    assert captured.ctx.originals.root == client.app.state.settings.data_dir / "overlay-engine" / "originals"


def test_apply_defaults_to_dry_run_and_refuses_too_many_keys(tmp_path, monkeypatch):
    async def fake_apply(*_a, **_k):
        return []

    monkeypatch.setattr("starr_studio.overlay_engine_routes.apply_titles", fake_apply)
    client, _ = make_client(tmp_path, fake_plex=FakePlex())
    with client:
        assert client.post(APPLY, json={"library": "Movies", "rating_keys": ["1"] * 51, "style": "modern-streaming"}).status_code == 422
        response = client.post(APPLY, json={"library": "Movies", "rating_keys": ["4635"], "style": "modern-streaming", "dry_run": False})
        assert response.status_code == 200
        assert response.json()["dry_run"] is False


def test_apply_unknown_library_and_style_errors(tmp_path, monkeypatch):
    async def fake_apply(*_a, **_k):
        return []

    monkeypatch.setattr("starr_studio.overlay_engine_routes.apply_titles", fake_apply)
    client, _ = make_client(tmp_path, fake_plex=FakePlex())
    with client:
        assert client.post(APPLY, json={"library": "Films", "rating_keys": ["1"], "style": "modern-streaming"}).status_code == 404
        assert "style name or a style file" in client.post(APPLY, json={"library": "Movies", "rating_keys": ["1"]}).text
        assert "No style called" in client.post(APPLY, json={"library": "Movies", "rating_keys": ["1"], "style": "nope"}).text


def test_restore_all_uses_studio_posters_and_restore_validates_keys(tmp_path, monkeypatch):
    seen: dict = {}

    async def fake_restore(ctx, rating_keys, *, dry_run=False):
        seen["keys"] = rating_keys
        seen["dry_run"] = dry_run
        return []

    def fake_studio_posters(db, library_key=None):
        assert library_key == "1"
        return ["201", "202"]

    monkeypatch.setattr("starr_studio.overlay_engine_routes.restore_titles", fake_restore)
    monkeypatch.setattr("starr_studio.overlay_engine_routes.studio_posters", fake_studio_posters)
    client, _ = make_client(tmp_path, fake_plex=FakePlex())
    with client:
        assert client.post(RESTORE, json={"library": "Movies", "rating_keys": ["1"], "all": True}).status_code == 422
        assert client.post(RESTORE, json={"library": "Movies"}).status_code == 422
        response = client.post(RESTORE, json={"library": "Movies", "all": True, "dry_run": False})
        assert response.status_code == 200
        assert seen["keys"] == ["201", "202"] and seen["dry_run"] is False


def test_titles_lists_rows_newest_first_with_studio_poster_flag(tmp_path):
    client, _ = make_client(tmp_path, fake_plex=FakePlex())
    now = int(time.time())
    with client:
        db = client.app.state.db
        db.execute(
            "INSERT INTO overlay_applied (rating_key, library_key, title, original_sha256, uploaded_sha256, "
            "plex_thumb, fingerprint, style, applied_at, restored_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("201", "1", "Older", "a" * 64, None, None, None, "modern-streaming", now - 10, now - 5, now - 1),
        )
        db.execute(
            "INSERT INTO overlay_applied (rating_key, library_key, title, original_sha256, uploaded_sha256, "
            "plex_thumb, fingerprint, style, applied_at, restored_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("202", "1", "Newer", "b" * 64, "c" * 64, None, "fp", "modern-streaming", now, None, now),
        )
        db.commit()
        rows = client.get(TITLES, params={"library": "Movies"}).json()
    assert [row["rating_key"] for row in rows] == ["202", "201"]
    assert rows[0]["studio_poster"] is True
    assert rows[1]["studio_poster"] is False


def test_section_key_uses_library_name(tmp_path, monkeypatch):
    captured: dict = {}

    async def fake_apply(ctx, *_a, **_k):
        captured["key"] = ctx.library_key
        return []

    monkeypatch.setattr("starr_studio.overlay_engine_routes.apply_titles", fake_apply)
    fake = FakePlex()
    fake.SECTIONS = [dict(section) for section in fake.SECTIONS]
    next(section for section in fake.SECTIONS if section["key"] == "2")["title"] = "Series"
    client, _ = make_client(tmp_path, fake_plex=fake)
    with client:
        client.post(APPLY, json={"library": "TV Shows", "rating_keys": ["4635"], "style": "modern-streaming"})
    assert captured["key"] == "2"
