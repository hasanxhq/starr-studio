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

## Added 2026-11-08

8. **Studio keeps no log of its own; only Kometa's logs exist** (Should fix; `starr_studio/cli.py:62`, `starr_studio/logs_routes.py:25`)
   - **What this is:** Studio's modules write log lines (`log.info`, `log.warning`, `log.exception`) for things it does outside a Kometa run. Examples: drift it corrected, requests it sent, collections it deleted or rebuilt in Plex, Maintainerr hand-offs. The Logs page (System → Logs) lists files in Kometa's `config/logs/` only.
   - **Problem:** Logging is never set up. `uvicorn.run` configures only uvicorn's own loggers. As a result:
     - Studio's 14 `log.info` lines are thrown away. That includes the drift-correction lines that "log it, don't warn" relies on.
     - Its 36 warnings and errors fall through to Python's last-resort handler: plain text on stderr, with no time, level or module, mixed into `docker logs` with HTTP access lines.
     - Nothing reaches a file or the Logs page.

     When something goes wrong outside a run (finding 1, a request that failed, a deletion Plex refused), there is no record to look at.
   - **Fix:** Set up logging once at startup.
     - Write to a rotating file `<data dir>/logs/studio.log` (`logging.handlers.RotatingFileHandler`, e.g. 5 files of 2 MB).
     - Also write to stderr, so `docker logs` keeps working.
     - Use Kometa's line format (`[YYYY-MM-DD HH:MM:SS,mmm] module  [LEVEL]  message`), so the Logs page's existing parser (`LINE_LEVEL`) reads it unchanged.
     - Have the Logs page list Studio's file next to Kometa's, with a Studio | Kometa switch.
     - Never log a secret: tokens go in headers today (`X-Plex-Token`); any URL or body logged at Debug or Trace goes through `kometa_files.mask_secrets` first.
     - Test that a `log.info` line lands in the file and shows on the Logs page.
   - **If we skip it:** Problems outside Kometa runs leave no trace. Support means asking users to reproduce with `docker logs` open, and even then the info lines aren't there.

### Suggested logging modes

A **Log level** setting in Settings → General, like the *arr apps. The `STUDIO_LOG_LEVEL` environment variable overrides it, for problems that happen before the database opens.

| Mode | Logs | For |
|---|---|---|
| **Info** (default) | What Studio did and why, one line each: saves, runs queued and how they ended, drift it corrected, requests sent, collections deleted or unlabelled in Plex, Maintainerr hand-offs, schedules and tasks fired, sign-ins and refused sign-ins (no passwords). Plus every warning and error, with a traceback for errors | Everyday use; small enough to keep weeks of it |
| **Debug** | Info, plus every call Studio makes to Plex, Radarr/Sonarr/Seerr, Maintainerr, TMDb and MDBList: method, URL without secrets, status and time taken. Plus each decision behind a refusal (why a title was blocked, why a run was held), and HTTP access lines for the API | Chasing a bug or a slow page |
| **Trace** | Debug, plus request and response bodies of those calls, masked and cut to a few KB each | Last resort, short sessions only |

Choices to settle when it's built:
- Trace switches itself back to Info after 24 hours, so a forgotten Trace doesn't fill the disk.
- HTTP access lines stay out of Info: uvicorn's access log is noise at that level.
- Rotation is by size, not by day, so a busy Debug day can't grow without limit.

