// The overlay designer's pieces, shared with the single overlay form: a poster with its overlays placed on it, the picker for which
// title to preview on, and the nine-cell anchor grid.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useDeferredValue, useReducer, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { api, type PlexItem } from "../api";
import { mergeLibraries } from "../libraries";
import { overlaps, POSTER_HEIGHT, POSTER_WIDTH, type Box } from "../overlayLayout";
import { inputClass } from "./ui";

const CLICK_SLOP = 4;

function resolutionRank(resolution: string | null | undefined) {
  if (!resolution) return 0;
  const text = resolution.toLowerCase();
  if (text.includes("4k") || text === "2160") return 4000;
  if (text.includes("1080")) return 1080;
  if (text.includes("720")) return 720;
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) ? n : 0;
}

/** Up to five distinct titles that show different overlay traits. Critic rating is not on PlexItem, so that trait is skipped. */
export function pickTryOnSamples(items: PlexItem[], libraryHasShows: boolean): PlexItem[] {
  const out: PlexItem[] = [];
  const used = new Set<string>();
  const take = (candidate: PlexItem | undefined) => {
    if (candidate && !used.has(candidate.rating_key)) {
      used.add(candidate.rating_key);
      out.push(candidate);
    }
  };
  const byRes = [...items].sort((a, b) => resolutionRank(b.video_resolution) - resolutionRank(a.video_resolution));
  take(byRes[0]);
  take(items.find((entry) => resolutionRank(entry.video_resolution) === 1080));
  take(items.find((entry) => entry.audience_rating == null));
  if (libraryHasShows) take(items.find((entry) => entry.type === "show"));
  return out.slice(0, 5);
}

