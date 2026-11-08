import json
import sys
import time
from pathlib import Path

from fastapi.testclient import TestClient

from starr_studio.app import create_app
from starr_studio.settings import Settings

FAKE_KOMETA = Path(__file__).parent / "fixtures" / "fake_kometa.py"


class Exploding:
    async def before_run(self, request, say):
        raise RuntimeError("Maintainerr went away")


def wait_for(client, run_id):
    deadline = time.monotonic() + 15
    while (run := client.get(f"/api/v1/runs/{run_id}").json())["status"] in ("queued", "running") and time.monotonic() < deadline:
        time.sleep(0.05)
    return run


def test_a_hook_raising_an_unexpected_error_fails_only_its_run(tmp_path):
    config = tmp_path / "config"
    config.mkdir()
    (config / "config.yml").write_text("libraries: {}\n")
    (config / "fake.json").write_text(json.dumps({"lines": ["Kometa ran"]}))
    settings = Settings(data_dir=tmp_path / "data", kometa_python=Path(sys.executable), kometa_entry=FAKE_KOMETA, kometa_config=config / "config.yml", kill_after=0.5)
    with TestClient(create_app(settings, static_dir=tmp_path / "no-static"), client=("127.0.0.1", 50000)) as client:
        runner = client.app.state.runner
        runner.hooks.insert(0, Exploding())
        first = client.post("/api/v1/runs", json={"mode": "collections"}).json()["id"]
        failed = wait_for(client, first)
        runner.hooks.pop(0)
        second = client.post("/api/v1/runs", json={"mode": "collections"}).json()["id"]
        ran = wait_for(client, second)
    assert failed["status"] == "failed" and failed["error"] == "Maintainerr went away"
    assert ran["status"] == "succeeded"
