// The editor's edits, made on the style file's text (docs/plans/overlay-engine.md, 3.6 and Phase 4). The file is the
// one source of truth: every edit takes the YAML text and gives back new text, keeping the user's comments (the
// first edit does tidy spacing, such as lined-up columns). A path names an element by its place in the file, as the
// server's scene does: "elements.1.children.0".

import { isMap, isSeq, parseDocument, type Document } from "yaml";

import type { SceneBox } from "../../../../overlayEngineApi";

export const POSTER_W = 1000;
export const POSTER_H = 1500;
export const POSTER_BOX: SceneBox = [0, 0, POSTER_W, POSTER_H];

/** A plain JS view of one element in the file (whatever keys it has). */
export type ElementData = Record<string, unknown> & { type: string; children?: ElementData[] };

/** The layers list's view of the file: every element, nested as in the file. */
export type OutlineNode = {
  path: string;
  type: string;
  id: string | null;
  label: string; // id, else the text, else the type
  movable: boolean; // has its own box; a row's or column's children are placed by it
  children: OutlineNode[];
};

const FLOWS = new Set(["row", "column"]);
const CONTAINERS = new Set(["row", "column", "group"]);

function keys(path: string): (string | number)[] {
  return path.split(".").map((k) => (/^\d+$/.test(k) ? Number(k) : k));
}

function load(text: string): Document {
  const doc = parseDocument(text);
  if (doc.errors.length) throw new Error(doc.errors[0].message);
  return doc;
}

function dump(doc: Document): string {
  return doc.toString({ lineWidth: 0 });
}

/** The path of the element holding this one, or null at the top level. */
export function parentPath(path: string): string | null {
  const parts = path.split(".");
  return parts.length > 2 ? parts.slice(0, -2).join(".") : null;
}

export function elementAt(text: string, path: string): ElementData | undefined {
  const node = load(text).getIn(keys(path));
  return isMap(node) ? (node.toJSON() as ElementData) : undefined;
}

export function outline(text: string): OutlineNode[] {
  const data = load(text).toJSON() as { elements?: ElementData[] } | null;
  const walk = (elements: ElementData[] | undefined, at: string, inFlow: boolean): OutlineNode[] =>
    (elements ?? []).map((el, i) => {
      const path = `${at}.${i}`;
      const id = typeof el.id === "string" ? el.id : null;
      return {
        path,
        type: String(el.type),
        id,
        label: id ?? (el.type === "text" && typeof el.text === "string" ? el.text : String(el.type)),
        movable: !inFlow,
        children: CONTAINERS.has(String(el.type)) ? walk(el.children, `${path}.children`, FLOWS.has(String(el.type))) : [],
      };
    });
  return walk(data?.elements, "elements", false);
}

/** Whether the element has its own box to move (a row's or column's children don't). */
export function isMovable(text: string, path: string): boolean {
  const parent = parentPath(path);
  return parent === null || !FLOWS.has(String(elementAt(text, parent)?.type));
}

/** The nearest element at or above path that has its own box: what dragging path moves. */
export function movablePath(text: string, path: string): string {
  let at: string | null = path;
  while (at !== null && !isMovable(text, at)) at = parentPath(at);
  return at ?? path;
}

/** Set (or, with undefined, remove) a value inside an element: key is "fill.colour" or ["fill", "colour"]. */
export function setProp(text: string, path: string, key: string | string[], value: unknown): string {
  const doc = load(text);
  const at = [...keys(path), ...(Array.isArray(key) ? key : key.split("."))];
  if (value === undefined) doc.deleteIn(at);
  else doc.setIn(at, value);
  return dump(doc);
}

function seqAt(doc: Document, parent: string | null) {
  const at = parent === null ? ["elements"] : [...keys(parent), "children"];
  const seq = doc.getIn(at);
  if (!isSeq(seq)) throw new Error(`no element list at ${at.join(".")}`);
  return { seq, base: at.join(".") };
}

/** Add an element to the top level (parent null) or a row, column or group; returns the new text and its path. */
export function addElement(text: string, parent: string | null, element: ElementData, index?: number): { text: string; path: string } {
  const doc = load(text);
  const { seq, base } = seqAt(doc, parent);
  const at = index === undefined ? seq.items.length : Math.max(0, Math.min(index, seq.items.length));
  seq.items.splice(at, 0, doc.createNode(element));
  return { text: dump(doc), path: `${base}.${at}` };
}

