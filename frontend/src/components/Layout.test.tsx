import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { mockApi, renderAt } from "../test-utils";

function mockCommon(extra: Record<string, (body: unknown) => unknown> = {}) {
  return mockApi({
    "GET /status": () => ({
      version: "0.0.0",
      kometa: { version: "2.5.3", config: "/config/config.yml", updates: { installed: "2.5.3", checked_at: null, latest: null, notes: null, available: false } },
      database: { schema_version: 1 },
      health: [],
    }),
    "GET /kometa/full-check": () => ({ last: null }),
    "GET /config": () => ({
      path: "/config/config.yml",
      libraries: [{ name: "Movies", plex_name: "Movies" }, { name: "TV Shows", plex_name: "TV Shows" }],
      playlist_files: [],
    }),
    "GET /requests?limit=200": () => ({
      requests: [],
      counts: { requested: 0, downloading: 0, imported: 0, failed: 0, cancelled: 0, exists: 0 },
    }),
    "GET /collections?library=Movies": () => ({ collections: [] }),
    "GET /collections?library=TV%20Shows": () => ({ collections: [] }),
    ...extra,
  });
}

describe("Layout", () => {
  it("shows section tabs above page content on System pages", async () => {
    mockCommon();
    renderAt("/system/status");
    const tabNav = await screen.findByRole("navigation", { name: "System pages" });
    expect(within(tabNav).getByRole("link", { name: "Status" })).toHaveAttribute("aria-current", "page");
  });

  it("has exactly the nine entries with their names in the sidebar", async () => {
    mockCommon();
    renderAt("/");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent?.trim())).toEqual([
      "Home",
      "Collections",
      "Requests",
      "Overlays",
      "Playlists",
      "Activity",
      "System",
      "Settings",
    ]);
    const spacer = nav.querySelector(".mt-auto");
    expect(spacer).not.toBeNull();
  });

  it("changing the Library select changes the library", async () => {
    mockCommon();
    renderAt("/collections");
    const select = await screen.findByLabelText("Library");
    expect(select).toHaveValue("Movies");
    fireEvent.change(select, { target: { value: "TV Shows" } });
    expect(select).toHaveValue("TV Shows");
  });

  it("hides library picker when there are no libraries", async () => {
    mockCommon({
      "GET /config": () => ({
        path: "/config/config.yml",
        libraries: [],
        playlist_files: [],
      }),
    });
    renderAt("/");
    await screen.findByRole("navigation", { name: "Main" });
    expect(screen.queryByLabelText("Library")).toBeNull();
  });

  it("shows Requests and Collections badges with counts and hides them at 0", async () => {
    mockCommon({
      "GET /requests?limit=200": () => ({
        requests: [],
        counts: { requested: 2, downloading: 1, imported: 0, failed: 0, cancelled: 0, exists: 0 },
      }),
      "GET /collections?library=Movies": () => ({
        collections: [
          { id: 1, key: "c1", category: "built", origin: "built", title: "Col 1", state: "in_plex" },
          { id: 2, key: "c2", category: "built", origin: "built", title: "Col 2", state: "in_plex" },
        ],
      }),
    });
    const { unmount } = renderAt("/");
    const nav = await screen.findByRole("navigation", { name: "Main" });

    // With counts > 0
    const requestsLink = within(nav).getByRole("link", { name: "Requests, 3 waiting" });
    expect(within(requestsLink).getByText("3")).toBeInTheDocument();

    const collectionsLink = within(nav).getByRole("link", { name: "Collections, 2 collections" });
    expect(within(collectionsLink).getByText("2")).toBeInTheDocument();
    unmount();

    // With counts at 0
    mockCommon({
      "GET /requests?limit=200": () => ({
        requests: [],
        counts: { requested: 0, downloading: 0, imported: 0, failed: 0, cancelled: 0, exists: 0 },
      }),
      "GET /collections?library=Movies": () => ({ collections: [] }),
    });
    renderAt("/");
    const navZero = await screen.findByRole("navigation", { name: "Main" });
    expect(within(navZero).getByRole("link", { name: "Requests" })).toBeInTheDocument();
    expect(within(navZero).getByRole("link", { name: "Collections" })).toBeInTheDocument();
    expect(within(navZero).queryByText("3")).toBeNull();
    expect(within(navZero).queryByText("2")).toBeNull();
  });

  it("keeps Collections current on the Ready-made tab and its categories", async () => {
    mockCommon();
    renderAt("/collections/ready-made/genre");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: /^Collections/ })).toHaveAttribute("aria-current", "page");
    expect(within(nav).queryByRole("link", { name: "Ready-made" })).toBeNull();
  });
});
