// Overlay studio for the library in the sidebar: layers, preview and settings on one page.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

import { ApiError, api, type OverlayLibrary, type Schedule } from "../api";
import { ConfirmButton, Tag } from "../components/ui";
import { useLibrary } from "../library";
import { formatRelative, statusLabels, statusTones } from "../runs";
import { OverlayStudio } from "./overlays/OverlayStudio";
import { overlayScheduleLabel, ScheduleDialog } from "./overlays/scheduleDialog";

function OverlayHeader({ library, schedules, onSchedule }: { library: OverlayLibrary; schedules: Schedule[]; onSchedule: () => void }) {
  const queryClient = useQueryClient();
  const [queued, setQueued] = useState<number | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const done = ({ run_id }: { run_id: number }) => {
    setQueued(run_id);
    queryClient.invalidateQueries({ queryKey: ["overlays"] });
    queryClient.invalidateQueries({ queryKey: ["runs"] });
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
  };
  const off = useMutation({ mutationFn: () => api.overlays.off(library.library), onSuccess: done });
  const on = useMutation({ mutationFn: () => api.overlays.on(library.library), onSuccess: done });
  const overlaysOn = !library.off && library.files.length > 0;
  const canToggle = library.files.length > 0 || library.off;
  const scheduleLabel = overlayScheduleLabel(library.library, schedules);

  return (
    <header className="flex max-w-[1400px] flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[32px] leading-tight font-semibold">Overlays · {library.library}</h2>
          <p className="mt-1 text-sm text-muted">
            {library.last_pass ? (
              <>
                Last drawn{" "}
                <Link className="underline" to={`/activity/queue/${library.last_pass.run_id}`}>
                  <Tag tone={statusTones[library.last_pass.status]}>{statusLabels[library.last_pass.status]}</Tag>
                </Link>
                {library.last_pass.finished_at ? ` ${formatRelative(library.last_pass.finished_at)}` : ""}
                {" · "}
              </>
            ) : (
              "No overlay pass yet · "
            )}
            {library.backup && library.backup.posters > 0
              ? `${library.backup.posters} original poster${library.backup.posters === 1 ? "" : "s"} backed up`
              : "No original posters backed up yet"}
            {library.maintainerr && (
              <>
                {" · "}
                {library.maintainerr.on_top
                  ? `Maintainerr on top (${library.maintainerr.collections.join(", ")})`
                  : `Maintainerr overlays here (${library.maintainerr.collections.join(", ")})`}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canToggle && (
            <>
              <button
                type="button"
                role="switch"
                aria-checked={overlaysOn}
                className={`min-h-11 rounded-control border px-4 text-sm ${overlaysOn ? "border-ok text-ok" : "border-warn text-warn"}`}
                onClick={() => {
                  if (library.off) on.mutate();
                  else setConfirmOff(true);
                }}
              >
                Overlays {overlaysOn ? "on" : "off"}
              </button>
              {confirmOff && !library.off && (
                <ConfirmButton
                  label="Turn overlays off"
                  confirm={`Take them off ${library.library}`}
                  warning={
                    library.maintainerr?.on_top
                      ? "Kometa puts the original posters back; Maintainerr's go back on top after."
                      : "Kometa puts the original posters back from its backup."
                  }
                  open
                  onKeep={() => setConfirmOff(false)}
                  onConfirm={() => {
                    off.mutate();
                    setConfirmOff(false);
                  }}
                  busy={off.isPending}
                />
              )}
            </>
          )}
          {library.files.length > 0 && !library.off && (
            <button type="button" className="min-h-11 rounded-control border border-border-strong bg-surface-2 px-4 text-sm hover:border-accent" onClick={onSchedule}>
              {scheduleLabel ? `Schedule · ${scheduleLabel}` : "Schedule"}
            </button>
          )}
        </div>
      </div>
      {library.off && <p className="text-sm text-warn">Kometa keeps the original posters here and draws none (remove_overlays is set in config.yml).</p>}
      {(off.error ?? on.error) && (
        <p role="alert" className="text-sm text-err">
          {(off.error ?? on.error)!.message}
        </p>
      )}
      {queued !== null && (
        <p role="status" className="text-sm text-ok">
          Queued as{" "}
          <Link className="underline" to={`/activity/queue/${queued}`}>
            run #{queued}
          </Link>
        </p>
      )}
    </header>
  );
}

export function Overlays() {
  const { library, libraryType, overview } = useLibrary();
  const overlays = useQuery({ queryKey: ["overlays"], queryFn: api.overlays.list });
  const schedules = useQuery({ queryKey: ["schedules"], queryFn: api.schedules.list });
  const arr = useQuery({ queryKey: ["arr"], queryFn: api.arr.get });
  const config = useQuery({ queryKey: ["config", "library", library], queryFn: () => api.config.library(library!), enabled: library !== null });
  const [scheduleOpen, setScheduleOpen] = useState(false);

  if (overview.isPending || overlays.isPending) return <p className="text-muted">Loading…</p>;
  if (overview.isError || overlays.isError) {
    return (
      <p role="alert" className="text-err">
        {(overview.error ?? overlays.error) instanceof ApiError ? (overview.error ?? overlays.error)!.message : "Can't load overlays"}
      </p>
    );
  }
  if (library === null) {
    return <p className="text-muted">No libraries in config.yml yet.</p>;
  }

  if (libraryType === "artist") {
    return (
      <div className="flex max-w-[1400px] flex-col gap-5">
        <h2 className="text-[32px] leading-tight font-semibold">Overlays · {library}</h2>
        <p className="text-muted">Overlays aren&apos;t available for music libraries.</p>
      </div>
    );
  }

  const status = overlays.data.libraries.find((entry) => entry.library === library);

  return (
    <div className="flex max-w-[1400px] flex-col gap-5">
      {status && (
        <OverlayHeader library={status} schedules={schedules.data?.schedules ?? []} onSchedule={() => setScheduleOpen(true)} />
      )}
      {!status && <h2 className="text-[32px] font-semibold">Overlays · {library}</h2>}
      {config.isPending ? (
        <p className="text-muted">Loading…</p>
      ) : config.isError ? (
        <p role="alert" className="text-err">
          {config.error.message}
        </p>
      ) : (
        <OverlayStudio
          key={library}
          config={config.data}
          libraryType={libraryType === "movie" || libraryType === "show" ? libraryType : null}
          status={status}
        />
      )}
      {scheduleOpen && status && (
        <ScheduleDialog library={library} schedules={schedules.data?.schedules ?? []} arr={arr.data} onClose={() => setScheduleOpen(false)} />
      )}
    </div>
  );
}
