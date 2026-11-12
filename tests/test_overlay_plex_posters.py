"""Overlay engine: reading and uploading full-size posters through Plex."""

import asyncio
from io import BytesIO

import httpx
import pytest
from fakeplex import REMOTE_URI, SERVER_TOKEN, FakePlex, overlay_poster
from PIL import Image

from starr_studio.overlay_engine import plex_posters
from starr_studio.plex_library import PlexNotFound, PlexServer, PlexUnavailable


def _server(fake: FakePlex) -> PlexServer:
    return PlexServer(httpx.AsyncClient(transport=fake.transport()), REMOTE_URI, SERVER_TOKEN)


def _run(coro):
    return asyncio.run(coro)


def test_sha256_is_hex_digest():
    data = b"hello"
    digest = plex_posters.sha256(data)
    assert len(digest) == 64
    assert digest == digest.lower() and all(c in "0123456789abcdef" for c in digest)


def test_same_image_equal_bytes():
    data = overlay_poster()
    assert plex_posters.same_image(data, data)


def test_same_image_reencoded_jpeg():
    base = overlay_poster()
    buf = BytesIO()
    Image.open(BytesIO(base)).save(buf, "JPEG", quality=50)
    other = buf.getvalue()
    assert base != other
    assert plex_posters.same_image(base, other)


def test_same_image_different_colour():
    a, b = overlay_poster((200, 30, 30)), overlay_poster((30, 200, 30))
    assert not plex_posters.same_image(a, b)


def test_same_image_garbage_bytes():
    assert not plex_posters.same_image(b"not an image", overlay_poster())


def test_current_poster_returns_bytes_and_thumb():
    fake = FakePlex()
    fake.add_overlay_section()
    server = _server(fake)
    try:
        poster = _run(plex_posters.current_poster(server, "4635"))
    finally:
        _run(server.client.aclose())
    assert poster.data == fake.posters["4635"]
    assert poster.thumb == f"/library/metadata/4635/thumb/{fake.poster_versions['4635']}"
    thumb_reqs = [r for r in fake.requests if r.method == "GET" and "/thumb/" in r.url.path]
    assert thumb_reqs
    assert "width" not in thumb_reqs[-1].url.params
    assert "height" not in thumb_reqs[-1].url.params


def test_upload_poster_stores_and_returns_new_thumb():
    fake = FakePlex()
    fake.add_overlay_section()
    server = _server(fake)
    new_bytes = overlay_poster((90, 40, 120))
    old_ver = fake.poster_versions["4635"]
    try:
        thumb = _run(plex_posters.upload_poster(server, "4635", new_bytes))
    finally:
        _run(server.client.aclose())
    assert thumb == f"/library/metadata/4635/thumb/{old_ver + 1}"
    assert fake.posters["4635"] == new_bytes
    assert fake.uploads[-1] == ("4635", new_bytes)


def test_upload_poster_sends_jpeg_content_type():
    fake = FakePlex()
    fake.add_overlay_section()
    server = _server(fake)
    body = overlay_poster()
    try:
        _run(plex_posters.upload_poster(server, "4635", body))
    finally:
        _run(server.client.aclose())
    post = next(r for r in fake.requests if r.method == "POST" and r.url.path.endswith("/posters"))
    assert post.headers.get("Content-Type") == "image/jpeg"


def test_upload_poster_sends_png_content_type():
    fake = FakePlex()
    fake.add_overlay_section()
    server = _server(fake)
    buf = BytesIO()
    Image.new("RGB", (120, 180), (10, 20, 30)).save(buf, "PNG")
    body = buf.getvalue()
    try:
        _run(plex_posters.upload_poster(server, "4635", body))
    finally:
        _run(server.client.aclose())
    post = next(r for r in reversed(fake.requests) if r.method == "POST" and r.url.path.endswith("/posters"))
    assert post.headers.get("Content-Type") == "image/png"


def test_current_poster_no_thumb_raises_not_found():
    fake = FakePlex()
    fake.add_overlay_section()
    fake.OVERLAY_METADATA["9999"] = {"ratingKey": "9999", "type": "movie", "title": "No poster"}
    server = _server(fake)
    try:
        with pytest.raises(PlexNotFound):
            _run(plex_posters.current_poster(server, "9999"))
    finally:
        _run(server.client.aclose())


def test_current_poster_http_500_raises_unavailable():
    fake = FakePlex()
    fake.add_overlay_section()
    fake.poster_http_errors.add("4635")
    server = _server(fake)
    try:
        with pytest.raises(PlexUnavailable):
            _run(plex_posters.current_poster(server, "4635"))
    finally:
        _run(server.client.aclose())
