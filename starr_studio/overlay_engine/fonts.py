"""Fonts the overlay engine ships: Inter (SIL Open Font License 1.1, fonts/OFL.txt), from https://github.com/rsms/inter."""

from pathlib import Path

FONT_DIR = Path(__file__).parent / "fonts"

# A style names a font by family and weight, as people say it.
FONTS = {
    "Inter Regular": "Inter-Regular.ttf",
    "Inter Medium": "Inter-Medium.ttf",
    "Inter SemiBold": "Inter-SemiBold.ttf",
    "Inter Bold": "Inter-Bold.ttf",
    "Inter ExtraBold": "Inter-ExtraBold.ttf",
    "Inter Black": "Inter-Black.ttf",
}


def font_path(name: str) -> Path:
    return FONT_DIR / FONTS[name]
