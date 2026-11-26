// The canvas: the sample poster with the style's SVG on it. Phase 4 task p4-canvas builds selection, dragging,
// resizing, snapping, nudges, align / distribute and the exact render on idle here.

import { useEditor } from "../EditorContext";
import { sceneMarkup } from "../model/scene";

export function Canvas() {
  const { scene, sample, samplesState, samplesError } = useEditor();
  return (
    <section aria-label="Canvas" className="flex flex-col gap-2">
      {sample === null && samplesState === "error" ? (
        <p role="alert" className="text-sm text-err">
          {samplesError}
        </p>
      ) : sample === null && samplesState === "empty" ? (
        <p className="text-sm text-muted">The library has no titles to draw on yet.</p>
      ) : !scene ? (
        <p className="text-sm text-muted">Loading the sample…</p>
      ) : scene.error !== undefined ? (
        <p role="alert" className="text-sm text-err">
          {scene.error}
        </p>
      ) : (
        <div className="mx-auto w-full max-w-md [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: sceneMarkup(scene.svg, scene.thumb) }} />
      )}
    </section>
  );
}
