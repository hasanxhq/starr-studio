// The config.yml libraries Plex says are music libraries (type "artist").

import { useQuery } from "@tanstack/react-query";

import { api } from "../../api";
import { mergeLibraries } from "../../libraries";

export function useMusicLibraries(): string[] {
  const plex = useQuery({ queryKey: ["plex", "libraries"], queryFn: api.plexLibraries.list, retry: false, staleTime: 60_000 });
  const overview = useQuery({ queryKey: ["config"], queryFn: api.config.overview, retry: false });
  return mergeLibraries(plex.data?.libraries, overview.data?.libraries)
    .filter((entry) => entry.config && entry.plex?.type === "artist")
    .map((entry) => entry.config!.name);
}
