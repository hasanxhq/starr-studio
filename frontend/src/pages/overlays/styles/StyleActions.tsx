// Duplicate, Delete, Export and Import for the picked style.

import { useRef, useState } from "react";

import { Button, ConfirmButton } from "../../../components/ui";
import { overlayEngine, type StyleDetail, type StyleSummary } from "../../../overlayEngineApi";

export function StyleActions({ style, onAdded, onDeleted }: { style: StyleSummary; onAdded: (style: StyleDetail) => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(name);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled={busy !== null} onClick={() => void run("duplicate", async () => onAdded(await overlayEngine.styles.duplicate(style.id)))}>
        {busy === "duplicate" ? "Duplicating…" : "Duplicate"}
      </Button>
      <a
        href={overlayEngine.styles.exportUrl(style.id)}
        download
        className="inline-flex min-h-11 items-center justify-center rounded-control border border-border-strong bg-surface-2 px-4 text-sm font-medium text-text transition hover:border-muted"
      >
        Export
      </a>
      <Button disabled={busy !== null} onClick={() => fileInput.current?.click()}>
        {busy === "import" ? "Importing…" : "Import"}
      </Button>
      <input
        ref={fileInput}
        type="file"
        accept=".zip,.yml,.yaml"
        className="sr-only"
        tabIndex={-1}
        aria-label="Import a style file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // so picking the same file again still fires
          if (file) void run("import", async () => onAdded(await overlayEngine.styles.import(file)));
        }}
      />
      {!style.shipped && (
        <ConfirmButton
          key={style.id}
          label="Delete"
          confirm="Delete style"
          warning={`Delete "${style.name}"?`}
          busy={busy === "delete"}
          busyLabel="Deleting…"
          onConfirm={() =>
            void run("delete", async () => {
              await overlayEngine.styles.remove(style.id);
              onDeleted();
            })
          }
        />
      )}
      {error && (
        <p role="alert" className="basis-full text-sm text-err">
          {error}
        </p>
      )}
    </div>
  );
}
