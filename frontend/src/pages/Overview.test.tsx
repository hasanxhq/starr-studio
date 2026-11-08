import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { LibraryCounts, Run, RunDetail, RunRequest, Status } from "../api";
import type { BuiltCollection } from "../builderApi";
import type { RequestRow, RequestsList } from "../requestsApi";
import { mockApi, renderAt } from "../test-utils";

const everything: RunRequest = {
  mode: "all",
  libraries: [],
  collections: [],
  files: [],
  ignore_schedules: false,
  no_missing: false,
  tests: false,
  timings: false,
  low_priority: true,
};

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString().replace(/\.\d+Z$/, "Z");

function run(overrides: Partial<Run>): Run {
  return {
    id: 1,
    status: "succeeded",
    trigger: "manual",
    schedule_id: null,
    request: everything,
    command: null,
    queued_at: hoursAgo(5),
    started_at: hoursAgo(5),
    finished_at: hoursAgo(4.9),
    exit_code: 0,
    error: null,
    summary: null,
    error_events: 0,
    warnings: 0,
    ...overrides,
  };
}

const lastNight = run({
  id: 7,
  trigger: "schedule",
  started_at: hoursAgo(3),
  finished_at: hoursAgo(2.9),
  summary: { collections_created: 1, collections_modified: 2, items_added: 14, items_removed: 3 },
});

const status: Status = {
  version: "0.1.0",
  kometa: { version: "2.5.3", config: "/config/config.yml", updates: { installed: "2.5.3", pinned: "2.5.4", matches: false, checked_at: null, latest: null, notes: null, available: false } },
  database: { schema_version: 8 },
  health: [],
  runs: { current: null, queued: 0, next_scheduled: { at: new Date(Date.now() + 5 * 3600_000).toISOString(), schedule_id: 1, name: "Nightly" } },
};

const counts: LibraryCounts = {
  name: "Movies",
  plex_name: "Movies",
  collection_files: 2,
  overlay_files: 1,
  metadata_files: 0,
  defaults: 3,
  collections: 2,
  overlays: 0,
  operations: 0,
  problems: [],
};

const collection = (partial: Partial<BuiltCollection> & Pick<BuiltCollection, "id" | "title" | "state">): BuiltCollection => ({
  library: "Movies",
  source: { kind: "filters" },
  filters: { match: "all", rules: [] },
  sort_by: null,
  limit: null,
  visible: { library: true, home: false, shared: false },
  minimum_items: 1,
  summary: null,
  sort_title: null,
  poster: null,
  download_missing: false,
  request_cap: null,
  request_profile: null,
  plex_items: 5,
  thumb: null,
  last_built_at: hoursAgo(1),
  last_error: null,
  run_id: 7,
  requests: { waiting: 0, requested: 0, downloading: 0, imported: 0, failed: 0 },
  last_change: { added: 27, removed: 3, run_id: 7 },
  ...partial,
});

const requestsSettings = {
  settings: {
    enabled: true,
    via: "auto" as const,
    radarr: { quality_profile: null, root_folder: null, minimum_availability: "released" as const, search: true },
    sonarr: { quality_profile: null, root_folder: null, monitor: "all" as const, search: true, series_type: "standard" as const },
    daily_cap: null,
    confirm_over: 25,
  },
  seerr: null,
  connected: { radarr: true, sonarr: false, seerr: false },
};

const requestRow = (partial: Partial<RequestRow> & Pick<RequestRow, "id" | "status" | "title">): RequestRow => ({
  item: `tmdb-movie:${partial.id}`,
  media: "movie",
  year: 1995,
  library: "Movies",
  collection_id: 1,
  via: "radarr",
  external_id: "10",
  error: null,
  requested_at: hoursAgo(0.1),
  updated_at: new Date().toISOString(),
  imported_at: null,
  labelled_at: null,
  ...partial,
});

const requestList = (requests: RequestRow[]): RequestsList => ({
  requests,
  counts: {
    requested: requests.filter((r) => r.status === "requested").length,
    downloading: requests.filter((r) => r.status === "downloading").length,
    imported: requests.filter((r) => r.status === "imported").length,
    failed: requests.filter((r) => r.status === "failed").length,
    cancelled: requests.filter((r) => r.status === "cancelled").length,
    exists: requests.filter((r) => r.status === "exists").length,
  },
});

function baseRoutes(overrides: Record<string, (body: unknown) => unknown> = {}) {
  return {
    "GET /config/setup": () => ({ plex: true, tmdb: true, library: true, done: true }),
    "GET /status": () => status,
    "GET /runs": () => ({ runs: [lastNight], current: null }),
    "GET /runs/7": (): RunDetail => ({
      ...lastNight,
      events: [
        { event: "changes", received_at: hoursAgo(2.9), library_name: "Movies", collection: "Marvel", created: false, additions: 3, removals: 1 } as never,
        { event: "delete", received_at: hoursAgo(2.9), message: "Old picks", created: false } as never,
      ],
    }),
    "GET /config": () => ({ path: "/config/config.yml", libraries: [counts], playlist_files: [] }),
    "GET /plex/libraries": () => ({
      libraries: [{ key: "1", title: "Movies", type: "movie", items: 1234, collections: 3, managed: 2 }],
    }),
    "GET /collections?library=Movies": () => ({
      collections: [
        collection({ id: 2, title: "Queued", state: "queued", last_change: null }),
        collection({ id: 1, title: "Broken", state: "failed", last_error: "source timeout" }),
        collection({ id: 3, title: "Recent", state: "in_plex", last_change: { added: 2, removed: 0, run_id: 6 }, last_built_at: hoursAgo(0.5) }),
      ],
    }),
    "GET /libraries/Movies/other-collections": () => ({ others: [], plex_error: null }),
    "GET /requests/settings": () => requestsSettings,
    "GET /requests?limit=200": () => requestList([]),
    "GET /kometa/full-check": () => ({
      last: { ok: true, errors: [], warnings: [], existing_errors: [], checked_by_kometa: true, crashed: false, output: "", at: hoursAgo(1) },
    }),
    ...overrides,
  };
}

