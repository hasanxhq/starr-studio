// What every part of the style editor shares: the file's text with undo, the selection, the sample title and its scene.
// The canvas, panels and sample grid read and change it through useEditor().

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { overlayEngine, type Sample, type SceneItem } from "../../../overlayEngineApi";
import { useDebounced } from "../../../useDebounced";
import { useStyleHistory, type StyleHistory } from "./model/history";

export type Editor = {
  styleId: string;
  library: string;
  readOnly: boolean; // a shipped style: look, don't edit
  history: StyleHistory;
  text: string; // the style file as it is now
  /** Change the file: fn gets the text and returns the new text (styleDoc.ts's helpers). A fn that throws (the text
   *  isn't YAML right now) changes nothing; the error is kept in editError. Same merge key in a row = one undo step. */
  edit: (fn: (text: string) => string, merge?: string) => void;
  editError: string | null;
  /** The file's text a moment after the last change: what scenes and renders are made from. */
  settledText: string;
  selection: string[]; // element paths, first = the one the inspector shows
  select: (paths: string[]) => void;
  samples: Sample[]; // varied titles from the library (empty while loading)
  sample: string | null; // the canvas's title (rating key)
  setSample: (ratingKey: string) => void;
  values: Record<string, unknown> | undefined; // option values: the library's when it uses this style
  scene: SceneItem | undefined; // the canvas title's scene, kept while the next one loads
  sceneError: string | null; // the server's word on the file (it doesn't load, an option value is wrong …)
};

const EditorContext = createContext<Editor | null>(null);

export function useEditor(): Editor {
  const editor = useContext(EditorContext);
  if (!editor) throw new Error("useEditor outside EditorProvider");
  return editor;
}

export const SETTLE_MS = 80;

export function EditorProvider({
  styleId,
  library,
  readOnly,
  initialText,
  history: given,
  children,
}: {
  styleId: string;
  library: string;
  readOnly: boolean;
  initialText: string;
  history?: StyleHistory; // the page's, when it needs the history itself (saving)
  children: ReactNode;
}) {
  const own = useStyleHistory(initialText);
  const history = given ?? own;
  const [editError, setEditError] = useState<string | null>(null);
  const [selection, select] = useState<string[]>([]);
  const [picked, setSample] = useState<string | null>(null);

  const edit = useCallback(
    (fn: (text: string) => string, merge?: string) => {
      if (readOnly) return;
      try {
        history.apply(fn, merge);
        setEditError(null);
      } catch (error) {
        setEditError((error as Error).message);
      }
    },
    [history, readOnly],
  );

  // the file changed some other way (undo, the YAML view): an old edit's error no longer applies
  useEffect(() => setEditError(null), [history.text]);

  const samplesQuery = useQuery({ queryKey: ["overlay-engine", "samples", library], queryFn: () => overlayEngine.samples(library), staleTime: 5 * 60_000 });
  const samples = useMemo(() => samplesQuery.data?.items ?? [], [samplesQuery.data]);
  const sample = picked ?? samples[0]?.rating_key ?? null;

  const libraryStyle = useQuery({ queryKey: ["overlay-engine", "library-style", library], queryFn: () => overlayEngine.library.style(library) });
  const values = libraryStyle.data?.style === styleId ? libraryStyle.data.values : undefined;

  const settledText = useDebounced(history.text, SETTLE_MS);
  const sceneQuery = useQuery({
    queryKey: ["overlay-engine", "scene", library, sample, settledText, values],
    queryFn: () => overlayEngine.scene({ library, rating_keys: [sample as string], yaml: settledText, values }),
    enabled: sample !== null && !libraryStyle.isPending, // wait for the library's values, or the first scene is wasted
    placeholderData: keepPreviousData,
    retry: false,
  });

  const value: Editor = {
    styleId,
    library,
    readOnly,
    history,
    text: history.text,
    edit,
    editError,
    settledText,
    selection,
    select,
    samples,
    sample,
    setSample,
    values,
    scene: sceneQuery.data?.items[0],
    sceneError: sceneQuery.error ? sceneQuery.error.message : null,
  };
  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}
