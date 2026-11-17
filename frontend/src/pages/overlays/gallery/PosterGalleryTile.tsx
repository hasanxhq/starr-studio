import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { createPortal } from "react-dom";

import { api } from "../../../api";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { PosterTile } from "../../../components/PosterTile";
import { Button, Tag } from "../../../components/ui";
import type { GalleryPoster, Outcome, OutcomeKind } from "../../../overlayEngineApi";
import { overlayEngine } from "../../../overlayEngineApi";
import { canConfirm } from "./constants";
import { PosterPreviewDialog } from "./PosterPreviewDialog";

function outcomeFor(list: Outcome[], ratingKey: string): Outcome | undefined {
  return list.find((o) => o.rating_key === ratingKey) ?? list[0];
}

export function PosterGalleryTile({ item, library }: { item: GalleryPoster; library: string }) {
  const queryClient = useQueryClient();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [status, setStatus] = useState<{ kind: OutcomeKind; message: string } | null>(null);
  const [confirm, setConfirm] = useState<{ action: "apply" | "repair" | "restore"; message: string } | null>(null);

  const run = useMutation({
    mutationFn: async (vars: { action: "apply" | "repair" | "restore"; dryRun: boolean }) => {
      if (vars.action === "restore") {
        return overlayEngine.restore(library, [item.rating_key], vars.dryRun);
      }
      return overlayEngine.apply({
        library,
        rating_keys: [item.rating_key],
        ...(vars.dryRun ? {} : { dry_run: false }),
        ...(vars.action === "repair" ? { force: true } : {}),
      });
    },
    onSuccess: (data, vars) => {
      const outcome = outcomeFor(data.outcomes, item.rating_key);
      if (!outcome) return;
      if (vars.dryRun) {
        if (canConfirm(outcome.kind)) {
          setConfirm({ action: vars.action, message: outcome.message });
        } else {
          setStatus({ kind: outcome.kind, message: outcome.message });
        }
      } else {
        setStatus({ kind: outcome.kind, message: outcome.message });
        void queryClient.invalidateQueries({ queryKey: ["overlay-engine", "posters", library] });
      }
    },
  });

  const busy = run.isPending;
  const start = (action: "apply" | "repair" | "restore") => {
    setConfirm(null);
    run.mutate({ action, dryRun: true });
  };

  const thumb = item.thumb ? api.plexLibraries.imageUrl(item.thumb, 240, 360) : null;

  const dialog = (node: ReactNode) => (typeof document !== "undefined" ? createPortal(node, document.body) : node);

  return (
    <>
      <PosterTile
        title={item.title}
        onOpen={() => setPreviewOpen(true)}
        art={
          thumb ? (
            <img src={thumb} alt={item.title} loading="lazy" className="aspect-[2/3] w-full bg-surface-2 object-cover" />
          ) : (
            <div className="flex aspect-[2/3] w-full items-center justify-center bg-surface-2 text-xs text-muted">No poster</div>
          )
        }
        badge={
          item.studio_poster ? (
            <Tag tone="ok">
              Studio poster{item.style ? ` · ${item.style}` : ""}
            </Tag>
          ) : undefined
        }
        footer={
          <div className="mt-2 flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              {!item.studio_poster ? (
                <Button className="min-h-11" disabled={busy} onClick={() => start("apply")}>
                  Apply
                </Button>
              ) : (
                <>
                  <Button className="min-h-11" disabled={busy} onClick={() => start("repair")}>
                    Repair
                  </Button>
                  <Button className="min-h-11" disabled={busy} onClick={() => start("restore")}>
                    Restore
                  </Button>
                </>
              )}
            </div>
            {status ? (
              <p role={status.kind === "error" ? "alert" : "status"} className={`text-xs ${status.kind === "error" ? "text-err" : "text-muted"}`}>
                {status.message}
              </p>
            ) : null}
          </div>
        }
      >
        <span className="mt-2 line-clamp-2 text-sm font-medium">{item.title}</span>
        {item.year != null ? <span className="text-xs text-muted">{item.year}</span> : null}
      </PosterTile>

      {previewOpen ? dialog(<PosterPreviewDialog item={item} library={library} onClose={() => setPreviewOpen(false)} />) : null}

      {confirm
        ? dialog(
            <ConfirmDialog
              title={confirm.action === "restore" ? "Restore original poster" : confirm.action === "repair" ? "Repair Studio poster" : "Apply Studio poster"}
              confirm={confirm.action === "restore" ? "Restore" : confirm.action === "repair" ? "Repair" : "Apply"}
              danger
              busy={busy}
              onCancel={() => setConfirm(null)}
              onConfirm={() => {
                run.mutate({ action: confirm.action, dryRun: false });
                setConfirm(null);
              }}
            >
              <p>{confirm.message}</p>
              <p className="mt-2 text-warn">This changes the poster in Plex.</p>
            </ConfirmDialog>,
          )
        : null}
    </>
  );
}