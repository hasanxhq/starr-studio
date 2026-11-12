"""Original posters for Studio's overlay engine: kept forever, so any poster Studio uploads can be undone.

Layout under ``root`` (``<data dir>/overlay-engine/originals``):
    <rating_key>/<sha256[:16]>.<ext>     every original this title has had (ext from the image's real format)
    <rating_key>/current                 the file name of the current one, one line
    <rating_key>/work-<sha256[:16]>.png  the current original stretched to 1000x1500, so a pass doesn't decode a huge file again

Nothing here ever deletes an original. Contract: docs/plans/overlay-engine.md, 3.4; Phase 2.
"""

import hashlib
import io
import os
import re
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

from .style import POSTER_HEIGHT, POSTER_WIDTH

EXTENSIONS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}


@dataclass(frozen=True)
class Original:
    rating_key: str
    path: Path
    sha256: str  # of the file's bytes


def _write_atomic(path: Path, data: bytes) -> None:
    part = path.with_name(f"{path.name}.part.{os.getpid()}")
    try:
        part.write_bytes(data)
        part.replace(path)
    except BaseException:
        part.unlink(missing_ok=True)
        raise


class OriginalsStore:
    def __init__(self, root: Path) -> None:
        self.root = root

    def _folder(self, rating_key: str) -> Path:
        if not re.fullmatch(r"[0-9]+", rating_key):
            raise ValueError(f"Bad rating key: {rating_key!r}")
        return self.root / rating_key

    def current(self, rating_key: str) -> Original | None:
        """The title's current original, or None if Studio has none yet."""
        folder = self._folder(rating_key)
        try:
            path = folder / (folder / "current").read_text().strip()
            data = path.read_bytes()
        except FileNotFoundError:
            return None
        return Original(rating_key, path, hashlib.sha256(data).hexdigest())

    def add(self, rating_key: str, data: bytes) -> Original:
        """Keep ``data`` as the title's original and make it current. Same bytes as an earlier one: that file is reused."""
        folder = self._folder(rating_key)
        try:
            image_format = Image.open(io.BytesIO(data)).format
        except OSError:
            raise ValueError("Not an image") from None
        digest = hashlib.sha256(data).hexdigest()
        path = folder / f"{digest[:16]}.{EXTENSIONS.get(image_format, 'img')}"
        folder.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            _write_atomic(path, data)
        _write_atomic(folder / "current", path.name.encode())
        return Original(rating_key, path, digest)

    def working_copy(self, original: Original) -> bytes:
        """The original as a 1000x1500 PNG (stretched, as render_poster does), cached next to it."""
        path = original.path.with_name(f"work-{original.sha256[:16]}.png")
        if path.exists():
            return path.read_bytes()
        with Image.open(original.path) as source:
            stretched = source.convert("RGB").resize((POSTER_WIDTH, POSTER_HEIGHT), Image.LANCZOS)
        out = io.BytesIO()
        stretched.save(out, "PNG", compress_level=1)
        _write_atomic(path, out.getvalue())
        return out.getvalue()
