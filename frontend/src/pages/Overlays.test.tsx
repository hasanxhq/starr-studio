import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ArrState, OverlayLibrary, Schedule } from "../api";
import { mockApi, renderAt } from "../test-utils";

const tv: OverlayLibrary = {
  library: "TV Shows",
  plex_name: "TV Shows",
  off: false,
  files: [{ kind: "default", value: "resolution", error: null, files: [{ path: "defaults/overlays/resolution.yml", title: "Resolution/Edition Overlays", docs_url: "https://kometa.wiki/en/latest/defaults/overlays/resolution", overlays: ["4K"] }] }],
  backup: { posters: 230, bytes: 47_185_920 },
  last_pass: { run_id: 7, status: "failed", started_at: "2026-10-30T19:43:08Z", finished_at: new Date().toISOString() },
  maintainerr: { collections: ["Unwatched - Leaving in 30 Days"], on_top: true },
};

const schedule: Schedule = {
  id: 3,
  name: "Nightly",
  request: { mode: "all", libraries: [], collections: [], files: [], ignore_schedules: false, no_missing: false, tests: false, timings: false, low_priority: true },
  days: [0, 1, 2, 3, 4, 5, 6],
  time: "03:00",
  timezone: "Asia/Kolkata",
  enabled: true,
  catch_up: "run_once",
  next_run: new Date(Date.now() + 3_600_000).toISOString(),
  last_run: null,
};

const arr = { settings: { radarr: { enabled: false }, sonarr: { enabled: true, trigger: "relevant", mode: "all", libraries: ["TV Shows"] } } } as unknown as ArrState;

const studioRoutes = {
  "GET /config": () => ({ path: "/config/config.yml", libraries: [{ name: "TV Shows", plex_name: "TV Shows" }], playlist_files: [] }),
  "GET /config/libraries/TV%20Shows": () => ({
    name: "TV Shows",
    collection_files: [],
    overlay_files: [{ kind: "default", value: "resolution", template_variables: {}, options: {}, files: [], error: null }],
    metadata_files: [],
    operations: {},
    template_variables: {},
    settings: {},
    counts: {},
  }),
  "GET /config/defaults": () => ({ collections: [], overlays: [] }),
  "GET /config/schemas/config": () => ({ type: "object", definitions: { "template-variables-overlays": { type: "object", properties: {} } } }),
  "GET /plex/libraries": () => ({ libraries: [{ key: "2", title: "TV Shows", type: "show", collections: 0, managed: 0 }] }),
  "GET /plex/libraries/2/items": () => ({ items: [], start: 0, total: 0 }),
};

function routes(extra: Record<string, (body: unknown) => unknown> = {}) {
  return mockApi({
    "GET /overlays": () => ({ libraries: [tv] }),
    "GET /schedules": () => ({ schedules: [schedule], timezone: "Asia/Kolkata", catch_up: null }),
    "GET /arr": () => arr,
    ...studioRoutes,
    ...extra,
  });
}

describe("Overlays", () => {
  it("shows a plain message for a music library", async () => {
    mockApi({
      "GET /overlays": () => ({ libraries: [] }),
      "GET /schedules": () => ({ schedules: [], timezone: "UTC", catch_up: null }),
      "GET /arr": () => arr,
      "GET /config": () => ({ path: "/config/config.yml", libraries: [{ name: "Tunes", plex_name: "Tunes" }], playlist_files: [] }),
      "GET /plex/libraries": () => ({ libraries: [{ key: "5", title: "Tunes", type: "artist", collections: 0, managed: 0 }] }),
      "GET /config/libraries/Tunes": () => ({
        name: "Tunes",
        collection_files: [],
        overlay_files: [],
        metadata_files: [],
        operations: {},
        template_variables: {},
        settings: {},
        counts: {},
      }),
    });
    renderAt("/overlays?library=Tunes");
    expect(await screen.findByRole("heading", { name: "Overlays · Tunes" })).toBeInTheDocument();
    expect(screen.getByText("Overlays aren't available for music libraries.")).toBeInTheDocument();
  });

  it("shows the studio header with backup, Maintainerr and last pass", async () => {
    routes();
    renderAt("/overlays?library=TV%20Shows");
    expect(await screen.findByRole("heading", { name: "Overlays · TV Shows" })).toBeInTheDocument();
    expect(screen.getByText(/230 original posters backed up/)).toBeInTheDocument();
    expect(screen.getByText(/Maintainerr on top/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Failed/ })).toHaveAttribute("href", "/activity/queue/7");
    expect(screen.getByRole("button", { name: /Schedule/ })).toBeInTheDocument();
  });

  it("opens the schedule dialog and turns overlays off only after asking", async () => {
    const calls = routes({
      "POST /overlays/TV%20Shows/off": () => ({ run_id: 9 }),
      "POST /schedules": () => schedule,
    });
    renderAt("/overlays?library=TV%20Shows");
    await screen.findByRole("heading", { name: "Overlays · TV Shows" });
    fireEvent.click(screen.getByRole("button", { name: /Schedule/ }));
    const dialog = await screen.findByRole("dialog", { name: /Schedule · TV Shows/ });
    fireEvent.change(within(dialog).getByLabelText("Daily overlay pass at"), { target: { value: "05:30" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(calls.find((c) => c.route === "POST /schedules")?.body).toMatchObject({ name: "Overlays · TV Shows", time: "05:30", request: { mode: "overlays", libraries: ["TV Shows"] } }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("switch", { name: /Overlays on/ }));
    expect(calls.some((c) => c.route === "POST /overlays/TV%20Shows/off")).toBe(false);
    expect(screen.getByText(/Maintainerr's go back on top after/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Take them off TV Shows" }));
    await waitFor(() => expect(calls.some((c) => c.route === "POST /overlays/TV%20Shows/off")).toBe(true));
  });

  it("turns overlays back on when they were off", async () => {
    const calls = routes({
      "GET /overlays": () => ({ libraries: [{ ...tv, off: true }] }),
      "POST /overlays/TV%20Shows/on": () => ({ run_id: 10 }),
    });
    renderAt("/overlays?library=TV%20Shows");
    await screen.findByRole("heading", { name: "Overlays · TV Shows" });
    expect(screen.getByText(/Kometa keeps the original posters here/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: /Overlays off/ }));
    await waitFor(() => expect(calls.some((c) => c.route === "POST /overlays/TV%20Shows/on")).toBe(true));
  });

  it("refuses turning off without a backup", async () => {
    routes({
      "GET /overlays": () => ({ libraries: [{ ...tv, backup: null }] }),
      "POST /overlays/TV%20Shows/off": () => new Response(JSON.stringify({ detail: "no backup" }), { status: 409 }),
    });
    renderAt("/overlays?library=TV%20Shows");
    await screen.findByRole("heading", { name: "Overlays · TV Shows" });
    fireEvent.click(screen.getByRole("switch", { name: /Overlays on/ }));
    fireEvent.click(screen.getByRole("button", { name: "Take them off TV Shows" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/no backup/i);
  });
});
