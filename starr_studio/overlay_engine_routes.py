"""/api/v1/overlay-engine: Studio's own overlay engine (docs/plans/overlay-engine.md). Phase 1: preview only.

POST /preview draws a style on one title's poster and returns the JPEG, exactly as the engine would upload it later.
Nothing is written to Plex. The poster is Kometa's untouched backup when the request names a config.yml library that
has one; otherwise Plex's current poster, which may already carry overlays (the X-Poster-Source header says which).
"""

import asyncio
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .overlay_engine.facts_plex import title_facts
from .overlay_engine.render import render_poster
from .overlay_engine.rules import resolve
from .overlay_engine.style import StyleError, load_style
from .overlay_originals import find_backup
from .overlays_routes import _library, backup_folder
from .plex_routes import _plex_read, kometa_plex
from .settings import Settings

router = APIRouter(prefix="/api/v1/overlay-engine", tags=["overlay-engine"])
STYLES = Path(__file__).parent / "overlay_engine" / "styles"


def _settings(request: Request) -> Settings:
    return request.app.state.settings


AppSettings = Annotated[Settings, Depends(_settings)]


class PreviewRequest(BaseModel):
    rating_key: str = Field(pattern=r"^[0-9]+$")
    style: str | None = Field(None, pattern=r"^[a-z0-9-]+$")  # a shipped style, e.g. "modern-streaming"
    yaml: str | None = None  # or a whole style file
    values: dict[str, Any] | None = None  # option values; the style's defaults otherwise
    library: str | None = None  # the config.yml library, to draw on Kometa's untouched backup
    refresh: bool = False  # read the title's facts from Plex again


@router.post("/preview")
async def preview(body: PreviewRequest, request: Request, settings: AppSettings) -> Response:
    if (body.style is None) == (body.yaml is None):
        raise HTTPException(422, "Give a style name or a style file, not both")
    if body.style is not None and not (STYLES / f"{body.style}.yml").is_file():
        raise HTTPException(404, f"No style called {body.style!r}")
    try:
        style = load_style(body.yaml if body.yaml is not None else (STYLES / f"{body.style}.yml").read_text())
        style.option_values(body.values)  # a bad value is the request's fault, so say it before asking Plex
    except (StyleError, ValueError) as error:
        raise HTTPException(422, str(error)) from None

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
