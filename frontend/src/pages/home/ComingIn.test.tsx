import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { RequestRow, RequestsList } from "../../requestsApi";
import { mockApi, renderAt } from "../../test-utils";

const requestsSettings = {
  settings: {
    enabled: true,
    via: "arr" as const,
    radarr: { quality_profile: null, root_folder: null, minimum_availability: "released" as const, search: true },
    sonarr: { quality_profile: null, root_folder: null, monitor: "all" as const, search: true, series_type: "standard" as const },
    daily_cap: null,
    confirm_over: 25,
  },
  seerr: null,
  connected: { radarr: true, sonarr: false, seerr: false },
};

const row = (partial: Partial<RequestRow> & Pick<RequestRow, "id" | "title" | "status">): RequestRow => ({
  item: `tmdb-movie:${partial.id}`,
  media: "movie",
  year: 2020,
  library: "Movies",
  collection_id: null,
  via: "radarr",
  external_id: "1",
  error: null,
  requested_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  imported_at: null,
  labelled_at: null,
  ...partial,
});

const list = (requests: RequestRow[], arrived_today: number): RequestsList => ({
  requests,
  counts: { requested: 1, downloading: 0, imported: 0, failed: 0, cancelled: 0, exists: 0 },
  arrived_today,
});

function homeMocks(extra: Record<string, (body: unknown) => unknown> = {}) {
  return mockApi({
    "GET /config/setup": () => ({ plex: true, tmdb: true, library: true, done: true }),
    "GET /status": () => ({
      version: "0.0.0",
      kometa: { version: "2.5.3", config: "/config/config.yml", updates: { installed: "2.5.3", pinned: "2.5.4", matches: false, checked_at: null, latest: null, notes: null, available: false } },
      database: { schema_version: 1 },
      health: [],
      runs: { next_scheduled: null },
    }),
    "GET /runs": () => ({ runs: [], current: null }),
    "GET /config": () => ({ path: "/config/config.yml", libraries: [{ name: "Movies", plex_name: "Movies" }], playlist_files: [] }),
    "GET /collections?library=Movies": () => ({ collections: [] }),
    "GET /libraries/Movies/other-collections": () => ({ others: [], plex_error: null }),
    "GET /plex/libraries": () => ({ libraries: [{ key: "1", title: "Movies", type: "movie", items: 10, collections: 0, managed: 0 }] }),
    "GET /requests/settings": () => requestsSettings,
    "GET /kometa/full-check": () => ({ last: null }),
    "GET /jobs": () => ({ jobs: [], at: new Date().toISOString() }),
    ...extra,
  });
}

describe("ComingIn", () => {
  it("shows arrived today from the server, not from the row list", async () => {
    homeMocks({
      "GET /requests?limit=2": () =>
        list([row({ id: 1, title: "Fresh", status: "requested" }), row({ id: 2, title: "Also fresh", status: "downloading" })], 7),
    });
    renderAt("/?library=Movies");
    const card = (await screen.findByRole("heading", { name: "Coming in" })).closest("section")!;
    expect(within(card).getByText("7")).toBeInTheDocument();
    expect(within(card).queryByText("Old arrival")).toBeNull();
  });
});