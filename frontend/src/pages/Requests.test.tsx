import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RequestRow, RequestSettings, RequestsList } from "../requestsApi";
import { mockApi, renderAt } from "../test-utils";

const settingsOff = {
  settings: {
    enabled: false,
    via: "auto",
    radarr: { quality_profile: null, root_folder: null, minimum_availability: "released", search: true },
    sonarr: { quality_profile: null, root_folder: null, monitor: "all", search: true, series_type: "standard" },
    daily_cap: null,
    confirm_over: 25,
  } satisfies RequestSettings,
  seerr: null,
  connected: { radarr: true, sonarr: false, seerr: false },
};

const row = (partial: Partial<RequestRow> & Pick<RequestRow, "id" | "status" | "title">): RequestRow => ({
  item: `tmdb-movie:${partial.id}`,
  media: "movie",
  year: 1995,
  library: "Movies",
  collection_id: 1,
  via: "radarr",
  external_id: "10",
  error: null,
  requested_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  updated_at: new Date().toISOString(),
  imported_at: null,
  labelled_at: null,
  ...partial,
});

const list = (requests: RequestRow[]): RequestsList => ({
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

afterEach(() => {
  vi.useRealTimers();
});

describe("Requests page", () => {
  it("is under Libraries after Collections", async () => {
    mockApi({
      "GET /requests/settings": () => settingsOff,
      "GET /requests?limit=200": () => list([]),
    });
    renderAt("/requests");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    const links = within(nav).getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(links.indexOf("/requests")).toBe(links.indexOf("/collections") + 1);
  });

  it("notes when requests are off and shows the empty state", async () => {
    mockApi({
      "GET /requests/settings": () => settingsOff,
      "GET /requests?limit=200": () => list([]),
    });
    renderAt("/requests");
    expect(await screen.findByText(/Requests are off/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings → Requests" })).toHaveAttribute("href", "/settings/requests");
    expect(screen.getByText("Nothing requested yet.")).toBeInTheDocument();
  });

  it("lists rows with status chips, cancels with confirmation, and Check now refreshes", async () => {
    const calls = mockApi({
      "GET /requests/settings": () => ({ ...settingsOff, settings: { ...settingsOff.settings, enabled: true } }),
      "GET /requests?limit=200": () =>
        list([
          row({ id: 1, title: "Die Hard", status: "requested" }),
          row({ id: 2, title: "Heat", status: "downloading", via: "seerr" }),
          row({ id: 3, title: "Broken", status: "failed", error: "no indexer" }),
        ]),
      "GET /requests?status=failed&limit=200": () => list([row({ id: 3, title: "Broken", status: "failed", error: "no indexer" })]),
      "POST /requests/refresh": () => ({ requested: 1, downloading: 1 }),
      "POST /requests/1/cancel": () => row({ id: 1, title: "Die Hard", status: "cancelled" }),
    });
    renderAt("/requests");

    expect(await screen.findByText("Die Hard (1995)")).toBeInTheDocument();
    expect(screen.getByText("Heat (1995)")).toBeInTheDocument();
    expect(screen.getByText("Movies · Seerr")).toBeInTheDocument();
    expect(screen.getByText(/no indexer/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Failed/ })).toHaveTextContent("1");

    fireEvent.click(screen.getByRole("button", { name: /Failed/ }));
    await waitFor(() => expect(calls.some((c) => c.route === "GET /requests?status=failed&limit=200")).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    await waitFor(() => expect(calls.some((c) => c.route === "POST /requests/refresh")).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: /All/ }));
    await screen.findByText("Die Hard (1995)");
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/Stop requesting Die Hard/);
    expect(dialog).toHaveTextContent(/removes the Seerr request/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Stop requesting" }));
    await waitFor(() => expect(calls.some((c) => c.route === "POST /requests/1/cancel")).toBe(true));
  });

  it("shows the note on a title the app already had", async () => {
    mockApi({
      "GET /requests/settings": () => ({ ...settingsOff, settings: { ...settingsOff.settings, enabled: true } }),
      "GET /requests?limit=200": () =>
        list([row({ id: 4, title: "Breaking Bad", status: "exists", via: "seerr", external_id: null, error: "Seerr has every season already requested or available" })]),
    });
    renderAt("/requests");
    expect(await screen.findByText("Breaking Bad (1995)")).toBeInTheDocument();
    expect(screen.getByText("Movies · Seerr · Seerr has every season already requested or available")).toBeInTheDocument();
  });

  it("polls while a row is requested or downloading", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = mockApi({
      "GET /requests/settings": () => ({ ...settingsOff, settings: { ...settingsOff.settings, enabled: true } }),
      "GET /requests?limit=200": () => list([row({ id: 1, title: "Die Hard", status: "requested" })]),
    });
    renderAt("/requests");
    expect(await screen.findByText("Die Hard (1995)")).toBeInTheDocument();
    const before = calls.filter((c) => c.route.startsWith("GET /requests?")).length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await waitFor(() => expect(calls.filter((c) => c.route.startsWith("GET /requests?")).length).toBeGreaterThan(before));
  });
});

describe("Request music", () => {
  const libs = {
    "GET /config": () => ({ path: "/config/config.yml", libraries: [{ name: "Music", plex_name: "Music" }], playlist_files: [] }),
    "GET /plex/libraries": () => ({ libraries: [{ key: "2", title: "Music", type: "artist", collections: 0, managed: 0 }] }),
    "GET /requests?limit=200": () => list([]),
  };
  const album = (item: string, extra: object = {}) => ({ item, title: "Kid A", artist: "Radiohead", year: 2000, cover: null, in_lidarr: false, request: null, ...extra });
  const on = { ...settingsOff, connected: { ...settingsOff.connected, lidarr: true } };

  it("searches, requests an album into the music library, and shows In Lidarr without a button", async () => {
    const calls = mockApi({
      ...libs,
      "GET /requests/settings": () => on,
      "GET /requests/music/search?term=radiohead": () => ({ albums: [album("mb-album:1"), album("mb-album:2", { title: "OK Computer", year: 1997, in_lidarr: true })] }),
      "POST /requests": () => ({ requested: 1, exists: 0, failed: 0, capped: 0, skipped: 0, items: [{ item: "mb-album:1", status: "requested", error: null }] }),
    });
    renderAt("/requests");

    const form = await screen.findByRole("form", { name: "Search music" });
    fireEvent.change(within(form).getByLabelText("Album or artist"), { target: { value: "radiohead" } });
    fireEvent.click(within(form).getByRole("button", { name: "Search" }));

    const results = await screen.findByRole("list", { name: "Albums" });
    expect(within(results).getByText("Radiohead · 2000")).toBeInTheDocument();
    expect(within(results).getAllByRole("button")).toHaveLength(1);
    expect(within(results).getByText("In Lidarr")).toBeInTheDocument();

    fireEvent.click(within(results).getByRole("button", { name: "Request Kid A" }));
    await waitFor(() => expect(calls.find((c) => c.route === "POST /requests")?.body).toEqual({ library: "Music", items: [{ item: "mb-album:1", title: "Kid A", year: 2000 }] }));
  });

  it("shows a failed album's error inline", async () => {
    mockApi({
      ...libs,
      "GET /requests/settings": () => on,
      "GET /requests/music/search?term=kid": () => ({ albums: [album("mb-album:1")] }),
      "POST /requests": () => ({ requested: 0, exists: 0, failed: 1, capped: 0, skipped: 0, items: [{ item: "mb-album:1", status: "failed", error: "Root folder missing" }] }),
    });
    renderAt("/requests");
    const form = await screen.findByRole("form", { name: "Search music" });
    fireEvent.change(within(form).getByLabelText("Album or artist"), { target: { value: "kid" } });
    fireEvent.submit(form);
    fireEvent.click(await screen.findByRole("button", { name: "Request Kid A" }));
    expect(await screen.findByText("Root folder missing")).toBeInTheDocument();
  });

  it("points to Settings → Connect when Lidarr isn't connected", async () => {
    mockApi({ ...libs, "GET /requests/settings": () => settingsOff });
    renderAt("/requests");
    const link = await screen.findByRole("link", { name: "Connect Lidarr to request music." });
    expect(link).toHaveAttribute("href", "/settings/connect");
    expect(screen.queryByRole("form", { name: "Search music" })).toBeNull();
  });
});
