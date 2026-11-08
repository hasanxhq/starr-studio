import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { mockApi, renderAt } from "../test-utils";

describe("System → Logs", () => {
  it("opens meta.log, and filters by level and search", async () => {
    const calls = mockApi({
      "GET /logs?source=kometa": () => ({ files: [{ path: "meta.log", size: 10, modified: 2 }, { path: "Movies/library.log", size: 5, modified: 1 }] }),
      "GET /logs/file?source=kometa&path=meta.log&level=INFO&q=": () => ({
        path: "meta.log",
        lines: [
          { level: "INFO", text: "[2026-10-30 04:00:00,002] kometa.py   INFO       | Starting Run |" },
          { level: "ERROR", text: "[2026-10-30 04:00:03,300] builder.py   ERROR      | Trakt Error: List not found |" },
        ],
        truncated: false,
        size: 10,
      }),
      "GET /logs/file?source=kometa&path=meta.log&level=ERROR&q=": () => ({ path: "meta.log", lines: [{ level: "ERROR", text: "[2026-10-30 04:00:03,300] builder.py   ERROR      | Trakt Error: List not found |" }], truncated: false, size: 10 }),
      "GET /logs/file?source=kometa&path=meta.log&level=ERROR&q=trakt": () => ({ path: "meta.log", lines: [], truncated: false, size: 10 }),
    });
    renderAt("/system/logs");

    expect(await screen.findByText("Starting Run")).toBeInTheDocument();
    expect(screen.getByText("Trakt Error: List not found").parentElement).toHaveClass("text-err");
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute("href", "/api/v1/logs/download?source=kometa&path=meta.log");

    fireEvent.change(screen.getByLabelText("Show"), { target: { value: "ERROR" } });
    await waitFor(() => expect(screen.queryByText("Starting Run")).toBeNull());
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "trakt" } });
    expect(await screen.findByText("Nothing matches.")).toBeInTheDocument();
    expect(calls.map((c) => c.route)).toContain("GET /logs/file?source=kometa&path=meta.log&level=ERROR&q=trakt");
  });

  it("shows the time and message without Kometa's columns", async () => {
    const { splitLine } = await import("./SystemLogs");
    expect(splitLine("[2026-10-30 04:00:02,200] builder.py                  WARNING    | Collection Warning: no items  |")).toEqual({
      time: "04:00:02",
      message: "Collection Warning: no items",
    });
    expect(splitLine("[2026-10-30 04:00:04,400] kometa.py   [TRACE]    | Cache hit |")).toEqual({ time: "04:00:04", message: "Cache hit" });
    expect(splitLine("                                                    | (continued) https://trakt.tv/x |")).toEqual({
      time: null,
      message: "(continued) https://trakt.tv/x",
    });
    expect(splitLine("[2026-11-09 01:33:00,123] starr_studio.runner [INFO] Run 4 finished")).toEqual({ time: "01:33:00", message: "Run 4 finished" });
    expect(splitLine("Traceback (most recent call last):")).toEqual({ time: null, message: "Traceback (most recent call last):" });
  });

  it("explains an empty logs folder", async () => {
    mockApi({ "GET /logs?source=kometa": () => ({ files: [] }) });
    renderAt("/system/logs");
    expect(await screen.findByText(/hasn't written any logs yet/)).toBeInTheDocument();
  });

  it("switches to Studio's own log", async () => {
    const calls = mockApi({
      "GET /logs?source=kometa": () => ({ files: [{ path: "meta.log", size: 10, modified: 2 }] }),
      "GET /logs/file?source=kometa&path=meta.log&level=INFO&q=": () => ({ path: "meta.log", lines: [], truncated: false, size: 10 }),
      "GET /logs?source=studio": () => ({ files: [{ path: "studio.log", size: 10, modified: 3 }] }),
      "GET /logs/file?source=studio&path=studio.log&level=INFO&q=": () => ({
        path: "studio.log",
        lines: [{ level: "INFO", text: "[2026-11-09 01:33:00,123] starr_studio.runner [INFO] Run 4 finished" }],
        truncated: false,
        size: 10,
      }),
    });
    renderAt("/system/logs");
    fireEvent.click(await screen.findByRole("button", { name: "Studio" }));
    expect(await screen.findByText("Run 4 finished")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Studio" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute("href", "/api/v1/logs/download?source=studio&path=studio.log");
    expect(calls.map((c) => c.route)).toContain("GET /logs/file?source=studio&path=studio.log&level=INFO&q=");
  });
});
