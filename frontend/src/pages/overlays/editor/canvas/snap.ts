// Snapping: while a box moves or resizes, its edges and centre catch on the poster's edges, centre and safe margins and on
// the other drawn elements' edges and centres, within a few poster units. Pure, so it tests without a browser.

import type { SceneBox } from "../../../../overlayEngineApi";
import { POSTER_H, POSTER_W } from "../model/styleDoc";
import { resizeBox, type Handle } from "./boxes";

export const SNAP_THRESHOLD = 8;
export const SAFE_MARGIN = 40;

export type Targets = { x: number[]; y: number[] };
export type Guide = { axis: "x" | "y"; at: number }; // a vertical line at x = at, or a horizontal one at y = at
/** Which points of the box snap, as fractions along it: 0 = left / top edge, 0.5 = centre, 1 = right / bottom edge. */
export type Anchors = { x: number[]; y: number[] };
const ALL: Anchors = { x: [0, 0.5, 1], y: [0, 0.5, 1] };

/** The lines to snap to: the poster's edges, centre and safe margins, then each of the other boxes' edges and centre. */
export function snapTargets(others: SceneBox[]): Targets {
  const x = [0, SAFE_MARGIN, POSTER_W / 2, POSTER_W - SAFE_MARGIN, POSTER_W];
  const y = [0, SAFE_MARGIN, POSTER_H / 2, POSTER_H - SAFE_MARGIN, POSTER_H];
  for (const [bx, by, bw, bh] of others) {
    x.push(bx, bx + bw / 2, bx + bw);
    y.push(by, by + bh / 2, by + bh);
  }
  return { x, y };
}

function nearest(start: number, size: number, fractions: number[], lines: number[]): { delta: number; at: number } | null {
  let best: { delta: number; at: number } | null = null;
  for (const f of fractions)
    for (const at of lines) {
      const delta = at - (start + size * f);
      if (Math.abs(delta) <= SNAP_THRESHOLD && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, at };
    }
  return best;
}

/** How far to nudge box so it sits on a line (per axis), and the guides to draw. off (Alt held): no snapping. */
export function snap(box: SceneBox, targets: Targets, anchors: Anchors = ALL, off = false): { dx: number; dy: number; guides: Guide[] } {
  const x = off ? null : nearest(box[0], box[2], anchors.x, targets.x);
  const y = off ? null : nearest(box[1], box[3], anchors.y, targets.y);
  const guides: Guide[] = [];
  if (x) guides.push({ axis: "x", at: x.at });
  if (y) guides.push({ axis: "y", at: y.at });
  return { dx: x?.delta ?? 0, dy: y?.delta ?? 0, guides };
}

/** resizeBox with the edges the handle moves snapped. A ratio-keeping resize doesn't snap (the other edge would drift). */
export function snapResize(box: SceneBox, handle: Handle, dx: number, dy: number, keepRatio: boolean, targets: Targets, off = false): { box: SceneBox; guides: Guide[] } {
  const free = resizeBox(box, handle, dx, dy);
  if (keepRatio) return { box: resizeBox(box, handle, dx, dy, true), guides: [] };
  const anchors: Anchors = { x: handle.includes("w") ? [0] : handle.includes("e") ? [1] : [], y: handle.includes("n") ? [0] : handle.includes("s") ? [1] : [] };
  const s = snap(free, targets, anchors, off);
  return { box: resizeBox(box, handle, dx + s.dx, dy + s.dy), guides: s.guides };
}
