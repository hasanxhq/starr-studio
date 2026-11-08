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
      "GET /status": () => ({ version: "0.0.0", kometa: { version: "2.5.3", config: "/config/config.yml", updates: { installed: "2.5.3", checked_at: null, latest: null, notes: null, available: false } }, database: { schema_version: 1 }, health: [] }),
      "GET /kometa/full-check": () => ({ last: null }),
    });
    renderAt("/system/status");
    expect(await screen.findByText("2.5.3")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
  });

  it("redirects section hubs to their first tab", async () => {
    mockApi({
      "GET /status": () => ({ version: "0.0.0", kometa: { version: "2.5.3", config: "/config/config.yml", updates: { installed: "2.5.3", checked_at: null, latest: null, notes: null, available: false } }, database: { schema_version: 1 }, health: [] }),
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
});