describe("Home", () => {
  it("shows the library, shelf captions, Plex changes, and connections", async () => {
    mockApi(baseRoutes());
    renderAt("/?library=Movies");

    expect(await screen.findByRole("heading", { name: "Movies", level: 2 })).toBeInTheDocument();
    expect(screen.getByText(/1,234 movies/)).toBeInTheDocument();
    expect(screen.getByText(/next run/)).toBeInTheDocument();

    const broken = await screen.findByRole("listitem", { name: "Broken" });
    expect(within(broken).getByText("+27 −3 last run")).toBeInTheDocument();
    expect(broken.compareDocumentPosition(screen.getAllByRole("listitem", { name: "Queued" })[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const changed = await screen.findByRole("list", { name: "Collections changed" });
    expect(changed).toHaveTextContent("Movies · Marvel");
    expect(changed).toHaveTextContent("Gone");
    expect(screen.getByText("Kometa 2.5.3")).toBeInTheDocument();
    expect(screen.queryByText(/run #/)).toBeNull();
    expect(screen.queryByText(/YAML/)).toBeNull();
  });

  it("hides Needs you when nothing is wrong", async () => {
    mockApi(
      baseRoutes({
        "GET /collections?library=Movies": () => ({
          collections: [collection({ id: 1, title: "Fine", state: "in_plex", last_change: null })],
        }),
      }),
    );
    renderAt("/?library=Movies");
    await screen.findByRole("heading", { name: "Movies", level: 2 });
    expect(screen.queryByRole("heading", { name: "Needs you" })).toBeNull();
  });

  it("puts a failed collection first in Needs you with Retry and Edit", async () => {
    const calls = mockApi(
      baseRoutes({
        "POST /collections/1/retry": () => ({ run_id: 12 }),
      }),
    );
    renderAt("/?library=Movies");

    const card = (await screen.findByRole("heading", { name: "Needs you" })).closest("section")!;
    expect(within(card).getAllByText("Broken").length).toBeGreaterThan(0);
    expect(within(card).getByText("source timeout")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: /Retry Broken/ }));
    await waitFor(() => expect(calls.some((c) => c.route === "POST /collections/1/retry")).toBe(true));
    expect(within(card).getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/collections/1");
    const shelf = (await screen.findByRole("heading", { name: "Your collections" })).closest("section")!;
    const tiles = within(shelf).getAllByRole("listitem");
    expect(within(tiles[0]!).getByRole("link", { name: /Broken/ })).toBeInTheDocument();
  });

  it("lists failed requests and health errors with links", async () => {
    mockApi(
      baseRoutes({
        "GET /status": () => ({
          ...status,
          health: [{ source: "plex", level: "error", message: "Can't reach Plex.", link: "/settings/plex" }],
        }),
        "GET /requests?limit=200": () => requestList([requestRow({ id: 9, title: "X", status: "failed" }), requestRow({ id: 8, title: "Y", status: "failed" })]),
      }),
    );
    renderAt("/?library=Movies");
    const card = (await screen.findByRole("heading", { name: "Needs you" })).closest("section")!;
    expect(within(card).getByText("2 requests failed")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Open requests" })).toHaveAttribute("href", "/requests?status=failed");
    expect(within(card).getByText("Can't reach Plex.")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Fix" })).toHaveAttribute("href", "/settings/plex");
  });

  it("truncates Needs you after five rows", async () => {
    const failed = Array.from({ length: 6 }, (_, i) =>
      collection({ id: i + 10, title: `Fail ${i}`, state: "failed", last_error: "err", last_change: null }),
    );
    mockApi(
      baseRoutes({
        "GET /collections?library=Movies": () => ({ collections: failed }),
      }),
    );
    renderAt("/?library=Movies");
    const card = (await screen.findByRole("heading", { name: "Needs you" })).closest("section")!;
    expect(within(card).getByText("And 1 more")).toBeInTheDocument();
  });

  it("hides Coming in when requests are off and empty", async () => {
    mockApi(
      baseRoutes({
        "GET /requests/settings": () => ({ ...requestsSettings, settings: { ...requestsSettings.settings, enabled: false } }),
        "GET /requests?limit=200": () => requestList([]),
      }),
    );
    renderAt("/?library=Movies");
    await screen.findByRole("heading", { name: "Movies", level: 2 });
    expect(screen.queryByRole("heading", { name: "Coming in" })).toBeNull();
  });
});

describe("Overview on a new install", () => {
  it("goes to setup until Kometa has what it needs", async () => {
    mockApi({ "GET /config/setup": () => ({ plex: false, tmdb: false, library: false, done: false }) });
    renderAt("/");
    expect(await screen.findByText(/Kometa needs three things/)).toBeInTheDocument();
  });
});
