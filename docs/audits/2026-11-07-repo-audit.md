# Repo audit, 2026-11-07

Audited `dev` at `ce32ae0` (after #92), mid-way through the UI rework (`docs/plans/ui-rework.md`). Read-only: no code was changed.

**Next steps:** the fixes below wait until the UI rework is finished. Then audit the repo again (the rework moves a lot of code), merge the two lists, and fix what's still open.

**What this repo does:** Starr Studio is a self-hosted web app (FastAPI + React) that manages collections, posters and overlays for one Plex library. It keeps your choices in SQLite, writes the YAML files Kometa reads, and starts Kometa one run at a time from a queue. It can ask Radarr, Sonarr or Seerr for missing titles, and steers around Maintainerr's collections and overlays. Assumed load: one household, one admin, a few browser tabs, background schedules, one Kometa process at a time.

## Must fix

1. **One failed hook stops every Kometa run until Studio restarts** (`starr_studio/runner.py:258-270`, `starr_studio/maintainerr.py:399`)
   - **What this is:** The runner is the loop that takes queued runs and starts Kometa. Before each run, "hooks" (small checks other modules plug in) get a turn, such as the Maintainerr check.
   - **Problem:** The runner only catches the errors it expects (`RunHeld`, `ValueError`, `OSError`). The Maintainerr hook waits for Maintainerr's own overlay run outside its own `try` block. Each wait checks Maintainerr every 5 s, for up to 10 minutes. If Maintainerr takes more than 15 s to answer, or goes down during that wait, a `StillGoing`/`MaintainerrProblem` error escapes. It ends the runner's background task:
     - that run stays "running" forever;
     - every later run, scheduled ones included, sits in the queue;
     - nothing is logged, because nobody reads the task's error.
   - **Fix:** In `_run`, catch `Exception` around the hooks and fail that run with the message, as the scheduler loop already does (`scheduler.py:149`). Also move `_wait_until_idle` inside the Maintainerr `try`. Add one test: a hook that raises `RuntimeError` fails its run, and the next queued run still starts.
   - **If we skip it:** One slow answer from Maintainerr silently stops all collection and overlay updates until someone restarts the container.

2. **A ready-made pick can take the same name as a builder collection, and removing one deletes the other** (`starr_studio/ready_made_routes.py:508-535`)
   - **What this is:** Before building a ready-made pick, `_not_taken` checks that its Plex name is free.
   - **Problem:** It only refuses names that Maintainerr owns or that a collection without Studio's label already uses in Plex. A builder collection called "Action Movies" carries Studio's label, so the Genre → Action pick ("Action Movies") passes. The builder's own name check (`builder_routes._title_taken`) does look at Studio's rows; this one doesn't. With both built:
     - two definitions update one Plex collection;
     - removing the ready-made pick later deletes that Plex collection, which the builder row still owns.
   - **Fix:** In `_not_taken`, also block a title that another Studio row in the library already uses. That's the same three-line loop as the start of `_title_taken`; move it into one helper that both call.
   - **If we skip it:** A user who customised a genre and later picks it again loses the collection from Plex without warning.

## Should fix

3. **The "file" run scope is never set, so its whole branch is unused**
   - **What this is:** `run_scope = "file"` was a fallback to build a category with `--run-files` instead of by collection name.
   - **Problem:** Nothing outside tests calls `col.set_run_scope`, so every row stays `collection`. The unused code spreads over several places:
     - the file branch in `plan_run_scope` (`starr_studio/ready_made_routes.py:479`), added in #92;
     - the `run_scope` field in the category response;
     - the frontend notice (`frontend/src/pages/ReadyMadeCategory.tsx:194`) and the `ReadyMadeRunScope` type;
     - three tests.
   - **Fix:** Delete all of it. `plan_run_scope` shrinks to "collection names, sorted". Keep the database column, because merged migrations are never edited.
   - **If we skip it:** About 100 lines that every change to the build routes has to keep working, for a case that can't happen.

4. **The "delete only Studio's own collection" rule is written twice** (`starr_studio/builder_routes.py:537`, `starr_studio/ready_made_routes.py:447`)
   - **What this is:** This is the main safety rule: Studio deletes a Plex collection only after checking it carries the `Studio` label.
   - **Problem:** `_delete_from_plex` and `apply_ready_made_removals` each do it in their own words. They already differ: one reports an unlabelled collection with the same name, and the other skips it without a word. A future fix to one will miss the other.
   - **Fix:** Move `_delete_from_plex` into `plex_library.py` as `delete_studio_collection(server, section, title)`, and have `apply_ready_made_removals` call it.
   - **If we skip it:** The rule that protects users' own collections drifts between the two copies.

5. **Two requests at once can file the same titles twice and go over the daily limit** (`starr_studio/requesting.py:883-918`)
   - **What this is:** `RequestService.request` reads which titles are already requested and today's count, then sends each title to Radarr, Sonarr or Seerr, waiting on the network for each one.
   - **Problem:** Two calls can overlap: for example, a run's after-step requesting for a collection while you click "Request 12 titles" on its card. Both read the same state before either writes. The daily limit then allows up to twice its number, and the same titles are sent twice. Radarr and Seerr refuse the duplicates, so they show up as errors.
   - **Fix:** One `asyncio.Lock` on the service, held for the whole of `request()`. Three lines.
   - **If we skip it:** The daily limit doesn't hold, and the request history shows errors that aren't real.

## Nice to have

6. **The daily request limit resets at midnight UTC, not at your midnight** (`starr_studio/requesting.py:892`)
   - **What this is:** The "used today" count starts from `now.date()`, where `now` is in UTC.
   - **Problem:** In New York the limit resets at 7 or 8 pm local time, so one evening can use two days' allowance.
   - **Fix:** Compute the start of the day in the timezone Studio already stores for schedules, then convert it to UTC text for the query.
   - **If we skip it:** The limit is a little off for anyone far from UTC.

7. **Removing several ready-made picks downloads Plex's list of collections once per pick** (`starr_studio/ready_made_routes.py:463`)
   - **What this is:** The removal loop calls `labelled_collections` inside the loop.
   - **Problem:** Removing 40 genre picks means 40 full list downloads before any delete.
   - **Fix:** Fetch the list once before the loop. The label check just before each delete stays as it is.
   - **If we skip it:** Big removals are slow on large or remote Plex servers.

## Summary

**Verdict:** Fix 1 first: it can quietly stop every Kometa run. Then fix 2, before the Collections page (P3.2) makes builder collections and ready-made picks easy to mix. Sign-in, the API key, cross-site protection, proxy trust, file paths, uploads, backups and restore are careful and well guarded.

**Lean:** about −100 lines possible, no dependencies to remove.

**Not checked:**
- Most of the frontend's 18,000 lines; only a few spots were read.
- The internals of `smart_filters.py`, `list_sources.py`, `ready_made.py`, `kometa_import.py` and `switch_over.py`, apart from undo.
- Nothing was run: no tests (CI was green on #92), and nothing against a real Plex, Kometa, Maintainerr or the *arr apps.
