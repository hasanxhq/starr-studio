"""Export and import overlay style files (overlay engine Phase 3)."""

import io
import struct
import zipfile

from starr_studio.overlay_engine.share import MAX_BODY, MAX_YAML, export_zip, read_upload
from starr_studio.overlay_engine.styles_store import SHIPPED, StoredStyle
from tests.test_overlay_styles_store import MINIMAL
from tests.test_overlays import make_client

API = "/api/v1/overlay-engine"
SHIPPED_TEXT = (SHIPPED / "modern-streaming.yml").read_text("utf-8")


# --- pure functions ----------------------------------------------------------

def test_export_zip_single_entry():
    stored = StoredStyle("modern-streaming", True, SHIPPED_TEXT, None)
    data = export_zip(stored)
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        assert zf.namelist() == ["modern-streaming.yml"]
        assert zf.read("modern-streaming.yml").decode("utf-8") == SHIPPED_TEXT


def test_read_upload_bare_yaml():
    text = read_upload(MINIMAL.encode(), "my-file.yml")
    assert text == MINIMAL


def test_read_upload_yaml_extension_case():
    text = read_upload(MINIMAL.encode(), "Style.YAML")
    assert text == MINIMAL


def test_read_upload_zip():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("custom.yml", MINIMAL)
    text = read_upload(buf.getvalue(), "bundle.zip")
    assert text == MINIMAL


def test_round_trip():
    stored = StoredStyle("modern-streaming", True, SHIPPED_TEXT, None)
    zipped = export_zip(stored)
    text = read_upload(zipped, "modern-streaming.zip")
    assert text == SHIPPED_TEXT


def test_read_upload_too_large():
    try:
        read_upload(b"x" * (MAX_BODY + 1), "big.yml")
        assert False, "should raise"
    except ValueError as exc:
        assert "1 MB" in str(exc)


def test_read_upload_empty():
    try:
        read_upload(b"", "empty.yml")
        assert False, "should raise"
    except ValueError as exc:
        assert "Empty" in str(exc)


def test_read_upload_non_utf8():
    try:
        read_upload(b"\xff\xfe\x00\x01", "bad.yml")
        assert False, "should raise"
    except ValueError as exc:
        assert "UTF-8" in str(exc)


def test_read_upload_zip_two_files():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("a.yml", MINIMAL)
        zf.writestr("b.yml", MINIMAL)
    try:
        read_upload(buf.getvalue(), "two.zip")
        assert False, "should raise"
    except ValueError as exc:
        assert "a.yml, b.yml" in str(exc)


def test_read_upload_zip_nested_path():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("sub/style.yml", MINIMAL)
    try:
        read_upload(buf.getvalue(), "nested.zip")
        assert False, "should raise"
    except ValueError as exc:
        assert "sub/style.yml" in str(exc)


def test_read_upload_zip_dotdot_path():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("../evil.yml", MINIMAL)
    try:
        read_upload(buf.getvalue(), "evil.zip")
        assert False, "should raise"
    except ValueError as exc:
        assert "unsafe" in str(exc).lower()


def test_read_upload_zip_backslash():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        info = zipfile.ZipInfo("sub\\evil.yml")
        zf.writestr(info, MINIMAL)
    try:
        read_upload(buf.getvalue(), "bs.zip")
        assert False, "should raise"
    except ValueError as exc:
        assert "unsafe" in str(exc).lower()


def test_read_upload_zip_absolute_path():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        info = zipfile.ZipInfo("/etc/style.yml")
        zf.writestr(info, MINIMAL)
    try:
        read_upload(buf.getvalue(), "abs.zip")
        assert False, "should raise"
    except ValueError as exc:
        assert "unsafe" in str(exc).lower()


def test_read_upload_zip_directory_entry():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("styles/", "")
    try:
        read_upload(buf.getvalue(), "dir.zip")
        assert False, "should raise"
    except ValueError as exc:
        assert "styles/" in str(exc)


def test_read_upload_zip_non_yml():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("readme.txt", "hi")
    try:
        read_upload(buf.getvalue(), "txt.zip")
        assert False, "should raise"
    except ValueError as exc:
        assert ".yml" in str(exc)


