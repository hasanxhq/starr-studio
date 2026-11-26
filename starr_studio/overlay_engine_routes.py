"""/api/v1/overlay-engine: Studio's own overlay engine (docs/plans/overlay-engine.md). Phase 1: preview only.

POST /preview draws a style on one title's poster and returns the JPEG, exactly as the engine would upload it later.
Nothing is written to Plex. The poster is Kometa's untouched backup when the request names a config.yml library that
has one; otherwise Plex's current poster, which may already carry overlays (the X-Poster-Source header says which).

Phase 2: apply and restore named titles, list what Studio has on Plex, with dry runs by default.

Phase 3: style files (shipped and the user's, with a JSON Schema) and each library's chosen style and option values.
Preview and apply take a style id, a whole style file, or neither, which means the library's chosen style.

Phase 4: the editor. POST /scene gives the editor's SVG for up to 12 titles: each element wrapped in
<g data-path="elements.1.children.0"> (its place in the style file) with its box, and the poster's href left as
POSTER_HREF for the browser to replace with its own poster URL. GET /libraries/{library}/samples picks varied titles.
"""

import asyncio
import re
import time
from dataclasses import asdict
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Path, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field, model_validator

from .overlay_engine.apply import Context, apply as apply_titles, restore as restore_titles, studio_posters
from .overlay_engine.facts import TitleFacts
from .overlay_engine.facts_plex import library_facts, title_facts
from .overlay_engine.kometa_hold import section_key_for_library
from .overlay_engine.originals import OriginalsStore
from .overlay_engine.render import render_poster, scene_svg
from .overlay_engine.rules import resolve
from .overlay_engine.share import MAX_BODY, export_zip, read_upload
from .overlay_engine.style import Style, StyleError, load_style
from .overlay_engine.styles_store import STYLE_ID, StyleStore, library_style, set_library_style, style_schema
from .overlay_originals import find_backup
from .overlays_routes import _library, backup_folder
from .plex_routes import _plex_read, kometa_plex
from .services import AppSettings
from .settings import Settings

router = APIRouter(prefix="/api/v1/overlay-engine", tags=["overlay-engine"])
DEFAULT_STYLE = "modern-streaming"
POSTER_HREF = "studio-poster:"  # in /scene's SVG: the browser puts its poster URL here
NEW_DAYS = 14  # a sample counts as recently added within this many days


def style_store(settings: Settings) -> StyleStore:
    base = settings.kometa_config.parent if settings.kometa_config else settings.data_dir
    return StyleStore(base / "studio" / "styles")


def _load_style(
    settings: Settings,
    request: Request,
    style: str | None,
    yaml: str | None,
    values: dict[str, Any] | None,
    library: str | None = None,
) -> tuple[Style, str, dict[str, Any] | None]:
    """The style to draw, its name for overlay_applied, and the option values. Neither style nor yaml: the library's
    chosen style with its saved values (request values, if any, replace them)."""
    if style is not None and yaml is not None:
        raise HTTPException(422, "Give a style name or a style file, not both")
    if style is None and yaml is None:
        if library is None:
            raise HTTPException(422, "Give a style name or a style file (or a library, to use its chosen style)")
        chosen = library_style(request.app.state.db, library) or {"style": DEFAULT_STYLE, "values": {}}
        style, values = chosen["style"], values if values is not None else chosen["values"]
    try:
        if yaml is not None:
            loaded = load_style(yaml)
        else:
            try:
                loaded = style_store(settings).load(style)
            except KeyError:
                raise HTTPException(404, f"No style called {style!r}") from None
        loaded.option_values(values)  # a bad value is the request's fault, so say it before asking Plex
    except (StyleError, ValueError) as error:
        raise HTTPException(422, str(error)) from None
    return loaded, style if style is not None else loaded.name, values


def _thumb(facts: TitleFacts) -> str:
    # the number after thumb/ only busts caches; Plex sends the current poster for any
    return f"/library/metadata/{facts.rating_key}/thumb/{facts.updated_at or 0}"


class SceneRequest(BaseModel):
    library: str
    rating_keys: list[Annotated[str, Field(pattern=r"^[0-9]+$")]] = Field(min_length=1, max_length=12)
    style: str | None = Field(None, pattern=r"^[a-z0-9-]+$")
    yaml: str | None = Field(None, max_length=200_000)
    values: dict[str, Any] | None = None


