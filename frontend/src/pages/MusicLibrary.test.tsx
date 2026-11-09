import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { render } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BuilderFields } from "../builderApi";
import { HeaderTitleProvider } from "../components/HeaderTitle";
import { mockApi, renderAt } from "../test-utils";
import { CollectionBuilder } from "./CollectionBuilder";
import { Collections } from "./Collections";

const musicLib = "My Music";
const encodedLib = "My%20Music";

const musicFields: BuilderFields = {
  library: musicLib,
  library_type: "artist",
  fields: [
    {
      key: "artist_genre",
      label: "Artist genre",
      kind: "tag",
      modifiers: [{ key: "", label: "is" }],
      group: "Tags",
      listable: true,
    },
    {
      key: "album_genre",
      label: "Album genre",
      kind: "tag",
      modifiers: [{ key: "", label: "is" }],
      group: "Tags",
      listable: true,
    },
  ],
  sorts: [{ key: "title.asc", label: "Title A–Z" }],
  levels: [
    { key: "artist", label: "Artists", sorts: [{ key: "title.asc", label: "Title A–Z" }] },
    {
      key: "album",
      label: "Albums",
      sorts: [
        { key: "album.title.asc", label: "Album title A–Z" },
        { key: "year.desc", label: "Year (newest)" },
      ],
    },
    {
      key: "track",
      label: "Tracks",
      sorts: [
        { key: "track.title.asc", label: "Track title A–Z" },
        { key: "album.title.asc", label: "Album title A–Z" },
      ],
    },
  ],
};

function musicConfig() {
  return {
    "GET /config": () => ({ path: "/config/config.yml", libraries: [{ name: musicLib, plex_name: musicLib }], playlist_files: [] }),
    "GET /config/setup": () => ({ plex: true, tmdb: true, library: true, done: true }),
    "GET /plex/libraries": () => ({
      libraries: [{ key: "9", title: musicLib, type: "artist", items: 412, collections: 2, managed: 1 }],
    }),
    [`GET /collections?library=${encodedLib}`]: () => ({ collections: [] }),
    [`GET /libraries/${encodedLib}/other-collections`]: () => ({ others: [], plex_error: null }),
    [`GET /builder/fields?library=${encodedLib}`]: () => musicFields,
    [`GET /builder/sources?library=${encodedLib}`]: () => ({ sources: [] }),
    [`GET /builder/values?library=${encodedLib}&field=artist_genre`]: () => ({ values: [{ key: "Rock", title: "Rock" }] }),
    "GET /requests/settings": () => ({
      settings: {
        enabled: false,
        via: "auto" as const,
        radarr: { quality_profile: null, root_folder: null, minimum_availability: "released" as const, search: true },
        sonarr: { quality_profile: null, root_folder: null, minimum_availability: "released" as const, search: true },
        cap: { daily: null },
        seerr: { search: true },
      },
      connected: { radarr: false, sonarr: false, seerr: false },
    }),
    "POST /builder/preview": () => ({
      count: 1,
      items: [{ rating_key: "55", title: "Abbey Road", year: 1969, thumb: null, artist: "The Beatles" }],
      problems: [],
    }),
    "POST /collections": () => ({
      id: 99,
      library: musicLib,
      title: "Rock picks",
      source: { kind: "filters" },
      filters: { match: "all", rules: [] },
      sort_by: null,
      level: "album",
      limit: null,
      visible: { library: true, home: false, shared: false },
      minimum_items: 1,
      summary: null,
      sort_title: null,
      poster: null,
      download_missing: false,
      request_cap: null,
      request_profile: null,
      state: "queued",
      plex_items: null,
      thumb: null,
      last_built_at: null,
      last_error: null,
      run_id: null,
      requests: { waiting: 0, requested: 0, downloading: 0, imported: 0, failed: 0 },
      last_change: null,
    }),
  };
}

