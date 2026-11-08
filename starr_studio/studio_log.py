"""Studio's own log: ``<data dir>/logs/studio.log`` (rotated by size) and stderr, so ``docker logs`` keeps working.

Three levels, set in Settings → General or by ``STUDIO_LOG_LEVEL`` (which wins, for problems before the database opens):

- info: what Studio did and why, plus every warning and error;
- debug: also every call Studio makes to other apps (method, URL without secrets, status, time), and HTTP access lines;
- trace: also those calls' bodies, masked and cut short. It goes back to info after 24 hours, so a forgotten
  trace can't fill the disk.

Lines use Kometa's layout (``[2026-11-09 01:33:00,123] module [INFO] message``), so the Logs page reads both alike.
"""

from __future__ import annotations

import asyncio
import logging
import re
import sqlite3
import sys
import time
from logging.handlers import RotatingFileHandler
from pathlib import Path

import httpx

from .db import get_setting, set_setting
from .kometa_files import mask_secrets

TRACE = 5
logging.addLevelName(TRACE, "TRACE")
LEVELS = {"info": logging.INFO, "debug": logging.DEBUG, "trace": TRACE}
LEVEL = "general.log_level"
TRACE_UNTIL = "general.log_trace_until"
TRACE_FOR = 24 * 3600
FILE_NAME = "studio.log"
BODY_LIMIT = 4000
FORMAT = logging.Formatter("[%(asctime)s] %(name)s [%(levelname)s] %(message)s")

log = logging.getLogger(__name__)
_studio = logging.getLogger("starr_studio")
_access = logging.getLogger("uvicorn.access")
_handlers: list[logging.Handler] = []
_revert: asyncio.TimerHandle | None = None

_QUERY_SECRET = re.compile(r"([?&](?:x-plex-token|apikey|api_key|api-key|token|access_token|key|password)=)[^&#\s]*", re.IGNORECASE)
_JSON_SECRET = re.compile(r'("[\w-]*(?:token|key|password|secret)[\w-]*"\s*:\s*")[^"]*(")', re.IGNORECASE)


def mask(text: str) -> str:
    """Hide secrets in a URL or body: query parameters, JSON fields, and what mask_secrets finds in YAML."""
    text = _QUERY_SECRET.sub(r"\1••••", text)
    text = _JSON_SECRET.sub(r"\1••••\2", text)
    return mask_secrets(text)[0]


def setup(folder: Path) -> None:
    """Send Studio's log lines to ``folder/studio.log`` and stderr. Calling it again replaces the earlier handlers."""
    teardown()
    folder.mkdir(parents=True, exist_ok=True)
    file = RotatingFileHandler(folder / FILE_NAME, maxBytes=2 * 1024 * 1024, backupCount=4, encoding="utf-8")
    err = logging.StreamHandler(sys.stderr)
    for handler in (file, err):
        handler.setFormatter(FORMAT)
        _studio.addHandler(handler)
        _handlers.append(handler)
    _access.addHandler(file)  # uvicorn already prints these to stderr itself
    _studio.propagate = False
    apply("info")


def teardown() -> None:
    global _revert
    for handler in _handlers:
        _studio.removeHandler(handler)
        _access.removeHandler(handler)
        handler.close()
    _handlers.clear()
    _studio.propagate = True
    if _revert is not None:
        _revert.cancel()
        _revert = None


def apply(level: str) -> None:
    _studio.setLevel(LEVELS[level])
    _access.setLevel(logging.INFO if level != "info" else logging.WARNING)  # access lines are noise at info


def current(db: sqlite3.Connection, env_level: str | None) -> dict:
    if env_level:
        return {"level": env_level, "from_env": True, "trace_until": None}
    level = get_setting(db, LEVEL) or "info"
    until = get_setting(db, TRACE_UNTIL) if level == "trace" else None
    return {"level": level, "from_env": False, "trace_until": until}


def start(db: sqlite3.Connection, env_level: str | None) -> None:
    """Apply the saved level at startup; a trace that outlived its 24 hours goes back to info."""
    state = current(db, env_level)
    if state["level"] == "trace" and not state["from_env"]:
        left = float(state["trace_until"] or 0) - time.time()
        if left <= 0:
            choose(db, "info")
            return
        _schedule_revert(db, left)
    apply(state["level"])


def choose(db: sqlite3.Connection, level: str) -> None:
    """Save and apply a level from Settings → General."""
    global _revert
    set_setting(db, LEVEL, level)
    set_setting(db, TRACE_UNTIL, time.time() + TRACE_FOR if level == "trace" else None)
    if _revert is not None:
        _revert.cancel()
        _revert = None
    if level == "trace":
        _schedule_revert(db, TRACE_FOR)
    apply(level)
    log.info("Log level set to %s", level)


def _schedule_revert(db: sqlite3.Connection, seconds: float) -> None:
    global _revert
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:  # no loop (a script): the next start reverts it
        return
    _revert = loop.call_later(seconds, lambda: choose(db, "info"))


class LoggingTransport(httpx.AsyncBaseTransport):
    """Logs each outgoing call at debug, and its bodies at trace. Headers (where tokens go) are never logged."""

    def __init__(self, inner: httpx.AsyncBaseTransport):
        self.inner = inner
        self.log = logging.getLogger("starr_studio.http")

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        if not self.log.isEnabledFor(logging.DEBUG):
            return await self.inner.handle_async_request(request)
        started = time.monotonic()
        url = mask(str(request.url))
        try:
            response = await self.inner.handle_async_request(request)
        except httpx.HTTPError as error:
            self.log.debug("%s %s failed after %.0f ms: %s", request.method, url, (time.monotonic() - started) * 1000, error)
            raise
        self.log.debug("%s %s → %s in %.0f ms", request.method, url, response.status_code, (time.monotonic() - started) * 1000)
        if self.log.isEnabledFor(TRACE):
            if request.content:
                self.log.log(TRACE, "%s %s sent: %s", request.method, url, _body(request.content, request.headers))
            if _texty(response.headers):
                if response.is_stream_consumed:  # already in memory (test transports)
                    raw = response.content
                else:
                    raw = b"".join([chunk async for chunk in response.aiter_raw()])  # still compressed: the client decodes it
                    await response.aclose()
                peek = httpx.Response(response.status_code, headers=response.headers, content=raw)
                peek.read()
                self.log.log(TRACE, "%s %s answered: %s", request.method, url, _body(peek.content, response.headers))
                response = httpx.Response(response.status_code, headers=response.headers, content=raw, extensions=response.extensions)
        return response

    async def aclose(self) -> None:
        await self.inner.aclose()


def _texty(headers: httpx.Headers) -> bool:
    kind = headers.get("content-type", "")
    return kind.startswith("text/") or "json" in kind or "xml" in kind


def _body(content: bytes, headers: httpx.Headers) -> str:
    if not _texty(headers) and headers.get("content-type"):
        return f"({len(content)} bytes of {headers['content-type']})"
    text = mask(content[: BODY_LIMIT * 2].decode("utf-8", errors="replace"))
    return text[:BODY_LIMIT] + (" …" if len(content) > BODY_LIMIT else "")
