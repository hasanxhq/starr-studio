import { describe, expect, it } from "vitest";

import { pageTitle, sectionForPath, sidebarEntries } from "./nav";

describe("The header's title", () => {
  it("names nested pages for what they show, in Plex's words", () => {
    expect(pageTitle("/libraries")).toBe("Settings · Libraries");
    expect(pageTitle("/libraries/TV%20Shows")).toBe("Library");
    expect(pageTitle("/libraries/TV%20Shows/collections/8752")).toBe("Collection");
    expect(pageTitle("/activity/queue/3")).toBe("Run");
    expect(pageTitle("/activity/queue")).toBe("Activity · Queue");
    expect(pageTitle("/ready-made/imdb")).toBe("Category");
    expect(pageTitle("/ready-made")).toBe("Ready-made");
    expect(pageTitle("/requests")).toBe("Requests");
    expect(pageTitle("/settings/plex")).toBe("Settings · Plex");
    expect(pageTitle("/settings/requests")).toBe("Settings · Requests");
    expect(pageTitle("/collections")).toBe("Collections");
    expect(pageTitle("/collections/ready-made")).toBe("Collections");
    expect(pageTitle("/collections/ready-made/imdb")).toBe("Category");
    expect(pageTitle("/collections/new")).toBe("New collection");
    expect(pageTitle("/collections/42")).toBe("Collection");
    expect(pageTitle("/items")).toBe("Edit");
    expect(pageTitle("/setup/move-over")).toBe("Move over from Kometa");
    expect(pageTitle("/")).toBe("Home");
    expect(pageTitle("/nowhere")).toBe("Starr Studio");
  });
});

describe("sectionForPath", () => {
  it("places Libraries and library subpaths under Settings", () => {
    expect(sectionForPath("/libraries/Movies")?.label).toBe("Settings");
    expect(sectionForPath("/libraries")?.label).toBe("Settings");
  });

  it("returns section for Activity and System paths, and null outside tab sections", () => {
    expect(sectionForPath("/activity/queue")?.label).toBe("Activity");
    expect(sectionForPath("/system/status")?.label).toBe("System");
    expect(sectionForPath("/collections")).toBeNull();
    expect(sectionForPath("/requests")).toBeNull();
  });
});

describe("sidebarEntries", () => {
  it("has the nine sidebar entries in order", () => {
    expect(sidebarEntries).toEqual([
      { label: "Home", path: "/" },
      { label: "Collections", path: "/collections" },
      { label: "Requests", path: "/requests" },
      { label: "Overlays", path: "/overlays" },
      { label: "Playlists", path: "/playlists" },
      { label: "Activity", path: "/activity" },
      { spacer: true },
      { label: "System", path: "/system" },
      { label: "Settings", path: "/settings" },
    ]);
  });
});
