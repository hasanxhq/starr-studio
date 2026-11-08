import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Status } from "../api";
import { mockApi, renderAt } from "../test-utils";

const status: Status = {
  version: "0.1.0",
  kometa: {
    version: "2.5.4",
    config: "/config/config.yml",
    updates: {
      installed: "2.5.4",
      pinned: "2.5.4",
      matches: true,
      checked_at: "2026-10-30T03:00:05Z",
      latest: "2.6.0",
      notes: "- Faster overlays",
      available: true,
    },
  },
  database: { schema_version: 4 },
  health: [
    { source: "plex", level: "error", message: "Can't reach Plex at the address in config.yml: No answer within 5 s", link: "/settings/plex" },
  ],
  runs: { current: null, queued: 0, next_scheduled: null },
};

describe("Health", () => {
  it("lists each problem with a link to where it's fixed, and marks Status in the sidebar", async () => {
    mockApi({ "GET /status": () => status, "GET /kometa/full-check": () => ({ last: null }) });
    renderAt("/system/status");

    const health = (await screen.findByRole("heading", { name: "Health" })).closest("section")!;
    const plex = within(health).getByText(/Can't reach Plex/).closest("li")!;
    expect(within(plex).getByText("Error")).toBeInTheDocument();
    expect(within(plex).getByRole("link", { name: "Open" })).toHaveAttribute("href", "/settings/plex");
    expect(within(screen.getByRole("navigation", { name: "Main" })).getByRole("img", { name: "Health errors" })).toBeInTheDocument();
  });

  it("says so when there's nothing wrong, with no dot", async () => {
    mockApi({ "GET /status": () => ({ ...status, health: [] }), "GET /kometa/full-check": () => ({ last: null }) });
    renderAt("/system/status");
    expect(await screen.findByText("No problems found.")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Health/ })).toBeNull();
  });
});

describe("Updates", () => {
  it("shows a muted line for a newer Kometa release without pull advice", async () => {
    mockApi({ "GET /status": () => status });
    renderAt("/system/updates");
    expect(await screen.findByText(/Kometa 2.6.0 is out\. It comes with a Studio update/)).toBeInTheDocument();
    expect(screen.queryByText(/pull the new Starr Studio image/i)).toBeNull();
    expect(screen.queryByText("- Faster overlays")).toBeNull();
  });

  it("shows a version mismatch warning", async () => {
    const mismatch = {
      ...status.kometa.updates,
      installed: "2.5.3",
      matches: false,
      available: false,
      latest: null,
      notes: null,
    };
    mockApi({ "GET /status": () => ({ ...status, kometa: { ...status.kometa, version: "2.5.3", updates: mismatch } }) });
    renderAt("/system/updates");
    expect(await screen.findByRole("alert")).toHaveTextContent(/Studio is tested with Kometa 2\.5\.4; this install has 2\.5\.3/);
  });

  it("says when Kometa last checked for a newer release", async () => {
    const upToDate = { ...status.kometa.updates, latest: null, notes: null, available: false };
    mockApi({ "GET /status": () => ({ ...status, kometa: { ...status.kometa, updates: upToDate } }) });
    renderAt("/system/updates");
    expect(await screen.findByText(/Kometa last checked for a newer release/)).toBeInTheDocument();
  });
});

describe("Service use today", () => {
  it("shows each service's calls and how close MDBList is to its daily allowance", async () => {
    mockApi({
      "GET /status": () => ({ ...status, health: [] }),
      "GET /kometa/full-check": () => ({ last: null }),
      "GET /usage": () => ({
        today: { tmdb: 912, mdblist: 830, "other:example.com": 3 },
        mdblist: { limit: 1000, used: 830, checked_at: new Date().toISOString() },
        limit_share: 0.8,
        held: "MDBList has used 830 of today's 1000 requests (80% is Studio's limit for runs after imports); waiting until it resets at midnight UTC",
      }),
    });
    renderAt("/system/status");

    const card = (await screen.findByRole("heading", { name: "Service use today" })).closest("section")!;
    expect(within(card).getByText("TMDb")).toBeInTheDocument();
    expect(within(card).getByText("912")).toBeInTheDocument();
    expect(within(card).queryByText(/example\.com/)).toBeNull();
    expect(within(card).getByText("MDBList: 830 of 1000 requests today")).toBeInTheDocument();
    expect(within(card).getByRole("img", { name: "83% of MDBList's daily allowance used" })).toBeInTheDocument();
    expect(within(card).getByText(/waiting until it resets at midnight UTC/)).toBeInTheDocument();
  });
});
