import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { mockApi, renderAt } from "../test-utils";

describe("Layout", () => {
  it("shows section tabs above page content on System pages", async () => {
    mockApi({
      "GET /status": () => ({ version: "0.0.0", kometa: { version: "2.5.3", config: "/config/config.yml", updates: { installed: "2.5.3", checked_at: null, latest: null, notes: null, available: false } }, database: { schema_version: 1 }, health: [] }),
      "GET /kometa/full-check": () => ({ last: null }),
    });
    renderAt("/system/status");
    const tabNav = await screen.findByRole("navigation", { name: "System pages" });
    expect(within(tabNav).getByRole("link", { name: "Status" })).toHaveAttribute("aria-current", "page");
  });
});
