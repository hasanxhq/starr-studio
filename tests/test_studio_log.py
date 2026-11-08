import asyncio
import logging
import time

import httpx
from fastapi.testclient import TestClient

from starr_studio import studio_log
from starr_studio.app import create_app
from starr_studio.db import get_setting, open_database, set_setting
from starr_studio.settings import Settings


def client(tmp_path, **settings):
    app = create_app(Settings(data_dir=tmp_path / "data", **settings), static_dir=tmp_path / "no-static")
    return TestClient(app, client=("127.0.0.1", 50000))


def test_studio_lines_land_in_its_log_and_on_the_logs_page(tmp_path):
    with client(tmp_path) as c:
        logging.getLogger("starr_studio.test").info("Corrected drift in Action Movies")
        logging.getLogger("starr_studio.test").debug("not at info")
        files = c.get("/api/v1/logs", params={"source": "studio"}).json()["files"]
        view = c.get("/api/v1/logs/file", params={"source": "studio", "path": "studio.log"}).json()
    assert files[0]["path"] == "studio.log"
    texts = [line["text"] for line in view["lines"]]
    assert any("starr_studio.test [INFO] Corrected drift in Action Movies" in t for t in texts)
    assert not any("not at info" in t for t in texts)
    assert all(line["level"] in ("INFO", "WARNING", "ERROR") for line in view["lines"])


def test_the_log_level_is_a_general_setting_and_the_environment_wins(tmp_path):
    with client(tmp_path) as c:
        assert c.get("/api/v1/settings/general").json()["log_level"] == {"level": "info", "from_env": False, "trace_until": None}
        state = c.put("/api/v1/settings/log-level", json={"level": "trace"}).json()["log_level"]
        assert state["level"] == "trace" and state["trace_until"] > time.time() + 23 * 3600
        assert logging.getLogger("starr_studio").isEnabledFor(studio_log.TRACE)
    with client(tmp_path / "env", log_level="debug") as c:
        assert c.get("/api/v1/settings/general").json()["log_level"]["from_env"] is True
        assert c.put("/api/v1/settings/log-level", json={"level": "info"}).status_code == 409


def test_a_trace_older_than_a_day_goes_back_to_info_at_start(tmp_path):
    db = open_database(tmp_path / "studio.db")
    set_setting(db, studio_log.LEVEL, "trace")
    set_setting(db, studio_log.TRACE_UNTIL, time.time() - 1)
    studio_log.start(db, None)
    assert get_setting(db, studio_log.LEVEL) == "info"
    assert not logging.getLogger("starr_studio").isEnabledFor(logging.DEBUG)


def test_calls_are_logged_at_debug_without_secrets_and_bodies_at_trace(tmp_path, caplog):
    def answer(request):
        return httpx.Response(200, json={"apiKey": "s3cret", "title": "Dune"})

    async def call():
        async with httpx.AsyncClient(transport=studio_log.LoggingTransport(httpx.MockTransport(answer))) as http:
            response = await http.post("http://plex:32400/library?X-Plex-Token=abc123", json={"token": "t0k"})
            return response.json()

    http_log = logging.getLogger("starr_studio.http")
    http_log.addHandler(caplog.handler)
    caplog.handler.setLevel(studio_log.TRACE)
    try:
        studio_log.apply("debug")
        assert asyncio.run(call())["title"] == "Dune"
        debug_only = caplog.text
        caplog.clear()
        studio_log.apply("trace")
        assert asyncio.run(call()) == {"apiKey": "s3cret", "title": "Dune"}  # the caller still gets the real body
    finally:
        http_log.removeHandler(caplog.handler)
        studio_log.apply("info")
    assert "POST http://plex:32400/library?X-Plex-Token=•••• → 200" in debug_only and "Dune" not in debug_only
    assert "abc123" not in caplog.text and "s3cret" not in caplog.text and "t0k" not in caplog.text
    assert '"title":"Dune"' in caplog.text.replace(" ", "")
