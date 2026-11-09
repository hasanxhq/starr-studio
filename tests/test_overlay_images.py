"""Kometa overlay badge images served for the overlay studio preview."""

from __future__ import annotations

import sys
from pathlib import Path

import httpx
from fakeplex import FakePlex
from fastapi.testclient import TestClient

from starr_studio.app import create_app
from starr_studio.settings import Settings
from test_auth import REMOTE, set_up_sign_in
from test_ready_made_routes import make_client, root  # noqa: F401

PNG = b"\x89PNG\r\n\x1a\n"


def images_dir(root: Path) -> Path:
    return root / "kometa" / "defaults" / "overlays" / "images"


def write_png(root: Path, rel: str, body: bytes = PNG) -> Path:
    path = images_dir(root) / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    return path


def test_serves_png_with_cache_header(root: Path):
    unique = b"\x89PNG\r\n\x1a\nunique-payload"
    write_png(root, "resolution/4k.png", unique)
    client, _, _ = make_client(root)
    with client:
        response = client.get("/api/v1/overlay-images/resolution/4k.png")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.headers["cache-control"] == "public, max-age=86400"
    assert response.content == unique


def test_path_with_space_and_plus(root: Path):
    rel = "streaming/color/Apple TV+.png"
    body = b"\x89PNG\r\napple-tv-plus"
    write_png(root, rel, body)
    client, _, _ = make_client(root)
    with client:
        response = client.get("/api/v1/overlay-images/streaming/color/Apple%20TV%2B.png")
    assert response.status_code == 200
    assert response.content == body


def test_missing_file_404(root: Path):
    images_dir(root).mkdir(parents=True)
    client, _, _ = make_client(root)
    with client:
        response = client.get("/api/v1/overlay-images/resolution/missing.png")
    assert response.status_code == 404
    assert "path" in response.json()["detail"].lower()


def test_traversal_404(root: Path):
    write_png(root, "resolution/4k.png")
    client, _, _ = make_client(root)
    with client:
        for path in (
            "/api/v1/overlay-images/../../config/config.yml",
            "/api/v1/overlay-images/%2e%2e%2f%2e%2e%2fconfig%2fconfig.yml",
        ):
            assert client.get(path).status_code == 404


def test_non_png_in_folder_404(root: Path):
    folder = images_dir(root) / "rating"
    folder.mkdir(parents=True)
    (folder / "notes.yml").write_text("key: value\n")
    client, _, _ = make_client(root)
    with client:
        response = client.get("/api/v1/overlay-images/rating/notes.yml")
    assert response.status_code == 404


def test_symlink_outside_404(root: Path, tmp_path: Path):
    outside = tmp_path / "secret.png"
    outside.write_bytes(PNG)
    link = images_dir(root) / "escape.png"
    link.parent.mkdir(parents=True, exist_ok=True)
    link.symlink_to(outside)
    client, _, _ = make_client(root)
    with client:
        assert client.get("/api/v1/overlay-images/escape.png").status_code == 404


def test_no_kometa_entry_404(tmp_path: Path):
    settings = Settings(
        data_dir=tmp_path / "data",
        kometa_python=Path(sys.executable),
        kometa_entry=None,
        kometa_config=tmp_path / "config" / "config.yml",
        kill_after=0.5,
    )
    (tmp_path / "config").mkdir()
    (tmp_path / "config" / "config.yml").write_text("libraries:\n  Movies: {}\n")
    app = create_app(settings, static_dir=tmp_path / "no-static", http_transport=httpx.MockTransport(FakePlex().handle))
    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        assert client.get("/api/v1/overlay-images/resolution/4k.png").status_code == 404


def test_requires_auth_like_other_api_routes(root: Path):
    write_png(root, "resolution/4k.png")
    client_local, _, _ = make_client(root)
    with client_local:
        set_up_sign_in(client_local)
    settings = Settings(
        data_dir=root / "data",
        kometa_python=Path(sys.executable),
        kometa_entry=root / "kometa" / "kometa.py",
        kometa_config=root / "config" / "config.yml",
        kill_after=0.5,
    )
    app = create_app(settings, static_dir=root / "no-static", http_transport=httpx.MockTransport(FakePlex().handle))
    with TestClient(app, client=REMOTE) as remote:
        refused = remote.get("/api/v1/overlay-images/resolution/4k.png")
    assert refused.status_code == 401