9. **Kometa is bundled, but Studio still treats it as the user's to choose and update** (Should fix; `compose.yaml:8`, `starr_studio/health.py:263`, `frontend/src/pages/SystemUpdates.tsx:16-28`, `docs/install-without-docker.md:167`)
   - **What this is:** Studio is a fully managed Kometa install. The Docker image is built on `kometateam/kometa:v2.5.4`, and the seedbox script installs exactly v2.5.4. Several modules copy Kometa 2.5.4's own tables and rules (`smart_filters.py`, `ready_made.py`, the source lists, `default_covers.py`, `ready_made_posters.py`, `defaults.ts`), each marked "check on a Kometa update".
   - **Problem:** Four places still invite users to run some other Kometa:
     - `KOMETA_TAG` is a user setting in the README and `compose.yaml`, so anyone can build Studio on a Kometa it was never checked against.
     - System → Status and System → Updates say "Kometa X is out" as soon as Kometa's `version` webhook reports a newer release. The Updates page then says to pull the new Studio image, which still holds the pinned Kometa, so following the advice changes nothing.
     - The no-Docker guide has a "To update Kometa to a newer tag" section.
     - The README talks about "an older Kometa you've pointed it at".

     A user who upgrades Kometa on their own gets copied tables that no longer match: wrong titles in Ready-made, filters Kometa refuses, and these only fail at run time.
   - **Fix:** Kometa versions move with Studio releases. We test a new Kometa, re-check the copied tables, and ship both together.
     - Keep the pinned version in one place (a `KOMETA_VERSION` constant or file). The Dockerfile, `compose.yaml`, `deploy/install-seedbox.sh` and the docs follow it; a test checks they match, as `tests/test_seedbox_script.py` already does for the script.
     - Keep `KOMETA_TAG` as a build argument for us; take it out of the README's user settings.
     - Replace "Kometa X is out" with a version check. A warning when the installed Kometa isn't the pinned one ("Studio is tested with Kometa 2.5.4; you have X"). A newer Kometa release becomes a quiet line on System → Updates ("waits for a Studio update"), not a notice.
     - Delete the self-update section from the no-Docker guide; updating Studio's install updates Kometa.
     - Don't vendor Kometa's source or make it a pip dependency: it isn't on PyPI, it pins its own dependencies exactly, and the two separate venvs in the Dockerfile exist so the two sets never clash.
   - **If we skip it:** Users follow Studio's own update notice into a setup Studio wasn't tested with, and the failures look like Studio bugs.

10. **Delete shows no progress while it waits for Plex** (Nice to have, UX; `frontend/src/components/ui.tsx:87-118`, `frontend/src/pages/CollectionBuilder.tsx:441-450,715-721`)
    - **What this is:** Delete on a collection asks once more (`ConfirmButton`), then calls the API, which deletes the collection from Plex before it answers. On success the page leaves for the Collections list by itself.
    - **Problem:** While that call runs (seconds, longer on a slow Plex), the only change is that the red Delete button greys out. Its label stays "Delete", the warning text and Keep stay as they were, and Keep still works. It looks like nothing happened, so people press Keep, reload or leave the page mid-delete, and can't tell whether it went through.
    - **Fix:** In `ConfirmButton`, once, so all its users get it (Delete, Remove, Disconnect, Turn off, Turn overlays off):
      - While `busy`, show a spinner and a "…ing" label on the confirm button (e.g. "Deleting…"; a `busyLabel` prop, defaulting to `Working…` as `ConfirmDialog` does), and set `aria-busy`.
      - Disable Keep while busy too.
      - Keep the spinner until the page has left: on success the builder already navigates away, so only an error clears it (the error then shows as today).
      - Move `Spinner` from `components/Jobs.tsx` to `components/ui.tsx` and use it in both places.
      - A test: after confirming, the button reads "Deleting…" and Keep is disabled until the mock API answers.
      - Check it again after the rework (P3.2 Collections page, P4 builder) in case delete moves.
    - **If we skip it:** Deletes feel broken, and people who leave mid-delete come back unsure whether the collection is gone from Plex.

## Summary

**Verdict:** Fix 1 first, together with finding 8, so the next problem leaves a log: it can quietly stop every Kometa run. Then fix 2, before the Collections page (P3.2) makes builder collections and ready-made picks easy to mix. Fix 9 before the next Studio release, so no update notice sends users to an untested Kometa. Sign-in, the API key, cross-site protection, proxy trust, file paths, uploads, backups and restore are careful and well guarded.

**Lean:** about −100 lines possible, no dependencies to remove.

**Not checked:**
- Most of the frontend's 18,000 lines; only a few spots were read.
- The internals of `smart_filters.py`, `list_sources.py`, `ready_made.py`, `kometa_import.py` and `switch_over.py`, apart from undo.
- Nothing was run: no tests (CI was green on #92), and nothing against a real Plex, Kometa, Maintainerr or the *arr apps.
