# Notes for the next audit

Notes collected as we go, for the next audit. Each one is checked and fixed or turned into work then. Bugs go under Bugs, ideas under Proposed features.

## Bugs

(none yet)

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

**Open questions for the audit:**
- Fonts: Kometa's bundled ones only, or also font files the user uploads? Uploads would need to land in Kometa's config folder.
- Per layer only, or one setting that applies to every layer at once?
- Serving the font files to the browser for the preview: reuse the overlay-images route pattern (read-only, inside `kometa/fonts/`).
