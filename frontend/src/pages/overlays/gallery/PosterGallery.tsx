import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Button, Field, inputClass, Spinner } from "../../../components/ui";
import { useDebounced } from "../../../useDebounced";
import type { GalleryPoster } from "../../../overlayEngineApi";
import { overlayEngine } from "../../../overlayEngineApi";
import { PosterGalleryTile } from "./PosterGalleryTile";

const PAGE = 48;

export function PosterGallery({ library }: { library: string }) {
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 500);
  const [moreItems, setMoreItems] = useState<GalleryPoster[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  const posters = useQuery({
    queryKey: ["overlay-engine", "posters", library, q],
    queryFn: () => overlayEngine.library.posters(library, { q, start: 0, size: PAGE }),
  });

  useEffect(() => {
    setMoreItems([]);
  }, [library, q, posters.dataUpdatedAt]);

  const items = [...(posters.data?.items ?? []), ...moreItems];
  const total = posters.data?.total ?? 0;
  const canLoadMore = items.length < total;

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const page = await overlayEngine.library.posters(library, { q, start: items.length, size: PAGE });
      setMoreItems((prev) => [...prev, ...page.items]);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <section className="flex flex-col gap-4" aria-label="Poster gallery">
      <Field label="Search titles">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className={inputClass}
        />
      </Field>

      {posters.isPending ? (
        <p className="flex items-center gap-2 text-muted">
          <Spinner className="size-4" />
          Loading…
        </p>
      ) : posters.isError ? (
        <p role="alert" className="text-err">
          {posters.error.message}
        </p>
      ) : items.length === 0 ? (
        <p className="text-muted">{q ? "No titles match your search." : "No titles in this library."}</p>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]" aria-label="Library posters">
            {items.map((item) => (
              <PosterGalleryTile key={item.rating_key} item={item} library={library} />
            ))}
          </ul>
          {canLoadMore ? (
            <div className="flex justify-center">
              <Button className="min-h-11 gap-2" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? <Spinner className="size-4" /> : null}
                Load more
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}