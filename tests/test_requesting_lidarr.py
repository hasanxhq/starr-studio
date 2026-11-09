"""Lidarr album requests: search, file, refresh, cancel (RequestService + /api/v1/requests/music/search)."""

import asyncio
import json
import shutil
import sys
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest
from fakelidarr import LIDARR_KEY, LIDARR_URL, FakeLidarr
from fastapi.testclient import TestClient

from starr_studio import arr
from starr_studio.app import create_app
from starr_studio.arr import Connection, LidarrOptions
from starr_studio.auth_routes import TIMEZONE
from starr_studio.crypto import SecretBox
from starr_studio.db import open_database, set_setting
from starr_studio.requesting import Item, RequestService
from starr_studio.settings import Settings

FAKE_KOMETA = Path(__file__).parent / "fixtures" / "fake_kometa.py"

T0 = datetime(2026, 11, 9, 12, 0, 0, tzinfo=UTC)
OK_COMPUTER = "b1392450-e666-3926-a536-22c65f834433"
KID_A = "1834eae1-741b-3c03-9ca5-0df3decb43ea"
BLUE_LINES = "f5093c06-23e3-404f-aeaa-40f72885ee3a"


class CombinedTransport:
    def __init__(self, lidarr: FakeLidarr) -> None:
        self.lidarr = lidarr

    def handler(self, request: httpx.Request) -> httpx.Response:
        if str(request.url).startswith(LIDARR_URL):
            return self.lidarr.handle(request)
        return httpx.Response(404)


@pytest.fixture
def lidarr_env(tmp_path: Path):
    db = open_database(tmp_path / "studio.db")
    box = SecretBox.load_or_create(tmp_path / "data")
    config = tmp_path / "config.yml"
    config.write_text("libraries:\n  Music: {}\n")
    lidarr = FakeLidarr()
    client = httpx.AsyncClient(transport=httpx.MockTransport(CombinedTransport(lidarr).handler))
    service = RequestService(db, client, box, config, tmp_path / "data")
    arr.save_lidarr(
        db,
        box,
        Connection(LIDARR_URL, LIDARR_KEY),
        LidarrOptions(root_folder_path="/music", quality_profile="Lossless", metadata_profile="Standard"),
    )
    yield service, lidarr, db, client
    db.close()
    asyncio.run(client.aclose())


def enable_requests(service: RequestService) -> None:
    settings = service.load_settings()
    settings.enabled = True
    service.save_settings(settings)


@pytest.mark.anyio
async def test_connected_reports_lidarr(lidarr_env):
    service, *_ = lidarr_env
    assert service.connected()["lidarr"] is True


@pytest.mark.anyio
async def test_search_music_returns_albums(lidarr_env):
    service, lidarr, db, _ = lidarr_env
    found = await service.search_music("radiohead")
    assert len(found) == 2
    ok = next(a for a in found if a["item"] == f"mb-album:{OK_COMPUTER}")
    assert ok["title"] == "OK Computer"
    assert ok["artist"] == "Radiohead"
    assert ok["year"] == 1997
    assert ok["cover"] == f"https://coverart.test/{OK_COMPUTER}.jpg"
    assert ok["in_lidarr"] is False
    assert ok["request"] is None

    lidarr.add_existing(OK_COMPUTER, monitored=True, track_files=0)
    again = await service.search_music("ok computer")
    ok2 = next(a for a in again if a["item"] == f"mb-album:{OK_COMPUTER}")
    assert ok2["in_lidarr"] is True

    with_files = lidarr.add_existing(KID_A, monitored=False, track_files=8)
    kid = next(a for a in await service.search_music("kid") if a["item"] == f"mb-album:{KID_A}")
    assert kid["in_lidarr"] is True
    assert with_files["monitored"] is False

    enable_requests(service)
    await service.request([Item(item=f"mb-album:{BLUE_LINES}", title="Blue Lines")], library="Music", collection_id=None, now=T0)
    blue = next(a for a in await service.search_music("blue") if a["item"] == f"mb-album:{BLUE_LINES}")
    assert blue["request"]["status"] == "requested"


