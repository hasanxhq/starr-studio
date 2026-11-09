"""Serve Kometa's overlay badge PNGs from ``defaults/overlays/images/`` for the overlay studio preview."""

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse

from .settings import Settings

router = APIRouter(prefix="/api/v1/overlay-images", tags=["overlays"])

CACHE_HEADERS = {"Cache-Control": "public, max-age=86400"}


def _settings(request: Request) -> Settings:
    return request.app.state.settings


AppSettings = Annotated[Settings, Depends(_settings)]


def _images_root(settings: Settings) -> Path | None:
    if settings.kometa_entry is None:
        return None
    return settings.kometa_entry.parent / "defaults" / "overlays" / "images"


@router.get("/{path:path}")
async def overlay_image(path: str, settings: AppSettings) -> FileResponse:
    if not path.lower().endswith(".png"):
        raise HTTPException(404, "Only PNG overlay badge images are available here")

    root = _images_root(settings)
    if root is None:
        raise HTTPException(404, "Studio doesn't know where Kometa is installed")

    resolved_root = root.resolve()
    target = (root / path).resolve()
    if not target.is_relative_to(resolved_root):
        raise HTTPException(404, "That path is outside Kometa's overlay images folder")

    if not target.is_file():
        raise HTTPException(404, "No overlay badge image at that path")

    return FileResponse(target, media_type="image/png", headers=CACHE_HEADERS)
