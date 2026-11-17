// One Changes bar for ready-made picks and builder collections saved without building (P3.2).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

import { builderApi, type LibraryBuildBody, type LibraryBuildResult } from "../builderApi";
import { needsConfirm, requestsApi, type NeedsConfirm } from "../requestsApi";
import { useReadyMadePicks } from "../readyMadePicks";
import { ConfirmDialog } from "./ConfirmDialog";
import { SaveError } from "./ValidationReport";
import { ActionBar, Button, Checkbox } from "./ui";

export function changesSummary(readyMadeCount: number, editedCount: number): string | null {
  const total = readyMadeCount + editedCount;
  if (total === 0) return null;
  const parts: string[] = [];
  if (readyMadeCount > 0) parts.push(`${readyMadeCount} ready-made pick${readyMadeCount === 1 ? "" : "s"}`);
  if (editedCount > 0) parts.push(`${editedCount} edited collection${editedCount === 1 ? "" : "s"}`);
  return `${total} change${total === 1 ? "" : "s"} waiting · ${parts.join(", ")}`;
}

function buildBody(
  readyAdd: LibraryBuildBody["ready_made"]["add"],
  readyRemove: LibraryBuildBody["ready_made"]["remove"],
  collectionIds: number[],
  downloadMissing: boolean,
  dryRun: boolean,
  confirmRequests: boolean,
): LibraryBuildBody {
  return {
    ready_made: { add: readyAdd, remove: readyRemove },
    collections: collectionIds,
    download_missing: downloadMissing,
    dry_run: dryRun,
    ...(confirmRequests ? { confirm_requests: true } : {}),
  };
}

