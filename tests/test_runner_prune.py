import json
import sys
import time
from pathlib import Path

from fastapi.testclient import TestClient

from starr_studio.app import create_app
from starr_studio.runner import KEEP_RUNS
from starr_studio.settings import Settings

FAKE_KOMETA = Path(__file__).parent / "fixtures" / "fake_kometa.py"
FINISHED = {"succeeded", "failed", "cancelled", "interrupted", "timed_out"}


def wait_for(client, run_id, timeout=120):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        run = client.get(f"/api/v1/runs/{run_id}").json()
        if run["status"] in FINISHED:
            return run
        time.sleep(0.02)
    raise AssertionError(f"run {run_id} still {client.get(f'/api/v1/runs/{run_id}').json()['status']}")


def make_client(tmp_path):
    config = tmp_path / "config" / "config.yml"
    config.parent.mkdir()
    config.write_text("libraries: {}\n")
    (config.parent / "fake.json").write_text(json.dumps({"lines": ["done"]}))
    settings = Settings(
        data_dir=tmp_path / "data",
        kometa_python=Path(sys.executable),
        kometa_entry=FAKE_KOMETA,
        kometa_config=config,
        kill_after=0.5,
    )
    return TestClient(create_app(settings, static_dir=tmp_path / "no-static"), client=("127.0.0.1", 50000))


def test_old_finished_runs_and_logs_are_pruned(tmp_path):
    with make_client(tmp_path) as client:
        runner = client.app.state.runner
        db = client.app.state.db
        for _ in range(KEEP_RUNS + 5):
            run_id = client.post("/api/v1/runs", json={"mode": "collections"}).json()["id"]
            assert wait_for(client, run_id)["status"] == "succeeded"
        assert db.execute("SELECT COUNT(*) FROM runs").fetchone()[0] == KEEP_RUNS
        assert db.execute("SELECT MIN(id) FROM runs").fetchone()[0] == 6
        for run_id in range(1, 6):
            assert not runner.log_path(run_id).exists()
        assert runner.log_path(6).exists()


def test_a_running_run_is_never_pruned(tmp_path):
    release = tmp_path / "release"
    config = tmp_path / "config" / "config.yml"
    config.parent.mkdir()
    config.write_text("libraries: {}\n")
    (config.parent / "fake.json").write_text(json.dumps({"lines": ["hold"], "wait_for": str(release)}))
    settings = Settings(
        data_dir=tmp_path / "data",
        kometa_python=Path(sys.executable),
        kometa_entry=FAKE_KOMETA,
        kometa_config=config,
        kill_after=0.5,
    )
    with TestClient(create_app(settings, static_dir=tmp_path / "no-static"), client=("127.0.0.1", 50000)) as client:
        runner = client.app.state.runner
        db = client.app.state.db
        runner.runs_dir.mkdir(parents=True, exist_ok=True)
        with db:
            for run_id in range(1, KEEP_RUNS + 3):
                db.execute(
                    "INSERT INTO runs (id, request, status, finished_at) VALUES (?, '{}', 'succeeded', '2026-01-01T00:00:00Z')",
                    (run_id,),
                )
                runner.log_path(run_id).write_text(f"log {run_id}\n")
        active = client.post("/api/v1/runs", json={"mode": "collections"}).json()["id"]
        assert client.get(f"/api/v1/runs/{active}").json()["status"] == "running"
        assert db.execute("SELECT COUNT(*) FROM runs").fetchone()[0] == KEEP_RUNS + 3
        release.touch()
        deadline = time.monotonic() + 15
        while client.get(f"/api/v1/runs/{active}").json()["status"] not in ("succeeded", "failed", "cancelled") and time.monotonic() < deadline:
            time.sleep(0.05)
        assert client.get(f"/api/v1/runs/{active}").json()["status"] == "succeeded"
        assert db.execute("SELECT COUNT(*) FROM runs").fetchone()[0] == KEEP_RUNS
        assert db.execute("SELECT 1 FROM runs WHERE id = ?", (active,)).fetchone() is not None