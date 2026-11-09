# Overlay renderer spike (Phase 0)

Throwaway code from `docs/plans/overlay-engine.md`, Phase 0: does one SVG draw the same in the browser and in resvg, and how fast? Results are in the plan. Writes nothing to Plex.

```bash
UV="uv run --no-project --with resvg-py --with uharfbuzz --with fonttools --with pillow --with numpy python -I"
$UV scripts/spike_overlay/build.py <out> kometa/fonts "config/overlays/Movies Original Posters"   # SVGs + resvg renders
<python with playwright> scripts/spike_overlay/browser.py <out>                                   # Chromium renders
$UV scripts/spike_overlay/compare.py <out>                                                       # differences and timings
$UV scripts/spike_overlay/fast_path.py <out>                                                     # production path and throughput
```

`build.py` expects the three original posters (rating keys 4635, 4331, 8586) in the originals folder.
