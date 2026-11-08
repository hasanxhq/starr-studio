import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

import { requestsApi } from "../../requestsApi";
import { Checkbox, Field, inputClass } from "../../components/ui";

export function MissingTabControls({
  libraryType,
  downloadMissing,
  requestCap,
  requestProfile,
  onDownloadMissing,
  onRequestCap,
  onRequestProfile,
  requestsEnabled,
}: {
  libraryType: "movie" | "show";
  downloadMissing: boolean;
  requestCap: number | null;
  requestProfile: string | null;
  onDownloadMissing: (value: boolean) => void;
  onRequestCap: (value: number | null) => void;
  onRequestProfile: (value: string | null) => void;
  requestsEnabled: boolean;
}) {
  const [help, setHelp] = useState(false);
  const app = libraryType === "show" ? "sonarr" : "radarr";
  const appName = app === "sonarr" ? "Sonarr" : "Radarr";
  const settings = useQuery({ queryKey: ["requests", "settings"], queryFn: requestsApi.settings });
  const via = settings.data?.settings.via;
  const viaSeerr = via === "seerr" || (via === "auto" && settings.data?.connected.seerr === true);
  const options = useQuery({
    queryKey: ["requests", "options"],
    queryFn: requestsApi.options,
    enabled: downloadMissing && requestsEnabled,
  });
  const profiles = (viaSeerr ? options.data?.seerr?.[app] : options.data?.[app])?.quality_profiles ?? [];
  const defaultProfile = viaSeerr ? "Seerr's" : (settings.data?.settings[app].quality_profile ?? `${appName}'s first`);
  const notIn = viaSeerr ? `not on Seerr's ${appName} server` : `not in ${appName}`;
  const capText = requestCap === null ? "" : String(requestCap);

  return (
    <div className="flex flex-col gap-3 border-b border-border pb-4">
      <div className="flex flex-wrap items-start gap-2">
        <Checkbox checked={downloadMissing} onChange={onDownloadMissing} disabled={!requestsEnabled}>
          Download missing
        </Checkbox>
        {!requestsEnabled && (
          <button
            type="button"
            className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-control border border-border text-xs text-muted hover:text-text"
            aria-label="Why Download missing is off"
            aria-expanded={help}
            onClick={() => setHelp((open) => !open)}
          >
            ?
          </button>
        )}
      </div>
      {!requestsEnabled && (
        <p className="text-sm text-muted">Requests are off in Settings → Requests</p>
      )}
      {help && !requestsEnabled && (
        <p className="text-sm text-muted">
          Turn on requests in{" "}
          <Link className="underline hover:text-text" to="/settings/requests">
            Settings → Requests
          </Link>{" "}
          first.
        </p>
      )}
      {downloadMissing && requestsEnabled && viaSeerr && <p className="text-sm text-muted">Requests go through Seerr.</p>}
      {downloadMissing && requestsEnabled && (
        <Field label="Quality profile" hint={viaSeerr ? `From Seerr's default ${appName} server. The default is Seerr's own.` : "The default is set in Settings → Requests."}>
          <select
            className={`${inputClass} w-56`}
            value={requestProfile ?? ""}
            onChange={(event) => onRequestProfile(event.target.value || null)}
            aria-label="Quality profile"
          >
            <option value="">{`Default (${defaultProfile})`}</option>
            {profiles.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            {requestProfile && options.isSuccess && !profiles.includes(requestProfile) && (
              <option value={requestProfile}>{`${requestProfile} (${notIn}, uses the default)`}</option>
            )}
            {requestProfile && !options.isSuccess && <option value={requestProfile}>{requestProfile}</option>}
          </select>
        </Field>
      )}
      {downloadMissing && requestsEnabled && (
        <Field label="Most per day" hint="Empty uses the setting under Settings → Requests.">
          <input
            type="number"
            min={1}
            className={`${inputClass} w-28`}
            value={capText}
            onChange={(event) => {
              const raw = event.target.value.trim();
              if (raw === "") {
                onRequestCap(null);
                return;
              }
              const number = Number.parseInt(raw, 10);
              onRequestCap(Number.isFinite(number) ? number : null);
            }}
            aria-label="Most per day"
            placeholder="No limit"
          />
        </Field>
      )}
    </div>
  );
}
