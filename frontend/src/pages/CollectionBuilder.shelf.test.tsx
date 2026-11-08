import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
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
  fields: [],
  sorts: [],
};

function renderBuilder(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: "/collections", element: <Collections /> },
      { path: "/collections/new", element: <CollectionBuilder /> },
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

describe("CollectionBuilder shelf", () => {
  it("has no Missing tab in filters mode", async () => {
    mockApi({
      "GET /config": () => ({ path: "/config/config.yml", libraries: [{ name: "Movies", plex_name: "Movies" }], playlist_files: [] }),
      "GET /builder/fields?library=Movies": () => ({ ...fields, fields: [{ key: "genre", label: "Genre", kind: "tag", modifiers: [{ key: "", label: "is" }], group: "Tags", listable: true }] }),
      "GET /builder/sources?library=Movies": () => ({ sources: [] }),
      "POST /builder/preview": () => ({ count: 2, items: [], problems: [] }),
      "GET /collections?library=Movies": () => ({ collections: [] }),
    });
    renderBuilder("/collections/new?library=Movies");
    fireEvent.click(await screen.findByRole("radio", { name: "Organise what I have" }));
    expect(screen.queryByRole("button", { name: /Missing ·/ })).not.toBeInTheDocument();
  });

});
