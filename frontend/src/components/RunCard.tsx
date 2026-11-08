import { useEffect, useState } from "react";

import type { Job } from "../api";
import { useJobs } from "./Jobs";

function formatElapsed(startedAt: string | null, now: number): string {
  if (!startedAt) return "";
  const seconds = Math.max(0, Math.round((now - Date.parse(startedAt)) / 1000));
  if (seconds < 60) return "just started";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours} h ${rem} min` : `${hours} h`;
}

function pickPrimary(jobs: Job[]): { primary: Job; waiting: boolean; extraQueued: number } | null {
  const running = jobs.filter((j) => j.status === "running");
  const pending = jobs.filter((j) => j.status === "pending");
  if (running.length === 0 && pending.length === 0) return null;
  if (running.length > 0) {
    return { primary: running[0], waiting: false, extraQueued: pending.length };
  }
  return { primary: pending[0], waiting: true, extraQueued: Math.max(0, pending.length - 1) };
}

function ariaLabel(primary: Job, waiting: boolean, elapsed: string, extraQueued: number): string {
  const head = waiting ? `Waiting: ${primary.title}` : `Running: ${primary.title}`;
  const bits = [head];
  if (elapsed) bits.push(elapsed);
  if (extraQueued > 0) bits.push(`${extraQueued} queued`);
  bits.push("Open jobs");
  return bits.join(", ");
}

function ProgressBar({ job }: { job: Job }) {
  if (job.progress && job.status === "running") {
    const { value, max } = job.progress;
    return (
      <span
        className="block h-1 w-full overflow-hidden rounded-full bg-border-strong"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemax={max}
      >
        <span className="block h-full rounded-full bg-accent transition-[width]" style={{ width: max > 0 ? `${Math.min(100, (value / max) * 100)}%` : "0%" }} />
      </span>
    );
  }
  return (
    <span className="block h-1 w-full overflow-hidden rounded-full bg-border-strong" role="progressbar" aria-label="In progress">
      <span className="run-card-bar-indeterminate block h-full w-1/3 rounded-full bg-accent" />
    </span>
  );
}

export function RunCard({ onOpen }: { onOpen: () => void }) {
  const jobs = useJobs(false);
  const list = jobs.data?.jobs ?? [];
  const picked = pickPrimary(list);
  const [now, setNow] = useState(() => Date.now());

  const active = picked !== null;
  const activeId = picked?.primary.id ?? "";

  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, 15_000);
    return () => window.clearInterval(id);
  }, [active, activeId]);

  if (!picked) return null;

  const { primary, waiting, extraQueued } = picked;
  const elapsed = formatElapsed(primary.started_at, now);
  const label = ariaLabel(primary, waiting, elapsed, extraQueued);

  return (
    <div className="shrink-0 border-t border-border p-3">
        <button
          type="button"
          onClick={onOpen}
          aria-label={label}
          className="flex min-h-11 w-full flex-col gap-1.5 rounded-control border border-border bg-surface p-3 text-left transition-colors hover:bg-surface-2"
        >
          <span className="flex min-w-0 items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-sm font-semibold">{waiting ? "Waiting to start" : primary.title}</span>
            {elapsed && <span className="shrink-0 text-xs text-muted">{elapsed}</span>}
          </span>
          {waiting && <span className="truncate text-xs text-muted">{primary.title}</span>}
          {primary.message && <span className="block truncate font-mono text-xs text-muted">{primary.message}</span>}
          {extraQueued > 0 && <span className="text-xs text-muted">+{extraQueued} queued</span>}
          <ProgressBar job={primary} />
        </button>
    </div>
  );
}
