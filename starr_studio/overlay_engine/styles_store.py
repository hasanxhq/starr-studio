"""Where style files live (docs/plans/overlay-engine.md, 3.6), and each library's choice of style.

Shipped styles sit in the image (styles/) and are read-only; the user's are files in config/studio/styles/, picked up
when edited by hand. A style's id is its file name without .yml. A user file can't take a shipped style's id.
A library's chosen style and option values sit in the overlay_library_style table, keyed by config.yml library name.
"""

import json
import re
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .style import Style, StyleError, load_style

SHIPPED = Path(__file__).parent / "styles"
STYLE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
SCHEMA_FILE = Path(__file__).parent / "style.schema.json"


def style_schema() -> dict:
    """The JSON Schema of the format, as served to the browser's YAML editor and written to style.schema.json.
    It checks shape only; option references and show_when are checked by load_style on the server."""
    schema = Style.model_json_schema()  # no $schema key: the browser's Ajv (draft-07) refuses 2020-12's URI
    schema["title"] = "Starr Studio overlay style, version 1"
    return schema


@dataclass
class StoredStyle:
    id: str
    shipped: bool
    text: str
    style: Style | None  # None when the file doesn't load
    error: str | None = None

    def summary(self) -> dict:
        return {
            "id": self.id,
            "shipped": self.shipped,
            "name": self.style.name if self.style else self.id,
            "description": self.style.description if self.style else "",
            "options": {k: v.model_dump(exclude_none=True) for k, v in self.style.options.items()} if self.style else {},
            "error": self.error,
        }


class StyleStore:
    def __init__(self, user_dir: Path, shipped_dir: Path = SHIPPED):
        self.user_dir, self.shipped_dir = user_dir, shipped_dir

    def _path(self, style_id: str) -> tuple[Path, bool] | None:
        if not STYLE_ID.match(style_id):
            return None
        for folder, shipped in ((self.shipped_dir, True), (self.user_dir, False)):
            path = folder / f"{style_id}.yml"
            if path.is_file():
                return path, shipped
        return None

    def _read(self, path: Path, shipped: bool) -> StoredStyle:
        text = path.read_text(encoding="utf-8")
        try:
            return StoredStyle(path.stem, shipped, text, load_style(text))
        except StyleError as error:
            return StoredStyle(path.stem, shipped, text, None, str(error))

    def list(self) -> list[StoredStyle]:
        found: dict[str, StoredStyle] = {}
        for folder, shipped in ((self.shipped_dir, True), (self.user_dir, False)):
            if folder.is_dir():
                for path in sorted(folder.glob("*.yml")):
                    if path.is_file() and STYLE_ID.match(path.stem) and path.stem not in found:  # a shipped id wins over a user file
                        found[path.stem] = self._read(path, shipped)
        return list(found.values())

    def get(self, style_id: str) -> StoredStyle | None:
        hit = self._path(style_id)
        return self._read(*hit) if hit else None

    def load(self, style_id: str) -> Style:
        """The style, ready to draw; KeyError if there's none, StyleError if its file is broken."""
        stored = self.get(style_id)
        if stored is None:
            raise KeyError(style_id)
        if stored.style is None:
            raise StyleError(stored.error or "broken style file")
        return stored.style

    def save(self, style_id: str, text: str) -> StoredStyle:
        """Write a user style; the text must load. ValueError for a bad or shipped id, StyleError for a bad file."""
        self._check_writable(style_id)
        style = load_style(text)
        self.user_dir.mkdir(parents=True, exist_ok=True)
        path = self.user_dir / f"{style_id}.yml"
        partial = path.with_suffix(".yml.tmp")
        partial.write_text(text, encoding="utf-8")
        partial.replace(path)
        return StoredStyle(style_id, False, text, style)

    def duplicate(self, style_id: str, new_id: str | None = None) -> StoredStyle:
        source = self.get(style_id)
        if source is None:
            raise KeyError(style_id)
        if new_id is None:
            new_id = next(f"{style_id}-copy{'' if n == 1 else f'-{n}'}" for n in range(1, 1000) if self._path(f"{style_id}-copy{'' if n == 1 else f'-{n}'}") is None)
        if self._path(new_id):
            raise ValueError(f"a style called {new_id!r} already exists")
        text = source.text
        if source.style is not None:  # name the copy, keeping the rest of the file (comments included) as it was
            text = re.sub(r"(?m)^name:.*$", f"name: {json.dumps(source.style.name + ' (copy)')}", text, count=1)
        return self.save(new_id, text)

    def delete(self, style_id: str) -> None:
        self._check_writable(style_id)
        path = self.user_dir / f"{style_id}.yml"
        if not path.is_file():
            raise KeyError(style_id)
        path.unlink()

    def _check_writable(self, style_id: str) -> None:
        if not STYLE_ID.match(style_id):
            raise ValueError("a style id is lower case letters, digits and -, up to 64 characters")
        if (self.shipped_dir / f"{style_id}.yml").is_file():
            raise ValueError(f"{style_id!r} is shipped with Studio and can't be changed: duplicate it")


def library_style(db: sqlite3.Connection, library: str) -> dict | None:
    row = db.execute("SELECT style, options_json FROM overlay_library_style WHERE library = ?", (library,)).fetchone()
    return {"style": row["style"], "values": json.loads(row["options_json"])} if row else None


def set_library_style(db: sqlite3.Connection, library: str, style_id: str, values: dict[str, Any]) -> None:
    db.execute(
        "INSERT INTO overlay_library_style (library, style, options_json, updated_at) VALUES (?, ?, ?, ?) "
        "ON CONFLICT (library) DO UPDATE SET style = excluded.style, options_json = excluded.options_json, updated_at = excluded.updated_at",
        (library, style_id, json.dumps(values), int(time.time())),
    )
    db.commit()
