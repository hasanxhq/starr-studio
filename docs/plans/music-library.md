# Music library management plan

A plan to add Plex music library management to Starr Studio. Starr Studio owns Kometa's configuration and uses Kometa as its run engine. Today Studio handles movie and TV show libraries; this plan extends management to music libraries.

- **Where things stand:** `dev` at `4a7c2f6` (PR #122), 2026-11-09. Where this plan and the code disagree about what exists, the code wins: check it and adjust.
- **Status:** Phase 1 built on 2026-11-09 (music libraries in Studio, artist and album collections). Phases 2 and 3 not started.
- **Phase 1 as built differs in one way:** album collections are a `plex_search` with `builder_level: album`, not a `smart_filter`: Kometa refuses `builder_level` on smart collections and `minimum_items` on album ones (`kometa/modules/builder.py` `smart_invalid`, `parts_collection_valid`).

## Working rules

These extend `AGENTS.md` and match `docs/plans/ui-rework.md`:
1. **Never modify Kometa.** No patches, no fork imports. Studio writes YAML and launches Kometa via subprocess.
2. **Decide, don't ask.** Follow recommended defaults; consult the maintainer only on items changing Plex or *arr state.
3. **Keep every URL working.** No broken routes or bookmarks.
4. **No new YAML in the UI.** Studio manages configuration through forms and builder interfaces; raw YAML stays behind disclosures.
5. **Tests with every change.** Frontend: Vitest + Testing Library. Backend: pytest with `tests/fakeplex.py`.
6. **Hands off:** never touch Maintainerr's collections; ask the maintainer before anything that changes what Plex or an *arr app (Lidarr included) receives. Real-Plex manual tests name collections `TEST …` and leave them.
7. **One step = one topic branch and one draft PR into `dev`**, as in `docs/plans/ui-rework.md`.

---

## 1. What Kometa can do for music

Kometa's music capabilities are documented across `kometa/docs/` and implemented in `kometa/modules/plex.py`, `kometa/modules/builder.py`, and `kometa/modules/operations.py`.

### Builders supported for music
- **Plex search (`plex_search`)**: Queries Plex for artists, albums, or tracks (`kometa/modules/builder.py:797`, `kometa/docs/files/builders/plex/search-options.md`). Music search attributes must begin with `artist_`, `album_`, or `track_` (`kometa/modules/plex.py:604`). Track-level searches also permit `folder_location` and `audio_codec` (`kometa/modules/plex.py:605`).
- **Plex all (`plex_all`)**: Collects all items in the library at the specified builder level (`kometa/modules/builder.py:798, 3292`, `kometa/modules/plex.py:2008-2010`).
- **Smart filters (`smart_filter`)**: Creates native Plex smart collections dynamically updated by Plex using Plex search parameters (`kometa/modules/builder.py:1566-1568, 4272-4420`).
- **Post-filters (`filters`)**: In-memory filtering on Plex attributes (`kometa/modules/builder.py:799`).
- **No external builders**: In music libraries, any builder outside `music_attributes` raises `BuilderValidationError` (`kometa/modules/builder.py:1687-1688`). TMDb, TVDb, IMDb, Trakt, MDBList, WeTrakr, FlickList, and AniList are rejected.
- **No Last.fm, Spotify, or Lidarr**: Kometa has no modules or builders for Last.fm, Spotify, MusicBrainz, Discogs, or Lidarr (0 hits across `kometa/modules/` and `kometa/docs/`).

### Collection item levels
- In music libraries, collections can contain **artists**, **albums**, or **tracks**.
- The collection level is controlled by `builder_level` (`kometa/modules/builder.py:1098-1125`). Defaults to `artist`.
- Allowed music options are `album` and `track` (`kometa/modules/plex.py:373`). When set to `album` or `track`, Kometa creates album- or track-level collections (`parts_collection = True`).
- Music-specific collection attributes include `album_sorting` on collection definitions and `item_album_sorting` on items (`kometa/modules/builder.py:246, 342`).

### Music playlists
- Playlists are global across libraries (`kometa/docs/files/playlists.md`, `kometa/modules/builder.py:812-820`).
- With `builder_level: item` and `type: track` in `plex_search`, Kometa creates Plex audio track playlists using Plex's `createPlaylist` API (`kometa/modules/plex.py:1029-1030`).

### Operations and metadata
- **`update_blank_track_titles`**: Replaces blank track titles with their sort titles (`kometa/modules/operations.py:304-313`, `kometa/docs/config/operations.md:744-758`). Restricted strictly to music libraries.
- **`remove_title_parentheses`**: Strips trailing parenthetical tags like `(Remastered)` from titles (`kometa/modules/operations.py:379-382`, `kometa/docs/config/operations.md:760-776`).
- **Asset directory matching**: Uploads artist posters, backgrounds, and square album artwork from directory paths (`kometa/modules/operations.py:316-374`, `kometa/modules/builder.py:786-807`).
- **Collection management**: `delete_collections`, `show_unmanaged`, and `show_unconfigured` operate uniformly across library types (`kometa/modules/operations.py:1680-1754`).

### Overlays and defaults
- **Overlays**: Kometa's engine has internal support for `artist` and `album` level overlays (`kometa/modules/overlays.py:87-88`, `kometa/modules/overlay.py:54, 82`), but there are **zero default overlay files** for music in `kometa/defaults/overlays/`.
- **Defaults**: There are **no music defaults** in `kometa/defaults/`. Files in `kometa/defaults/both/` (`genre.yml`, `decade.yml`, etc.) are designed for video libraries (`kometa/defaults/both/MODULE.md`). Attempting to run `both/genre.yml` on a music library fails because `genre` is not a valid music search attribute (`kometa/modules/builder.py:4381` requires `artist_genre` or `album_genre`).

---

## 2. What Plex offers and Studio's Plex client

Plex music libraries use section type `artist` (integer type 8 in Plex schema). Under each artist, Plex nests albums (type 9) and tracks (type 10). Collections across all libraries are metadata type 18 (`COLLECTION_TYPE = "18"` in `starr_studio/plex_library.py:19`).

### What works today
- `PlexServer.libraries()` reads `/library/sections` and returns `PlexLibrary(type="artist")` (`starr_studio/plex_library.py:102-104`).
- `PlexServer.collections()` lists `/library/sections/{key}/collections` and finds `Studio`/`Kometa` managed labels via type 18 (`starr_studio/plex_library.py:155-173`).
- `delete_collection()`, `collection_labels()`, and `remove_collection_label()` target collection rating keys directly and work unchanged (`starr_studio/plex_library.py:197-222, 261-282`).
- `collection_items()` reads `/library/collections/{rating_key}/children` and returns the artists, albums, or tracks in the collection (`starr_studio/plex_library.py:302-309`).
- `image()` proxies Plex thumbnail URLs (`starr_studio/plex_library.py:370-390`).
- `tag_values()` queries `/library/sections/{key}/{tag}` for tags (`genre`, `mood`, `style`, `collection`) (`starr_studio/plex_library.py:106-115`).

### What breaks or needs branching
- **`size()`**: Returns `None` because it only maps `{"movie": "1", "show": "2"}` (`starr_studio/plex_library.py:133-140`). Must query type 8 (artists) or 9 (albums) for music.
- **`added_since()`**: Hardcodes type `4` (episodes) or `1` (movies) (`starr_studio/plex_library.py:127-131`). Must support tracks (type 10) or albums (type 9).
- **`_all()`**: Raises `KeyError` on `library_type="artist"` because of hardcoded dictionary indexing `{"movie": "1", "show": "2"}[library_type]` (`starr_studio/plex_library.py:325`).
- **`all_items()`, `all_keys()`, `all_ids()`**: Fail directly because they wrap `_all()` (`starr_studio/plex_library.py:340-351`).
- **`_item()`**: Extracts only `tmdb`, `imdb`, and `tvdb` GUID prefixes (`starr_studio/plex_library.py:401-405`). Modern Plex music agents assign MusicBrainz GUIDs (`mbid://<uuid>`).
- **`count_where()`**: Only passes `type="1"` or `type="2"` (`starr_studio/plex_library.py:117-125`). Needs to pass artist (8), album (9), or track (10).

---

## 3. Lidarr integration model

Lidarr is the music management tool in the *arr suite. Kometa has no Lidarr support, so any Lidarr integration is built directly into Studio.

### Architecture (modelled on `starr_studio/arr.py`)
- **Polling imports**: Studio polls Lidarr's API at `GET /api/v1/history/since` for track imports (unconfirmed: check the event type id against Lidarr's API docs before building).
- **Debounced runs**: Multiple track imports buffer into a single pending Kometa run via `arr.pending` in SQLite, respecting `wait_minutes` and `MAX_WAIT` (`starr_studio/arr.py:11-16, 44-50`).
- **Settings**: Add `lidarr: AppRuns` to `ArrSettings` (`starr_studio/arr.py:70-75`), configured under Settings → Connect.
- **Connection storage**: Radarr and Sonarr's URL and API key come from Kometa's own `config.yml` blocks (`arr.connection` → `kometa_connection`, `starr_studio/arr.py:136`); only the seedbox proxy login lives in Studio's database (`proxy_login`, `starr_studio/arr.py:129`). Kometa has no `lidarr:` block, so Lidarr's URL and API key must live in Studio's SQLite settings, encrypted with `SecretBox` like the proxy login.
- **Requesting**: Requests for missing music (`POST /api/v1/artist` or `album`) must target Lidarr directly via MusicBrainz IDs (`mbid`). Seerr (Overseerr/Jellyseerr) has no music support and cannot be used for music requesting (`starr_studio/requesting.py:753-782`).

