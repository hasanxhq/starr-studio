// The "Studio overlays" tab: Studio's own engine (docs/plans/overlay-engine.md, Phase 3). The library's style and
// options on top, the gallery of its posters below. Kometa's overlays (the other tab) are untouched until Phase 5.

import { PosterGallery } from "../gallery/PosterGallery";
import { StyleSettings } from "../styles/StyleSettings";

export function StudioOverlays({ library }: { library: string }) {
  return (
    <div className="flex flex-col gap-6">
      <StyleSettings library={library} />
      <PosterGallery library={library} />
    </div>
  );
}
