-- Facts now read the edition from file names too (overlay_engine/editions.py): drop the cache so every title is read again.
DELETE FROM overlay_facts;
