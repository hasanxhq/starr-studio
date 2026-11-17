import json
import os
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


class AfterCounter:
    def __init__(self) -> None:
        self.ran = 0

    async def before_run(self, request, say):
        async def after() -> None:
            self.ran += 1

        return after


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    try:
        with open(f"/proc/{pid}/status") as status:
            return "zombie" not in status.read()
    except FileNotFoundError:
        return False


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


def test_a_log_write_error_stops_kometa_and_still_runs_after_hooks(tmp_path):
    config = tmp_path / "config"
    config.mkdir()
    (config / "config.yml").write_text("libraries: {}\n")
    release = tmp_path / "release"
    child_pid = tmp_path / "child.pid"
    (config / "fake.json").write_text(
        json.dumps({"lines": ["one", "two", "three"], "wait_for": str(release), "child_pid": str(child_pid)})
    )
    settings = Settings(data_dir=tmp_path / "data", kometa_python=Path(sys.executable), kometa_entry=FAKE_KOMETA, kometa_config=config / "config.yml", kill_after=0.5)
    with TestClient(create_app(settings, static_dir=tmp_path / "no-static"), client=("127.0.0.1", 50000)) as client:
        runner = client.app.state.runner
        counter = AfterCounter()
        runner.hooks.append(counter)
        lines = {"n": 0}
        real_emit = runner._emit

        def flaky_emit(active, log, line):
            lines["n"] += 1
            if active.process is not None and lines["n"] > 2:
                raise OSError(28, "No space left on device")
            real_emit(active, log, line)

        runner._emit = flaky_emit
        run_id = client.post("/api/v1/runs", json={"mode": "collections"}).json()["id"]
        deadline = time.monotonic() + 10
        while not child_pid.exists() and time.monotonic() < deadline:
            time.sleep(0.02)
        release.touch()
        run = wait_for(client, run_id)

    assert run["status"] == "failed" and "Couldn't write the run log" in run["error"]
    assert counter.ran == 1
    assert child_pid.exists() and not _alive(int(child_pid.read_text()))
