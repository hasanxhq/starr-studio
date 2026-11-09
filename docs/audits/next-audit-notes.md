# Notes for the next audit

Notes collected as we go, for the next audit. Each one is checked and fixed or turned into work then. Bugs go under Bugs, ideas under Proposed features.

## Bugs

Found by the whole-repo audit of 2026-11-10 (`dev` at 83f46f5). Notes 1, 2 and 5 were confirmed with small scripts; the others come from reading the code. Fix 1, 2 and 3 first.

### 1. A website can read Studio through the browser of someone at home (must fix)

- **Where:** `starr_studio/auth.py`, `Caller.local`.
- **What this is:** Studio lets "local" addresses in without a password, on a fresh install or with sign-in set to "disabled for local addresses".
- **Problem:** It never checks the `Host` header. A hostile page can point its own domain at Studio's LAN address (DNS rebinding), so the browser treats Studio as that site. `GET /settings/general` with `Host: evil.example:8484` from `192.168.1.50` returns 200 with the API key, and a POST with a matching `Origin` also passes. The full-backup download holds the Plex token and `secret.key`.
- **Fix:** In `Caller.local`, also require the `Host` name to be an IP address, `localhost`, or a name with no public suffix (no dot, `.local`, `.lan`, `.home.arpa`). Add one test.
- **If we skip it:** Anyone who gets a user to open a web page at home can take the Plex token and every API key.

### 2. Restoring the oldest backup deletes it and fails (must fix)

- **Where:** `starr_studio/config_write.py`, `ConfigWriter.restore`; `starr_studio/backups.py`, `prune`.
- **What this is:** Restore first takes a "before" backup of the current files, then copies the chosen backup's files back.
- **Problem:** Taking a backup prunes to the newest 30. With 30 backups, restoring the oldest makes 31, so the prune deletes the one being restored. The read that follows then fails.
- **Fix:** Pass the folder being restored to `take_backup` as one that `prune` must skip. Add one test with 30 backups.
- **If we skip it:** The oldest backup, the one a user reaches for last, is lost when they try to use it.

### 3. Cancel says "cancelled" even when the download was not stopped (must fix)

- **Where:** `starr_studio/requesting.py`, `RequestService.cancel`.
- **What this is:** Cancelling a request unmonitors the title in Radarr, Sonarr or Lidarr, or deletes the request in Seerr.
- **Problem:** Every app call sits in `except Exception: log.warning`, and the row is then marked `cancelled` anyway. The Seerr delete does not check the status code at all. If Radarr is restarting, Studio shows "cancelled" and Radarr still downloads the movie.
- **Fix:** If the app call fails, leave the status as it is and return an error such as "Radarr didn't answer, try again". Check the status of the Seerr delete.
- **If we skip it:** Users get downloads they believe they stopped.

### 4. Run logs and run rows are never deleted (should fix)

- **Where:** `starr_studio/runner.py`, `Runner._run` and `_finish`.
- **What this is:** Each Kometa run writes its full output to `<data dir>/runs/<id>.log`, plus rows in `runs` and `run_events`.
- **Problem:** Nothing prunes them. Config backups keep 30 and full backups keep 4, but run logs grow for ever. Several megabytes per run, a few runs a day, is gigabytes a year.
- **Fix:** After each run, delete `runs` rows beyond the newest few hundred (`run_events` cascades) and their log files. About 10 lines.
- **If we skip it:** The data folder fills the disk, and the History page gets slower each month.

### 5. A library's own tokens reach the browser unmasked (should fix)

- **Where:** `starr_studio/config_routes.py`, `config_library` (`GET /config/libraries/{name}`).
- **What this is:** The route returns the library's entry from config.yml.
- **Problem:** `settings` holds every key that is not a file list. A library with its own `radarr:` or `plex:` block is returned with its token in clear text. The repo's own rule is that stored tokens never go to the browser.
- **Fix:** Before returning, replace values under the keys `mask_secrets` already knows (token, apikey, password and so on) with `••••`.
- **If we skip it:** Tokens sit in browser memory, dev-tools exports and any proxy log of response bodies.

### 6. An imported title that Plex never matches triggers a full library read every 5 minutes, for ever (should fix)

- **Where:** `starr_studio/requesting.py`, `label_imported`.
- **What this is:** After a requested title is imported, Studio looks it up in Plex to add the `starr` label.
- **Problem:** While any row is `imported` with no `labelled_at`, each check loads every title's IDs for that library. If the file landed in another library, or Plex never matched it, the row never gets labelled.
- **Fix:** Add `AND imported_at > <7 days ago>` to the query. One line.
- **If we skip it:** One stray request makes Studio pull a library of thousands of titles from Plex 288 times a day.

### 7. The show ID lookup reloads a large cache file and calls TMDb again on every check (should fix)