### Decisions needing maintainer confirmation
- ~~Storing Lidarr credentials in Studio SQLite rather than `config.yml`~~: decided, SQLite (section 6).
- Monitoring behavior when filing missing music to Lidarr (monitor artist vs monitor specific missing album).
- Whether to support Lidarr import runs in Phase 1 or defer to a dedicated Phase 3.

---

## 4. Studio changes page by page

### Library picker and Settings → Libraries
- `frontend/src/libraries.ts:36` already has `libraryTypeLabels = { ..., artist: "Music" }`.
- Navigation sidebar picker: Allow selecting music libraries.
- Settings → Libraries: Show music libraries with "Music" badge, artist counts, and collection tallies (`frontend/src/pages/Libraries.tsx:25`).

### Collections (All / Ready-made / Builder)
- **All tab**: Shows built music collections. Cards display artist/album counts (`frontend/src/pages/Collections.tsx`).
- **Ready-made tab**: Kometa provides no ready-made defaults for music. The tab stays and shows a "Coming soon" state that points to the builder in the meantime, for example: "Ready-made collections for music are coming soon. Until then, make your own in the builder." Studio-made ready-mades for music are a later idea (section 6).
- **Collection Builder**:
  - Mode: Default to "Organise what I have" (filters). Hide "Get something new" (external lists) because Kometa does not support external music list builders.
  - Level selector: **Artist** (default) or **Album** in Phase 1 (sets `builder_level`); **Track** comes in Phase 2 (decision 4, section 6).
  - Fields & filters: Provide music attributes (`artist_genre`, `album_genre`, `artist_mood`, `album_mood`, `artist_style`, `album_style`, `artist_country`, `album_decade`, `album_year`, `album_record_label`, `track_plays`) in `smart_filters.py`.
  - Sorts: Provide `artist_sorts`, `album_sorts`, and `track_sorts` (`kometa/modules/plex.py:718-779`).
  - Artwork: Support collection square artwork (`file_square_art`, `url_square_art`) in addition to posters.
  - Save: `starr_studio/studio_files.py:259` must not write `radarr_add_missing` or `sonarr_add_missing` for music libraries, which would crash Kometa validation.

