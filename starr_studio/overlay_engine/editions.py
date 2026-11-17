"""A title's edition, the way Kometa's edition overlays find it: from Plex's Edition field or the file name.

The edition names, search words and regexes are copied from Kometa v2.5.4, defaults/overlays/resolution.yml
(the ``edition`` template and its overlays). Kometa is MIT licensed:

    MIT License
    Copyright (c) 2026 meisnate12
    Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
    documentation files (the "Software"), to deal in the Software without restriction, including without limitation
    the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
    to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above
    copyright notice and this permission notice shall be included in all copies or substantial portions of the
    Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
"""

import re

_ENHANCED = (
    r"(?i)\bIMAX Enhanced\b|^(?=.*(DSNP|Disney\+|CORE(?=[ ._-]web[ ._-]?(dl|rip)\b)|\bBC(?=[ ._-]web[ ._-]?(dl|rip)\b)|IMAX[- .]Enhanced)\b)"
    r"(?=.*\b(IMAX|IMAX[- .]Enhanced)\b).*"
)

# (what Studio shows, Kometa's search word, Kometa's extra regex) in Kometa's weight order: its "edition" group shows
# only the heaviest match, so the first match here wins.
EDITIONS: list[tuple[str, str, str | None]] = [
    ("Extended", "Extend", None),
    ("Uncut", "Uncut", None),
    ("Unrated", "Unrated", None),
    ("Special Edition", "Special", None),
    ("Anniversary Edition", "Anniversary", None),
    ("Collector's Edition", "Collector", None),
    ("Diamond Edition", "Diamond", None),
    ("Platinum Edition", "Platinum", None),
    ("Director's Cut", "Director", None),
    ("Final Cut", "Final", None),
    ("International Cut", "International", None),
    ("Theatrical Cut", "Theatrical", None),
    ("Ultimate Cut", "Ultimate", None),
    ("Alternate Cut", "Alternate", None),
    ("Coda Cut", "Coda", None),
    ("IMAX Enhanced", "IMAX Enhanced", _ENHANCED),
    ("IMAX", "IMAX", r"(?i)\bIMAX\b"),
    ("Remastered", "Remaster", None),
    ("Criterion", "Criterion", r"(?i)Criterion|\[CC\]"),
    ("Richard Donner", "Rich", None),
    ("Black & Chrome", "Black", None),
    ("Definitive", "Definitive", None),
    ("Open Matte", "Open Matte", r"(?i)\b(Open[ ._-]?Matte)\b"),
    ("Ulysses", "Ulysses", None),
    ("Producer's Cut", "Producer", None),
]


def _patterns(search: str, extra: str | None) -> list[re.Pattern]:
    found = [
        rf"(?i)edition-\b(4k )?{search}(s|ed)?\b",  # new TRaSH naming: Movie (2001) {edition-Extended}
        rf"(?<=[0-9]{{4}}[)}}>\]]\s)\b(4k )?{search}(s|ed)?\b",  # original TRaSH naming: Movie (2001) Extended (case as Kometa: exact)
    ]
    return [re.compile(p) for p in ([extra] if extra else []) + found]


_COMPILED = [(label, search.lower(), _patterns(search, extra)) for label, search, extra in EDITIONS]


def edition_from(field: str | None, paths: list[str]) -> str | None:
    """Kometa's edition for a title: the heaviest one whose word is in Plex's Edition field (any case, anywhere, as
    Kometa's ``edition`` filter) or whose regexes match a file path. A field naming none of them is shown as written
    (Kometa draws no badge then; Studio keeps the user's words)."""
    for label, word, patterns in _COMPILED:
        if (field and word in field.lower()) or any(p.search(path) for path in paths for p in patterns):
            return label
    return field or None


def edition(metadata: dict) -> str | None:
    paths = [part["file"] for media in metadata.get("Media") or [] for part in media.get("Part") or [] if part.get("file")]
    return edition_from(metadata.get("editionTitle"), paths)
