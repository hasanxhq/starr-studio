"""Phase 0 spike: the production path. resvg draws only the overlay (transparent canvas); frosted glass gets just the
crop of the poster under it; Pillow lays the overlay on the poster and writes the JPEG. Checks it matches the full-SVG
render and measures throughput with several workers.

Run with the build.py uv command:  python -I scripts/spike_overlay/fast_path.py <out dir>
"""

import re
import statistics
import sys
import time
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from io import BytesIO
from pathlib import Path

import numpy as np
import resvg_py
from PIL import Image

OUT = Path(sys.argv[1]).resolve()
FONTS = [str(OUT / "fonts" / n) for n in ("Inter-Bold.ttf", "Inter-ExtraBold.ttf", "Inter-Black.ttf")]
POSTER_IMG = re.compile(r'<image href="(posters/\d+\.jpg)" x="0" y="0" width="1000" height="1500" preserveAspectRatio="xMidYMid slice"(/?)>')
FROST = re.compile(r'<filter id="frost" filterUnits="userSpaceOnUse" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)">')


def fast_svg(svg_text, poster):
    """Drop the full-poster background; point frosted glass at a crop of the poster under it."""
    svg_text = POSTER_IMG.sub("", svg_text, count=1)  # the background poster
    m = FROST.search(svg_text)
    if not m:
        return svg_text, None
    x, y, w, h = (float(v) for v in m.groups())
    box = (int(x), int(y), int(np.ceil(x + w)), int(np.ceil(y + h)))
    crop = poster.crop(box)
    buf = BytesIO()
    crop.save(buf, "PNG")
    name = f"crop-{box[0]}-{box[1]}.png"
    svg_text = POSTER_IMG.sub(f'<image href="{name}" x="{box[0]}" y="{box[1]}" width="{box[2]-box[0]}" height="{box[3]-box[1]}"\\2>', svg_text, count=1)
    return svg_text, (name, buf.getvalue())


def apply_one(name):
    started = time.perf_counter()
    key = name.split("-")[0]
    poster = Image.open(OUT / "posters" / f"{key}.jpg").convert("RGBA")
    svg_text, crop = fast_svg((OUT / f"{name}.svg").read_text(), poster)
    workdir = OUT / "fast" / name
    workdir.mkdir(parents=True, exist_ok=True)
    if crop:
        (workdir / crop[0]).write_bytes(crop[1])
    overlay = bytes(resvg_py.svg_to_bytes(svg_string=svg_text, resources_dir=str(workdir), skip_system_fonts=True, font_files=FONTS))
    poster.alpha_composite(Image.open(BytesIO(overlay)).convert("RGBA"))
    buf = BytesIO()
    poster.convert("RGB").save(buf, "JPEG", quality=90)
    (OUT / f"{name}.fast.jpg").write_bytes(buf.getvalue())
    return (time.perf_counter() - started) * 1000


if __name__ == "__main__":
    names = sorted(p.stem for p in OUT.glob("[0-9]*-paths.svg"))
    single = [apply_one(n) for n in names]
    print(f"one at a time: median {statistics.median(single):.0f} ms per poster ({', '.join(f'{n}={t:.0f}' for n, t in zip(names, single))})")
    for n in names:  # same pixels as the full-SVG render? (both compared as JPEG q90 vs PNG, so allow JPEG noise)
        a = np.asarray(Image.open(OUT / f"{n}.fast.jpg").convert("RGB"), dtype=np.int16)
        b = np.asarray(Image.open(OUT / f"{n}.resvg.png").convert("RGB"), dtype=np.int16)
        d = np.abs(a - b).max(axis=2)
        print(f"  {n}: vs full render mean {d.mean():.2f}, >24: {(d > 24).mean() * 100:.3f}%")
    batch = names * 8  # 48 posters
    for label, pool in (("4 threads", ThreadPoolExecutor(4)), ("4 processes", ProcessPoolExecutor(4))):
        started = time.perf_counter()
        with pool:
            list(pool.map(apply_one, batch))
        took = time.perf_counter() - started
        print(f"{label}: {len(batch)} posters in {took:.1f}s = {len(batch) / took:.1f} posters/s")
