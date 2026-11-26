import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { overlayEngine, type StyleDetail, type StyleSummary } from "../../../overlayEngineApi";
import { mockApi } from "../../../test-utils";
import { StyleSettings } from "./StyleSettings";

vi.mock("../../../components/YamlEditor", () => ({
  default: ({ value, onChange, label, readOnly }: { value: string; onChange: (text: string) => void; label: string; readOnly?: boolean }) => (
    <textarea aria-label={label} value={value} readOnly={readOnly} onChange={(event) => onChange(event.target.value)} />
  ),
}));

const modern: StyleSummary = {
  id: "modern",
  shipped: true,
  name: "Modern Streaming",
  description: "Dark band at the bottom with scores.",
  options: {
    accent: { type: "colour", label: "Accent colour", default: "#E50914" },
    band: { type: "percent", label: "Band darkness", default: 65 },
    new_days: { type: "number", label: "NEW for days", default: 14, min: 0, max: 60 },
    ratings: { type: "choice", label: "Ratings", default: ["imdb"], choices: ["imdb", "tmdb", "rt"], multiple: true },
    corner: { type: "choice", label: "Corner", default: "left", choices: ["left", "right"] },
    hdr: { type: "toggle", label: "Show HDR", default: true },
    suffix: { type: "text", label: "Suffix", default: "" },
  },
  error: null,
};
const mine: StyleSummary = { id: "mine", shipped: false, name: "Mine", description: "", options: { accent: { type: "colour", label: "Accent colour", default: "#0000FF" } }, error: null };
const broken: StyleSummary = { id: "broken", shipped: false, name: "Broken", description: "", options: {}, error: "line 3: bad indentation" };
const copy: StyleDetail = { ...modern, id: "modern-copy", shipped: false, name: "Modern Streaming (copy)", yaml: "name: copy\n" };

function routes(extra: Record<string, (body: unknown) => unknown> = {}) {
  return {
    "GET /overlay-engine/styles": () => [modern, mine, broken],
    "GET /overlay-engine/libraries/Movies/style": () => ({ style: "modern", values: { accent: "#FF0000", band: 80 }, saved: true }),
    "GET /overlay-engine/styles/modern": () => ({ ...modern, yaml: "name: Modern Streaming\n" }),
    "GET /overlay-engine/styles/mine": () => ({ ...mine, yaml: "name: Mine\n" }),
    "GET /overlay-engine/style-schema": () => ({ type: "object" }),
    ...extra,
  };
}

function renderSettings() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <StyleSettings library="Movies" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return invalidate;
}

const radio = (name: RegExp) => screen.findByRole("radio", { name });
const fail = (status: number, detail: string) => () => new Response(JSON.stringify({ detail }), { status });

