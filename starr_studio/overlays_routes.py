"""/api/v1/overlays: the Overlays page (feedback round 1). Per library, what draws overlays and when.

For each library in config.yml: its overlay files, whether Kometa's overlays are on or off, Kometa's
Original Posters backup (without it Kometa can't take overlays off again), the last overlay pass,
and Maintainerr's overlays there. Actions:

- Apply now: an overlays-only run for the library.
- Turn off: ``remove_overlays: true`` on the library in config.yml (Kometa restores the original
  posters on every run while it's set, and draws none), then an overlays-only run. With "Leave
  Maintainerr overlays alone" on, that run is wrapped like any poster run: Maintainerr puts its
  posters back first and draws again on the restored originals afterwards.
- Turn on: ``remove_overlays`` taken out again, then an overlays-only run.

Schedules are Studio's ordinary schedules (System → Tasks) with an overlays-only request; the page
lists and adds them through ``/api/v1/schedules``.
"""

import asyncio
import math
import re
from datetime import datetime
from json import loads
from pathlib import Path
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .config_routes import Writer, _write_call
from .config_sections import read_section, save_section
from .kometa_command import RunRequest
from .kometa_files import ConfigReader
from .overlay_originals import BAD_FILENAME, find_backup, get_or_create_original
from .plex_routes import kometa_plex
from .settings import Settings

router = APIRouter(prefix="/api/v1/overlays", tags=["overlays"])
RATING_KEY_PATTERN = re.compile(r"^[0-9]+$")


def _settings(request: Request) -> Settings:
    return request.app.state.settings


AppSettings = Annotated[Settings, Depends(_settings)]


def _reader(settings: Settings) -> ConfigReader:
    if settings.kometa_config is None:
        raise HTTPException(409, "Studio doesn't know where Kometa's config.yml is. Set STUDIO_KOMETA_CONFIG.")
    return ConfigReader(settings.kometa_config, settings.kometa_entry.parent if settings.kometa_entry else None)


def backup_folder(config: Path, library: str) -> Path:
    return config.parent / "overlays" / f"{BAD_FILENAME.sub('', library)} Original Posters"


def _backup(folder: Path) -> dict | None:
    if not folder.is_dir():
        return None
    posters, size = 0, 0
    for entry in folder.iterdir():
        if entry.is_file():
            posters += 1
            size += entry.stat().st_size
    return {"posters": posters, "bytes": size}


def _last_pass(db, library: str) -> dict | None:
    """The newest overlay pass over the library: a run of everything or overlays only, for every collection."""
    for row in db.execute("SELECT id, request, status, started_at, finished_at FROM runs WHERE status != 'queued' ORDER BY id DESC LIMIT 200"):
        request = loads(row["request"])
        if request.get("mode", "all") in ("all", "overlays") and not request.get("collections") and (not request.get("libraries") or library in request["libraries"]):
            return {"run_id": row["id"], "status": row["status"], "started_at": row["started_at"], "finished_at": row["finished_at"]}
    return None


