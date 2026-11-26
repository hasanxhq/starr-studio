// The selected element's settings. Phase 4 task p4-panels builds it: Style, Text and Show when.

import { useEditor } from "../EditorContext";

export function Inspector() {
  const { selection } = useEditor();
  return (
    <section aria-label="Element settings" className="rounded-card border border-border bg-surface p-4 text-sm">
      <h3 className="font-semibold">Settings</h3>
      <p className="text-muted">{selection.length ? selection[0] : "Select an element to change it."}</p>
    </section>
  );
}
