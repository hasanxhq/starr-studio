import { useEffect, useRef, useState } from "react";

import {
  clearStoredDraft,
  draftStorageKey,
  draftsDiffer,
  readStoredDraft,
  writeStoredDraft,
  type Draft,
  type StartMode,
  type StoredBuilderDraft,
} from "./draft";

export function useLocalDraft({
  library,
  id,
  mode,
  draft,
  baseline,
  baselineMode,
  onRestore,
}: {
  library: string;
  id: number | null;
  mode: StartMode | null;
  draft: Draft;
  baseline: Draft;
  baselineMode: StartMode;
  onRestore: (stored: StoredBuilderDraft) => void;
}) {
  const key = draftStorageKey(library, id);
  const [restoreOffer, setRestoreOffer] = useState<StoredBuilderDraft | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const checked = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    const stored = readStoredDraft(key);
    if (stored && draftsDiffer(stored.draft, baseline, stored.mode, baselineMode)) {
      setRestoreOffer(stored);
    }
  }, [key, baseline, baselineMode]);

  useEffect(() => {
    if (mode === null) return;
    if (!draftsDiffer(draft, baseline, mode, baselineMode)) {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      writeStoredDraft(key, { mode, draft });
      setDraftSaved(true);
    }, 1000);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [draft, mode, baseline, baselineMode, key]);

  const discardRestore = () => {
    clearStoredDraft(key);
    setRestoreOffer(null);
  };

  const acceptRestore = () => {
    if (restoreOffer) onRestore(restoreOffer);
    setRestoreOffer(null);
  };

  const clearDraft = () => {
    clearStoredDraft(key);
    setRestoreOffer(null);
    setDraftSaved(false);
  };

  return { restoreOffer, draftSaved, discardRestore, acceptRestore, clearDraft };
}
