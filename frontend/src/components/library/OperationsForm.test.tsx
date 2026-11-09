import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ConfigLibrary, LibraryCounts, PlexLibrarySummary } from "../../api";
import { mockApi, renderAt } from "../../test-utils";

// Shaped like Kometa's config-schema.json operations definition, with the keys these tests name.
const configSchema = {
  type: "object",
  definitions: {
    operations: {
      oneOf: [
        {
          type: "object",
          properties: {
            update_blank_track_titles: { type: "boolean" },
            remove_title_parentheses: { type: "boolean" },
            assets_for_all: { type: "boolean" },
            assets_for_all_collections: { type: "boolean" },
            delete_collections: { type: "object", properties: { managed: { type: "boolean" }, less: { type: "integer" } } },
            mass_collection_mode: { enum: ["default", "hide", "hide_items", "show_items"] },
            split_duplicates: { type: "boolean" },
            ignore_labels: { type: "string" },
            genre_mapper: { type: "object", properties: {}, patternProperties: { "^.*$": { type: "string" } } },
            mass_poster_update: { type: "boolean" },
            mass_background_update: { type: "boolean" },
            metadata_backup: { type: "object", properties: { path: { type: "string" } } },
            mass_critic_rating_update: { type: "string" },
            radarr_add_all: { type: "boolean" },
            sonarr_add_all: { type: "boolean" },
          },
        },
        { type: "array", items: { type: "object" } },
      ],
    },
    settings: { type: "object", properties: {} },
  },
};

function counts(name: string, operations = 0): LibraryCounts {
  return {
    name,
    plex_name: name,
    collection_files: 0,
    overlay_files: 0,
    metadata_files: 0,
    defaults: 0,
    collections: 0,
    overlays: 0,
    operations,
    problems: [],
  };
}

function library(name: string, operations: ConfigLibrary["operations"]): ConfigLibrary {
  return {
    name,
    collection_files: [],
    overlay_files: [],
    metadata_files: [],
    operations,
    template_variables: {},
    settings: {},
    counts: counts(name, Array.isArray(operations) ? operations.length : Object.keys(operations).length),
  };
}

function routes(type: string, config: ConfigLibrary) {
  const plexLibraries: PlexLibrarySummary[] = [{ key: "1", title: config.name, type, collections: 0, managed: 0 }];
  return {
    "GET /plex/libraries": () => ({ libraries: plexLibraries }),
    "GET /config": () => ({ path: "/config/config.yml", libraries: [config.counts], playlist_files: [] }),
    ["GET /config/libraries/" + config.name]: () => config,
    "GET /config/schemas/config": () => configSchema,
  };
}

const ok = { backup: "b1", files: [], validation: { ok: true, errors: [], warnings: [], existing_errors: [], checked_by_kometa: true, crashed: false, output: "" } };

function fieldPositions(form: HTMLElement, names: string[]): number[] {
  const text = form.textContent ?? "";
  return names.map((name) => text.indexOf(name));
}

describe("Library operations for a library type", () => {
  it("offers music's common operations first and leaves out the video ones", async () => {
    const music = library("Music", {});
    mockApi(routes("artist", music));
    renderAt("/libraries/Music?tab=operations");

    const form = await screen.findByRole("form", { name: "Library operations" });
    await within(form).findByLabelText(/Update blank track titles/);
    const names = ["update_blank_track_titles", "remove_title_parentheses", "assets_for_all", "assets_for_all_collections", "delete_collections"];
    const positions = fieldPositions(form, names);
    expect(positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1]))).toBe(true);
    expect(positions[4]).toBeLessThan((form.textContent ?? "").indexOf("More operations"));
    expect(within(form).queryByLabelText(/Mass critic rating update/)).toBeNull();
    expect(within(form).queryByLabelText(/Radarr add all/)).toBeNull();
    expect(within(form).queryByLabelText(/Sonarr add all/)).toBeNull();
  });

  it("leaves update_blank_track_titles out of a movie library and keeps the video operations", async () => {
    const movies = library("Movies", {});
    mockApi(routes("movie", movies));
    renderAt("/libraries/Movies?tab=operations");

    const form = await screen.findByRole("form", { name: "Library operations" });
    await within(form).findByLabelText(/Mass critic rating update/);
    expect(within(form).queryByLabelText(/Update blank track titles/)).toBeNull();
  });

  it("still shows a key already set on a music library and keeps it on save", async () => {
    const music = library("Music", { mass_critic_rating_update: "imdb" });
    const calls = mockApi({
      ...routes("artist", music),
      "PUT /config/libraries/Music/operations": () => ok,
    });
    renderAt("/libraries/Music?tab=operations");

    const form = await screen.findByRole("form", { name: "Library operations" });
    const more = (await within(form).findByText("More operations")).closest("details") as HTMLElement;
    expect(within(more).getByLabelText(/Mass critic rating update/)).toHaveValue("imdb");

    fireEvent.change(within(form).getByLabelText(/Update blank track titles/), { target: { value: "true" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save operations" }));
    await waitFor(() => expect(calls.some((call) => call.route === "PUT /config/libraries/Music/operations")).toBe(true));
    expect(calls.find((call) => call.route === "PUT /config/libraries/Music/operations")?.body).toEqual({
      base: { mass_critic_rating_update: "imdb" },
      values: { mass_critic_rating_update: "imdb", update_blank_track_titles: true },
    });
  });
});