function renderBuilder(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: "/collections", element: <Collections /> },
      { path: "/collections/new", element: <CollectionBuilder /> },
      { path: "/collections/:id", element: <CollectionBuilder /> },
    ],
    { initialEntries: [path] },
  );
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <HeaderTitleProvider>
          <RouterProvider router={router} />
        </HeaderTitleProvider>
      </QueryClientProvider>,
    ),
    router,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Music library UI", () => {
  it("Home header shows artist count", async () => {
    mockApi({
      ...musicConfig(),
      "GET /status": () => ({
        version: "0.1.0",
        kometa: { version: "2.5.3", config: "/config", updates: { installed: "2.5.3", pinned: "2.5.4", matches: false, checked_at: null, latest: null, notes: null, available: false } },
        database: { schema_version: 8 },
        health: [],
        runs: { current: null, queued: 0, next_scheduled: null },
      }),
      "GET /runs": () => ({ runs: [], current: null }),
      "GET /requests?limit=200": () => ({ requests: [], counts: { requested: 0, downloading: 0, imported: 0, failed: 0, cancelled: 0, exists: 0 } }),
      "GET /kometa/full-check": () => ({
        last: { ok: true, errors: [], warnings: [], existing_errors: [], checked_by_kometa: true, crashed: false, output: "", at: null },
      }),
    });
    renderAt(`/?library=${encodedLib}`);
    expect(await screen.findByRole("heading", { name: musicLib, level: 2 })).toBeInTheDocument();
    expect(screen.getByText(/412 artists/)).toBeInTheDocument();
  });

  it("Ready-made tab shows coming soon with a builder link", async () => {
    mockApi({
      ...musicConfig(),
      [`GET /ready-made/libraries/${encodedLib}`]: () => ({
        library: musicLib,
        library_type: "artist",
        counted_at: null,
        counting: false,
        categories: [],
      }),
    });
    renderAt(`/collections/ready-made?library=${encodedLib}`);
    const coming = await screen.findByRole("heading", { name: "Ready-made collections for music are coming soon" });
    const panel = coming.closest("div")!;
    expect(within(panel).getByText(/Until then, make your own in the builder/)).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "New collection" })).toHaveAttribute("href", `/collections/new?library=${encodedLib}`);
  });


  it("Collection builder: filters only, level choice, preview and save", async () => {
    const calls = mockApi(musicConfig());
    renderBuilder(`/collections/new?library=${encodedLib}`);

    expect(await screen.findByRole("heading", { name: "Collect", level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "How to start" })).toBeNull();
    expect(screen.getByRole("radio", { name: "Artists" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Albums" })).not.toBeChecked();
    expect(screen.getAllByRole("group", { name: "Filter rule" }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("radio", { name: "Albums" }));
    const sortStep = screen.getByRole("heading", { name: /2\. Order and size/ }).closest("section")!;
    fireEvent.click(within(sortStep).getByRole("button", { name: "Edit" }));
    const sortSelect = within(sortStep).getByLabelText("Sort");
    expect(within(sortSelect).getByRole("option", { name: "Album title A–Z" })).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await waitFor(() => expect(calls.some((c) => c.route === "POST /builder/preview")).toBe(true));
    const previewBody = calls.find((c) => c.route === "POST /builder/preview")?.body as { level?: string };
    expect(previewBody.level).toBe("album");

    const shelf = screen.getByRole("complementary", { name: "Shelf" });
    expect(within(shelf).getByText("The Beatles")).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: /Missing/ })).toBeNull();
    expect(screen.queryByText("Download missing")).toBeNull();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Rock picks" } });
    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    await waitFor(() => expect(calls.some((c) => c.route === "POST /collections")).toBe(true));
    const saveBody = calls.find((c) => c.route === "POST /collections")?.body as { level?: string; title?: string };
    expect(saveBody.title).toBe("Rock picks");
    expect(saveBody.level).toBe("album");
  });

  it("Collection builder: tracks level preview, tile subtitle, square art save and restore", async () => {
    const savedSquare = { kind: "url" as const, url: "https://example.com/square.webp" };
    const calls = mockApi({
      ...musicConfig(),
      "POST /builder/preview": (body) => {
        const level = (body as { level?: string }).level;
        if (level === "track") {
          return {
            count: 1,
            items: [{ rating_key: "77", title: "Paranoid Android", year: 1997, thumb: null, artist: "Radiohead", album: "OK Computer" }],
            problems: [],
          };
        }
        return { count: 0, items: [], problems: [] };
      },
      "GET /collections/42": () => ({
        id: 42,
        library: musicLib,
        title: "Favourites",
        source: { kind: "filters" },
        filters: { match: "all", rules: [] },
        sort_by: null,
        level: "track",
        limit: null,
        visible: { library: true, home: false, shared: false },
        minimum_items: 1,
        summary: null,
        sort_title: null,
        poster: null,
        square_art: savedSquare,
        download_missing: false,
        request_cap: null,
        request_profile: null,
        state: "in_plex",
        plex_items: 1,
        thumb: null,
        last_built_at: null,
        last_error: null,
        run_id: null,
        requests: { waiting: 0, requested: 0, downloading: 0, imported: 0, failed: 0 },
        last_change: null,
      }),
    });
    const { unmount: unmountNew } = renderBuilder(`/collections/new?library=${encodedLib}`);

    await screen.findByRole("heading", { name: "Collect" });
    fireEvent.click(screen.getByRole("radio", { name: "Tracks" }));
    expect(screen.getByRole("radio", { name: "Tracks" })).toBeChecked();

    const sortStep = screen.getByRole("heading", { name: /2\. Order and size/ }).closest("section")!;
    fireEvent.click(within(sortStep).getByRole("button", { name: "Edit" }));
    const sortSelect = within(sortStep).getByLabelText("Sort");
    expect(within(sortSelect).getByRole("option", { name: "Track title A–Z" })).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await waitFor(() => expect(calls.filter((c) => c.route === "POST /builder/preview" && (c.body as { level?: string }).level === "track").length).toBeGreaterThan(0));

    const shelf = screen.getByRole("complementary", { name: "Shelf" });
    expect(within(shelf).getByText("Radiohead · OK Computer")).toBeInTheDocument();

    const looksStep = screen.getByRole("heading", { name: /3\. How it looks/ }).closest("section")!;
    fireEvent.click(within(looksStep).getByRole("button", { name: "Edit" }));
    const squareRoot = screen.getByRole("heading", { name: "Square art", level: 3 }).parentElement!.parentElement as HTMLElement;
    fireEvent.click(within(squareRoot).getByRole("radio", { name: "Image link" }));
    fireEvent.change(screen.getByLabelText("Square art URL"), { target: { value: "https://example.com/new-square.png" } });

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Track picks" } });
    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    await waitFor(() => expect(calls.some((c) => c.route === "POST /collections")).toBe(true));
    const saveBody = calls.find((c) => c.route === "POST /collections")?.body as { level?: string; square_art?: { url?: string } };
    expect(saveBody.level).toBe("track");
    expect(saveBody.square_art).toEqual({ kind: "url", url: "https://example.com/new-square.png" });

    unmountNew();
    renderBuilder(`/collections/42?library=${encodedLib}`);
    await screen.findByDisplayValue("Favourites");
    fireEvent.click(within(screen.getByRole("heading", { name: /3\. How it looks/ }).closest("section")!).getByRole("button", { name: "Edit" }));
    expect(screen.getByDisplayValue("https://example.com/square.webp")).toBeInTheDocument();
  });
});
