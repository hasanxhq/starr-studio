# Overlay engine plan

A plan for Starr Studio to draw poster overlays itself, instead of through Kometa, with an editor that responds like a photo editing app.

- **Where things stand:** `dev` at `2d22c26` (PR #133), 2026-11-10. Where this plan and the code disagree about what exists, the code wins: check it and adjust.
- **Status:** planned; nothing built. Phase 0 (a spike, no Plex writes) is next once the maintainer agrees to the open decisions at the end.
- **Why now:** the maintainer finds the overlay studio slow and clunky, and the look stale. Mock-ups on real posters (2026-11-10: glassy, modern streaming and minimal, each in two free versions and one Kometa-drawable version) showed that Kometa can draw most of the shapes, but:
  - **its rules can't keep a style off some titles**, so two overlay sets overlap on the same poster;
  - **every change is a whole Kometa run**: 3 of the 3.2 minutes of run 25 were overlays (90 s choosing titles, 86 s drawing 185 posters, 32 s uploading);
  - **the editor can only approximate what Kometa will draw**, so the preview and the result disagree.

The maintainer's pick is **Modern streaming, version C** (dark band at the bottom, IMDb and Rotten Tomatoes scores, an outlined resolution box with HDR and audio after it, a red NEW tag). It is the first style to build.

## Working rules

These extend `AGENTS.md` and match `docs/plans/ui-rework.md` and `docs/plans/music-library.md`:

1. **Never modify Kometa, never import it.** This plan copies some of Kometa's overlay logic (MIT licence, notice kept) into `starr_studio/`. That is a change to `AGENTS.md` ("no imports of Kometa internals" stays; "copy with attribution" is new) and needs the maintainer's yes: decision D1.
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
- **Kometa:** switching a library to Studio's engine removes that library's `overlay_files` from config.yml (Studio owns the config), imports Kometa's originals, and redraws. Kometa's later runs skip overlays for that library, so they get faster. Switching back restores the originals and puts the old `overlay_files` back from the backup.

### 3.6 Templates

A template is a scene with a few named options (accent colour, band darkness, top or bottom, which ratings, NEW for how many days). Studio ships three, from the mock-ups: **Modern streaming** (first), **Glassy** and **Minimal**. Users:
- pick one in a gallery, shown on their own posters;
- change its options;
- then optionally open it in the free editor.

Templates export and import as files.

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

### Phase 1: engine core (nothing written to Plex)
1. Scene format and SVG writer; fonts shipped with Studio.
2. Facts per title (3.2), with a cache table and a migration.
3. Rules (3.3) using the builder's filter model; detection rules copied from Kometa's sets, with attribution.
4. Preview endpoint: scene + title → PNG. Golden-image tests.

### Phase 2: applying (Plex writes, asked first)
1. Originals store: import from Kometa's folder and from Studio's `overlay-originals` preview cache where useful.
2. Upload, hash, fingerprint and skip; noticing replaced posters; restore; dry run; per-title Apply / Restore / Repair.
3. Proved on titles the maintainer names, then on one library they choose.

### Phase 3: Modern streaming template and gallery
The template with its options; the gallery on the user's own posters; Apply.

### Phase 4: the editor
SVG canvas, snapping, undo, multi-select, layers, the 12-poster grid, and exact renders on idle.

### Phase 5: switching over and automation
Per-library switch from Kometa (3.5); triggers after imports; nightly check; the Maintainerr guard; Glassy and Minimal templates.

### Later
TV seasons and episodes, more rating sources (MDBList, Trakt, Letterboxd), music album covers, per-title overrides, sharing templates.

## 5. Open decisions for the maintainer

- **D1. Copying Kometa code.** Allow Studio to copy parts of Kometa's overlay logic (MIT, notice kept), mainly the detection rules and the originals handling, into `starr_studio/`, and update `AGENTS.md` to say so. *Recommended: yes.*
- **D2. Renderer.** SVG drawn by resvg on the server and by the browser in the editor (3.1), confirmed by Phase 0; the Pillow fallback only if Phase 0 fails. *Recommended: SVG + resvg.*
- **D3. First scope.** Movie and show posters first; seasons, episodes and music later. *Recommended: yes.*
- **D4. Existing Kometa overlay layers.** When a library switches, offer a template instead of converting Kometa's built-in layers one for one. Conversion would mean re-creating Kometa's look, which is what the maintainer wants to leave. *Recommended: offer templates; keep Kometa's overlays on libraries not switched.*

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