def _last_pass_seconds(last_pass: dict | None) -> int | None:
    if not last_pass or not last_pass.get("started_at") or not last_pass.get("finished_at"):
        return None
    try:
        start = datetime.fromisoformat(last_pass["started_at"].replace("Z", "+00:00"))
        finish = datetime.fromisoformat(last_pass["finished_at"].replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    return max(0, int((finish - start).total_seconds()))


async def _plex_library_sizes(settings: Settings, http: httpx.AsyncClient) -> dict[str, int | None]:
    try:
        server = kometa_plex(settings, http)
        libraries = await server.libraries()
        sizes = await asyncio.gather(*(server.size(lib.key, lib.type) for lib in libraries))
        return {lib.title.casefold(): size for lib, size in zip(libraries, sizes, strict=True)}
    except Exception:
        return {}


def _maintainerr(request: Request, plex_name: str) -> dict | None:
    service = getattr(request.app.state, "maintainerr", None)
    if service is None or not service.connected():
        return None
    titles = service.snapshot.library_titles
    here = [c.title for c in service.snapshot.collections if c.active and c.overlays and titles.get(c.library_key, "").lower() == plex_name.lower()]
    return {"collections": here, "on_top": service.controls()} if here else None


@router.get("")
async def overview(request: Request, settings: AppSettings) -> dict:
    reader = _reader(settings)
    try:
        kometa = reader.read()
    except FileNotFoundError:
        return {"libraries": []}
    except ValueError as error:
        raise HTTPException(409, str(error)) from None
    raw = read_section(settings.kometa_config, "libraries") or {}
    plex_sizes = await _plex_library_sizes(settings, request.app.state.http)
    found = []
    for library in kometa.libraries:
        body = raw.get(library.name) if isinstance(raw.get(library.name), dict) else {}
        plex_name = str(body.get("library_name") or library.name)
        last_pass = _last_pass(request.app.state.db, library.name)
        found.append(
            {
                "library": library.name,
                "plex_name": plex_name,
                "off": bool(body.get("remove_overlays")),
                "files": [
                    {
                        "kind": reference.kind,
                        "value": reference.value,
                        "error": reference.error,
                        "files": [{"path": f.path, "title": f.title, "docs_url": f.docs_url, "overlays": [o["name"] for o in f.overlays]} for f in reference.files],
                    }
                    for reference in library.overlay_files
                ],
                "backup": _backup(backup_folder(settings.kometa_config, library.name)),
                "last_pass": last_pass,
                "maintainerr": _maintainerr(request, plex_name),
                "items": plex_sizes.get(plex_name.casefold()),
                "last_pass_seconds": _last_pass_seconds(last_pass),
            }
        )
    return {"libraries": found}


def _library(settings: Settings, name: str) -> dict:
    libraries = read_section(settings.kometa_config, "libraries") or {}
    if name not in libraries:
        raise HTTPException(404, f"config.yml has no library called {name}")
    return libraries[name] if isinstance(libraries[name], dict) else {}


def _queue(request: Request, library: str) -> dict:
    run_id = request.app.state.runner.enqueue(RunRequest(mode="overlays", libraries=[library]))
    return {"run_id": run_id}


@router.post("/{name}/apply")
async def apply(name: str, request: Request, settings: AppSettings) -> dict:
    _library(settings, name)
    return _queue(request, name)


@router.post("/{name}/off")
async def turn_off(name: str, request: Request, settings: AppSettings, writer: Writer) -> dict:
    """Kometa takes its overlays off this library (and draws none until they're turned on again)."""
    _library(settings, name)
    backup = _backup(backup_folder(settings.kometa_config, name))
    if not backup or not backup["posters"]:
        raise HTTPException(409, f"Kometa has no Original Posters backup for {name}, so it couldn't put the original posters back")
    await _write_call(save_section(writer, ("libraries", name), {"remove_overlays": True}, f"Turned Kometa's overlays off for {name} on the Overlays page"))
    return _queue(request, name)


@router.post("/{name}/on")
async def turn_on(name: str, request: Request, settings: AppSettings, writer: Writer) -> dict:
    _library(settings, name)
    await _write_call(save_section(writer, ("libraries", name), {"remove_overlays": None}, f"Turned Kometa's overlays on for {name} on the Overlays page"))
    return _queue(request, name)


class LayerDraft(BaseModel):
    name: str
    variables: dict[str, Any]


class EstimateRequest(BaseModel):
    layers: list[LayerDraft]


@router.post("/{library}/estimate")
async def estimate(library: str, request_body: EstimateRequest, request: Request, settings: AppSettings) -> dict:
    body = _library(settings, library)
    plex_name = str(body.get("library_name") or library)
    plex_sizes = await _plex_library_sizes(settings, request.app.state.http)
    posters = plex_sizes.get(plex_name.casefold())
    last_pass = _last_pass(request.app.state.db, library)
    duration = _last_pass_seconds(last_pass)
    minutes = max(1, math.ceil(duration / 60)) if duration is not None else None
    return {"posters": posters, "minutes": minutes}


@router.get("/{library}/original/{rating_key:path}")
async def original_poster(library: str, rating_key: str, settings: AppSettings) -> FileResponse:
    if not RATING_KEY_PATTERN.fullmatch(rating_key):
        raise HTTPException(400, "Rating key must be digits only")
    _library(settings, library)
    folder = backup_folder(settings.kometa_config, library)
    source = find_backup(folder, rating_key)
    if source is None:
        raise HTTPException(404, "No original poster backup: Plex's poster is the original")
    cache_dir = settings.data_dir / "overlay-originals"
    cached = await get_or_create_original(cache_dir, source, library, rating_key)
    return FileResponse(
        cached,
        media_type="image/webp",
        headers={"Cache-Control": "private, max-age=86400"},
    )
