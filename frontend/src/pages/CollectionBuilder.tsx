// Create or edit a Studio smart collection: numbered steps on the left, shelf preview on the right.

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { ApiError } from "../api";
import {
  builderApi,
  canDownloadMissing,
  customOrderProblem,
  isKometaPosterUrl,
  type BuilderField,
  type CollectionSaveBody,
  type FilterRule,
  type FilterSpec,
} from "../builderApi";
import { blankListSource, toApiSources } from "../components/builder/SourcesEditor";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useHeaderTitle } from "../components/HeaderTitle";
import { LeaveGuard } from "../components/LeaveGuard";
import { ConfirmButton, inputClass } from "../components/ui";
import { needsConfirm, requestsApi, type NeedsConfirm } from "../requestsApi";
import { BuildBar } from "./builder/BuildBar";
import { BuilderShelf } from "./builder/BuilderShelf";
import { BuilderSteps } from "./builder/BuilderSteps";
import {
  blankDraft,
  canSave,
  fromInput,
  skipRequestsChanged,
  startModeOf,
  toInput,
  type Draft,
  type StartMode,
  type StoredBuilderDraft,
} from "./builder/draft";
import { stepForSaveProblem } from "./builder/stepSummaries";
import { useLocalDraft } from "./builder/useLocalDraft";

function saveProblems(error: unknown): string[] {
  if (!(error instanceof ApiError)) return [];
  const detail = error.detail;
  if (detail && typeof detail === "object" && "problems" in detail && Array.isArray((detail as { problems: string[] }).problems)) {
    return (detail as { problems: string[] }).problems.map(String);
  }
  return [];
}

const LIST_SORTS = [
  { key: "custom", label: "List order" },
  { key: "release", label: "Release date" },
  { key: "alpha", label: "Title" },
] as const;

function setDraftPatch(setDraft: React.Dispatch<React.SetStateAction<Draft>>, patch: Partial<Draft> | ((current: Draft) => Draft)) {
  if (typeof patch === "function") setDraft(patch);
  else setDraft((current) => ({ ...current, ...patch }));
}

