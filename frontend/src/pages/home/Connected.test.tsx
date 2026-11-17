import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";

import type { RequestSettings, RequestsSettingsState } from "../../requestsApi";
import { mockApi } from "../../test-utils";
import { Connected } from "./Connected";

const requestSettings = (connected: RequestsSettingsState["connected"]): RequestsSettingsState => ({
  settings: {
    enabled: true,
    via: "auto",
    radarr: { quality_profile: null, root_folder: null, minimum_availability: "released", search: true },
    sonarr: { quality_profile: null, root_folder: null, monitor: "all", search: true, series_type: "standard" },
    daily_cap: null,
    confirm_over: 0,
  } satisfies RequestSettings,
  seerr: null,
  connected,
});

const fullCheck = () => ({
  last: { ok: true, errors: [], warnings: [], existing_errors: [], checked_by_kometa: true, crashed: false, output: "", at: new Date().toISOString() },
});

const status = () => ({
  version: "0.1.0",
  kometa: { version: "2.5.4", config: "/config/config.yml", updates: { installed: "2.5.4", pinned: "2.5.4", matches: true, checked_at: null, latest: null, notes: null, available: false } },
  database: { schema_version: 8 },
  health: [],
  runs: { current: null, queued: 0, next_scheduled: null },
});

function renderConnected() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Connected />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Connected", () => {
  it("hides Seerr when it is not connected", async () => {
    mockApi({
      "GET /kometa/full-check": fullCheck,
      "GET /status": status,
      "GET /requests/settings": () => requestSettings({ radarr: false, sonarr: false, seerr: false }),
    });
    renderConnected();
    await waitFor(() => expect(screen.getByText("Plex")).toBeInTheDocument());
    expect(screen.queryByText("Seerr")).toBeNull();
  });

  it("shows Seerr as OK when connected and the check has no error for it", async () => {
    mockApi({
      "GET /kometa/full-check": fullCheck,
      "GET /status": status,
      "GET /requests/settings": () => requestSettings({ radarr: false, sonarr: false, seerr: true }),
    });
    renderConnected();
    const row = (await screen.findByText("Seerr")).closest("li")!;
    await waitFor(() => expect(within(row).getByText(", OK")).toBeInTheDocument());
  });
});