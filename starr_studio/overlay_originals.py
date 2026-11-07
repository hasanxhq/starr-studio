"""Original posters for overlays: find Kometa's backup, shrink, and cache.

Kometa keeps an untouched copy of each poster before applying overlays:
    <config dir>/overlays/<library> Original Posters/<rating_key>.{png,jpg,webp}
(kometa/modules/library.py line 73, kometa/modules/overlays.py lines 24-31, 96, 226-231).

Studio shrinks the backup to fit within 680x1020, saves it as WebP under
    <data dir>/overlay-originals/<safe_library>-<rating_key>-<mtime>.webp
and serves it so the overlay designer can preview on untouched artwork.
"""

import asyncio
import os
import re
from pathlib import Path

from fastapi import HTTPException
from PIL import Image

MAX_WIDTH, MAX_HEIGHT = 680, 1020
EXTENSIONS = (".png", ".jpg", ".webp")
BAD_FILENAME = re.compile(r'[\\/:*?"<>|\x00-\x1f]')  # what Kometa strips from a library's name for its folders


def find_backup(folder: Path, rating_key: str) -> Path | None:
    """Find the backup poster for an item in priority order (.png, .jpg, .webp).

    Resolves the candidate path and verifies it stays inside the backup folder.
    """
    try:
        resolved_folder = folder.resolve()
    except OSError:
        return None
    if not resolved_folder.is_dir():
        return None
    for ext in EXTENSIONS:
        try:
            candidate = (resolved_folder / f"{rating_key}{ext}").resolve()
            if candidate.is_relative_to(resolved_folder) and candidate.is_file():
                return candidate
        except (OSError, ValueError):
            continue
    return None


def shrink_to_webp(source_path: Path, target_path: Path) -> None:
    """Shrink an image to fit within 680x1020 (preserving aspect ratio, never enlarging) and save as WEBP."""
    try:
        with Image.open(source_path) as image:
            if image.mode not in ("RGB", "RGBA"):
                mode = "RGBA" if ("A" in image.mode or "transparency" in getattr(image, "info", {})) else "RGB"
                image = image.convert(mode)
            image.thumbnail((MAX_WIDTH, MAX_HEIGHT), Image.Resampling.LANCZOS)
            target_path.parent.mkdir(parents=True, exist_ok=True)
            part = target_path.with_suffix(f".part.{os.getpid()}")
            image.save(part, "WEBP", quality=80, method=6)
            part.replace(target_path)
    except (OSError, Image.DecompressionBombError) as error:
        raise HTTPException(500, f"Cannot process original poster: {error}") from None


async def get_or_create_original(cache_dir: Path, source_path: Path, library: str, rating_key: str) -> Path:
    """Return the cached WebP path for the original poster, generating it if needed off the event loop."""
    safe_library = BAD_FILENAME.sub("", library).strip(".") or "library"
    mtime = source_path.stat().st_mtime_ns
    target_path = cache_dir / f"{safe_library}-{rating_key}-{mtime}.webp"
    if target_path.is_file():
        return target_path
    await asyncio.to_thread(shrink_to_webp, source_path, target_path)
    return target_path
