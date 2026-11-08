import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, within } from "@testing-library/react";
import { render } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import type { BuiltCollection, OtherCollection } from "../builderApi";
import { ReadyMadePicksProvider } from "../readyMadePicks";
import { mockApi } from "../test-utils";
import { Collections } from "./Collections";

const collection = (partial: Partial<BuiltCollection> & Pick<BuiltCollection, "id" | "title" | "state">): BuiltCollection => ({
  library: "Movies",
  source: { kind: "filters" },
  filters: { match: "all", rules: [] },
  sort_by: null,
  limit: null,
  visible: { library: true, home: false, shared: false },
  minimum_items: 1,
  summary: null,
  sort_title: null,
  poster: null,
  download_missing: false,
  request_cap: null,
  request_profile: null,
  plex_items: null,
  thumb: null,
  last_built_at: null,
  last_error: null,
  run_id: null,
  requests: { waiting: 0, requested: 0, downloading: 0, imported: 0, failed: 0 },
  ...partial,
});

const other = (partial: Partial<OtherCollection> & Pick<OtherCollection, "title" | "made_by">): OtherCollection => ({
  rating_key: "999",
  items: 5,
  thumb: null,
  smart: false,
  category: null,
  ...partial,
});

function renderCollections(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: "/collections", element: <Collections /> },
      { path: "/collections/ready-made/:category", element: <Collections /> },
    ],
    { initialEntries: [path] },
  );
  return render(
    <QueryClientProvider client={queryClient}>
      <ReadyMadePicksProvider>
        <RouterProvider router={router} />
      </ReadyMadePicksProvider>
    </QueryClientProvider>,
  );
}

const config = {
  "GET /config": () => ({ path: "/config/config.yml", libraries: [{ name: "Movies", plex_name: "Movies" }], playlist_files: [] }),
};

describe("Collections All tab", () => {
  const othersFixture = (): OtherCollection[] => [
    other({ title: "Kometa Chart", made_by: "kometa", rating_key: "201", items: 10, smart: true }),
    other({ title: "Leaving Soon", made_by: "maintainerr", rating_key: "202", items: 8 }),
    other({ title: "Handmade", made_by: "plex", rating_key: "203", items: 2 }),
    other({ title: "Franchise Picks", made_by: "ready_made", category: "franchise", rating_key: null, items: 4 }),
  ];

  it("shows Studio and other tiles with Made-by chips and filters", async () => {
    mockApi({
      ...config,
      "GET /collections?library=Movies": () => ({
        collections: [collection({ id: 1, title: "Studio One", state: "in_plex", plex_items: 3 })],
      }),
      "GET /libraries/Movies/other-collections": () => ({ others: othersFixture(), plex_error: null }),
    });
    renderCollections("/collections?library=Movies");

    expect(await screen.findByRole("listitem", { name: "Studio One" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "Kometa Chart" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "Leaving Soon" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "Handmade" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "Franchise Picks" })).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "All (5)" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: "Studio (1)" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ready-made (1)" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Kometa files (1)" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Maintainerr (1)" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Made in Plex (1)" })).toBeInTheDocument();

    expect(within(screen.getByRole("listitem", { name: "Kometa Chart" })).getByText("Kometa file")).toBeInTheDocument();
    expect(within(screen.getByRole("listitem", { name: "Kometa Chart" })).getByText("Smart")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Kometa files (1)" }));
    expect(screen.getByRole("link", { name: "Kometa files (1)" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("listitem", { name: "Kometa Chart" })).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: "Studio One" })).not.toBeInTheDocument();
  });

  it("reads ?by=kometa from the URL", async () => {
    mockApi({
      ...config,
      "GET /collections?library=Movies": () => ({ collections: [] }),
      "GET /libraries/Movies/other-collections": () => ({ others: othersFixture(), plex_error: null }),
    });
    renderCollections("/collections?library=Movies&by=kometa");
    expect(await screen.findByRole("link", { name: "Kometa files (1)" })).toHaveAttribute("aria-current", "true");
    expect(screen.queryByRole("group", { name: "Filter collections" })).not.toBeInTheDocument();
  });

  it("links Maintainerr and ready-made tiles without builder controls", async () => {
    mockApi({
      ...config,
      "GET /collections?library=Movies": () => ({ collections: [] }),
      "GET /libraries/Movies/other-collections": () => ({ others: othersFixture(), plex_error: null }),
    });
    renderCollections("/collections?library=Movies");

    const maintainerr = await screen.findByRole("listitem", { name: "Leaving Soon" });
    expect(within(maintainerr).getByRole("link")).toHaveAttribute("href", "/libraries/Movies/collections/202");
    expect(within(maintainerr).getByText(/protected/)).toBeInTheDocument();
    expect(within(maintainerr).queryByRole("button")).toBeNull();

    const picked = screen.getByRole("listitem", { name: "Franchise Picks" });
    expect(within(picked).getByRole("link")).toHaveAttribute("href", "/collections/ready-made/franchise?library=Movies");

    const kometa = screen.getByRole("listitem", { name: "Kometa Chart" });
    expect(within(kometa).getByRole("link", { name: "Move over" })).toHaveAttribute("href", "/setup/move-over");
  });

  it("shows the muted Plex line when plex_error is set", async () => {
    mockApi({
      ...config,
      "GET /collections?library=Movies": () => ({
        collections: [collection({ id: 1, title: "Studio One", state: "missing" })],
      }),
      "GET /libraries/Movies/other-collections": () => ({
        others: [other({ title: "Picked Genre", made_by: "ready_made", category: "genre", rating_key: null })],
        plex_error: "Plex can't be reached: timeout",
      }),
    });
    renderCollections("/collections?library=Movies");
    expect(await screen.findByText("Only Studio's collections are shown: Plex can't be reached: timeout")).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "Studio One" })).toBeInTheDocument();
  });

  it("shows the muted Plex line when the others request fails", async () => {
    mockApi({
      ...config,
      "GET /collections?library=Movies": () => ({
        collections: [collection({ id: 1, title: "Studio One", state: "missing" })],
      }),
      "GET /libraries/Movies/other-collections": () => new Response(JSON.stringify({ detail: "upstream down" }), { status: 502 }),
    });
    renderCollections("/collections?library=Movies");
    expect(await screen.findByText(/Only Studio's collections are shown:.*upstream down/)).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "Studio One" })).toBeInTheDocument();
  });

  it("hides other tiles when a status chip is active", async () => {
    mockApi({
      ...config,
      "GET /collections?library=Movies": () => ({
        collections: [
          collection({ id: 1, title: "In Plex", state: "in_plex", plex_items: 1 }),
          collection({ id: 2, title: "Missing", state: "missing" }),
        ],
      }),
      "GET /libraries/Movies/other-collections": () => ({ others: othersFixture(), plex_error: null }),
    });
    renderCollections("/collections?library=Movies&show=missing");
    expect(await screen.findByRole("listitem", { name: "Missing" })).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: "Kometa Chart" })).not.toBeInTheDocument();
  });
});
