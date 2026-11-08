import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ComponentType, useState } from "react";
import { Link, Outlet, useLocation } from "react-router";

import { useAdvanced } from "../advanced";
import { api } from "../api";
import { builderApi } from "../builderApi";
import {
  ActivityIcon,
  CollectionsIcon,
  HomeIcon,
  OverlaysIcon,
  PlaylistsIcon,
  RequestsIcon,
  SettingsIcon,
  SystemIcon,
} from "./icons";
import { HeaderTitleProvider, useHeaderTitleValue } from "./HeaderTitle";
import { JobsDrawer } from "./Jobs";
import { RunCard } from "./RunCard";
import { useLibrary } from "../library";
import { PosterMark, Wordmark } from "./Logo";
import { SectionTabs } from "./SectionTabs";
import { pageTitle, sidebarEntries } from "../nav";
import { requestsApi } from "../requestsApi";

function navLinkClass({ isActive }: { isActive: boolean }) {
  return [
    "flex min-h-11 items-center gap-3 rounded-control px-3 text-sm transition-colors",
    isActive ? "bg-surface-2 text-accent" : "text-muted hover:bg-surface-2 hover:text-text",
  ].join(" ");
}

const ENTRY_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  "/": HomeIcon,
  "/collections": CollectionsIcon,
  "/requests": RequestsIcon,
  "/overlays": OverlaysIcon,
  "/playlists": PlaylistsIcon,
  "/activity": ActivityIcon,
  "/system": SystemIcon,
  "/settings": SettingsIcon,
};

function isEntryActive(path: string, pathname: string): boolean {
  if (path === "/") return pathname === "/";
  if (path === "/collections") return pathname.startsWith("/collections") || pathname.startsWith("/ready-made");
  if (path === "/settings") return pathname.startsWith("/settings") || pathname.startsWith("/libraries");
  return pathname === path || pathname.startsWith(path + "/");
}

