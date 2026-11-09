"""/api/v1/settings/arr: Radarr, Sonarr and Lidarr on Settings → Connect.

Radarr's and Sonarr's URL, API key, root folder and quality profile are Kometa's, in config.yml's ``radarr:`` and
``sonarr:`` sections; a save writes them there, through the normal save flow. A proxy login is
Studio's own. Lidarr is all Studio's (Kometa has no Lidarr): kept encrypted in SQLite with the root folder and
quality and metadata profiles music requests use. Nothing is saved without a passing test, made again on the
server when saving.
"""

import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from . import arr, wanted
from .arr import App, AppRuns, Arr, ArrProblem, Connection, Kind, LidarrOptions
from .config_routes import Writer, _write_call
from .config_sections import save_section
from .db import delete_setting, get_setting, set_setting
from .runs_routes import get_db
from .services import mask

router = APIRouter(prefix="/api/v1/settings/arr", tags=["arr"])

Db = Annotated[sqlite3.Connection, Depends(get_db)]


def get_arr(request: Request) -> Arr:
    return request.app.state.arr


ArrDep = Annotated[Arr, Depends(get_arr)]


def _connection_json(db: sqlite3.Connection, service: Arr, kind: Kind) -> dict:
    section = arr.config_section(service.config, kind)
    proxy = (get_setting(db, arr.CONNECTIONS) or {}).get(kind) or {}
    token = str(section["token"]) if section.get("token") else None
    return {
        "url": str(section["url"]) if section.get("url") else None,
        "token": mask(token),  # the key and password never leave the server
        "root_folder_path": str(section["root_folder_path"]) if section.get("root_folder_path") else None,
        "quality_profile": str(section["quality_profile"]) if section.get("quality_profile") else None,
        # Kometa's defaults for every collection; a collection's own radarr_add_missing etc. overrides them.
        "add_missing": section.get("add_missing") is True,
        "search": section.get("search") is True,
        "username": proxy.get("username"),
        "has_password": bool(proxy.get("password")),
        "status": get_setting(db, f"arr.status.{kind}"),
    }


def _lidarr_json(db: sqlite3.Connection, service: Arr) -> dict:
    conn = arr.lidarr_connection(db, service.box)
    return {
        "url": conn.url if conn else None,
        "token": mask(conn.api_key) if conn else None,
        "username": conn.login[0] if conn and conn.login else None,
        "has_password": bool(conn and conn.login and conn.login[1]),
        "status": get_setting(db, "arr.status.lidarr"),
    } | arr.lidarr_options(db).model_dump()


def _libraries(db: sqlite3.Connection, service: Arr) -> list[dict]:
    """What Studio can tell about each library, for "only imports that matter"."""
    try:
        return wanted.summary(db, wanted.plan(service.config, service.kometa_root)) if service.config else []
    except (FileNotFoundError, ValueError):
        return []


def state(db: sqlite3.Connection, service: Arr) -> dict:
    return {
        "settings": arr.load_settings(db).model_dump(),
        "connections": {kind: _connection_json(db, service, kind) for kind in arr.KINDS} | {"lidarr": _lidarr_json(db, service)},
        "pending": service.pending(),
        "skipped": {kind: get_setting(db, arr.skipped_key(kind)) or [] for kind in arr.APPS},
        "libraries": _libraries(db, service),
    }


@router.get("")
async def get_arr_settings(db: Db, service: ArrDep) -> dict:
    return state(db, service)


def _kind(kind: str) -> App:
    if kind not in arr.APPS:
        raise HTTPException(404, "Radarr, Sonarr or Lidarr only")
    return kind  # type: ignore[return-value]


@router.post("/reports")
async def turn_on_reports(db: Db, service: ArrDep, writer: Writer) -> dict:
    """Turn on Kometa's missing report (settings.save_report), which tells Studio what each collection wants."""
    await _write_call(save_section(writer, "settings", {"save_report": True}, "Turned on Kometa's missing report in Settings → Connect"))
    return state(db, service)


@router.put("/{kind}/runs")
async def put_runs(kind: str, body: AppRuns, db: Db, service: ArrDep) -> dict:
    which = _kind(kind)
    if which == "lidarr":
        body.trigger = "any"  # nothing tells which music collections want an album
    settings = arr.load_settings(db)
    setattr(settings, which, body)
    set_setting(db, arr.RUNS, settings.model_dump())
    if not body.enabled:
        delete_setting(db, arr.pending_key(which))
    return state(db, service)


class ConnectionIn(BaseModel):
    url: str = Field(max_length=500)
    api_key: str | None = Field(default=None, max_length=200)  # None: keep the token in config.yml
    username: str | None = Field(default=None, max_length=200)  # for a proxy in front of the app; empty: none
    password: str | None = Field(default=None, max_length=500)  # None: keep the saved one
    root_folder_path: str | None = Field(default=None, max_length=500)
    quality_profile: str | None = Field(default=None, max_length=200)
    metadata_profile: str | None = Field(default=None, max_length=200)  # Lidarr only


