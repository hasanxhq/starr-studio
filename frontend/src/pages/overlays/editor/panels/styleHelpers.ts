import { parseDocument } from "yaml";

import type { StyleOption } from "../../../../overlayEngineApi";
import { addElement, elementAt, outline, parentPath, type ElementData, type OutlineNode } from "../model/styleDoc";

const CONTAINERS = new Set(["row", "column", "group"]);

export function optionsFromText(text: string): Record<string, StyleOption> {
  try {
    const data = parseDocument(text).toJSON() as { options?: Record<string, StyleOption> } | null;
    return data?.options ?? {};
  } catch {
    return {};
  }
}

const SIMPLE_SHOW_WHEN = new Set(["has", "added_within_days", "option"]);

/** Whether show_when can be edited with the simple fields (has, added_within_days, option only). */
export function isSimpleShowWhen(rule: unknown): boolean {
  if (rule === null || rule === undefined) return true;
  if (typeof rule !== "object" || Array.isArray(rule)) return false;
  return Object.keys(rule as object).every((k) => SIMPLE_SHOW_WHEN.has(k));
}

export function isOptionRef(value: unknown): value is string {
  return typeof value === "string" && /^\$[a-z][a-z0-9_]*$/.test(value);
}

export function optionName(ref: string): string {
  return ref.slice(1);
}

export function canRemove(text: string, path: string): boolean {
  const parent = parentPath(path);
  if (parent === null) return outline(text).length > 1;
  const kids = elementAt(text, parent)?.children;
  return Array.isArray(kids) && kids.length > 1;
}

export function siblingIndex(path: string): number {
  return Number(path.split(".").at(-1));
}

export function siblingCount(text: string, path: string): number {
  const parent = parentPath(path);
  if (parent === null) return outline(text).length;
  const kids = elementAt(text, parent)?.children;
  return Array.isArray(kids) ? kids.length : 0;
}

/** Where Add puts a new element: the selected row, column or group, else the top level. */
export function addParent(text: string, selection: string[]): string | null {
  const path = selection[0];
  if (!path) return null;
  const el = elementAt(text, path);
  if (el && CONTAINERS.has(el.type)) return path;
  const parent = parentPath(path);
  if (parent === null) return null;
  const parentEl = elementAt(text, parent);
  return parentEl && CONTAINERS.has(parentEl.type) ? parent : null;
}

function withPlacement(element: ElementData, parent: string | null, text: string): ElementData {
  if (parent === null) {
    if (element.type === "text" || element.type === "rect" || element.type === "logo") {
      const box = { ...(element.box as object), left: 40, top: 40 } as Record<string, unknown>;
      return { ...element, box };
    }
    if (element.type === "group") return { ...element, box: { left: 40, top: 40, ...(element.box as object) } };
    return element;
  }
  const parentEl = elementAt(text, parent);
  if (parentEl?.type === "group" && element.type !== "row" && element.type !== "column") {
    const box = { ...(element.box as object), left: 40, top: 40 } as Record<string, unknown>;
    return { ...element, box };
  }
  if (element.box) {
    const { box: _, ...rest } = element;
    return rest as ElementData;
  }
  return element;
}

const TEXT_CHILD: ElementData = { type: "text", text: "Text", size: 48 };
const RECT_CHILD: ElementData = { type: "rect", box: { left: 0, top: 0, right: 0, bottom: 0 } };

export const ADD_KINDS = [
  { key: "text", label: "Text", element: TEXT_CHILD },
  { key: "rect", label: "Rectangle", element: { type: "rect", fill: { colour: "#000000", opacity: 0.6 }, box: { width: 200, height: 100 } } as ElementData },
  { key: "logo", label: "Logo", element: { type: "logo", image: "imdb", height: 64 } as ElementData },
  { key: "row", label: "Row", element: { type: "row", gap: 20, children: [{ type: "text", text: "Text", size: 48 }] } as ElementData },
  { key: "group", label: "Group", element: { type: "group", box: { width: 300, height: 200 }, children: [RECT_CHILD] } as ElementData },
] as const;

export function addKind(text: string, selection: string[], kind: (typeof ADD_KINDS)[number]["key"]): { text: string; path: string } {
  const def = ADD_KINDS.find((k) => k.key === kind);
  if (!def) throw new Error(`unknown kind ${kind}`);
  const parent = addParent(text, selection);
  const element = withPlacement(structuredClone(def.element), parent, text);
  return addElement(text, parent, element);
}

export function walkOutline(nodes: OutlineNode[], fn: (node: OutlineNode, depth: number) => void, depth = 0) {
  for (const node of nodes) {
    fn(node, depth);
    walkOutline(node.children, fn, depth + 1);
  }
}