import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { builderApi, canDownloadMissing, posterPreviewSrc, type BuilderPreview, type Source, type SourcePreview } from "../../builderApi";
import { requestsApi } from "../../requestsApi";
import { PlexPoster } from "../../components/PlexPoster";
import { MissingTabControls } from "./MissingTabControls";
import type { Draft, StartMode } from "./draft";

const shelfGrid = "grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-4";

function ListShelfInLibrary({ preview, updating }: { preview: SourcePreview; updating: boolean }) {
  if (!preview.previewable) {
    return (
      <div className="flex flex-col gap-2">
        {updating && <p className="text-sm text-muted">Updating…</p>}
        <p className="text-sm text-muted">{preview.why ?? "This list can't be previewed yet."}</p>
      </div>
    );
  }
  if (preview.problems.length > 0) {
    return (
      <div className="flex flex-col gap-2">
        {updating && <p className="text-sm text-muted">Updating…</p>}
        <ul className="flex flex-col gap-1 text-sm text-muted" aria-label="Preview hints">
          {preview.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      </div>
    );
  }
  if (preview.in_library_count === 0) {
    return <p className="text-sm text-muted">None in your library yet.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {updating && <p className="text-sm text-muted">Updating…</p>}
      <ul className={shelfGrid} aria-label="In your library">
        {preview.in_library.map((item) => (
          <li key={item.rating_key} className="flex flex-col gap-1">
            <PlexPoster thumb={item.thumb} title={item.title} />
            <span className="line-clamp-2 text-xs font-medium">{item.title}</span>
            {item.year != null && <span className="text-xs text-muted">{item.year}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function previewableSources(sources: Source[]): Source[] {
  return sources.filter((source) => source.kind === "list" || source.kind === "titles" || source.kind === "search");
}

function FilterPreviewBody({ preview, updating }: { preview: BuilderPreview | undefined; updating: boolean }) {
  if (!preview) {
    return <p className="text-sm text-muted">{updating ? "Updating…" : "Loading preview…"}</p>;
  }
  if (preview.problems.length > 0) {
    return (
      <div className="flex flex-col gap-2">
        {updating && <p className="text-sm text-muted">Updating…</p>}
        <ul className="flex flex-col gap-1 text-sm text-muted" aria-label="Preview hints">
          {preview.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      </div>
    );
  }
  if (preview.count === 0) {
    return <p className="text-sm text-muted">No titles match yet.</p>;
  }
  return (
    <ul className={shelfGrid} aria-label="Preview titles">
      {preview.items.slice(0, 60).map((item) => (
        <li key={item.rating_key} className="flex flex-col gap-1">
          <PlexPoster thumb={item.thumb} title={item.title} />
          <span className="line-clamp-2 text-xs font-medium">{item.title}</span>
          {item.year != null && <span className="text-xs text-muted">{item.year}</span>}
        </li>
      ))}
    </ul>
  );
}

export function BuilderShelf({
  library,
  libraryType,
  mode,
  sources,
  draft,
  onDraft,
  filterPreview,
  filterPreviewUpdating,
}: {
  library: string;
  libraryType: "movie" | "show";
  mode: StartMode;
  sources: Source[];
  draft: Draft;
  onDraft: (patch: Partial<Draft> | ((current: Draft) => Draft)) => void;
  filterPreview: BuilderPreview | undefined;
  filterPreviewUpdating: boolean;
}) {
  const isList = mode === "list";
  const canMissing = isList && canDownloadMissing(sources);
  const ready = useMemo(() => {
    return previewableSources(sources).filter((source) => {
      if (source.kind === "list") return Boolean(source.builder && source.value);
      if (source.kind === "titles") return source.ids.length > 0;
      return source.kind === "search";
    });
  }, [sources]);

  const sourcePreview = useQuery({
    queryKey: ["builder", "sources", "preview", library, ready],
    queryFn: () => builderApi.previewSource({ library, sources: ready }),
    enabled: isList && ready.length > 0,
    placeholderData: keepPreviousData,
  });

  const settings = useQuery({ queryKey: ["requests", "settings"], queryFn: requestsApi.settings });
  const requestsEnabled = settings.data?.settings.enabled === true;

  const [tab, setTab] = useState<"in" | "missing">("in");
  const showMissingTab = isList && canMissing;

  const inCount = isList ? (sourcePreview.data?.in_library_count ?? 0) : (filterPreview?.count ?? 0);
  const missingCount = sourcePreview.data?.missing_count ?? 0;
  const totalWhenComplete = isList && canMissing && missingCount > 0 ? inCount + missingCount : null;

  const posterSrc = posterPreviewSrc(draft.poster);

  const toggleRequest = (id: string, want: boolean) => {
    onDraft((current) => {
      const set = new Set(current.skip_requests);
      if (want) set.delete(id);
      else set.add(id);
      return { ...current, skip_requests: [...set] };
    });
  };

  const requestDisabledReason = (requested?: boolean): string | null => {
    if (!requestsEnabled) return "Requests are off in Settings → Requests";
    if (requested) return "Already requested";
    if (!draft.download_missing) return "Turn on Download missing to request these";
    return null;
  };

  return (
    <aside className="rounded-card border border-border bg-surface p-4 lg:sticky lg:top-4" aria-labelledby="shelf-heading">
      <h2 id="shelf-heading" className="sr-only">
        Shelf
      </h2>
      <div className="mb-4 flex flex-col items-center gap-3">
        <div className="w-40 overflow-hidden rounded-control border border-border bg-surface-2 aspect-[2/3]" aria-label="Collection poster">
          {posterSrc ? (
            <img src={posterSrc} alt="" className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center p-2 text-center text-sm text-muted">Plex mosaic</div>
          )}
        </div>
        <p className="text-center text-sm text-muted">
          {inCount} title{inCount === 1 ? "" : "s"} now
          {totalWhenComplete != null ? `, ${totalWhenComplete} when complete` : ""}
        </p>
      </div>

      {showMissingTab && (
        <div className="mb-4 flex rounded-control border border-border p-0.5" role="group" aria-label="Shelf view">
          <button
            type="button"
            className={`min-h-11 flex-1 rounded-control px-3 text-sm ${tab === "in" ? "bg-surface-2 font-medium" : "text-muted"}`}
            aria-pressed={tab === "in"}
            onClick={() => setTab("in")}
          >
            In {library} · {inCount}
          </button>
          <button
            type="button"
            className={`min-h-11 flex-1 rounded-control px-3 text-sm ${tab === "missing" ? "bg-surface-2 font-medium" : "text-muted"}`}
            aria-pressed={tab === "missing"}
            onClick={() => setTab("missing")}
          >
            Missing · {missingCount}
          </button>
        </div>
      )}

      {(!showMissingTab || tab === "in") && (
        <div className="flex flex-col gap-3">
          {isList ? (
            <>
              {ready.length === 0 ? (
                <p className="text-sm text-muted">Add a list or titles to preview.</p>
              ) : sourcePreview.isPending && !sourcePreview.data ? (
                <p className="text-sm text-muted">Loading preview…</p>
              ) : sourcePreview.isError ? (
                <p role="alert" className="text-sm text-err">
                  {sourcePreview.error.message}
                </p>
              ) : sourcePreview.data ? (
                <ListShelfInLibrary preview={sourcePreview.data} updating={sourcePreview.isFetching} />
              ) : (
                <p className="text-sm text-muted">Loading preview…</p>
              )}
            </>
          ) : (
            <FilterPreviewBody preview={filterPreview} updating={filterPreviewUpdating} />
          )}
        </div>
      )}

      {showMissingTab && tab === "missing" && (
        <div className="flex flex-col gap-3">
          <MissingTabControls
            libraryType={libraryType}
            downloadMissing={draft.download_missing}
            requestCap={draft.request_cap}
            requestProfile={draft.request_profile}
            onDownloadMissing={(download_missing) => onDraft({ download_missing })}
            onRequestCap={(request_cap) => onDraft({ request_cap })}
            onRequestProfile={(request_profile) => onDraft({ request_profile })}
            requestsEnabled={requestsEnabled}
          />
          {!sourcePreview.data?.missing.length ? (
            <p className="text-sm text-muted">Nothing missing.</p>
          ) : (
            <ul className="flex flex-col gap-3" aria-label="Missing titles">
              {sourcePreview.data.missing.map((item) => {
                const disabledReason = requestDisabledReason(item.requested);
                const checked = !draft.skip_requests.includes(item.id);
                return (
                  <li key={item.id} className="flex gap-3">
                    <div className="w-14 shrink-0">
                      {item.poster ? (
                        <img src={item.poster} alt="" className="aspect-[2/3] w-full rounded-control border border-border object-cover" />
                      ) : (
                        <div className="flex aspect-[2/3] items-center justify-center rounded-control border border-border bg-surface-2 p-1 text-center text-[10px] text-muted">
                          {item.title}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{item.title}</p>
                      {item.year != null && <p className="text-xs text-muted">{item.year}</p>}
                      <label className={`mt-2 flex min-h-11 items-center gap-2 text-sm ${disabledReason ? "text-muted" : ""}`}>
                        <input
                          type="checkbox"
                          className="size-4 accent-accent"
                          checked={checked}
                          disabled={disabledReason !== null}
                          onChange={(event) => toggleRequest(item.id, event.target.checked)}
                        />
                        <span>Request</span>
                        {disabledReason && <span className="text-xs text-muted">({disabledReason})</span>}
                      </label>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}
