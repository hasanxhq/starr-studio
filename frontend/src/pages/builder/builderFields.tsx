import { useEffect, useRef, useState } from "react";

import { builderApi, isKometaPosterUrl, posterPreviewSrc, type Poster } from "../../builderApi";
import { Field, inputClass } from "../../components/ui";

type PosterMode = "plex" | "upload" | "url" | "kometa";

function posterMode(poster: Poster, kometaUrl: string | null): PosterMode {
  if (!poster) return "plex";
  if (poster.kind === "file") return "upload";
  if (kometaUrl && poster.kind === "url" && poster.url === kometaUrl) return "kometa";
  if (poster.kind === "url" && isKometaPosterUrl(poster.url) && kometaUrl === poster.url) return "kometa";
  return "url";
}

export function VisibleCheck({
  checked,
  onChange,
  children,
}: {
  checked: boolean | null;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = checked === null;
  }, [checked]);
  return (
    <label className="flex min-h-11 items-start gap-2 text-sm">
      <input
        ref={ref}
        type="checkbox"
        className="mt-1 size-4 shrink-0 accent-accent"
        checked={checked === true}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        {children}
        {checked === null && <span className="block text-xs text-muted">Plex&apos;s setting</span>}
      </span>
    </label>
  );
}

export function PosterSection({
  poster,
  kometaUrl,
  onChange,
  heading,
  help,
  radioName = "poster",
  squarePreview = false,
}: {
  poster: Poster;
  kometaUrl: string | null;
  onChange: (poster: Poster) => void;
  heading?: string;
  help?: string;
  radioName?: string;
  squarePreview?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [mode, setModeState] = useState<PosterMode>(() => posterMode(poster, kometaUrl));
  const preview = posterPreviewSrc(poster);

  const setMode = (next: PosterMode) => {
    setUploadError(null);
    setModeState(next);
    if (next === "plex") onChange(null);
    else if (next === "kometa" && kometaUrl) onChange({ kind: "url", url: kometaUrl });
    else if (next === "upload") {
      if (poster?.kind !== "file") onChange(null);
    } else if (next === "url") {
      onChange(poster?.kind === "url" && (!kometaUrl || poster.url !== kometaUrl) ? poster : { kind: "url", url: "" });
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      onChange(await builderApi.uploadPoster(file));
      setModeState("upload");
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const legend = heading ?? "Poster source";
  const uploadLabel = heading ? `Upload ${heading.toLowerCase()}` : "Upload poster";
  const urlLabel = heading ? `${heading} URL` : "Poster URL";
  const previewLabel = heading ? `${heading} preview` : "Poster preview";

  return (
    <div className="flex flex-col gap-3">
      {heading && (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">{heading}</h3>
          {help && <p className="text-sm text-muted">{help}</p>}
        </div>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">{legend}</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="radio" name={radioName} className="size-4 accent-accent" checked={mode === "plex"} onChange={() => setMode("plex")} />
          Plex&apos;s own
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="radio" name={radioName} className="size-4 accent-accent" checked={mode === "upload"} onChange={() => setMode("upload")} />
          Upload an image
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="radio" name={radioName} className="size-4 accent-accent" checked={mode === "url"} onChange={() => setMode("url")} />
          Image link
        </label>
        {kometaUrl && (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="radio" name={radioName} className="size-4 accent-accent" checked={mode === "kometa"} onChange={() => setMode("kometa")} />
            Kometa&apos;s artwork
          </label>
        )}
      </fieldset>
      {mode === "upload" && (
        <Field label="Image file" hint="JPEG, PNG or WebP, up to 10 MB">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            className="min-h-11 text-sm file:mr-3 file:min-h-11 file:rounded-control file:border file:border-border-strong file:bg-surface-2 file:px-4 file:text-text"
            disabled={uploading}
            onChange={(event) => {
              void onFile(event.target.files?.[0]);
              event.target.value = "";
            }}
            aria-label={uploadLabel}
          />
        </Field>
      )}
      {mode === "url" && (
        <Field label="Image URL">
          <input
            className={inputClass}
            type="url"
            value={poster?.kind === "url" ? poster.url : ""}
            onChange={(event) => onChange({ kind: "url", url: event.target.value })}
            placeholder="https://"
            aria-label={urlLabel}
          />
        </Field>
      )}
      {uploadError && (
        <p role="alert" className="text-sm text-err">
          {uploadError}
        </p>
      )}
      {uploading && <p className="text-sm text-muted">Uploading…</p>}
      <div
        className={`w-28 overflow-hidden rounded-control border border-border bg-surface-2 ${squarePreview ? "aspect-square" : "aspect-[2/3]"}`}
        aria-label={previewLabel}
      >
        {preview ? (
          <img src={preview} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center p-2 text-center text-xs text-muted">
            {mode === "plex" ? "Plex mosaic" : "No image yet"}
          </div>
        )}
      </div>
    </div>
  );
}
