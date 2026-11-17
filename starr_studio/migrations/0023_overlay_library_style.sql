-- Studio's overlay engine: each config.yml library's chosen style and its option values (docs/plans/overlay-engine.md, 3.6).
CREATE TABLE overlay_library_style (
    library TEXT PRIMARY KEY,  -- the config.yml library name
    style TEXT NOT NULL,  -- a style id (styles_store)
    options_json TEXT NOT NULL,  -- option values the library set; the style's defaults fill the rest
    updated_at INTEGER NOT NULL
);
