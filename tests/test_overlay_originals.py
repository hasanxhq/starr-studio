import asyncio
import io
import os
import sys
import time
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

from starr_studio.app import create_app
from starr_studio.overlay_originals import (
    find_backup,
    get_or_create_original,
    shrink_to_webp,
)
from starr_studio.settings import Settings

FAKE_KOMETA = Path(__file__).parent / "fixtures" / "fake_kometa.py"


def _create_image(path: Path, size: tuple[int, int] = (1000, 1500), mode: str = "RGB", fmt: str = "JPEG") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new(mode, size, color=(255, 0, 0) if mode == "RGB" else (255, 0, 0, 128))
    img.save(path, fmt)


def make_client_with_image(tmp_path: Path):
    root = tmp_path / "kometa"
    config = root / "config"
    config.mkdir(parents=True)
    (root / "kometa.py").symlink_to(FAKE_KOMETA)
    (config / "config.yml").write_text(
        "libraries:\n"
        "  Movies:\n    overlay_files:\n      - file: config/overlays.yml\n"
        "  TV Shows:\n    library_name: Series\n"
    )
    (config / "overlays.yml").write_text("overlays:\n  4K:\n    overlay: {name: 4K}\n")
    (config / "fake.json").write_text('{"lines": ["ok"]}')
    posters = config / "overlays" / "Movies Original Posters"
    posters.mkdir(parents=True)
    _create_image(posters / "123.jpg", size=(1200, 1800), fmt="JPEG")
    _create_image(posters / "456.png", size=(400, 600), mode="RGBA", fmt="PNG")

    settings = Settings(
        data_dir=config / ".studio",
        kometa_python=Path(sys.executable),
        kometa_entry=root / "kometa.py",
        kometa_config=config / "config.yml",
        kill_after=0.5,
    )
    app = create_app(settings, static_dir=tmp_path / "no-static")
    return TestClient(app, client=("127.0.0.1", 50000)), config, posters, settings


def test_find_backup_priority_and_resolution(tmp_path: Path):
    folder = tmp_path / "posters"
    folder.mkdir()
    assert find_backup(folder, "100") is None

    # .webp only
    (folder / "100.webp").write_bytes(b"webp")
    assert find_backup(folder, "100") == folder / "100.webp"

    # .jpg beats .webp
    (folder / "100.jpg").write_bytes(b"jpg")
    assert find_backup(folder, "100") == folder / "100.jpg"

    # .png beats .jpg
    (folder / "100.png").write_bytes(b"png")
    assert find_backup(folder, "100") == folder / "100.png"

    # Non-existent folder
    assert find_backup(tmp_path / "missing", "100") is None


def test_shrink_to_webp_dimensions_and_mode(tmp_path: Path):
    # Large image: shrunk to fit 680x1020, keeping aspect ratio
    src_large = tmp_path / "large.jpg"
    _create_image(src_large, size=(1200, 1800), fmt="JPEG")
    dst_large = tmp_path / "large.webp"
    shrink_to_webp(src_large, dst_large)

    assert dst_large.is_file()
    with Image.open(dst_large) as img:
        assert img.format == "WEBP"
        assert img.size == (680, 1020)

    # Small image: never enlarged
    src_small = tmp_path / "small.png"
    _create_image(src_small, size=(300, 450), mode="RGBA", fmt="PNG")
    dst_small = tmp_path / "small.webp"
    shrink_to_webp(src_small, dst_small)

    with Image.open(dst_small) as img:
        assert img.format == "WEBP"
        assert img.size == (300, 450)


def test_get_or_create_original_cache_hit(tmp_path: Path):
    async def go():
        cache_dir = tmp_path / "cache"
        src = tmp_path / "123.jpg"
        _create_image(src, size=(800, 1200))

        # First call generates cache
        cached1 = await get_or_create_original(cache_dir, src, "Movies", "123")
        assert cached1.is_file()
        mtime1 = cached1.stat().st_mtime_ns

        # Second call uses cache without re-decoding
        with patch("starr_studio.overlay_originals.shrink_to_webp") as mock_shrink:
            cached2 = await get_or_create_original(cache_dir, src, "Movies", "123")
            assert cached2 == cached1
            mock_shrink.assert_not_called()
        assert cached2.stat().st_mtime_ns == mtime1

        # Source file updated: new cache file is generated
        time.sleep(0.01)
        os.utime(src, (time.time() + 10, time.time() + 10))
        cached3 = await get_or_create_original(cache_dir, src, "Movies", "123")
        assert cached3 != cached1
        assert cached3.is_file()

    asyncio.run(go())


def test_get_original_poster_route(tmp_path: Path):
    client, config, posters, settings = make_client_with_image(tmp_path)
    with client:
        # 1. Valid backup 123.jpg
        res = client.get("/api/v1/overlays/Movies/original/123")
        assert res.status_code == 200
        assert res.headers["content-type"] == "image/webp"
        assert res.headers["cache-control"] == "private, max-age=86400"

        with Image.open(io.BytesIO(res.content)) as im:
            assert im.format == "WEBP"
            assert im.width <= 680 and im.height <= 1020

        # 2. Second request uses cache (shrink_to_webp not called)
        with patch("starr_studio.overlay_originals.shrink_to_webp") as mock_shrink:
            res2 = client.get("/api/v1/overlays/Movies/original/123")
            assert res2.status_code == 200
            assert res2.content == res.content
            mock_shrink.assert_not_called()

        # 3. No backup -> 404 with specific message
        missing = client.get("/api/v1/overlays/Movies/original/999")
        assert missing.status_code == 404
        assert missing.json()["detail"] == "No original poster backup: Plex's poster is the original"

        # 4. Unknown library -> 404
        unknown_lib = client.get("/api/v1/overlays/Music/original/123")
        assert unknown_lib.status_code == 404

        # 5. Invalid rating keys refused with 400 without reading files
        for bad_key in ("12a", "%2e%2e", "..%2fx"):
            bad = client.get(f"/api/v1/overlays/Movies/original/{bad_key}")
            assert bad.status_code == 400
            assert "numeric" in bad.json()["detail"].lower() or "digits" in bad.json()["detail"].lower()