function LibraryPicker() {
  const { library, libraries, setLibrary } = useLibrary();
  if (libraries.length === 0) return null;
  return (
    <div className="px-3 pb-3">
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        <span>Library</span>
        <select
          value={library ?? ""}
          onChange={(event) => setLibrary(event.target.value)}
          className="min-h-11 w-full rounded-control border border-border-strong bg-surface-2 px-3 text-sm text-text focus:border-accent focus:outline-none"
        >
          {libraries.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

// A dot on System while a health check is failing, as the arr apps do.
function HealthDot() {
  const status = useQuery({ queryKey: ["status"], queryFn: api.status, refetchInterval: 60_000 });
  const checks = status.data?.health ?? [];
  const level = checks.some((c) => c.level === "error") ? "error" : checks.some((c) => c.level === "warning") ? "warning" : null;
  if (!level) return null;
  return (
    <span
      className={`ml-auto size-2 rounded-full ${level === "error" ? "bg-err" : "bg-warn"}`}
      role="img"
      aria-label={level === "error" ? "Health errors" : "Health warnings"}
    />
  );
}

function useRequestsWaiting(): number {
  const query = useQuery({
    queryKey: ["requests", "list", ""],
    queryFn: () => requestsApi.list({ limit: 200 }),
    refetchInterval: 60_000,
  });
  const counts = query.data?.counts;
  return (counts?.requested ?? 0) + (counts?.downloading ?? 0);
}

function useCollectionsCount(): number {
  const { library } = useLibrary();
  const query = useQuery({
    queryKey: ["collections", library],
    queryFn: () => builderApi.list(library!),
    enabled: library !== null,
  });
  return query.data?.collections?.length ?? 0;
}

function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const { pathname } = useLocation();
  const waitingRequests = useRequestsWaiting();
  const collectionsCount = useCollectionsCount();

  return (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-1 p-3">
      <LibraryPicker />
      {sidebarEntries.map((entry, index) => {
        if (entry.spacer) {
          return <div key={`spacer-${index}`} className="mt-auto" aria-hidden="true" />;
        }

        const Icon = ENTRY_ICONS[entry.path];
        const active = isEntryActive(entry.path, pathname);
        let ariaLabel: string | undefined;
        let badge: React.ReactNode = null;

        if (entry.path === "/requests" && waitingRequests > 0) {
          ariaLabel = `Requests, ${waitingRequests} waiting`;
          badge = (
            <span aria-hidden="true" className="ml-auto rounded-full bg-border px-2 py-0.5 text-xs font-medium text-muted">
              {waitingRequests}
            </span>
          );
        } else if (entry.path === "/collections" && collectionsCount > 0) {
          ariaLabel = `Collections, ${collectionsCount} ${collectionsCount === 1 ? "collection" : "collections"}`;
          badge = (
            <span aria-hidden="true" className="ml-auto rounded-full bg-border px-2 py-0.5 text-xs font-medium text-muted">
              {collectionsCount}
            </span>
          );
        } else if (entry.path === "/system") {
          badge = <HealthDot />;
        }

        return (
          <div key={entry.path} className="flex flex-col gap-1">
            <Link
              to={entry.path}
              aria-label={ariaLabel}
              aria-current={active ? "page" : undefined}
              className={navLinkClass({ isActive: active })}
              onClick={onNavigate}
            >
              {Icon && <Icon className="size-5 shrink-0" />}
              <span>{entry.label}</span>
              {badge}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}

function AdvancedToggle() {
  const { showAdvanced, setShowAdvanced } = useAdvanced();
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted">
      <input
        type="checkbox"
        className="size-4 accent-accent"
        checked={showAdvanced}
        onChange={(event) => setShowAdvanced(event.target.checked)}
      />
      Show Advanced
    </label>
  );
}

function SignOut({ className = "" }: { className?: string }) {
  const queryClient = useQueryClient();
  const signOut = useMutation({ mutationFn: api.auth.logout, onSuccess: () => queryClient.resetQueries() });
  return (
    <button type="button" className={`min-h-11 px-3 text-left text-sm text-muted hover:text-text ${className}`} onClick={() => signOut.mutate()}>
      Sign out
    </button>
  );
}

// Until a username and password are set, Studio answers only local addresses; say so, once, everywhere.
function SignInNotice() {
  return (
    <p role="status" className="border-b border-warn/40 bg-surface px-4 py-2 text-sm text-warn">
      Sign-in isn't set up, so anyone on your local network can use Studio.{" "}
      <Link to="/settings/general" className="underline">
        Set a username and password
      </Link>
    </p>
  );
}

export function Layout() {
  return (
    <HeaderTitleProvider>
      <LayoutFrame />
    </HeaderTitleProvider>
  );
}

function LayoutFrame() {
  const auth = useQuery({ queryKey: ["auth"], queryFn: api.auth.status });
  const [menuOpen, setMenuOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const { pathname } = useLocation();
  const pageName = useHeaderTitleValue();

  return (
    <div className="flex h-full">
      {/* Sidebar: always visible from md up, a slide-over menu below that. */}
      <aside
        className={[
          "fixed inset-y-0 left-0 z-20 flex w-60 flex-col overflow-y-auto border-r border-border bg-sidebar md:static md:block",
          menuOpen ? "block" : "hidden",
        ].join(" ")}
      >
        <div className="flex h-14 shrink-0 items-center gap-2 px-6 font-display text-lg font-semibold">
          <PosterMark />
          <Wordmark />
        </div>
        <Sidebar onNavigate={() => setMenuOpen(false)} />
        <RunCard
          onOpen={() => {
            setMenuOpen(false);
            setJobsOpen(true);
          }}
        />
        {/* On phones the header has no room for it. */}
        {auth.data?.signed_in && <SignOut className="mx-3 mb-3 shrink-0 sm:hidden" />}
      </aside>
      {menuOpen && <div className="fixed inset-0 z-10 bg-black/50 md:hidden" onClick={() => setMenuOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
          <button
            type="button"
            className="flex size-11 items-center justify-center rounded-control text-muted hover:bg-surface-2 md:hidden"
            aria-label="Open menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            ☰
          </button>
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{pageName ?? pageTitle(pathname)}</h1>
          <AdvancedToggle />
          {auth.data?.signed_in && <SignOut className="hidden sm:block" />}
        </header>
        {auth.data && !auth.data.configured && <SignInNotice />}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <SectionTabs />
          <Outlet />
        </main>
        <JobsDrawer open={jobsOpen} onClose={() => setJobsOpen(false)} />
      </div>
    </div>
  );
}
