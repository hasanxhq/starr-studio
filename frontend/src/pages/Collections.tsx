// Collections hub: builder collections (Yours) and ready-made categories, with one Changes bar.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useRef, useState } from "react";
import { Link, NavLink, useLocation, useSearchParams } from "react-router";

import { ApiError } from "../api";
import { useLibrary } from "../library";
import { builderApi, sourceLabel, sourcesOf, type BuiltCollection } from "../builderApi";
import { ChangesBar } from "../components/ChangesBar";
import { FileBlock } from "../components/ImportLanding";
import { PlusIcon, SearchIcon, UploadIcon } from "../components/icons";
import { DownloadMissingBadge, RequestCountsLine, RequestWaitingButton } from "../components/RequestCounts";
import { PlexPoster } from "../components/PlexPoster";
import { PosterTile, StatusBadge, badgeFor } from "../components/PosterTile";
import { RetryButton } from "../components/RetryButton";
import { Button } from "../components/ui";
import { importApi, type UploadAddResult, type UploadStaging } from "../importApi";
import { ReadyMadeTab } from "./ReadyMade";

type ShowFilter = "all" | "in_plex" | "building" | "missing" | "failed" | "fetching" | "changed";

const CHIP_FILTERS: { key: ShowFilter; label: string; hideAtZero?: boolean }[] = [
  { key: "all", label: "All" },
  { key: "in_plex", label: "In Plex" },
  { key: "building", label: "Building" },
  { key: "missing", label: "Not built" },
  { key: "failed", label: "Failed" },
  { key: "fetching", label: "Fetching missing", hideAtZero: true },
  { key: "changed", label: "Changed", hideAtZero: true },
];

function tabClass({ isActive }: { isActive: boolean }) {
  return [
    "flex min-h-11 shrink-0 items-center border-b-2 px-4 text-sm transition-colors",
    isActive ? "border-accent text-text" : "border-transparent text-muted hover:text-text",
  ].join(" ");
}

function libraryQs(library: string, extra?: Record<string, string | null>) {
  const params = new URLSearchParams();
  params.set("library", library);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
  }
  const q = params.toString();
  return q ? `?${q}` : "";
}

function sourceLine(collection: BuiltCollection): string {
  const sources = sourcesOf(collection);
  if (sources.length > 1) return `${sources.length} sources`;
  return sourceLabel(sources[0] ?? { kind: "filters" });
}

function tileBadge(collection: BuiltCollection) {
  if (collection.changed) return <StatusBadge state={{ kind: "changed" }} />;
  const state = badgeFor(collection);
  return <StatusBadge state={state ?? { kind: "missing" }} />;
}

function matchesFilter(collection: BuiltCollection, filter: ShowFilter): boolean {
  if (filter === "all") return true;
  if (filter === "in_plex") return collection.state === "in_plex";
  if (filter === "building") return collection.state === "queued" || collection.state === "building";
  if (filter === "missing") return collection.state === "missing";
  if (filter === "failed") return collection.state === "failed";
  if (filter === "changed") return collection.changed === true;
  const r = collection.requests;
  return (r?.waiting ?? 0) + (r?.requested ?? 0) + (r?.downloading ?? 0) > 0;
}

function filterCounts(collections: BuiltCollection[]): Record<ShowFilter, number> {
  const counts: Record<ShowFilter, number> = {
    all: collections.length,
    in_plex: 0,
    building: 0,
    missing: 0,
    failed: 0,
    fetching: 0,
    changed: 0,
  };
  for (const row of collections) {
    if (row.state === "in_plex") counts.in_plex += 1;
    if (row.state === "queued" || row.state === "building") counts.building += 1;
    if (row.state === "missing") counts.missing += 1;
    if (row.state === "failed") counts.failed += 1;
    if (row.changed) counts.changed += 1;
    const r = row.requests;
    if ((r?.waiting ?? 0) + (r?.requested ?? 0) + (r?.downloading ?? 0) > 0) counts.fetching += 1;
  }
  return counts;
}

