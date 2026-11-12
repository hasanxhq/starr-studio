"""Applying Studio's overlays to Plex and undoing them, safely and incrementally (docs/plans/overlay-engine.md, 3.4).

Per title: gather facts, resolve the style, and compare the fingerprint and Plex's current poster with what Studio
last uploaded. Unchanged: skip. Replaced by someone else: that poster becomes the new original, then redraw. Otherwise
draw from the original and upload. Titles in ``excluded`` (Maintainerr's) are never touched.

Studio's last upload is kept next to the title's originals as ``uploaded.jpg``, so a poster Plex re-encoded is still
recognised as Studio's (``same_image``) and never taken for a new original.
"""

import asyncio
import hashlib
import json
import logging
import multiprocessing
import os
import sqlite3
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from pydantic import TypeAdapter

from ..overlay_originals import find_backup
from ..plex_library import PlexServer, PlexUnavailable
from .facts_plex import title_facts
from .originals import OriginalsStore
from .plex_posters import current_poster, same_image, sha256, upload_poster
from .render import render_poster
from .rules import resolve
from .style import Element, Style

log = logging.getLogger(__name__)

Kind = Literal["draw", "redraw", "replaced", "skip", "excluded", "restore", "unchanged", "error"]
ENGINE_VERSION = "1"  # bump when the renderer draws the same elements differently, so every title is redrawn
PARALLEL = 4  # titles in flight at once: renders in the pool, uploads to Plex
_ELEMENTS = TypeAdapter(list[Element])
_pool: ProcessPoolExecutor | None = None


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


