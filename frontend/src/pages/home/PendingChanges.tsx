import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { api, type Run } from "../../api";
import { Card } from "../../components/ui";
import { describeRequest, formatRelative } from "../../runs";
import { savedSince } from "./savedSince";

const SHOWN_SAVES = 6;

export function PendingChanges({ runs }: { runs: Run[] | undefined }) {
  const backups = useQuery({ queryKey: ["backups"], queryFn: api.backups.list });
  const lastGood = runs?.find((run) => run.status === "succeeded");
  const scoped = lastGood && (lastGood.request.mode !== "all" || lastGood.request.libraries.length > 0 || lastGood.request.collections.length > 0 || lastGood.request.files.length > 0);
  const pending = backups.data && runs ? savedSince(backups.data.backups, lastGood) : null;

  return (
    <Card title="Saved since the last run">
      {backups.isError ? (
        <p role="alert" className="text-sm text-err">
          {backups.error.message}
        </p>
      ) : pending === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted">
            {lastGood ? (
              <>
                {pending.length === 0 ? "Nothing has been saved since " : "Saved after "}
                <Link className="underline hover:text-text" to={`/activity/queue/${lastGood.id}`}>
                  run #{lastGood.id}
                </Link>{" "}
                started ({formatRelative(lastGood.started_at!)}), the last run that succeeded.
                {pending.length > 0 && " The next run applies these."}
                {scoped && ` That run was ${describeRequest(lastGood.request)}, so it may not have applied everything saved before it.`}
              </>
            ) : pending.length === 0 ? (
              "Nothing has been saved in Studio yet."
            ) : (
              "No run has finished yet, so Kometa hasn't applied these."
            )}
          </p>
          {pending.length > 0 && (
            <ul className="flex flex-col">
              {pending.slice(0, SHOWN_SAVES).map((backup) => (
                <li key={backup.id} className="flex flex-col gap-0.5 border-b border-border py-2 last:border-0 sm:flex-row sm:items-baseline sm:gap-3">
                  <span className="min-w-0 flex-1 break-words">{backup.reason}</span>
                  <span className="break-words font-mono text-xs text-muted">{backup.files.join(", ")}</span>
                  <span className="shrink-0 text-xs text-muted" title={backup.created ?? undefined}>
                    {backup.created ? formatRelative(backup.created) : "–"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {pending.length > SHOWN_SAVES && (
            <p className="text-muted">{pending.length - SHOWN_SAVES} more below.</p>
          )}
        </div>
      )}
    </Card>
  );
}