### Overlays
- Kometa provides no overlay defaults for music (`kometa/defaults/overlays/`).
- Album cover overlays are generally undesirable in Plex.
- Hide the Overlays navigation tab or show an explanatory empty state when a music library is active: "Overlays are not supported for music libraries."

### Playlists
- `frontend/src/pages/Playlists.tsx`: Playlists are server-level.
- In `ItemEditor.tsx`, `MUSIC_SOURCES = ["plex_search", "plex_all", "smart_filter", "smart_label"]` is already defined (`frontend/src/pages/ItemEditor.tsx:201`).
- Allow adding audio track playlists referencing music libraries.

### Requests
- When a music library is selected, hide the Missing/Requests tab or show "Music requests require a Lidarr connection" until Lidarr is configured.

### Home
- `frontend/src/pages/home/HomeHeader.tsx:9`: Add `artist: "artist"` to `itemWords` so the header displays "X artists · Y collections" instead of omitting the count.
- `ComingIn.tsx`: Hide movie/TV request counters when a music library is selected unless Lidarr requests exist.

### Backend breakage watchlist
- `starr_studio/plex_library.py`: Fix `size()`, `added_since()`, `_all()`, and `count_where()` to support `artist` (8), `album` (9), and `track` (10).
- `starr_studio/builder_routes.py:191`: Remove restriction `if library_type not in ("movie", "show")`.
- `starr_studio/smart_filters.py:499-525`: Add music fields, sorts, and validation rules.
- `starr_studio/studio_files.py:259`: Omit `radarr_add_missing` and `sonarr_add_missing` when `library_type == "artist"`.
- `starr_studio/ready_made_routes.py:235`: Broaden `library_type: Literal["movie", "show"]` to include `"artist"`.

