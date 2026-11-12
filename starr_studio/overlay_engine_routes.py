"""/api/v1/overlay-engine: Studio's own overlay engine (docs/plans/overlay-engine.md). Phase 1: preview only.

POST /preview draws a style on one title's poster and returns the JPEG, exactly as the engine would upload it later.
Nothing is written to Plex. The poster is Kometa's untouched backup when the request names a config.yml library that
has one; otherwise Plex's current poster, which may already carry overlays (the X-Poster-Source header says which).

Phase 2: apply and restore named titles, list what Studio has on Plex, with dry runs by default.
"""

import asyncio
from dataclasses import asdict
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field, model_validator

from .overlay_engine.apply import Context, apply as apply_titles, restore as restore_titles, studio_posters
from .overlay_engine.facts_plex import title_facts
from .overlay_engine.kometa_hold import section_key_for_library
from .overlay_engine.originals import OriginalsStore
from .overlay_engine.render import render_poster
from .overlay_engine.rules import resolve
from .overlay_engine.style import Style, StyleError, load_style
from .overlay_originals import find_backup
from .overlays_routes import _library, backup_folder
from .plex_routes import _plex_read, kometa_plex
from .settings import Settings

router = APIRouter(prefix="/api/v1/overlay-engine", tags=["overlay-engine"])
STYLES = Path(__file__).parent / "overlay_engine" / "styles"


def _settings(request: Request) -> Settings:
    return request.app.state.settings


AppSettings = Annotated[Settings, Depends(_settings)]


def _load_style(style: str | None, yaml: str | None, values: dict[str, Any] | None) -> tuple[Style, str]:
    if (style is None) == (yaml is None):
        raise HTTPException(422, "Give a style name or a style file, not both")
    if style is not None and not (STYLES / f"{style}.yml").is_file():
        raise HTTPException(404, f"No style called {style!r}")
    try:
        loaded = load_style(yaml if yaml is not None else (STYLES / f"{style}.yml").read_text())
        loaded.option_values(values)  # a bad value is the request's fault, so say it before asking Plex
    except (StyleError, ValueError) as error:
        raise HTTPException(422, str(error)) from None
    name = style if style is not None else loaded.name
    return loaded, name


class PreviewRequest(BaseModel):
    rating_key: str = Field(pattern=r"^[0-9]+$")
    style: str | None = Field(None, pattern=r"^[a-z0-9-]+$")  # a shipped style, e.g. "modern-streaming"
    yaml: str | None = None  # or a whole style file
    values: dict[str, Any] | None = None  # option values; the style's defaults otherwise
    library: str | None = None  # the config.yml library, to draw on Kometa's untouched backup
    refresh: bool = False  # read the title's facts from Plex again


class ApplyRequest(BaseModel):
    library: str
    rating_keys: list[Annotated[str, Field(pattern=r"^[0-9]+$")]] = Field(min_length=1, max_length=50)
    style: str | None = Field(None, pattern=r"^[a-z0-9-]+$")
    yaml: str | None = None
    values: dict[str, Any] | None = None
    dry_run: bool = True
    force: bool = False


class RestoreRequest(BaseModel):
    library: str
    rating_keys: list[Annotated[str, Field(pattern=r"^[0-9]+$")]] | None = None
    all: bool = False
    dry_run: bool = True

    @model_validator(mode="after")
    def exactly_keys_or_all(self) -> "RestoreRequest":
        if self.all == (self.rating_keys is not None):
            raise ValueError("Give rating_keys or all: true, not both")
        if self.rating_keys is not None and not (1 <= len(self.rating_keys) <= 50):
            raise ValueError("rating_keys must list 1 to 50 titles")
        return self


async def _maintainerr_excluded(request: Request, library_key: str, server) -> set[str]:
    excluded: set[str] = set()
    for collection in request.app.state.maintainerr.snapshot.collections:
        if not collection.active or collection.library_key != library_key or not collection.rating_key:
            continue
        start, size = 0, 50
        while True:
            items, total = await _plex_read(server.collection_items(collection.rating_key, start, size))
            excluded.update(item.rating_key for item in items)
            start += len(items)
            if start >= total or not items:
                break
    return excluded


