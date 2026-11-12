"""Hold Kometa overlay runs while Studio's overlay engine still has posters on Plex."""

import sqlite3
from typing import Any

import httpx

from ..config_sections import read_section
from ..kometa_command import RunRequest
from ..overlays_routes import _library
from ..plex_library import PlexServer, PlexUnavailable
from ..plex_routes import kometa_plex
from ..runner import RunHeld
from ..settings import Settings
from ..wanted import MODE_PARTS
from .apply import studio_posters


async def section_key_for_library(settings: Settings, server: PlexServer, library: str) -> str:
    """The Plex section key for a config.yml library (``library_name`` when set, else the library's name)."""
    plex_name = str(_library(settings, library).get("library_name") or library)
    for found in await server.libraries():
        if found.title == plex_name:
            return found.key
    raise ValueError(f"Plex has no library called {plex_name!r}")


def _libraries_in_run(settings: Settings, request: RunRequest) -> list[str]:
    if request.libraries:
        return list(request.libraries)
    return list((read_section(settings.kometa_config, "libraries") or {}).keys())


class KometaOverlayHold:
    def __init__(self, db: sqlite3.Connection, settings: Settings, http: httpx.AsyncClient) -> None:
        self.db = db
        self.settings = settings
        self.http = http

    async def before_run(self, request: RunRequest, say: Any) -> None:
        if "overlays" not in MODE_PARTS.get(request.mode, MODE_PARTS["all"]):
            return None
        if not studio_posters(self.db):
            return None
        server = kometa_plex(self.settings, self.http)
        try:
            for name in _libraries_in_run(self.settings, request):
                key = await section_key_for_library(self.settings, server, name)
                if studio_posters(self.db, key):
                    count = len(studio_posters(self.db, key))
                    raise RunHeld(
                        f"Studio's overlay engine has its posters on {count} titles in {name}. "
                        "Restore them before Kometa draws overlays there."
                    )
        except RunHeld:
            raise
        except (PlexUnavailable, OSError, ValueError):
            total = len(studio_posters(self.db))
            raise RunHeld(
                f"Studio's overlay engine has its posters on {total} titles and Plex didn't answer, "
                "so this overlay run waits."
            ) from None
        return None
