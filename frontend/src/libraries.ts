// Matching Plex's libraries with the ones in Kometa's config.yml.

import { useQuery } from "@tanstack/react-query";

import { api, type FileReference, type LibraryCounts, type PlexLibrarySummary } from "./api";

export function plural(count: number, word: string, locale = false): string {
  const n = locale ? count.toLocaleString() : String(count);
  return `${n} ${word}${count === 1 ? "" : "s"}`;
}

const fileReferenceKindLabels: Record<FileReference["kind"], string> = {
  default: "Kometa default",
  file: "File",
  folder: "Folder",
  url: "URL",
  git: "Git",
  repo: "Repo",
  unknown: "Unknown",
};

/** Tag label for a config file reference (`unknown` can show as `?` on the library page). */
export function fileReferenceKindLabel(kind: FileReference["kind"], shortUnknown = false): string {
  if (shortUnknown && kind === "unknown") return "?";
  return fileReferenceKindLabels[kind];
}

export type LibraryEntry = {
  name: string; // the Plex title, or the config name for a library Plex doesn't have
  plex: PlexLibrarySummary | null;
  config: LibraryCounts | null;
};

/** Plex's libraries in Plex's order, each with its config entry if it has one, then config entries Plex lacks. */
export function mergeLibraries(plex: PlexLibrarySummary[] | undefined, config: LibraryCounts[] | undefined): LibraryEntry[] {
  const configs = config ?? [];
  const used = new Set<string>();
  const entries: LibraryEntry[] = (plex ?? []).map((library) => {
    const match = configs.find((c) => c.plex_name === library.title) ?? null;
    if (match) used.add(match.name);
    return { name: library.title, plex: library, config: match };
  });
  for (const library of configs) {
    if (!used.has(library.name)) entries.push({ name: library.name, plex: null, config: library });
  }
  return entries;
}

/** What Plex says a library in config.yml is (movie, show, artist), once Plex has answered. */
export function useLibraryType(library: string | null): string | undefined {
  const plex = useQuery({ queryKey: ["plex", "libraries"], queryFn: api.plexLibraries.list, retry: false, staleTime: 60_000, enabled: !!library });
  const overview = useQuery({ queryKey: ["config"], queryFn: api.config.overview, retry: false, enabled: !!library });
  if (!library) return undefined;
  return mergeLibraries(plex.data?.libraries, overview.data?.libraries).find((entry) => entry.config?.name === library)?.plex?.type;
}

export const libraryTypeLabels: Record<string, string> = { movie: "Movies", show: "TV", artist: "Music", photo: "Photos" };

export function libraryPath(name: string): string {
  return `/libraries/${encodeURIComponent(name)}`;
}

export function collectionPath(library: string, ratingKey: string): string {
  return `${libraryPath(library)}/collections/${encodeURIComponent(ratingKey)}`;
}