function CollectionCard({ collection }: { collection: BuiltCollection }) {
  const queryClient = useQueryClient();
  const waiting = collection.requests?.waiting ?? 0;
  const art = collection.thumb ? (
    <PlexPoster thumb={collection.thumb} title={collection.title} />
  ) : (
    <span aria-hidden="true" className="flex aspect-[2/3] items-end overflow-hidden rounded-control border border-border bg-banner-studio p-3 font-display text-base leading-snug font-semibold">
      {collection.title}
    </span>
  );
  return (
    <PosterTile
      title={collection.title}
      to={`/collections/${collection.id}`}
      art={art}
      badge={tileBadge(collection)}
      liClassName="overflow-hidden rounded-card border border-border bg-surface"
      controlClassName="hover:bg-surface-2/40"
      footer={
        (collection.download_missing || collection.requests || collection.state === "failed" || waiting > 0) ? (
          <div className="flex flex-col gap-2 px-3.5 pb-3.5">
            <DownloadMissingBadge id={collection.id} downloadMissing={collection.download_missing} library={collection.library} />
            <RequestCountsLine summary={collection.requests} />
            {collection.state === "failed" && (
              <RetryButton
                title={collection.title}
                run={async () => {
                  await builderApi.retry(collection.id);
                  return null;
                }}
                onDone={() => queryClient.invalidateQueries({ queryKey: ["collections", collection.library] })}
              />
            )}
            <RequestWaitingButton id={collection.id} waiting={waiting} library={collection.library} />
          </div>
        ) : undefined
      }
    >
      <span className="px-3.5 pt-3 font-display text-base leading-snug font-semibold">{collection.title}</span>
      <span className={`px-3.5 pt-1 text-[13px] text-muted ${collection.state === "failed" && collection.last_error ? "" : "pb-3.5"}`}>{sourceLine(collection)}</span>
      {collection.state === "failed" && collection.last_error ? <span className="px-3.5 pt-1 pb-3.5 text-[13px] text-err">{collection.last_error}</span> : null}
    </PosterTile>
  );
}

