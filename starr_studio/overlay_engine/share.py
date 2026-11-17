"""Export a style as a zip and read an uploaded zip or bare YAML for import (overlay engine Phase 3)."""

import io
import re
import zipfile
import zlib

from .style import load_style
from .styles_store import StoredStyle

MAX_BODY = 1_048_576       # 1 MB upload limit
MAX_YAML = 204_800         # 200 KB uncompressed YAML
MAX_ZIP_ENTRIES = 20       # refuse zips with more listed entries

_BAD_PATH = re.compile(r"(^/|\\|(?:^|/)\.\.(?:/|$))")  # absolute, backslash or ..


def export_zip(stored: StoredStyle) -> bytes:
    """Pack a style file into a zip: one entry ``<id>.yml`` at the root."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{stored.id}.yml", stored.text)
    return buf.getvalue()


def read_upload(data: bytes, filename: str) -> str:
    """Return the YAML text from an uploaded zip or bare ``.yml``/``.yaml`` file. ValueError on anything wrong."""
    if len(data) > MAX_BODY:
        raise ValueError("File must be 1 MB or smaller")
    if not data:
        raise ValueError("Empty file")
    lower = filename.lower()
    if lower.endswith(".zip"):
        return _read_zip(data)
    if lower.endswith((".yml", ".yaml")):
        return _decode_yaml(data)
    raise ValueError("Send a .zip or .yml/.yaml file")


def _read_zip(data: bytes) -> str:
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ValueError(f"Not a valid zip file: {exc}") from exc
    entries = zf.infolist()
    if len(entries) > MAX_ZIP_ENTRIES:
        raise ValueError(f"Too many entries in the zip ({len(entries)}); expected one .yml file at the root")
    for entry in entries:
        name = entry.filename
        if _BAD_PATH.search(name):
            raise ValueError(f"Refused: entry {name!r} has an unsafe path")
        if entry.is_dir() or "/" in name or not name.lower().endswith((".yml", ".yaml")):
            raise ValueError(f"Refused: entry {name!r} isn't a .yml file at the root; expected one .yml file at the root")
    if len(entries) != 1:
        raise ValueError(f"Expected one .yml file at the root, found {', '.join(e.filename for e in entries) or 'an empty zip'}")
    try:
        with zf.open(entries[0]) as fh:
            raw = fh.read(MAX_YAML + 1)  # bounded: the header's file_size may lie
    except (zipfile.BadZipFile, RuntimeError, NotImplementedError, EOFError, zlib.error) as exc:  # bad CRC, encrypted, odd compression
        raise ValueError(f"Can't read {entries[0].filename!r} from the zip: {exc}") from exc
    if len(raw) > MAX_YAML:
        raise ValueError(f"Style file is too large (over {MAX_YAML // 1024} KB uncompressed)")
    return _decode_yaml(raw)


def _decode_yaml(data: bytes) -> str:
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        raise ValueError("Style file isn't valid UTF-8") from None
