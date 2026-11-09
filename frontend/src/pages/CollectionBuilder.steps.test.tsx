import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import type { BuilderFields } from "../builderApi";
import { HeaderTitleProvider } from "../components/HeaderTitle";
import { mockApi } from "../test-utils";
import { CollectionBuilder } from "./CollectionBuilder";
import { Collections } from "./Collections";

const fields: BuilderFields = {
  library: "Movies",
  library_type: "movie",
  fields: [
    {
      key: "genre",
      label: "Genre",
      kind: "tag",
      modifiers: [{ key: "", label: "is" }],
      group: "Tags",
      listable: true,
    },
  ],
  sorts: [
    { key: "title.asc", label: "Title A–Z" },
    { key: "year.desc", label: "Year (newest)" },
  ],
};

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
  return render(
    <QueryClientProvider client={queryClient}>
      <HeaderTitleProvider>
        <RouterProvider router={router} />
      </HeaderTitleProvider>
    </QueryClientProvider>,
  );
}

function editStep(label: string) {
  const heading = screen.getByRole("heading", { name: new RegExp(label) });
  const section = heading.closest("section");
  const btn = within(section as HTMLElement).queryByRole("button", { name: "Edit" });
  if (btn) fireEvent.click(btn);
}

function baseRoutes(extra: Record<string, (body: unknown) => unknown> = {}) {
  return {
    "GET /config": () => ({ path: "/config/config.yml", libraries: [{ name: "Movies", plex_name: "Movies" }], playlist_files: [] }),
    "GET /builder/fields?library=Movies": () => fields,
    "GET /builder/values?library=Movies&field=genre": () => ({ values: [{ key: "Action", title: "Action" }] }),
    "GET /builder/sources?library=Movies": () => ({ sources: [] }),
    "POST /builder/preview": () => ({ count: 0, items: [], problems: [] }),
    "GET /collections?library=Movies": () => ({ collections: [] }),
    ...extra,
  };
}

describe("CollectionBuilder steps", () => {
  it("shows step summaries for steps 1, 3 and 4", async () => {
    mockApi(baseRoutes());
    renderBuilder("/collections/new?library=Movies");
    fireEvent.click(await screen.findByRole("radio", { name: "Organise what I have" }));
    editStep("How it looks");
    expect(screen.queryByRole("heading", { name: "Square art", level: 3 })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /My home/ }));
    editStep("Details");
    fireEvent.change(screen.getByLabelText("Summary"), { target: { value: "A short blurb about action" } });
    editStep("What goes in");
    expect(screen.getByText(/no limit · at least 1 title/)).toBeInTheDocument();
    expect(screen.getByText(/Plex mosaic · Library and Home/)).toBeInTheDocument();
    expect(screen.getByText(/A short blurb about action/)).toBeInTheDocument();
    editStep("Order and size");
    expect(screen.getByText(/1 rule:/)).toBeInTheDocument();
  });

  it("Edit opens a step and closes the other", async () => {
    mockApi(baseRoutes());
    renderBuilder("/collections/new?library=Movies");
    fireEvent.click(await screen.findByRole("radio", { name: "Organise what I have" }));
    await screen.findByRole("group", { name: "Filter rule" });
    editStep("Order and size");
    expect(screen.getByLabelText("Sort")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Filter rule" })).not.toBeInTheDocument();
    editStep("What goes in");
    expect(screen.getAllByRole("group", { name: "Filter rule" })).toHaveLength(1);
    expect(screen.queryByLabelText("Sort")).not.toBeInTheDocument();
  });

  it("does not re-open the error step on every render after the user opens another step", async () => {
    mockApi(
      baseRoutes({
        "POST /collections": () =>
          new Response(JSON.stringify({ detail: { message: "Invalid filters", problems: ["Genre is required"] } }), {
            status: 422,
            headers: { "Content-Type": "application/json" },
          }),
      }),
    );
    renderBuilder("/collections/new?library=Movies");
    fireEvent.click(await screen.findByRole("radio", { name: "Organise what I have" }));
    fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "Bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    expect(await screen.findByText("Genre is required")).toBeInTheDocument();
    expect(screen.getAllByRole("group", { name: "Filter rule" })).toHaveLength(1);
    editStep("Order and size");
    expect(screen.getByLabelText("Sort")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Filter rule" })).not.toBeInTheDocument();
  });

  it("a save error opens the step that holds the field", async () => {
    mockApi(
      baseRoutes({
        "POST /collections": () =>
          new Response(JSON.stringify({ detail: { message: "Invalid filters", problems: ["Limit too high"] } }), {
            status: 422,
            headers: { "Content-Type": "application/json" },
          }),
      }),
    );
    renderBuilder("/collections/new?library=Movies");
    fireEvent.click(await screen.findByRole("radio", { name: "Organise what I have" }));
    fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "Bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    expect(await screen.findByText("Limit too high")).toBeInTheDocument();
    expect(screen.getByLabelText("Limit")).toBeInTheDocument();
  });
});
