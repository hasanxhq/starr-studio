import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BuilderFields, CollectionInput } from "../builderApi";
import { HeaderTitleProvider } from "../components/HeaderTitle";
import { mockApi } from "../test-utils";
import { CollectionBuilder } from "./CollectionBuilder";
import { draftStorageKey } from "./builder/draft";

const fields: BuilderFields = { library: "Movies", library_type: "movie", fields: [], sorts: [] };

function renderBuilder(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: "/collections/new", element: <CollectionBuilder /> }], { initialEntries: [path] });
  return render(
    <QueryClientProvider client={queryClient}>
      <HeaderTitleProvider>
        <RouterProvider router={router} />
      </HeaderTitleProvider>
    </QueryClientProvider>,
  );
}

const routes = {
  "GET /config": () => ({ path: "/config/config.yml", libraries: [{ name: "Movies", plex_name: "Movies" }], playlist_files: [] }),
  "GET /builder/fields?library=Movies": () => fields,
  "GET /builder/sources?library=Movies": () => ({ sources: [] }),
  "POST /builder/preview": () => ({ count: 0, items: [], problems: [] }),
  "GET /collections?library=Movies": () => ({ collections: [] }),
};

afterEach(() => {
  vi.useRealTimers();
});

describe("CollectionBuilder draft", () => {
  it("autosaves, offers restore, and clears on discard or save", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockApi({
      ...routes,
      "POST /collections": (body) => ({ ...(body as CollectionInput), id: 1, state: "queued", plex_items: null, thumb: null, last_built_at: null, last_error: null, run_id: 1, requests: { waiting: 0, requested: 0, downloading: 0, imported: 0, failed: 0 }, last_change: null }),
    });
    const key = draftStorageKey("Movies", null);
    const first = renderBuilder("/collections/new?library=Movies");
    fireEvent.click(await screen.findByRole("radio", { name: "Organise what I have" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Drafty" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(localStorage.getItem(key)).toContain("Drafty");
    first.unmount();
    cleanup();

    renderBuilder("/collections/new?library=Movies");
    expect(await screen.findByText("Restore your unsaved draft?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    fireEvent.click(screen.getByRole("radio", { name: "Organise what I have" }));
    expect(screen.getByLabelText("Title")).toHaveValue("Drafty");

    cleanup();
    renderBuilder("/collections/new?library=Movies");
    await screen.findByText("Restore your unsaved draft?");
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    fireEvent.click(screen.getByRole("radio", { name: "Organise what I have" }));
    expect(localStorage.getItem(key)).toBeNull();

    vi.useRealTimers();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Built" } });
    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
  });

  it("survives throwing localStorage", async () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    mockApi(routes);
    renderBuilder("/collections/new?library=Movies");
    fireEvent.click(await screen.findByRole("radio", { name: "Organise what I have" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Still works" } });
    expect(screen.getByLabelText("Title")).toHaveValue("Still works");
    get.mockRestore();
    set.mockRestore();
  });
});

describe("CollectionBuilder build bar", () => {
  it("Cancel links back to Collections", async () => {
    mockApi(routes);
    renderBuilder("/collections/new?library=Movies");
    fireEvent.click(await screen.findByRole("radio", { name: "Organise what I have" }));
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/collections?library=Movies");
  });

  it("Save for later sends build false and Build does not", async () => {
    const calls = mockApi({
      ...routes,
      "POST /collections": (body) => ({ ...(body as CollectionInput), id: 2, state: "queued", plex_items: null, thumb: null, last_built_at: null, last_error: null, run_id: 2, requests: { waiting: 0, requested: 0, downloading: 0, imported: 0, failed: 0 }, last_change: null }),
    });
    renderBuilder("/collections/new?library=Movies");
    fireEvent.click(await screen.findByRole("radio", { name: "Organise what I have" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Later" } });
    fireEvent.click(screen.getByRole("button", { name: "Save for later" }));
    await waitFor(() => expect(calls.some((c) => c.route === "POST /collections")).toBe(true));
    expect((calls.find((c) => c.route === "POST /collections")!.body as { build?: boolean }).build).toBe(false);

    renderBuilder("/collections/new?library=Movies");
    fireEvent.click(await screen.findByRole("radio", { name: "Organise what I have" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Now" } });
    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    await waitFor(() => expect(calls.filter((c) => c.route === "POST /collections").length).toBe(2));
    expect((calls.filter((c) => c.route === "POST /collections").at(-1)!.body as { build?: boolean }).build).toBeUndefined();
  });
});
