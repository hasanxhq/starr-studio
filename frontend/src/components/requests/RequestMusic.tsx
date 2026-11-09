// Requests → "Request music": search Lidarr for albums and request one into a music library.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { useLibrary } from "../../library";
import { requestsApi, type MusicAlbum, type RequestStatus } from "../../requestsApi";
import { Button, Card, Field, inputClass } from "../ui";
import { useMusicLibraries } from "./musicLibraries";

const STATUS_LABEL: Record<RequestStatus, string> = {
  requested: "Requested",
  downloading: "Downloading",
  imported: "Imported",
  failed: "Failed",
  cancelled: "Cancelled",
  exists: "Already there",
};

function Album({ album, onRequest, busy, locked, error }: { album: MusicAlbum; onRequest: () => void; busy: boolean; locked: boolean; error: string | null }) {
  return (
    <li className="flex w-36 flex-col gap-1.5">
      {album.cover ? (
        <img src={album.cover} alt="" loading="lazy" className="aspect-square w-full rounded-control bg-surface-2 object-cover" />
      ) : (
        <div aria-hidden className="aspect-square w-full rounded-control bg-surface-2" />
      )}
      <p className="text-sm font-medium leading-tight">{album.title}</p>
      <p className="text-xs text-muted">{[album.artist, album.year].filter(Boolean).join(" · ")}</p>
      {album.in_lidarr ? (
        <span className="text-xs text-muted">In Lidarr</span>
      ) : album.request ? (
        <span className="text-xs text-muted">{STATUS_LABEL[album.request.status]}</span>
      ) : (
        <Button onClick={onRequest} disabled={locked} aria-label={`Request ${album.title}`}>
          {busy ? "Requesting…" : "Request"}
        </Button>
      )}
      {error && (
        <p role="alert" className="text-xs text-err">
          {error}
        </p>
      )}
    </li>
  );
}

export function RequestMusic() {
  const queryClient = useQueryClient();
  const { library } = useLibrary();
  const music = useMusicLibraries();
  const [term, setTerm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const search = useMutation({ mutationFn: (text: string) => requestsApi.musicSearch(text) });
  const target = library && music.includes(library) ? library : music[0];
  const request = useMutation({
    mutationFn: (album: MusicAlbum) => requestsApi.requestItems(target, [{ item: album.item, title: album.title, year: album.year }]),
    onSuccess: (outcome, album) => {
      const failed = outcome.items.find((entry) => entry.item === album.item && entry.status === "failed");
      setErrors((prev) => ({ ...prev, [album.item]: failed ? (failed.error ?? "Lidarr couldn't add it.") : "" }));
      queryClient.invalidateQueries({ queryKey: ["requests"] });
      if (term.trim()) search.mutate(term.trim());
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setErrors({});
    request.reset();
    if (term.trim()) search.mutate(term.trim());
  };

  return (
    <Card title="Request music">
      <form onSubmit={submit} aria-label="Search music" className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <Field label="Album or artist">
            <input className={inputClass} value={term} onChange={(e) => setTerm(e.target.value)} />
          </Field>
        </div>
        <Button type="submit" disabled={!term.trim() || search.isPending}>
          {search.isPending ? "Searching…" : "Search"}
        </Button>
      </form>
      {search.isError && (
        <p role="alert" className="mt-3 text-sm text-err">
          {search.error.message}
        </p>
      )}
      {request.isError && (
        <p role="alert" className="mt-3 text-sm text-err">
          {request.error.message}
        </p>
      )}
      {search.data &&
        (search.data.albums.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No albums found.</p>
        ) : (
          <ul aria-label="Albums" className="mt-4 flex flex-wrap gap-4">
            {search.data.albums.map((album) => (
              <Album key={album.item} album={album} onRequest={() => request.mutate(album)} busy={request.isPending && request.variables?.item === album.item} locked={request.isPending} error={errors[album.item] || null} />
            ))}
          </ul>
        ))}
    </Card>
  );
}
