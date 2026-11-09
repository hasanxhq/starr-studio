-- Cached overlay-engine facts per title (Plex metadata → TitleFacts JSON).
CREATE TABLE overlay_facts (
    rating_key TEXT PRIMARY KEY,
    library_key TEXT NOT NULL,
    updated_at INTEGER,
    facts TEXT NOT NULL,  -- JSON of TitleFacts (dataclasses.asdict)
    fetched_at INTEGER NOT NULL
);

CREATE INDEX overlay_facts_library_key ON overlay_facts (library_key);
