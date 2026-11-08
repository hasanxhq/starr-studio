// Home: what needs attention, your collections, requests, and connections for the current library.

import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "react-router";

import { api } from "../api";
import { builderApi } from "../builderApi";
import { useLibrary } from "../library";
import { requestsApi } from "../requestsApi";
import { ComingIn } from "./home/ComingIn";
import { Connected } from "./home/Connected";
import { HomeHeader } from "./home/HomeHeader";
import { NeedsYou } from "./home/NeedsYou";
import { WhatChanged } from "./home/WhatChanged";
import { YourCollections } from "./home/YourCollections";
import { isActive } from "../runs";

export function Overview() {
  const setup = useQuery({ queryKey: ["config", "setup"], queryFn: api.config.setup, retry: false });
  if (setup.data && !setup.data.done) return <Navigate to="/setup" replace />;
  return <Home />;
}

function Home() {
  const { library, overview } = useLibrary();
  const status = useQuery({ queryKey: ["status"], queryFn: api.status, refetchInterval: 30_000 });
  const runs = useQuery({
    queryKey: ["runs"],
    queryFn: api.runs.list,
    refetchInterval: (query) => (query.state.data?.runs.some((r) => isActive(r.status)) ? 3000 : 15_000),
  });

  const collections = useQuery({
    queryKey: ["collections", library ?? ""],
    queryFn: () => builderApi.list(library!),
    enabled: !!library,
  });
  const others = useQuery({
    queryKey: ["collections", library ?? "", "others"],
    queryFn: () => builderApi.others(library!),
    enabled: !!library,
  });
  const requests = useQuery({ queryKey: ["requests", "list", ""], queryFn: () => requestsApi.list({ status: "", limit: 200 }) });

  if (overview.isPending) return <p className="text-muted">Loading…</p>;
  if (!library) {
    return (
      <p className="text-muted">
        {overview.isError ? "Can't read the config. " : "config.yml has no libraries yet. "}
        <Link className="underline hover:text-text" to="/libraries">
          Libraries
        </Link>
      </p>
    );
  }

  const built = collections.data?.collections ?? [];
  const otherRows = others.data?.others ?? [];
  const readyMade = otherRows.filter((o) => o.made_by === "ready_made");
  const failed = built.filter((c) => c.state === "failed");
  const healthErrors = status.data?.health.filter((c) => c.level === "error") ?? [];
  const allRuns = runs.data?.runs;

  return (
    <div className="flex max-w-6xl flex-col gap-4">
      {runs.isError && (
        <p role="alert" className="text-err">
          Can't reach the Studio API: {runs.error.message}
        </p>
      )}
      <HomeHeader library={library} collectionCount={built.length + readyMade.length} nextAt={status.data?.runs?.next_scheduled?.at} />
      <NeedsYou library={library} failed={failed} failedRequests={requests.data?.counts.failed ?? 0} healthErrors={healthErrors} />
      <YourCollections library={library} collections={built} others={otherRows} />
      <ComingIn />
      <WhatChanged runs={allRuns} />
      <Connected />
    </div>
  );
}
