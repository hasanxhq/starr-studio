"""Lidarr on Settings → Connect, and Kometa runs of the music libraries after Lidarr imports (music plan, phase 3)."""

import asyncio
import time
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from cryptography.fernet import Fernet
from fakelidarr import LIDARR_KEY, LIDARR_URL, FakeLidarr
from fastapi.testclient import TestClient
from test_arr import RecordingRunner

from starr_studio import arr
from starr_studio.app import create_app
from starr_studio.arr import Arr, Connection, LidarrOptions
from starr_studio.crypto import SecretBox
from starr_studio.db import get_setting, open_database, set_setting
from starr_studio.kometa_command import RunRequest
from starr_studio.settings import Settings

T0 = datetime(2026, 11, 9, 20, 0, tzinfo=UTC)
CONFIG = "libraries:\n  Movies: {}\n  Music: {}\n"
OK_COMPUTER = "b1392450-e666-3926-a536-22c65f834433"


@pytest.fixture
def setup(tmp_path):
    config = tmp_path / "config.yml"
    config.write_text(CONFIG)
    db = open_database(tmp_path / "studio.db")
    box = SecretBox(Fernet.generate_key())
    arr.save_lidarr(db, box, Connection(LIDARR_URL, LIDARR_KEY), LidarrOptions())
    set_setting(db, arr.RUNS, {"lidarr": {"enabled": True, "wait_minutes": 10}})
    yield db, box, FakeLidarr(), config
    db.close()


def run(scenario, fake):
    async def go():
        async with httpx.AsyncClient(transport=fake.transport()) as http:
            return await scenario(http)

    return asyncio.run(go())


def test_lidarr_imports_queue_one_run_of_the_music_libraries(setup):
    db, box, fake, config = setup
    album = fake.add_existing(OK_COMPUTER, monitored=True)

    async def scenario(http):
        service = Arr(db, RecordingRunner(), http, box, config)
        service._types = (time.monotonic(), {"Movies": "movie", "Music": "artist"})  # what Plex says, without Plex
        assert await service.poll(T0) == {"lidarr": 0}
        for minute, track in ((1, "Airbag"), (1, "Paranoid Android"), (2, "Lucky")):  # one record per track file
            fake.imported(album["id"], T0 + timedelta(minutes=minute), track)
        assert await service.poll(T0 + timedelta(minutes=3)) == {"lidarr": 3}
        pending = service.pending()["lidarr"]
        assert pending["titles"] == ["Radiohead – OK Computer"] and pending["imports"] == 3
        assert service.tick(T0 + timedelta(minutes=11)) == []
        assert service.tick(T0 + timedelta(minutes=13)) == [1]
        return service.runner.queued

    assert run(scenario, fake) == [(RunRequest(mode="all", libraries=["Music"]), "lidarr")]
    asked = next(r for r in fake.requests if r.url.path == "/api/v1/history/since")
    assert (asked.url.params["eventType"], asked.url.params["includeAlbum"]) == ("3", "true")


def test_chosen_libraries_win_and_an_unreachable_lidarr_is_noted(setup):
    db, box, fake, config = setup
    set_setting(db, arr.RUNS, {"lidarr": {"enabled": True, "wait_minutes": 10, "libraries": ["Music"], "mode": "collections"}})
    album = fake.add_existing(OK_COMPUTER, monitored=True)

    async def scenario(http):
        service = Arr(db, RecordingRunner(), http, box, config)
        await service.poll(T0)
        fake.imported(album["id"], T0 + timedelta(minutes=1))
        await service.poll(T0 + timedelta(minutes=2))
        fake.down = True
        assert await service.poll(T0 + timedelta(minutes=4)) == {}
        service.tick(T0 + timedelta(minutes=12))
        return service.runner.queued

    queued = run(scenario, fake)
    assert queued == [(RunRequest(mode="collections", libraries=["Music"]), "lidarr")]  # the chosen library, in the chosen mode
    assert get_setting(db, "arr.status.lidarr")["ok"] is False


# --- Settings → Connect ------------------------------------------------------------


def make_client(tmp_path, fake):
    (tmp_path / "config.yml").write_text(CONFIG)
    app = create_app(Settings(data_dir=tmp_path / "data", kometa_config=tmp_path / "config.yml"), static_dir=tmp_path / "no-static", http_transport=fake.transport())
    return TestClient(app, client=("127.0.0.1", 50000))


ENTERED = {"url": LIDARR_URL, "api_key": LIDARR_KEY, "root_folder_path": "/music", "quality_profile": "Lossless", "metadata_profile": "Standard"}


def test_lidarr_is_tested_saved_in_studio_and_removed(tmp_path):
    with make_client(tmp_path, FakeLidarr()) as client:
        empty = client.get("/api/v1/settings/arr").json()
        tested = client.post("/api/v1/settings/arr/lidarr/test", json={"url": LIDARR_URL, "api_key": LIDARR_KEY}).json()
        bad_profile = client.put("/api/v1/settings/arr/lidarr", json=ENTERED | {"metadata_profile": "Nope"})
        saved = client.put("/api/v1/settings/arr/lidarr", json=ENTERED)
        kept_key = client.post("/api/v1/settings/arr/lidarr/test", json={"url": LIDARR_URL}).json()  # the saved key is used
        runs = client.put("/api/v1/settings/arr/lidarr/runs", json={"enabled": True, "trigger": "relevant", "wait_minutes": 5}).json()
        removed = client.delete("/api/v1/settings/arr/lidarr").json()
    assert empty["connections"]["lidarr"]["url"] is None and empty["settings"]["lidarr"]["enabled"] is False
    assert tested == {"ok": True, "app": "Lidarr", "version": "2.9.6.4552", "root_folders": ["/music"], "quality_profiles": ["Any", "Lossless"], "metadata_profiles": ["Standard", "None"]}
    assert bad_profile.status_code == 422 and "metadata profile Nope" in bad_profile.text
    assert saved.status_code == 200, saved.text
    assert saved.json()["connections"]["lidarr"] == {
        "url": LIDARR_URL,
        "token": "…-key",
        "username": None,
        "has_password": False,
        "status": None,
        "root_folder_path": "/music",
        "quality_profile": "Lossless",
        "metadata_profile": "Standard",
    }
    assert LIDARR_KEY not in saved.text and "lidarr" not in (tmp_path / "config.yml").read_text()  # Kometa has no Lidarr
    assert kept_key["ok"] is True
    assert runs["settings"]["lidarr"]["trigger"] == "any"  # nothing tells what a music collection wants
    assert removed["connections"]["lidarr"]["url"] is None
