// The canvas: the sample poster with the style's SVG on it. Click selects, a drag moves, the handles resize, arrows nudge,
// and a moment after the last change the server's exact JPEG covers the draft. The server's SVG is the draft: while a hand
// drags, this file moves that SVG's nodes (CSS transforms, once per frame, no React state); on release the file changes
// once and the next scene replaces the nodes. The maths lives in boxes.ts and snap.ts.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { Button } from "../../../../components/ui";
import { overlayEngine, type SceneBox, type SceneItem } from "../../../../overlayEngineApi";
import { useEditor } from "../EditorContext";
import { elementAt, parentPath, placeBox, POSTER_BOX, POSTER_H, POSTER_W, removeElement } from "../model/styleDoc";
import { sceneMarkup } from "../model/scene";
import { typingIn } from "../StyleEditor";
import { align, bounds, distribute, HANDLES, movingPaths, removalOrder, type AlignMode, type Handle } from "./boxes";
import { snap, snapResize, snapTargets, type Guide, type Targets } from "./snap";

type Scene = Extract<SceneItem, { svg: string }>;

const RESIZABLE = new Set(["rect", "group", "svg", "text", "logo"]);
const RATIO_TYPES = new Set(["text", "logo"]); // their corner handles keep the aspect ratio (their size scales)
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const CURSORS: Record<Handle, string> = { nw: "cursor-nwse-resize", se: "cursor-nwse-resize", ne: "cursor-nesw-resize", sw: "cursor-nesw-resize", n: "cursor-ns-resize", s: "cursor-ns-resize", e: "cursor-ew-resize", w: "cursor-ew-resize" };
const ALIGN: [AlignMode, string][] = [["left", "Align left"], ["centre", "Align centre"], ["right", "Align right"], ["top", "Align top"], ["middle", "Align middle"], ["bottom", "Align bottom"]];

type Drag = {
  handle: Handle | null; // null: moving
  x0: number;
  y0: number;
  scale: number; // screen px per poster unit
  paths: string[]; // what moves (or the one element resizing)
  starts: SceneBox[];
  targets: Targets;
  ratio: boolean;
  clickPath: string;
  moved: boolean;
  frame: number;
  last: { x: number; y: number; alt: boolean; shift: boolean };
};

