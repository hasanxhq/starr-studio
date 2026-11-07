import json
import sys
import time
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from starr_studio.app import create_app
from starr_studio.config_sections import read_section
from starr_studio.settings import Settings
from tests.fakeplex import REMOTE_URI, SERVER_TOKEN, FakePlex

FAKE_KOMETA = Path(__file__).parent / "fixtures" / "fake_kometa.py"
FINISHED = {"succeeded", "failed", "cancelled", "interrupted", "timed_out"}


def make_client(tmp_path, fake_plex=None, plex_down=False):
    root = tmp_path / "kometa"
    config = root / "config"
    config.mkdir(parents=True)
    (root / "kometa.py").symlink_to(FAKE_KOMETA)
    config_text = (
        "libraries:\n"
        "  Movies:  # the big one\n    overlay_files:\n      - file: config/overlays.yml\n"
        "  TV Shows:\n    library_name: Series\n    collection_files:\n      - file: config/overlays.yml\n"
    )
    if fake_plex or plex_down:
        config_text += f"plex:\n  url: {REMOTE_URI}\n  token: {SERVER_TOKEN}\n"
    (config / "config.yml").write_text(config_text)
    (config / "overlays.yml").write_text("overlays:\n  4K:\n    overlay: {name: 4K}\n    plex_search: {all: {resolution: 4K}}\n")
    (config / "fake.json").write_text(json.dumps({"lines": ["Kometa ran"]}))
    posters = config / "overlays" / "Movies Original Posters"
    posters.mkdir(parents=True)
    (posters / "101.jpg").write_bytes(b"x" * 100)
    (posters / "102.png").write_bytes(b"y" * 50)
    settings = Settings(
        data_dir=config / ".studio", kometa_python=Path(sys.executable), kometa_entry=root / "kometa.py", kometa_config=config / "config.yml", kill_after=0.5
    )
    if plex_down:
        def failing_handler(request):
            raise httpx.ConnectError("Plex down", request=request)

        transport = httpx.MockTransport(failing_handler)
    elif fake_plex:
        transport = fake_plex.transport()
    else:
        transport = None
    return TestClient(create_app(settings, static_dir=tmp_path / "no-static", http_transport=transport), client=("127.0.0.1", 50000)), config


