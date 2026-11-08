import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ConfigLibrary, DefaultsCatalogue, FileReference, OverlayLayout, OverlayLibrary, PlexItem } from "../api";
import { mockApi, renderAt } from "../test-utils";

const aligned: OverlayLayout = {
  moved_by: "align",
  variables: { horizontal_align: "left", vertical_align: "top", horizontal_offset: 15, vertical_offset: 15, back_color: "#00000099" },
  conditionals: { back_width: { default: 305, conditions: [] }, back_height: { default: 105, conditions: [] } },
};
const positioned: OverlayLayout = { moved_by: "position", variables: { horizontal_position: "left", vertical_position: "center" }, conditionals: {} };

const entry = (name: string, title: string, layout: OverlayLayout, toggles: DefaultsCatalogue["overlays"][number]["toggles"] = [], types = ["movie", "show"]) => ({ name, group: "overlays" as const, types, title, docs_url: `https://kometa.wiki/${name}`, toggles, layout });

const catalogue: DefaultsCatalogue = {
  collections: [],
  overlays: [
    entry("resolution", "Resolution Overlay", aligned),
    entry("ratings", "Ratings Overlays", positioned),
    entry("status", "Status Overlay", aligned, [
      { key: "airing", label: "Airing", on: true, types: ["movie", "show"] },
      { key: "ended", label: "Ended", on: true, types: ["movie", "show"] },
    ]),
    entry("ribbon", "Ribbon Overlay", aligned),
    entry("episode_info", "Episode Info Overlay", aligned, [], ["show"]),
  ],
};

const ref = (value: string, template_variables: Record<string, unknown> = {}): FileReference => ({ kind: "default", value, template_variables, options: {}, files: [], error: null });

const movies: ConfigLibrary = {
  name: "Movies",
  collection_files: [],
  overlay_files: [ref("resolution", { horizontal_align: "right" }), ref("ratings"), { kind: "file", value: "config/mine.yml", template_variables: {}, options: {}, files: [], error: null }, ref("status")],
  metadata_files: [],
  operations: {},
  template_variables: {},
  settings: {},
  counts: {} as ConfigLibrary["counts"],
};

const shows: ConfigLibrary = { ...movies, name: "TV Shows", overlay_files: [ref("resolution")] };

const configSchema = {
  type: "object",
  definitions: {
    "kometa-default-overlay-path": { type: "object", properties: { default: { type: "string" }, template_variables: { $ref: "#/definitions/template-variables-overlays" } } },
    "template-variables-overlays": {
      type: "object",
      properties: {
        back_color: { type: "string" },
        back_radius: { type: "integer" },
        horizontal_align: { type: "string", enum: ["left", "center", "right"] },
        vertical_align: { type: "string", enum: ["top", "center", "bottom"] },
        horizontal_offset: { type: ["string", "integer"] },
        vertical_offset: { type: ["string", "integer"] },
        horizontal_position: { type: "string" },
        vertical_position: { type: "string" },
        rating1: { type: "string", enum: ["none", "imdb", "tmdb", "critic"] },
        rating1_image: { type: "string", enum: ["imdb", "tmdb", "rt_tomato"] },
        builder_level: { type: "string", enum: ["show", "season", "episode"] },
        use_resolution: { type: "boolean" },
        use_edition: { type: "boolean" },
        rating_alignment: { type: "string", enum: ["horizontal", "vertical"] },
      },
      patternProperties: { "^use_.*$": { type: "boolean" } },
    },
  },
};

const item = (rating_key: string, title: string, video_resolution: string | null): PlexItem => ({ rating_key, title, type: "movie", year: 2021, thumb: `/library/metadata/${rating_key}/thumb/1`, ids: {}, content_rating: null, audience_rating: null, episodes: null, added_at: null, video_resolution, audio_codec: null });

const status: OverlayLibrary = { library: "Movies", plex_name: "Movies", off: false, files: [], backup: { posters: 100, bytes: 1 }, last_pass: { run_id: 1, status: "succeeded", started_at: null, finished_at: null }, maintainerr: null };

