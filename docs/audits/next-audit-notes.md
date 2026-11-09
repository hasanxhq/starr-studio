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

**Decided (2026-11-09):**
- Kometa's bundled fonts only: no custom or uploaded fonts.
- Font choice is per layer.
- The preview gets the font files from a read-only route, like the overlay-images route: it serves only from `kometa/fonts/`, and anything else returns 404.