function UploadDialog({ libraries, initialLibrary, onClose }: { libraries: string[]; initialLibrary: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const titleId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [library, setLibrary] = useState(initialLibrary);
  const [staging, setStaging] = useState<UploadStaging | null>(null);
  const [result, setResult] = useState<UploadAddResult | null>(null);
  const [pickedName, setPickedName] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      return importApi.upload(library, text, file.name);
    },
    onSuccess: (data) => {
      setStaging(data);
      setResult(null);
    },
  });

  const add = useMutation({
    mutationFn: () => importApi.addUpload(staging!.token, staging!.library),
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["collections", library] });
      queryClient.invalidateQueries({ queryKey: ["config"] });
    },
  });

  const uploadError = upload.error instanceof ApiError ? upload.error.message : upload.error?.message;
  const addError = add.error instanceof ApiError ? add.error.message : add.error?.message;
  const busy = upload.isPending || add.isPending;

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[90vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-card border border-border-strong bg-surface p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="font-semibold">
          Upload a collection file
        </h2>

        {result ? (
          <div className="flex flex-col gap-3 text-sm">
            <p role="status" className="text-ok">
              {result.action === "replace"
                ? `Imported ${result.imported.length} collection${result.imported.length === 1 ? "" : "s"}.`
                : `Added as a Kometa file (${result.kept_file}). It runs as it is.`}
            </p>
            {result.studio && result.studio.length > 0 && (
              <p className="text-muted">Already in Studio (unchanged): {result.studio.join(", ")}</p>
            )}
            <p>
              <Link className="underline" to={`/activity/queue/${result.run_id}`}>
                Open the run
              </Link>
            </p>
            <Button onClick={onClose}>Done</Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted">Studio runs the file through the same import as Move over. The file itself is never edited.</p>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-muted">Library</span>
              <select
                className="min-h-11 rounded-control border border-border-strong bg-surface-2 px-3 text-sm text-text focus:border-accent focus:outline-none"
                value={library}
                disabled={busy}
                onChange={(event) => {
                  setLibrary(event.target.value);
                  setStaging(null);
                  setPickedName(null);
                  upload.reset();
                }}
              >
                {libraries.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <div className="flex flex-col gap-2">
              <input
                ref={fileInput}
                type="file"
                accept=".yml,.yaml,text/yaml,application/x-yaml"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  setPickedName(file.name);
                  setStaging(null);
                  setResult(null);
                  upload.mutate(file);
                }}
              />
              <Button disabled={busy} onClick={() => fileInput.current?.click()}>
                {upload.isPending ? "Reading…" : pickedName ? "Choose another file" : "Choose a .yml file"}
              </Button>
              {pickedName && <p className="font-mono text-xs text-muted">{pickedName}</p>}
            </div>
            {uploadError && (
              <p role="alert" className="text-err">
                {uploadError}
              </p>
            )}
            {staging && (
              <div className="flex flex-col gap-3">
                <FileBlock file={staging.file} />
                {staging.file.action === "studio" ? (
                  <p className="text-sm text-muted">This is already a Studio file; nothing to add.</p>
                ) : (
                  <Button variant="primary" disabled={busy} onClick={() => add.mutate()}>
                    {add.isPending ? "Adding…" : "Add"}
                  </Button>
                )}
                {addError && (
                  <p role="alert" className="text-err">
                    {addError}
                  </p>
                )}
              </div>
            )}
            <Button disabled={busy} onClick={onClose}>
              Cancel
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function YoursTab({ collections, loading, error, search, show, library, onShow }: {
  collections: BuiltCollection[];
  loading: boolean;
  error: Error | null;
  search: string;
  show: ShowFilter;
  library: string;
  onShow: (next: ShowFilter) => void;
}) {
  const needle = search.trim().toLowerCase();
  const counts = useMemo(() => filterCounts(collections), [collections]);
  const filtered = useMemo(() => {
    return collections.filter((row) => {
      if (needle && !row.title.toLowerCase().includes(needle)) return false;
      return matchesFilter(row, show);
    });
  }, [collections, needle, show]);

  const qs = (filter: ShowFilter) => libraryQs(library, { show: filter === "all" ? null : filter });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter collections">
        {CHIP_FILTERS.map(({ key, label, hideAtZero }) => {
          const count = counts[key];
          if (hideAtZero && count === 0) return null;
          const active = show === key;
          return (
            <Link
              key={key}
              to={`/collections${qs(key)}`}
              replace
              aria-current={active ? "true" : undefined}
              className={`inline-flex min-h-11 items-center rounded-full border px-3 text-sm transition ${active ? "border-accent bg-accent/15 text-text" : "border-border bg-surface-2 text-muted hover:text-text"}`}
              onClick={(event) => {
                event.preventDefault();
                onShow(key);
              }}
            >
              {label} ({count})
            </Link>
          );
        })}
      </div>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : error ? (
        <p role="alert" className="text-err">
          {error.message}
        </p>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-card border border-dashed border-border px-4 py-10">
          <p className="text-muted">{collections.length === 0 ? `No collections yet in ${library}.` : "No collections match this filter."}</p>
          {collections.length === 0 && (
            <Link
              to={`/collections/new?library=${encodeURIComponent(library)}`}
              className="inline-flex min-h-11 items-center justify-center rounded-control bg-accent px-4 text-sm font-medium text-on-accent transition hover:brightness-110"
            >
              New collection
            </Link>
          )}
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]" aria-label="Collections">
          {filtered.map((collection) => (
            <CollectionCard key={collection.id} collection={collection} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function Collections() {
  const [params, setSearchParams] = useSearchParams();
  const kept = params.get("kept");
  const showParam = params.get("show");
  const show: ShowFilter =
    showParam === "in_plex" || showParam === "building" || showParam === "missing" || showParam === "failed" || showParam === "fetching" || showParam === "changed"
      ? showParam
      : "all";
  const [uploadOpen, setUploadOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { pathname } = useLocation();
  const readyMadeTab = pathname.startsWith("/collections/ready-made");
  const { library, libraries: names, overview } = useLibrary();

  const setShow = (next: ShowFilter) => {
    setSearchParams(
      (current) => {
        const copy = new URLSearchParams(current);
        if (next === "all") copy.delete("show");
        else copy.set("show", next);
        return copy;
      },
      { replace: true },
    );
  };

  const data = useQuery({
    queryKey: ["collections", library],
    queryFn: () => builderApi.list(library!),
    enabled: library !== null,
    refetchInterval: (query) => {
      const collections = query.state.data?.collections ?? [];
      return collections.some((entry) => entry.state === "queued" || entry.state === "building") ? 3000 : false;
    },
  });

  const collections = data.data?.collections ?? [];
  const changedIds = useMemo(() => collections.filter((row) => row.changed).map((row) => row.id), [collections]);

  if (overview.isPending) return <p className="text-muted">Loading…</p>;
  if (overview.isError) {
    return (
      <p role="alert" className="text-err">
        {overview.error instanceof ApiError ? overview.error.message : "Can't read the config"}
      </p>
    );
  }
  if (library === null) {
    return (
      <p className="text-muted">
        Collections are per library, and config.yml has none yet.{" "}
        <Link className="underline hover:text-text" to="/libraries">
          Add one from Libraries
        </Link>
        .
      </p>
    );
  }

  const tabQs = libraryQs(library, show !== "all" ? { show } : undefined);

  return (
    <div className="flex max-w-[1400px] flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[32px] leading-tight font-semibold">Collections</h2>
          <p className="mt-1 max-w-xl text-[13px] text-muted">
            {readyMadeTab ? "Kometa's ready-made collections and the ones you build." : "Smart collections you build from your library's own data. Plex keeps them up to date."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-control border border-border-strong bg-surface-2 px-3 text-sm sm:min-w-[16rem] sm:flex-none">
            <SearchIcon className="size-4 text-muted" />
            <span className="sr-only">Search collections</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search collections"
              className="min-h-11 min-w-0 flex-1 bg-transparent text-text placeholder:text-muted focus:outline-none"
            />
          </label>
          <Button onClick={() => setUploadOpen(true)}>
            <UploadIcon className="mr-1.5 size-4" />
            Upload a file
          </Button>
          <Link
            to={`/collections/new?library=${encodeURIComponent(library)}`}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control bg-accent px-4 text-sm font-medium text-on-accent transition hover:brightness-110"
          >
            <PlusIcon className="size-4" />
            New collection
          </Link>
        </div>
      </header>

      <nav aria-label="Collections views" className="-mx-4 overflow-x-auto border-b border-border md:-mx-6">
        <div role="tablist" className="flex px-4 md:px-6">
          <NavLink to={`/collections${tabQs}`} end className={tabClass} role="tab">
            Yours
          </NavLink>
          <NavLink to={`/collections/ready-made${libraryQs(library)}`} className={tabClass} role="tab">
            Ready-made
          </NavLink>
        </div>
      </nav>

      {kept && (
        <p role="status" className="rounded-control border border-border bg-surface-2 px-3 py-2 text-sm text-muted">
          {kept}
        </p>
      )}

      {readyMadeTab ? (
        <ReadyMadeTab search={search} />
      ) : (
        <YoursTab
          collections={collections}
          loading={data.isPending}
          error={data.error}
          search={search}
          show={show}
          library={library}
          onShow={setShow}
        />
      )}

      <ChangesBar key={library} library={library} changedCollectionIds={changedIds} />
      {uploadOpen && <UploadDialog libraries={names} initialLibrary={library} onClose={() => setUploadOpen(false)} />}
    </div>
  );
}
