"""Applying Studio's overlays to Plex and undoing them, safely and incrementally (docs/plans/overlay-engine.md, 3.4).

Per title: gather facts, resolve the style, and compare the fingerprint and Plex's current poster with what Studio
last uploaded. Unchanged: skip. Replaced by someone else: that poster becomes the new original, then redraw. Otherwise
draw from the original and upload. Titles in ``excluded`` (Maintainerr's) are never touched.
"""

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from ..plex_library import PlexServer
from .originals import OriginalsStore
from .style import Style

Kind = Literal["draw", "redraw", "replaced", "skip", "excluded", "restore", "unchanged", "error"]


@dataclass
class Context:
    server: PlexServer
    db: sqlite3.Connection
    originals: OriginalsStore
    library_key: str  # Plex section key
    kometa_backups: Path | None = None  # "<library> Original Posters": a title Kometa overlaid has its untouched poster here


@dataclass(frozen=True)
class Outcome:
    rating_key: str
    title: str
    # draw: first time; redraw: what's drawn changed (or Repair); replaced: someone else's poster became the original
    # and was drawn on; skip: up to date; excluded: Maintainerr's; restore: original put back; unchanged: nothing to
    # restore; error: see message
    kind: Kind
    message: str  # one plain sentence for the UI and the log
    done: bool  # False on a dry run, a skip, or an error


async def apply(
    ctx: Context,
    rating_keys: list[str],
    style: Style,
    style_name: str,
    values: dict[str, Any] | None,
    excluded: set[str],
    *,
    dry_run: bool = False,
    force: bool = False,
) -> list[Outcome]:
    """Draw ``style`` on each title and upload it. ``force`` redraws up-to-date titles too (Repair)."""
    raise NotImplementedError


async def restore(ctx: Context, rating_keys: list[str], *, dry_run: bool = False) -> list[Outcome]:
    """Put each title's original back in Plex."""
    raise NotImplementedError


def studio_posters(db: sqlite3.Connection, library_key: str | None = None) -> list[str]:
    """Rating keys whose poster in Plex is Studio's now (uploaded_sha256 set), in one library or all."""
    if library_key is None:
        rows = db.execute("SELECT rating_key FROM overlay_applied WHERE uploaded_sha256 IS NOT NULL").fetchall()
    else:
        rows = db.execute(
            "SELECT rating_key FROM overlay_applied WHERE library_key = ? AND uploaded_sha256 IS NOT NULL",
            (library_key,),
        ).fetchall()
    return [row["rating_key"] for row in rows]
