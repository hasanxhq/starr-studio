// Overlay schedules and import triggers, shown from the studio header.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";

import { api, type ArrState, type RunRequest, type Schedule } from "../../api";
import { Button, Field, inputClass } from "../../components/ui";
import { describeDays, formatRelative } from "../../runs";

const blank: RunRequest = {
  mode: "overlays",
  libraries: [],
  collections: [],
  files: [],
  ignore_schedules: false,
  no_missing: false,
  tests: false,
  timings: false,
  low_priority: true,
};

/** Whether a run request draws this library's overlays. */
export function drawsOverlays(request: RunRequest, library: string): boolean {
  return (request.mode === "all" || request.mode === "overlays") && request.collections.length === 0 && (request.libraries.length === 0 || request.libraries.includes(library));
}

export function overlayScheduleLabel(library: string, schedules: Schedule[]): string | null {
  const mine = schedules.filter((schedule) => schedule.enabled && drawsOverlays(schedule.request, library));
  if (!mine.length) return null;
  const pick = mine.find((schedule) => schedule.next_run) ?? mine[0];
  return `${describeDays(pick.days).toLowerCase()} ${pick.time}`;
}

export function ScheduleDialog({ library, schedules, arr, onClose }: { library: string; schedules: Schedule[]; arr: ArrState | undefined; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [time, setTime] = useState("04:00");
  const add = useMutation({
    mutationFn: () =>
      api.schedules.create({
        name: `Overlays · ${library}`,
        request: { ...blank, libraries: [library] },
        days: [0, 1, 2, 3, 4, 5, 6],
        time,
        timezone: null,
        enabled: true,
        catch_up: "run_once",
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["schedules"] }),
  });
  const mine = schedules.filter((schedule) => drawsOverlays(schedule.request, library));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    add.mutate();
  };

  return (
    <div role="dialog" aria-labelledby="overlay-schedule-title" className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-card border border-border bg-surface p-5 shadow-lg">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id="overlay-schedule-title" className="text-lg font-semibold">
            Schedule · {library}
          </h2>
          <button type="button" className="min-h-11 rounded-control px-3 text-sm text-muted hover:text-text" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="flex flex-col gap-4 text-sm">
          {mine.length === 0 ? (
            <p className="text-muted">No schedule draws overlays here.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {mine.map((schedule) => (
                <li key={schedule.id}>
                  <span className="font-semibold">{schedule.name}</span>{" "}
                  <span className="text-muted">
                    {describeDays(schedule.days)} at {schedule.time}
                    {schedule.request.mode === "all" ? " (everything)" : ""}
                    {!schedule.enabled ? " · paused" : schedule.next_run ? ` · next ${formatRelative(schedule.next_run)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <form className="flex flex-wrap items-end gap-2" onSubmit={submit} aria-label={`Daily overlay pass for ${library}`}>
            <Field label="Daily overlay pass at">
              <input type="time" className={`${inputClass} w-32`} value={time} onChange={(e) => setTime(e.target.value)} required />
            </Field>
            <Button type="submit" disabled={add.isPending}>
              Add
            </Button>
            <Link className="min-h-11 content-center text-muted underline" to="/system/tasks">
              All schedules
            </Link>
            {add.isError && (
              <span role="alert" className="text-err">
                {add.error.message}
              </span>
            )}
          </form>
          {arr && (
            <p className="text-muted">
              {(["radarr", "sonarr"] as const)
                .filter((kind) => arr.settings[kind].enabled && drawsOverlays({ ...blank, mode: arr.settings[kind].mode, libraries: arr.settings[kind].libraries }, library))
                .map((kind) => `${kind === "radarr" ? "Radarr" : "Sonarr"} imports (${arr.settings[kind].trigger === "relevant" ? "those that matter" : "every one"})`)
                .join(" and ") || "Not drawn after imports."}{" "}
              <Link className="underline" to="/settings/connect">
                Settings → Connect
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