def finished(client, run_id, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        run = client.get(f"/api/v1/runs/{run_id}").json()
        if run["status"] in FINISHED:
            return run
        time.sleep(0.05)
    raise AssertionError("still running")


def test_each_library_says_what_draws_overlays_and_how_its_backup_is(tmp_path):
    client, _ = make_client(tmp_path)
    with client:
        before = {entry["library"]: entry for entry in client.get("/api/v1/overlays").json()["libraries"]}
        run = finished(client, client.post("/api/v1/overlays/Movies/apply").json()["run_id"])
        after = {entry["library"]: entry for entry in client.get("/api/v1/overlays").json()["libraries"]}
    movies = before["Movies"]
    assert movies["off"] is False
    assert movies["files"] == [{"kind": "file", "value": "config/overlays.yml", "error": None, "files": [{"path": "overlays.yml", "title": None, "docs_url": None, "overlays": ["4K"]}]}]
    assert movies["backup"] == {"posters": 2, "bytes": 150}
    assert (movies["last_pass"], movies["maintainerr"]) == (None, None)
    assert movies["items"] is None
    assert movies["last_pass_seconds"] is None
    assert (before["TV Shows"]["plex_name"], before["TV Shows"]["files"], before["TV Shows"]["backup"]) == ("Series", [], None)
    assert run["request"] == {**run["request"], "mode": "overlays", "libraries": ["Movies"]}
    assert after["Movies"]["last_pass"]["run_id"] == run["id"]
    assert isinstance(after["Movies"]["last_pass_seconds"], int)
    assert after["Movies"]["last_pass_seconds"] >= 0
    assert after["TV Shows"]["last_pass"] is None  # that run was only for Movies
    assert after["TV Shows"]["last_pass_seconds"] is None


def test_turning_overlays_off_and_on_again(tmp_path):
    client, config = make_client(tmp_path)
    with client:
        no_backup = client.post("/api/v1/overlays/TV Shows/off")
        unknown = client.post("/api/v1/overlays/Music/off")
        off = client.post("/api/v1/overlays/Movies/off").json()
        finished(client, off["run_id"])
        assert read_section(config / "config.yml", "libraries")["Movies"]["remove_overlays"] is True
        assert client.get("/api/v1/overlays").json()["libraries"][0]["off"] is True
        on = client.post("/api/v1/overlays/Movies/on").json()
        run = finished(client, on["run_id"])
    assert no_backup.status_code == 409 and "no Original Posters backup" in no_backup.json()["detail"]
    assert unknown.status_code == 404
    assert "remove_overlays" not in read_section(config / "config.yml", "libraries")["Movies"]
    assert "# the big one" in (config / "config.yml").read_text()  # the rest of the file is kept
    assert run["request"]["mode"] == "overlays" and run["request"]["libraries"] == ["Movies"]


def test_overlays_overview_with_plex_connected_and_down(tmp_path):
    fake_plex = FakePlex()
    client, _ = make_client(tmp_path, fake_plex=fake_plex)
    with client:
        res = client.get("/api/v1/overlays").json()["libraries"]
        by_name = {entry["library"]: entry for entry in res}
        # Movies plex_name is "Movies" which exists in FakePlex (size 812)
        assert by_name["Movies"]["items"] == 812
        assert by_name["Movies"]["last_pass_seconds"] is None
        # TV Shows plex_name is "Series" which is not in FakePlex -> items is None
        assert by_name["TV Shows"]["items"] is None

    # When Plex is down / unreachable: returns items: null and does not fail
    client_down, _ = make_client(tmp_path / "down", plex_down=True)
    with client_down:
        res_down = client_down.get("/api/v1/overlays")
        assert res_down.status_code == 200
        by_name_down = {entry["library"]: entry for entry in res_down.json()["libraries"]}
        assert by_name_down["Movies"]["items"] is None
        assert by_name_down["TV Shows"]["items"] is None


def test_estimate_redraw_duration_and_posters(tmp_path):
    fake_plex = FakePlex()
    client, _ = make_client(tmp_path, fake_plex=fake_plex)
    with client:
        # Invalid body shape -> 422
        bad_body = client.post("/api/v1/overlays/Movies/estimate", json={})
        assert bad_body.status_code == 422

        bad_layers = client.post("/api/v1/overlays/Movies/estimate", json={"layers": [{"name": "4K"}]})
        assert bad_layers.status_code == 422

        # Unknown library -> 404
        unknown_lib = client.post("/api/v1/overlays/Unknown/estimate", json={"layers": []})
        assert unknown_lib.status_code == 404

        # Before any run: posters is Plex item count, minutes is None
        before = client.post("/api/v1/overlays/Movies/estimate", json={"layers": [{"name": "4K", "variables": {}}]})
        assert before.status_code == 200
        assert before.json() == {"posters": 812, "minutes": None}

        # Run an overlay pass
        run = finished(client, client.post("/api/v1/overlays/Movies/apply").json()["run_id"])
        assert run["status"] == "succeeded"

        # After a run: posters is 812, minutes is rounded up to whole minutes, at least 1
        after = client.post("/api/v1/overlays/Movies/estimate", json={"layers": [{"name": "4K", "variables": {"horizontal_align": "right"}}]})
        assert after.status_code == 200
        data = after.json()
        assert data["posters"] == 812
        assert data["minutes"] == 1

        # TV Shows has no pass -> minutes is None
        tv_estimate = client.post("/api/v1/overlays/TV Shows/estimate", json={"layers": []})
        assert tv_estimate.status_code == 200
        assert tv_estimate.json() == {"posters": None, "minutes": None}

    # When Plex is down: posters is None
    client_down, _ = make_client(tmp_path / "down", plex_down=True)
    with client_down:
        down_res = client_down.post("/api/v1/overlays/Movies/estimate", json={"layers": []})
        assert down_res.status_code == 200
        assert down_res.json()["posters"] is None
