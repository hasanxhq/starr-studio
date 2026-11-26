import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockApi } from "../../../../test-utils";
import { StyleEditor } from "../StyleEditor";

vi.mock("../../../../components/YamlEditor", () => ({
  default: ({ value, onChange, label, readOnly }: { value: string; onChange: (text: string) => void; label: string; readOnly?: boolean }) => (
    <textarea aria-label={label} value={value} readOnly={readOnly} onChange={(event) => onChange(event.target.value)} />
  ),
}));

const YAML =
  "studio_style: 1\nname: Mine\nelements:\n  - { id: a, type: rect, box: { left: 100, top: 100, width: 100, height: 100 } }\n  - { id: b, type: rect, box: { left: 300, top: 100, width: 100, height: 100 } }\n";
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1500"><image href="studio-poster:"/><g data-path="elements.0"><rect/></g><g data-path="elements.1"><rect/></g></svg>';

function routes(shipped = false) {
  return {
    "GET /config": () => ({ path: "/config/config.yml", libraries: [{ name: "Movies", plex_name: "Movies" }], playlist_files: [] }),
    "GET /overlay-engine/styles/mine": () => ({ id: "mine", shipped, name: "Mine", description: "", options: {}, error: null, yaml: YAML }),
    "GET /overlay-engine/libraries/Movies/samples?count=12": () => ({ items: [{ rating_key: "1", title: "Heat", year: 1995, thumb: "/library/metadata/1/thumb/5", traits: [] }] }),
    "GET /overlay-engine/libraries/Movies/style": () => ({ style: "modern-streaming", values: {}, saved: false }),
    "POST /overlay-engine/scene": () => ({
      items: [{ rating_key: "1", title: "Heat", year: 1995, thumb: "/library/metadata/1/thumb/5", svg: SVG, boxes: { "elements.0": [100, 100, 100, 100], "elements.1": [300, 100, 100, 100] } }],
    }),
    "POST /overlay-engine/preview": () => new Response(new Blob(["jpeg"])),
    "GET /overlay-engine/style-schema": () => ({ type: "object" }),
  };
}

async function open(shipped = false) {
  mockApi(routes(shipped));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: "/overlays/editor/:styleId", element: <StyleEditor /> }], { initialEntries: ["/overlays/editor/mine?library=Movies"] });
  const { container } = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(container.querySelector('g[data-path="elements.1"]')).not.toBeNull());
  const g = (n: number) => container.querySelector(`g[data-path="elements.${n}"] rect`) as Element;
  const frame = screen.getByRole("group", { name: "Poster canvas" });
  const file = () => (screen.getByLabelText("Style file mine") as HTMLTextAreaElement).value;
  const selected = () => [...container.querySelectorAll("[data-box]")].map((n) => n.getAttribute("data-box"));
  return { container, g, frame, file, selected };
}

beforeEach(() => {
  // jsdom has no PointerEvent (a MouseEvent carries the coordinates and modifier keys), no object URLs and no layout
  vi.stubGlobal("PointerEvent", class extends MouseEvent { pointerId: number; constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; } });
  URL.createObjectURL = vi.fn(() => "blob:exact");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 500, height: 750, left: 0, top: 0, right: 500, bottom: 750, x: 0, y: 0, toJSON: () => ({}) });
});
afterEach(() => vi.unstubAllGlobals());

describe("Canvas", () => {
  it("selects with a click, adds with Shift, and clears with Escape or a click on the poster", async () => {
    const { g, frame, selected, container } = await open();
    fireEvent.pointerDown(g(0));
    expect(selected()).toEqual(["elements.0"]);
    fireEvent.pointerDown(g(1), { shiftKey: true });
    expect(selected()).toEqual(["elements.0", "elements.1"]);
    fireEvent.pointerDown(g(0), { shiftKey: true });
    expect(selected()).toEqual(["elements.1"]);
    fireEvent.keyDown(frame, { key: "Escape" });
    expect(selected()).toEqual([]);
    fireEvent.pointerDown(g(0));
    fireEvent.pointerDown(container.querySelector("image") as Element);
    expect(selected()).toEqual([]);
  });

  it("nudges by 1 and by 10, a run of nudges being one undo step", async () => {
    const { g, frame, file } = await open();
    fireEvent.pointerDown(g(0));
    fireEvent.keyDown(frame, { key: "ArrowRight" });
    fireEvent.keyDown(frame, { key: "ArrowRight" });
    expect(file()).toContain("left: 102");
    fireEvent.keyDown(frame, { key: "ArrowDown", shiftKey: true });
    expect(file()).toContain("top: 110");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(file()).toBe(YAML); // all three nudges of the same selection: one step
  });

  it("deletes the selection", async () => {
    const { g, frame, file, selected } = await open();
    fireEvent.pointerDown(g(1));
    fireEvent.keyDown(frame, { key: "Delete" });
    expect(file()).not.toContain("id: b");
    expect(file()).toContain("id: a");
    expect(selected()).toEqual([]);
  });

  it("aligns two elements in one undo step", async () => {
    const { g, file } = await open();
    expect(screen.queryByRole("toolbar", { name: "Align" })).toBeNull();
    fireEvent.pointerDown(g(0));
    fireEvent.pointerDown(g(1), { shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Align centre" })); // bounds 100–400, centre 250
    expect(file()).toContain("left: 200, top: 100");
    expect(file().match(/left: 200/g)).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Distribute horizontally" })).toBeNull(); // needs three
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(file()).toBe(YAML);
  });

  it("drags: one edit for the drop, the box moved by the distance × 2 units", async () => {
    const { g, frame, file, container } = await open();
    fireEvent.pointerDown(g(0), { clientX: 50, clientY: 50, button: 0 });
    fireEvent.pointerMove(frame, { clientX: 52, clientY: 50 }); // under 3 px: still a click
    expect(file()).toBe(YAML);
    fireEvent.pointerMove(frame, { clientX: 60, clientY: 50 });
    expect(file()).toBe(YAML); // nothing is edited while dragging
    fireEvent.pointerUp(frame, { clientX: 60, clientY: 50 });
    expect(file()).toContain("left: 120, top: 100"); // 10 px × 2
    expect((container.querySelector('g[data-path="elements.0"]') as SVGGElement).style.transform).toBe("translate(20px, 0px)"); // stays put for the next scene
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(file()).toBe(YAML);
  });

  it("resizes from a handle", async () => {
    const { g, frame, file, container } = await open();
    fireEvent.pointerDown(g(0));
    const handle = container.querySelector('[data-handle="se"]') as Element;
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(frame, { clientX: 110, clientY: 100 });
    fireEvent.pointerUp(frame, { clientX: 110, clientY: 100 });
    expect(file()).toContain("width: 120, height: 100");
  });

  it("shows the exact render once things settle, and Draft again after a change", async () => {
    const { g, frame } = await open();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    await screen.findByText("Exact");
    fireEvent.pointerDown(g(0));
    fireEvent.keyDown(frame, { key: "ArrowRight" });
    expect(screen.getByText("Draft")).toBeInTheDocument();
    await screen.findByText("Exact");
  });

  it("is look-only for a shipped style", async () => {
    const { g, frame, file, selected } = await open(true);
    fireEvent.pointerDown(g(0));
    expect(selected()).toEqual(["elements.0"]);
    fireEvent.keyDown(frame, { key: "ArrowRight" });
    fireEvent.keyDown(frame, { key: "Delete" });
    expect(file()).toBe(YAML);
    expect(selected()).toEqual(["elements.0"]);
  });
});
