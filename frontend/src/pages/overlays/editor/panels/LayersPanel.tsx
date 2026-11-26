// The layers list. Phase 4 task p4-panels builds it: every element nested as in the file, select, reorder, add, delete.

import { useEditor } from "../EditorContext";
import { outline } from "../model/styleDoc";

export function LayersPanel() {
  const { text } = useEditor();
  let count = 0;
  try {
    count = outline(text).length;
  } catch {
    // the file isn't YAML right now; the problem shows above
  }
  return (
    <section aria-label="Layers" className="rounded-card border border-border bg-surface p-4 text-sm">
      <h3 className="font-semibold">Layers</h3>
      <p className="text-muted">{count} elements</p>
    </section>
  );
}
