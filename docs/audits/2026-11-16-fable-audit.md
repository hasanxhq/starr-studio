# Repo audit by Fable, 2026-11-16

Audited `dev` at `fe5d5b2` (after #140) with `/ponytail:ponytail-audit`, by Claude Fable 5.2. Read-only apart from this file. Every source file was read: the backend, `deploy/`, `brand/`, `scripts/` and the whole frontend. It was done in two passes, so the findings come in two parts; the numbers run on from one part to the next.

It does not re-check the two earlier audits (`2026-11-07-repo-audit.md`, `2026-11-09-repo-audit.md`); all their findings were fixed in #113–#120.

**Status (2026-11-16):** all 35 findings are open. No fixes yet; they wait for the maintainer.

**What this repo does:** Starr Studio is a self-hosted web app (Python backend, React frontend) for organising a Plex library: collections, posters and overlays. It writes Kometa's config files, runs Kometa as a child program, and asks Radarr, Sonarr, Lidarr and Seerr for missing titles. It also keeps Maintainerr's collections safe.

**Load assumed:** one household, one admin, a few browser tabs, background schedules, one Kometa run at a time.

**Tests at the time:** backend 946 passed, 2 failed (see finding 10). Frontend type check is clean and 405 tests pass. CI on `dev` is green.

**Suggested order:** 1 and 2 first, then 3 and 4, then 19–21, then the one-line bugs 24 and 25. Findings 5, 7, 18, 26 and 27 are cheapest before the first beta (see the last section).

## Part 1: first pass (findings 1–18)

The paths that cost the most when they break: config writes and backups, the run queue, Maintainerr, requests, the overlay engine.

### Must fix

1. **Restoring the oldest backup deletes it** (`starr_studio/config_write.py:392-413`, `starr_studio/backups.py:17-40`)
   - **What this is:** Restore puts back an older copy of the config files. First it saves a "before restoring" backup.
   - **Problem:** Studio keeps 30 backups. Saving that extra backup deletes the oldest one, which may be the one you are restoring. I reproduced it: restore fails with `FileNotFoundError`, the config stays broken, and the backup is gone. The install this was checked on has exactly 30 backups now.
   - **Fix:** Read the backup's files into memory before taking the new backup. A few lines in `restore`.
   - **If we skip it:** The backup you need most can be lost at the moment you ask for it.

2. **"Build all" cannot get past the "this would request N titles" question** (`starr_studio/build_routes.py:163-168`, `starr_studio/builder_routes.py:412-426`, `frontend/src/components/ChangesBar.tsx:66-94`)
   - **What this is:** The Changes bar builds everything saved for later. Collections with "Download missing" ask you to confirm when they would request many titles.
   - **Problem:** This endpoint has no way to say "yes". I reproduced it: the dry run says "Will build Dune", the real build answers 409 `needs_confirm`, and sending `confirm_requests: true` gives the same 409. The ready-made picks in the same build are blocked too.
   - **Fix:** Add `confirm_requests` to `LibraryBuildIn`, pass it to `_check_requests`, and show the existing confirm dialog in `ChangesBar` on `needs_confirm`.
   - **If we skip it:** Such a collection can never be built from the Changes bar, and it holds up everything queued with it.

### Should fix

3. **A failed log write leaves Kometa running** (`starr_studio/runner.py:288-303`)
   - **What this is:** Studio copies Kometa's output into a log file while the run goes on.
   - **Problem:** If that write fails (full disk, seedbox quota), only a timeout is handled. I reproduced it: the run is marked failed, Kometa keeps running, the after steps are skipped, and the next run can start beside it.
   - **Fix:** In the `finally`, stop the process group if it is still alive and run the after steps if they have not run.
   - **If we skip it:** Two Kometa runs can write to Plex at once, and Maintainerr's overlays stay off.

4. **A restart in the middle of a run leaves Maintainerr's overlays off for up to a day** (`starr_studio/maintainerr.py:371-426`)
   - **What this is:** Before a run, Studio asks Maintainerr to take its overlays off. After the run it asks for them back.
   - **Problem:** The "still owed" flag is only set in the after step or on an error. If Studio restarts mid-run, nothing remembers the debt until the daily redraw.
   - **Fix:** Set `PENDING_PROCESS` before the reverts; the after step already clears it.
   - **If we skip it:** After a crash or update, those posters miss their overlays for up to 24 hours.

5. **Run logs and run history are never cleaned up** (`starr_studio/runner.py:247-254`)
   - **What this is:** Each run writes a log file and rows in the `runs` and `run_events` tables.
   - **Problem:** Nothing ever deletes them. On that install, 25 runs already take 1.6 MB (largest 414 KB); an hourly schedule makes 8,760 a year.
   - **Fix:** When a run finishes, delete all but the newest 200 runs. The log file goes with it, and `run_events` rows go by the existing cascade.
   - **If we skip it:** The data folder grows without end, which leads to finding 3 on a quota.

6. **One request that never shows up in Plex makes Studio read the whole library every 5 minutes, forever** (`starr_studio/requesting.py:1454-1522`)
   - **What this is:** After a download, Studio looks for the title in Plex to label it.
   - **Problem:** While any imported request is unlabelled, each poll fetches every ID in that library. A title that never appears (wrong library, deleted) keeps this going for good.
   - **Fix:** Add an age limit to the query: stop looking 7 days after import.
   - **If we skip it:** Plex gets steady, pointless load on big libraries.

7. **TV shows have two different keys, so they are requested twice** (`starr_studio/collection_requests.py:38-49`, `starr_studio/list_sources.py:522-529`, `starr_studio/wanted.py:45`)
   - **What this is:** Studio skips titles it already requested by comparing a key such as `tmdb-show:1399`.
   - **Problem:** At save time a show is `tmdb-show:<id>`. After a run, Kometa's report names it `tvdb:<id>`. The keys never match, so the show counts as waiting and is asked for again.
   - **Fix:** Store the TVDb key on the request row too, and let `waiting` match either key.
   - **If we skip it:** Extra request rows appear and the daily cap is used up by shows already requested.

8. **Most calls read and parse all config files again** (`starr_studio/kometa_files.py:119-136`, `starr_studio/ready_made_routes.py:104-114`, `starr_studio/health.py:245-248`)
   - **What this is:** `ConfigReader.read()` loads Kometa's config with a slow, pure-Python parser.
   - **Problem:** It runs on every builder, ready-made and build call, and on every status poll. It took 211 ms on that install's config and 1,032 ms on a 30-default config, and the whole server waits meanwhile.
   - **Fix:** Cache the result, keyed by each file's path, change time and size.
   - **If we skip it:** The UI feels slow, and live run logs stutter while pages load.

9. **Overlay apply trusts an empty Maintainerr list and does not check the library** (`starr_studio/overlay_engine_routes.py:65-100`)
   - **What this is:** Before writing posters, the engine skips titles that Maintainerr manages.
   - **Problem:** It uses the last list in memory without refreshing it or checking for an error. Right after a start, or when Maintainerr is down, the list is empty and nothing is skipped. Also, title IDs are not checked against the named library.
   - **Fix:** Refuse to apply when the list failed or was never loaded, and reject IDs from another library. Do this before the Phase 3 UI ships.
   - **If we skip it:** Studio can overwrite posters Maintainerr owns.

10. **The test that guards the copied Kometa tables never runs in CI** (`tests/test_smart_filters.py:638-640`)
    - **What this is:** Studio keeps a copy of Kometa's search fields. This test compares the copy with Kometa's source.
    - **Problem:** It is skipped when the `kometa/` clone is missing, which is always the case in CI. Locally it fails (`AssertionError: hdr10plus`) because the local clone is 2.5.3 and the pin is 2.5.4.
    - **Fix:** In CI, do a shallow clone of Kometa at the pinned tag before the tests. Update the local clone.
    - **If we skip it:** A Kometa version bump can break smart filters with no test noticing.

11. **Near-copies in the request code** (`starr_studio/requesting.py:295-336`, `starr_studio/requesting.py:497-569`, `starr_studio/requesting.py:714-770`)
    - **What this is:** One 1,586-line file talks to Radarr, Sonarr, Lidarr and Seerr.
    - **Problem:** Several pairs differ only by service name: the two option resolvers, the two tag helpers, Seerr get and post, and three queue-fetch blocks. A fix in one is easy to miss in its twin.
    - **Fix:** Give each pair one function that takes the service as an argument. About 120 lines go.
    - **If we skip it:** Radarr and Sonarr slowly start to behave differently.

12. **The same error handling and fetch code repeated** (`starr_studio/plex_library.py:211-290`, `starr_studio/ready_made_posters.py:198`, `starr_studio/default_covers.py:144`)
    - **What this is:** Three Plex write calls share one error block, and two classes both fetch, shrink and cache an image.
    - **Problem:** Each is written out in full, so a change must be made in two or three places.
    - **Fix:** One small helper for the Plex block, and one shared fetch-and-cache function. About 60 lines go.
    - **If we skip it:** More code to read and test for no gain.

### Nice to have

13. **The "same picture" check is too close to call** (`starr_studio/overlay_engine/plex_posters.py:31-38`, `starr_studio/overlay_engine/apply.py:92`)
    - **What this is:** The engine compares two posters after shrinking them, with a limit of 3.0.
    - **Problem:** On a dark poster I measured 3.08 with one badge and 2.57 with none. Below 3.0, Studio's poster and the original count as the same, so it says "Already up to date" when the original is back.
    - **Fix:** Compare at a larger size, or lower the limit and add a test with a dark poster.
    - **If we skip it:** Some dark posters silently keep or lose their overlay.

14. **The render worker pool is never rebuilt after it breaks** (`starr_studio/overlay_engine/apply.py:41-76`)
    - **What this is:** Posters are drawn in helper processes kept in one global pool.
    - **Problem:** If a helper is killed (out of memory), the pool is broken for good and every later apply fails.
    - **Fix:** On `BrokenProcessPool`, set `_pool = None` and try once more.
    - **If we skip it:** Overlays stop working until Studio is restarted.

15. **Leftover code** (`starr_studio/arr.py:206-207`, `starr_studio/ready_made_routes.py:491-500`, `frontend/src/components/ChangesBar.tsx:66-94`)
    - **What this is:** Small pieces nothing needs.
    - **Problem:** `arr._delete` has no caller. `plan_run_scope` takes a `db` it ignores and always returns empty `files`. `POST /ready-made/count` is not called by the frontend. The `confirm` and `buildAll` mutations are the same.
    - **Fix:** Delete them, and keep one mutation.
    - **If we skip it:** About 20 lines of noise stay.

16. **Secrets on one line are not hidden** (`starr_studio/kometa_files.py:497-519`)
    - **What this is:** `mask_secrets` hides tokens before config text is shown.
    - **Problem:** It misses the one-line form, such as `plex: {url: …, token: abc}`, so that token is shown in full.
    - **Fix:** Also match `key: value` pairs inside braces, and add one test.
    - **If we skip it:** A token can show up in the UI or a screenshot.

17. **A webhook token with non-English letters gives a server error** (`starr_studio/runs_routes.py:214`)
    - **What this is:** The webhook compares the token in the URL with the stored one.
    - **Problem:** `secrets.compare_digest` raises on text that is not plain ASCII, so the answer is 500, not 403.
    - **Fix:** Encode both sides to bytes first, as `auth.py:228` already does.
    - **If we skip it:** Only noise in the log; nothing gets in.

18. **A movie removed from Radarr stays "requested" forever** (`starr_studio/requesting.py:1193-1361`)
    - **What this is:** The refresh step asks each service how a request is doing.
    - **Problem:** Only Lidarr's "not found" answer turns a row into "failed". For Radarr and Sonarr the row never changes.
    - **Fix:** Treat a 404 the same way for all three.
    - **If we skip it:** Stale rows stay on the Requests page and keep being polled.

## Part 2: the rest of the files (findings 19–35)

Five smaller findings left out of the first pass (19–21, 32, 33), plus what the remaining files showed.

### Must fix

19. **A refused build undoes saves made in the meantime** (`starr_studio/ready_made_routes.py:382-390`, callers `starr_studio/build_routes.py:170-188`, `starr_studio/ready_made_routes.py:724-745`)
    - **What this is:** Before a build, Studio copies all of the library's collection rows. If Kometa's check refuses the build, it deletes the library's rows and puts the copy back.
    - **Problem:** The check takes seconds. A collection saved in another tab (or by a run) during that time is deleted or reverted with no message.
    - **Fix:** On refusal, undo only the rows this call added or removed, not the whole library.
    - **If we skip it:** A collection someone just saved can vanish because a different build failed.

20. **Two edited files with the same name: one skips Kometa's check** (`starr_studio/config_write.py:231-235`)
    - **What this is:** Before saving, Studio puts the edited files in a temp folder and lets Kometa check that folder.
    - **Problem:** Files are placed by file name only. If one save edits `movies/collections.yml` and `shows/collections.yml`, the second overwrites the first, so one is never checked.
    - **Fix:** Place each file under its relative path, not only its name.
    - **If we skip it:** A broken file can be saved even though the check said everything passed.

21. **Cancel does nothing while a run waits on Maintainerr** (`starr_studio/runner.py:157-163`, `starr_studio/runner.py:264-268`, `starr_studio/maintainerr.py:400-411`)
    - **What this is:** Before Kometa starts, a hook waits for Maintainerr to go idle and puts its posters back. Cancel sets a flag.
    - **Problem:** The flag is only read after every hook has finished. Cancel during the wait stops nothing, and the posters are still reverted for a run that never starts.
    - **Fix:** Check the cancel flag between hooks and inside the wait loop.
    - **If we skip it:** Cancel looks broken for minutes, and Maintainerr's overlays are taken off for nothing.

### Should fix

22. **Home shows "OK" for apps that are not connected** (`frontend/src/pages/home/Connected.tsx:23-39`)
    - **What this is:** The "Connected" card on the home page shows a dot for Plex, Radarr, Sonarr, Seerr and TMDb, taken from the last full check.
    - **Problem:** An app counts as OK when no error line names it. An app that was never set up has no error line, so Seerr shows green without being connected.
    - **Fix:** Show Radarr, Sonarr and Seerr only when `/requests/settings` says they are connected (the home page already loads it).
    - **If we skip it:** The card says things are connected that are not.

23. **A year rule with `current_year` previews wrong** (`starr_studio/smart_filters.py:793-805`, `starr_studio/smart_filters.py:1069-1074`)
    - **What this is:** Kometa accepts `current_year` and `current_year-5` in year rules. Studio accepts them too, and Move over imports them.
    - **Problem:** For the preview, Studio sends the text `current_year-5` to Plex as it is. Plex does not know it, so the preview is empty or wrong. The builder's number field also shows it blank.
    - **Fix:** Turn it into the real year in `plex_query`, as `_normalize_date_arg` already does for "today".
    - **If we skip it:** An imported collection looks empty in Studio although Kometa builds it fine.

24. **A waiting Lidarr import is shown as Sonarr** (`starr_studio/jobs.py:149-150`)
    - **What this is:** The jobs list shows "Kometa after … imports" for each app with imports waiting.
    - **Problem:** The name is `"Radarr" if kind == "radarr" else "Sonarr"`, but Lidarr is in that list too.
    - **Fix:** Use `arr.NAMES[kind]`. One line.
    - **If we skip it:** A music import shows up as a Sonarr job.

25. **"Become more see-through" is said both ways** (`frontend/src/pages/overlays/changeSummary.ts:50-51`)
    - **What this is:** The overlay studio writes one sentence about what your change does.
    - **Problem:** Any change in opacity gives "become more see-through", also when you make the badge more solid.
    - **Fix:** Compare the two alpha values and say "more" or "less".
    - **If we skip it:** The summary says the opposite of what the user did.

26. **"Arrived today" stops counting past 200 requests** (`frontend/src/pages/home/ComingIn.tsx:36-55`, `frontend/src/components/Layout.tsx:90-97`, `starr_studio/requests_routes.py:185`)
    - **What this is:** The home page and the sidebar badge load the newest 200 requests every 60 seconds, on every page, to show three numbers.
    - **Problem:** "Arrived today" is counted in the browser from those 200 rows. A title requested long ago that arrives today is not among them, so it is not counted.
    - **Fix:** Count it on the server with the other counts, and let both places ask for 2 rows.
    - **If we skip it:** The number is too low on a busy setup, and 200 rows travel every minute for a badge.

27. **Saving 4 overlay layers runs 4 Kometa checks and makes 4 backups** (`frontend/src/pages/overlays/OverlayStudio.tsx:228-241`, `starr_studio/backups.py:13`)
    - **What this is:** "Save" in the overlay studio sends each changed layer as its own save.
    - **Problem:** Each save is a full Kometa check and one of the 30 kept backups. If the third fails, the first two are already saved.
    - **Fix:** One route that takes all changed layers and writes once. This is the largest fix in this list, about 20 lines.
    - **If we skip it:** Saving is slow, the backup history fills four times faster, and a failure leaves a half-saved set.

28. **The edition list has no test against Kometa** (`starr_studio/overlay_engine/editions.py:3`, `tests/test_overlay_editions.py`)
    - **What this is:** The overlay engine keeps its own copy of Kometa's edition names and patterns.
    - **Problem:** The header says it was copied from Kometa 2.5.3, but Studio pins 2.5.4. No test compares the copy with Kometa's file.
    - **Fix:** One test that reads Kometa's `resolution.yml` and compares, like the table test in finding 10. Correct the header.
    - **If we skip it:** After a Kometa update, Studio's edition badges can differ from Kometa's and nothing fails.

29. **Backend helpers exist in several copies**
    - **What this is:** Small helpers written again in each file:
      - the `_settings` and `_http` dependencies (`starr_studio/services.py:82-91`, `starr_studio/tautulli.py:61-70`, `starr_studio/overlays_routes.py:43`, `starr_studio/overlay_engine_routes.py:35`)
      - `mask` (`starr_studio/services.py:33`, `starr_studio/plex_routes.py:79`)
      - `_yaml()` (`starr_studio/kometa_files.py:59`, `starr_studio/ready_made.py:120`, `starr_studio/kometa_import.py:346`, `starr_studio/ready_made_posters.py:47`)
      - a safe JSON write (`starr_studio/tmdb_languages.py:74-78`, `starr_studio/plex_people.py:50-55`, `starr_studio/tmdb_details.py:55`), while `starr_studio/kometa_config.py:200` already has `write_atomic`
    - **Problem:** A fix to one copy, such as how secrets are masked, does not reach the others.
    - **Fix:** Keep one of each and import it. About 30 lines less.
    - **If we skip it:** The copies drift apart over time.

30. **Frontend helpers exist in several copies**
    - **What this is:** The same code in more than one file:
      - `errorFrom`, 3 times (`frontend/src/api.ts:685-697`, `frontend/src/builderApi.ts:246-258`, `frontend/src/importApi.ts:94-106`)
      - the 40-line settings `groups` list and `label()`/`hint()` (`frontend/src/components/KometaSettings.tsx:17-75`, `frontend/src/components/library/LibrarySettingsForm.tsx:17-56`, `frontend/src/components/library/schemaFields.tsx:10-40`)
      - `Outcome` and `Section` (`frontend/src/pages/SettingsConnect.tsx:32-48`, `frontend/src/pages/SettingsNetwork.tsx:13`, `frontend/src/pages/SettingsRequests.tsx:17-32`)
      - the proxy login fields (`frontend/src/pages/SettingsConnect.tsx:50-98`, again inline at `frontend/src/pages/SettingsRequests.tsx:118-143`)
      - `STATUS_LABEL` and `STATUS_TONE` (`frontend/src/pages/Requests.tsx:24-40`, `frontend/src/components/requests/RequestMusic.tsx:11`, `frontend/src/pages/home/ComingIn.tsx:7-23`)
      - `plural` (`frontend/src/pages/Libraries.tsx:13`, `frontend/src/pages/home/WhatChanged.tsx:10`, `frontend/src/pages/home/HomeHeader.tsx:13`)
      - `kindLabels` (`frontend/src/pages/LibraryDetail.tsx:22`, `frontend/src/pages/Playlists.tsx:9`)
      - `useDebounced` (`frontend/src/components/builder/ListSource.tsx:14`, `frontend/src/pages/ActivityHistory.tsx:96`)
      - `tabClass` (`frontend/src/components/SectionTabs.tsx:5`, `frontend/src/pages/Collections.tsx:43`)
    - **Problem:** A new request status or a new Kometa setting has to be added in two or three places. Missing one gives a blank label on one page.
    - **Fix:** Export each once and import it. About 180 lines less.
    - **If we skip it:** More places to keep in step by hand.

### Nice to have

31. **The ready-made catalogue is read from disk on every call** (`starr_studio/ready_made.py:352`, `starr_studio/ready_made.py:766`, `starr_studio/ready_made.py:784`)
    - **What this is:** `categories()`, `customisable()` and `dynamic_source()` parse Kometa's shipped default files.
    - **Problem:** They parse them again on each call (442 ms measured in the first round). These files never change while Studio runs. This adds to finding 8.
    - **Fix:** `lru_cache` keyed by Kometa's folder and library type.
    - **If we skip it:** Ready-made pages stay about half a second slower than needed.

32. **Collection ids are looked up twice** (`starr_studio/ready_made_routes.py:767-778`)
    - **What this is:** After adding ready-made collections, Studio links them to the new run.
    - **Problem:** It runs one query per collection for ids that `mark_present` already returned. The comment there says so.
    - **Fix:** Use the returned ids. 8 lines less.
    - **If we skip it:** Only extra queries and extra code.

33. **`_save_and_run` and `_save_only` share their first 6 lines** (`starr_studio/builder_routes.py:582-602`)
    - **What this is:** Two builder helpers: save, and save then run.
    - **Problem:** The save part is written twice.
    - **Fix:** Let `_save_and_run` call `_save_only`. 6 lines less.
    - **If we skip it:** A change to saving must be made in both.

34. **The seedbox installer asks for `--port` on an update, then ignores it** (`deploy/install-seedbox.sh:92-95`)
    - **What this is:** The same script installs and updates Studio on a seedbox.
    - **Problem:** An update run stops with "give Studio's port with --port", although it reads the port from the saved env file later (lines 207-210).
    - **Fix:** Read the saved port before this check.
    - **If we skip it:** Every update needs a flag that has no effect.

35. **Two leftover lines** (`frontend/src/pages/home/Connected.tsx:37-38`, `frontend/src/pages/overlays/LayerSettings.tsx:31`)
    - **What this is:** `if (check.ok) return "ok"; return "ok";` and `raw.replace("#", "#")`.
    - **Problem:** Neither does anything.
    - **Fix:** Delete them.
    - **If we skip it:** Readers stop to wonder what they are for.

One more reason to fix finding 4: `starr_studio/maintainerr.py:402-418` only catches two error types, so any other error after it takes over Maintainerr's schedule leaves the overlays off with no flag to recover from.

## Should parts be rewritten while there are no users?

Asked after the audit: with no users yet and no backwards compatibility to keep, is it worth rewriting the database or other parts from scratch?

**No. Having no users is useful for deleting code and making breaking fixes cheaply, and a rewrite gives neither.**

### Why not rewrite

- **The audit found no structural problem.** All 35 findings are local: one function or a few lines each. None of them says a module or the data model is wrong.
- **The database layer is already small.** `starr_studio/db.py` is 114 lines, plus 21 plain SQL files and SQLite's own version counter.
- **Much of the code holds lessons from real runs.** Examples are Kometa exiting 0 when it crashes, Maintainerr's overlay order, and how Kometa finds editions. A rewrite would have to relearn those, and the 88 test files would need rewriting with it.

### What "no users" does buy

1. **Delete code that only serves older installs.** I found four pieces:
   - `legacy_seerr`, which moves an older Studio's Seerr connection into config.yml (`starr_studio/requesting.py:145-220`).
   - The `maintainerr.paused` flag left by an older Studio (`starr_studio/maintainerr.py:58`, `starr_studio/maintainerr.py:483`).
   - The pre-rename file header that is still recognised (`starr_studio/studio_files.py:219`).
   - The old designer URL redirect (`frontend/src/pages/OverlayDesigner.tsx`).

2. **Make the breaking fixes now.** A migration can simply drop and recreate a table today; once users exist it has to carry their data over. This applies to finding 7 (two keys for TV shows), finding 5 (pruning run history) and finding 18. The same goes for the route changes in findings 26 and 27, because `/api/v1` with the API key becomes a contract once someone's dashboard calls it.

3. **Settle what freezes at the first beta.** These are the things that become hard to change later:
   - table and column names
   - `/api/v1` routes
   - the header Studio writes into Kometa files
   - the `STUDIO_*` variable names
   - the full-backup zip layout

4. **Squash the 21 migrations into one schema file (optional).** It makes the schema readable in one place, but changes nothing at runtime. I would do it once, right before the first beta, or not at all. If the baseline is numbered 21, a database already at version 21 keeps working.

### One catch

The maintainer's own install is a user: it has real data. The Seerr and Maintainerr code in point 1 exists for exactly that install. Before deleting it, confirm that install has already moved over: Seerr is in config.yml, and no `maintainerr.paused` flag is set.

## Summary

**Verdict:** solid base with good security and tests. Nothing in Part 2 outranks findings 1–4.

**Lean:** about −430 lines (about −200 in Part 1, about −230 in Part 2), −0 dependencies possible.

**Not checked:**

- Nothing was run against a real Plex, Kometa, Radarr, Sonarr, Lidarr, Seerr or Maintainerr.
- The Docker image was not built.
- Finding 10: the test was not run against a Kometa 2.5.4 clone, so the stale clone is the likely cause of the 2 local failures, not a proven one.
- Findings 1, 2, 3 and 13 were reproduced or measured. All the others come from reading the code.
- The test files were not audited for quality.
- The frontend was read with styling classes stripped, so layout and CSS were not checked.
- Built and binary assets (the static bundle, fonts, logo images) were not reviewed.
- For the rewrite question: the live install and its database version were not looked at, and the lines the compatibility code removes were not counted.