const saved = { backup: "b", files: [{ path: "config.yml", hash: "h" }], validation: { ok: true, errors: [], warnings: [], existing_errors: [], checked_by_kometa: true, crashed: false, output: "" } };

const routes = {
  "GET /plex/libraries": () => ({
    libraries: [
      { key: "1", title: "Movies", type: "movie", collections: 0, managed: 0 },
      { key: "2", title: "TV Shows", type: "show", collections: 0, managed: 0 },
    ],
  }),
  "GET /config": () => ({ path: "/config/config.yml", libraries: [{ name: "Movies", plex_name: "Movies" }, { name: "TV Shows", plex_name: "TV Shows" }], playlist_files: [] }),
  "GET /config/libraries/Movies": () => movies,
  "GET /config/libraries/TV%20Shows": () => shows,
  "GET /config/defaults": () => catalogue,
  "GET /config/schemas/config": () => configSchema,
  "GET /overlays": () => ({ libraries: [status] }),
  "GET /schedules": () => ({ schedules: [], timezone: "UTC", catch_up: null }),
  "GET /arr": () => ({ settings: { radarr: { enabled: false }, sonarr: { enabled: false } } }),
  "GET /plex/libraries/1/items": () => ({ items: [item("5", "Dune", "4k"), item("6", "Heat", "1080")], start: 0, total: 2 }),
  "GET /plex/libraries/2/items": () => ({ items: [], start: 0, total: 0 }),
};

const layers = () => screen.findByRole("heading", { name: "Layers" });
const settings = () => screen.getByRole("complementary", { name: "Layer settings" });
const pressed = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });

