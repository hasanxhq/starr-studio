// The picked style's file in the YAML editor, for power users. Shipped styles are read-only; user styles save with "Save file".

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";

import { Button } from "../../../components/ui";
import { overlayEngine } from "../../../overlayEngineApi";

const YamlEditor = lazy(() => import("../../../components/YamlEditor"));

export function StyleYaml({ styleId, shipped }: { styleId: string; shipped: boolean }) {
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ["overlay-engine", "style", styleId], queryFn: () => overlayEngine.styles.get(styleId) });
  const [edited, setEdited] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (yaml: string) => overlayEngine.styles.save(styleId, yaml),
    onSuccess: (saved) => {
      queryClient.setQueryData(["overlay-engine", "style", styleId], saved);
      setEdited(null);
      void queryClient.invalidateQueries({ queryKey: ["overlay-engine", "styles"] }); // its options may have changed
    },
  });

  if (detail.isPending) return <p className="pt-3 text-sm text-muted">Loading…</p>;
  if (detail.isError) return <p role="alert" className="pt-3 text-sm text-err">{detail.error.message}</p>;
  const text = edited ?? detail.data.yaml;
  const dirty = text !== detail.data.yaml;

  return (
    <div className="flex flex-col gap-3 pt-3">
      {shipped && <p className="text-sm text-muted">Shipped with Studio: duplicate it to edit.</p>}
      <Suspense fallback={<p className="text-sm text-muted">Loading the editor…</p>}>
        <YamlEditor key={styleId} value={text} onChange={setEdited} kind="style" label={`Style file ${styleId}`} readOnly={shipped} />
      </Suspense>
      {!shipped && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(text)}>
            {save.isPending ? "Saving…" : "Save file"}
          </Button>
          {dirty && (
            <Button disabled={save.isPending} onClick={() => setEdited(null)}>
              Undo changes
            </Button>
          )}
        </div>
      )}
      {save.isError && (
        <p role="alert" className="text-sm text-err">
          {save.error.message}
        </p>
      )}
    </div>
  );
}
