"""Read overlay facts from Plex (read-only) and cache them in SQLite."""

import asyncio
import dataclasses
import json
import sqlite3
import time

from starr_studio.overlay_engine.facts import TitleFacts
from starr_studio.plex_library import PlexServer

_MAX_FETCH = 8

_RESOLUTION = {"4k": "4K", "1080": "1080P", "720": "720P", "576": "576P", "480": "480P", "sd": "SD"}

_CODEC_NAMES = {
    "truehd": "TRUEHD",
    "eac3": "DD+",
    "ac3": "DD",
    "dca-ma": "DTS-HD MA",
    "aac": "AAC",
    "flac": "FLAC",
    "opus": "OPUS",
    "pcm": "PCM",
    "mp3": "MP3",
}


def _resolution(media: dict) -> str | None:
    return _RESOLUTION.get((media.get("videoResolution") or "").lower())


def _first_video_stream(metadata: dict) -> dict | None:
    for part in (metadata.get("Media") or [{}])[0].get("Part") or []:
        for stream in part.get("Stream") or []:
            if stream.get("streamType") == 1:
                return stream
    return None


def _hdr(video: dict | None) -> str | None:
    if not video:
        return None
    if video.get("DOVIPresent"):
        return "DOLBY VISION"
    display = video.get("displayTitle") or ""
    if "HDR10+" in display:
        return "HDR10+"
    trc = video.get("colorTrc") or ""
    if trc == "smpte2084":
        return "HDR10"
    if trc == "arib-std-b67":
        return "HLG"
    return None


def _audio_codec_name(codec: str | None, profile: str | None = None) -> str | None:
    if not codec:
        return None
    key = codec.lower()
    if key in ("dca", "dts") and (profile or "").lower() == "hra":
        return "DTS-HD HRA"
    if key in _CODEC_NAMES:
        return _CODEC_NAMES[key]
    return codec.upper()


def _channels(n: int | None) -> str | None:
    if n is None:
        return None
    return {"8": "7.1", "6": "5.1", "2": "2.0", "1": "1.0"}.get(str(n), f"{n}.0")


def _stream_matches_summary(stream: dict, summary_codec: str) -> bool:
    codec = (stream.get("codec") or "").lower()
    profile = (stream.get("profile") or "").lower()
    summary = summary_codec.lower()
    if summary == "dca-ma":
        return codec == "dca" and profile == "ma"
    if summary in ("dca", "dts"):
        return codec in ("dca", "dts")
    return codec == summary


def _audio_streams(metadata: dict) -> list[dict]:
    streams: list[dict] = []
    for part in (metadata.get("Media") or [{}])[0].get("Part") or []:
        streams += [s for s in part.get("Stream") or [] if s.get("streamType") == 2]
    return streams


def _stream_text(stream: dict) -> str:
    return " ".join(
        str(stream.get(k) or "") for k in ("displayTitle", "extendedDisplayTitle", "title", "profile")
    ).lower()


def _atmos_on_summary_track(metadata: dict, summary_codec: str) -> bool:
    return any(
        _stream_matches_summary(s, summary_codec) and "atmos" in _stream_text(s)
        for s in _audio_streams(metadata)
    )


def _dts_x_on_summary_track(metadata: dict, summary_codec: str) -> bool:
    def is_dtsx(text: str) -> bool:
        return "dts:x" in text or "dts-x" in text

    return any(
        _stream_matches_summary(s, summary_codec) and is_dtsx(_stream_text(s))
        for s in _audio_streams(metadata)
    )


def _ratings(metadata: dict) -> tuple[float | None, int | None, int | None, float | None]:
    imdb = rt_critic = rt_audience = tmdb = None
    for row in metadata.get("Rating") or []:
        image = row.get("image") or ""
        value = row.get("value")
        if value is None:
            continue
        if image == "imdb://image.rating":
            imdb = round(float(value), 1)
        elif image in ("rottentomatoes://image.rating.ripe", "rottentomatoes://image.rating.rotten"):
            rt_critic = round(float(value) * 10)
        elif image in ("rottentomatoes://image.rating.upright", "rottentomatoes://image.rating.spilled"):
            rt_audience = round(float(value) * 10)
        elif image == "themoviedb://image.rating":
            tmdb = round(float(value), 1)
    return imdb, rt_critic, rt_audience, tmdb