/** The server's exact JPEG of the settled file, 150 ms after the last change; gone while the file changes or a hand drags. */
function useExactRender(busy: boolean): string | null {
  const { text, settledText, sample, library, values } = useEditor();
  const [shot, setShot] = useState<string | null>(null);
  const valuesKey = JSON.stringify(values);
  useEffect(() => {
    if (busy || sample === null) return;
    let stale = false;
    let url: string | undefined;
    const timer = setTimeout(() => {
      overlayEngine.preview({ rating_key: sample, library, yaml: settledText, values }).then(
        (blob) => {
          if (stale) return;
          url = URL.createObjectURL(blob);
          setShot(url);
        },
        () => {}, // the scene error is shown elsewhere
      );
    }, 150);
    return () => {
      stale = true;
      clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
      setShot(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- values by valuesKey
  }, [busy, sample, library, valuesKey, settledText]);
  return text === settledText ? shot : null;
}

function Stage({ scene }: { scene: Scene }) {
  const { text, edit, settledText, selection, select, readOnly } = useEditor();
  const frame = useRef<HTMLDivElement>(null);
  const guides = useRef<Record<"x" | "y", HTMLDivElement | null>>({ x: null, y: null });
  const drag = useRef<Drag | null>(null);
  const placed = useRef<Record<string, SceneBox>>({}); // where edits put elements, until the scene that shows them arrives
  const edits = useRef(0);
  const [dragging, setDragging] = useState(false);
  const exact = useExactRender(dragging);
  const markup = useMemo(() => sceneMarkup(scene.svg, scene.thumb), [scene.svg, scene.thumb]);
  const { boxes } = scene;

  // a new scene shows the file as it is: the nodes and boxes we moved by hand go back to their own places
  useLayoutEffect(() => {
    if (text !== settledText) return;
    placed.current = {};
    frame.current?.querySelectorAll<HTMLElement>("[data-path], [data-box]").forEach((node) => (node.style.transform = ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new scene
  }, [scene]);

  const boxOf = (path: string) => placed.current[path] ?? boxes[path];
  // the file can be mid-typing: then nothing moves
  const movingOf = (paths: string[]) => {
    try {
      return movingPaths(text, paths, (p) => !!boxes[p]);
    } catch {
      return [];
    }
  };
  const shown = selection.filter((p) => boxes[p]);
  const moving = movingOf(selection);
  const resizeFor = (() => {
    try {
      const type = moving.length === 1 && selection.length === 1 && moving[0] === selection[0] ? elementAt(text, moving[0])?.type : undefined;
      return type && RESIZABLE.has(type) ? { path: moving[0], ratio: RATIO_TYPES.has(type) } : null;
    } catch {
      return null;
    }
  })();

  /** Show boxes[i] for paths[i]: move their SVG nodes and the selection boxes (a resize only changes the selection box). */
  const show = (paths: string[], to: SceneBox[], scale: number, resizing: boolean) => {
    const root = frame.current;
    if (!root) return;
    paths.forEach((p, i) => {
      const [dx, dy] = [to[i][0] - boxes[p][0], to[i][1] - boxes[p][1]];
      if (!resizing) root.querySelector<SVGGElement>(`g[data-path="${p}"]`)?.style.setProperty("transform", `translate(${dx}px, ${dy}px)`);
    });
    root.querySelectorAll<HTMLElement>("[data-box]").forEach((node) => {
      const own = node.dataset.box as string;
      const i = paths.findIndex((p) => own === p || own.startsWith(`${p}.`));
      if (i < 0) return;
      const from = boxes[paths[i]];
      const t = to[i];
      node.style.transform = `translate(${(t[0] - from[0]) * scale}px, ${(t[1] - from[1]) * scale}px) scale(${t[2] / from[2]}, ${t[3] / from[3]})`;
    });
  };

  /** Put the elements at to: the file changes now, one undo step for the lot (the same merge key). */
  const commit = (paths: string[], to: SceneBox[], key: string) => {
    paths.forEach((p, i) => {
      const current = boxOf(p);
      const parent = parentPath(p);
      const parentBox = parent === null ? POSTER_BOX : (boxes[parent] ?? POSTER_BOX);
      placed.current[p] = to[i];
      edit((t) => placeBox(t, p, to[i], current, parentBox), key);
    });
  };
  const apply = (paths: string[], to: SceneBox[], key: string) => {
    show(paths, to, (frame.current?.getBoundingClientRect().width ?? 0) / POSTER_W, false);
    commit(paths, to, key);
  };
  const dropKey = (what: string) => `${what}:${++edits.current}`;

  const hit = (target: EventTarget): string | null => {
    let g = (target as Element).closest?.("g[data-path]");
    while (g && !boxes[g.getAttribute("data-path") as string]) g = g.parentElement?.closest("g[data-path]") ?? null;
    return g?.getAttribute("data-path") ?? null;
  };

  const start = (event: PointerEvent, handle: Handle | null, paths: string[], clickPath: string, ratio: boolean) => {
    const root = frame.current;
    const scale = (root?.getBoundingClientRect().width ?? 0) / POSTER_W;
    if (!root || !scale || readOnly || !paths.length) return;
    root.setPointerCapture?.(event.pointerId);
    const apart = (p: string) => paths.some((q) => p === q || p.startsWith(`${q}.`) || q.startsWith(`${p}.`));
    const others = Object.entries(boxes).filter(([p]) => !apart(p));
    drag.current = {
      handle,
      x0: event.clientX,
      y0: event.clientY,
      scale,
      paths,
      starts: paths.map(boxOf),
      targets: snapTargets(others.map(([, b]) => b)),
      ratio,
      clickPath,
      moved: false,
      frame: 0,
      last: { x: event.clientX, y: event.clientY, alt: event.altKey, shift: event.shiftKey },
    };
  };

  /** Where the drag has put the elements, and the guides it snaps to. */
  const aim = (d: Drag): { to: SceneBox[]; guides: Guide[] } => {
    const [dx, dy] = [(d.last.x - d.x0) / d.scale, (d.last.y - d.y0) / d.scale];
    if (d.handle) {
      const r = snapResize(d.starts[0], d.handle, dx, dy, d.ratio || d.last.shift, d.targets, d.last.alt);
      return { to: [r.box], guides: r.guides };
    }
    const [bx, by, bw, bh] = bounds(d.starts);
    const s = snap([bx + dx, by + dy, bw, bh], d.targets, undefined, d.last.alt);
    return { to: d.starts.map(([x, y, w, h]): SceneBox => [x + dx + s.dx, y + dy + s.dy, w, h]), guides: s.guides };
  };
  const draw = (d: Drag) => {
    const a = aim(d);
    show(d.paths, a.to, d.scale, d.handle !== null);
    for (const axis of ["x", "y"] as const) {
      const line = guides.current[axis];
      const guide = a.guides.find((g) => g.axis === axis);
      if (line) {
        line.style.display = guide ? "block" : "none";
        if (guide) line.style[axis === "x" ? "left" : "top"] = `${(guide.at / (axis === "x" ? POSTER_W : POSTER_H)) * 100}%`;
      }
    }
    return a;
  };
  const finish = (cancel: boolean, event?: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    cancelAnimationFrame(d.frame);
    if (d.moved) setDragging(false);
    for (const line of Object.values(guides.current)) if (line) line.style.display = "none";
    if (cancel || !event) return;
    if (!d.moved) {
      if (!d.last.shift && selection.length > 1) select([d.clickPath]); // a click on one of several narrows to it
      return;
    }
    d.last = { ...d.last, x: event.clientX, y: event.clientY, alt: event.altKey, shift: event.shiftKey };
    const a = draw(d);
    commit(d.paths, a.to, dropKey("drop"));
    for (const line of Object.values(guides.current)) if (line) line.style.display = "none";
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button > 0) return;
    const path = hit(event.target);
    if (path === null) {
      if (!event.shiftKey) select([]);
      return;
    }
    if (event.shiftKey) {
      select(selection.includes(path) ? selection.filter((p) => p !== path) : [...selection, path]);
      return;
    }
    const next = selection.includes(path) ? selection : [path];
    if (next !== selection) select(next);
    start(event, null, movingOf(next), path, false);
  };
  const onPointerMove = (event: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    d.last = { x: event.clientX, y: event.clientY, alt: event.altKey, shift: event.shiftKey };
    if (!d.moved) {
      if (Math.hypot(event.clientX - d.x0, event.clientY - d.y0) < 3) return; // still a click
      d.moved = true;
      setDragging(true);
    }
    if (!d.frame)
      d.frame = requestAnimationFrame(() => {
        d.frame = 0;
        draw(d);
      });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (typingIn(event.target)) return;
    if (event.key === "Escape") return select([]);
    if (readOnly) return;
    const arrow = ARROWS[event.key];
    if (arrow && moving.length) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      apply(moving, moving.map(boxOf).map(([x, y, w, h]): SceneBox => [x + arrow[0] * step, y + arrow[1] * step, w, h]), `nudge:${selection.join(",")}`);
    } else if ((event.key === "Delete" || event.key === "Backspace") && selection.length) {
      event.preventDefault();
      const key = dropKey("delete");
      for (const p of removalOrder(selection)) edit((t) => removeElement(t, p), key);
      select([]);
    }
  };

  const arrange = (to: (boxes: SceneBox[]) => SceneBox[]) => apply(moving, to(moving.map(boxOf)), dropKey("align"));
  const bar = !readOnly && moving.length > 1;

  return (
    <>
      {bar && (
        <div role="toolbar" aria-label="Align" className="flex flex-wrap gap-1">
          {ALIGN.map(([mode, label]) => (
            <Button key={mode} title={label} onClick={() => arrange((b) => align(b, mode))}>
              {label}
            </Button>
          ))}
          {moving.length > 2 && (
            <>
              <Button title="Distribute horizontally" onClick={() => arrange((b) => distribute(b, "x"))}>
                Distribute horizontally
              </Button>
              <Button title="Distribute vertically" onClick={() => arrange((b) => distribute(b, "y"))}>
                Distribute vertically
              </Button>
            </>
          )}
        </div>
      )}
      <div
        ref={frame}
        role="group"
        aria-label="Poster canvas"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finish(false, e)}
        onPointerCancel={() => finish(true)}
        onKeyDown={onKeyDown}
        className="relative mx-auto w-full max-w-md touch-none select-none outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <div className="[&>svg]:block [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: markup }} />
        {exact && <img src={exact} alt="" className="pointer-events-none absolute inset-0 h-full w-full" />}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {shown.map((p) => {
            const [x, y, w, h] = boxes[p];
            return (
              <div
                key={p}
                data-box={p}
                className="absolute origin-top-left border-2 border-accent"
                style={{ left: `${(x / POSTER_W) * 100}%`, top: `${(y / POSTER_H) * 100}%`, width: `${(w / POSTER_W) * 100}%`, height: `${(h / POSTER_H) * 100}%` }}
              >
                {resizeFor?.path === p &&
                  HANDLES.map((handle) => (
                    <div
                      key={handle}
                      data-handle={handle}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        if (event.button > 0) return;
                        start(event, handle, [p], p, resizeFor.ratio && handle.length === 2);
                      }}
                      className={`pointer-events-auto absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-accent bg-bg ${CURSORS[handle]}`}
                      style={{ left: handle.includes("w") ? "0%" : handle.includes("e") ? "100%" : "50%", top: handle.includes("n") ? "0%" : handle.includes("s") ? "100%" : "50%" }}
                    />
                  ))}
              </div>
            );
          })}
          <div ref={(el) => void (guides.current.x = el)} className="absolute inset-y-0 w-px bg-accent" style={{ display: "none" }} />
          <div ref={(el) => void (guides.current.y = el)} className="absolute inset-x-0 h-px bg-accent" style={{ display: "none" }} />
        </div>
        <span aria-hidden className="pointer-events-none absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
          {exact ? "Exact" : "Draft"}
        </span>
      </div>
    </>
  );
}

export function Canvas() {
  const { scene, sample, samplesState, samplesError } = useEditor();
  return (
    <section aria-label="Canvas" className="flex flex-col gap-2">
      {sample === null && samplesState === "error" ? (
        <p role="alert" className="text-sm text-err">
          {samplesError}
        </p>
      ) : sample === null && samplesState === "empty" ? (
        <p className="text-sm text-muted">The library has no titles to draw on yet.</p>
      ) : !scene ? (
        <p className="text-sm text-muted">Loading the sample…</p>
      ) : scene.error !== undefined ? (
        <p role="alert" className="text-sm text-err">
          {scene.error}
        </p>
      ) : (
        <Stage scene={scene} />
      )}
    </section>
  );
}
