import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";

import { api, type ConfigLibrary, type DefaultEntry, type FileReference, type OverlayLibrary } from "../../api";
import { LeaveGuard, useLeaveEditor } from "../../components/LeaveGuard";
import { OverlayPoster, SamplePicker, useSamples } from "../../components/OverlayPreview";
import { ChevronDownIcon, ChevronUpIcon, EyeIcon, EyeOffIcon, LockIcon } from "../../components/icons";
import { ActionBar, Button } from "../../components/ui";
import { SaveError } from "../../components/ValidationReport";
import { shortTitle } from "../../defaults";
import { layerBoxes, layerText, whereItIs, type Box } from "../../overlayLayout";
import { loadSchema } from "../../yaml/schema";
import { useSave, type Values } from "../../components/DefaultVariables";
import { layerChangeSentence, studioChangeSentence } from "./changeSummary";
import { LayerSettings } from "./LayerSettings";
import type { Layer } from "./types";

const titleOf = (reference: FileReference, entry: DefaultEntry | undefined) => shortTitle(entry?.title ?? reference.files[0]?.title ?? reference.value);

function layersOf(config: ConfigLibrary, entryOf: (name: string) => DefaultEntry | undefined): Layer[] {
  const defaults = config.overlay_files.filter((reference) => reference.kind === "default");
  return [...new Set(defaults.map((reference) => reference.value))].map((name) => {
    const reference = defaults.find((candidate) => candidate.value === name)!;
    return { name, title: titleOf(reference, entryOf(name)), entry: entryOf(name), reference, variables: reference.template_variables as Values };
  });
}