---

## 5. Phases

```
Phase 1: Foundations & Builder ── Phase 2: Operations & Library Refinements ── Phase 3: Lidarr Integration
```

---

### Phase 1 · Foundations and Collection Builder

Enables music library discovery, Home display, and collection building with Plex smart filters and searches.

#### Step 1.1: Plex music library inspection (`music-plex-support`)
- **Delivers**: `PlexServer` methods handle `artist`, `album`, and `track` types without throwing errors.
- **Files touched**:
  - `starr_studio/plex_library.py`
  - `tests/test_plex_library.py`
  - `tests/fakeplex.py`
- **Acceptance list**:
  - `server.size(key, "artist")` returns total artist count from fakeplex.
  - `server.added_since(key, "artist", timestamp)` queries track additions (type 10).
  - `server._all(key, "artist")` fetches all artists without raising `KeyError`.
  - `server.count_where(key, "artist", params)` passes `type="8"`.
  - Existing movie and show tests pass unchanged.

#### Step 1.2: Music smart filters and sorts engine (`music-smart-filters`)
- **Delivers**: Filter definition, validation, and Plex URL translation for music attributes.
- **Files touched**:
  - `starr_studio/smart_filters.py`
  - `tests/test_smart_filters.py`
- **Acceptance list**:
  - `smart_filters.fields("artist")` returns artist, album, and track filter fields.
  - `smart_filters.sorts("artist")` returns Kometa artist sorts (`title.asc`, `plays.desc`, etc.).
  - `smart_filters.validate("artist", spec)` validates `artist_genre`, `album_decade`, `album_year`, and `track_plays`.
  - `smart_filters.validate("artist", {"rules": [{"field": "resolution", "operator": "is", "value": "1080p"}]})` returns validation error.
  - `smart_filters.plex_query()` produces valid Plex query strings for music.

#### Step 1.3: Music collection builder backend (`music-builder-api`)
- **Delivers**: API endpoints for collection builder accept music libraries and emit valid Kometa YAML.
- **Files touched**:
  - `starr_studio/builder_routes.py`
  - `starr_studio/studio_files.py`
  - `tests/test_builder_routes.py`
  - `tests/test_studio_files.py`
- **Acceptance list**:
  - `GET /api/v1/libraries/{library}/builder/fields` succeeds for music libraries.
  - Saving a built collection in a music library generates `studio/<library>/built.yml` with `smart_filter` or `plex_search`.
  - Generated YAML does not contain `radarr_add_missing` or `sonarr_add_missing`.
  - Supports setting `builder_level: album` when requested (track level waits for Phase 2).
  - `POST /api/v1/libraries/{library}/builder/preview/filters` returns live item preview for music.

#### Step 1.4: UI support for music libraries (`music-ui`)
- **Delivers**: Music libraries work smoothly across sidebar picker, Home header, Collections All tab, and the collection builder.
- **Files touched**:
  - `frontend/src/api.ts`
  - `frontend/src/builderApi.ts`
  - `frontend/src/pages/CollectionBuilder.tsx`
  - `frontend/src/pages/Collections.tsx`
  - `frontend/src/pages/ReadyMade.tsx`
  - `frontend/src/pages/Overlays.tsx`
  - `frontend/src/pages/home/HomeHeader.tsx`
  - Associated frontend test files (`*.test.tsx`)
