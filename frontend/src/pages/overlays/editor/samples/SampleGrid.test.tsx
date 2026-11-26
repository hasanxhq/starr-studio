import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { overlayEngine, type GalleryPoster, type Sample, type SceneItem } from "../../../../overlayEngineApi";
import { mockApi } from "../../../../test-utils";
import { StyleEditor } from "../StyleEditor";

vi.mock("../../../../components/YamlEditor", () => ({
  default: ({ value, onChange, label, readOnly }: { value: string; onChange: (text: string) => void; label: string; readOnly?: boolean }) => (
    <textarea aria-label={label} value={value} readOnly={readOnly} onChange={(event) => onChange(event.target.value)} />
  ),
}));

const YAML = "studio_style: 1\nname: Mine\nelements:\n  - { id: dot, type: rect, box: { left: 0, top: 0, width: 10, height: 10 } }\n";

const makeSvg = (label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1500"><image href="studio-poster:"/><g data-path="elements.0" data-title="${label}"><rect/></g></svg>`;

const SAMPLES: Sample[] = [
  {
    rating_key: "1",
    title: "Heat",
    year: 1995,
    thumb: "/library/metadata/1/thumb/5",
    traits: ["resolution:4K", "hdr:yes", "imdb:yes", "rt:no", "new:no", "audio:atmos"],
  },
  {
    rating_key: "2",
    title: "Arrival",
    year: 2016,
    thumb: "/library/metadata/2/thumb/8",
    traits: ["resolution:1080P", "hdr:no", "imdb:no", "rt:yes", "new:yes", "audio:other"],
  },
  {
    rating_key: "3",
    title: "Oldboy",
    year: 2003,
    thumb: "/library/metadata/3/thumb/9",
    traits: ["resolution:lower", "hdr:no", "imdb:yes", "rt:yes", "new:no", "audio:other"],
  },
];

const SCENES: Record<string, SceneItem> = {
  "1": { rating_key: "1", title: "Heat", year: 1995, thumb: "/library/metadata/1/thumb/5", svg: makeSvg("Heat"), boxes: { "elements.0": [0, 0, 10, 10] } },
  "2": { rating_key: "2", title: "Arrival", year: 2016, thumb: "/library/metadata/2/thumb/8", svg: makeSvg("Arrival"), boxes: { "elements.0": [0, 0, 10, 10] } },
  "3": { rating_key: "3", title: "Oldboy", year: 2003, thumb: "/library/metadata/3/thumb/9", svg: makeSvg("Oldboy"), boxes: { "elements.0": [0, 0, 10, 10] } },
  "99": { rating_key: "99", title: "Alien", year: 1979, thumb: "/library/metadata/99/thumb/4", svg: makeSvg("Alien"), boxes: { "elements.0": [0, 0, 10, 10] } },
};

const ALIEN_POSTER: GalleryPoster = {
  rating_key: "99",
  title: "Alien",
  year: 1979,
  thumb: "/library/metadata/99/thumb/4",
  studio_poster: false,
  style: null,
  applied_at: null,
  restored_at: null,
};

function baseRoutes(overrides: Record<string, (body: unknown) => unknown> = {}) {
  return {
    "GET /config": () => ({ path: "/config/config.yml", libraries: [{ name: "Movies", plex_name: "Movies" }], playlist_files: [] }),
    "GET /overlay-engine/styles/mine": () => ({ id: "mine", shipped: false, name: "Mine", description: "", options: {}, error: null, yaml: YAML }),
    "GET /overlay-engine/libraries/Movies/samples?count=12": () => ({ items: SAMPLES }),
    "GET /overlay-engine/libraries/Movies/style": () => ({ style: "modern-streaming", values: {}, saved: false }),
    "POST /overlay-engine/scene": (body: unknown) => {
      const { rating_keys } = body as { rating_keys: string[] };
      return { items: rating_keys.map((key) => SCENES[key]) };
    },
    "GET /overlay-engine/style-schema": () => ({ type: "object" }),
    ...overrides,
  };
}

function renderEditor() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: "/overlays/editor/:styleId", element: <StyleEditor /> }], { initialEntries: ["/overlays/editor/mine?library=Movies"] });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("SampleGrid", () => {
  it("fetches one grid scene for all 3 samples, shows trait words, and switches the canvas via seeded cache", async () => {
    const calls = mockApi(baseRoutes());
    renderEditor();

    const canvas = await screen.findByRole("region", { name: "Canvas" });
    await waitFor(() => expect(canvas.querySelector('g[data-title="Heat"]')).not.toBeNull());

    const heatTile = await screen.findByRole("button", { name: /Heat/ });
    const arrivalTile = screen.getByRole("button", { name: /Arrival/ });
    const oldboyTile = screen.getByRole("button", { name: /Oldboy/ });

    expect(heatTile).toHaveAttribute("aria-pressed", "true");
    expect(arrivalTile).toHaveAttribute("aria-pressed", "false");
    expect(oldboyTile).toHaveAttribute("aria-pressed", "false");

    // Mapped trait words shown; omitted ones left out.
    expect(within(heatTile).getByText("4K")).toBeInTheDocument();
    expect(within(heatTile).getByText("HDR")).toBeInTheDocument();
    expect(within(heatTile).getByText("No RT")).toBeInTheDocument();
    expect(within(heatTile).getByText("Atmos")).toBeInTheDocument();
    expect(within(arrivalTile).getByText("1080p")).toBeInTheDocument();
    expect(within(arrivalTile).getByText("No IMDb")).toBeInTheDocument();
    expect(within(arrivalTile).getByText("New")).toBeInTheDocument();
    expect(within(oldboyTile).getByText("Below 1080p")).toBeInTheDocument();

    const sceneCalls = calls.filter((c) => c.route === "POST /overlay-engine/scene");
    expect(sceneCalls.some((c) => JSON.stringify((c.body as { rating_keys: string[] }).rating_keys) === JSON.stringify(["1", "2", "3"]))).toBe(true);
    const countBeforeClick = sceneCalls.length;

    // Clicking another tile switches the canvas from the seeded cache without another single-title scene request.
    fireEvent.click(arrivalTile);
    await waitFor(() => expect(canvas.querySelector('g[data-title="Arrival"]')).not.toBeNull());
    expect(arrivalTile).toHaveAttribute("aria-pressed", "true");
    expect(heatTile).toHaveAttribute("aria-pressed", "false");
    expect(calls.filter((c) => c.route === "POST /overlay-engine/scene")).toHaveLength(countBeforeClick);
  });

  it("shows an item error inside its selectable tile", async () => {
    mockApi(
      baseRoutes({
        "POST /overlay-engine/scene": (body: unknown) => {
          const { rating_keys } = body as { rating_keys: string[] };
          return {
            items: rating_keys.map((key) =>
              key === "2" ? { rating_key: "2", error: "Could not read Plex metadata." } : SCENES[key],
            ),
          };
        },
      }),
    );
    renderEditor();

    const arrivalTile = await screen.findByRole("button", { name: /Arrival/ });
    await waitFor(() => expect(within(arrivalTile).getByText("Could not read Plex metadata.")).toBeInTheDocument());

    fireEvent.click(arrivalTile);
    expect(arrivalTile).toHaveAttribute("aria-pressed", "true");
  });

  it("searches for any library title and puts it on the canvas", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = mockApi(
      baseRoutes({
        "GET /overlay-engine/libraries/Movies/posters?start=0&size=12&q=al": () => ({ items: [ALIEN_POSTER], start: 0, total: 1 }),
      }),
    );
    renderEditor();

    await screen.findByRole("button", { name: /Heat/ });
    const searchInput = screen.getByLabelText("Put another title on the canvas");

    // 1 character must not trigger a search.
    fireEvent.change(searchInput, { target: { value: "a" } });
    await vi.advanceTimersByTimeAsync(300);
    expect(calls.some((c) => c.route.includes("/posters"))).toBe(false);

    // 2+ characters triggers the debounced posters search.
    fireEvent.change(searchInput, { target: { value: "al" } });
    await vi.advanceTimersByTimeAsync(250);
    await waitFor(() =>
      expect(calls.map((c) => c.route)).toContain("GET /overlay-engine/libraries/Movies/posters?start=0&size=12&q=al"),
    );

    const resultButton = await screen.findByRole("button", { name: /Alien.*1979/ });
    fireEvent.click(resultButton);

    await screen.findByText("On the canvas: Alien");
    expect((searchInput as HTMLInputElement).value).toBe("");
    const canvas = screen.getByRole("region", { name: "Canvas" });
    await waitFor(() => expect(canvas.querySelector('g[data-title="Alien"]')).not.toBeNull());
    vi.useRealTimers();
  });

  it("shows loading, empty, and grid-error states", async () => {
    mockApi(
      baseRoutes({
        "GET /overlay-engine/libraries/Movies/samples?count=12": () => ({ items: [] }),
      }),
    );
    const { unmount } = renderEditor();
    await screen.findByText("No titles to show yet.");
    unmount();

    let rejectGrid: ((reason?: unknown) => void) | undefined;
    mockApi(baseRoutes());
    vi.spyOn(overlayEngine, "scene").mockImplementation((body) => {
      if (body.rating_keys.length > 1) {
        return new Promise((_, reject) => {
          rejectGrid = reject;
        });
      }
      return Promise.resolve({ items: [SCENES[body.rating_keys[0]]] });
    });
    renderEditor();
    await screen.findByText("Loading samples…");
    await waitFor(() => expect(rejectGrid).toBeTypeOf("function"));
    rejectGrid!(new Error("Grid render failed"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Grid render failed");
  });
});
