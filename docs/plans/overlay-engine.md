# Overlay engine plan

A plan for Starr Studio to draw poster overlays itself, instead of through Kometa, with an editor that responds like a photo editing app.

- **Where things stand:** `dev` at `2d22c26` (PR #133), 2026-11-10. Where this plan and the code disagree about what exists, the code wins: check it and adjust.
- **Status:** planned; nothing built. Decisions D1–D4 accepted on 2026-11-10 (see the end); styles are YAML files (3.6). Phase 0 done on 2026-11-10: the gate passed, SVG + resvg confirmed (see "Phase 0 results"). Phase 1 done on 2026-11-10 (PR #136, see "Phase 1 results"). Phase 2 is next.
- **Why now:** the maintainer finds the overlay studio slow and clunky, and the look stale. Mock-ups on real posters (2026-11-10: glassy, modern streaming and minimal, each in two free versions and one Kometa-drawable version) showed that Kometa can draw most of the shapes, but:
  - **its rules can't keep a style off some titles**, so two overlay sets overlap on the same poster;
  - **every change is a whole Kometa run**: 3 of the 3.2 minutes of run 25 were overlays (90 s choosing titles, 86 s drawing 185 posters, 32 s uploading);
  - **the editor can only approximate what Kometa will draw**, so the preview and the result disagree.

The maintainer's pick is **Modern streaming, version C** (dark band at the bottom, IMDb and Rotten Tomatoes scores, an outlined resolution box with HDR and audio after it, a red NEW tag). It is the first style to build.

## Working rules

These extend `AGENTS.md` and match `docs/plans/ui-rework.md` and `docs/plans/music-library.md`:

1. **Never modify Kometa, never import it.** This plan copies some of Kometa's overlay logic (MIT licence, notice kept) into `starr_studio/`. `AGENTS.md` allows that since D1: "no imports of Kometa internals" stays; "copy with attribution" is new.
2. **Posters are the user's data.** Studio never uploads a poster without a stored original it can restore, never deletes an original, and never draws on a poster another tool (Maintainerr, Kometa, the user) has just changed without noticing it first.
3. **One engine per library.** A library's overlays come from Kometa *or* Studio, never both. Switching is explicit and per library.
4. **Ask before Plex changes.** Phases 0 and 1 write nothing to Plex. Anything that uploads posters is tried on items the maintainer names before any whole library, and switching a library over needs a yes each time.
5. **Hands off Maintainerr.** Its overlays win (see its section below).
6. **Tests with every change.** Backend: pytest with `tests/fakeplex.py`; the renderer gets golden-image tests. Frontend: Vitest + Testing Library.
7. **One step = one topic branch and one draft PR into `dev`.**

---

## 1. What others do

Studied on 2026-11-10. Repositories and pages read are listed under Sources.

| Tool | Server | How overlays are made | Preview = final? | Keeps originals / notices replaced posters |
|---|---|---|---|---|
| **Kometa** | Plex | YAML overlay files, Pillow drawing, rules via the collection builder | No editor | Originals folder per library; `Overlay` label; full run each time |
| **Projectionist** (Go, MIT, 2026) | Plex | GUI with 34 badge families in three styles, including frosted glass; rule-based custom badges | Draws in the browser on Canvas2D; the rules are mirrored on the server and kept in step by a shared test suite | Downloads and checks the current poster, stores it write-once with a checksum, restores the exact bytes. No replacement detection found |
| **Kometizarr** (Python + React, MIT, 2026) | Plex | One JSON file; web UI with drag-to-place for four rating badges | "Live preview: render 3 real posters before committing" | Backups per title; **incremental by default** (new items only, webhook for new imports, "force" to redo all). About 0.5–4 movies a second |
| **Posterizarr** (PowerShell + ImageMagick) | Plex, Jellyfin, Emby | Makes whole new posters (textless art, title text, gradients, borders) | n/a | Uploads new artwork rather than overlaying |
| **Poster overlays plugin** (MarcFauser, C#, AGPL) | Jellyfin | Settings page; sizes are percentages of the image | **Dry run uses the same drawing code** and throws the result away | Caches the untouched cover, **hashes the image it uploaded and compares the current one to it** to notice a provider replacing the poster; redraws from the original, never from the current image; per-item Apply / Restore / Repair |
| **JellyTag** (C#, SkiaSharp, MIT) | Jellyfin | Config page with per-badge panels and live preview; JSON export/import | Live preview in settings | **Never changes the poster**: draws on each image request (HTTP middleware) and caches the result |
| **Emby Cover Art** (paid) | Emby | PNG badge files in a folder | No preview for badges | Draws on request |
| **Poster Tools** (hosted web app) | Emby, Jellyfin (Plex "coming soon") | Browser designer; one design makes matching variants for every season | Not stated | Uploads new artwork |

**What this tells us:**
- **Plex can't do JellyTag's "draw on request".** Plex clients fetch posters from Plex directly and Plex has no plugin hook, so on Plex an overlay has to be burned into an uploaded poster. Everyone on Plex keeps originals and restores them.
- **The best safety model is MarcFauser's:** keep the original, hash what you uploaded, compare before drawing, always redraw from the original, and offer per-item Apply / Restore / Repair and a dry run.
- **The best speed model is Kometizarr's:** only new or changed titles, triggered by imports, with "redo everything" as an explicit action.
- **The best editor is nobody's yet.** Projectionist comes closest, with drawing in the browser. Its uploaded bytes may not be the browser's drawing, though: it doesn't say.

## 2. What makes an editor feel like a photo editing app

From Figma's engineering posts, Konva's performance guide and Photopea's release notes (Sources):

- **Don't re-render the app while dragging.** Move the dragged element directly (a transform on one node, once per frame), and update app state only when the drag starts and ends. Konva's React example does exactly this.
- **Redraw only what changed.** Static things (the poster) stay put; only the moving layer redraws. Photopea and Figma keep layers on the GPU.
- **Text must be laid out the same way every time.** Figma built its own text layout because browsers lay text out differently. For us: the same font files and one layout source of truth (see the renderer below).
- **Draft first, exact second.** Show the instant browser version while the hand is moving; swap in the exact render a moment after it stops.
- **Expected tools:** snapping guides (poster edges, centre, safe margins, other elements) with a key to turn snapping off; arrow-key nudges (1 px, 10 px with Shift); undo and redo; select several elements and move them together; align and distribute; a layers list; percentages rather than pixels so a style fits any poster size (MarcFauser).

**Targets (ours):** a drag follows the pointer at 60 frames a second; any edit shows within one frame; the exact render arrives within about 150 ms of the last change; switching the sample poster is instant.

## 3. The design

### 3.1 One description, two renderers that agree: SVG

A style is stored as a small **scene**: elements (text, shape, image, band, logo) with position, size, colours, effects and a "show when" rule. Studio turns a scene plus one title's facts into **SVG**:

- **In the editor** the browser shows that SVG directly over the poster. Dragging moves an SVG node; nothing else redraws. SVG gives gradients, rounded boxes, outlines, drop shadows, blur and clipping natively, with real fonts.
- **On the server** the same SVG is turned into pixels with **resvg** (Rust, used from Python through the `resvg-py` binding) and laid onto the original poster with Pillow.
  - resvg supports gradients, masks, clip paths, `feGaussianBlur` and `feDropShadow`.
  - It gives identical pixels on every platform ("Each pixel would have the same value"), as long as it's given the same font files. Studio ships its own fonts and loads only those.
- **Frosted glass** is a blurred copy of the poster clipped to the pill's shape: a normal SVG filter, so both renderers can draw it.
- **Text** is the one place the browser and resvg can differ slightly (spacing). The exact server render replaces the browser draft within about 150 ms of the last change, so what you settle on is what will be uploaded. Phase 0 measures how big the difference is.

**Why not the alternatives:**
- **Port Kometa's Pillow drawing and copy it in the browser:** two renderers that drift apart. That's today's problem.
- **Draw in the browser and upload the browser's image (Canvas2D):** nothing can draw overlays when no browser is open, for example after an import at 3 a.m.
- **A headless browser on the server:** about 300 MB more in the image, and slow to start.

If Phase 0 shows resvg can't do something we need, the fallback is a Pillow renderer of the same scene, with the browser draft as an approximation (decision D2).

### 3.2 Facts per title, gathered cheaply

Rules and text need facts: resolution, HDR / Dolby Vision / HDR10+, audio codec and channels (Atmos), edition, added date, and ratings (Plex's own IMDb, Rotten Tomatoes critic and audience, and TMDb scores, as seen on the maintainer's Movies library).

- **One listing call per library** gives resolution, codec, channels and added date.
- **The details call per title** gives HDR, Dolby Vision, Atmos and ratings. It's needed only for titles whose Plex `updatedAt` changed since last time, and the results are cached in Studio's database.

So after the first pass, gathering facts for a library takes about a second, against Kometa's 90 s.

### 3.3 Rules

A "show when" rule per element, for example "resolution is 4K", "has Dolby Vision", "added in the last 14 days" or "has an IMDb score". Rules use the same filter model and UI as the collection builder's filters (`FilterRule`), and are checked in memory against the facts. Rules can also leave out titles ("not these"), which fixes the overlap problem from the proof run.

The resolution, HDR and audio detection rules are copied from Kometa's own sets (`kometa/defaults/overlays/resolution.yml`, `video_format.yml`, `audio_codec.yml`) so results match what users know.

### 3.4 Applying to Plex: safe, incremental

Per title, Studio stores:
- **the original poster:** imported from Kometa's `overlays/<library> Original Posters/` when Kometa had overlaid it, otherwise downloaded and checked once, and never deleted;
- **a hash of the poster Studio uploaded;**
- **a fingerprint of what it drew** (style version + the facts it used).

Each pass works like this:

1. Gather facts (3.2) and work out each title's fingerprint.
2. **Skip** titles whose fingerprint and current poster are unchanged.
3. **If the current poster isn't the one Studio uploaded**, something else replaced it (Plex refresh, the user, Maintainerr, Kometa). Studio then:
   - takes the new poster as the new original, unless it's Maintainerr's (see below);
   - logs it;
   - redraws from the new original. No warnings, in line with "fully managed".
4. Draw from the original, upload, record the hash.

The engine draws on several processor cores at once and uploads a few posters at a time.

**Triggers:**
- a title imported by Radarr or Sonarr (Studio already follows imports): that title only, within seconds;
- a style or rule change: only the titles it affects;
- a nightly check;
- "Redraw all" when asked.

**Restore** puts the original bytes back:
- per title, per library, or for everything;
- also when a library is switched back to Kometa;
- with a dry run that shows what each action would change.

### 3.5 Maintainerr and Kometa

- **Maintainerr's overlays win.** Studio doesn't draw on titles that are in Maintainerr's collections. When one leaves, Studio notices the poster change (3.4) and draws again.
- **The switch is a setting:** Settings → Overlays has, for each library, "Overlays drawn by: Kometa / Starr Studio" (maintainer's request, 2026-11-10). Changing it runs the switch below after a confirmation that says how many posters will be redrawn. Kometa stays the default until a library is switched.
- **Kometa:** switching a library to Studio's engine removes that library's `overlay_files` from config.yml (Studio owns the config), imports Kometa's originals, and redraws. Kometa's later runs skip overlays for that library, so they get faster. Switching back restores the originals and puts the old `overlay_files` back from the backup.

### 3.6 Styles are YAML files

A style (template) is one YAML file. The GUI and the file are two views of the same thing: everything the editor does is written to the file, and anything written in the file shows in the editor. Power users can edit the file, share it and keep it in git. Everyone else never sees it (working rule: no YAML in the main UI, raw YAML behind a disclosure).

**Why YAML:**
- Kometa users already know it.
- It allows comments.
- Studio already rewrites YAML keeping the user's comments (ruamel, as for config.yml).
- Studio already checks YAML against a schema in the browser (`frontend/src/yaml/`).

**The format** (version 1), Modern streaming C as the example:

```yaml
studio_style: 1                    # format version, for later migrations
name: Modern streaming
description: Dark band at the bottom with scores, quality and sound.
canvas: poster                     # 1000×1500 units; season, episode, album later
fonts: [Inter]                     # shipped with Studio, or files in config/studio/fonts/

options:                           # what a library can change without editing the file
  accent:   { type: colour, default: "#E50914", label: Accent colour }
  band:     { type: percent, default: 65, label: Band darkness }
  new_days: { type: number, default: 14, min: 0, label: Show NEW for how many days (0 = never) }
  ratings:  { type: choice, multiple: true, default: [imdb, rt_critic],
              choices: [imdb, rt_critic, rt_audience, tmdb], label: Ratings }

elements:
  - id: band
    type: rect
    box: { left: 0, right: 0, bottom: 0, height: 17% }
    fill: { colour: "#000000", opacity: $band }

  - id: scores
    type: row                      # lays children left to right; hidden ones close up
    box: { left: 48, bottom: 150 }
    gap: 36
    children:
      - { type: logo, image: imdb, height: 64, show_when: { has: imdb, option: { ratings: imdb } } }
      - { type: text, text: "{imdb}", font: Inter Bold, size: 54, show_when: { has: imdb, option: { ratings: imdb } } }
      - { type: logo, image: rt_fresh, height: 64, show_when: { has: rt_critic, option: { ratings: rt_critic } } }
      - { type: text, text: "{rt_critic}%", font: Inter Bold, size: 54, show_when: { has: rt_critic, option: { ratings: rt_critic } } }

  - id: quality
    type: row
    box: { left: 48, bottom: 52 }
    gap: 22
    children:
      - { type: text, text: "{resolution}", font: Inter Bold, size: 42, outline: { colour: "#FFFFFF", width: 3, radius: 8, padding: [6, 13] } }
      - { type: text, text: "{hdr}", font: Inter Bold, size: 42, colour: "#E1E1E1", show_when: { has: hdr } }
      - { type: text, text: "{audio}", font: Inter Bold, size: 42, colour: "#E1E1E1" }

  - id: new
    type: text
    text: NEW
    box: { left: 40, top: 40 }
    font: Inter ExtraBold
    size: 40
    background: { colour: $accent, radius: 14, padding: [16, 40] }
    show_when: { added_within_days: $new_days }
```

**Rules of the format:**
- **Boxes** are pinned to poster edges (`left`, `right`, `top`, `bottom`, or `centre`) in poster units (1000 wide) or percentages. That's what keeps a style right on any poster size, and what the editor's snapping writes.
- **Element types:** `rect`, `text`, `logo` (shipped badge images or the user's own PNG/SVG), `image`, `row` and `column` (flow layout: the piece Kometa lacks), and `group`.
- **Effects** on any element: `shadow`, `blur_behind` (frosted glass), `gradient`, `opacity`, `outline`.
- **Text** fills `{placeholders}` from the title's facts (3.2): `{resolution}`, `{hdr}`, `{audio}`, `{channels}`, `{imdb}`, `{rt_critic}`, `{rt_audience}`, `{tmdb}`, `{edition}`, `{year}`, `{runtime}` and so on.
- **`show_when`** uses the rule model of 3.3 (`has`, equals, lists, `added_within_days`, `any` / `all` / `not`), plus `option:` to tie an element to an option.
- **`$name`** refers to an option. There are no expressions and no loops. That keeps files readable and every file safely editable in the GUI.
- **Power users' escape hatch:** an `svg` element with a raw SVG fragment. It is checked against an allow-list (no scripts, no external links), and the GUI shows it as one box it can move but not edit inside.
- **Validation:** a JSON Schema for the format checks the YAML in the browser editor (with completion) and on the server before anything is drawn. A file that fails is never applied.

**Where styles live:**
- **Shipped styles** sit in the Studio image (`starr_studio/styles/`) and are read-only. "Duplicate" copies one to edit.
- **The user's styles** are files in `config/studio/styles/`. Studio picks up a file edited there by hand.
- **A library's choice** of style and its option values (for example accent colour) sit in Studio's database, so one style file serves many libraries with different options.

**Sharing:** Export gives the YAML file, plus any custom logos and fonts it uses, as a zip. Import takes the same and validates it first.

### 3.7 The editor

- **The canvas** is the poster with the SVG on top. Drag, resize, snapping guides, nudges, undo and redo, multi-select, align and distribute, and a layers list. Each element's Style, Show when and Text controls sit beside it.
- **Samples:** choose any title. A grid shows the style on 12 varied titles at once (light and dark posters, 4K and 1080p, with and without scores) to catch problems a single poster hides. It's drawn by the browser, with exact renders swapped in.
- **Saving is a draft.** Nothing reaches Plex until Apply, which shows how many posters will change and roughly how long it will take.

## 4. Phases

Each step is one branch and one PR.

### Phase 0: spike (nothing written to Plex)
1. Add `resvg-py` in the container. Render Modern streaming C as SVG onto the three originals from the proof run (Poor Things, Oldboy, Moonlight), including a frosted-glass pill, a gradient and a drop shadow.
2. Compare the browser's drawing of the same SVG with resvg's, pixel by pixel, at 1000×1500. Measure the time per poster.

**Gate:** text spacing differs by no more than 1–2 px, and a poster renders in under about 200 ms. If not, take the D2 fallback.

**Phase 0 results (2026-11-10).** Spike code is in `scripts/spike_overlay/` (throwaway; see its docstrings). It drew Modern streaming C, and a version with a gradient, a drop shadow and frosted glass, on the three posters, at 1000×1500, in two text modes:
- **Text placement, browser vs resvg** (each text element measured alone, 41 per mode):
  - live SVG `<text>`: at most 2 px apart, median 1 px;
  - **text as glyph outlines** (shaped with HarfBuzz, outlines from fontTools): **at most 1 px, median 0**. The 1 px is anti-aliasing at an edge.
  - **Decision:** the engine writes text as outlines, so the browser and resvg draw the same shapes and fonts never depend on the renderer.
- **Whole posters, browser vs resvg:** mean difference 0.12–0.55 out of 255 with outlines (0.3–0.7 with live text); under 0.04% of pixels differ by more than 24.
- **Speed:**
  - resvg-py returns PNG bytes only, so drawing the whole poster inside the SVG is slow (about 0.9–1.2 s, almost all JPEG decoding and encoding a 2 MB photo PNG).
  - **The production path:** resvg draws only the overlay on a transparent canvas, and Pillow lays it on the original and writes the JPEG. Frosted glass gets only the crop of the poster under it (crop margin 40 px, beyond 3σ of a 12 px blur). It matches the full render up to JPEG noise.
  - That path takes **143–193 ms per poster** for Modern streaming C and 237–267 ms with the extras, reading and writing the poster included.
  - With **4 processes: 17.7 posters a second** (185 posters ≈ 10 s, against Kometa's 86 s). Threads give only 6.2 a second (the binding holds Python's lock), so the engine uses processes.
- **Dependencies for Phase 1**, all with wheels for x86_64, aarch64 and musl:
  - `resvg-py` 0.5 (MIT; resvg is Apache-2.0)
  - `uharfbuzz` 0.57 (Apache-2.0)
  - `fonttools` 4.68 (MIT)
  - Fonts: Inter (OFL-1.1) ships with Studio.
- **Not measured yet:** dragging in the editor. That's Phase 4, and the editor moves SVG nodes, which browsers handle at full frame rate.

### Phase 1: engine core (nothing written to Plex)
1. Scene format and SVG writer; fonts shipped with Studio.
2. Facts per title (3.2), with a cache table and a migration.
3. Rules (3.3) using the builder's filter model; detection rules copied from Kometa's sets, with attribution.
4. Preview endpoint: scene + title → PNG. Golden-image tests.

**Phase 1 results** (2026-11-10, all in `starr_studio/overlay_engine/`):
- `style.py` (format v1), `facts.py`, `fonts/` (Inter), `logos/` (stand-ins drawn by `scripts/make_overlay_logos.py`), `styles/modern-streaming.yml`.
- `facts_plex.py`: facts from Plex's metadata, cached in `overlay_facts` (migration 0019) by `updatedAt`. Audio comes from the media summary, Atmos and DTS:X from the stream with the summary's codec. Detection is Studio's own, written from Plex's fields; no Kometa code was copied.
- `rules.py`: options, show_when and placeholders resolved per title. show_when uses the style's own keys (3.6), not the builder's filter model.
- `render.py`: one SVG scene for browser and server, text as glyph outlines; on the server resvg draws only the overlay and Pillow composites it. Golden-image tests in `tests/fixtures/overlay_render/`.
- `POST /api/v1/overlay-engine/preview`: a shipped style or a style file, option values and a rating key give the JPEG the engine would upload (JPEG rather than PNG, so the preview is exactly what Plex will get). It draws on Kometa's untouched backup when one exists.
- Tried read-only on the real Plex: Poor Things, Oldboy, Moonlight and The Two Towers came out right (Atmos, HDR and ratings). A poster takes 0.2 s on the test poster and 0.3–0.6 s on real ones (large originals are decoded and resized first).
- Moved to Phase 2: the process pool for whole libraries; caching the 1000×1500 original so it isn't decoded again on every pass.

### Phase 2: applying (Plex writes, asked first)
1. Originals store: import from Kometa's folder and from Studio's `overlay-originals` preview cache where useful.
2. Upload, hash, fingerprint and skip; noticing replaced posters; restore; dry run; per-title Apply / Restore / Repair.
3. Proved on titles the maintainer names, then on one library they choose.

### Phase 3: style files, Modern streaming and the gallery
The style format (3.6) with its JSON Schema and loader; Modern streaming as the first shipped style; the gallery on the user's own posters; options per library; Apply; the YAML view behind a disclosure; export and import.

### Phase 4: the editor
SVG canvas, snapping, undo, multi-select, layers, the 12-poster grid, and exact renders on idle.

### Phase 5: switching over and automation
The Settings → Overlays switch per library (3.5); triggers after imports; nightly check; the Maintainerr guard; Glassy and Minimal templates.

### Later
TV seasons and episodes, more rating sources (MDBList, Trakt, Letterboxd), music album covers, per-title overrides, sharing templates.

## 5. Decisions (accepted 2026-11-10)

- **D1. Copying Kometa code:** yes. Studio may copy parts of Kometa's overlay logic (MIT, notice kept) into `starr_studio/`; `AGENTS.md` says so.
- **D2. Renderer:** SVG drawn by resvg on the server and by the browser in the editor (3.1), confirmed by Phase 0; a Pillow renderer only if Phase 0 fails.
- **D3. First scope:** movie and show posters; seasons, episodes and music later.
- **D4. Existing Kometa layers:** offer templates when a library switches, rather than converting Kometa's built-in layers; libraries not switched keep Kometa's overlays.
- **Styles are YAML files** (3.6), editable both in the GUI and by hand, at the maintainer's request for power users.

## Sources

- Kometa overlay code read locally: `kometa/modules/overlay.py`, `kometa/modules/overlays.py`, `kometa/modules/library.py` (MIT).
- Projectionist: <https://github.com/Tr33oflife/Projectionist> (README, HANDOFF.md)
- Kometizarr: <https://github.com/P2Chill/kometizarr>
- Posterizarr: <https://github.com/fscorrupt/Posterizarr>
- Jellyfin poster overlays plugin: <https://github.com/MarcFauser/jellyfin-plugin-poster-overlays>
- JellyTag: <https://github.com/Atilil/jellyfin-plugins/blob/main/Jellytag/README.md>
- Aphrodite (archived 2025-11-13): <https://github.com/jackkerouac/aphrodite>
- Poster Tools: <https://jellywatch.app/blog/poster-tools-browser-poster-title-card-designer-plex-emby-jellyfin-2026>
- Emby Cover Art, community threads: <https://emby.media/community/topic/72396-coverart-show-us-your-custom-overlay-templates>
- Figma, building a design tool on the web: <https://madebyevan.com/figma/building-a-professional-design-tool-on-the-web/>
- Figma, rendering powered by WebGPU: <https://www.figma.com/blog/figma-rendering-powered-by-webgpu/>
- Konva performance tips: <https://konvajs.org/docs/performance/All_Performance_Tips.html>
- Photopea 1.3 (WebGL): <https://blog.photopea.com/photopea-1-3.html>
- Polotno rendering (one schema, browser and server): <https://polotno.com/blog/polotno-rendering-explained>
- resvg: <https://github.com/linebender/resvg> and its support table <https://linebender.org/resvg-test-suite/svg-support-table.html>
- resvg-py: <https://resvg-py.readthedocs.io/en/latest/>