/** Remove an element. Removing a row's, column's or group's last child removes nothing: the file needs one. */
export function removeElement(text: string, path: string): string {
  const doc = load(text);
  const index = Number(path.split(".").at(-1));
  const { seq } = seqAt(doc, parentPath(path));
  if (parentPath(path) !== null && seq.items.length <= 1) return text;
  seq.items.splice(index, 1);
  return dump(doc);
}

/** Move an element to another place in the same list (the layers list's reorder); returns its new path. */
export function reorderElement(text: string, path: string, toIndex: number): { text: string; path: string } {
  const doc = load(text);
  const from = Number(path.split(".").at(-1));
  const { seq, base } = seqAt(doc, parentPath(path));
  const to = Math.max(0, Math.min(toIndex, seq.items.length - 1));
  const [item] = seq.items.splice(from, 1);
  seq.items.splice(to, 0, item);
  return { text: dump(doc), path: `${base}.${to}` };
}

const round = (n: number) => Math.round(n * 10) / 10;

/** A new length in the old one's unit: "N%" of the poster's width or height stays a percentage. */
function like(old: unknown, units: number, extent: number): number | string {
  if (typeof old === "string" && old.endsWith("%")) return `${round((units / extent) * 100)}%`;
  return round(units);
}

const isOption = (v: unknown) => typeof v === "string" && v.startsWith("$");

/**
 * Put an element at target (x, y, width, height in poster units), from where the scene drew it (current) inside its
 * parent's box (the poster's, or its group's). The edges it's pinned to stay pinned (left stays left, right and left
 * both stretch) and each length keeps its unit. A box value that's an $option is left alone on that axis. Resizing
 * an element whose content sets its size scales it: a text's size, a logo's or svg's height (and an svg's width).
 * A row's or column's child has no box of its own: the text comes back unchanged.
 */
export function placeBox(text: string, path: string, target: SceneBox, current: SceneBox, parent: SceneBox = POSTER_BOX): string {
  if (!isMovable(text, path)) return text;
  const el = elementAt(text, path);
  const box = el?.box as Record<string, unknown> | undefined;
  if (!el || !box) return text;
  const [tx, ty, tw, th] = target;
  const [, , cw, ch] = current;
  const [px, py, pw, ph] = parent;
  const next: Record<string, unknown> = { ...box };
  const axis = (start: string, end: string, centre: string, size: string, t: number, tSize: number, p: number, pSize: number, extent: number) => {
    if ([start, end, centre, size].some((k) => isOption(box[k]))) return;
    const has = (k: string) => box[k] !== undefined && box[k] !== null;
    if (has(start)) next[start] = like(box[start], t - p, extent);
    if (has(end)) next[end] = like(box[end], p + pSize - (t + tSize), extent);
    if (!has(start) && !has(end)) next[centre] = like(box[centre], t + tSize / 2 - (p + pSize / 2), extent);
    if (has(size)) next[size] = like(box[size], tSize, extent);
  };
  axis("left", "right", "centre_x", "width", tx, tw, px, pw, POSTER_W);
  axis("top", "bottom", "centre_y", "height", ty, th, py, ph, POSTER_H);

  // key by key, so a one-line { left: 0, bottom: 0 } box stays one line
  const doc = load(text);
  for (const [k, v] of Object.entries(next)) if (v !== box[k]) doc.setIn([...keys(path), "box", k], v);
  let out = dump(doc);
  const sizedByBox = (box.width ?? null) !== null || (box.height ?? null) !== null || (box.left != null && box.right != null) || (box.top != null && box.bottom != null);
  const scale = ch > 0 ? th / ch : 1;
  if (!sizedByBox && Math.abs(scale - 1) > 0.001) {
    if (el.type === "text" && typeof el.size === "number") out = setProp(out, path, "size", round(el.size * scale));
    if ((el.type === "logo" || el.type === "svg") && typeof el.height === "number") out = setProp(out, path, "height", round(el.height * scale));
    if (el.type === "svg" && typeof el.width === "number" && cw > 0) out = setProp(out, path, "width", round(el.width * (tw / cw)));
  }
  return out;
}