- **Acceptance list**:
  - Selecting a music library updates the sidebar and stores the selection.
  - Home header displays "X artists · Y collections".
  - Collections "Ready-made" tab shows "Coming soon" with a link to the builder.
  - Collections "All" tab lists built music collections.
  - Collection Builder defaults to "Organise what I have" and allows selecting Artist or Album level.
  - Overlays page displays "Overlays are not supported for music libraries" instead of broken controls.
  - Frontend typecheck (`npm run typecheck`) and tests (`npm test`) pass cleanly.

---

### Phase 2 · Operations and Library Refinements

Enables Kometa music operations and artwork management.

#### Step 2.1: Music operations configuration (`music-operations`)
- **Delivers**: UI and config support for music operations `update_blank_track_titles` and `remove_title_parentheses`.
- **Files touched**:
  - `starr_studio/kometa_config.py`
  - `starr_studio/config_items.py`
  - `frontend/src/components/KometaSettings.tsx`
  - Associated backend and frontend tests
- **Acceptance list**:
  - Settings for a music library expose `update_blank_track_titles` toggle.
  - Saves write `operations: { update_blank_track_titles: true }` under the music library in `config.yml`.
  - Video operations (like `mass_critic_rating_update`) are hidden for music.

#### Step 2.2: Track collections, square artwork and album sorting (`music-details`)
- **Delivers**: Track-level collections (`builder_level: track`), square artwork upload (`square_art`) and `album_sorting` collection attributes.
- **Files touched**:
  - `starr_studio/builder_routes.py`
  - `starr_studio/studio_files.py`
  - `frontend/src/pages/builder/builderFields.tsx` (`PosterSection`)
  - Associated tests
- **Acceptance list**:
  - Builder allows choosing Track level; the preview lists tracks.
  - Builder allows setting square art (`file_square_art` / `url_square_art`).
  - Album collections allow setting `album_sorting` (`release.asc`, `release.desc`, etc.).
  - Generated YAML passes Kometa check.

---

### Phase 3 · Lidarr Integration

Connects Studio to Lidarr for automated post-import Kometa runs and missing album requests.

#### Step 3.1: Lidarr connection and import polling (`lidarr-connection`)
- **Delivers**: Lidarr configuration under Settings → Connect, import polling, and queued runs.
- **Files touched**:
  - `starr_studio/arr.py`
  - `starr_studio/arr_routes.py`
  - `frontend/src/pages/SettingsConnect.tsx`
  - Backend and frontend tests
- **Acceptance list**:
  - Settings → Connect allows saving Lidarr URL and API key.
  - Polling queries `GET /api/v1/history/since` and triggers debounced Kometa run after new music imports.
  - Activity queue displays "Lidarr import" trigger.

#### Step 3.2: Missing music requests (`lidarr-requests`)
- **Delivers**: Missing album requests filed directly with Lidarr. **Needs the maintainer's go-ahead first:** it changes what Lidarr receives.
- **Files touched**:
  - `starr_studio/requesting.py`
  - `starr_studio/requests_routes.py`
  - `frontend/src/pages/Requests.tsx`
  - Associated tests
- **Acceptance list**:
  - Missing music items can be submitted to Lidarr.
  - Requests page displays status (`requested`, `downloading`, `imported`) with Lidarr tag.

---

## 6. Decisions (2026-11-09)

The maintainer accepted the recommended defaults, with one change to the Ready-made tab.

1. **Library size on Home:** the count of artists, the top level of the section, as movies and shows do.
2. **Lidarr connection details:** encrypted in Studio's SQLite settings (`SecretBox`), never in `config.yml`.
3. **Ready-made tab:** keep the tab, showing **"Coming soon"** with a pointer to the builder. Not hidden, and no "Kometa has none" wording.
4. **Levels:** Artist and Album in Phase 1; Track waits for Phase 2.

### Later: ready-made collections for music

Kometa has no music defaults, so music ready-mades would be Studio's own. They'd be built from Plex searches that Kometa can run. Ideas to discuss before any work starts:
- **Rating-based:** for example, top-rated albums or artists by the user's star rating or the critic rating.
- **Award categories:** collections Studio creates for music awards. Where the award data comes from is unsettled: Kometa has no external music builders, so it would be a list Studio keeps or fetches itself.

Not in any phase yet.