def facts_from_metadata(m: dict) -> TitleFacts:
    """One ``/library/metadata/{key}`` Metadata dict → facts."""
    rating_key = str(m["ratingKey"])
    kind = m.get("type") or "movie"
    title_type: str = "movie" if kind == "movie" else "show"
    year = int(m["year"]) if m.get("year") is not None else None
    added_at = int(m["addedAt"]) if m.get("addedAt") is not None else None
    updated_at = int(m["updatedAt"]) if m.get("updatedAt") is not None else None
    content_rating = m.get("contentRating") or None
    duration = m.get("duration")
    runtime_minutes = round(duration / 60000) if duration else None
    edition = m.get("editionTitle") or None
    imdb, rt_critic, rt_audience, tmdb = _ratings(m)

    resolution = hdr = audio_codec = channels = None
    atmos = dts_x = False

    if title_type == "movie":
        media = (m.get("Media") or [{}])[0]
        resolution = _resolution(media)
        hdr = _hdr(_first_video_stream(m))
        summary_codec = media.get("audioCodec")
        audio_codec = _audio_codec_name(summary_codec, media.get("audioProfile"))
        channels = _channels(media.get("audioChannels"))
        if summary_codec:
            atmos = _atmos_on_summary_track(m, summary_codec)
            dts_x = _dts_x_on_summary_track(m, summary_codec)
    # shortcut: shows have no library-level media summary; episode facts are gathered later.

    return TitleFacts(
        rating_key=rating_key,
        type=title_type,
        title=str(m.get("title") or ""),
        year=year,
        added_at=added_at,
        updated_at=updated_at,
        resolution=resolution,
        hdr=hdr,
        audio_codec=audio_codec,
        atmos=atmos,
        dts_x=dts_x,
        channels=channels,
        edition=edition,
        imdb=imdb,
        rt_critic=rt_critic,
        rt_audience=rt_audience,
        tmdb=tmdb,
        content_rating=content_rating,
        runtime_minutes=runtime_minutes,
    )


def _cached_row(db: sqlite3.Connection, rating_key: str) -> tuple[TitleFacts | None, int | None]:
    row = db.execute(
        "SELECT facts, updated_at FROM overlay_facts WHERE rating_key = ?", (rating_key,)
    ).fetchone()
    if not row:
        return None, None
    try:
        facts = TitleFacts(**json.loads(row[0]))
    except (json.JSONDecodeError, TypeError):
        return None, None
    return facts, row[1]


def _save_cache(db: sqlite3.Connection, library_key: str, facts: TitleFacts) -> None:
    db.execute(
        """INSERT INTO overlay_facts (rating_key, library_key, updated_at, facts, fetched_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(rating_key) DO UPDATE SET
             library_key = excluded.library_key,
             updated_at = excluded.updated_at,
             facts = excluded.facts,
             fetched_at = excluded.fetched_at""",
        (
            facts.rating_key,
            library_key,
            facts.updated_at,
            json.dumps(dataclasses.asdict(facts)),
            int(time.time()),
        ),
    )


async def _fetch_metadata(server: PlexServer, rating_key: str) -> dict:
    container = await server._get(f"/library/metadata/{rating_key}")
    return (container.get("Metadata") or [{}])[0]


async def title_facts(
    server: PlexServer,
    db: sqlite3.Connection,
    rating_key: str,
    *,
    force: bool = False,
) -> TitleFacts:
    if not force:
        cached, _ = _cached_row(db, rating_key)
        if cached is not None:
            return cached
    metadata = await _fetch_metadata(server, rating_key)
    facts = facts_from_metadata(metadata)
    library_key = str(metadata.get("librarySectionID") or "")
    if not library_key:
        row = db.execute("SELECT library_key FROM overlay_facts WHERE rating_key = ?", (rating_key,)).fetchone()
        library_key = row[0] if row else "0"
    _save_cache(db, library_key, facts)
    db.commit()
    return facts


async def library_facts(
    server: PlexServer,
    db: sqlite3.Connection,
    library_key: str,
    library_type: str,
) -> dict[str, TitleFacts]:
    listing = await server._all(library_key, library_type)
    keys = {str(m["ratingKey"]) for m in listing}
    if keys:
        placeholders = ",".join("?" * len(keys))
        db.execute(
            f"DELETE FROM overlay_facts WHERE library_key = ? AND rating_key NOT IN ({placeholders})",
            (library_key, *sorted(keys)),
        )
    else:
        db.execute("DELETE FROM overlay_facts WHERE library_key = ?", (library_key,))

    sem = asyncio.Semaphore(_MAX_FETCH)

    async def refresh(entry: dict) -> tuple[str, TitleFacts]:
        rating_key = str(entry["ratingKey"])
        updated = int(entry["updatedAt"]) if entry.get("updatedAt") is not None else None
        cached, cached_updated = _cached_row(db, rating_key)
        if cached is not None and cached_updated == updated:
            return rating_key, cached
        async with sem:
            metadata = await _fetch_metadata(server, rating_key)
        facts = facts_from_metadata(metadata)
        _save_cache(db, library_key, facts)
        return rating_key, facts

    pairs = await asyncio.gather(*(refresh(m) for m in listing))
    db.commit()
    return dict(pairs)