class PreviewRequest(BaseModel):
    rating_key: str = Field(pattern=r"^[0-9]+$")
    style: str | None = Field(None, pattern=r"^[a-z0-9-]+$")  # a style id, e.g. "modern-streaming"
    yaml: str | None = None  # or a whole style file; neither: the library's chosen style
    values: dict[str, Any] | None = None  # option values; the library's saved ones or the style's defaults otherwise
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


async def _guard_maintainerr(request: Request) -> None:
    service = request.app.state.maintainerr
    if not service.connected():
        return
    await service.refresh()
    if service.snapshot.error:
        raise HTTPException(503, f"Can't apply overlays while Maintainerr's collections can't be read: {service.snapshot.error}")


async def _validate_rating_keys(server, library_key: str, rating_keys: list[str]) -> None:
    for rating_key in rating_keys:
        entries = (await _plex_read(server._get(f"/library/metadata/{rating_key}"))).get("Metadata") or []
        if not entries:
            raise HTTPException(404, f"Plex has no title {rating_key}")
        section = str(entries[0].get("librarySectionID") or "")
        if not section or section != library_key:
            raise HTTPException(422, f"Title {rating_key} isn't in this library")


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
    if body.library:
        _library(settings, body.library)  # 404 if config.yml has no such library
    style, _, values = _load_style(settings, request, body.style, body.yaml, body.values, body.library)

    server = kometa_plex(settings, request.app.state.http)
    facts = await _plex_read(title_facts(server, request.app.state.db, body.rating_key, force=body.refresh))
    backup = None
    if body.library:
        backup = find_backup(backup_folder(settings.kometa_config, body.library), body.rating_key)
    if backup:
        poster, source = backup.read_bytes(), "original"
    else:
        # the number after thumb/ only busts caches; Plex sends the current poster for any
        poster, _ = await _plex_read(server.image(f"/library/metadata/{body.rating_key}/thumb/{facts.updated_at or 0}", 1000, 1500))
        source = "plex"
    elements = resolve(style, facts, values)
    # shortcut: one render at a time in a thread (~0.2 s; resvg holds the GIL meanwhile); Phase 2 adds a process pool
    try:
        jpeg = await asyncio.to_thread(render_poster, elements, poster)
    except ValueError as error:  # a style's raw svg that isn't allowed
        raise HTTPException(422, str(error)) from None
    return Response(jpeg, media_type="image/jpeg", headers={"X-Poster-Source": source, "Cache-Control": "no-store"})


