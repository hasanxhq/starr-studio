# Notes for the next audit

Notes collected as we go, for the next audit. Each one is checked and fixed or turned into work then. Bugs go under Bugs, ideas under Proposed features.

## Bugs

(none yet)

## Proposed features

### 1. Interactive font customisation

**Today:** Settings → UI offers three fixed choices (`frontend/src/fonts.ts`): Studio's bundled fonts, system text fonts, or system fonts everywhere. The choice is per browser (localStorage) and swaps whole font stacks through `data-fonts` on `<html>`.

**Proposed:** let the user pick fonts interactively and see the result live. For example:
- choose the heading and body font separately
- adjust the text size
- watch a live sample update as they pick

**Open questions for the audit:**
- Scope: Studio's own interface only, or also the font and size of overlay text? Kometa takes `font` and `font_size` per overlay, and the overlay studio preview doesn't show a changed `font_size` yet (#123).
- Per browser, like today, or saved per user on the server?
- Which fonts can be picked: the bundled ones, the system's, or uploaded files? Kometa needs overlay fonts as files in its config folder.
