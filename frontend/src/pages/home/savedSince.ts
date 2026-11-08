import type { Backup, Run } from "../../api";

/** Saves made after the last successful run started: Kometa read the files as that run began, so these wait for the next one. */
export function savedSince(backups: Backup[], run: Run | undefined): Backup[] {
  const since = run?.started_at ? Date.parse(run.started_at) : null;
  return backups.filter((backup) => backup.created !== null && (since === null || Date.parse(backup.created) > since));
}