def fingerprint(elements: list) -> str:
    """What a title's overlay looks like: the resolved elements (style, options and the facts they used) and the renderer."""
    drawn = json.dumps(_ELEMENTS.dump_python(elements, mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(f"{ENGINE_VERSION}:{drawn}".encode()).hexdigest()


def _render_pool() -> ProcessPoolExecutor:
    # Processes, not threads: resvg holds the GIL (Phase 0). forkserver, because forking a process with running threads isn't safe.
    global _pool
    if _pool is None:
        _pool = ProcessPoolExecutor(max_workers=min(PARALLEL, os.cpu_count() or 1), mp_context=multiprocessing.get_context("forkserver"))
    return _pool


def _row(db: sqlite3.Connection, rating_key: str) -> sqlite3.Row | None:
    return db.execute("SELECT title, uploaded_sha256, fingerprint FROM overlay_applied WHERE rating_key = ?", (rating_key,)).fetchone()


def _uploaded_path(ctx: Context, rating_key: str) -> Path:
    return ctx.originals.root / rating_key / "uploaded.jpg"


def _is_studios(ctx: Context, rating_key: str, row: sqlite3.Row, data: bytes) -> bool:
    """Is the poster Plex shows (``data``) the one Studio uploaded last?"""
    if sha256(data) == row["uploaded_sha256"]:
        return True
    uploaded = _uploaded_path(ctx, rating_key)
    return uploaded.is_file() and same_image(data, uploaded.read_bytes())


async def _each(rating_keys: list[str], step) -> list[Outcome]:
    """Run ``step`` for each title, a few at a time; a title that fails says why and doesn't stop the others."""
    gate = asyncio.Semaphore(PARALLEL)

    async def one(rating_key: str) -> Outcome:
        async with gate:
            try:
                return await step(rating_key)
            except (PlexUnavailable, OSError, ValueError) as error:
                log.warning("Overlay engine: %s failed: %s", rating_key, error)
                return Outcome(rating_key, "", "error", str(error), False)

    return list(await asyncio.gather(*(one(key) for key in rating_keys)))


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
    style.option_values(values)  # a bad value fails the whole call before anything is touched

    async def step(rating_key: str) -> Outcome:
        if rating_key in excluded:
            return Outcome(rating_key, "", "excluded", "In a Maintainerr collection, so Maintainerr's overlay stays.", False)
        return await _apply_one(ctx, rating_key, style, style_name, values, dry_run=dry_run, force=force)

    return await _each(rating_keys, step)


async def _apply_one(ctx: Context, rating_key: str, style: Style, style_name: str, values, *, dry_run: bool, force: bool) -> Outcome:
    facts = await title_facts(ctx.server, ctx.db, rating_key, force=True)
    elements = resolve(style, facts, values)
    drawn = fingerprint(elements)
    poster = await current_poster(ctx.server, rating_key)
    row = _row(ctx.db, rating_key)
    title = facts.title or rating_key
    kept = ctx.originals.current(rating_key)

    if row is not None and row["uploaded_sha256"] is not None and _is_studios(ctx, rating_key, row, poster.data):
        if drawn == row["fingerprint"] and not force:
            return Outcome(rating_key, title, "skip", "Already up to date.", False)
        kind, message, new_original = "redraw", "Redrawn from the original.", None
    elif row is not None and row["uploaded_sha256"] is not None:
        # Someone else (Plex, the user, another tool) replaced Studio's poster: theirs is the new original.
        kind, message, new_original = "replaced", "Plex had a new poster; kept it as the original and drew on it.", poster.data
    else:
        backup = find_backup(ctx.kometa_backups, rating_key) if ctx.kometa_backups else None
        candidate = backup.read_bytes() if backup else poster.data  # Kometa's untouched backup, not its overlaid poster
        # After a restore Plex shows the kept original (maybe re-encoded): keep the first copy rather than a lossier one.
        new_original = None if kept is not None and same_image(candidate, kept.path.read_bytes()) else candidate
        kind, message = "draw", "Drawn on Kometa's untouched poster." if backup else "Drawn on the poster Plex shows."

    if dry_run:
        return Outcome(rating_key, title, kind, message, False)
    original = ctx.originals.add(rating_key, new_original) if new_original is not None else kept
    if original is None:
        raise ValueError("No original poster is kept for this title, so Studio won't draw on it")
    work = ctx.originals.working_copy(original)
    jpeg = await asyncio.get_running_loop().run_in_executor(_render_pool(), render_poster, elements, work)
    thumb = await upload_poster(ctx.server, rating_key, jpeg)
    # Atomic: a half-written copy would make Studio's own poster look like someone else's, and become an "original".
    part = _uploaded_path(ctx, rating_key).with_suffix(f".part.{os.getpid()}")
    part.write_bytes(jpeg)
    part.replace(_uploaded_path(ctx, rating_key))
    now = int(time.time())
    ctx.db.execute(
        """INSERT INTO overlay_applied (rating_key, library_key, title, original_sha256, uploaded_sha256, plex_thumb, fingerprint, style,
                                        applied_at, restored_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
           ON CONFLICT (rating_key) DO UPDATE SET library_key = excluded.library_key, title = excluded.title,
               original_sha256 = excluded.original_sha256, uploaded_sha256 = excluded.uploaded_sha256, plex_thumb = excluded.plex_thumb,
               fingerprint = excluded.fingerprint, style = excluded.style, applied_at = excluded.applied_at, restored_at = NULL,
               updated_at = excluded.updated_at""",
        (rating_key, ctx.library_key, title, original.sha256, sha256(jpeg), thumb, drawn, style_name, now, now),
    )
    ctx.db.commit()
    log.info("Overlay engine: %s %s (%s)", kind, title, rating_key)
    return Outcome(rating_key, title, kind, message, True)


async def restore(ctx: Context, rating_keys: list[str], *, dry_run: bool = False) -> list[Outcome]:
    """Put each title's original back in Plex."""
    return await _each(rating_keys, lambda rating_key: _restore_one(ctx, rating_key, dry_run=dry_run))


def _mark_restored(ctx: Context, rating_key: str, thumb: str | None) -> None:
    now = int(time.time())
    ctx.db.execute(
        "UPDATE overlay_applied SET uploaded_sha256 = NULL, fingerprint = NULL, plex_thumb = ?, restored_at = ?, updated_at = ? WHERE rating_key = ?",
        (thumb, now, now, rating_key),
    )
    ctx.db.commit()


async def _restore_one(ctx: Context, rating_key: str, *, dry_run: bool) -> Outcome:
    row = _row(ctx.db, rating_key)
    if row is None or row["uploaded_sha256"] is None:
        return Outcome(rating_key, row["title"] if row else "", "unchanged", "Studio's poster isn't on this title.", False)
    title = row["title"]
    original = ctx.originals.current(rating_key)
    if original is None:
        raise ValueError("No original poster is kept for this title")
    poster = await current_poster(ctx.server, rating_key)
    if not _is_studios(ctx, rating_key, row, poster.data):
        # Never overwrite a poster someone else put there; Studio just stops counting this title as its own.
        if not dry_run:
            _mark_restored(ctx, rating_key, poster.thumb)
        return Outcome(rating_key, title, "unchanged", "Plex already shows another poster, so it was left alone.", False)
    if dry_run:
        return Outcome(rating_key, title, "restore", "The original poster would go back.", False)
    data = original.path.read_bytes()
    if not data.startswith((b"\xff\xd8", b"\x89PNG")):  # Plex takes JPEG or PNG; a WebP backup goes up as its PNG working copy
        data = ctx.originals.working_copy(original)
    thumb = await upload_poster(ctx.server, rating_key, data)
    _mark_restored(ctx, rating_key, thumb)
    log.info("Overlay engine: restored %s (%s)", title, rating_key)
    return Outcome(rating_key, title, "restore", "The original poster is back.", True)


def studio_posters(db: sqlite3.Connection, library_key: str | None = None) -> list[str]:
    """Rating keys whose poster in Plex is Studio's now (uploaded_sha256 set), in one library or all."""
    query = "SELECT rating_key FROM overlay_applied WHERE uploaded_sha256 IS NOT NULL"
    params: tuple = ()
    if library_key is not None:
        query, params = query + " AND library_key = ?", (library_key,)
    return [row[0] for row in db.execute(query + " ORDER BY rating_key", params)]
