import { Link } from "react-router";

import { ActionBar, Button, Checkbox } from "../../components/ui";

export function BuildBar({
  library,
  showDownload,
  downloadMissing,
  requestCount,
  requestsKnown,
  downloadDisabled,
  onDownloadMissing,
  saving,
  saveAction,
  canSubmit,
  saveHint,
  onSaveForLater,
  onBuild,
}: {
  library: string;
  showDownload: boolean;
  downloadMissing: boolean;
  requestCount: number | null;
  requestsKnown: boolean;
  downloadDisabled?: boolean;
  onDownloadMissing: (value: boolean) => void;
  saving: boolean;
  saveAction: "build" | "later" | null;
  canSubmit: boolean;
  saveHint: string | null;
  onSaveForLater: () => void;
  onBuild: () => void;
}) {
  const buildHintId = saveHint ? "build-bar-save-hint" : undefined;
  const downloadLabel =
    requestsKnown && requestCount != null ? `Download ${requestCount} missing` : "Download missing";

  return (
    <ActionBar label="Build collection" summary="Plex keeps it up to date after that">
      {showDownload && (
        <Checkbox checked={downloadMissing} onChange={onDownloadMissing} disabled={downloadDisabled}>
          {downloadLabel}
        </Checkbox>
      )}
      <Link className="min-h-11 px-3 text-sm underline" to={`/collections?library=${encodeURIComponent(library)}`}>
        Cancel
      </Link>
      <Button variant="secondary" onClick={onSaveForLater} disabled={!canSubmit || saving} aria-describedby={buildHintId}>
        {saving && saveAction === "later" ? "Saving…" : "Save for later"}
      </Button>
      <Button variant="primary" onClick={onBuild} disabled={!canSubmit || saving} aria-describedby={buildHintId}>
        {saving && saveAction === "build" ? "Building…" : "Build"}
      </Button>
      {saveHint && (
        <p id={buildHintId} className="w-full text-sm text-muted">
          {saveHint}
        </p>
      )}
    </ActionBar>
  );
}
