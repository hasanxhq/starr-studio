import { Link } from "react-router";

import type { BuiltCollection, OtherCollection } from "../../builderApi";
import { PlusIcon } from "../../components/icons";
import { PlexPoster } from "../../components/PlexPoster";
import { PosterTile, StatusBadge, badgeFor } from "../../components/PosterTile";
import { Card } from "../../components/ui";
import { lastChangeCaption, libraryQs, readyMadeLink, shelfItems, studioCaption, type ShelfItem } from "./collectionShelf";

function tileBadge(collection: BuiltCollection) {
  if (collection.changed) return <StatusBadge state={{ kind: "changed" }} />;
  const state = badgeFor(collection);
  return <StatusBadge state={state ?? { kind: "missing" }} />;
}

function ShelfTile({ library, item }: { library: string; item: ShelfItem }) {
  if (item.kind === "studio") {
    const collection = item.row;
    const art = collection.thumb ? (
      <PlexPoster thumb={collection.thumb} title={collection.title} />
    ) : (
      <span
        aria-hidden="true"
        className="flex aspect-[2/3] items-end overflow-hidden rounded-control border border-border bg-banner-studio p-3 font-display text-base leading-snug font-semibold"
      >
        {collection.title}
      </span>
    );
    return (
      <PosterTile
        title={collection.title}
        to={`/collections/${collection.id}`}
        art={art}
        badge={tileBadge(collection)}
        liClassName="overflow-hidden rounded-card border border-border bg-surface"
        controlClassName="hover:bg-surface-2/40"
      >
        <span className="px-3.5 pt-3 font-display text-base leading-snug font-semibold">{collection.title}</span>
        <span className="px-3.5 pt-1 pb-3.5 text-[13px] text-muted">{studioCaption(collection)}</span>
      </PosterTile>
    );
  }
  const row = item.row;
  const art = row.thumb ? (
    <PlexPoster thumb={row.thumb} title={row.title} />
  ) : (
    <span
      aria-hidden="true"
      className="flex aspect-[2/3] items-end overflow-hidden rounded-control border border-border bg-banner-studio p-3 font-display text-base leading-snug font-semibold"
    >
      {row.title}
    </span>
  );
  const caption = lastChangeCaption(row.last_change) ?? "Ready-made";
  return (
    <PosterTile
      title={row.title}
      to={row.rating_key ? `/libraries/${encodeURIComponent(library)}/collections/${encodeURIComponent(row.rating_key)}` : readyMadeLink(library, row.category)}
      art={art}
      liClassName="overflow-hidden rounded-card border border-border bg-surface"
      controlClassName="hover:bg-surface-2/40"
    >
      <span className="px-3.5 pt-3 font-display text-base leading-snug font-semibold">{row.title}</span>
      <span className="px-3.5 pt-1 pb-3.5 text-[13px] text-muted">{caption}</span>
    </PosterTile>
  );
}

function NewTile({ library }: { library: string }) {
  return (
    <li className="overflow-hidden rounded-card border border-dashed border-border bg-surface">
      <Link
        to={`/collections/new${libraryQs(library)}`}
        className="flex h-full min-h-11 w-full flex-col items-center justify-center gap-2 p-6 text-center hover:bg-surface-2/40"
      >
        <PlusIcon className="size-8 text-muted" />
        <span className="font-display text-base font-semibold">New</span>
      </Link>
    </li>
  );
}

export function YourCollections({
  library,
  collections,
  others,
}: {
  library: string;
  collections: BuiltCollection[];
  others: OtherCollection[];
}) {
  const readyCount = others.filter((o) => o.made_by === "ready_made").length;
  const total = collections.length + readyCount;
  const items = shelfItems(collections, others).slice(0, 11);

  return (
    <Card
      title="Your collections"
      actions={
        total > 0 ? (
          <Link className="min-h-11 content-center text-sm text-muted underline hover:text-text" to={`/collections${libraryQs(library)}`}>
            See all {total.toLocaleString()}
          </Link>
        ) : null
      }
    >
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
        {items.map((item) => (
          <ShelfTile key={item.kind === "studio" ? `s-${item.row.id}` : `r-${item.row.title}`} library={library} item={item} />
        ))}
        <NewTile library={library} />
      </ul>
      {total === 0 && <p className="mt-2 text-sm text-muted">No collections yet.</p>}
    </Card>
  );
}
