import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { api } from "../../api";
import { PlusIcon } from "../../components/icons";
import { useHeaderTitle } from "../../components/HeaderTitle";
import { mergeLibraries } from "../../libraries";

const itemWords: Record<string, string> = { movie: "movie", show: "show" };
import { phraseNextRun } from "./nextRun";
import { libraryQs } from "./collectionShelf";

function plural(count: number, word: string): string {
  return `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;
}

export function HomeHeader({
  library,
  collectionCount,
  nextAt,
}: {
  library: string;
  collectionCount: number | null;
  nextAt: string | null | undefined;
}) {
  useHeaderTitle(library);
  const plex = useQuery({ queryKey: ["plex", "libraries"], queryFn: api.plexLibraries.list, retry: false, staleTime: 60_000 });
  const config = useQuery({ queryKey: ["config"], queryFn: api.config.overview, retry: false });
  const entries = mergeLibraries(plex.data?.libraries, config.data?.libraries);
  const entry = entries.find((e) => e.name === library);
  const inPlex = entry?.plex;
  const parts: string[] = [];
  if (inPlex?.items != null && inPlex.type && itemWords[inPlex.type]) parts.push(plural(inPlex.items, itemWords[inPlex.type]));
  if (collectionCount && collectionCount > 0) parts.push(plural(collectionCount, "collection"));
  if (nextAt) parts.push(`next run ${phraseNextRun(nextAt)}`);

  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-[32px] leading-tight font-semibold">{library}</h2>
        {parts.length > 0 && <p className="mt-1 text-[13px] text-muted">{parts.join(" · ")}</p>}
      </div>
      <Link
        to={`/collections/new${libraryQs(library)}`}
        className="inline-flex min-h-11 items-center gap-2 rounded-control border border-border-strong bg-surface-2 px-4 text-sm font-medium hover:border-muted"
      >
        <PlusIcon className="size-4" />
        New collection
      </Link>
    </header>
  );
}
