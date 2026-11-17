import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ConfigLibrary, DefaultsCatalogue, FileReference, OverlayLayout, OverlayLibrary, PlexItem } from "../../api";
import { mockApi, renderAt } from "../../test-utils";

const aligned: OverlayLayout = {
  moved_by: "align",
  variables: { horizontal_align: "left", vertical_align: "top", horizontal_offset: 15, vertical_offset: 15, back_color: "#00000099" },
  conditionals: { back_width: { default: 305, conditions: [] }, back_height: { default: 105, conditions: [] } },
};

const entry = (name: string, title: string, layout: OverlayLayout, toggles: DefaultsCatalogue["overlays"][number]["toggles"] = [], types = ["movie", "show"]) => ({
  name,
  group: "overlays" as const,
  types,
  title,
  docs_url: `https://kometa.wiki/${name}`,
  toggles,
  layout,
});

const catalogue: DefaultsCatalogue = {
  collections: [],
  overlays: [
    entry("resolution", "Resolution Overlay", aligned),
    entry("status", "Status Overlay", aligned, [
      { key: "airing", label: "Airing", on: true, types: ["movie", "show"] },
      { key: "ended", label: "Ended", on: true, types: ["movie", "show"] },
    ]),
  ],
};

const ref = (value: string, template_variables: Record<string, unknown> = {}): FileReference => ({ kind: "default", value, template_variables, options: {}, files: [], error: null });

const movies: ConfigLibrary = {
  name: "Movies",
  collection_files: [],
  overlay_files: [ref("resolution", { horizontal_align: "right" }), ref("status")],
  metadata_files: [],
  operations: {},
  template_variables: {},
  settings: {},
  counts: {} as ConfigLibrary["counts"],
};

const status: OverlayLibrary = { library: "Movies", plex_name: "Movies", off: false, files: [], backup: { posters: 100, bytes: 1 }, last_pass: { run_id: 1, status: "succeeded", started_at: null, finished_at: null }, maintainerr: null };

const saved = { backup: "b", files: [{ path: "config.yml", hash: "h" }], validation: { ok: true, errors: [], warnings: [], existing_errors: [], checked_by_kometa: true, crashed: false, output: "" } };

const item = (rating_key: string, title: string): PlexItem => ({
  rating_key,
  title,
  type: "movie",
  year: 2021,
  thumb: `/library/metadata/${rating_key}/thumb/1`,
  ids: {},
  content_rating: null,
  audience_rating: 8.1,
  episodes: null,
  added_at: null,
  video_resolution: "4k",
  audio_codec: null,
});

const routes = {
  "GET /plex/libraries": () => ({ libraries: [{ key: "1", title: "Movies", type: "movie", collections: 0, managed: 0 }] }),
  "GET /config": () => ({ path: "/config/config.yml", libraries: [{ name: "Movies", plex_name: "Movies" }], playlist_files: [] }),
  "GET /config/libraries/Movies": () => movies,
  "GET /config/defaults": () => catalogue,
  "GET /config/schemas/config": () => ({
    type: "object",
    definitions: {
      "template-variables-overlays": {
        type: "object",
        properties: {
          horizontal_align: { type: "string", enum: ["left", "center", "right"] },
          vertical_align: { type: "string", enum: ["top", "center", "bottom"] },
          use_airing: { type: "boolean" },
          use_ended: { type: "boolean" },
        },
        patternProperties: { "^use_.*$": { type: "boolean" } },
      },
    },
  }),
  "GET /overlays": () => ({ libraries: [status] }),
  "GET /schedules": () => ({ schedules: [], timezone: "UTC", catch_up: null }),
  "GET /arr": () => ({ settings: { radarr: { enabled: false }, sonarr: { enabled: false } } }),
  "GET /plex/libraries/1/items": () => ({ items: [item("5", "Dune")], start: 0, total: 1 }),
};

describe("OverlayStudio save", () => {
  it("sends every changed layer in one batch save", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = mockApi({
      ...routes,
      "POST /overlays/Movies/estimate": () => ({ posters: 10, minutes: 1 }),
      "PUT /config/libraries/Movies/defaults/overlay": () => saved,
    });
    renderAt("/overlays?library=Movies");
    await screen.findByRole("heading", { name: "Layers" });
    await screen.findByRole("group", { name: /Overlays on Dune/ });
    fireEvent.click(screen.getByRole("button", { name: "Bottom left" }));
    fireEvent.click(layerRow("Status"));
    fireEvent.click(screen.getByRole("tab", { name: "Show when" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Show when" })).getByRole("checkbox", { name: "Ended" }));
    await vi.advanceTimersByTimeAsync(500);
    fireEvent.click(screen.getByRole("button", { name: "Save for tonight" }));
    await waitFor(() => {
      const batch = calls.filter((c) => c.route === "PUT /config/libraries/Movies/defaults/overlay");
      expect(batch).toHaveLength(1);
      expect(batch[0]?.body).toEqual({
        layers: [
          { name: "resolution", template_variables: { vertical_align: "bottom" } },
          { name: "status", template_variables: { use_ended: false } },
        ],
      });
    });
    expect(calls.filter((c) => c.route.startsWith("PUT /config/libraries/Movies/defaults/overlay/"))).toHaveLength(0);
    vi.useRealTimers();
  });
});

function layerRow(name: string) {
  const heading = screen.getByRole("heading", { name: "Layers" });
  return within(heading.parentElement!).getByRole("button", { name: new RegExp(`^${name} `) });
}