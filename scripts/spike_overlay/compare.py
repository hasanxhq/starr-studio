"""Phase 0 spike: compare resvg's and Chromium's drawings of the same SVGs.

Run with the same uv command as build.py:  python -I scripts/spike_overlay/compare.py <out dir>
"""

import json
import statistics
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT = Path(sys.argv[1])


def load(path):
    return np.asarray(Image.open(path).convert("RGBA"), dtype=np.int16)


def bbox(alpha):
    ys, xs = np.nonzero(alpha > 127)
    return (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1) if len(xs) else None


results = {"renders": [], "probes": {"text": [], "paths": []}}
for svg in sorted(OUT.glob("[0-9]*.svg")):
    a, b = load(OUT / f"{svg.stem}.resvg.png"), load(OUT / f"{svg.stem}.browser.png")
    diff = np.abs(a[..., :3] - b[..., :3]).max(axis=2)
    results["renders"].append(dict(name=svg.stem, mean_diff=round(float(diff.mean()), 3), pct_over_24=round(float((diff > 24).mean() * 100), 3), pct_over_64=round(float((diff > 64).mean() * 100), 3)))
    heat = Image.fromarray(np.clip(diff * 4, 0, 255).astype(np.uint8))
    sheet = Image.new("RGB", (1500, 750), (18, 18, 22))
    for i, img in enumerate([Image.open(OUT / f"{svg.stem}.resvg.png"), Image.open(OUT / f"{svg.stem}.browser.png"), heat]):
        sheet.paste(img.convert("RGB").resize((500, 750)), (i * 500, 0))
    sheet.save(OUT / f"compare-{svg.stem}.jpg", quality=88)

probes = {p["name"]: p for p in json.loads((OUT / "probes.json").read_text())}
for svg in sorted(OUT.glob("probe-*.svg")):
    a, b = bbox(load(OUT / f"{svg.stem}.resvg.png")[..., 3]), bbox(load(OUT / f"{svg.stem}.browser.png")[..., 3])
    mode = "paths" if svg.stem.endswith(tuple(f"-paths-{i}" for i in range(20))) or "-paths-" in svg.stem else "text"
    if a is None or b is None:
        results["probes"][mode].append(dict(name=svg.stem, missing="resvg" if a is None else "browser"))
        continue
    d = [abs(int(x) - int(y)) for x, y in zip(a, b)]
    results["probes"][mode].append(dict(name=svg.stem, text=probes[svg.stem]["text"], max_edge_px=max(d), edges=d, resvg_box=[int(v) for v in a], browser_box=[int(v) for v in b]))

summary = {}
for mode, rows in results["probes"].items():
    ok = [r for r in rows if "max_edge_px" in r]
    if ok:
        summary[mode] = dict(probes=len(rows), missing=len(rows) - len(ok), max_edge_px=max(r["max_edge_px"] for r in ok), median_edge_px=statistics.median(r["max_edge_px"] for r in ok), worst=max(ok, key=lambda r: r["max_edge_px"])["name"])
timings = json.loads((OUT / "timings.json").read_text())
summary["timing_ms"] = {
    "full_poster_with_extras": statistics.median(t["full_ms"] for t in timings if "-extras-" in t["name"]),
    "full_poster_c": statistics.median(t["full_ms"] for t in timings if "-c-" in t["name"]),
    "overlay_only": statistics.median(t["overlay_ms"] for t in timings),
    "pillow_composite_and_jpeg": statistics.median(t["compose_ms"] for t in timings),
}
results["summary"] = summary
(OUT / "results.json").write_text(json.dumps(results, indent=1))
print(json.dumps(summary, indent=1))
print(json.dumps(results["renders"], indent=1))
