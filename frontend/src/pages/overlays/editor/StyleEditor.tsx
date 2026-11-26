// The style editor (docs/plans/overlay-engine.md, 3.7 and Phase 4): /overlays/editor/:styleId?library=…
// Layers on the left, the canvas in the middle, the selected element's settings on the right, the sample grid below,
// and the file itself behind a disclosure. Saving writes only the style file: Plex changes when you apply overlays.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { LeaveGuard } from "../../../components/LeaveGuard";
import { Button } from "../../../components/ui";
import { useLibrary } from "../../../library";
import { overlayEngine } from "../../../overlayEngineApi";
import { Canvas } from "./canvas/Canvas";
import { EditorProvider, useEditor } from "./EditorContext";
import { useStyleHistory, type StyleHistory } from "./model/history";
import { Inspector } from "./panels/Inspector";
import { LayersPanel } from "./panels/LayersPanel";
import { SampleGrid } from "./samples/SampleGrid";

const YamlEditor = lazy(() => import("../../../components/YamlEditor"));

/** Whether a key press belongs to a text field (which has its own undo), not the editor. */
export function typingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable || !!el.closest?.(".cm-editor"));
}

function useUndoKeys(history: StyleHistory) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || typingIn(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) history.undo();
      else if ((key === "z" && event.shiftKey) || key === "y") history.redo();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [history]);
}

function Problems() {
  const { editError, sceneError } = useEditor();
  const message = editError ?? sceneError;
  return message ? (
    <p role="alert" className="text-sm text-err">
      {message}
    </p>
  ) : null;
}

function FileView({ history, readOnly, styleId }: { history: StyleHistory; readOnly: boolean; styleId: string }) {
  return (
    <details className="rounded-card border border-border bg-surface p-4">
      <summary className="cursor-pointer text-sm">Style file (YAML)</summary>
      <div className="pt-3">
        <Suspense fallback={<p className="text-sm text-muted">Loading the editor…</p>}>
          <YamlEditor key={`${styleId}-${readOnly}`} value={history.text} onChange={(text) => history.set(text, "yaml")} kind="style" label={`Style file ${styleId}`} readOnly={readOnly} />
        </Suspense>
      </div>
    </details>
  );
}

export function StyleEditor() {
  const { styleId = "" } = useParams();
  const { library } = useLibrary();
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ["overlay-engine", "style", styleId], queryFn: () => overlayEngine.styles.get(styleId) });
  const history = useStyleHistory("");
  const [saved, setSaved] = useState<string | null>(null);
  useUndoKeys(history);

  // Start from the file once it's loaded, and again only if another style is opened here: a save refreshes the
  // cached file too, and that mustn't wipe the undo history or edits made while saving.
  const loaded = detail.data?.yaml;
  const startedFor = useRef<string | null>(null);
  useEffect(() => {
    if (loaded === undefined || startedFor.current === styleId) return;
    startedFor.current = styleId;
    history.reset(loaded);
    setSaved(loaded);
  }, [loaded, styleId, history.reset]);

  const save = useMutation({
    mutationFn: (yaml: string) => overlayEngine.styles.save(styleId, yaml),
    onSuccess: (stored) => {
      setSaved(stored.yaml);
      queryClient.setQueryData(["overlay-engine", "style", styleId], stored);
      void queryClient.invalidateQueries({ queryKey: ["overlay-engine", "styles"] }); // its name or options may have changed
    },
  });

  if (detail.isPending || library === null) return <p className="text-muted">Loading…</p>;
  if (detail.isError) return <p role="alert" className="text-err">{detail.error.message}</p>;
  if (saved === null) return <p className="text-muted">Loading…</p>;

  const readOnly = detail.data.shipped;
  const dirty = history.text !== saved;
  const back = `/overlays?engine=studio&library=${encodeURIComponent(library)}`;

  return (
    <EditorProvider key={styleId} styleId={styleId} library={library} readOnly={readOnly} initialText={saved} history={history}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link to={back} className="text-sm text-muted underline">
            Overlays
          </Link>
          <h2 className="text-2xl font-semibold">{detail.data.name}</h2>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button onClick={history.undo} disabled={!history.canUndo} aria-keyshortcuts="Control+Z">
              Undo
            </Button>
            <Button onClick={history.redo} disabled={!history.canRedo} aria-keyshortcuts="Control+Shift+Z">
              Redo
            </Button>
            {!readOnly && (
              <Button variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(history.text)}>
                {save.isPending ? "Saving…" : dirty ? "Save" : "Saved"}
              </Button>
            )}
          </div>
        </div>
        {readOnly && <p className="text-sm text-muted">Shipped with Studio: duplicate it on the Overlays page to edit it.</p>}
        <p className="text-sm text-muted">Saving changes the style file only: Plex changes when you apply overlays in the gallery.</p>
        {save.isError && (
          <p role="alert" className="text-sm text-err">
            {save.error.message}
          </p>
        )}
        <Problems />
        <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)_20rem]">
          <LayersPanel />
          <Canvas />
          <Inspector />
        </div>
        <SampleGrid />
        <FileView history={history} readOnly={readOnly} styleId={styleId} />
      </div>
      <LeaveGuard dirty={dirty && !save.isPending} />
    </EditorProvider>
  );
}
