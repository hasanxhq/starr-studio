import shutil
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from starr_studio.app import create_app
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


def test_overlay_defaults_refuses_an_empty_layers_list(tmp_path, kometa):
    with make_client(tmp_path, kometa) as client:
        response = client.put("/api/v1/config/libraries/Movies/defaults/overlay", json={"layers": []})
    assert response.status_code == 422


def test_overlay_defaults_refuses_an_unknown_name(tmp_path, kometa):
    with make_client(tmp_path, kometa) as client:
        response = client.put(
            "/api/v1/config/libraries/Movies/defaults/overlay",
            json={"layers": [{"name": "not-a-real-overlay", "template_variables": {}}]},
        )
    assert response.status_code == 404