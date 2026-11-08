import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";

import type { HealthCheck } from "../../api";
import { builderApi, type BuiltCollection } from "../../builderApi";
import { RetryButton } from "../../components/RetryButton";
import { Card } from "../../components/ui";

const MAX_ROWS = 5;

type Row =
  | { kind: "collection"; collection: BuiltCollection }
  | { kind: "requests"; count: number }
  | { kind: "health"; check: HealthCheck };

export function NeedsYou({
  library,
  failed,
  failedRequests,
  healthErrors,
}: {
  library: string;
  failed: BuiltCollection[];
  failedRequests: number;
  healthErrors: HealthCheck[];
}) {
  const queryClient = useQueryClient();
  const rows: Row[] = [
    ...failed.map((collection) => ({ kind: "collection" as const, collection })),
    ...(failedRequests > 0 ? [{ kind: "requests" as const, count: failedRequests }] : []),
    ...healthErrors.map((check) => ({ kind: "health" as const, check })),
  ];
  if (rows.length === 0) return null;
  const shown = rows.slice(0, MAX_ROWS);
  const more = rows.length - shown.length;

  return (
    <Card title="Needs you">
      <ul className="flex flex-col text-sm">
        {shown.map((row, i) => (
          <li key={row.kind === "collection" ? `c${row.collection.id}` : row.kind === "health" ? `h${i}` : "requests"} className="flex flex-col gap-2 border-b border-border py-3 last:border-0 sm:flex-row sm:items-center sm:gap-4">
            {row.kind === "collection" && (
              <>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{row.collection.title}</p>
                  {row.collection.last_error && <p className="truncate text-err">{row.collection.last_error}</p>}
                </div>
                <span className="flex flex-wrap gap-2">
                  <RetryButton
                    title={row.collection.title}
                    run={async () => {
                      await builderApi.retry(row.collection.id);
                      return null;
                    }}
                    onDone={() => queryClient.invalidateQueries({ queryKey: ["collections", library] })}
                  />
                  <Link
                    to={`/collections/${row.collection.id}`}
                    className="inline-flex min-h-11 items-center rounded-control border border-border-strong bg-surface-2 px-4 text-sm font-medium hover:border-muted"
                  >
                    Edit
                  </Link>
                </span>
              </>
            )}
            {row.kind === "requests" && (
              <>
                <p className="min-w-0 flex-1 font-medium">
                  {row.count.toLocaleString()} request{row.count === 1 ? "" : "s"} failed
                </p>
                <Link
                  to="/requests?status=failed"
                  className="inline-flex min-h-11 items-center rounded-control border border-border-strong bg-surface-2 px-4 text-sm font-medium hover:border-muted"
                >
                  Open requests
                </Link>
              </>
            )}
            {row.kind === "health" && (
              <>
                <p className="min-w-0 flex-1">{row.check.message}</p>
                {row.check.link ? (
                  <Link
                    to={row.check.link}
                    className="inline-flex min-h-11 items-center rounded-control border border-border-strong bg-surface-2 px-4 text-sm font-medium hover:border-muted"
                  >
                    Fix
                  </Link>
                ) : null}
              </>
            )}
          </li>
        ))}
      </ul>
      {more > 0 && <p className="mt-2 text-sm text-muted">And {more} more</p>}
    </Card>
  );
}