@pytest.mark.anyio
async def test_request_new_album_posts_only_that_album_monitored(lidarr_env):
    service, lidarr, db, _ = lidarr_env
    enable_requests(service)
    outcome = await service.request(
        [Item(item=f"mb-album:{OK_COMPUTER}", title="OK Computer", year=1997)],
        library="Music",
        collection_id=1,
        now=T0,
    )
    assert outcome.requested == 1
    post = next(r for r in lidarr.requests if r.method == "POST" and r.url.path == "/api/v1/album")
    body = json.loads(post.content)
    assert body["monitored"] is True
    assert body["addOptions"] == {"searchForNewAlbum": True}
    assert body["artist"]["monitorNewItems"] == "none"
    assert body["artist"]["addOptions"] == {"monitor": "none", "searchForMissingAlbums": False}
    assert body["artist"]["rootFolderPath"] == "/music"
    assert body["artist"]["qualityProfileId"] == 2
    assert body["artist"]["metadataProfileId"] == 1
    assert any(t["label"] == "starr" for t in lidarr.tags)

    row = db.execute("SELECT * FROM requests WHERE item = ?", (f"mb-album:{OK_COMPUTER}",)).fetchone()
    assert row["status"] == "requested"
    assert row["via"] == "lidarr"
    assert row["media"] == "album"
    assert row["title"] == "Radiohead – OK Computer"
    assert row["external_id"] is not None


@pytest.mark.anyio
async def test_request_unmonitored_album_monitors_and_searches_without_post(lidarr_env):
    service, lidarr, db, _ = lidarr_env
    existing = lidarr.add_existing(OK_COMPUTER, monitored=False, track_files=0)
    enable_requests(service)
    outcome = await service.request(
        [Item(item=f"mb-album:{OK_COMPUTER}", title="OK Computer")],
        library="Music",
        collection_id=1,
        now=T0,
    )
    assert outcome.requested == 1
    assert not any(r.method == "POST" and r.url.path == "/api/v1/album" for r in lidarr.requests)
    assert existing["monitored"] is True
    assert any(c["name"] == "AlbumSearch" and c["body"].get("albumIds") == [existing["id"]] for c in lidarr.commands)


@pytest.mark.anyio
async def test_request_album_with_files_is_exists(lidarr_env):
    service, lidarr, db, _ = lidarr_env
    album = lidarr.add_existing(OK_COMPUTER, monitored=True, track_files=10)
    enable_requests(service)
    outcome = await service.request(
        [Item(item=f"mb-album:{OK_COMPUTER}", title="OK Computer")],
        library="Music",
        collection_id=1,
        now=T0,
    )
    assert outcome.exists == 1
    row = db.execute("SELECT * FROM requests WHERE item = ?", (f"mb-album:{OK_COMPUTER}",)).fetchone()
    assert row["status"] == "exists"
    assert row["external_id"] == str(album["id"])


@pytest.mark.anyio
async def test_duplicate_and_cap(lidarr_env):
    service, lidarr, db, _ = lidarr_env
    enable_requests(service)
    set_setting(db, TIMEZONE, "UTC")
    first = await service.request([Item(item=f"mb-album:{OK_COMPUTER}", title="OK Computer")], library="Music", collection_id=9, now=T0, cap=1)
    assert first.requested == 1
    second = await service.request(
        [
            Item(item=f"mb-album:{KID_A}", title="Kid A"),
            Item(item=f"mb-album:{OK_COMPUTER}", title="OK Computer"),
        ],
        library="Music",
        collection_id=9,
        now=T0,
        cap=1,
    )
    assert second.skipped == 1 and second.capped == 1
    assert db.execute("SELECT count(*) FROM requests WHERE item = ?", (f"mb-album:{OK_COMPUTER}",)).fetchone()[0] == 1


@pytest.mark.anyio
async def test_music_uses_lidarr_even_when_via_seerr(lidarr_env):
    service, lidarr, db, _ = lidarr_env
    settings = service.load_settings()
    settings.enabled = True
    settings.via = "seerr"
    service.save_settings(settings)
    outcome = await service.request([Item(item=f"mb-album:{OK_COMPUTER}", title="OK Computer")], library="Music", collection_id=1, now=T0)
    assert outcome.requested == 1
    assert db.execute("SELECT via FROM requests").fetchone()[0] == "lidarr"