/** Titles from this library to preview on: the newest, or what the search finds. */
export function useSamples(library: string | null) {
  const plex = useQuery({ queryKey: ["plex", "libraries"], queryFn: api.plexLibraries.list, retry: false, staleTime: 60_000, enabled: !!library });
  const overview = useQuery({ queryKey: ["config"], queryFn: api.config.overview, retry: false, enabled: !!library });
  const key = mergeLibraries(plex.data?.libraries, overview.data?.libraries).find((entry) => entry.config?.name === library)?.plex?.key ?? null;
  const [search, setSearch] = useState("");
  const needle = useDeferredValue(search.trim());
  const items = useQuery({
    queryKey: ["plex", "items", key, needle],
    queryFn: () => api.plexLibraries.items(key!, needle),
    enabled: key !== null,
    retry: false,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  const found = items.data?.items ?? [];
  const [picked, setPicked] = useState<PlexItem | null>(null);
  return { found, sample: picked ?? found[0] ?? null, search, setSearch, setPicked, error: plex.error ?? items.error };
}

export function SamplePicker({ samples }: { samples: ReturnType<typeof useSamples> }) {
  const { found, sample, search, setSearch, setPicked } = samples;
  const titles = sample && !found.some((item) => item.rating_key === sample.rating_key) ? [sample, ...found] : found;
  return (
    <div className="flex w-full max-w-[540px] flex-col gap-2 text-[13px] text-muted">
      <label className="flex items-center gap-2 whitespace-nowrap">
        Preview on
        <select
          className={`${inputClass} min-h-11 w-52 max-w-full`}
          value={sample?.rating_key ?? ""}
          disabled={titles.length === 0}
          onChange={(event) => setPicked(titles.find((item) => item.rating_key === event.target.value) ?? null)}
        >
          {titles.length === 0 && <option value="">No titles</option>}
          {titles.map((item) => (
            <option key={item.rating_key} value={item.rating_key}>
              {item.title}
              {item.year ? ` (${item.year})` : ""}
            </option>
          ))}
        </select>
      </label>
      <input className={`${inputClass} min-h-11 w-full`} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a title" aria-label="Find a title to preview on" />
    </div>
  );
}

export function TryItOnRow({
  samples,
  picks,
  boxesForItem,
  pickerOpen,
  setPickerOpen,
}: {
  samples: ReturnType<typeof useSamples>;
  picks: PlexItem[];
  boxesForItem: (item: PlexItem) => Box[];
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
}) {
  const { sample, setPicked } = samples;
  return (
    <div className="flex w-full max-w-[540px] flex-col gap-2">
      <span className="text-xs text-muted">Try it on</span>
      <div className="flex flex-wrap items-end gap-2">
        {picks.map((item) => {
          const thumb = item.thumb ? api.plexLibraries.imageUrl(item.thumb, 80, 120) : null;
          const on = sample?.rating_key === item.rating_key;
          const wouldOverlap = overlaps(boxesForItem(item));
          return (
            <button
              key={item.rating_key}
              type="button"
              aria-pressed={on}
              onClick={() => setPicked(item)}
              className={`flex min-h-11 max-w-[8.5rem] flex-col gap-0.5 rounded-control border px-1.5 py-1 text-left text-xs ${on ? "border-accent bg-surface-2" : "border-border-strong bg-surface-2 hover:border-muted"}`}
            >
              <span className="flex items-center gap-1.5">
                {thumb ? <img src={thumb} alt="" className="size-9 shrink-0 rounded object-cover" /> : <span className="size-9 shrink-0 rounded bg-border" />}
                <span className="line-clamp-2 min-w-0">{item.title}</span>
              </span>
              {wouldOverlap && <span className="text-[10px] text-warn">Overlaps</span>}
            </button>
          );
        })}
        <button type="button" className="min-h-11 rounded-control border border-dashed border-border-strong px-3 text-sm text-muted hover:text-text" onClick={() => setPickerOpen(!pickerOpen)}>
          + Pick a title
        </button>
      </div>
      {pickerOpen && <SamplePicker samples={samples} />}
    </div>
  );
}

function AnchorGuides() {
  const lines = [1 / 3, 2 / 3];
  const anchors = [0, 0.5, 1];
  const dots = anchors.flatMap((row) => anchors.map((column) => ({ left: `${column * 100}%`, top: `${row * 100}%` })));
  const dash = "1px dashed color-mix(in srgb, var(--color-accent) 55%, transparent)";
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {lines.map((t) => (
        <div key={`v${t}`} className="absolute top-0 bottom-0" style={{ left: `${t * 100}%`, borderLeft: dash }} />
      ))}
      {lines.map((t) => (
        <div key={`h${t}`} className="absolute right-0 left-0" style={{ top: `${t * 100}%`, borderTop: dash }} />
      ))}
      {dots.map((dot, index) => (
        <span key={index} className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" style={{ left: dot.left, top: dot.top }} />
      ))}
    </div>
  );
}

/** A poster with its overlays placed on it. With `onPick`, each overlay is a button; sizes follow the poster's own width. */
export function OverlayPoster({
  item,
  boxes,
  selected,
  onPick,
  onBoxDrop,
  onNudge,
  boxAriaLabel,
  showGuides,
  label,
  className = "w-full max-w-[340px]",
  fontSize = "3.6cqw",
  imageUrl,
}: {
  item: PlexItem | null;
  boxes: Box[];
  selected?: string | null;
  onPick?: (box: Box) => void;
  onBoxDrop?: (box: Box) => void;
  onNudge?: (box: Box, dx: number, dy: number) => void;
  boxAriaLabel?: (box: Box) => string;
  showGuides?: boolean;
  label: string;
  className?: string;
  fontSize?: string; // relative to the poster, so a thumbnail can use a bigger share of it
  imageUrl?: string | null; // Kometa's untouched poster when set; falls back to Plex's thumb on error
}) {
  const [failed, setFailed] = useState<string[]>([]); // every URL that didn't load, so two failures can't swap back and forth
  const posterRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ box: Box; startClientX: number; startClientY: number; startX: number; startY: number; dx: number; dy: number } | null>(null);
  const blockClick = useRef(false);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const drag = dragRef.current;
  const thumb = item?.thumb && !failed.includes(item.thumb) ? item.thumb : null;
  const showingOriginal = imageUrl && !failed.includes(imageUrl);
  const src = showingOriginal ? imageUrl : thumb ? api.plexLibraries.imageUrl(thumb, 680, 1020) : null;

  const toPoster = (clientX: number, clientY: number) => {
    const rect = posterRef.current!.getBoundingClientRect();
    return { x: ((clientX - rect.left) / rect.width) * POSTER_WIDTH, y: ((clientY - rect.top) / rect.height) * POSTER_HEIGHT };
  };

  const layerKey = (box: Box) => box.key.replace(/-\d+$/, "");

  const finishDrag = (event: ReactPointerEvent, box: Box) => {
    const active = dragRef.current;
    const clientMoved =
      active == null ? 0 : Math.hypot(event.clientX - active.startClientX, event.clientY - active.startClientY);
    const posterMoved = active == null ? 0 : Math.hypot(active.dx, active.dy);
    dragRef.current = null;
    bump();
    if (clientMoved < CLICK_SLOP && posterMoved < CLICK_SLOP) onPick?.(box);
    else if (active) {
      blockClick.current = true;
      onBoxDrop?.({ ...active.box, x: active.startX + active.dx, y: active.startY + active.dy, width: box.width, height: box.height, key: box.key, label: box.label, color: box.color, radius: box.radius, textColor: box.textColor });
    }
  };

  const onBoxKeyDown = (event: KeyboardEvent, box: Box) => {
    if (!onNudge || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 25 : 5;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    onNudge(box, dx, dy);
  };

  return (
    <div ref={posterRef} role="group" aria-label={label} className={`relative aspect-[2/3] overflow-hidden rounded-[10px] bg-surface-2 ${className}`} style={{ containerType: "inline-size" }}>
      {src ? (
        <img src={src} alt="" className="absolute inset-0 size-full object-cover" onError={() => setFailed((urls) => [...urls, showingOriginal ? imageUrl! : thumb!])} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center p-4 text-center font-display text-sm text-muted">{item?.title}</div>
      )}
      {showGuides && selected && <AnchorGuides />}
      {boxes.map((box) => {
        const draggedLayer = drag ? layerKey(drag.box) : null;
        const groupDrag = draggedLayer && layerKey(box) === draggedLayer;
        const x = groupDrag ? box.x + drag!.dx : box.x;
        const y = groupDrag ? box.y + drag!.dy : box.y;
        const place = {
          left: `${(x / POSTER_WIDTH) * 100}%`,
          top: `${(y / POSTER_HEIGHT) * 100}%`,
          width: `${(box.width / POSTER_WIDTH) * 100}%`,
          height: `${(box.height / POSTER_HEIGHT) * 100}%`,
          background: box.color,
          color: box.textColor,
          borderRadius: `${(box.radius / POSTER_WIDTH) * 100}cqw`,
          fontSize,
          touchAction: onBoxDrop && selected === layerKey(box) ? "none" : undefined, // a finger scrolls past unselected badges
        };
        const look = `absolute flex items-center justify-center overflow-hidden px-[1cqw] text-center font-display leading-none font-semibold text-white ${selected === layerKey(box) ? "outline-2 outline-accent" : ""}`;
        const aria = boxAriaLabel?.(box) ?? `Select ${box.label}`;
        return onPick ? (
          <button
            key={box.key}
            type="button"
            role="button"
            tabIndex={0}
            aria-label={aria}
            className={look}
            style={place}
            onPointerDown={
              onBoxDrop
                ? (event) => {
                    if (event.button > 0) return; // only the main button drags (jsdom leaves it undefined)
                    if (event.pointerType === "touch" && selected !== layerKey(box)) return; // tap to pick it first
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                    dragRef.current = { box, startClientX: event.clientX, startClientY: event.clientY, startX: box.x, startY: box.y, dx: 0, dy: 0 };
                    bump();
                  }
                : undefined
            }
            onPointerMove={
              onBoxDrop
                ? (event) => {
                    const active = dragRef.current;
                    if (!active || active.box.key !== box.key) return;
                    const now = toPoster(event.clientX, event.clientY);
                    const start = toPoster(active.startClientX, active.startClientY);
                    dragRef.current = { ...active, dx: now.x - start.x, dy: now.y - start.y };
                    bump();
                  }
                : undefined
            }
            onPointerUp={onBoxDrop ? (event) => finishDrag(event, box) : undefined}
            onPointerCancel={
              onBoxDrop
                ? () => {
                    dragRef.current = null;
                    bump();
                  }
                : undefined
            }
            onClick={() => {
              if (blockClick.current) {
                blockClick.current = false;
                return;
              }
              onPick?.(box);
            }}
            onKeyDown={onNudge ? (event) => onBoxKeyDown(event, box) : undefined}
          >
            {box.label}
          </button>
        ) : (
          <span key={box.key} className={look} style={place}>
            {box.label}
          </span>
        );
      })}
    </div>
  );
}

const ROWS = ["top", "center", "bottom"];
const COLUMNS = ["left", "center", "right"];
const words = (word: string) => word[0].toUpperCase() + word.slice(1);

/** The nine places an overlay can anchor to. */
export function AnchorGrid({ horizontal, vertical, onChange, children }: { horizontal: string; vertical: string; onChange: (horizontal: string, vertical: string) => void; children?: ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-2 text-[13px] text-muted">Anchor</legend>
      <div className="grid w-fit grid-cols-3 gap-1.5">
        {ROWS.flatMap((row) =>
          COLUMNS.map((column) => {
            const name = row === "center" && column === "center" ? "Center" : `${words(row === "center" ? "middle" : row)} ${column}`;
            const on = row === vertical && column === horizontal;
            return (
              <button
                key={name}
                type="button"
                aria-label={name}
                aria-pressed={on}
                onClick={() => onChange(column, row)}
                className={`size-11 rounded-control border transition-colors ${on ? "border-accent bg-accent" : "border-border-strong bg-surface-2 hover:border-muted"}`}
              />
            );
          }),
        )}
      </div>
      {children}
    </fieldset>
  );
}

/** Kometa's offsets: pixels on its 1000×1500 poster, or a percentage. */
export function OffsetInput({ value, onChange, label, placeholder = "e.g. 30 or 5%" }: { value: unknown; onChange: (v: unknown) => void; label: string; placeholder?: string }) {
  return (
    <input
      aria-label={label}
      className={inputClass}
      value={value === undefined ? "" : String(value)}
      placeholder={placeholder}
      onChange={(e) => {
        const text = e.target.value.trim();
        onChange(text === "" ? undefined : /^-?\d+$/.test(text) ? Number(text) : text);
      }}
    />
  );
}
