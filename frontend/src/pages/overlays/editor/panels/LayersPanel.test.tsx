import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { mockApi } from "../../../../test-utils";
import { StyleEditor } from "../StyleEditor";

vi.mock("../../../../components/YamlEditor", () => ({
  default: ({ value, onChange, label }: { value: string; onChange: (text: string) => void; label: string }) => (
    <textarea aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

const YAML = `studio_style: 1
name: Mine
elements:
  - { id: back, type: rect, box: { left: 0, top: 0, width: 100, height: 100 } }
  - id: row1
    type: row
    box: { left: 0, top: 0 }
    children:
      - { type: text, text: A, size: 20 }
      - { type: text, text: B, size: 20, show_when: { has: missing_fact } }
      - { type: text, text: C, size: 20 }
  - { id: solo, type: text, text: Solo, size: 30, box: { left: 0, top: 0 } }
`;

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1500"><image href="studio-poster:"/><g data-path="elements.0"/><g data-path="elements.1"/><g data-path="elements.1.children.0"/><g data-path="elements.2"/></svg>';

function routes() {
  return {
    "GET /config": () => ({ path: "/config/config.yml", libraries: [{ name: "Movies", plex_name: "Movies" }], playlist_files: [] }),
    "GET /overlay-engine/styles/mine": () => ({ id: "mine", shipped: false, name: "Mine", description: "", options: {}, error: null, yaml: YAML }),
    "PUT /overlay-engine/styles/mine": (body: unknown) => ({ id: "mine", shipped: false, name: "Mine", description: "", options: {}, error: null, yaml: (body as { yaml: string }).yaml }),
    "GET /overlay-engine/libraries/Movies/samples?count=12": () => ({ items: [{ rating_key: "1", title: "Heat", year: 1995, thumb: "/library/metadata/1/thumb/5", traits: [] }] }),
    "GET /overlay-engine/libraries/Movies/style": () => ({ style: "modern-streaming", values: {}, saved: false }),
    "POST /overlay-engine/scene": () => ({
      items: [
        {
          rating_key: "1",
          title: "Heat",
          svg: SVG,
          boxes: { "elements.0": [0, 0, 100, 100], "elements.1": [0, 0, 10, 10], "elements.1.children.0": [0, 0, 5, 5], "elements.2": [0, 0, 5, 5] }, // children.1 hidden
        },
      ],
    }),
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

describe("LayersPanel", () => {
  it("shows nested labels, selection, reorder, delete, add and hidden state", async () => {
    mockApi(routes());
    renderEditor();
    await waitFor(() => expect(screen.getByRole("tree")).toBeInTheDocument());

    const tree = screen.getByRole("tree");
    expect(within(tree).getByText("back")).toBeInTheDocument();
    expect(within(tree).getByText("row1")).toBeInTheDocument();
    expect(within(tree).getByText("A")).toBeInTheDocument();

    const hidden = within(tree).getByText("B").closest("button")!;
    expect(within(hidden).getByText("hidden on this title")).toBeInTheDocument();

    fireEvent.click(screen.getByText("back"));
    expect(screen.getByText("back").closest('[aria-selected="true"]')).not.toBeNull();

    fireEvent.click(screen.getByText("solo"), { shiftKey: true });
    expect(screen.getAllByRole("treeitem", { selected: true })).toHaveLength(2);

    fireEvent.click(screen.getByText("row1"));
    fireEvent.click(screen.getByRole("button", { name: "Move up" }));
    await waitFor(() => expect((screen.getByLabelText("Style file mine") as HTMLTextAreaElement).value).toMatch(/id: solo[\s\S]*id: row1/));

    fireEvent.click(within(tree).getByText("C"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(within(tree).getByText("B"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(within(tree).getByText("A"));
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();

    fireEvent.click(screen.getByText("row1"));
    fireEvent.change(screen.getByLabelText("Add element"), { target: { value: "text" } });
    const yaml = () => (screen.getByLabelText("Style file mine") as HTMLTextAreaElement).value;
    await waitFor(() => expect(yaml()).toMatch(/children:[\s\S]*text: Text/));
    expect(yaml()).not.toMatch(/children:[\s\S]*left: 40/);

    fireEvent.click(screen.getByText("back"));
    fireEvent.change(screen.getByLabelText("Add element"), { target: { value: "text" } });
    await waitFor(() => expect(yaml()).toMatch(/elements:\s*\n[\s\S]*left: 40[\s\S]*top: 40/));
  });
});