def _entered(db: sqlite3.Connection, service: Arr, kind: App, body: ConnectionIn) -> Connection:
    saved_lidarr = arr.lidarr_connection(db, service.box) if kind == "lidarr" else None
    if kind == "lidarr":
        token = saved_lidarr.api_key if saved_lidarr else None
    else:
        token = arr.kometa_connection(service.config, kind)[1]
    key = (body.api_key or "").strip() or token
    url = body.url.strip()
    if not url or not key:
        raise HTTPException(422, f"Enter {arr.NAMES[kind]}'s URL and API key")
    username = (body.username or "").strip() or None
    login = None
    if username:
        saved = (saved_lidarr.login if saved_lidarr else None) if kind == "lidarr" else arr.proxy_login(db, service.box, kind)
        login = (username, body.password if body.password is not None else (saved[1] if saved else ""))
    return Connection(url, key, login)


@router.post("/{kind}/test")
async def test(kind: str, body: ConnectionIn, db: Db, service: ArrDep) -> dict:
    """Test the connection as entered (not saved yet), the way the arr apps' own Test buttons do."""
    which = _kind(kind)
    try:
        conn = _entered(db, service, which, body)
        return {"ok": True} | (await arr.test_lidarr(service.http, conn) if which == "lidarr" else await arr.test_connection(service.http, conn, which))
    except ArrProblem as problem:
        return {"ok": False, "error": str(problem)}


@router.put("/{kind}")
async def put_connection(kind: str, body: ConnectionIn, db: Db, service: ArrDep, writer: Writer) -> dict:
    """Test again, then write url, token, root folder and quality profile to config.yml and keep the proxy login."""
    which = _kind(kind)
    conn = _entered(db, service, which, body)
    if which == "lidarr":
        return await _put_lidarr(db, service, conn, body)
    try:
        found = await arr.test_connection(service.http, conn, which)
    except ArrProblem as problem:
        raise HTTPException(422, f"Not saved: {problem}") from None
    if body.root_folder_path and body.root_folder_path not in found["root_folders"]:
        raise HTTPException(422, f"{arr.NAMES[which]} has no root folder {body.root_folder_path}")
    if body.quality_profile and body.quality_profile not in found["quality_profiles"]:
        raise HTTPException(422, f"{arr.NAMES[which]} has no quality profile {body.quality_profile}")
    before = arr.kometa_connection(service.config, which)[0]
    values = {"url": conn.url, "token": conn.api_key, "root_folder_path": body.root_folder_path or None, "quality_profile": body.quality_profile or None}
    await _write_call(save_section(writer, which, values, f"Connected {arr.NAMES[which]} in Settings → Connect"))
    connections = get_setting(db, arr.CONNECTIONS) or {}
    connections[which] = {"username": conn.login[0], "password": service.box.encrypt(conn.login[1]) if conn.login[1] else None} if conn.login else {}
    set_setting(db, arr.CONNECTIONS, connections)
    if before != conn.url:
        service.reset_cursor(which)
    return state(db, service)


async def _put_lidarr(db: sqlite3.Connection, service: Arr, conn: Connection, body: ConnectionIn) -> dict:
    """Test again, then keep Lidarr's connection and request defaults in Studio's database."""
    try:
        found = await arr.test_lidarr(service.http, conn)
    except ArrProblem as problem:
        raise HTTPException(422, f"Not saved: {problem}") from None
    for value, listed, what in (
        (body.root_folder_path, found["root_folders"], "root folder"),
        (body.quality_profile, found["quality_profiles"], "quality profile"),
        (body.metadata_profile, found["metadata_profiles"], "metadata profile"),
    ):
        if value and value not in listed:
            raise HTTPException(422, f"Lidarr has no {what} {value}")
    before = arr.lidarr_connection(db, service.box)
    options = LidarrOptions(root_folder_path=body.root_folder_path or None, quality_profile=body.quality_profile or None, metadata_profile=body.metadata_profile or None)
    arr.save_lidarr(db, service.box, conn, options)
    if before is None or before.url != conn.url:
        service.reset_cursor("lidarr")
    return state(db, service)


@router.delete("/{kind}")
async def remove_connection(kind: str, db: Db, service: ArrDep, writer: Writer) -> dict:
    """Remove the app's section from config.yml (Kometa stops using it too) and Studio's proxy login."""
    which = _kind(kind)
    if which == "lidarr":
        arr.remove_lidarr(db)
        service.reset_cursor(which)
        delete_setting(db, arr.pending_key(which))
        return state(db, service)
    await _write_call(save_section(writer, which, None, f"Removed {arr.NAMES[which]} in Settings → Connect"))
    connections = get_setting(db, arr.CONNECTIONS) or {}
    connections.pop(which, None)
    set_setting(db, arr.CONNECTIONS, connections)
    service.reset_cursor(which)
    delete_setting(db, arr.pending_key(which))
    return state(db, service)