describe("The overlay studio", () => {
  it("redirects /overlays/designer to /overlays with the library", async () => {
    mockApi(routes);
    renderAt("/overlays/designer?library=Movies");
    expect(await screen.findByRole("heading", { name: "Overlays · Movies" })).toBeInTheDocument();
  });

  it("lists layers top-draws-last with locked user files", async () => {
    mockApi(routes);
    renderAt("/overlays?library=Movies");
    const heading = await layers();
    const list = heading.parentElement!;
    await waitFor(() => expect(within(list).getAllByRole("listitem").map((li) => li.textContent?.replace(/\s+/g, " ").trim())).toEqual(expect.arrayContaining(["config/mine.yml"])));
    expect(within(list).getByRole("button", { name: /^Status / })).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: /^Resolution / })).toBeInTheDocument();
  });

  it("uses Plex thumb without boxes for Now in Plex and original with boxes for With your changes", async () => {
    mockApi(routes);
    renderAt("/overlays?library=Movies");
    await layers();
    fireEvent.click(screen.getByRole("button", { name: "Now in Plex" }));
    expect(screen.queryByRole("button", { name: "Select 4K" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "With your changes" }));
    const poster = await screen.findByRole("group", { name: /Overlays on Dune/ });
    expect(await within(poster).findByRole("button", { name: "Select 4K" })).toBeInTheDocument();
    const img = poster.querySelector("img")!;
    expect(img.getAttribute("src")).toContain("/overlays/Movies/original/5");
    fireEvent.error(img);
    await waitFor(() => expect(img.getAttribute("src")).toContain("/plex/image"));
    expect(img.getAttribute("src")).toContain(encodeURIComponent("/library/metadata/5/thumb/1"));
    fireEvent.click(screen.getByRole("button", { name: "Hide Resolution in the preview" }));
    expect(within(poster).queryByRole("button", { name: "Select 4K" })).not.toBeInTheDocument();
  });

  it("moves a layer with anchors, saves for tonight, or applies now", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = mockApi({
      ...routes,
      "POST /overlays/Movies/estimate": () => ({ posters: 1200, minutes: 18 }),
      "PUT /config/libraries/Movies/defaults/overlay/resolution": () => saved,
      "POST /overlays/Movies/apply": () => ({ run_id: 12 }),
    });
    renderAt("/overlays?library=Movies");
    await layers();
    await screen.findByRole("group", { name: /Overlays on Dune/ });
    fireEvent.click(screen.getByRole("button", { name: "Bottom right" }));
    await vi.advanceTimersByTimeAsync(500);
    expect(await screen.findByRole("region", { name: "Overlay changes" })).toHaveTextContent(/1 layer changed/);
    fireEvent.click(screen.getByRole("button", { name: "Save for tonight" }));
    await waitFor(() =>
      expect(calls.find((c) => c.route === "PUT /config/libraries/Movies/defaults/overlay/resolution")?.body).toEqual({
        template_variables: { horizontal_align: "right", vertical_align: "bottom" },
      }),
    );
    expect(calls.some((c) => c.route === "POST /overlays/Movies/apply")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Bottom left" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply now" }));
    await waitFor(() => expect(calls.some((c) => c.route === "POST /overlays/Movies/apply")).toBe(true));
    vi.useRealTimers();
  });

  it("reorders layers when Move up is pressed", async () => {
    const calls = mockApi({ ...routes, "PUT /config/libraries/Movies/overlay-order": () => saved });
    renderAt("/overlays?library=Movies");
    await layers();
    fireEvent.click(await screen.findByRole("button", { name: "Move Resolution up" }));
    await waitFor(() => expect(calls.find((c) => c.route === "PUT /config/libraries/Movies/overlay-order")?.body).toEqual({ names: ["ratings", "resolution", "status"] }));
  });

  it("selects a layer from the poster and shows Show when toggles", async () => {
    mockApi(routes);
    renderAt("/overlays?library=Movies");
    await layers();
    fireEvent.click(await screen.findByRole("button", { name: "Select Status" }));
    fireEvent.click(screen.getByRole("tab", { name: "Show when" }));
    const when = await screen.findByRole("group", { name: "Show when" });
    fireEvent.click(within(when).getByRole("checkbox", { name: "Ended" }));
    fireEvent.click(screen.getByRole("button", { name: "Save for tonight" }));
  });

  it("hides a layer in the preview without saving", async () => {
    mockApi(routes);
    renderAt("/overlays?library=Movies");
    await layers();
    fireEvent.click(await screen.findByRole("button", { name: "Hide Resolution in the preview" }));
    expect(screen.queryByRole("button", { name: "Select 4K" })).not.toBeInTheDocument();
  });

  it("keeps layer drafts when switching layers without asking", async () => {
    mockApi(routes);
    renderAt("/overlays?library=Movies");
    await layers();
    fireEvent.click(screen.getByRole("button", { name: "Bottom left" }));
    fireEvent.click(pressed("Status"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: "Show when" })).toBeInTheDocument();
    fireEvent.click(pressed("Resolution"));
    expect(screen.getByRole("tab", { name: "Place" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bottom left", pressed: true })).toBeInTheDocument();
  });

  it("adds a layer and removes one after asking", async () => {
    const calls = mockApi({ ...routes, "PUT /config/libraries/Movies/defaults/overlay/ribbon": () => saved, "DELETE /config/libraries/Movies/defaults/overlay/resolution": () => saved });
    renderAt("/overlays?library=Movies");
    await layers();
    fireEvent.click(await screen.findByRole("button", { name: "Ribbon" }));
    await waitFor(() => expect(calls.find((c) => c.route === "PUT /config/libraries/Movies/defaults/overlay/ribbon")?.body).toEqual({ template_variables: {} }));
    fireEvent.click(screen.getByRole("button", { name: /^Resolution / }));
    fireEvent.click(within(settings()).getByRole("button", { name: "Remove layer" }));
    fireEvent.click(within(settings()).getByRole("button", { name: "Turn off Resolution" }));
    await waitFor(() => expect(calls.some((c) => c.route === "DELETE /config/libraries/Movies/defaults/overlay/resolution")).toBe(true));
  });
});