async def _context(request: Request, settings: Settings, library: str) -> Context:
    _library(settings, library)
    server = kometa_plex(settings, request.app.state.http)
    try:
        library_key = await _plex_read(section_key_for_library(settings, server, library))
    except ValueError as error:
        raise HTTPException(404, str(error)) from None
    return Context(
        server=server,
        db=request.app.state.db,
        originals=OriginalsStore(settings.data_dir / "overlay-engine" / "originals"),
        library_key=library_key,
        kometa_backups=backup_folder(settings.kometa_config, library),
    )


@router.post("/preview")
async def preview(body: PreviewRequest, request: Request, settings: AppSettings) -> Response:
    style, _ = _load_style(body.style, body.yaml, body.values)

    server = kometa_plex(settings, request.app.state.http)
    facts = await _plex_read(title_facts(server, request.app.state.db, body.rating_key, force=body.refresh))
    backup = None
    if body.library:
        _library(settings, body.library)  # 404 if config.yml has no such library
        backup = find_backup(backup_folder(settings.kometa_config, body.library), body.rating_key)
    if backup:
        poster, source = backup.read_bytes(), "original"
    else:
        # the number after thumb/ only busts caches; Plex sends the current poster for any
        poster, _ = await _plex_read(server.image(f"/library/metadata/{body.rating_key}/thumb/{facts.updated_at or 0}", 1000, 1500))
        source = "plex"
    elements = resolve(style, facts, body.values)
    # shortcut: one render at a time in a thread (~0.2 s; resvg holds the GIL meanwhile); Phase 2 adds a process pool
    try:
        jpeg = await asyncio.to_thread(render_poster, elements, poster)
    except ValueError as error:  # a style's raw svg that isn't allowed
        raise HTTPException(422, str(error)) from None
    return Response(jpeg, media_type="image/jpeg", headers={"X-Poster-Source": source, "Cache-Control": "no-store"})


@router.post("/apply")
async def apply(body: ApplyRequest, request: Request, settings: AppSettings) -> dict:
    style, style_name = _load_style(body.style, body.yaml, body.values)
    ctx = await _context(request, settings, body.library)
    excluded = await _maintainerr_excluded(request, ctx.library_key, ctx.server)
    outcomes = await apply_titles(
        ctx,
        body.rating_keys,
        style,
        style_name,
        body.values,
        excluded,
        dry_run=body.dry_run,
        force=body.force,
    )
    return {"dry_run": body.dry_run, "outcomes": [asdict(outcome) for outcome in outcomes]}


@router.post("/restore")
async def restore_route(body: RestoreRequest, request: Request, settings: AppSettings) -> dict:
    ctx = await _context(request, settings, body.library)
    if body.all:
        rating_keys = studio_posters(ctx.db, ctx.library_key)
    else:
        rating_keys = list(body.rating_keys or [])
    outcomes = await restore_titles(ctx, rating_keys, dry_run=body.dry_run)
    return {"dry_run": body.dry_run, "outcomes": [asdict(outcome) for outcome in outcomes]}


@router.get("/titles")
async def titles(library: str, request: Request, settings: AppSettings) -> list[dict]:
    server = kometa_plex(settings, request.app.state.http)
    _library(settings, library)
    try:
        library_key = await _plex_read(section_key_for_library(settings, server, library))
    except ValueError as error:
        raise HTTPException(404, str(error)) from None
    rows = request.app.state.db.execute(
        "SELECT rating_key, title, style, applied_at, restored_at, (uploaded_sha256 IS NOT NULL) AS studio_poster "
        "FROM overlay_applied WHERE library_key = ? ORDER BY updated_at DESC",
        (library_key,),
    ).fetchall()
    return [
        {
            "rating_key": row["rating_key"],
            "title": row["title"],
            "style": row["style"],
            "applied_at": row["applied_at"],
            "restored_at": row["restored_at"],
            "studio_poster": bool(row["studio_poster"]),
        }
        for row in rows
    ]
