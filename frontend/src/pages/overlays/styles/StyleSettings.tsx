// The library's overlay style: pick a style, set its options, save. Power users get the style file's YAML and
// duplicate / delete / export / import. docs/plans/overlay-engine.md, Phase 3.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button, Card, Tag } from "../../../components/ui";
import { overlayEngine, type LibraryStyle, type StyleDetail, type StyleSummary } from "../../../overlayEngineApi";
import { OptionsForm } from "./OptionsForm";
import { StyleActions } from "./StyleActions";
import { StyleYaml } from "./StyleYaml";

type Values = Record<string, unknown>;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function defaultsOf(style: StyleSummary): Values {
  return Object.fromEntries(Object.entries(style.options).map(([key, opt]) => [key, opt.default]));
}

/** The library's saved values when it's the saved style, else the defaults. */
function startingValues(style: StyleSummary, saved: LibraryStyle | undefined): Values {
  return saved?.style === style.id ? { ...defaultsOf(style), ...saved.values } : defaultsOf(style);
}

export function StyleSettings({ library }: { library: string }) {
  const queryClient = useQueryClient();
  const styles = useQuery({ queryKey: ["overlay-engine", "styles"], queryFn: overlayEngine.styles.list });
  const libraryStyle = useQuery({ queryKey: ["overlay-engine", "library-style", library], queryFn: () => overlayEngine.library.style(library) });
  // What the user picked or changed and hasn't saved; null shows the library's saved style.
  const [draft, setDraft] = useState<{ id: string; values: Values } | null>(null);

  const saved = libraryStyle.data;
  const list = styles.data ?? [];
  const picked = list.find((style) => style.id === (draft?.id ?? saved?.style)) ?? null;
  const values = draft?.values ?? (picked ? startingValues(picked, saved) : {});
  const dirty = picked !== null && (picked.id !== saved?.style || !same(values, startingValues(picked, saved)));

  const save = useMutation({
    mutationFn: (style: StyleSummary) =>
      overlayEngine.library.setStyle(library, style.id, Object.fromEntries(Object.entries(values).filter(([key, value]) => key in style.options && !same(value, style.options[key].default)))),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["overlay-engine", "library-style", library] });
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ["overlay-engine", "posters", library] });
    },
  });

  const pick = (style: StyleSummary) => {
    save.reset();
    setDraft({ id: style.id, values: startingValues(style, saved) });
  };

  const added = async (style: StyleDetail) => {
    await queryClient.invalidateQueries({ queryKey: ["overlay-engine", "styles"] });
    pick(style);
  };

  const deleted = async (id: string) => {
    setDraft(null);
    queryClient.removeQueries({ queryKey: ["overlay-engine", "style", id] });
    await queryClient.invalidateQueries({ queryKey: ["overlay-engine", "styles"] });
  };

  if (styles.isError || libraryStyle.isError) {
    return (
      <Card title="Style">
        <p role="alert" className="text-sm text-err">
          {(styles.error ?? libraryStyle.error)?.message}
        </p>
      </Card>
    );
  }
  if (styles.isPending || libraryStyle.isPending) {
    return (
      <Card title="Style">
        <p className="text-sm text-muted">Loading…</p>
      </Card>
    );
  }

  return (
    <Card title="Style">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start gap-4">
          <fieldset className="flex min-w-0 flex-1 basis-80 flex-col gap-1.5">
            <legend className="sr-only">Style for {library}</legend>
            {list.map((style) => (
              <label
                key={style.id}
                className={`flex min-h-11 items-start gap-2.5 rounded-control border px-3 py-2 text-sm ${picked?.id === style.id ? "border-accent bg-surface-2" : "border-border-strong"} ${style.error ? "opacity-70" : "cursor-pointer"}`}
              >
                <input type="radio" name="overlay-style" className="mt-1 shrink-0 accent-accent" checked={picked?.id === style.id} disabled={style.error !== null} onChange={() => pick(style)} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{style.name}</span>
                    {style.shipped && <Tag>Shipped</Tag>}
                  </span>
                  {style.description && <span className="text-xs text-muted">{style.description}</span>}
                  {style.error && <span className="text-xs text-err">{style.error}</span>}
                </span>
              </label>
            ))}
            {!picked && saved && (
              <p role="alert" className="text-sm text-warn">
                This library's style, {saved.style}, isn't among the style files any more: pick another and save.
              </p>
            )}
          </fieldset>
          {picked && <StyleActions style={picked} onAdded={(style) => void added(style)} onDeleted={() => void deleted(picked.id)} />}
        </div>

        {picked && (
          <>
            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">Options</h3>
                <Button onClick={() => setDraft({ id: picked.id, values: defaultsOf(picked) })}>Reset to defaults</Button>
              </div>
              <OptionsForm options={picked.options} values={values} onChange={(next) => setDraft({ id: picked.id, values: next })} />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(picked)}>
                {save.isPending ? "Saving…" : "Save"}
              </Button>
              <p className="text-sm text-muted">Saving changes Studio's settings only: Plex changes when you apply overlays in the gallery.</p>
            </div>
            {save.isError && (
              <p role="alert" className="text-sm text-err">
                {save.error.message}
              </p>
            )}
            <details className="text-sm">
              <summary className="min-h-11 cursor-pointer content-center text-muted hover:text-text">Style file (YAML)</summary>
              <StyleYaml key={picked.id} styleId={picked.id} shipped={picked.shipped} />
            </details>
          </>
        )}
      </div>
    </Card>
  );
}
