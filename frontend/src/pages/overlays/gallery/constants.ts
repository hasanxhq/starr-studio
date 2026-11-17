import type { OutcomeKind } from "../../../overlayEngineApi";

/** Dry-run outcomes that only show a message — no confirm step. */
export const NO_CONFIRM: OutcomeKind[] = ["skip", "excluded", "unchanged", "error"];

export function canConfirm(kind: OutcomeKind): boolean {
  return !NO_CONFIRM.includes(kind);
}