@router.post("/apply")
async def apply(body: ApplyRequest, request: Request, settings: AppSettings) -> dict:
    ctx = await _context(request, settings, body.library)
    style, style_name, values = _load_style(settings, request, body.style, body.yaml, body.values, body.library)
    await _guard_maintainerr(request)
    await _validate_rating_keys(ctx.server, ctx.library_key, body.rating_keys)
    excluded = await _maintainerr_excluded(request, ctx.library_key, ctx.server)
    outcomes = await apply_titles(
        ctx,
        body.rating_keys,
        style,
        style_name,
        values,
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


@router.get("/libraries/{library}/posters")
async def posters(
    library: str,
    request: Request,
    settings: AppSettings,
    q: Annotated[str, Query(max_length=200)] = "",
    start: Annotated[int, Query(ge=0)] = 0,
    size: Annotated[int, Query(ge=1, le=100)] = 48,
) -> dict:
    """A page of the library's titles, newest first (or matching q), each with what Studio has on its poster:
    the gallery's grid. thumb is Plex's poster path for /api/v1/plex/image."""
    _library(settings, library)
    server = kometa_plex(settings, request.app.state.http)
    try:
        library_key = await _plex_read(section_key_for_library(settings, server, library))
    except ValueError as error:
        raise HTTPException(404, str(error)) from None
    library_type = next((lib.type for lib in await _plex_read(server.libraries()) if lib.key == library_key), "")
    items, total = await _plex_read(server.library_items(library_key, library_type, start, size, q.strip()))
    keys = [item.rating_key for item in items]
    applied = {
        row["rating_key"]: row
        for row in request.app.state.db.execute(
            f"SELECT rating_key, style, applied_at, restored_at, (uploaded_sha256 IS NOT NULL) AS studio_poster "
            f"FROM overlay_applied WHERE rating_key IN ({','.join('?' * len(keys))})",
            keys,
        )
    } if keys else {}
    return {
        "start": start,
        "total": total,
        "items": [
            {
                "rating_key": item.rating_key,
                "title": item.title,
                "year": item.year,
                "thumb": item.thumb,
                "studio_poster": bool(applied[item.rating_key]["studio_poster"]) if item.rating_key in applied else False,
                "style": applied[item.rating_key]["style"] if item.rating_key in applied else None,
                "applied_at": applied[item.rating_key]["applied_at"] if item.rating_key in applied else None,
                "restored_at": applied[item.rating_key]["restored_at"] if item.rating_key in applied else None,
            }
            for item in items
        ],
    }


@router.get("/titles")
async def titles(library: str, request: Request, settings: AppSettings) -> list[dict]:
    _library(settings, library)
    server = kometa_plex(settings, request.app.state.http)
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


StyleId = Annotated[str, Path(pattern=r"^[a-z0-9][a-z0-9-]{0,63}$")]


class StyleFile(BaseModel):
    yaml: str = Field(max_length=200_000)


class DuplicateRequest(BaseModel):
    id: str | None = Field(None, pattern=r"^[a-z0-9][a-z0-9-]{0,63}$")


class LibraryStyle(BaseModel):
    style: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{0,63}$")
    values: dict[str, Any] = Field(default_factory=dict)


def _stored(settings: Settings, style_id: str):
    stored = style_store(settings).get(style_id)
    if stored is None:
        raise HTTPException(404, f"No style called {style_id!r}")
    return stored


@router.get("/style-schema")
async def schema() -> dict:
    return style_schema()


@router.get("/styles")
async def list_styles(settings: AppSettings) -> list[dict]:
    return [stored.summary() for stored in style_store(settings).list()]


@router.post("/scene")
async def scene(body: SceneRequest, request: Request, settings: AppSettings) -> dict:
    """The editor's SVG of the style on each title (see the module docstring). A title Plex can't read gets error."""
    _library(settings, body.library)
    style, _, values = _load_style(settings, request, body.style, body.yaml, body.values, body.library)
    server = kometa_plex(settings, request.app.state.http)
    items = []
    for rating_key in body.rating_keys:
        try:
            facts = await _plex_read(title_facts(server, request.app.state.db, rating_key))
        except HTTPException as error:
            items.append({"rating_key": rating_key, "error": str(error.detail)})
            continue
        boxes: dict[str, list[float]] = {}
        try:
            svg = scene_svg(resolve(style, facts, values), POSTER_HREF, boxes)
        except ValueError as error:  # a style's raw svg that isn't allowed
            raise HTTPException(422, str(error)) from None
        items.append({"rating_key": rating_key, "title": facts.title, "year": facts.year, "thumb": _thumb(facts), "svg": svg, "boxes": boxes})
    return {"items": items}


def _traits(facts: TitleFacts, now: float) -> set[str]:
    resolution = facts.resolution or "unknown"
    return {
        f"resolution:{'4K' if resolution == '4K' else '1080P' if resolution == '1080P' else 'lower'}",
        f"hdr:{'yes' if facts.hdr else 'no'}",
        f"imdb:{'yes' if facts.imdb is not None else 'no'}",
        f"rt:{'yes' if facts.rt_critic is not None else 'no'}",
        f"new:{'yes' if facts.added_at and now - facts.added_at < NEW_DAYS * 86400 else 'no'}",
        f"audio:{'atmos' if facts.atmos or facts.dts_x else 'other'}",
    }


def pick_samples(all_facts: list[TitleFacts], count: int, now: float) -> list[tuple[TitleFacts, set[str]]]:
    """Up to count titles that between them show as many kinds of title as they can (4K and 1080p, HDR or not,
    with and without scores, new or not): each pick is the one adding the most kinds not yet shown, newest first."""
    pool = sorted(all_facts, key=lambda f: -(f.added_at or 0))
    traits = {f.rating_key: _traits(f, now) for f in pool}
    picked: list[tuple[TitleFacts, set[str]]] = []
    seen: set[str] = set()
    while pool and len(picked) < count:
        best = max(pool, key=lambda f: len(traits[f.rating_key] - seen))  # max keeps the first (newest) of equals
        pool.remove(best)
        picked.append((best, traits[best.rating_key]))
        seen |= traits[best.rating_key]
    return picked


@router.get("/libraries/{library}/samples")
async def samples(library: str, request: Request, settings: AppSettings, count: Annotated[int, Query(ge=1, le=12)] = 12) -> dict:
    """Varied titles to try a style on (pick_samples). Reads every title's facts, from the cache where it's current."""
    _library(settings, library)
    server = kometa_plex(settings, request.app.state.http)
    try:
        library_key = await _plex_read(section_key_for_library(settings, server, library))
    except ValueError as error:
        raise HTTPException(404, str(error)) from None
    library_type = next((lib.type for lib in await _plex_read(server.libraries()) if lib.key == library_key), "")
    facts = await _plex_read(library_facts(server, request.app.state.db, library_key, library_type))
    picked = pick_samples(list(facts.values()), count, time.time())
    return {
        "items": [
            {"rating_key": f.rating_key, "title": f.title, "year": f.year, "thumb": _thumb(f), "traits": sorted(traits)}
            for f, traits in picked
        ]
    }


@router.get("/styles/{style_id}")
async def get_style(style_id: StyleId, settings: AppSettings) -> dict:
    stored = _stored(settings, style_id)
    return {**stored.summary(), "yaml": stored.text}


@router.put("/styles/{style_id}")
async def save_style(style_id: StyleId, body: StyleFile, settings: AppSettings) -> dict:
    try:
        stored = style_store(settings).save(style_id, body.yaml)
    except StyleError as error:
        raise HTTPException(422, str(error)) from None
    except ValueError as error:
        raise HTTPException(409, str(error)) from None
    return {**stored.summary(), "yaml": stored.text}


@router.post("/styles/{style_id}/duplicate")
async def duplicate_style(style_id: StyleId, body: DuplicateRequest, settings: AppSettings) -> dict:
    try:
        stored = style_store(settings).duplicate(style_id, body.id)
    except KeyError:
        raise HTTPException(404, f"No style called {style_id!r}") from None
    except StyleError as error:
        raise HTTPException(422, str(error)) from None
    except ValueError as error:
        raise HTTPException(409, str(error)) from None
    return {**stored.summary(), "yaml": stored.text}


@router.delete("/styles/{style_id}", status_code=204)
async def delete_style(style_id: StyleId, request: Request, settings: AppSettings) -> Response:
    in_use = [r["library"] for r in request.app.state.db.execute("SELECT library FROM overlay_library_style WHERE style = ?", (style_id,))]
    if in_use:
        raise HTTPException(409, f"{', '.join(in_use)} use this style: choose another style for them first")
    try:
        style_store(settings).delete(style_id)
    except KeyError:
        raise HTTPException(404, f"No style called {style_id!r}") from None
    except ValueError as error:
        raise HTTPException(409, str(error)) from None
    return Response(status_code=204)


@router.get("/styles/{style_id}/export")
async def export_style(style_id: StyleId, settings: AppSettings) -> Response:
    stored = _stored(settings, style_id)
    return Response(export_zip(stored), media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{style_id}.zip"'})


def _default_id(filename: str) -> str:
    """Lower-cased stem, runs of non-[a-z0-9] collapsed to one '-', trimmed, capped at 64."""
    stem = filename.rsplit(".", 1)[0]
    return re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-")[:64]


@router.post("/styles/import")
async def import_style(request: Request, settings: AppSettings, filename: str = Query(...), id: str | None = Query(None)) -> dict:
    data = bytearray()
    async for chunk in request.stream():  # stop reading past the limit rather than holding any size in memory
        data += chunk
        if len(data) > MAX_BODY:
            raise HTTPException(422, "File must be 1 MB or smaller")
    try:
        text = read_upload(bytes(data), filename)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    style_id = id if id is not None else _default_id(filename)
    if not style_id:
        raise HTTPException(422, "Can't work out a style id from the filename; pass one in the id parameter")
    if not STYLE_ID.fullmatch(style_id):  # match() lets a trailing newline through
        raise HTTPException(422, f"{style_id!r} isn't a valid style id (lower-case letters, digits and -, up to 64 characters)")
    store = style_store(settings)
    existing = store.get(style_id)
    if existing is not None:
        kind = "shipped" if existing.shipped else "user"
        raise HTTPException(409, f"A {kind} style called {style_id!r} already exists")
    try:
        stored = store.save(style_id, text)
    except StyleError as error:
        raise HTTPException(422, str(error)) from None
    except ValueError as error:
        raise HTTPException(409, str(error)) from None
    return {**stored.summary(), "yaml": stored.text}


@router.get("/libraries/{library}/style")
async def get_library_style(library: str, request: Request, settings: AppSettings) -> dict:
    _library(settings, library)
    saved = library_style(request.app.state.db, library)
    return {**(saved or {"style": DEFAULT_STYLE, "values": {}}), "saved": saved is not None}


@router.put("/libraries/{library}/style")
async def put_library_style(library: str, body: LibraryStyle, request: Request, settings: AppSettings) -> dict:
    _library(settings, library)
    _load_style(settings, request, body.style, None, body.values)  # 404 / 422 before saving
    set_library_style(request.app.state.db, library, body.style, body.values)
    return {"style": body.style, "values": body.values, "saved": True}
