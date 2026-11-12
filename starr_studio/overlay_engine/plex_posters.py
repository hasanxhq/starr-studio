"""Reading and uploading a title's poster in Plex, full size, for Studio's overlay engine (Phase 2)."""

import hashlib
from dataclasses import dataclass
from io import BytesIO
from urllib.parse import urlsplit

from PIL import Image, ImageChops, ImageStat

from ..plex_library import PLEX_IMAGES, PlexNotFound, PlexServer, PlexUnavailable, TIMEOUT


@dataclass(frozen=True)
class Poster:
    thumb: str | None  # Plex's thumb path for it, e.g. /library/metadata/9179/thumb/1762781585
    data: bytes  # the full-size image, as Plex serves it


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _grayscale_small(data: bytes) -> Image.Image | None:
    try:
        with Image.open(BytesIO(data)) as im:
            return im.convert("L").resize((32, 48), Image.Resampling.BILINEAR)
    except Exception:
        return None


def same_image(a: bytes, b: bytes) -> bool:
    """True when two posters are the same picture: equal bytes, or near-equal pixels once shrunk (Plex may re-encode)."""
    if sha256(a) == sha256(b):
        return True
    left, right = _grayscale_small(a), _grayscale_small(b)
    if left is None or right is None:
        return False
    return ImageStat.Stat(ImageChops.difference(left, right)).mean[0] <= 3.0


def _thumb_path(thumb: object) -> str:
    if not isinstance(thumb, str) or not thumb:
        raise PlexNotFound("This title has no poster in Plex")
    return thumb.split("?", 1)[0]


def _content_type(data: bytes) -> str:
    try:
        with Image.open(BytesIO(data)) as im:
            fmt = (im.format or "").upper()
    except Exception:
        fmt = ""
    if fmt == "PNG" or data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    return "image/jpeg"


async def _fetch_full(server: PlexServer, path: str) -> bytes:
    try:
        response = await server.client.get(
            server.url + path,
            headers={"X-Plex-Token": server.token},
            timeout=TIMEOUT,
        )
        location = response.headers.get("location", "") if response.is_redirect else ""
        if location and urlsplit(location).hostname == PLEX_IMAGES and urlsplit(location).scheme == "https":
            response = await server.client.get(location, timeout=TIMEOUT)
    except Exception as error:
        raise PlexUnavailable(f"Can't reach Plex: {error}") from None
    if response.status_code != 200:
        raise PlexUnavailable(f"Plex answered HTTP {response.status_code}")
    return response.content


async def current_poster(server: PlexServer, rating_key: str) -> Poster:
    """The title's current poster at full size. Raises PlexUnavailable / PlexNotFound like PlexServer."""
    container = await server._get(f"/library/metadata/{rating_key}")
    entries = container.get("Metadata") or []
    if not entries:
        raise PlexNotFound(f"Plex has nothing at /library/metadata/{rating_key}")
    thumb = _thumb_path(entries[0].get("thumb"))
    data = await _fetch_full(server, thumb)
    return Poster(thumb, data)


async def upload_poster(server: PlexServer, rating_key: str, data: bytes) -> str | None:
    """Upload ``data`` as the title's poster (Plex selects it) and return Plex's new thumb path."""
    try:
        response = await server.client.post(
            f"{server.url}/library/metadata/{rating_key}/posters",
            content=data,
            headers={"Content-Type": _content_type(data), "X-Plex-Token": server.token},
            timeout=TIMEOUT,
        )
    except Exception as error:
        raise PlexUnavailable(f"Can't reach Plex: {error}") from None
    if response.status_code < 200 or response.status_code >= 300:
        raise PlexUnavailable(f"Plex answered HTTP {response.status_code}")
    container = await server._get(f"/library/metadata/{rating_key}")
    entries = container.get("Metadata") or []
    if not entries:
        return None
    thumb = entries[0].get("thumb")
    if not isinstance(thumb, str) or not thumb:
        return None
    return thumb.split("?", 1)[0]