function BuilderForm({
  id,
  library,
  fields,
  baseline,
  templateError,
  initialMode,
}: {
  id: number | null;
  library: string;
  fields: { fields: BuilderField[]; sorts: { key: string; label: string }[]; library_type?: "movie" | "show" };
  baseline: Draft;
  templateError: string | null;
  initialMode: StartMode | null;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const released = useRef(false);
  const [draft, setDraft] = useState(baseline);
  const [baselineSnap] = useState(baseline);
  const [mode, setMode] = useState<StartMode | null>(initialMode);
  const [openStep, setOpenStep] = useState<number | null>(id === null && initialMode !== null ? 1 : null);
  const [autoTitle, setAutoTitle] = useState<string | null>(() => {
    const first = baseline.sources[0];
    return first?.kind === "list" ? first.label : null;
  });
  const [confirmMore, setConfirmMore] = useState<NeedsConfirm | null>(null);
  const [saveAction, setSaveAction] = useState<"build" | "later" | null>(null);

  const baselineMode: StartMode = initialMode ?? mode ?? "list";
  const dirty =
    mode !== null &&
    JSON.stringify(toInput(draft, mode)) !== JSON.stringify(toInput(baselineSnap, baselineMode));

  const kometaUrl = useMemo(() => {
    const b = baselineSnap.poster;
    return b?.kind === "url" && isKometaPosterUrl(b.url) ? b.url : null;
  }, [baselineSnap.poster]);

  const isList = mode === "list";
  const apiSources = isList ? toApiSources(draft.sources) : [];
  const orderProblem = isList ? customOrderProblem(apiSources) : null;

  useEffect(() => {
    if (orderProblem && draft.sort_by === "custom") setDraft((current) => ({ ...current, sort_by: "release" }));
  }, [orderProblem, draft.sort_by]);

  const { restoreOffer, draftSaved, discardRestore, acceptRestore, clearDraft } = useLocalDraft({
    library,
    id,
    mode,
    draft,
    baseline: baselineSnap,
    baselineMode,
    onRestore: (stored: StoredBuilderDraft) => {
      setMode(stored.mode);
      setDraft(stored.draft);
      setOpenStep(1);
    },
  });

  const [previewArgs, setPreviewArgs] = useState<{ filters: FilterSpec; sort_by: string | null } | null>(null);
  useEffect(() => {
    if (mode !== "filters") {
      setPreviewArgs(null);
      return;
    }
    const handle = window.setTimeout(() => {
      setPreviewArgs({
        filters: {
          match: draft.filters.match,
          rules: draft.filters.rules.map((rule) => ({ field: rule.field, modifier: rule.modifier, value: rule.value as FilterRule["value"] })),
        },
        sort_by: draft.sort_by,
      });
    }, 500);
    return () => window.clearTimeout(handle);
  }, [mode, draft.filters, draft.sort_by]);

  const filterPreview = useQuery({
    queryKey: ["builder", "preview", library, previewArgs],
    queryFn: () => builderApi.preview({ library, filters: previewArgs!.filters, sort_by: previewArgs!.sort_by }),
    enabled: mode === "filters" && previewArgs !== null,
    placeholderData: keepPreviousData,
  });

  useHeaderTitle(draft.title.trim() || (id === null ? "New collection" : "Collection"));

  const includeSkip = id === null || skipRequestsChanged(draft.skip_requests, baselineSnap.skip_requests);

  const buildSaveBody = (confirm_requests: boolean, build?: boolean): CollectionSaveBody => {
    const input = toInput(draft, mode!, includeSkip ? { includeSkipRequests: true } : undefined);
    return { ...input, confirm_requests, ...(build === false ? { build: false } : {}) };
  };

  const save = useMutation({
    mutationFn: async ({ confirm_requests, build }: { confirm_requests: boolean; build?: boolean }) => {
      const body = buildSaveBody(confirm_requests, build);
      return id === null ? builderApi.create(body) : builderApi.update(id, body);
    },
    onSuccess: (saved) => {
      setConfirmMore(null);
      released.current = true;
      clearDraft();
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      queryClient.invalidateQueries({ queryKey: ["requests"] });
      navigate(`/collections?library=${encodeURIComponent(saved.library)}`);
    },
    onError: (error) => {
      const confirm = needsConfirm(error);
      if (confirm) setConfirmMore(confirm);
    },
    onSettled: () => setSaveAction(null),
  });

  const remove = useMutation({
    mutationFn: () => builderApi.remove(id!),
    onSuccess: (result) => {
      released.current = true;
      clearDraft();
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      const q = new URLSearchParams({ library });
      if (!result.removed && result.reason) q.set("kept", result.reason);
      navigate(`/collections?${q}`);
    },
  });

  const problems = saveProblems(save.error);
  const conflict =
    save.error instanceof ApiError && save.error.status === 409 && !needsConfirm(save.error) ? save.error.message : null;
  const removeNotice = remove.error instanceof ApiError ? remove.error.message : null;

  useEffect(() => {
    if (problems.length > 0) setOpenStep(stepForSaveProblem(problems[0]!));
  }, [problems]);

  const requestSettings = useQuery({ queryKey: ["requests", "settings"], queryFn: requestsApi.settings });
  const requestsEnabled = requestSettings.data?.settings.enabled === true;

  const previewSource = useQuery({
    queryKey: ["builder", "sources", "preview", library, apiSources],
    queryFn: () => builderApi.previewSource({ library, sources: apiSources }),
    enabled: isList && canDownloadMissing(apiSources) && apiSources.length > 0,
    placeholderData: keepPreviousData,
  });

  const requestCount = useMemo(() => {
    if (!previewSource.data) return null;
    return previewSource.data.missing.filter((m) => !m.requested && !draft.skip_requests.includes(m.id)).length;
  }, [previewSource.data, draft.skip_requests]);

  const switchMode = (next: StartMode) => {
    setMode(next);
    setOpenStep(1);
    if (next === "filters") {
      setDraft((current) => {
        const blank = blankDraft(library, fields.fields);
        return {
          ...current,
          filters: current.filters.rules.length > 0 ? current.filters : blank.filters,
          sources: [blankListSource()],
          sort_by: null,
          limit: null,
          download_missing: false,
          request_cap: null,
          request_profile: null,
          skip_requests: [],
        };
      });
      return;
    }
    setDraft((current) => ({
      ...current,
      sources: current.sources.length > 0 ? current.sources : [blankListSource()],
      filters: { match: "all", rules: [] },
      sort_by: current.sort_by && LIST_SORTS.some((s) => s.key === current.sort_by) ? current.sort_by : "custom",
      limit: null,
    }));
  };

  const breadcrumbTitle = id === null ? "New collection" : draft.title.trim() || "Collection";

  return (
    <div className="flex max-w-[1400px] flex-col gap-5">
      <LeaveGuard dirty={dirty} released={released} />
      <header className="flex flex-col gap-2">
        <nav className="text-[13px] text-muted" aria-label="Breadcrumb">
          <Link className="underline hover:text-text" to={`/collections?library=${encodeURIComponent(library)}`}>
            Collections
          </Link>
          <span aria-hidden="true"> › </span>
          <span>{breadcrumbTitle}</span>
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 flex-1 text-[32px] leading-tight font-semibold">
            <input
              className={`${inputClass} w-full border-0 bg-transparent px-0 text-[32px] leading-tight font-semibold shadow-none focus:ring-0`}
              value={draft.title}
              onChange={(event) => {
                setAutoTitle(null);
                setDraft({ ...draft, title: event.target.value });
              }}
              required
              aria-label="Title"
              placeholder={id === null ? "New collection" : "Collection"}
            />
          </h1>
          {draftSaved && (
            <p className="text-sm text-muted" role="status" aria-live="polite">
              Draft saved
            </p>
          )}
        </div>
      </header>

      {restoreOffer && (
        <div className="rounded-control border border-border bg-surface-2 px-3 py-2 text-sm" role="status">
          Restore your unsaved draft?{" "}
          <button type="button" className="min-h-11 underline" onClick={acceptRestore}>
            Restore
          </button>{" "}
          <button type="button" className="min-h-11 underline" onClick={discardRestore}>
            Discard
          </button>
        </div>
      )}

      {templateError && (
        <p role="status" className="rounded-control border border-border bg-surface-2 px-3 py-2 text-sm text-muted">
          {templateError}
        </p>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="start-heading">
        <h2 id="start-heading" className="text-[15px] font-semibold">
          How to start
        </h2>
        <fieldset className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-4">
          <legend className="sr-only">How to start</legend>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              name="start"
              className="size-4 accent-accent"
              checked={mode === "filters"}
              onChange={() => switchMode("filters")}
            />
            Organise what I have
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="radio" name="start" className="size-4 accent-accent" checked={mode === "list"} onChange={() => switchMode("list")} />
            Get something new
          </label>
        </fieldset>
      </section>

      {mode !== null && (
        <>
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
            <div className="flex w-full max-w-[420px] flex-col gap-4">
              <BuilderSteps
                library={library}
                libraryType={fields.library_type ?? "movie"}
                fields={fields.fields}
                sorts={fields.sorts}
                mode={mode}
                draft={draft}
                openStep={openStep}
                onOpenStep={setOpenStep}
                kometaUrl={kometaUrl}
                onDraft={(patch) => setDraftPatch(setDraft, patch)}
                onListPicked={(label) => {
                  setDraft((current) => {
                    const title =
                      !current.title.trim() || (autoTitle !== null && current.title === autoTitle) ? (label ?? current.title) : current.title;
                    return { ...current, title };
                  });
                  if (label) setAutoTitle(label);
                }}
                orderProblem={orderProblem}
              />
              {id !== null && (
                <ConfirmButton
                  label="Delete"
                  confirm="Delete"
                  warning="Deletes it from Plex too. Only collections Studio made are ever deleted."
                  onConfirm={() => remove.mutate()}
                  busy={remove.isPending}
                />
              )}
            </div>
            <BuilderShelf
              library={library}
              libraryType={fields.library_type ?? "movie"}
              mode={mode}
              sources={apiSources}
              draft={draft}
              onDraft={(patch) => setDraftPatch(setDraft, patch)}
              filterPreview={filterPreview.data}
              filterPreviewUpdating={filterPreview.isFetching}
            />
          </div>

          <BuildBar
            library={library}
            showDownload={isList && canDownloadMissing(apiSources)}
            downloadMissing={draft.download_missing}
            requestCount={requestCount}
            requestsKnown={previewSource.data != null}
            downloadDisabled={!requestsEnabled}
            onDownloadMissing={(download_missing) => setDraft({ ...draft, download_missing })}
            saving={save.isPending}
            saveAction={saveAction}
            canSubmit={canSave(draft, mode)}
            onSaveForLater={() => {
              setSaveAction("later");
              save.mutate({ confirm_requests: false, build: false });
            }}
            onBuild={() => {
              setSaveAction("build");
              save.mutate({ confirm_requests: false });
            }}
          />
        </>
      )}

      {(problems.length > 0 || conflict || removeNotice) && (
        <div role="alert" className="flex flex-col gap-1 text-sm text-err">
          {conflict && <p>{conflict}</p>}
          {removeNotice && <p>{removeNotice}</p>}
          {problems.map((problem) => (
            <p key={problem}>{problem}</p>
          ))}
        </div>
      )}

      {confirmMore && (
        <ConfirmDialog
          title="Request missing titles"
          confirm={`Request ${confirmMore.count}`}
          busy={save.isPending}
          onConfirm={() => save.mutate({ confirm_requests: true, build: saveAction === "later" ? false : undefined })}
          onCancel={() => {
            setConfirmMore(null);
            save.reset();
          }}
        >
          {confirmMore.message || `Request ${confirmMore.count} titles now?`}
        </ConfirmDialog>
      )}
    </div>
  );
}

function NewBuilder({ library }: { library: string }) {
  const [params] = useSearchParams();
  const category = params.get("category");
  const block = params.get("block");
  const key = params.get("key");
  const wantsTemplate = Boolean(category && block && key);

  const fieldData = useQuery({ queryKey: ["builder", "fields", library], queryFn: () => builderApi.fields(library) });
  const template = useQuery({
    queryKey: ["builder", "customise", library, category, block, key],
    queryFn: () => builderApi.customise(library, category!, block!, key!),
    enabled: wantsTemplate,
    retry: false,
  });

  const ready = fieldData.isSuccess && (!wantsTemplate || template.isFetched);
  const templateError = template.isError ? (template.error instanceof ApiError ? template.error.message : "That ready-made can't be used as filters.") : null;

  const baseline = useMemo(() => {
    if (!fieldData.data) return null;
    if (template.data) return fromInput(template.data);
    return blankDraft(library, fieldData.data.fields);
  }, [fieldData.data, template.data, library]);

  if (fieldData.isPending || (wantsTemplate && template.isPending)) return <p className="text-muted">Loading…</p>;
  if (fieldData.isError) {
    return (
      <p role="alert" className="text-err">
        {fieldData.error.message}
      </p>
    );
  }
  if (!ready || !baseline || !fieldData.data) return <p className="text-muted">Loading…</p>;

  const initialMode: StartMode | null = wantsTemplate || template.data ? "filters" : null;

  return (
    <BuilderForm
      key={JSON.stringify(baseline)}
      id={null}
      library={library}
      fields={fieldData.data}
      baseline={baseline}
      templateError={templateError}
      initialMode={initialMode}
    />
  );
}

function EditBuilder({ id }: { id: number }) {
  const collection = useQuery({ queryKey: ["collections", id], queryFn: () => builderApi.get(id) });
  const library = collection.data?.library;
  const fieldData = useQuery({
    queryKey: ["builder", "fields", library],
    queryFn: () => builderApi.fields(library!),
    enabled: Boolean(library),
  });

  if (collection.isPending || (library && fieldData.isPending)) return <p className="text-muted">Loading…</p>;
  if (collection.isError) {
    return (
      <p role="alert" className="text-err">
        {collection.error.message}
      </p>
    );
  }
  if (fieldData.isError) {
    return (
      <p role="alert" className="text-err">
        {fieldData.error.message}
      </p>
    );
  }
  if (!collection.data || !fieldData.data) return <p className="text-muted">Loading…</p>;

  const baseline = fromInput(collection.data);
  return (
    <BuilderForm
      key={collection.data.id}
      id={collection.data.id}
      library={collection.data.library}
      fields={fieldData.data}
      baseline={baseline}
      templateError={null}
      initialMode={startModeOf(collection.data)}
    />
  );
}

export function CollectionBuilder() {
  const { id: rawId } = useParams();
  const [params] = useSearchParams();
  const id = rawId ? Number.parseInt(rawId, 10) : null;
  const editing = rawId !== undefined && !Number.isNaN(id);

  if (editing) return <EditBuilder id={id!} />;

  const library = params.get("library");
  if (!library) {
    return (
      <p className="text-muted">
        Pick a library first.{" "}
        <Link className="underline" to="/collections">
          Back to Collections
        </Link>
      </p>
    );
  }
  return <NewBuilder library={library} />;
}
