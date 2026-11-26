import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { mockApi } from "../../../../test-utils";
import { StyleEditor } from "../StyleEditor";

vi.mock("../../../../components/YamlEditor", () => ({
  default: ({ value, onChange, label, readOnly }: { value: string; onChange: (text: string) => void; label: string; readOnly?: boolean }) => (
    <textarea aria-label={label} value={value} readOnly={readOnly} onChange={(event) => onChange(event.target.value)} />
  ),
}));

const FIXED = `studio_style: 1
name: Mine
options:
  accent: { type: colour, default: "#E50914", label: Accent }
elements:
  - type: text
    id: title
    text: Hello
    size: 40
    colour: "#FFFFFF"
    font: Inter Bold
    box: { left: 10, top: 10 }
  - type: text
    id: accent
    text: NEW
    size: 40
    colour: $accent
    box: { left: 20, top: 20 }
  - type: text
    id: ruled
    text: X
    size: 30
    box: { left: 0, top: 0 }
    show_when: { has: [imdb, rt_critic] }
  - type: text
    id: complex
    text: Y
    size: 30
    box: { left: 0, top: 0 }
    show_when: { rt_critic: { min: 60 } }
`;

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1500"><g data-path="elements.0"/><g data-path="elements.1"/><g data-path="elements.2"/><g data-path="elements.3"/></svg>';

function routes(yaml: string, shipped = false) {
  return {
    "GET /config": () => ({ path: "/config/config.yml", libraries: [{ name: "Movies", plex_name: "Movies" }], playlist_files: [] }),
    "GET /overlay-engine/styles/mine": () => ({ id: "mine", shipped, name: "Mine", description: "", options: {}, error: null, yaml }),
    "PUT /overlay-engine/styles/mine": (body: unknown) => ({ id: "mine", shipped, name: "Mine", description: "", options: {}, error: null, yaml: (body as { yaml: string }).yaml }),
    "GET /overlay-engine/libraries/Movies/samples?count=12": () => ({ items: [{ rating_key: "1", title: "Heat", year: 1995, thumb: "/t", traits: [] }] }),
    "GET /overlay-engine/libraries/Movies/style": () => ({ style: "mine", values: {}, saved: false }),
    "POST /overlay-engine/scene": () => ({
      items: [{ rating_key: "1", title: "Heat", svg: SVG, boxes: { "elements.0": [0, 0, 10, 10], "elements.1": [0, 0, 10, 10], "elements.2": [0, 0, 10, 10], "elements.3": [0, 0, 10, 10] } }],
    }),
    "GET /overlay-engine/style-schema": () => ({ type: "object" }),
  };
}

function renderEditor(yaml = FIXED) {
  mockApi(routes(yaml));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: "/overlays/editor/:styleId", element: <StyleEditor /> }], { initialEntries: ["/overlays/editor/mine?library=Movies"] });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("Inspector", () => {
  it("edits text fields, merges undo, shadow, show_when, option unlink and read-only", async () => {
    renderEditor();
    await waitFor(() => screen.getByRole("button", { name: /title text/ }));
    fireEvent.click(screen.getByRole("button", { name: /title text/ }));

    const file = () => screen.getByLabelText("Style file mine") as HTMLTextAreaElement;

    fireEvent.change(screen.getByLabelText("Size"), { target: { value: "52" } });
    await waitFor(() => expect(file().value).toContain("size: 52"));

    fireEvent.change(screen.getByLabelText("Colour picker"), { target: { value: "#ff0000" } });
    await waitFor(() => expect(file().value).toMatch(/colour: ['"]#ff0000['"]/i));

    fireEvent.change(screen.getByLabelText("Font"), { target: { value: "Inter Medium" } });
    await waitFor(() => expect(file().value).toContain("font: Inter Medium"));

    const textField = screen.getByLabelText("Text");
    fireEvent.change(textField, { target: { value: "Hello!" } });
    expect(file().value).toContain("Hello!");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(file().value).toContain("text: Hello\n");

    const shadow = screen.getByLabelText("Shadow");
    fireEvent.click(shadow);
    await waitFor(() => expect(file().value).toContain("shadow:"));
    fireEvent.click(shadow);
    await waitFor(() => expect(file().value).not.toContain("shadow:"));

    fireEvent.click(screen.getByRole("button", { name: /ruled text/ }));
    fireEvent.click(screen.getByLabelText("imdb"));
    await waitFor(() => expect(file().value).toMatch(/show_when:[\s\S]*has:/));

    fireEvent.click(screen.getByRole("button", { name: /complex text/ }));
    expect(screen.getByLabelText("Show when rule")).toBeInTheDocument();
    const area = screen.getByLabelText("Show when rule") as HTMLTextAreaElement;
    const before = file().value;
    fireEvent.change(area, { target: { value: "not: mapping\n  foo: [" } });
    fireEvent.blur(area);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(file().value).toBe(before);

    fireEvent.click(screen.getByRole("button", { name: /accent text/ }));
    expect(screen.getByText(/From option accent/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    await waitFor(() => expect(file().value).toMatch(/colour: ['"]#E50914['"]/i));

    fireEvent.click(screen.getByRole("button", { name: /title text/ }), { shiftKey: true });
    expect(screen.getByText("2 elements selected")).toBeInTheDocument();
  });

  it("disables inputs for a shipped style", async () => {
    mockApi(routes(FIXED, true));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter([{ path: "/overlays/editor/:styleId", element: <StyleEditor /> }], { initialEntries: ["/overlays/editor/mine?library=Movies"] });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await screen.findByText(/duplicate it on the Overlays page/);
    fireEvent.click(await screen.findByRole("button", { name: /title text/ }));
    expect(screen.getByLabelText("Size")).toBeDisabled();
    expect(screen.getByLabelText("Text")).toBeDisabled();
  });
});