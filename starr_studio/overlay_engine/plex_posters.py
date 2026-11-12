"""Reading and uploading a title's poster in Plex, full size, for Studio's overlay engine (Phase 2)."""

from dataclasses import dataclass

from ..plex_library import PlexServer


@dataclass(frozen=True)
class Poster:
    thumb: str | None  # Plex's thumb path for it, e.g. /library/metadata/9179/thumb/1762781585
    data: bytes  # the full-size image, as Plex serves it


def sha256(data: bytes) -> str:
    raise NotImplementedError


def same_image(a: bytes, b: bytes) -> bool:
    """True when two posters are the same picture: equal bytes, or near-equal pixels once shrunk (Plex may re-encode)."""
    raise NotImplementedError


async def current_poster(server: PlexServer, rating_key: str) -> Poster:
    """The title's current poster at full size. Raises PlexUnavailable / PlexNotFound like PlexServer."""
    raise NotImplementedError


async def upload_poster(server: PlexServer, rating_key: str, data: bytes) -> str | None:
    """Upload ``data`` as the title's poster (Plex selects it) and return Plex's new thumb path."""
    raise NotImplementedError
