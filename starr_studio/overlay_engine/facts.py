"""What the overlay engine knows about one title. Gathered from Plex (facts_plex.py), checked by rules (rules.py).

Values are already in the form overlays show them ("4K", "DOLBY VISION", "DD+"), so a style's text can use them as is.
"""

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class TitleFacts:
    rating_key: str
    type: Literal["movie", "show"]
    title: str
    year: int | None = None
    added_at: int | None = None  # Plex addedAt (Unix seconds)
    updated_at: int | None = None  # Plex updatedAt: the facts cache is refreshed when this moves
    resolution: str | None = None  # "4K", "1080P", "720P", "576P", "480P" or "SD"
    hdr: str | None = None  # "DOLBY VISION", "HDR10+", "HDR10", "HLG" or "HDR"; None for SDR
    audio_codec: str | None = None  # "TRUEHD", "DD+", "DD", "DTS-HD MA", "DTS-HD HRA", "DTS", "AAC", "FLAC", "OPUS", "PCM", "MP3"
    atmos: bool = False  # Dolby Atmos on the main audio track
    dts_x: bool = False  # DTS:X on the main audio track
    channels: str | None = None  # "7.1", "5.1", "2.0", "1.0"
    edition: str | None = None  # Plex's edition title, e.g. "Extended"
    imdb: float | None = None  # 0–10, Plex's IMDb rating
    rt_critic: int | None = None  # 0–100, Plex's Rotten Tomatoes critic score
    rt_audience: int | None = None  # 0–100, Plex's Rotten Tomatoes audience score
    tmdb: float | None = None  # 0–10, Plex's TMDb rating
    content_rating: str | None = None  # e.g. "R", "PG-13", "TV-MA"
    runtime_minutes: int | None = None


# Facts a style's show_when can test (rules.py). added_within_days is a rule of its own, on added_at.
FACT_NAMES = frozenset({
    "type", "title", "year", "resolution", "hdr", "audio_codec", "atmos", "dts_x", "channels", "edition",
    "imdb", "rt_critic", "rt_audience", "tmdb", "content_rating", "runtime_minutes",
})

# {placeholders} a style's text can use, and what each shows (rules.py fills them; a missing fact hides the element).
PLACEHOLDERS = {
    "title": "the title",
    "year": "2023",
    "resolution": "4K",
    "hdr": "DOLBY VISION",
    "audio_codec": "DD+",
    "channels": "5.1",
    "audio": "DD+ 5.1, TRUEHD ATMOS 7.1 or DTS:X 7.1: codec, Atmos or DTS:X, channels",
    "edition": "Extended",
    "imdb": "7.7 (one decimal)",
    "rt_critic": "92 (no % sign)",
    "rt_audience": "88 (no % sign)",
    "tmdb": "7.6 (one decimal)",
    "content_rating": "R",
    "runtime": "1h 41m",
}
