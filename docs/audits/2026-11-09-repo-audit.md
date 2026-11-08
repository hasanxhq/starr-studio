# Repo re-audit, 2026-11-09

Audited `dev` at `f9c1ecf` (after #111, the end of the UI rework). Read-only apart from this file. It compares with the first audit, `docs/audits/2026-11-07-repo-audit.md`. Findings 8–11 of that audit live on draft PR #95 (branch `audit-kometa-pin`), which merges just before the fixes start.

**What this repo does:** Starr Studio is a self-hosted web app (FastAPI + React) that manages collections, posters and overlays for a Plex library. It keeps your choices in SQLite, writes the YAML files Kometa reads, and starts Kometa one run at a time from a queue. It can ask Radarr, Sonarr or Seerr for missing titles, and steers around Maintainerr's collections and overlays. Assumed load: one household, one admin, a few browser tabs, background schedules, one Kometa process at a time.

## What changed since the first audit

Since `ce32ae0` the backend changed little: the other-collections endpoint (#102), `last_change` (#106) and `skip_requests` (#97). All three have tests, and nothing in them is a finding. The frontend changed a lot: the Home page, the builder with its shelf and local drafts, the Collections All tab, the run card and overlay drag. The new findings are all in the builder.

## Status of the first audit's findings

| # | Finding | Status |
|---|---|---|
| 1 | One failed hook stops every Kometa run until Studio restarts | **Still open.** `runner.py:268` still catches only `RunHeld, ValueError, OSError`; `maintainerr.py:399` still waits outside the `try`. |
| 2 | A ready-made pick can take a builder collection's name; removing one deletes the other | **Still open.** `_not_taken` (`ready_made_routes.py:507`) is unchanged. More likely now: the All tab shows both kinds side by side. |
| 3 | The "file" run scope is never set | **Still open.** `set_run_scope` still has no caller outside tests. `plan_run_scope` is now also used by `build_routes.py:149`; delete the file branch there too. |
| 4 | The "delete only Studio's own collection" rule is written twice | **Still open.** `builder_routes.py:549` and `ready_made_routes.py:447`. |
| 5 | Two requests at once can file titles twice and pass the daily limit | **Still open.** The service has a lock (`_carrying`, `requesting.py:432`), but it only guards the Seerr carry-over, not `request()`. |
| 6 | Daily request limit resets at midnight UTC | **Still open** (`requesting.py:892`). |
| 7 | Removing several picks downloads Plex's collection list once per pick | **Still open** (`ready_made_routes.py:463`). |
| 8 | Studio keeps no log of its own | **Still open.** No logging setup anywhere in `starr_studio/`. |
| 9 | Kometa is bundled but still treated as the user's to update | **Still open** (`compose.yaml:8` still takes `KOMETA_TAG`). |
| 10 | Delete shows no progress while it waits for Plex | **Still open** (`ui.tsx:109`; `ConfirmButton` only disables). |
| 11 | Build stays disabled after restoring a draft | **Reproduced and diagnosed**, below. |

The fixes for 1–10 in the first audit still apply as written, apart from the extra `build_routes.py` caller in 3.

## Must fix

11. **A restored draft can be empty, and your real draft is overwritten by it** (`frontend/src/pages/builder/useLocalDraft.ts:49-65`, `frontend/src/pages/CollectionBuilder.tsx:91,213-239`, `frontend/src/pages/builder/draft.ts:106-110,168-173`)
    - **What this is:** The builder keeps an unsaved new collection in the browser (`localStorage`, one slot per library). When you open Collections → New again, it offers "Restore your unsaved draft?". Build and Save for later need `canSave`: a title, and in list mode a picked source.
    - **Reproduced in the user's container** (Playwright, writes blocked, nothing saved):
      - A filled filter draft ("TEST A24", Studio is A24, 14 titles) restores fine: Build enabled.
      - A filled list draft ("TEST A24", TMDb popular) restores fine: Build enabled.
      - **Pick "Get something new" and type nothing:** the page shows "Draft saved". Leave, come back, Restore: the title is empty and the source is blank, so `canSave` fails on both. Build and Save for later are disabled.
      - **Have a real draft, come back, and pick a start mode before answering the restore offer:** within a second the stored "TEST A24" draft is replaced by an empty one. Leave and come back, and the offer now restores the empty draft. The real draft is gone.
    - **Problem, three causes:**
      1. Picking "Get something new" sets the sort to "List order" (`switchMode`, `CollectionBuilder.tsx:237`). The starting point it is compared with (`blankDraft`) has no sort, so an untouched form counts as edited and is saved.
      2. The autosave effect saves whenever the form differs from the start, even while the restore offer is still open. It only checks the offer before clearing, not before writing.
      3. The page doesn't say why Build is disabled. The title field is the large grey "New collection" heading, which reads as a page title rather than an empty field. A disabled Build is the same gold at half opacity.
    - **Fix:**
      - Compare a new collection with the blank draft *for the picked mode*: run `blankDraft` through the same changes `switchMode` makes, so picking a mode alone is not an edit.
      - In the autosave effect, return early while `restoreOfferRef.current` is set. Nothing is written until the user restores or discards.
      - Under the build bar, when `canSave` is false, show what's missing ("Add a title", "Pick a list"), and have the empty title field look like an input.
      - When restoring, give each restored source a new `uid` (the counter restarts on every page load, so a restored `source-3` can clash with the next "Add another source"). One `map` in `onRestore`.
    - **Tests to add** (in `CollectionBuilder.draft.test.tsx`; both fail today):
      - Open `/collections/new`, pick "Get something new", wait past the 1 s autosave: no stored draft for `Movies:new`.
      - Store a draft titled "TEST A24", open `/collections/new`, pick a start mode without answering the offer, wait 1 s: the stored draft's title is still "TEST A24".
    - **If we skip it:** The draft feature loses the work it is there to keep, and users meet a dead Build button with no reason given.

## Should fix

12. **After a failed save, the builder keeps jumping back to the failing step** (`frontend/src/pages/CollectionBuilder.tsx:193-195`, `frontend/src/pages/builder/stepSummaries.ts:101-107`)
    - **What this is:** When a save comes back with problems (a 422 with `problems`), an effect opens the step the first problem belongs to.
    - **Problem:**
      - `saveProblems(save.error)` builds a new array on every render. The effect lists that array as its dependency, so it runs after *every* render while the error stands. Open another step to fix something, and it snaps back to the problem's step. You are stuck there until the next save attempt.
      - `stepForSaveProblem` checks "sort" before "sort title", so a sort-title problem opens step 2 instead of step 4.
    - **Fix:** Depend on `save.error` instead of `problems` (one word). Move the "summary / sort title" line above the "sort" line.
    - **If we skip it:** The one moment the user needs to move between steps, the page fights them.

## Nice to have

13. **Home says no run has finished after 50 failed runs** (`frontend/src/pages/home/PendingChanges.tsx:14-16`, `starr_studio/runs_routes.py:82`)
    - **What this is:** "Saved since the last run" looks for the last succeeded run in `GET /runs`, which returns the newest 50.
    - **Problem:** If Kometa has failed 50 times in a row (an hourly schedule over two broken days), there is none in the list. Home then says "No run has finished yet" and lists every save ever made as waiting.
    - **Fix:** Have the status endpoint return the last succeeded run's id and start time, and use that instead of searching the page of runs.
    - **If we skip it:** The message is wrong exactly when Kometa is broken and the user looks at Home for why.

14. **Two copies of "did the skip list change"** (`frontend/src/pages/builder/draft.ts:117-121,169-171`)
    - **What this is:** `draftsDiffer` compares the sorted skip lists itself, a few lines below `skipRequestsChanged`, which does the same.
    - **Fix:** `if (skipRequestsChanged(a.skip_requests, b.skip_requests)) return true;`
    - **If we skip it:** Two lines that have to change together.

## Summary

**Verdict:** The rework added no backend risk, and every finding from the first audit is still open. Fix in this order:

1. Finding 1 together with 8, so the next problem leaves a log.
2. Finding 11 (lost drafts), with its two tests.
3. Finding 2, now that the All tab mixes builder and ready-made collections.
4. Finding 12.
5. Finding 9 before the next Studio release.

**Lean:** about −100 lines possible (finding 3, plus 2 lines in 14), no dependencies to remove.

**Not checked:**
- Line by line: the overlay studio (`pages/overlays/*`, 1,100 lines; agy reviewed it OK at merge), `Collections.tsx`'s All tab beyond the review fixes, `Layout.tsx`, and most of `pages/home/*` apart from PendingChanges and the review fixes made at merge.
- The backend apart from what changed since `ce32ae0` and the first audit's findings.
- In the browser, only the builder's draft flows. The full click-through of the rework is still the user's.
- The test suites were not re-run for this audit; CI was green on `f9c1ecf`.
