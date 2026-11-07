"""Build everything waiting in one library: ready-made picks and saved builder collections (P3a)."""

from __future__ import annotations

import logging
import sqlite3

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from . import collections as col
from . import collection_requests, studio_files
from .builder_routes import (
    AppRunner,
    AppSettings,
    Db,
    Writer,
    _check_requests,
    _collection_in_from_row,
    _config_library,
    _context,
    _kometa_root,
    _missing_now,
    _request_now,
    _title_taken,
)
from .config_write import SaveRefused
from .kometa_command import RunRequest
from .plex_library import PlexNotFound, PlexUnavailable
from .ready_made_routes import (
    STUDIO_LABEL,
    RefIn,
    _library_type,
    _plex_title,
    _restore_rows,
    _snapshot_rows,
    plan_ready_made_build,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/libraries", tags=["build"])


class ReadyMadePart(BaseModel):
    add: list[RefIn] = Field(default_factory=list)
    remove: list[RefIn] = Field(default_factory=list)


class LibraryBuildIn(BaseModel):
    ready_made: ReadyMadePart = Field(default_factory=ReadyMadePart)
    collections: list[int] = Field(default_factory=list)
    download_missing: bool = False
    dry_run: bool = False


def _blocked_item(title: str, reason: str) -> dict:
    return {"title": title, "reason": reason}


async def _plan_builder_collections(
    db: sqlite3.Connection,
    request: Request,
    context,
    library: str,
    collection_ids: list[int],
) -> tuple[list[sqlite3.Row], list[dict]]:
    if not collection_ids:
        return [], []
    rows: list[sqlite3.Row] = []
    for row_id in collection_ids:
        row = col.built_row(db, row_id)
        if row is None or row["library"] != library:
            raise HTTPException(404, f"No such builder collection {row_id} in {library!r}")
        rows.append(row)
    ok: list[sqlite3.Row] = []
    blocked: list[dict] = []
    for row in rows:
        why = await _title_taken(db, request, context, row["title"], int(row["id"]))
        if why:
            blocked.append(_blocked_item(row["title"], why))
        else:
            ok.append(row)
    return ok, blocked


def _response_build(ready_add, builder_rows: list[sqlite3.Row]) -> list[dict]:
    out = [{"kind": "ready_made", "title": entry.title} for _, entry in ready_add]
    out.extend({"kind": "collection", "title": row["title"]} for row in builder_rows)
    return out


def _response_blocked(ready_blocked: list[dict], builder_blocked: list[dict]) -> list[dict]:
    out = [_blocked_item(item["title"], item["reason"]) for item in ready_blocked]
    out.extend(builder_blocked)
    return out


def _response_remove(remove_plan: list[dict]) -> list[dict]:
    return [{"title": item["title"]} for item in remove_plan]


@router.post("/{library}/build")
async def library_build(
    library: str,
    body: LibraryBuildIn,
    request: Request,
    db: Db,
    settings: AppSettings,
    runner: AppRunner,
    writer: Writer,
) -> dict:
    config_lib, all_libraries = _config_library(settings, library)
    library_type = await _library_type(request, settings, config_lib) or "movie"
    root = _kometa_root(settings)
    if root is None:
        raise HTTPException(409, "Studio doesn't know where Kometa is. Set STUDIO_KOMETA_ENTRY.")

    context = await _context(request, settings, library)

    (
        add_entries,
        remove_refs,
        remove_rows,
        remove_plan,
        ready_blocked,
        _maintainerr,
        server,
        library_key,
    ) = await plan_ready_made_build(
        db,
        request,
        settings,
        config_lib,
        library,
        root,
        library_type,
        body.ready_made.add,
        body.ready_made.remove,
        body.download_missing,
        body.dry_run,
    )

    builder_rows, builder_blocked = await _plan_builder_collections(db, request, context, library, body.collections)
    blocked = _response_blocked(ready_blocked, builder_blocked)
    build_list = _response_build(add_entries, builder_rows)
    remove_list = _response_remove(remove_plan)

    collection_names = sorted({entry.kometa_name for _, entry in add_entries} | {row["kometa_name"] for row in builder_rows})
    will_remove = any(item["deletable"] for item in remove_plan)

    plan = {"build": build_list, "remove": remove_list, "blocked": blocked}

    if body.dry_run:
        return plan

    if not collection_names and not will_remove:
        return {**plan, "run_id": None}

    for row in builder_rows:
        if row["download_missing"]:
            item = _collection_in_from_row(row)
            missing = await _missing_now(request, settings, context, item, db)
            _check_requests(request, db, item, missing, already_on=True)

    snapshot = _snapshot_rows(db, library)
    picks = [col.Pick(ref, entry.kometa_name, entry.title) for ref, entry in add_entries]
    try:
        with db:
            if picks:
                added_ids = col.mark_present(db, library, picks)
                if body.download_missing:
                    collection_requests.set_download_missing(db, added_ids, True, keep_cap=True)
            col.mark_absent(db, library, remove_refs)
        written = await studio_files.write_from_db(
            writer, root, db, library, library_type, all_libraries, "Build collections in the library"
        )
    except SaveRefused as refused:
        with db:
            _restore_rows(db, library, snapshot)
        raise HTTPException(refused.status, refused.detail()) from None
    except Exception:
        with db:
            _restore_rows(db, library, snapshot)
        raise

    with db:
        studio_files.record(db, written)

    removed_titles: list[str] = []
    for item, row in zip(remove_plan, remove_rows, strict=True):
        if not item["deletable"]:
            continue
        title_key = item["title"].casefold()
        if server is not None and library_key is not None:
            try:
                labelled = await server.labelled_collections(library_key, STUDIO_LABEL)
                match = next((c for c in labelled if c.title.casefold() == title_key), None)
                if match is not None:
                    labels = await server.collection_labels(match.rating_key)
                    if STUDIO_LABEL in labels:
                        await server.delete_collection(match.rating_key)
            except (PlexUnavailable, PlexNotFound) as error:
                log.warning("Couldn't delete %r from Plex: %s", item["title"], error)
                continue
        with db:
            col.delete_rows(db, [int(row["id"])])
        removed_titles.append(item["title"])

    run_id = None
    if collection_names:
        run_id = runner.enqueue(
            RunRequest(mode="collections", libraries=[library], collections=collection_names),
            trigger="build",
        )
        row_ids: list[int] = [int(row["id"]) for row in builder_rows]
        for ref, _ in add_entries:
            found = db.execute(
                "SELECT id FROM collections WHERE library = ? AND category = ? AND block = ? AND key = ?",
                (library, ref.category, ref.block, ref.key),
            ).fetchone()
            if found:
                row_ids.append(int(found["id"]))
        with db:
            col.set_run(db, row_ids, run_id)
            col.clear_changed(db, row_ids)

        for row in builder_rows:
            if row["download_missing"]:
                item = _collection_in_from_row(row)
                missing = await _missing_now(request, settings, context, item, db)
                await _request_now(request, db, int(row["id"]), missing)

    return {**plan, "run_id": run_id}
