-- Save without building (P3a): a builder collection that was saved but hasn't been built yet.
ALTER TABLE collections ADD COLUMN changed_at TEXT;
