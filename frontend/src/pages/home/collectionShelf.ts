import { sourceLabel, sourcesOf, type BuiltCollection, type LastChange, type OtherCollection } from "../../builderApi";

export type ShelfStudio = { kind: "studio"; row: BuiltCollection };
export type ShelfReadyMade = { kind: "ready_made"; row: OtherCollection };
export type ShelfItem = ShelfStudio | ShelfReadyMade;

function priority(state: BuiltCollection["state"] | null): number {
  if (state === "failed") return 0;
  if (state === "queued" || state === "building") return 1;
  return 2;
}


export function shelfItems(collections: BuiltCollection[], others: OtherCollection[]): ShelfItem[] {
  const ready = others.filter((row) => row.made_by === "ready_made");
  const items: ShelfItem[] = [
    ...collections.map((row) => ({ kind: "studio" as const, row })),
    ...ready.map((row) => ({ kind: "ready_made" as const, row })),
  ];
  items.sort((a, b) => {
    const pa = a.kind === "studio" ? priority(a.row.state) : 2;
    const pb = b.kind === "studio" ? priority(b.row.state) : 2;
    if (pa !== pb) return pa - pb;
    const runA = a.row.last_change?.run_id ?? 0;
    const runB = b.row.last_change?.run_id ?? 0;
    if (runA !== runB) return runB - runA;
    const builtA = a.kind === "studio" && a.row.last_built_at ? Date.parse(a.row.last_built_at) : 0;
    const builtB = b.kind === "studio" && b.row.last_built_at ? Date.parse(b.row.last_built_at) : 0;
    if (builtA !== builtB) return builtB - builtA;
    return a.row.title.localeCompare(b.row.title, undefined, { sensitivity: "base" });
  });
  return items;
}

export function lastChangeCaption(last: LastChange): string | null {
  if (!last) return null;
  if (last.added === 0 && last.removed === 0) return "No change last run";
  const parts: string[] = [];
  if (last.added > 0) parts.push(`+${last.added}`);
  if (last.removed > 0) parts.push(`−${last.removed}`);
  return `${parts.join(" ")} last run`;
}

export function studioCaption(collection: BuiltCollection): string {
  const change = lastChangeCaption(collection.last_change);
  if (change) return change;
  const sources = sourcesOf(collection);
  if (sources.length > 1) return `${sources.length} sources`;
  return sourceLabel(sources[0] ?? { kind: "filters" });
}

export function libraryQs(library: string) {
  return `?library=${encodeURIComponent(library)}`;
}

export function readyMadeLink(library: string, category: string | null) {
  if (!category) return `/collections${libraryQs(library)}`;
  return `/collections/ready-made/${encodeURIComponent(category)}${libraryQs(library)}`;
}