@pytest.mark.anyio
async def test_refresh_queue_downloading_imported_and_removed(lidarr_env):
    service, lidarr, db, _ = lidarr_env
    enable_requests(service)
    outcome = await service.request([Item(item=f"mb-album:{OK_COMPUTER}", title="OK Computer")], library="Music", collection_id=1, now=T0)
    row_id = db.execute("SELECT id, external_id FROM requests").fetchone()
    album_id = int(row_id["external_id"])

    lidarr.queue = [{"albumId": album_id, "status": "downloading", "title": "OK Computer"}]
    await service.refresh(T0)
    assert db.execute("SELECT status FROM requests WHERE id = ?", (row_id["id"],)).fetchone()[0] == "downloading"

    lidarr.queue = []
    lidarr.albums[album_id]["statistics"]["trackFileCount"] = 5
    await service.refresh(T0)
    assert db.execute("SELECT status FROM requests WHERE id = ?", (row_id["id"],)).fetchone()[0] == "imported"


@pytest.mark.anyio
async def test_refresh_removed_from_lidarr_fails_row(lidarr_env):
    service, lidarr, db, _ = lidarr_env
    enable_requests(service)
    await service.request([Item(item=f"mb-album:{KID_A}", title="Kid A")], library="Music", collection_id=1, now=T0)
    row = db.execute("SELECT id, external_id FROM requests").fetchone()
    del lidarr.albums[int(row["external_id"])]
    await service.refresh(T0)
    updated = dict(db.execute("SELECT status, error FROM requests WHERE id = ?", (row["id"],)).fetchone())
    assert updated == {"status": "failed", "error": "Removed from Lidarr"}


@pytest.mark.anyio
async def test_cancel_unmonitors_never_deletes(lidarr_env):
    service, lidarr, db, _ = lidarr_env
    enable_requests(service)
    await service.request([Item(item=f"mb-album:{OK_COMPUTER}", title="OK Computer")], library="Music", collection_id=1, now=T0)
    row = db.execute("SELECT id, external_id FROM requests").fetchone()
    album_id = int(row["external_id"])
    assert lidarr.albums[album_id]["monitored"] is True

    await service.cancel(row["id"], T0)
    assert lidarr.albums[album_id]["monitored"] is False
    assert album_id in lidarr.albums
    assert db.execute("SELECT status FROM requests WHERE id = ?", (row["id"],)).fetchone()[0] == "cancelled"
    assert not any(r.method == "DELETE" for r in lidarr.requests)


@pytest.mark.anyio
async def test_on_imports_accepts_lidarr_records_without_crashing(lidarr_env):
    service, lidarr, db, _ = lidarr_env
    album = lidarr.add_existing(OK_COMPUTER, monitored=True, track_files=1)
    record = {"id": 1, "albumId": album["id"], "eventType": "trackFileImported"}
    assert service.on_imports("lidarr", [record], T0) == 0  # refresh handles following; history hook must not crash


def test_music_search_route(tmp_path: Path):
    kometa = tmp_path / "kometa"
    kometa.mkdir()
    shutil.copy(FAKE_KOMETA, kometa / "kometa.py")
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    (config_dir / "config.yml").write_text("libraries:\n  Music: {}\n")
    (config_dir / "fake.json").write_text('{"lines":["ok"],"exit":0}')

    lidarr = FakeLidarr()
    settings = Settings(
        data_dir=tmp_path / "data",
        kometa_python=Path(sys.executable),
        kometa_entry=kometa / "kometa.py",
        kometa_config=config_dir / "config.yml",
        kill_after=0.5,
    )
    app = create_app(settings, static_dir=tmp_path / "no-static", http_transport=httpx.MockTransport(CombinedTransport(lidarr).handler))
    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        db, box = client.app.state.db, client.app.state.secrets
        arr.save_lidarr(db, box, Connection(LIDARR_URL, LIDARR_KEY), LidarrOptions())

        assert client.get("/api/v1/requests/music/search", params={"term": "  "}).status_code == 422

        arr.remove_lidarr(db)
        assert client.get("/api/v1/requests/music/search", params={"term": "radio"}).status_code == 409

        arr.save_lidarr(db, box, Connection(LIDARR_URL, LIDARR_KEY), LidarrOptions())
        lidarr.down = True
        assert client.get("/api/v1/requests/music/search", params={"term": "radio"}).status_code == 502

        lidarr.down = False
        body = client.get("/api/v1/requests/music/search", params={"term": "radiohead"}).json()
        assert len(body["albums"]) == 2
        assert body["albums"][0]["item"].startswith("mb-album:")
