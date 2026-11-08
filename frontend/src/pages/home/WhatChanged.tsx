import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { api, type Run } from "../../api";
import { Card, Tag } from "../../components/ui";
import { isActive } from "../../runs";

const SHOWN = 8;

function plural(count: number, word: string): string {
  return `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;
}

export function WhatChanged({ runs }: { runs: Run[] | undefined }) {
  const lastRun = runs?.find((r) => !isActive(r.status));
  const detail = useQuery({
    queryKey: ["runs", lastRun?.id ?? "none"],
    queryFn: () => api.runs.get(lastRun!.id),
    enabled: !!lastRun,
  });
  if (!lastRun) return null;
  const changes = detail.data?.events.filter((e) => e.event === "changes" || e.event === "delete") ?? [];

  return (
    <Card
      title="What changed in Plex"
      actions={
        <Link className="min-h-11 content-center text-sm text-muted underline hover:text-text" to={`/activity/queue/${lastRun.id}`}>
          Open the run
        </Link>
      }
    >
      {detail.isPending ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : changes.length === 0 ? (
        <p className="text-sm text-muted">Nothing changed in Plex on the last run.</p>
      ) : (
        <ul className="flex flex-col text-sm" aria-label="Collections changed">
          {changes.slice(0, SHOWN).map((e, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-3 border-b border-border py-2 last:border-0">
              <span className="min-w-0 flex-1 break-words">
                {e.event === "delete" ? e.message : [e.library_name, e.collection ?? e.playlist].filter(Boolean).join(" · ") || "Kometa"}
              </span>
              {e.created && <Tag tone="ok">New</Tag>}
              {e.event === "delete" && <Tag tone="err">Gone</Tag>}
              {e.event === "changes" && (
                <span className="text-xs">
                  <span className="text-ok">+{e.additions ?? 0}</span> <span className="text-err">−{e.removals ?? 0}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {changes.length > SHOWN && <p className="mt-2 text-sm text-muted">And {plural(changes.length - SHOWN, "more collection")} on the run's page.</p>}
    </Card>
  );
}
