import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { mockApi } from "../test-utils";
import { ReadyMadePicksProvider } from "../readyMadePicks";
import { ChangesBar, changesSummary } from "./ChangesBar";

function renderBar(changedIds: number[] = []) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockApi({
    "GET /collections?library=Movies": () => ({ collections: [] }),
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ReadyMadePicksProvider>
          <ChangesBar library="Movies" changedCollectionIds={changedIds} />
        </ReadyMadePicksProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("changesSummary", () => {
  it("counts both kinds with pluralisation", () => {
    expect(changesSummary(5, 1)).toBe("6 changes waiting · 5 ready-made picks, 1 edited collection");
    expect(changesSummary(0, 2)).toBe("2 changes waiting · 2 edited collections");
    expect(changesSummary(1, 0)).toBe("1 change waiting · 1 ready-made pick");
    expect(changesSummary(0, 0)).toBeNull();
  });
});

describe("ChangesBar", () => {
  it("hides until there is something waiting", () => {
    renderBar();
    expect(screen.queryByRole("region", { name: "Collection changes" })).toBeNull();
  });

  it("Discard clears local picks only", async () => {
    sessionStorage.setItem(
      "studio:ready-made-picks",
      JSON.stringify({ Movies: { add: [{ category: "imdb", block: "collections", key: "popular" }], remove: [] } }),
    );
    renderBar([3]);
    expect(screen.getByText(/2 changes waiting · 1 ready-made pick, 1 edited collection/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.getByText(/1 change waiting · 1 edited collection/)).toBeInTheDocument());
  });

  it("Build all sends picks and changed row ids in one request", async () => {
    const calls = mockApi({
      "GET /collections?library=Movies": () => ({ collections: [{ id: 3, title: "Edited", changed: true }] }),
      "POST /libraries/Movies/build": () => ({ build: [], remove: [], blocked: [], run_id: null }),
    });
    sessionStorage.setItem(
      "studio:ready-made-picks",
      JSON.stringify({ Movies: { add: [{ category: "imdb", block: "collections", key: "popular" }], remove: [] } }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <ReadyMadePicksProvider>
            <ChangesBar library="Movies" changedCollectionIds={[3]} />
          </ReadyMadePicksProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText(/2 changes waiting · 1 ready-made pick, 1 edited collection/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Build all" }));
    await waitFor(() => expect(calls.some((c) => c.route === "POST /libraries/Movies/build")).toBe(true));
    const sent = calls.find((c) => c.route === "POST /libraries/Movies/build");
    expect(sent?.body).toEqual({
      ready_made: { add: [{ category: "imdb", block: "collections", key: "popular" }], remove: [] },
      collections: [3],
      dry_run: false,
      download_missing: false,
    });
  });
});
