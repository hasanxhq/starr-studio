// The canvas's box maths, all in poster units (x, y, width, height): resizing by a handle, aligning, distributing,
// and which elements a drag moves. Plain functions, so they test without a browser.

import type { SceneBox } from "../../../../overlayEngineApi";
import { movablePath } from "../model/styleDoc";

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const MIN = 1;

/** The box after dragging a handle by (dx, dy). keepRatio holds the aspect ratio on a corner handle (the opposite corner stays). */
export function resizeBox(box: SceneBox, handle: Handle, dx: number, dy: number, keepRatio = false): SceneBox {
  const [x, y, w, h] = box;
  let l = x;
  let t = y;
  let r = x + w;
  let b = y + h;
  if (handle.includes("w")) l = Math.min(l + dx, r - MIN);
  if (handle.includes("e")) r = Math.max(r + dx, l + MIN);
  if (handle.includes("n")) t = Math.min(t + dy, b - MIN);
  if (handle.includes("s")) b = Math.max(b + dy, t + MIN);
  if (keepRatio && handle.length === 2) {
    const scale = Math.max((r - l) / w, (b - t) / h);
    if (handle.includes("w")) l = r - w * scale;
    else r = l + w * scale;
    if (handle.includes("n")) t = b - h * scale;
    else b = t + h * scale;
  }
  return [l, t, r - l, b - t];
}

/** The smallest box holding all of them. */
export function bounds(boxes: SceneBox[]): SceneBox {
  const l = Math.min(...boxes.map((b) => b[0]));
  const t = Math.min(...boxes.map((b) => b[1]));
  return [l, t, Math.max(...boxes.map((b) => b[0] + b[2])) - l, Math.max(...boxes.map((b) => b[1] + b[3])) - t];
}

export type AlignMode = "left" | "centre" | "right" | "top" | "middle" | "bottom";

/** Every box moved to the selection's left / centre / right / top / middle / bottom edge. */
export function align(boxes: SceneBox[], mode: AlignMode): SceneBox[] {
  const [l, t, w, h] = bounds(boxes);
  return boxes.map(([x, y, bw, bh]): SceneBox => {
    if (mode === "left") return [l, y, bw, bh];
    if (mode === "centre") return [l + (w - bw) / 2, y, bw, bh];
    if (mode === "right") return [l + w - bw, y, bw, bh];
    if (mode === "top") return [x, t, bw, bh];
    if (mode === "middle") return [x, t + (h - bh) / 2, bw, bh];
    return [x, t + h - bh, bw, bh];
  });
}

/** The first and last box stay; the ones between are spaced so every gap is equal. Same order as the input. */
export function distribute(boxes: SceneBox[], axis: "x" | "y"): SceneBox[] {
  const at = axis === "x" ? 0 : 1;
  const [l, t, w, h] = bounds(boxes);
  const start = axis === "x" ? l : t;
  const span = axis === "x" ? w : h;
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[a][at] - boxes[b][at]);
  const gap = (span - boxes.reduce((sum, b) => sum + b[at + 2], 0)) / Math.max(1, boxes.length - 1);
  const out = boxes.map((b): SceneBox => [...b]);
  let pos = start;
  for (const i of order) {
    out[i][at] = pos;
    pos += boxes[i][at + 2] + gap;
  }
  return out;
}

/** What dragging (or aligning) these paths moves: each one's movable element, once, and not inside another that moves. */
export function movingPaths(text: string, paths: string[], hasBox: (path: string) => boolean): string[] {
  const all = new Set(paths.map((p) => movablePath(text, p)));
  return [...all].filter((p) => hasBox(p) && ![...all].some((q) => q !== p && p.startsWith(`${q}.`)));
}

const numbers = (path: string) => path.split(".").filter((s) => /^\d+$/.test(s)).map(Number);

/** Order for removing several elements one by one without the paths shifting: deepest and last first. */
export function removalOrder(paths: string[]): string[] {
  return [...paths].sort((a, b) => {
    const [x, y] = [numbers(a), numbers(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if (x[i] === undefined) return 1;
      if (y[i] === undefined) return -1;
      if (x[i] !== y[i]) return y[i] - x[i];
    }
    return 0;
  });
}
