import type { CollectionInput, FilterRule, FilterSpec, Poster, Source, VisibleFlags } from "../../builderApi";
import { canDownloadMissing, sourcesOf } from "../../builderApi";
import { blankRule, type DraftFilters } from "../../components/builder/FilterRules";
import { blankListSource, draftSourcesFrom, sourceReady, toApiSources, type DraftSource } from "../../components/builder/SourcesEditor";
import type { BuilderField } from "../../builderApi";

export type StartMode = "filters" | "list";

export type Draft = {
  library: string;
  title: string;
  filters: DraftFilters;
  sources: DraftSource[];
  sort_by: string | null;
  limit: number | null;
  visible: VisibleFlags;
  minimum_items: number;
  summary: string;
  sort_title: string;
  poster: Poster;
  download_missing: boolean;
  request_cap: number | null;
  request_profile: string | null;
  skip_requests: string[];
  /** Music only: null = artists. */
  level: "album" | null;
};

const EMPTY_FILTERS: FilterSpec = { match: "all", rules: [] };

export function toInput(draft: Draft, mode: StartMode, opts?: { includeSkipRequests?: boolean; music?: boolean }): CollectionInput {
  const list = mode === "list";
  const sources: Source[] = list ? toApiSources(draft.sources) : [{ kind: "filters" }];
  const canMissing = list && canDownloadMissing(sources);
  const body: CollectionInput = {
    library: draft.library,
    title: draft.title.trim(),
    source: sources[0],
    sources,
    filters: list
      ? EMPTY_FILTERS
      : {
          match: draft.filters.match,
          rules: draft.filters.rules.map((rule) => ({ field: rule.field, modifier: rule.modifier, value: rule.value as FilterRule["value"] })),
        },
    sort_by: draft.sort_by,
    limit: list ? null : draft.limit,
    visible: draft.visible,
    minimum_items: draft.minimum_items,
    summary: draft.summary.trim() || null,
    sort_title: draft.sort_title.trim() || null,
    poster: draft.poster,
    download_missing: canMissing ? draft.download_missing : false,
    request_cap: canMissing && draft.download_missing ? draft.request_cap : null,
    request_profile: canMissing && draft.download_missing ? draft.request_profile : null,
  };
  if (opts?.includeSkipRequests && canMissing && draft.download_missing) {
    body.skip_requests = [...draft.skip_requests];
  }
  if (opts?.music) {
    body.level = draft.level === "album" ? "album" : null;
  }
  return body;
}

export function fromInput(input: CollectionInput): Draft {
  const loaded = sourcesOf(input);
  const listSources = loaded.filter((source) => source.kind !== "filters");
  return {
    library: input.library,
    title: input.title,
    filters: {
      match: input.filters.match,
      rules: input.filters.rules.map((rule) => ({ ...rule })),
    },
    sources: draftSourcesFrom(listSources.length > 0 ? listSources : loaded[0]?.kind === "filters" ? [] : loaded),
    sort_by: input.sort_by,
    limit: input.limit,
    visible: { ...input.visible },
    minimum_items: input.minimum_items,
    summary: input.summary ?? "",
    sort_title: input.sort_title ?? "",
    poster: input.poster ?? null,
    download_missing: input.download_missing ?? false,
    request_cap: input.request_cap ?? null,
    request_profile: input.request_profile ?? null,
    skip_requests: [...(input.skip_requests ?? [])],
    level: input.level === "album" ? "album" : null,
  };
}

export function blankDraft(library: string, fields: BuilderField[]): Draft {
  return {
    library,
    title: "",
    filters: { match: "all", rules: [blankRule(fields)] },
    sources: [blankListSource()],
    sort_by: null,
    limit: null,
    visible: { library: true, home: false, shared: false },
    minimum_items: 1,
    summary: "",
    sort_title: "",
    poster: null,
    download_missing: false,
    request_cap: null,
    request_profile: null,
    skip_requests: [],
    level: null,
  };
}

const LIST_SORT_KEYS = ["custom", "release", "alpha"] as const;

export function shapeForMode(draft: Draft, mode: StartMode, fields: BuilderField[]): Draft {
  if (mode === "filters") {
    const blank = blankDraft(draft.library, fields);
    return {
      ...draft,
      filters: draft.filters.rules.length > 0 ? draft.filters : blank.filters,
      sources: [blankListSource()],
      sort_by: null,
      limit: null,
      download_missing: false,
      request_cap: null,
      request_profile: null,
      skip_requests: [],
    };
  }
  return {
    ...draft,
    sources: draft.sources.length > 0 ? draft.sources : [blankListSource()],
    filters: { match: "all", rules: [] },
    sort_by: draft.sort_by && LIST_SORT_KEYS.some((key) => key === draft.sort_by) ? draft.sort_by : "custom",
    limit: null,
  };
}

export function missingForSave(draft: Draft, mode: StartMode): string[] {
  const missing: string[] = [];
  if (!draft.title.trim()) missing.push("Add a title");
  if (mode === "list" && !(draft.sources.length > 0 && draft.sources.every(sourceReady))) {
    missing.push("Pick a list");
  }
  return missing;
}

export function canSave(draft: Draft, mode: StartMode): boolean {
  return missingForSave(draft, mode).length === 0;
}

export function startModeOf(input: CollectionInput): StartMode {
  const sources = sourcesOf(input);
  return sources.length === 1 && sources[0]?.kind === "filters" ? "filters" : "list";
}

export function skipRequestsChanged(a: string[], b: string[]): boolean {
  const sa = [...a].sort().join("\0");
  const sb = [...b].sort().join("\0");
  return sa !== sb;
}

export type StoredBuilderDraft = { mode: StartMode; draft: Draft };

export function draftStorageKey(library: string, id: number | null): string {
  return `studio:builder-draft:${library}:${id ?? "new"}`;
}

function storedDraftValid(value: unknown): value is StoredBuilderDraft {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  if (o.mode !== "filters" && o.mode !== "list") return false;
  if (!o.draft || typeof o.draft !== "object") return false;
  return true;
}

export function readStoredDraft(key: string): StoredBuilderDraft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!storedDraftValid(parsed)) {
      clearStoredDraft(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeStoredDraft(key: string, value: StoredBuilderDraft): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or private mode */
  }
}

export function clearStoredDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function draftsDiffer(a: Draft, b: Draft, modeA: StartMode, modeB: StartMode): boolean {
  if (skipRequestsChanged(a.skip_requests, b.skip_requests)) return true;
  if ((a.level ?? null) !== (b.level ?? null)) return true;
  return JSON.stringify(toInput(a, modeA)) !== JSON.stringify(toInput(b, modeB));
}