export function OverlayStudio({
  config,
  libraryType,
  status,
}: {
  config: ConfigLibrary;
  libraryType: string | null;
  status: OverlayLibrary | undefined;
}) {
  const library = config.name;
  const queryClient = useQueryClient();
  const catalogue = useQuery({ queryKey: ["config", "defaults"], queryFn: api.config.defaults, staleTime: Infinity });
  const schema = useQuery({ queryKey: ["schema", "config"], queryFn: () => loadSchema("config"), staleTime: Infinity });
  const samples = useSamples(library);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Values>>({});
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [previewMode, setPreviewMode] = useState<"plex" | "changes">("changes");
  const [showAllAddable, setShowAllAddable] = useState(false);
  const [estimate, setEstimate] = useState<{ posters: number | null; minutes: number | null } | null>(null);
  const [batchError, setBatchError] = useState<Error | null>(null);
  const [saving, setSaving] = useState(false);
  const estimateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const entryOf = (name: string) => catalogue.data?.overlays.find((entry) => entry.name === name);
  const kometaLayers = layersOf(config, entryOf);
  const displayLayers = [...kometaLayers].reverse();
  const ownFiles = config.overlay_files.filter((reference) => reference.kind !== "default");
  const selected = kometaLayers.find((layer) => layer.name === selectedName) ?? kometaLayers[0] ?? null;
  const libraryVariables = config.template_variables as Values;
  const addable = (catalogue.data?.overlays ?? []).filter((entry) => !kometaLayers.some((layer) => layer.name === entry.name) && (!libraryType || !entry.types.length || entry.types.includes(libraryType)));

  const add = useSave((name: string) => api.config.useDefault(library, "overlay", name, {}));
  const drop = useSave((name: string) => api.config.dropDefault(library, "overlay", name));
  const order = useSave((names: string[]) => api.config.setOverlayOrder(library, names));

  const savedValues = (layer: Layer) => layer.variables;
  const draftValues = (layer: Layer) => drafts[layer.name] ?? layer.variables;
  const dirtyLayers = kometaLayers.filter((layer) => JSON.stringify(draftValues(layer)) !== JSON.stringify(savedValues(layer)));
  const unsaved = dirtyLayers.length > 0;
  const { leave, dialog } = useLeaveEditor(unsaved);

  const variablesOf = (layer: Layer) => ({ ...libraryVariables, ...draftValues(layer) });
  const visibleLayers = kometaLayers.filter((layer) => !hidden.has(layer.name));
  const boxes = (item: typeof samples.sample): Box[] =>
    visibleLayers.flatMap((layer) => layerBoxes(layer.name, layerText(layer.name, layer.title, item), layer.entry?.layout, variablesOf(layer)));

  const select = (name: string) => {
    if (name !== selected?.name) setSelectedName(name);
  };

  const kometaOrder = () => kometaLayers.map((layer) => layer.name);
  const moveLayer = (displayIndex: number, direction: -1 | 1) => {
    const names = kometaOrder();
    const kIndex = names.length - 1 - displayIndex;
    const target = kIndex + direction;
    if (target < 0 || target >= names.length) return;
    [names[kIndex], names[target]] = [names[target], names[kIndex]];
    order.mutate(names);
  };

  const onLayerKeyDown = (event: KeyboardEvent, displayIndex: number) => {
    if (event.altKey && event.key === "ArrowUp") {
      event.preventDefault();
      moveLayer(displayIndex, 1);
    }
    if (event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      moveLayer(displayIndex, -1);
    }
  };

  const setDraft = (name: string, values: Values) => {
    setDrafts((current) => {
      const layer = kometaLayers.find((entry) => entry.name === name);
      if (!layer) return current;
      if (JSON.stringify(values) === JSON.stringify(layer.variables)) {
        const next = { ...current };
        delete next[name];
        return next;
      }
      return { ...current, [name]: values };
    });
  };

  const undoAll = () => setDrafts({});

  const saveLayer = useMutation({
    mutationFn: ({ name, values }: { name: string; values: Values }) => api.config.useDefault(library, "overlay", name, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config"] });
      queryClient.invalidateQueries({ queryKey: ["backups"] });
    },
  });
  const applyRun = useMutation({ mutationFn: () => api.overlays.apply(library) });

  const saveAll = async (thenApply: boolean) => {
    setBatchError(null);
    setSaving(true);
    try {
      for (const layer of dirtyLayers) {
        await saveLayer.mutateAsync({ name: layer.name, values: draftValues(layer) });
      }
      setDrafts({});
      if (thenApply) await applyRun.mutateAsync();
    } catch (error) {
      setBatchError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setSaving(false);
    }
  };

  const dirtyKey = useMemo(() => JSON.stringify(dirtyLayers.map((layer) => ({ name: layer.name, variables: draftValues(layer) }))), [dirtyLayers, drafts]);
  const deferredDirtyKey = useDeferredValue(dirtyKey);
  useEffect(() => {
    if (estimateTimer.current) clearTimeout(estimateTimer.current);
    if (deferredDirtyKey === "[]") {
      setEstimate(null);
      return;
    }
    const layers = JSON.parse(deferredDirtyKey) as { name: string; variables: Values }[];
    estimateTimer.current = setTimeout(() => {
      void api.overlays
        .estimate(library, layers)
        .then(setEstimate)
        .catch(() => setEstimate(null));
    }, 500);
    return () => {
      if (estimateTimer.current) clearTimeout(estimateTimer.current);
    };
  }, [library, deferredDirtyKey]);

  const estimateText = useMemo(() => {
    if (!dirtyLayers.length) return null;
    const bits = [`${dirtyLayers.length} layer${dirtyLayers.length === 1 ? "" : "s"} changed`];
    if (estimate?.posters != null) bits.push(`Kometa redraws up to ${estimate.posters.toLocaleString()} posters`);
    if (estimate?.minutes != null) bits.push(`about ${estimate.minutes} minute${estimate.minutes === 1 ? "" : "s"}`);
    return bits.join(" · ");
  }, [dirtyLayers.length, estimate]);

  const originalUrl =
    previewMode === "changes" && samples.sample ? api.overlays.originalUrl(library, samples.sample.rating_key) : null;

  const noToggles =
    selected?.name === "resolution" ? (
      <p className="text-[13px] text-muted">Kometa picks the badge from each title's own resolution and edition. Turn either kind off under Style.</p>
    ) : (
      <p className="text-[13px] text-muted">Kometa decides this from each title's own details, and this default has no choices to make there. For your own rules, use an overlay file.</p>
    );

  const selectedChange = selected
    ? layerChangeSentence(selected.title, selected.entry?.layout, libraryVariables, savedValues(selected), draftValues(selected))
    : null;

  return (
    <>
      <LeaveGuard dirty={unsaved} query />
      {dialog}
      <div className="grid items-start gap-6 xl:grid-cols-[17rem_minmax(0,1fr)_21rem]">
        <section aria-labelledby="overlay-layers" className="flex flex-col gap-2">
          <h2 id="overlay-layers" className="text-[15px] font-semibold">
            Layers
          </h2>
          <p className="text-xs text-muted">Top draws last.</p>
          {displayLayers.length === 0 && <p className="text-sm text-muted">No overlay defaults yet. Add a layer to start.</p>}
          <ol className="flex flex-col gap-1.5">
            {displayLayers.map((layer, displayIndex) => (
              <li key={layer.name} className="flex items-center gap-1">
                <button
                  type="button"
                  aria-pressed={layer.name === selected?.name}
                  onClick={() => select(layer.name)}
                  onKeyDown={(event) => onLayerKeyDown(event, displayIndex)}
                  className={`flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-control border px-2.5 text-left text-sm ${layer.name === selected?.name ? "border-accent bg-surface-2" : "border-transparent text-muted hover:bg-surface-2"}`}
                >
                  <span className="min-w-0 truncate" title={layer.title}>
                    {layer.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted">{whereItIs(layer.entry?.layout, variablesOf(layer))}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={!hidden.has(layer.name)}
                  aria-label={hidden.has(layer.name) ? `Show ${layer.title} in the preview` : `Hide ${layer.title} in the preview`}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-control text-muted hover:bg-surface-2"
                  onClick={() =>
                    setHidden((current) => {
                      const next = new Set(current);
                      if (next.has(layer.name)) next.delete(layer.name);
                      else next.add(layer.name);
                      return next;
                    })
                  }
                >
                  {hidden.has(layer.name) ? <EyeOffIcon className="size-5" /> : <EyeIcon className="size-5" />}
                </button>
                <button
                  type="button"
                  aria-label={`Move ${layer.title} up`}
                  disabled={displayIndex === 0 || order.isPending}
                  onClick={() => moveLayer(displayIndex, 1)}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-control text-muted hover:bg-surface-2 disabled:opacity-30"
                >
                  <ChevronUpIcon className="size-5" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${layer.title} down`}
                  disabled={displayIndex === displayLayers.length - 1 || order.isPending}
                  onClick={() => moveLayer(displayIndex, -1)}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-control text-muted hover:bg-surface-2 disabled:opacity-30"
                >
                  <ChevronDownIcon className="size-5" />
                </button>
              </li>
            ))}
            {ownFiles.map((reference, index) => (
              <li key={`file-${index}`} className="flex items-center gap-2 rounded-control border border-transparent px-2.5 py-2 text-sm text-muted">
                <LockIcon className="size-5 shrink-0" />
                <Link className="min-h-11 flex-1 truncate underline" to={`/libraries/${encodeURIComponent(library)}?tab=overlays`}>
                  {reference.value}
                </Link>
              </li>
            ))}
          </ol>
          <div className="mt-2 flex flex-col gap-2">
            <span className="text-sm text-muted">Add a layer</span>
            <div className="flex flex-wrap gap-2">
              {addable.slice(0, 5).map((entry) => (
                <button
                  key={entry.name}
                  type="button"
                  disabled={add.isPending}
                  className="min-h-11 rounded-control border border-border-strong bg-surface-2 px-3 text-sm hover:border-accent"
                  onClick={() => {
                    add.mutate(entry.name);
                    if (!unsaved) setSelectedName(entry.name);
                  }}
                >
                  {shortTitle(entry.title ?? entry.name)}
                </button>
              ))}
              {addable.length > 5 && (
                <button type="button" className="min-h-11 rounded-control border border-dashed border-border-strong px-3 text-sm text-muted hover:text-text" onClick={() => setShowAllAddable(true)}>
                  All {addable.length}…
                </button>
              )}
            </div>
            {showAllAddable && (
              <ul className="max-h-48 overflow-y-auto rounded-control border border-border bg-bg p-2 text-sm">
                {addable.map((entry) => (
                  <li key={entry.name}>
                    <button
                      type="button"
                      className="min-h-11 w-full rounded-control px-2 text-left hover:bg-surface-2"
                      onClick={() => {
                        add.mutate(entry.name);
                        setShowAllAddable(false);
                        if (!unsaved) setSelectedName(entry.name);
                      }}
                    >
                      {shortTitle(entry.title ?? entry.name)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <SaveError error={add.error ?? drop.error ?? order.error} />
        </section>

        <section aria-label="Preview" className="flex min-w-0 flex-col items-center gap-4">
          <div className="flex rounded-control border border-border-strong bg-surface-2 p-1 text-sm" role="group" aria-label="Preview mode">
            <button
              type="button"
              aria-pressed={previewMode === "plex"}
              className={`min-h-11 rounded-control px-4 ${previewMode === "plex" ? "bg-surface text-text" : "text-muted"}`}
              onClick={() => setPreviewMode("plex")}
            >
              Now in Plex
            </button>
            <button
              type="button"
              aria-pressed={previewMode === "changes"}
              className={`min-h-11 rounded-control px-4 ${previewMode === "changes" ? "bg-surface text-text" : "text-muted"}`}
              onClick={() => setPreviewMode("changes")}
            >
              With your changes
            </button>
          </div>
          <SamplePicker samples={samples} />
          {samples.error && (
            <p role="alert" className="text-sm text-warn">
              Can't get posters from Plex: {samples.error.message}. Placement still shows.
            </p>
          )}
          <OverlayPoster
            item={samples.sample}
            boxes={previewMode === "plex" ? [] : boxes(samples.sample)}
            selected={selected?.name}
            onPick={previewMode === "changes" ? (box) => select(box.key.replace(/-\d+$/, "")) : undefined}
            imageUrl={previewMode === "changes" ? originalUrl : null}
            label={previewMode === "plex" ? `Plex poster for ${samples.sample?.title ?? "a title"}` : `Overlays on ${samples.sample?.title ?? "a poster"}`}
            className="w-full max-w-[340px] shadow-[0_20px_50px_rgba(0,0,0,0.45)]"
          />
          <p className="text-xs text-muted">Placement only: Kometa draws the real badges with their own images.</p>
        </section>

        {selected ? (
          <LayerSettings
            key={selected.name}
            layer={selected}
            libraryVariables={libraryVariables}
            libraryType={libraryType}
            root={schema.data?.root ?? null}
            values={draftValues(selected)}
            onChange={(values) => setDraft(selected.name, values)}
            onRemove={() => leave(() => drop.mutate(selected.name))}
            removing={drop.isPending}
            noToggles={noToggles}
            whatChanges={selectedChange ? studioChangeSentence([selectedChange], [], []) : null}
          />
        ) : (
          <p className="text-sm text-muted">Pick a layer to move and style it.</p>
        )}
      </div>

      {status?.off && (
        <p className="text-sm text-warn">
          Overlays are turned off for {library}, so nothing is drawn until they're back on.
        </p>
      )}
      {status?.maintainerr?.on_top && <p className="text-sm text-muted">Maintainerr's overlays still go on top of these.</p>}

      {unsaved && estimateText && (
        <ActionBar label="Overlay changes" summary={estimateText}>
          <Button onClick={undoAll} disabled={saving}>
            Undo
          </Button>
          <Button disabled={saving} onClick={() => void saveAll(false)}>
            {saving ? "Kometa is checking…" : "Save for tonight"}
          </Button>
          <Button variant="primary" disabled={saving} onClick={() => void saveAll(true)}>
            {saving ? "Kometa is checking…" : "Apply now"}
          </Button>
        </ActionBar>
      )}
      <SaveError error={batchError} />
    </>
  );
}
