import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { sidebarEntries, type SidebarLink } from "./nav";
import { mockApi, renderAt } from "./test-utils";

describe("App shell", () => {
  it("links to every sidebar entry", async () => {
    mockApi({});
    renderAt("/collections");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    const links = sidebarEntries.filter((e): e is SidebarLink => !e.spacer);
    for (const entry of links) {
      expect(nav.querySelector(`a[href="${entry.path}"]`)).not.toBeNull();
    }
  });

  it("opens on Home", async () => {
    mockApi({});
    renderAt("/");
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Home"));
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Collections" })).not.toHaveAttribute("aria-current");
  });

  it("shows versions on System → Status", async () => {
    mockApi({
      "GET /status": () => ({ version: "0.0.0", kometa: { version: "2.5.3", config: "/config/config.yml", updates: { installed: "2.5.3", pinned: "2.5.4", matches: false, checked_at: null, latest: null, notes: null, available: false } }, database: { schema_version: 1 }, health: [] }),
      "GET /kometa/full-check": () => ({ last: null }),
    });
    renderAt("/system/status");
    expect(await screen.findByText("2.5.3")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
  });

  it("redirects section hubs to their first tab", async () => {
    mockApi({
      "GET /status": () => ({ version: "0.0.0", kometa: { version: "2.5.3", config: "/config/config.yml", updates: { installed: "2.5.3", pinned: "2.5.4", matches: false, checked_at: null, latest: null, notes: null, available: false } }, database: { schema_version: 1 }, health: [] }),
      "GET /kometa/full-check": () => ({ last: null }),
      "GET /settings/general": () => ({ port: 8765, host: "0.0.0.0", timezone: "UTC", auth_configured: true, url_base: "", trusted_proxies: [] }),
      "GET /runs": () => ({ running: null, queued: [] }),
      "GET /kometa": () => ({ environment: {} }),
    });
    const { unmount: u1 } = renderAt("/system");
    const systemTabs = await screen.findByRole("navigation", { name: "System pages" });
    expect(within(systemTabs).getByRole("link", { name: "Status" })).toHaveAttribute("aria-current", "page");
    u1();

    const { unmount: u2 } = renderAt("/settings");
    const settingsTabs = await screen.findByRole("navigation", { name: "Settings pages" });
    expect(within(settingsTabs).getByRole("link", { name: "General" })).toHaveAttribute("aria-current", "page");
    u2();

    renderAt("/activity");
    const activityTabs = await screen.findByRole("navigation", { name: "Activity pages" });
    expect(within(activityTabs).getByRole("link", { name: "Queue" })).toHaveAttribute("aria-current", "page");
  });

  it("explains when the API is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 502, statusText: "Bad Gateway" }));
    renderAt("/system/status");
    expect(await screen.findByRole("alert")).toHaveTextContent("502");
  });

  it("renders old paths: /libraries, /libraries/:name, /ready-made, /system/tasks, /settings/plex, /activity/history", async () => {
    mockApi({
      "GET /config": () => ({
        path: "/config/config.yml",
        libraries: [
          {
            name: "Movies",
            plex_name: "Movies",
            collection_files: 0,
            overlay_files: 0,
            metadata_files: 0,
            defaults: 0,
            collections: 0,
            overlays: 0,
            operations: 0,
            problems: [],
          },
        ],
        playlist_files: [],
      }),
      "GET /plex/libraries": () => ({ libraries: [{ key: "1", title: "Movies", type: "movie", collections: 0, managed: 0 }] }),
      "GET /libraries/counts": () => [
        {
          name: "Movies",
          plex_name: "Movies",
          collection_files: 0,
          overlay_files: 0,
          metadata_files: 0,
          defaults: 0,
          collections: 0,
          overlays: 0,
          operations: 0,
          problems: [],
        },
      ],
      "GET /config/libraries/Movies": () => ({
        name: "Movies",
        collection_files: [],
        overlay_files: [],
        metadata_files: [],
        defaults: 0,
        collections: 0,
        overlays: 0,
        operations: 0,
        settings: null,
        template_variables: {},
      }),
      "GET /plex/libraries/Movies/collections": () => [],
      "GET /collections?library=Movies": () => ({ collections: [] }),
      "GET /ready-made/libraries/Movies": () => ({ library: "Movies", library_type: "movie", counted_at: null, counting: false, categories: [] }),
      "GET /tasks": () => ({ tasks: [] }),
      "GET /schedules": () => ({ schedules: [], timezone: "UTC", catch_ups: [] }),
      "GET /plex": () => ({ config: { path: "/config/config.yml", url: null, token: null, error: null, custom: false }, account: null }),
      "GET /history": () => ({ events: [], next_before: null }),
    });

    const { unmount: u1 } = renderAt("/libraries");
    expect(await screen.findByRole("button", { name: "Add files…" })).toBeInTheDocument();
    u1();

    const { unmount: u2 } = renderAt("/libraries/Movies");
    expect(await screen.findByRole("heading", { name: "Movies", level: 2 })).toBeInTheDocument();
    u2();

    const { unmount: u3 } = renderAt("/ready-made");
    expect(await screen.findByRole("heading", { name: "Collections", level: 2 })).toBeInTheDocument();
    u3();

    const { unmount: u4 } = renderAt("/system/tasks");
    expect(await screen.findByRole("button", { name: "Add schedule" })).toBeInTheDocument();
    u4();

    const { unmount: u5 } = renderAt("/settings/plex");
    expect(await screen.findByRole("button", { name: "Sign in with Plex" })).toBeInTheDocument();
    u5();

    const { unmount: u6 } = renderAt("/activity/history");
    expect(await screen.findByText(/Each time Kometa adds or removes items/)).toBeInTheDocument();
    u6();
  });
});
