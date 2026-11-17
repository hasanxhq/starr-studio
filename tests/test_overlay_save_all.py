import json
import shutil
import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from starr_studio.app import create_app
from starr_studio.config_write import ConfigWriter, Validation
from starr_studio.settings import Settings

FAKE_KOMETA = Path(__file__).parent / "fixtures" / "fake_kometa.py"


def banner(title: str, wiki: str) -> str:
    return f"#####\n#  {title}  #\n#  https://kometa.wiki/en/latest/defaults/{wiki}  #\n#####\n\ncollections: {{}}\n"


@pytest.fixture
def kometa(tmp_path) -> Path:
    root = tmp_path / "kometa"
    for path, title in {
        "chart/basic.yml": "Basic Charts Collections",
        "overlays/resolution.yml": "Resolution Overlays",
        "overlays/ribbon.yml": "Ribbon Overlay",
    }.items():
        file = root / "defaults" / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(banner(title, path.removesuffix(".yml")))
    (root / "defaults" / "templates.yml").write_text("templates: {}\n")
    config = root / "config"
    config.mkdir()
    (config / "config.yml").write_text(
        "libraries:\n  Movies:\n    overlay_files:\n      - default: resolution\n        template_variables:\n          horizontal_align: center\n"
    )
    (config / "fake.json").write_text("{}")
    shutil.copy(FAKE_KOMETA, root / "kometa.py")
    return root


def make_client(tmp_path, kometa):
    settings = Settings(
        data_dir=kometa / "config" / ".studio",
        kometa_config=kometa / "config" / "config.yml",
        kometa_entry=kometa / "kometa.py",
        kometa_python=Path(sys.executable),
    )
    return TestClient(create_app(settings, static_dir=tmp_path / "no-static"), client=("127.0.0.1", 50000))


def validate_calls(kometa: Path) -> list[dict]:
    log = kometa / "config" / "validate_calls.jsonl"
    return [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []


def test_saving_two_overlay_layers_in_one_call(tmp_path, kometa):
    config = kometa / "config" / "config.yml"
    with make_client(tmp_path, kometa) as client:
        before_calls = len(validate_calls(kometa))
        before_backups = len(client.get("/api/v1/backups").json()["backups"])
        response = client.put(
            "/api/v1/config/libraries/Movies/defaults/overlay",
            json={
                "layers": [
                    {"name": "resolution", "template_variables": {"horizontal_align": "left"}},
                    {"name": "ribbon", "template_variables": {"horizontal_offset": 12}},
                ]
            },
        )
        after_backups = client.get("/api/v1/backups").json()["backups"]
    assert response.status_code == 200
    text = config.read_text()
    assert "default: ribbon" in text
    assert "horizontal_align: left" in text
    assert "horizontal_offset: 12" in text
    assert len(validate_calls(kometa)) - before_calls == 2
    assert len(after_backups) == before_backups + 1
    assert after_backups[0]["reason"] == "Set the resolution, ribbon defaults for Movies"


async def _refused(_self, _written):
    return Validation(ok=False, errors=["refused for test"], checked_by_kometa=True)


def test_when_the_check_refuses_neither_overlay_layer_is_saved(tmp_path, kometa):
    config = kometa / "config" / "config.yml"
    unchanged = config.read_text()
    with make_client(tmp_path, kometa) as client:
        with patch.object(ConfigWriter, "validate", _refused):
            response = client.put(
                "/api/v1/config/libraries/Movies/defaults/overlay",
                json={
                    "layers": [
                        {"name": "resolution", "template_variables": {"horizontal_align": "left"}},
                        {"name": "ribbon", "template_variables": {}},
                    ]
                },
            )
        assert client.get("/api/v1/backups").json()["backups"] == []
    assert response.status_code == 422
    assert config.read_text() == unchanged