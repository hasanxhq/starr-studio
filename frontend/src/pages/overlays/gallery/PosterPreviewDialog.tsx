import { useEffect, useId, useState } from "react";

import { api } from "../../../api";
import { Button } from "../../../components/ui";
import type { GalleryPoster } from "../../../overlayEngineApi";
import { overlayEngine } from "../../../overlayEngineApi";

export function PosterPreviewDialog({ item, library, onClose }: { item: GalleryPoster; library: string; onClose: () => void }) {
  const titleId = useId();
  const [studioUrl, setStudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const plexUrl = item.thumb ? api.plexLibraries.imageUrl(item.thumb, 240, 360) : null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setStudioUrl(null);
    (async () => {
      try {
        const blob = await overlayEngine.preview({ rating_key: item.rating_key, library });
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        revoked = url;
        setStudioUrl(url);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [item.rating_key, library]);

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex w-full max-w-3xl flex-col gap-4 rounded-card border border-border-strong bg-surface p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="font-semibold">
          Preview — {item.title}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <figure className="flex flex-col gap-2">
            <figcaption className="text-sm text-muted">In Plex now</figcaption>
            {plexUrl ? (
              <img src={plexUrl} alt={item.title} className="aspect-[2/3] w-full rounded border border-border object-cover" />
            ) : (
              <p className="text-sm text-muted">No poster in Plex.</p>
            )}
          </figure>
          <figure className="flex flex-col gap-2">
            <figcaption className="text-sm text-muted">Studio version</figcaption>
            {loading ? (
              <p className="text-sm text-muted">Loading preview…</p>
            ) : error ? (
              <p role="alert" className="text-sm text-err">
                {error}
              </p>
            ) : studioUrl ? (
              <img src={studioUrl} alt={`Studio poster for ${item.title}`} className="aspect-[2/3] w-full rounded border border-border object-cover" />
            ) : null}
          </figure>
        </div>
        <div className="flex justify-end">
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}