"""Audit findings 17 and 24: webhook tokens with non-ASCII letters, Lidarr import job names."""

from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient

from starr_studio import arr
from starr_studio.app import create_app
from starr_studio.db import set_setting
from starr_studio.runs_routes import WEBHOOK_TOKEN
from starr_studio.settings import Settings

FAKE_KOMETA = Path(__file__).parent / "fixtures" / "fake_kometa.py"


def make_client(tmp_path) -> TestClient:
    config = tmp_path / "config"
    config.mkdir()
    (config / "config.yml").write_text("libraries: {}\n")
    settings = Settings(
        data_dir=tmp_path / "data",
        kometa_python=Path(sys.executable),
        kometa_entry=FAKE_KOMETA,
        kometa_config=config / "config.yml",
        kill_after=0.5,
    )
    return TestClient(create_app(settings, static_dir=tmp_path / "no-static"), client=("127.0.0.1", 50000))


def jobs(client: TestClient) -> dict[str, dict]:
    return {job["id"]: job for job in client.get("/api/v1/jobs").json()["jobs"]}


def test_a_waiting_lidarr_import_is_named_lidarr(tmp_path):
    with make_client(tmp_path) as client:
        db = client.app.state.db
        set_setting(
            db,
            arr.pending_key("lidarr"),
            {
                "first_at": "2026-10-30T20:00:00Z",
                "last_at": "2026-10-30T20:01:00Z",
                "imports": 1,
                "titles": ["Radiohead – OK Computer"],
            },
        )
        found = jobs(client)
    assert found["arr-pending-lidarr"]["title"] == "Kometa after Lidarr imports"


def test_a_webhook_with_a_non_ascii_token_answers_forbidden_not_server_error(tmp_path):
    with make_client(tmp_path) as client:
        set_setting(client.app.state.db, WEBHOOK_TOKEN, "töken-保存")
        response = client.post("/api/v1/kometa/events?token=wrong-保存", json={"event": "run_start"})
    assert response.status_code == 403