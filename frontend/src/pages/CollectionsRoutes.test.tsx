import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { mockApi, renderAt } from "../test-utils";

const config = {
  "GET /config": () => ({
    path: "/config/config.yml",
    libraries: [{ name: "Movies", plex_name: "Movies" }],
    playlist_files: [],
  }),
  "GET /collections?library=Movies": () => ({ collections: [] }),
  "GET /ready-made/libraries/Movies": () => ({
    library: "Movies",
    library_type: "movie",
    counted_at: null,
    counting: false,
    categories: [],
  }),
  "GET /ready-made/libraries/Movies/categories/imdb": () => ({
    name: "imdb",
    title: "IMDb Collections",
    group: "chart",
    kind: "fixed",
    listable: true,
    reason: null,
    count: 1,
    in_plex: 0,
    picked: 0,
    run_scope: "collection",
    counted_at: null,
    collections: [],
  }),
};

describe("Collections routes", () => {
  it("redirects /ready-made with the query string", async () => {
    mockApi({ ...config, "GET /jobs": () => ({ jobs: [], at: new Date().toISOString() }) });
    renderAt("/ready-made?library=Movies&foo=bar");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Ready-made" })).toHaveAttribute("aria-current", "page"));
    expect(screen.getByRole("heading", { name: "Collections", level: 2 })).toBeInTheDocument();
  });

  it("redirects /ready-made/:category with the query string", async () => {
    mockApi(config);
    renderAt("/ready-made/imdb?library=Movies");
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "IMDb Collections" })).toBeInTheDocument());
  });

  it("does not treat /collections/ready-made as a builder id", async () => {
    mockApi({ ...config, "GET /jobs": () => ({ jobs: [], at: new Date().toISOString() }) });
    renderAt("/collections/ready-made?library=Movies");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Ready-made" })).toHaveAttribute("aria-current", "page"));
    expect(screen.queryByLabelText("Title")).toBeNull();
  });
});
