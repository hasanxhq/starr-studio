import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { api, type FullCheck } from "../../api";
import { Card } from "../../components/ui";

type Level = "ok" | "warn" | "err" | "unknown";

const dots: Record<Level, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  err: "bg-err",
  unknown: "bg-muted",
};

const sr: Record<Level, string> = {
  ok: "OK",
  warn: "Warning",
  err: "Error",
  unknown: "Not checked",
};

const services: { id: string; label: string; test: RegExp }[] = [
  { id: "plex", label: "Plex", test: /plex/i },
  { id: "radarr", label: "Radarr", test: /radarr/i },
  { id: "sonarr", label: "Sonarr", test: /sonarr/i },
  { id: "seerr", label: "Seerr", test: /seerr|overseerr/i },
  { id: "tmdb", label: "TMDb", test: /tmdb/i },
];

function levelForService(check: FullCheck | null, pattern: RegExp): Level {
  if (!check) return "unknown";
  const err = check.errors.some((line) => pattern.test(line));
  if (err) return "err";
  const warn = check.warnings.some((line) => pattern.test(line)) || check.existing_errors.some((line) => pattern.test(line));
  if (warn) return "warn";
  if (check.ok) return "ok";
  return "ok";
}

function kometaLevel(check: FullCheck | null): Level {
  if (!check) return "unknown";
  if (check.crashed) return "err";
  if (!check.ok) return "warn";
  return "ok";
}

export function Connected() {
  const last = useQuery({ queryKey: ["full-check"], queryFn: api.fullCheck.last });
  const status = useQuery({ queryKey: ["status"], queryFn: api.status });
  const check = last.data?.last ?? null;
  const version = status.data?.kometa.version;

  return (
    <Card
      title="Connected"
      actions={
        <Link className="min-h-11 content-center text-sm text-muted underline hover:text-text" to="/system/status">
          System status
        </Link>
      }
    >
      <ul className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
        {services.map((service) => {
          const level = levelForService(check, service.test);
          return (
            <li key={service.id} className="flex items-center gap-2">
              <span aria-hidden="true" className={`inline-block size-2.5 rounded-full ${dots[level]}`} />
              <span>
                {service.label}
                <span className="sr-only">, {sr[level]}</span>
              </span>
            </li>
          );
        })}
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className={`inline-block size-2.5 rounded-full ${dots[kometaLevel(check)]}`} />
          <span>
            Kometa {version ?? "–"}
            <span className="sr-only">, {sr[kometaLevel(check)]}</span>
          </span>
        </li>
      </ul>
    </Card>
  );
}
