"""Kometa pin stays aligned with the Dockerfile, seedbox installer and install docs."""

from __future__ import annotations

import re
from pathlib import Path

from starr_studio.kometa_pin import KOMETA_VERSION

ROOT = Path(__file__).resolve().parent.parent


def test_kometa_pin_matches_every_shipped_reference():
    pinned = f"v{KOMETA_VERSION}"
    docker_tag = re.search(r"^ARG KOMETA_TAG=(\S+)", (ROOT / "Dockerfile").read_text(), re.M).group(1)
    assert pinned == docker_tag
    script = (ROOT / "deploy" / "install-seedbox.sh").read_text()
    script_tag = re.search(r'^KOMETA_TAG="([^"]+)"', script, re.M).group(1)
    assert pinned == script_tag
    doc = (ROOT / "docs" / "install-without-docker.md").read_text()
    assert f"**{pinned}**" in doc
    assert f"--branch {pinned}" in doc