def test_read_upload_zip_yaml_too_large():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("big.yml", "x" * (MAX_YAML + 1))
    try:
        read_upload(buf.getvalue(), "big.zip")
        assert False, "should raise"
    except ValueError as exc:
        assert "200 KB" in str(exc) or "too large" in str(exc).lower()


def _lying_zip(size: int, claimed: int = 100) -> bytes:
    """A deflated zip whose local and central headers both claim ``claimed`` bytes for a ``size``-byte entry."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("bomb.yml", "a" * size)
    data = bytearray(buf.getvalue())
    struct.pack_into("<I", data, 22, claimed)  # local header: uncompressed size
    central = data.index(b"PK\x01\x02")
    struct.pack_into("<I", data, central + 24, claimed)  # central directory: uncompressed size
    return bytes(data)


def test_read_upload_zip_bomb_lying_header():
    """The header says 100 bytes but the entry inflates to far more: refused, never a 500."""
    data = _lying_zip(MAX_YAML * 50)
    assert zipfile.ZipFile(io.BytesIO(data)).infolist()[0].file_size == 100
    try:
        read_upload(data, "bomb.zip")
        assert False, "should raise"
    except ValueError as exc:
        assert "bomb.yml" in str(exc)


def test_read_upload_zip_empty():
    buf = io.BytesIO()
    zipfile.ZipFile(buf, "w").close()
    try:
        read_upload(buf.getvalue(), "empty.zip")
        assert False, "should raise"
    except ValueError as exc:
        assert "empty zip" in str(exc)


def test_read_upload_zip_non_utf8_content():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("bad.yml", b"\xff\xfe\x00\x01")
    try:
        read_upload(buf.getvalue(), "bad.zip")
        assert False, "should raise"
    except ValueError as exc:
        assert "UTF-8" in str(exc)


def test_read_upload_bad_extension():
    try:
        read_upload(b"hello", "file.txt")
        assert False, "should raise"
    except ValueError as exc:
        assert ".yml" in str(exc) or ".zip" in str(exc)


# --- route tests (TestClient) -----------------------------------------------

def _refused(tmp_path, query: str, content: bytes, status: int = 422, before: set | None = None) -> str:
    """POST an import, check the status and that no user style file appeared; returns the detail."""
    client, config = make_client(tmp_path)
    user_dir = config / "studio" / "styles"
    with client:
        response = client.post(f"{API}/styles/import?{query}", content=content)
        assert response.status_code == status, response.text
    assert {p.name for p in user_dir.glob("*")} == (before or set())
    return response.json()["detail"]

def test_export_shipped(tmp_path):
    client, config = make_client(tmp_path)
    with client:
        response = client.get(f"{API}/styles/modern-streaming/export")
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/zip"
        assert 'filename="modern-streaming.zip"' in response.headers["content-disposition"]
        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            assert zf.namelist() == ["modern-streaming.yml"]
            assert zf.read("modern-streaming.yml").decode("utf-8") == SHIPPED_TEXT


def test_export_unknown_404(tmp_path):
    client, _ = make_client(tmp_path)
    with client:
        assert client.get(f"{API}/styles/nope/export").status_code == 404


def test_export_user_style(tmp_path):
    client, config = make_client(tmp_path)
    with client:
        client.put(f"{API}/styles/mine", json={"yaml": MINIMAL})
        response = client.get(f"{API}/styles/mine/export")
        assert response.status_code == 200
        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            assert zf.read("mine.yml").decode("utf-8") == MINIMAL


def test_export_broken_user_style(tmp_path):
    """A broken style file can still be exported (it's the user's file)."""
    client, config = make_client(tmp_path)
    user_dir = config / "studio" / "styles"
    user_dir.mkdir(parents=True)
    (user_dir / "broken.yml").write_text("name: [")
    with client:
        response = client.get(f"{API}/styles/broken/export")
        assert response.status_code == 200


def test_export_then_import_round_trip(tmp_path):
    client, config = make_client(tmp_path)
    with client:
        exported = client.get(f"{API}/styles/modern-streaming/export").content
        response = client.post(f"{API}/styles/import?filename=modern-streaming.zip&id=my-modern", content=exported, headers={"Content-Type": "application/zip"})
        assert response.status_code == 200
        result = response.json()
        assert result["id"] == "my-modern"
        assert result["yaml"] == SHIPPED_TEXT
        assert not result["shipped"]


def test_import_bare_yml(tmp_path):
    client, _ = make_client(tmp_path)
    with client:
        response = client.post(f"{API}/styles/import?filename=My+Custom.yml", content=MINIMAL.encode(), headers={"Content-Type": "application/yaml"})
        assert response.status_code == 200
        result = response.json()
        assert result["id"] == "my-custom"
        assert result["yaml"] == MINIMAL


def test_import_default_id_from_filename(tmp_path):
    """Runs of non-[a-z0-9] collapsed to one '-', trimmed, lower-cased."""
    client, _ = make_client(tmp_path)
    with client:
        response = client.post(f"{API}/styles/import?filename=My++Cool___Style!.yml", content=MINIMAL.encode(), headers={"Content-Type": "application/yaml"})
        assert response.status_code == 200
        assert response.json()["id"] == "my-cool-style"


def test_import_explicit_id_wins(tmp_path):
    client, _ = make_client(tmp_path)
    with client:
        response = client.post(f"{API}/styles/import?filename=anything.yml&id=chosen", content=MINIMAL.encode(), headers={"Content-Type": "application/yaml"})
        assert response.status_code == 200
        assert response.json()["id"] == "chosen"


def _zip(**entries: str | bytes) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, text in entries.items():
            zf.writestr(name, text)
    return buf.getvalue()


def test_import_taken_id_409(tmp_path):
    client, config = make_client(tmp_path)
    with client:
        client.put(f"{API}/styles/mine", json={"yaml": MINIMAL})
        response = client.post(f"{API}/styles/import?filename=mine.yml", content=b"# other\n" + MINIMAL.encode())
        assert response.status_code == 409
        assert "'mine'" in response.json()["detail"]
    assert (config / "studio" / "styles" / "mine.yml").read_text("utf-8") == MINIMAL  # never overwritten


def test_import_shipped_id_409(tmp_path):
    detail = _refused(tmp_path, "filename=modern-streaming.yml", MINIMAL.encode(), 409)
    assert "shipped" in detail and "'modern-streaming'" in detail


def test_import_invalid_id_422(tmp_path):
    _refused(tmp_path, "filename=ok.yml&id=Bad.Name", MINIMAL.encode())


def test_import_id_with_trailing_newline_422(tmp_path):
    _refused(tmp_path, "filename=ok.yml&id=ok%0A", MINIMAL.encode())


def test_import_empty_default_id_422(tmp_path):
    assert "id" in _refused(tmp_path, "filename=!!!.yml", MINIMAL.encode())


def test_import_bad_yaml_422(tmp_path):
    _refused(tmp_path, "filename=bad.yml", b"name: [")


def test_import_failing_style_422(tmp_path):
    _refused(tmp_path, "filename=fail.yml", b"studio_style: 1\nname: Broken\nelements: []\n")


def test_import_over_1mb_422(tmp_path):
    assert "1 MB" in _refused(tmp_path, "filename=big.yml", b"x" * (MAX_BODY + 1))


def test_import_zip_two_files_422(tmp_path):
    _refused(tmp_path, "filename=two.zip", _zip(**{"a.yml": MINIMAL, "b.yml": MINIMAL}))


def test_import_zip_nested_422(tmp_path):
    _refused(tmp_path, "filename=nested.zip", _zip(**{"sub/style.yml": MINIMAL}))


def test_import_zip_dotdot_422(tmp_path):
    _refused(tmp_path, "filename=evil.zip", _zip(**{"../evil.yml": MINIMAL}))


def test_import_not_a_zip_422(tmp_path):
    _refused(tmp_path, "filename=junk.zip", b"not a zip")


def test_import_non_utf8_422(tmp_path):
    assert "UTF-8" in _refused(tmp_path, "filename=bad.yml", b"\xff\xfe\x00\x01")


def test_import_zip_yaml_too_large_422(tmp_path):
    """Uncompressed YAML over 200 KB is refused, even though the deflated zip is small."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("big.yml", "a" * (MAX_YAML + 1))
    assert "too large" in _refused(tmp_path, "filename=big.zip", buf.getvalue())


def test_import_zip_bomb_lying_header_422(tmp_path):
    _refused(tmp_path, "filename=bomb.zip", _lying_zip(MAX_YAML * 50))
