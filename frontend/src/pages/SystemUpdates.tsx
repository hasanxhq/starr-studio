// System → Updates: the installed Kometa and Studio, and what Kometa's last run said about new versions (handoff v2 §8).

import { useQuery } from "@tanstack/react-query";

import { api, type KometaUpdates } from "../api";
import { Card } from "../components/ui";
import { formatTime } from "../runs";

function KometaVersion({ updates }: { updates: KometaUpdates }) {
  if (!updates.installed) return <p className="text-sm text-muted">Studio doesn't know where Kometa is installed.</p>;
  const mismatch = `Studio is tested with Kometa ${updates.pinned}; this install has ${updates.installed}. Ready-made lists and filters may not match it.`;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>
        Installed: <span className="font-mono">{updates.installed}</span>
      </p>
      <p>
        Studio is tested with Kometa <span className="font-mono">{updates.pinned}</span>
      </p>
      {!updates.matches && (
        <p role="alert" className="rounded-control border border-warn/40 p-3 text-warn">
          {mismatch}
        </p>
      )}
      {updates.available && updates.latest ? (
        <p className="text-muted">
          Kometa {updates.latest} is out. It comes with a Studio update once Studio has been checked against it.
        </p>
      ) : updates.checked_at ? (
        <p className="text-muted">Kometa last checked for a newer release ({formatTime(updates.checked_at)}).</p>
      ) : (
        <p className="text-muted">Not checked yet. Kometa looks for a new version each time it runs.</p>
      )}
    </div>
  );
}

export function SystemUpdates() {
  const status = useQuery({ queryKey: ["status"], queryFn: api.status });
  if (status.isPending) return <p className="text-muted">Loading…</p>;
  if (status.isError)
    return (
      <p role="alert" className="text-err">
        Can't reach the Studio API: {status.error.message}
      </p>
    );
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Card title="Kometa">
        <KometaVersion updates={status.data.kometa.updates} />
      </Card>
      <Card title="Starr Studio">
        <p className="text-sm">
          Installed: <span className="font-mono">{status.data.version}</span>
        </p>
      </Card>
    </div>
  );
}
