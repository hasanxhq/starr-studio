// Undo and redo over the style file's text: each edit is a new version of the whole file. Kept in a ref, so several
// edits in one event (aligning five elements) each build on the one before.

import { useCallback, useMemo, useReducer, useRef } from "react";

const LIMIT = 200;

export type HistoryState = { past: string[]; present: string; future: string[]; mergeKey: string | null };

export type StyleHistory = {
  text: string;
  /** A new version. Edits with the same merge key in a row become one undo step (typing in a field, a nudge run). */
  set: (text: string, merge?: string) => void;
  /** fn gets the latest text (even mid-event) and returns the new text. */
  apply: (fn: (text: string) => string, merge?: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Start again from text with no history (after loading or saving elsewhere). */
  reset: (text: string) => void;
};

export function step(state: HistoryState, text: string, merge?: string): HistoryState {
  if (text === state.present) return state;
  if (merge && merge === state.mergeKey) return { ...state, present: text, future: [] };
  return { past: [...state.past, state.present].slice(-LIMIT), present: text, future: [], mergeKey: merge ?? null };
}

export function undone(s: HistoryState): HistoryState {
  return s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future], mergeKey: null } : s;
}

export function redone(s: HistoryState): HistoryState {
  return s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1), mergeKey: null } : s;
}

export function useStyleHistory(initial: string): StyleHistory {
  const state = useRef<HistoryState>({ past: [], present: initial, future: [], mergeKey: null });
  const [version, rerender] = useReducer((n: number) => n + 1, 0);
  const move = useCallback((next: HistoryState) => {
    if (next === state.current) return;
    state.current = next;
    rerender();
  }, []);
  const set = useCallback((text: string, merge?: string) => move(step(state.current, text, merge)), [move]);
  const apply = useCallback((fn: (text: string) => string, merge?: string) => move(step(state.current, fn(state.current.present), merge)), [move]);
  const undo = useCallback(() => move(undone(state.current)), [move]);
  const redo = useCallback(() => move(redone(state.current)), [move]);
  const reset = useCallback((text: string) => move({ past: [], present: text, future: [], mergeKey: null }), [move]);
  const s = state.current;
  // version: a new object each change, so consumers' memos see it
  return useMemo(
    () => ({ text: s.present, set, apply, undo, redo, canUndo: s.past.length > 0, canRedo: s.future.length > 0, reset }),
    [version, set, apply, undo, redo, reset],
  );
}
