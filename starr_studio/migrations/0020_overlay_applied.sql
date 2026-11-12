-- Studio's overlay engine: what it uploaded to each title's poster in Plex (docs/plans/overlay-engine.md, 3.4).
-- A row with uploaded_sha256 set means Plex shows Studio's poster now; NULL means the original is back (or never left).
CREATE TABLE overlay_applied (
    rating_key TEXT PRIMARY KEY,
    library_key TEXT NOT NULL,
    title TEXT NOT NULL,
    original_sha256 TEXT NOT NULL,  -- the original it was drawn from (OriginalsStore)
    uploaded_sha256 TEXT,  -- the bytes Studio uploaded; NULL once restored
    plex_thumb TEXT,  -- Plex's thumb path right after Studio's last upload or restore
    fingerprint TEXT,  -- what was drawn (apply.fingerprint); NULL once restored
    style TEXT,  -- the style's name, for the UI
    applied_at INTEGER,
    restored_at INTEGER,
    updated_at INTEGER NOT NULL
);

CREATE INDEX overlay_applied_library_key ON overlay_applied (library_key);
