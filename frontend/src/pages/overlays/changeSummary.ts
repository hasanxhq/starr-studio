// One sentence summarising how overlay template variables differ from what's saved — for the apply bar.

import type { OverlayLayout } from "../../api";
import { resolveLayout, whereItIs } from "../../overlayLayout";

type Values = Record<string, unknown>;

const side = (word: string) => (word === "center" ? "middle" : word);

const anchorPhrase = (spot: string) => {
  const [vertical, horizontal] = spot.includes("-") ? spot.split("-") : [spot, spot];
  if (vertical === horizontal) return `the ${side(vertical)}`;
  return `the ${side(vertical)} ${horizontal} corner`;
};

/** What changed between saved and draft variables for one layer. */
export function layerChangeSentence(
  title: string,
  layout: OverlayLayout | undefined,
  libraryVariables: Values,
  saved: Values,
  draft: Values,
): string | null {
  const parts: string[] = [];
  const was = resolveLayout(layout, { ...libraryVariables, ...saved });
  const now = resolveLayout(layout, { ...libraryVariables, ...draft });

  const before = whereItIs(layout, { ...libraryVariables, ...saved });
  const after = whereItIs(layout, { ...libraryVariables, ...draft });
  if (before !== after) parts.push(`${title} move from ${anchorPhrase(before)} to ${anchorPhrase(after)}`);

  if (layout?.moved_by !== "position") {
    const ox = Number(was.horizontal_offset ?? 0);
    const nx = Number(now.horizontal_offset ?? 0);
    const oy = Number(was.vertical_offset ?? 0);
    const ny = Number(now.vertical_offset ?? 0);
    if (ox !== nx || oy !== ny) {
      const closer = nx + ny < ox + oy;
      parts.push(closer ? `${title} move closer to the edge` : `${title} move farther from the edge`);
    }
  }

  const color = (v: unknown) => (typeof v === "string" ? v.slice(0, 7).toLowerCase() : "");
  const alpha = (v: unknown) => (typeof v === "string" && v.length >= 9 ? v.slice(7, 9) : "");
  const savedColor = saved.back_color ?? was.back_color;
  const draftColor = draft.back_color ?? now.back_color;
  if (color(savedColor) !== color(draftColor)) {
    const name = color(draftColor) === "#ffffff" ? "white" : color(draftColor) === "#000000" ? "black" : "a new colour";
    parts.push(`${title} get${name === "a new colour" ? " " : " a "}${name} background`);
  } else if (alpha(savedColor) !== alpha(draftColor)) {
    parts.push(`${title} become more see-through`);
  }

  if (String(was.rating_alignment ?? "") !== String(now.rating_alignment ?? "")) {
    const run = now.rating_alignment === "vertical" ? "down" : "across";
    parts.push(`${title} run ${run}`);
  }

  return parts.length ? parts.join(", ") : null;
}

/** Studio-wide sentence: layer edits, plus adds/removes. */
export function studioChangeSentence(
  changes: string[],
  added: string[],
  removed: string[],
): string {
  const parts = [...changes];
  if (added.length) parts.push(`add ${added.join(", ")}`);
  if (removed.length) parts.push(`remove ${removed.join(", ")}`);
  if (!parts.length) return "";
  const body = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join("; ")} and ${parts[parts.length - 1]}`;
  return body.endsWith(".") ? body : `${body}.`;
}
