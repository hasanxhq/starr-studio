"""Original posters for Studio's overlay engine: kept forever, so any poster Studio uploads can be undone.

Layout under ``root`` (``<data dir>/overlay-engine/originals``):
    <rating_key>/<sha256[:16]>.<ext>     every original this title has had (ext from the image's real format)
    <rating_key>/current                 the file name of the current one, one line
    <rating_key>/work-<sha256[:16]>.png  the current original stretched to 1000x1500, so a pass doesn't decode a huge file again

Nothing here ever deletes an original. Contract: docs/plans/overlay-engine.md, 3.4; Phase 2.
"""

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Original:
    rating_key: str
    path: Path
    sha256: str  # of the file's bytes


class OriginalsStore:
    def __init__(self, root: Path) -> None:
        self.root = root

    def current(self, rating_key: str) -> Original | None:
        """The title's current original, or None if Studio has none yet."""
        raise NotImplementedError

    def add(self, rating_key: str, data: bytes) -> Original:
        """Keep ``data`` as the title's original and make it current. Same bytes as an earlier one: that file is reused."""
        raise NotImplementedError

    def working_copy(self, original: Original) -> bytes:
        """The original as a 1000x1500 PNG (stretched, as render_poster does), cached next to it."""
        raise NotImplementedError