describe("StyleSettings", () => {
  it("loads the saved style and values, and renders one control per option type", async () => {
    mockApi(routes());
    renderSettings();
    expect(await radio(/Modern Streaming/)).toBeChecked();
    expect(screen.getByRole("radio", { name: /Broken/ })).toBeDisabled();
    expect(screen.getByText("line 3: bad indentation")).toBeInTheDocument();
    expect(screen.getAllByText("Shipped")).toHaveLength(1);

    expect(screen.getByRole("textbox", { name: "Accent colour" })).toHaveValue("#FF0000");
    expect(screen.getByLabelText("Accent colour picker")).toHaveValue("#ff0000");
    expect(screen.getByRole("slider", { name: "Band darkness" })).toHaveValue("80");
    expect(screen.getByText("80%")).toBeInTheDocument();
    const days = screen.getByRole("spinbutton", { name: "NEW for days" });
    expect(days).toHaveValue(14);
    expect(days).toHaveAttribute("max", "60");
    expect(screen.getByRole("checkbox", { name: "imdb" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "tmdb" })).not.toBeChecked();
    expect(screen.getByRole("combobox", { name: "Corner" })).toHaveValue("left");
    expect(screen.getByRole("checkbox", { name: "Show HDR" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "Suffix" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("saves only the values that differ from the defaults", async () => {
    const calls = mockApi(routes({ "PUT /overlay-engine/libraries/Movies/style": (body) => ({ ...(body as object), saved: true }) }));
    const invalidate = renderSettings();
    await radio(/Modern Streaming/);
    fireEvent.change(screen.getByRole("slider", { name: "Band darkness" }), { target: { value: "65" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "tmdb" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Show HDR" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.find((c) => c.route === "PUT /overlay-engine/libraries/Movies/style")?.body).toEqual({ style: "modern", values: { accent: "#FF0000", ratings: ["imdb", "tmdb"], hdr: false } }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["overlay-engine", "posters", "Movies"] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["overlay-engine", "library-style", "Movies"] });
  });

  it("shows the server's message when it refuses the save, and Reset restores the defaults", async () => {
    mockApi(routes({ "PUT /overlay-engine/libraries/Movies/style": fail(422, "accent: not a colour") }));
    renderSettings();
    await radio(/Modern Streaming/);
    fireEvent.change(screen.getByRole("textbox", { name: "Accent colour" }), { target: { value: "red" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("accent: not a colour");

    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(screen.getByRole("textbox", { name: "Accent colour" })).toHaveValue("#E50914");
    expect(screen.getByRole("slider", { name: "Band darkness" })).toHaveValue("65");
  });

  it("shows another style's options with its defaults when picked", async () => {
    mockApi(routes());
    renderSettings();
    fireEvent.click(await radio(/Mine/));
    expect(screen.getByRole("textbox", { name: "Accent colour" })).toHaveValue("#0000FF");
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("duplicates the style and picks the copy, unsaved", async () => {
    mockApi(routes());
    renderSettings();
    await radio(/Modern Streaming/);
    // The list refetched after the duplicate includes the copy.
    mockApi(routes({ "GET /overlay-engine/styles": () => [modern, copy, mine], "POST /overlay-engine/styles/modern/duplicate": () => copy }));
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    await waitFor(() => expect(screen.getByRole("radio", { name: /Modern Streaming \(copy\)/ })).toBeChecked());
    expect(screen.getByRole("textbox", { name: "Accent colour" })).toHaveValue("#E50914");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("shows the 409 message when deleting a style a library uses", async () => {
    mockApi(routes({ "DELETE /overlay-engine/styles/mine": fail(409, "TV Shows uses this style") }));
    renderSettings();
    await radio(/Modern Streaming/);
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull(); // shipped
    fireEvent.click(screen.getByRole("radio", { name: /Mine/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete style" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("TV Shows uses this style");
  });

  it("deletes a user style and drops it from the picker", async () => {
    let list = [modern, mine, broken];
    mockApi(routes({ "GET /overlay-engine/styles": () => list, "DELETE /overlay-engine/styles/mine": () => { list = [modern, broken]; return new Response(null, { status: 204 }); } }));
    renderSettings();
    fireEvent.click(await radio(/Mine/));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete style" }));
    await waitFor(() => expect(screen.queryByRole("radio", { name: /Mine/ })).toBeNull());
    expect(screen.getByRole("radio", { name: /Modern Streaming/ })).toBeChecked();
  });

  it("says so when the library's saved style is gone", async () => {
    mockApi(routes({ "GET /overlay-engine/libraries/Movies/style": () => ({ style: "vanished", values: {}, saved: true }) }));
    renderSettings();
    expect(await screen.findByRole("alert")).toHaveTextContent("vanished");
  });

  it("imports a file and picks the imported style; export links to the zip", async () => {
    const imported: StyleDetail = { ...mine, id: "imported", name: "Imported", yaml: "name: Imported\n" };
    mockApi(routes({ "GET /overlay-engine/styles": () => [modern, mine, imported] }));
    const upload = vi.spyOn(overlayEngine.styles, "import").mockResolvedValue(imported);
    renderSettings();
    await radio(/Modern Streaming/);
    expect(screen.getByRole("link", { name: "Export" })).toHaveAttribute("href", "/api/v1/overlay-engine/styles/modern/export");

    const file = new File(["name: Imported\n"], "imported.yml");
    fireEvent.change(screen.getByLabelText("Import a style file"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole("radio", { name: /Imported/ })).toBeChecked());
    expect(upload).toHaveBeenCalledWith(file);
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("shows the import's error message", async () => {
    mockApi(routes());
    vi.spyOn(overlayEngine.styles, "import").mockRejectedValue(new Error("A style called imported already exists"));
    renderSettings();
    await radio(/Modern Streaming/);
    fireEvent.change(screen.getByLabelText("Import a style file"), { target: { files: [new File(["x"], "imported.yml")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
  });

  it("shows a shipped style's YAML read-only", async () => {
    mockApi(routes());
    renderSettings();
    await radio(/Modern Streaming/);
    fireEvent.click(screen.getByText("Style file (YAML)"));
    const editor = await screen.findByRole("textbox", { name: "Style file modern" });
    expect(editor).toHaveValue("name: Modern Streaming\n");
    expect(editor).toHaveAttribute("readonly");
    expect(screen.getByText("Shipped with Studio: duplicate it to edit.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save file" })).toBeNull();
  });

  it("saves a user style's YAML, shows a 422, and refreshes the style list", async () => {
    let reply: () => unknown = fail(422, "options.accent: unknown type");
    const calls = mockApi(routes({ "PUT /overlay-engine/styles/mine": () => reply() }));
    const invalidate = renderSettings();
    fireEvent.click(await radio(/Mine/));
    fireEvent.click(screen.getByText("Style file (YAML)"));
    const editor = await screen.findByRole("textbox", { name: "Style file mine" });
    expect(screen.getByRole("button", { name: "Save file" })).toBeDisabled();
    fireEvent.change(editor, { target: { value: "name: Mine 2\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save file" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("options.accent: unknown type");

    reply = () => ({ ...mine, name: "Mine 2", yaml: "name: Mine 2\n" });
    fireEvent.click(screen.getByRole("button", { name: "Save file" }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["overlay-engine", "styles"] }));
    expect(calls.filter((c) => c.route === "PUT /overlay-engine/styles/mine").at(-1)?.body).toEqual({ yaml: "name: Mine 2\n" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Save file" })).toBeDisabled();
  });
});

describe("StyleSettings choice labels and Edit", () => {
  it("shows a choice's label and links a user style to the editor", async () => {
    mockApi(
      routes({
        "GET /overlay-engine/styles": () => [{ ...modern, options: { ratings: { ...modern.options.ratings, choice_labels: { imdb: "IMDb" } } } }, mine],
        "GET /overlay-engine/libraries/Movies/style": () => ({ style: "mine", values: {}, saved: true }),
      }),
    );
    renderSettings();
    const edit = await screen.findByRole("link", { name: "Edit" });
    expect(edit.getAttribute("href")).toBe("/overlays/editor/mine?library=Movies");
    fireEvent.click(await radio(/Modern Streaming/));
    expect(await screen.findByRole("checkbox", { name: "IMDb" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull(); // shipped: duplicate first
  });
});
