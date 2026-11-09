"""Studio's own overlay engine (docs/plans/overlay-engine.md).

A style (style.py) is a YAML file of elements and options. For one title, its facts (facts.py) decide which elements
show and fill their text (rules.py); the result is drawn as SVG and turned into pixels with resvg (render.py), then laid
onto the title's original poster. Phase 1 draws previews only: nothing here writes to Plex.
"""
