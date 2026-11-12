"""KometaOverlayHold: block overlay runs while Studio's engine still has posters on Plex."""

import asyncio
import json
import sys
from pathlib import Path

import pytest
from fakeplex import FakePlex
from fastapi.testclient import TestClient

from starr_studio.app import create_app
from starr_studio.kometa_command import RunRequest
from starr_studio.overlay_engine.kometa_hold import KometaOverlayHold
from starr_studio.runner import RunHeld
from starr_studio.settings import Settings

from tests.test_overlays import finished, make_client

FAKE_KOMETA = Path(__file__).parent / "fixtures" / "fake_kometa.py"


def hold_message(client, mode, libraries=None):
    body = {"mode": mode}
    if libraries is not None:
        body["libraries"] = libraries
    return finished(client, client.post("/api/v1/runs", json=body).json()["id"])


def test_overlay_run_with_studio_posters_is_held(tmp_path, monkeypatch):
    client, _ = make_client(tmp_path, fake_plex=FakePlex())

    def fake_studio_posters(db, library_key=None):
        if library_key is None:
            return ["201"]
        return ["201"] if library_key == "1" else []

    monkeypatch.setattr("starr_studio.overlay_engine.kometa_hold.studio_posters", fake_studio_posters)
    with client:
        run = hold_message(client, "overlays", ["Movies"])
    assert run["status"] == "failed"
    assert "Studio's overlay engine has its posters on 1 titles in Movies" in run["error"]


def test_collections_only_run_is_not_held(tmp_path, monkeypatch):
    client, _ = make_client(tmp_path, fake_plex=FakePlex())
    monkeypatch.setattr("starr_studio.overlay_engine.kometa_hold.studio_posters", lambda db, library_key=None: ["201"])
    with client:
        run = hold_message(client, "collections")
    assert run["status"] == "succeeded"


def test_overlay_run_without_studio_posters_goes(tmp_path, monkeypatch):
    client, _ = make_client(tmp_path, fake_plex=FakePlex())
    monkeypatch.setattr("starr_studio.overlay_engine.kometa_hold.studio_posters", lambda db, library_key=None: [])
    with client:
        run = hold_message(client, "overlays", ["Movies"])
    assert run["status"] == "succeeded"


def test_plex_unreachable_with_studio_posters_is_held(tmp_path, monkeypatch):
    config = tmp_path / "config"
    config.mkdir()
    (config / "config.yml").write_text(
        "libraries:\n  Movies:\n    overlay_files:\n      - file: config/overlays.yml\n"
        f"plex:\n  url: http://127.0.0.1:32400\n  token: x\n"
    )
    (config / "overlays.yml").write_text("overlays: {}\n")
    (config / "fake.json").write_text(json.dumps({"lines": ["Kometa ran"]}))
    settings = Settings(
        data_dir=tmp_path / "data",
        kometa_python=Path(sys.executable),
        kometa_entry=tmp_path / "fake_kometa.py",
        kometa_config=config / "config.yml",
        kill_after=0.5,
    )
    (tmp_path / "fake_kometa.py").symlink_to(FAKE_KOMETA)
    client = TestClient(create_app(settings, static_dir=tmp_path / "no-static", http_transport=None), client=("127.0.0.1", 50000))

    def fake_studio_posters(db, library_key=None):
        return ["201", "202"]

    monkeypatch.setattr("starr_studio.overlay_engine.kometa_hold.studio_posters", fake_studio_posters)
    with client:
        hook = next(h for h in client.app.state.runner.hooks if isinstance(h, KometaOverlayHold))
        with pytest.raises(RunHeld) as caught:
            asyncio.run(hook.before_run(RunRequest(mode="overlays", libraries=["Movies"]), lambda _line: None))
    assert "2 titles and Plex didn't answer" in str(caught.value)
