import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GalleryPoster, OutcomeList } from "../../../overlayEngineApi";
import { mockApi } from "../../../test-utils";
import { PosterGallery } from "./PosterGallery";

const library = "Movies";

const noStudio: GalleryPoster = {
  rating_key: "100",
  title: "Moonlight",
  year: 2016,
  thumb: "/library/metadata/100/thumb/1",
  studio_poster: false,
  style: null,
  applied_at: null,
  restored_at: null,
};

const withStudio: GalleryPoster = {
  rating_key: "200",
  title: "Slumdog Millionaire",
  year: 2008,
  thumb: "/library/metadata/200/thumb/2",
  studio_poster: true,
  style: "modern-streaming",
  applied_at: 1,
  restored_at: null,
};

function renderGallery() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PosterGallery library={library} />
    </QueryClientProvider>,
  );
}

function postersPage(items: GalleryPoster[], start = 0, total = items.length) {
  return { items, start, total };
}

describe("PosterGallery", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:preview"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders tiles with the Studio poster tag", async () => {
    mockApi({
      [`GET /overlay-engine/libraries/${encodeURIComponent(library)}/posters?start=0&size=48`]: () => postersPage([noStudio, withStudio], 0, 2),
    });
    renderGallery();
    await screen.findByText("Moonlight");
    expect(screen.getByText("Slumdog Millionaire")).toBeInTheDocument();
    expect(screen.getByText(/Studio poster · modern-streaming/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Repair" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
  });

  it("sends q on debounced search", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const routes: Record<string, () => unknown> = {
      [`GET /overlay-engine/libraries/${encodeURIComponent(library)}/posters?start=0&size=48`]: () => postersPage([noStudio], 0, 1),
      [`GET /overlay-engine/libraries/${encodeURIComponent(library)}/posters?start=0&size=48&q=moon`]: () => postersPage([noStudio], 0, 1),
    };
    mockApi(routes);
    renderGallery();
    await screen.findByText("Moonlight");
    fireEvent.change(screen.getByPlaceholderText("Search…"), { target: { value: "moon" } });
    await vi.advanceTimersByTimeAsync(500);
    await waitFor(() => expect(screen.getByText("Moonlight")).toBeInTheDocument());
    vi.useRealTimers();
  });

  it("appends the next page on Load more", async () => {
    const page2: GalleryPoster = { ...noStudio, rating_key: "300", title: "Arrival", year: 2016 };
    mockApi({
      [`GET /overlay-engine/libraries/${encodeURIComponent(library)}/posters?start=0&size=48`]: () => postersPage([noStudio], 0, 2),
      [`GET /overlay-engine/libraries/${encodeURIComponent(library)}/posters?start=1&size=48`]: () => postersPage([page2], 1, 2),
    });
    renderGallery();
    await screen.findByText("Moonlight");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("Arrival");
    expect(screen.getByText("Moonlight")).toBeInTheDocument();
  });

  it("Apply dry-runs, shows confirm, then applies with dry_run false", async () => {
    const drawDry: OutcomeList = {
      dry_run: true,
      outcomes: [{ rating_key: "100", title: "Moonlight", kind: "draw", message: "Would draw a new Studio poster.", done: false }],
    };
    const drawReal: OutcomeList = {
      dry_run: false,
      outcomes: [{ rating_key: "100", title: "Moonlight", kind: "draw", message: "Drew a new Studio poster.", done: true }],
    };
    const calls = mockApi({
      [`GET /overlay-engine/libraries/${encodeURIComponent(library)}/posters?start=0&size=48`]: () => postersPage([noStudio], 0, 1),
      "POST /overlay-engine/apply": (body) => {
        const b = body as { dry_run?: boolean };
        return b.dry_run === false ? drawReal : drawDry;
      },
    });
    renderGallery();
    const tile = await screen.findByRole("listitem", { name: "Moonlight" });
    fireEvent.click(within(tile).getByRole("button", { name: "Apply" }));
    const applyDialog = await screen.findByRole("dialog");
    expect(screen.getByText("Would draw a new Studio poster.")).toBeInTheDocument();
    fireEvent.click(within(applyDialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Drew a new Studio poster."));
    const applyCalls = calls.filter((c) => c.route === "POST /overlay-engine/apply");
    expect(applyCalls).toHaveLength(2);
    expect(applyCalls[0]!.body).toMatchObject({ library, rating_keys: ["100"] });
    expect(applyCalls[0]!.body).not.toHaveProperty("dry_run", false);
    expect(applyCalls[1]!.body).toMatchObject({ library, rating_keys: ["100"], dry_run: false });
  });

  it("does not offer confirm when the dry run is skip", async () => {
    const skipDry: OutcomeList = {
      dry_run: true,
      outcomes: [{ rating_key: "100", title: "Moonlight", kind: "skip", message: "Already up to date.", done: false }],
    };
    mockApi({
      [`GET /overlay-engine/libraries/${encodeURIComponent(library)}/posters?start=0&size=48`]: () => postersPage([noStudio], 0, 1),
      "POST /overlay-engine/apply": () => skipDry,
    });
    renderGallery();
    const tile = await screen.findByRole("listitem", { name: "Moonlight" });
    fireEvent.click(within(tile).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(within(tile).getByRole("status")).toHaveTextContent("Already up to date."));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the server's refusal when the dry run fails", async () => {
    mockApi({
      [`GET /overlay-engine/libraries/${encodeURIComponent(library)}/posters?start=0&size=48`]: () => postersPage([noStudio], 0, 1),
      "POST /overlay-engine/apply": () => new Response(JSON.stringify({ detail: "Can't apply overlays while Maintainerr's collections can't be read" }), { status: 503 }),
    });
    renderGallery();
    const tile = await screen.findByRole("listitem", { name: "Moonlight" });
    fireEvent.click(within(tile).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(within(tile).getByRole("alert")).toHaveTextContent("Maintainerr"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Repair sends force true", async () => {
    const redrawDry: OutcomeList = {
      dry_run: true,
      outcomes: [{ rating_key: "200", title: "Slumdog Millionaire", kind: "redraw", message: "Would redraw.", done: false }],
    };
    const calls = mockApi({
      [`GET /overlay-engine/libraries/${encodeURIComponent(library)}/posters?start=0&size=48`]: () => postersPage([withStudio], 0, 1),
      "POST /overlay-engine/apply": () => redrawDry,
    });
    renderGallery();
    const tile = await screen.findByRole("listitem", { name: "Slumdog Millionaire" });
    fireEvent.click(within(tile).getByRole("button", { name: "Repair" }));
    await screen.findByRole("dialog");
    const applyCalls = calls.filter((c) => c.route === "POST /overlay-engine/apply");
    expect(applyCalls[0]!.body).toMatchObject({ force: true });
  });

  it("Restore dry-runs then restores", async () => {
    const restoreDry: OutcomeList = {
      dry_run: true,
      outcomes: [{ rating_key: "200", title: "Slumdog Millionaire", kind: "restore", message: "Would restore the original.", done: false }],
    };
    const restoreReal: OutcomeList = {
      dry_run: false,
      outcomes: [{ rating_key: "200", title: "Slumdog Millionaire", kind: "restore", message: "Restored the original.", done: true }],
    };
    const calls = mockApi({
      [`GET /overlay-engine/libraries/${encodeURIComponent(library)}/posters?start=0&size=48`]: () => postersPage([withStudio], 0, 1),
      "POST /overlay-engine/restore": (body) => {
        const b = body as { dry_run: boolean };
        return b.dry_run ? restoreDry : restoreReal;
      },
    });
    renderGallery();
    const tile = await screen.findByRole("listitem", { name: "Slumdog Millionaire" });
    fireEvent.click(within(tile).getByRole("button", { name: "Restore" }));
    const restoreDialog = await screen.findByRole("dialog");
    fireEvent.click(within(restoreDialog).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(within(tile).getByRole("status")).toHaveTextContent("Restored the original."));
    const restoreCalls = calls.filter((c) => c.route === "POST /overlay-engine/restore");
    expect(restoreCalls).toHaveLength(2);
    expect(restoreCalls[0]!.body).toMatchObject({ dry_run: true, rating_keys: ["200"] });
    expect(restoreCalls[1]!.body).toMatchObject({ dry_run: false, rating_keys: ["200"] });
  });

  it("opens preview and shows an error when preview fails", async () => {
    mockApi({
      [`GET /overlay-engine/libraries/${encodeURIComponent(library)}/posters?start=0&size=48`]: () => postersPage([noStudio], 0, 1),
      "POST /overlay-engine/preview": () => new Response(JSON.stringify({ detail: "No facts for this title." }), { status: 422 }),
    });
    renderGallery();
    const tile = await screen.findByRole("listitem", { name: "Moonlight" });
    fireEvent.click(within(tile).getByRole("button", { name: "Moonlight" }));
    await screen.findByRole("dialog");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("No facts for this title."));
  });
});