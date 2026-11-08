"""Tests for col.last_change(db, row): reading changes events from a collection's last run."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from starr_studio import collections as col
from starr_studio.db import open_database


@pytest.fixture
def db(tmp_path: Path) -> sqlite3.Connection:
    database = open_database(tmp_path / "studio.db")
    with database:
        database.execute("INSERT INTO runs (id, request) VALUES (1, '{}')")
        database.execute("INSERT INTO runs (id, request) VALUES (2, '{}')")
    return database


def test_last_change_sums_two_events_case_insensitively(db: sqlite3.Connection):
    events = [
        (1, "changes", {"collection": "Action Picks", "additions": [{"title": "Die Hard"}, {"title": "Speed"}], "removals": [{"title": "Old Movie"}]}),
        (1, "changes", {"collection": "action picks", "additions": [{"title": "The Matrix"}], "removals": [{"title": "Flop 1"}, {"title": "Flop 2"}]}),
    ]
    with db:
        db.executemany("INSERT INTO run_events (run_id, event, payload) VALUES (?, ?, ?)", [(r, e, json.dumps(p)) for r, e, p in events])

    row = {"last_run_id": 1, "title": "Action Picks"}
    change = col.last_change(db, row)
    assert change == {"added": 3, "removed": 3, "run_id": 1}


def test_last_change_ignores_events_of_another_run_or_another_title(db: sqlite3.Connection):
    events = [
        # Another run, same title
        (2, "changes", {"collection": "Action Picks", "additions": [{"title": "Alien"}], "removals": []}),
        # Same run, different title
        (1, "changes", {"collection": "Comedy Picks", "additions": [{"title": "Airplane"}], "removals": []}),
        # Target event
        (1, "changes", {"collection": "Action Picks", "additions": [{"title": "Die Hard"}], "removals": [{"title": "Oldie"}]}),
    ]
    with db:
        db.executemany("INSERT INTO run_events (run_id, event, payload) VALUES (?, ?, ?)", [(r, e, p if isinstance(p, str) else json.dumps(p)) for r, e, p in events])

    row = {"last_run_id": 1, "title": "Action Picks"}
    change = col.last_change(db, row)
    assert change == {"added": 1, "removed": 1, "run_id": 1}


def test_last_change_no_events_returns_none(db: sqlite3.Connection):
    events = [
        (1, "changes", {"collection": "Other Collection", "additions": [{"title": "Movie"}], "removals": []}),
        (1, "error", {"error": "something failed"}),
        (1, "delete", {"collection": "Action Picks", "message": "deleted"}),
    ]
    with db:
        db.executemany("INSERT INTO run_events (run_id, event, payload) VALUES (?, ?, ?)", [(r, e, json.dumps(p)) for r, e, p in events])

    row = {"last_run_id": 1, "title": "Action Picks"}
    assert col.last_change(db, row) is None


def test_last_change_null_last_run_id_returns_none(db: sqlite3.Connection):
    with db:
        db.execute(
            "INSERT INTO run_events (run_id, event, payload) VALUES (1, 'changes', ?)",
            (json.dumps({"collection": "Action Picks", "additions": [{"title": "Movie"}], "removals": []}),),
        )

    row = {"last_run_id": None, "title": "Action Picks"}
    assert col.last_change(db, row) is None


def test_last_change_works_with_db_row(db: sqlite3.Connection):
    row_id = col.insert_built(db, "Movies", "key1", "Marvel Picks", {"filters": {"match": "all", "rules": []}})
    col.set_run(db, [row_id], 1)
    with db:
        db.execute(
            "INSERT INTO run_events (run_id, event, payload) VALUES (1, 'changes', ?)",
            (json.dumps({"collection": "marvel picks", "additions": [{"title": "Iron Man"}], "removals": []}),),
        )

    db_row = col.built_row(db, row_id)
    assert db_row is not None
    assert col.last_change(db, db_row) == {"added": 1, "removed": 0, "run_id": 1}


def test_last_change_with_empty_additions_and_removals(db: sqlite3.Connection):
    with db:
        db.execute(
            "INSERT INTO run_events (run_id, event, payload) VALUES (1, 'changes', ?)",
            (json.dumps({"collection": "Static Picks", "additions": [], "removals": []}),),
        )

    row = {"last_run_id": 1, "title": "Static Picks"}
    assert col.last_change(db, row) == {"added": 0, "removed": 0, "run_id": 1}
