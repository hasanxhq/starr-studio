// The style on 12 varied titles at once, and picking the canvas's title. Phase 4 task p4-samples builds it.

import { useEditor } from "../EditorContext";

export function SampleGrid() {
  const { samples } = useEditor();
  return (
    <section aria-label="Samples" className="rounded-card border border-border bg-surface p-4 text-sm">
      <h3 className="font-semibold">Samples</h3>
      <p className="text-muted">{samples.length} sample titles</p>
    </section>
  );
}
