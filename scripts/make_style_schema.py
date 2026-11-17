"""Write starr_studio/overlay_engine/style.schema.json from the style models (tests fail when it's out of date).

    .venv/bin/python scripts/make_style_schema.py
"""

import json

from starr_studio.overlay_engine.styles_store import SCHEMA_FILE, style_schema

SCHEMA_FILE.write_text(json.dumps(style_schema(), indent=2) + "\n")
print(f"wrote {SCHEMA_FILE}")
