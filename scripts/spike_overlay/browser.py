"""Phase 0 spike: render every SVG in <out dir> with Chromium, the same way the editor will show it.

Run with a Python that has Playwright:  python scripts/spike_overlay/browser.py <out dir>
"""

import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path(sys.argv[1]).resolve()

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1000, "height": 1500}, device_scale_factor=1)
    files = sorted(OUT.glob("*.svg"))
    started = time.perf_counter()
    for svg in files:
        html = OUT / f"{svg.stem}.html"
        html.write_text(f'<!doctype html><html><body style="margin:0;background:transparent">{svg.read_text()}</body></html>')
        page.goto(html.as_uri())
        page.evaluate("document.fonts.ready")
        page.wait_for_load_state("networkidle")
        page.screenshot(path=str(OUT / f"{svg.stem}.browser.png"), clip={"x": 0, "y": 0, "width": 1000, "height": 1500}, omit_background=True)
    print(f"{len(files)} SVGs in {time.perf_counter() - started:.1f}s")
    browser.close()
