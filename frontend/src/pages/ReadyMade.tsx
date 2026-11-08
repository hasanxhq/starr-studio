// Ready-made collections: Kometa's defaults as category cards. Pick collections inside a category, then Build once for all.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

import { ApiError, api, type ReadyMadeCategorySummary, type ReadyMadeKind } from "../api";
import { useLibrary } from "../library";
import { Tag } from "../components/ui";
import { categoryOf, shortTitle } from "../defaults";
import { formatRelative } from "../runs";

const SECTIONS: { kind: ReadyMadeKind; label: string }[] = [
  { kind: "fixed", label: "Charts" },
  { kind: "award", label: "Awards" },
  { kind: "per_value", label: "One per value in your library" },
  { kind: "helper", label: "Other" },
];

function countLine(category: ReadyMadeCategorySummary, counting: boolean): string {
  if (category.count === null) return counting ? "Counting…" : "Not counted yet";
  return `${category.picked} picked · ${category.in_plex} built`;
}

function CategoryCover({ category, compact }: { category: ReadyMadeCategorySummary; compact?: boolean }) {
  const [noCover, setNoCover] = useState(false);
  const banner = categoryOf("collection", category).banner;
  if (noCover || compact) {
    return (
      <span aria-hidden="true" className={`flex h-[88px] w-full items-end overflow-hidden p-3 font-display text-base leading-snug font-semibold ${banner}`}>
        {shortTitle(category.title)}
      </span>
    );
  }
  return (
    <>
      <img
        src={api.config.defaultCoverUrl(category.name)}
        alt=""
        loading="lazy"
        onError={() => setNoCover(true)}
        className={`aspect-[720/248] w-full object-cover ${banner}`}
      />
      <span aria-hidden="true" className="px-3.5 pt-3 font-display text-base leading-snug font-semibold">
        {shortTitle(category.title)}
      </span>
    </>
  );
}

function CategoryCard({
  category,
  library,
  counting,
  compact,
  search,
}: {
  category: ReadyMadeCategorySummary;
  library: string;
  counting: boolean;
  compact?: boolean;
  search: string;
}) {
  const muted = !category.listable;
  if (search && !category.title.toLowerCase().includes(search.toLowerCase())) return null;

  const body = (
    <>
      <CategoryCover category={category} compact={compact} />
      <span className="px-3.5 pt-1 pb-3.5 text-[13px] text-muted">{muted ? category.reason : countLine(category, counting)}</span>
      {category.picked > 0 && (
        <span className="absolute top-2 right-2">
          <Tag tone="info">{category.picked} picked</Tag>
        </span>
      )}
    </>
  );

  if (muted) {
    return (
      <li aria-label={category.title} className="relative flex flex-col overflow-hidden rounded-card border border-border bg-surface opacity-60">
        <div className="flex flex-col text-left">{body}</div>
      </li>
    );
  }

  return (
    <li aria-label={category.title} className="relative flex flex-col overflow-hidden rounded-card border border-border bg-surface">
      <Link
        to={`/collections/ready-made/${encodeURIComponent(category.name)}?library=${encodeURIComponent(library)}`}
        className="flex min-h-11 grow flex-col text-left hover:bg-surface-2/40"
      >
        {body}
      </Link>
    </li>
  );
}

/** Ready-made category grid (Collections → Ready-made tab). */
export function ReadyMadeTab({ search = "", compact = true }: { search?: string; compact?: boolean }) {
  const { library, overview } = useLibrary();
  const data = useQuery({
    queryKey: ["ready-made", "library", library],
    queryFn: () => api.readyMade.library(library!),
    enabled: library !== null,
    refetchInterval: (query) => (query.state.data?.counting ? 3000 : false),
  });

  if (overview.isPending) return <p className="text-muted">Loading…</p>;
  if (overview.isError) {
    return (
      <p role="alert" className="text-err">
        {overview.error instanceof ApiError ? overview.error.message : "Can't read the config"}
      </p>
    );
  }
  if (library === null) {
    return (
      <p className="text-muted">
        Ready-made collections are per library, and config.yml has none yet.{" "}
        <Link className="underline hover:text-text" to="/libraries">
          Add one from Libraries
        </Link>
        .
      </p>
    );
  }

  const needle = search.trim().toLowerCase();

  return (
    <div className="flex flex-col gap-5">
      {data.data?.counted_at && <p className="text-[13px] text-muted">Counted {formatRelative(data.data.counted_at)}</p>}
      {data.data?.counting && !data.data.counted_at && <p className="text-[13px] text-muted">Counting…</p>}

      {data.isPending ? (
        <p className="text-muted">Loading…</p>
      ) : data.isError ? (
        <p role="alert" className="text-err">
          {data.error.message}
        </p>
      ) : (
        SECTIONS.map(({ kind, label }) => {
          const items = data.data.categories.filter((category) => category.kind === kind);
          const visible = needle ? items.filter((category) => category.title.toLowerCase().includes(needle)) : items;
          if (visible.length === 0) return null;
          return (
            <section key={kind} aria-labelledby={`ready-made-${kind}`}>
              <h3 id={`ready-made-${kind}`} className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">
                {label}
              </h3>
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((category) => (
                  <CategoryCard key={category.name} category={category} library={library} counting={data.data.counting} compact={compact} search={needle} />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
