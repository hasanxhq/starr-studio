import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { mockApi } from "../../../test-utils";
import { StyleEditor } from "./StyleEditor";

vi.mock("../../../components/YamlEditor", () => ({
  default: ({ value, onChange, label, readOnly }: { value: string; onChange: (text: string) => void; label: string; readOnly?: boolean }) => (
    <textarea aria-label={label} value={value} readOnly={readOnly} onChange={(event) => onChange(event.target.value)} />
  ),
}));

const YAML = "studio_style: 1\nname: Mine\nelements:\n  - { id: dot, type: rect, box: { left: 0, top: 0, width: 10, height: 10 } }\n";
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1500"><image href="studio-poster:"/><g data-path="elements.0"><rect/></g></svg>';

function routes(shipped = false) {
  return {
    "GET /config": () => ({ path: "/config/config.yml", libraries: [{ name: "Movies", plex_name: "Movies" }], playlist_files: [] }),
    "GET /overlay-engine/styles/mine": () => ({ id: "mine", shipped, name: "Mine", description: "", options: {}, error: null, yaml: YAML }),
    "PUT /overlay-engine/styles/mine": (body: unknown) => ({ id: "mine", shipped, name: "Mine", description: "", options: {}, error: null, yaml: (body as { yaml: string }).yaml }),
    "GET /overlay-engine/libraries/Movies/samples?count=12": () => ({ items: [{ rating_key: "1", title: "Heat", year: 1995, thumb: "/library/metadata/1/thumb/5", traits: [] }] }),
    "GET /overlay-engine/libraries/Movies/style": () => ({ style: "modern-streaming", values: {}, saved: false }),
    "POST /overlay-engine/scene": () => ({ items: [{ rating_key: "1", title: "Heat", year: 1995, thumb: "/library/metadata/1/thumb/5", svg: SVG, boxes: { "elements.0": [0, 0, 10, 10] } }] }),
    "GET /overlay-engine/style-schema": () => ({ type: "object" }),
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

describe("StyleEditor", () => {
  it("shows the scene with the poster, edits through the file, undoes and saves", async () => {
    const calls = mockApi(routes());
    const { container } = renderEditor();
    await waitFor(() => expect(container.querySelector('g[data-path="elements.0"]')).not.toBeNull());
    expect(container.querySelector("image")?.getAttribute("href")).toContain("thumb%2F5");
    const sceneCall = calls.find((c) => c.route === "POST /overlay-engine/scene");
    expect(sceneCall?.body).toMatchObject({ library: "Movies", rating_keys: ["1"], yaml: YAML });

    const save = screen.getByRole("button", { name: "Saved" });
    expect(save).toBeDisabled();
    const file = screen.getByLabelText("Style file mine");
    fireEvent.change(file, { target: { value: YAML.replace("name: Mine", "name: Mine 2") } });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((c) => c.route === "PUT /overlay-engine/styles/mine")).toBe(true));
    await screen.findByRole("button", { name: "Saved" });
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled(); // saving keeps the history
    expect((screen.getByLabelText("Style file mine") as HTMLTextAreaElement).value).toContain("name: Mine 2");
  });

  it("is read-only for a shipped style", async () => {
    mockApi(routes(true));
    renderEditor();
    await screen.findByText(/duplicate it on the Overlays page/);
    expect(screen.queryByRole("button", { name: /Save/ })).toBeNull();
  });
});
