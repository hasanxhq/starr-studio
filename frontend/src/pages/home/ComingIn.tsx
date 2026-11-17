import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { Card, Tag } from "../../components/ui";
import { requestsApi, type RequestRow, type RequestStatus } from "../../requestsApi";

const STATUS_LABEL: Record<RequestStatus, string> = {
  requested: "Requested",
  downloading: "Downloading",
  imported: "Imported",
  failed: "Failed",
  cancelled: "Cancelled",
  exists: "Already there",
};

const STATUS_TONE: Record<RequestStatus, "info" | "ok" | "err" | "muted"> = {
  requested: "info",
  downloading: "info",
  imported: "ok",
  failed: "err",
  cancelled: "muted",
  exists: "muted",
};

function titleLine(row: RequestRow): string {
  const name = row.title?.trim() || row.item;
  return row.year != null ? `${name} (${row.year})` : name;
}

function countsAny(counts: Record<string, number> | undefined): boolean {
  if (!counts) return false;
  return Object.values(counts).some((n) => n > 0);
}

export function ComingIn() {
  const settings = useQuery({ queryKey: ["requests", "settings"], queryFn: requestsApi.settings });
  const list = useQuery({ queryKey: ["requests", "list", "", 2], queryFn: () => requestsApi.list({ status: "", limit: 2 }) });
  const enabled = settings.data?.settings.enabled ?? false;
  const counts = list.data?.counts;
  const rows = list.data?.requests ?? [];
  if (!enabled && !countsAny(counts)) return null;

  const downloading = counts?.downloading ?? 0;
  const requested = counts?.requested ?? 0;
  const today = list.data?.arrived_today ?? 0;
  const newest = rows;

  return (
    <Card
      title="Coming in"
      actions={
        <Link className="min-h-11 content-center text-sm text-muted underline hover:text-text" to="/requests">
          All requests
        </Link>
      }
    >
      <dl className="mb-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div>
          <dt className="text-muted">Downloading</dt>
          <dd className="text-lg font-semibold tabular-nums">{downloading.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-muted">Requested</dt>
          <dd className="text-lg font-semibold tabular-nums">{requested.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-muted">Arrived today</dt>
          <dd className="text-lg font-semibold tabular-nums">{today.toLocaleString()}</dd>
        </div>
      </dl>
      {newest.length > 0 && (
        <ul className="flex flex-col text-sm">
          {newest.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-3 border-b border-border py-2 last:border-0">
              <span className="min-w-0 flex-1 font-medium">{titleLine(row)}</span>
              <Tag tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Tag>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