export function ChangesBar({ library, changedCollectionIds }: { library: string; changedCollectionIds: number[] }) {
  const queryClient = useQueryClient();
  const { picks, clearLibrary, changeCount } = useReadyMadePicks();
  const local = picks(library);
  const readyMadeCount = changeCount(library);
  const editedCount = changedCollectionIds.length;
  const total = readyMadeCount + editedCount;
  const summary = changesSummary(readyMadeCount, editedCount);

  const [plan, setPlan] = useState<LibraryBuildResult | null>(null);
  const [done, setDone] = useState<LibraryBuildResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [confirmMore, setConfirmMore] = useState<NeedsConfirm | null>(null);
  const [downloadMissing, setDownloadMissing] = useState(false);
  const [help, setHelp] = useState(false);
  const settings = useQuery({ queryKey: ["requests", "settings"], queryFn: requestsApi.settings });
  const requestsOn = settings.data?.settings.enabled === true;

  const body = (dryRun: boolean, confirmRequests = false) =>
    buildBody(local.add, local.remove, changedCollectionIds, downloadMissing, dryRun, confirmRequests);

  const dryRun = useMutation({
    mutationFn: () => builderApi.buildLibrary(library, body(true)),
    onMutate: () => {
      setError(null);
      setDone(null);
      setConfirmMore(null);
    },
    onSuccess: (result) => setPlan(result),
    onError: (err: Error) => setError(err),
  });

  const build = useMutation({
    mutationFn: ({ confirm_requests }: { confirm_requests: boolean }) =>
      builderApi.buildLibrary(library, body(false, confirm_requests)),
    onMutate: () => {
      setError(null);
      setConfirmMore(null);
    },
    onSuccess: (result) => {
      clearLibrary(library);
      setPlan(null);
      setDone(result);
      setConfirmMore(null);
      queryClient.invalidateQueries({ queryKey: ["ready-made"] });
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      queryClient.invalidateQueries({ queryKey: ["requests"] });
    },
    onError: (err: Error) => {
      const confirm = needsConfirm(err);
      if (confirm) {
        setConfirmMore(confirm);
        setError(null);
      } else {
        setError(err);
      }
    },
  });

  if (total === 0 && !plan && !done && !error && !confirmMore && !dryRun.isPending && !build.isPending) return null;

  const discard = () => {
    if (readyMadeCount > 5 && !window.confirm(`Discard ${readyMadeCount} ready-made picks for ${library}?`)) return;
    clearLibrary(library);
    setPlan(null);
    setDone(null);
    setError(null);
    setConfirmMore(null);
    setDownloadMissing(false);
  };

  const closeDialog = () => {
    setPlan(null);
    setError(null);
    if (!done) dryRun.reset();
  };

  return (
    <>
      {(total > 0 || dryRun.isPending || build.isPending) && (
        <ActionBar
          label="Collection changes"
          summary={summary ?? "Collection changes"}
          note={
            help &&
            !requestsOn && (
              <>
                Turn on requests in{" "}
                <Link className="underline hover:text-text" to="/settings/requests">
                  Settings → Requests
                </Link>{" "}
                first.
              </>
            )
          }
        >
          <Checkbox checked={downloadMissing} onChange={setDownloadMissing} disabled={!requestsOn}>
            Download missing
          </Checkbox>
          {!requestsOn && (
            <button
              type="button"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-control border border-border text-xs text-muted hover:text-text"
              aria-label="Why Download missing is off"
              aria-expanded={help}
              onClick={() => setHelp((open) => !open)}
            >
              ?
            </button>
          )}
          <Button onClick={() => dryRun.mutate()} disabled={dryRun.isPending || build.isPending || total === 0}>
            {dryRun.isPending ? "Checking…" : "Review"}
          </Button>
          <Button variant="primary" onClick={() => build.mutate({ confirm_requests: false })} disabled={build.isPending || total === 0}>
            {build.isPending ? "Starting…" : "Build all"}
          </Button>
          <Button onClick={discard} disabled={build.isPending || readyMadeCount === 0}>
            Discard
          </Button>
        </ActionBar>
      )}

      {done?.run_id != null && (
        <p role="status" className="text-sm text-ok">
          Building in{" "}
          <Link className="underline" to={`/activity/queue/${done.run_id}`}>
            run #{done.run_id}
          </Link>
        </p>
      )}
      {done && done.run_id == null && (
        <p role="status" className="text-sm text-ok">
          Done
          {done.remove.length > 0 && ` · removed ${done.remove.length}`}.{" "}
          <Link className="underline" to="/activity/queue">
            Activity → Queue
          </Link>
        </p>
      )}
      {done && done.blocked.length > 0 && (
        <div role="status" className="rounded-control border border-border bg-surface-2 px-3 py-2 text-sm">
          <p className="font-semibold text-warn">Some collections weren't built</p>
          <ul className="mt-1 list-disc pl-5 text-muted">
            {done.blocked.map((item) => (
              <li key={item.title}>
                {item.title} — {item.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(plan || error || dryRun.isPending) && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={closeDialog}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="changes-build-title"
            className="flex max-h-[90vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-card border border-border-strong bg-surface p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="changes-build-title" className="font-semibold">
              {plan ? "Review changes" : "Review"}
            </h2>
            {plan && (
              <>
                {plan.build.length > 0 && (
                  <section>
                    <h3 className="text-sm font-semibold">Will build</h3>
                    <ul className="mt-1 list-disc pl-5 text-sm">
                      {plan.build.map((item) => (
                        <li key={`${item.kind}:${item.title}`}>
                          {item.title}
                          <span className="text-muted"> ({item.kind === "ready_made" ? "ready-made" : "collection"})</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {plan.remove.length > 0 && (
                  <section>
                    <h3 className="text-sm font-semibold">Will delete from Plex</h3>
                    <ul className="mt-1 list-disc pl-5 text-sm">
                      {plan.remove.map((item) => (
                        <li key={item.title}>{item.title}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {plan.blocked.length > 0 && (
                  <section>
                    <h3 className="text-sm font-semibold text-warn">Won't build</h3>
                    <ul className="mt-1 list-disc pl-5 text-sm">
                      {plan.blocked.map((item) => (
                        <li key={item.title}>
                          {item.title}
                          <span className="text-muted"> — {item.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {plan.build.length === 0 && plan.remove.length === 0 && plan.blocked.length === 0 && (
                  <p className="text-sm text-muted">Nothing to build or remove.</p>
                )}
              </>
            )}
            <SaveError error={error} />
            <div className="flex flex-wrap gap-3">
              {plan && (
                <Button
                  variant="primary"
                  onClick={() => build.mutate({ confirm_requests: false })}
                  disabled={build.isPending}
                  autoFocus
                >
                  {build.isPending ? "Starting…" : "Build all"}
                </Button>
              )}
              <Button onClick={closeDialog}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {confirmMore && (
        <ConfirmDialog
          title="Request missing titles"
          confirm={`Request ${confirmMore.count}`}
          busy={build.isPending}
          onConfirm={() => build.mutate({ confirm_requests: true })}
          onCancel={() => {
            setConfirmMore(null);
            build.reset();
          }}
        >
          {confirmMore.message || `Request ${confirmMore.count} titles now?`}
        </ConfirmDialog>
      )}
    </>
  );
}