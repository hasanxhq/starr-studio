// The style on up to 12 varied titles at once, and a picker to put any library title on the canvas.

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { Card, Field, Tag, inputClass } from "../../../../components/ui";
import { overlayEngine, type Sample, type SceneItem } from "../../../../overlayEngineApi";
import { useDebounced } from "../../../../useDebounced";
import { useEditor } from "../EditorContext";
import { sceneMarkup } from "../model/scene";

const TRAIT_LABELS: Record<string, string> = {
  "resolution:4K": "4K",
  "resolution:1080P": "1080p",
  "resolution:lower": "Below 1080p",
  "hdr:yes": "HDR",
  "imdb:no": "No IMDb",
  "rt:no": "No RT",
  "new:yes": "New",
  "audio:atmos": "Atmos",
};

const SCENE_STALE_MS = 5 * 60_000;

function SampleTile({
  sample,
  scene,
  selected,
  onSelect,
}: {
  sample: Sample;
  scene: SceneItem | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const traits = sample.traits.map((t) => TRAIT_LABELS[t]).filter((label): label is string => Boolean(label));

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex flex-col gap-1.5 rounded-control border bg-bg p-2 text-left transition ${
        selected ? "border-accent ring-2 ring-accent" : "border-border hover:border-muted"
      }`}
    >
      <span className="block aspect-[2/3] w-full overflow-hidden rounded bg-surface-2">
        {scene?.error !== undefined ? (
          <span className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-err">{scene.error}</span>
        ) : scene ? (
          <span
            className="pointer-events-none block h-full w-full [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: sceneMarkup(scene.svg, scene.thumb) }}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-xs text-muted">Loading…</span>
        )}
      </span>
      <span className="line-clamp-2 text-xs font-medium text-text">{sample.title}</span>
      {sample.year !== null && (
        <>
          {" "}
          <span className="text-xs text-muted">{sample.year}</span>
        </>
      )}
      {traits.length > 0 && (
        <>
          {" "}
          <span className="flex flex-wrap gap-1">
            {traits.map((label) => (
              <Tag key={label}>{label}</Tag>
            ))}
          </span>
        </>
      )}
    </button>
  );
}

export function SampleGrid() {
  const { library, settledText, samples, samplesState, samplesError, sample, setSample, values, scene } = useEditor();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const gridYaml = useDebounced(settledText, 400);
  const debouncedQuery = useDebounced(search.trim(), 250);
  const keys = useMemo(() => samples.map((s) => s.rating_key), [samples]);

  // Seeded single-title scenes must stay fresh long enough for tile clicks to skip refetching.
  useEffect(() => {
    if (queryClient.getQueryDefaults(["overlay-engine", "scene"]).staleTime === undefined) {
      queryClient.setQueryDefaults(["overlay-engine", "scene"], { staleTime: SCENE_STALE_MS });
    }
  }, [queryClient]);

  // Share the context's library-style lookup so the grid waits for option values instead of fetching twice.
  const libraryStyle = useQuery({
    queryKey: ["overlay-engine", "library-style", library],
    queryFn: () => overlayEngine.library.style(library),
  });

  const gridQuery = useQuery({
    queryKey: ["overlay-engine", "scene-grid", library, keys, gridYaml, values],
    queryFn: async () => {
      const result = await overlayEngine.scene({ library, rating_keys: keys, yaml: gridYaml, values });
      for (const item of result.items) {
        queryClient.setQueryData(["overlay-engine", "scene", library, item.rating_key, gridYaml, values], { items: [item] });
      }
      return result;
    },
    enabled: keys.length > 0 && !libraryStyle.isPending,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const activeSearch = search.trim().length >= 2 && debouncedQuery.length >= 2;
  const searchQuery = useQuery({
    queryKey: ["overlay-engine", "posters-picker", library, debouncedQuery],
    queryFn: () => overlayEngine.library.posters(library, { q: debouncedQuery, size: 12 }),
    enabled: activeSearch,
  });

  const sceneByKey = useMemo(() => {
    const map = new Map<string, SceneItem>();
    for (const item of gridQuery.data?.items ?? []) map.set(item.rating_key, item);
    return map;
  }, [gridQuery.data]);

  const customCanvasTitle =
    sample !== null && !samples.some((s) => s.rating_key === sample) && scene && scene.rating_key === sample && scene.error === undefined
      ? scene.title
      : null;

  return (
    <Card title="Samples">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">The style on varied titles from the library. Click one to edit on it.</p>

        <div className="flex max-w-md flex-col gap-2">
          <Field label="Put another title on the canvas">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search…"
              className={inputClass}
            />
          </Field>
          {activeSearch && (
            searchQuery.isPending ? (
              <p className="text-xs text-muted">Searching…</p>
            ) : searchQuery.isError ? (
              <p role="alert" className="text-xs text-err">
                {searchQuery.error.message}
              </p>
            ) : searchQuery.data.items.length === 0 ? (
              <p className="text-xs text-muted">No matching titles.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border rounded-control border border-border bg-bg">
                {searchQuery.data.items.map((item) => (
                  <li key={item.rating_key}>
                    <button
                      type="button"
                      onClick={() => {
                        setSample(item.rating_key);
                        setSearch("");
                      }}
                      className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
                    >
                      <span className="font-medium text-text">{item.title}</span>
                      {item.year !== null && <span className="text-xs text-muted">{item.year}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>

        {customCanvasTitle !== null && <p className="text-sm font-medium">On the canvas: {customCanvasTitle}</p>}

        {samplesState === "error" ? (
          <p role="alert" className="text-sm text-err">
            {samplesError}
          </p>
        ) : samplesState === "empty" ? (
          <p className="text-sm text-muted">No titles to show yet.</p>
        ) : samplesState === "loading" || (gridQuery.isPending && !gridQuery.isError) ? (
          <p className="text-sm text-muted">Loading samples…</p>
        ) : gridQuery.isError ? (
          <p role="alert" className="text-sm text-err">
            {gridQuery.error.message}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {samples.map((item) => (
              <SampleTile
                key={item.rating_key}
                sample={item}
                scene={sceneByKey.get(item.rating_key)}
                selected={sample === item.rating_key}
                onSelect={() => setSample(item.rating_key)}
              />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