- **Where:** `starr_studio/requesting.py`, `_tmdb_client`, `_tmdb_to_tvdb`, `_tvdb_to_tmdb`.
- **What this is:** `_tmdb_to_tvdb` turns a TMDb show ID into a TVDb ID, for each open show request, every 5 minutes.
- **Problem:** `_tmdb_client()` builds a new `TMDbDetails` on each call. That re-parses `tmdb-details.json`, which holds the whole library's details, on the event loop. It never calls `save()`, so the answer is thrown away and fetched again next time.
- **Fix:** Create one `TMDbDetails` on the service and call `save()` after `refresh`. The second copy of the HTTP call in both functions can then go.
- **If we skip it:** With 40 open show requests the app stalls for seconds every 5 minutes and makes 40 needless TMDb calls.

### 8. A title removed from Radarr or Sonarr stays "requested" for ever (should fix)

- **Where:** `starr_studio/requesting.py`, `refresh`, the movie and show branches.
- **What this is:** `refresh` looks each open request up in the app to update its status.
- **Problem:** When the app no longer has the title, nothing happens unless the request went through Seerr. The Lidarr branch already marks such rows failed with "Removed from Lidarr". The stuck row also counts as active, so Studio never asks for the title again.
- **Fix:** Mark the row `failed` with "Removed from Radarr/Sonarr" when the list is empty and `via` is not `seerr`. About 4 lines each, plus a test.
- **If we skip it:** The Requests badge never clears, and the collection never fills.

### 9. `requesting.py` has the same code several times (should fix)

- **Where:** `starr_studio/requesting.py`.
- **Problem:** These must change together:
  - `_resolve_radarr_options` and `_resolve_sonarr_options`
  - `_ensure_tag` and `_ensure_lidarr_tag`
  - `_seerr_get` and `_seerr_post`, plus a third inline copy in `cancel`
  - the four "X isn't connected" blocks in `request()`
  - the alias `test_seerr_connection = probe_seerr_connection`
- **Fix:** Merge each into one function that takes the app name or API version, and drop the alias. No new layers. About 110 lines go, with note 7.
- **If we skip it:** The next fix lands in one copy and not the other, as note 8 already shows.

### 10. "Downloading" only shows for the first 10 queue entries (nice to have)

- **Where:** `starr_studio/requesting.py`, `refresh`, the three `/queue` calls.
- **Problem:** `/queue` is paged and returns 10 records by default. With 30 downloads going, the 11th onward stays "requested".
- **Fix:** Add `"pageSize": 1000` to the three queue calls.
- **If we skip it:** The status is wrong during big batches. Nothing else breaks.

### 11. The daily cap counts titles that were not sent (nice to have)

- **Where:** `starr_studio/requesting.py`, `request`, `remaining_cap -= 1`.
- **Problem:** The counter drops before the request is made. With a cap of 5, if the first five titles are already in Radarr, the other 15 are "capped" and nothing is requested that day. The comment above it says only sent requests count.
- **Fix:** Move `remaining_cap -= 1` to where `status == "requested"`.
- **If we skip it:** Collections fill a day or more later than they should.

### To check: Docker source addresses

Not tested. On Docker Desktop or rootless Docker, every visitor can appear as the bridge gateway, which is a private address. That would make an internet visitor "local" on a fresh install, against the README's "Internet addresses are refused".

### Not covered by the 2026-11-10 audit

- The frontend (about 32,000 lines): only scanned for unsafe HTML.
- Not read in full: `smart_filters`, `ready_made`, `kometa_import`, `studio_files`, `wanted`, `maintainerr`, `network`, `doh`, `notifications`, `plex.py`, most of `builder_routes`.
- The test suite and a real Kometa, Plex or arr app were not run.

## Proposed features

### 1. Interactive font customisation in the overlay builder

**Today:**
- Kometa's overlay defaults draw text in `fonts/Inter-Medium.ttf` at 55 px, white (`kometa/defaults/overlays/templates.yml`).
- Each layer takes `font`, `font_size`, `font_color`, `font_style` (weight, for variable fonts), `stroke_width` and `stroke_color` (`kometa/docs/files/overlays.md`, the text overlay attributes).
- In Studio, these can only be typed as raw values under a layer's "More variables".
- The preview always draws Inter at the default size. A changed `font_size` isn't shown yet (#123).

**Proposed:** font controls in the overlay builder's layer settings that update the poster preview live:
- a font picker from the fonts Kometa ships in `kometa/fonts/` (Arimo, Comfortaa, Consensus, Figtree, Inter, Lato, Libre Franklin, Montserrat, Roboto, Source Sans 3), each shown in its own face
- size, colour, weight (`font_style`) and outline (`stroke_*`)
- the preview draws the text in the chosen font, size and colour, as Kometa will

**Decided (2026-11-09):**
- Kometa's bundled fonts only: no custom or uploaded fonts.
- Font choice is per layer.
- The preview gets the font files from a read-only route, like the overlay-images route: it serves only from `kometa/fonts/`, and anything else returns 404.
