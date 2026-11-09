// Where an overlay lands on a poster, on Kometa's 1000×1500 canvas. Kometa draws the real thing; this is for placing it. A default's
// starting values and rules come from its own file, and its template variables go on top.

import type { OverlayLayout, PlexItem } from "./api";

export const POSTER_WIDTH = 1000;
export const POSTER_HEIGHT = 1500;

type Vars = Record<string, unknown>;

export type Box = {
  key: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  radius: number;
  textColor?: string;
  badge?: string; // ratings: which rating this box shows (critic, audience, user)
  image?: string; // Kometa's badge image, under defaults/overlays/images/
  text?: string; // what Kometa writes in it
};

/** One of Kometa's template conditions: every key must match. A list means any of these, `.exists` and `.not` as in Kometa. */
function matches(condition: Record<string, unknown>, vars: Vars): boolean {
  return Object.entries(condition).every(([key, wanted]) => {
    if (key === "value") return true;
    const name = key.replace(/\.(exists|not)$/, "");
    const actual = vars[name];
    if (key.endsWith(".exists")) return (actual !== undefined) === wanted;
    const hit = Array.isArray(wanted) ? wanted.includes(actual) : actual === wanted;
    return key.endsWith(".not") ? !hit : hit;
  });
}

const usable = (value: unknown): value is string | number => typeof value === "number" || (typeof value === "string" && !value.includes("<<"));

/** The layout's values with these template variables, which win over the default's own rules. */
export function resolveLayout(layout: OverlayLayout | undefined, own: Vars): Vars {
  const vars: Vars = { ...layout?.variables, ...own };
  // The alignments first: the offsets' rules look at them.
  const rules = Object.entries(layout?.conditionals ?? {}).sort(([a], [b]) => Number(b.endsWith("_align")) - Number(a.endsWith("_align")));
  for (const [key, rule] of rules) {
    if (own[key] !== undefined) continue;
    const hit = rule.conditions.find((condition) => matches(condition, vars));
    const value = usable(hit?.value) ? hit.value : rule.default; // a value that's another variable can't be placed by
    if (usable(value)) vars[key] = value;
  }
  return vars;
}

const pixels = (value: unknown, size: number) => (typeof value === "string" && value.endsWith("%") ? (Number(value.slice(0, -1)) / 100) * size : Number(value ?? 0) || 0);

/** A box from its alignment and offsets, as Kometa measures them: in from the aligned edge, or out from the centre. */
export function place(vars: Vars, width: number, height: number): { x: number; y: number } {
  const h = String(vars.horizontal_align ?? "left");
  const v = String(vars.vertical_align ?? "top");
  const across = pixels(vars.horizontal_offset, POSTER_WIDTH);
  const down = pixels(vars.vertical_offset, POSTER_HEIGHT);
  return {
    x: h === "left" ? across : h === "right" ? POSTER_WIDTH - width - across : (POSTER_WIDTH - width) / 2 + across,
    y: v === "top" ? down : v === "bottom" ? POSTER_HEIGHT - height - down : (POSTER_HEIGHT - height) / 2 + down,
  };
}

// horizontal_position has left2, center_left and so on; the grid only needs which side.
const side = (value: unknown) => String(value ?? "").split(/[_0-9]/)[0];

const RATING_LABELS: Record<string, string> = { critic: "Critic", audience: "Audience", user: "User" };

/** The boxes one layer draws. Ratings draws up to three, side by side or stacked. */
export function layerBoxes(key: string, label: string, layout: OverlayLayout | undefined, own: Vars): Box[] {
  const vars = resolveLayout(layout, own);
  const width = Number(vars.back_width) || 305;
  const height = Number(vars.back_height) || 105;
  const style = { color: typeof vars.back_color === "string" ? vars.back_color : "#00000099", radius: Number(vars.back_radius) || 30 };
  if (layout?.moved_by !== "position") return [{ key, label, ...place(vars, width, height), width, height, ...style }];
  const ratings = [1, 2, 3].map((n) => vars[`rating${n}`]).filter((rating): rating is string => typeof rating === "string" && rating !== "none");
  const names = ratings.length ? ratings.map((rating) => RATING_LABELS[rating] ?? rating.toUpperCase()) : [label];
  const across = vars.rating_alignment === "horizontal";
  const gap = across ? 15 : 100;
  const group = { width: across ? names.length * (width + gap) - gap : width, height: across ? height : names.length * (height + gap) - gap };
  const margin = 30;
  const { x, y } = place(
    { horizontal_align: side(vars.horizontal_position) || "left", vertical_align: side(vars.vertical_position) || "top", horizontal_offset: side(vars.horizontal_position) === "center" ? 0 : margin, vertical_offset: side(vars.vertical_position) === "center" ? 0 : margin },
    group.width,
    group.height,
  );
  return names.map((name, index) => ({
    key: `${key}-${index}`,
    label: name,
    badge: ratings[index],
    x: across ? x + index * (width + gap) : x,
    y: across ? y : y + index * (height + gap),
    width,
    height,
    ...style,
  }));
}

/** "top-left", as the layer list says it. */
export function whereItIs(layout: OverlayLayout | undefined, own: Vars): string {
  const vars = resolveLayout(layout, own);
  const position = layout?.moved_by === "position";
  const h = position ? side(vars.horizontal_position) || "left" : String(vars.horizontal_align ?? "left");
  const v = position ? side(vars.vertical_position) || "top" : String(vars.vertical_align ?? "top");
  return h === v ? h : `${v}-${h}`;
}

const AUDIO: Record<string, string> = { truehd: "TRUEHD", eac3: "DD+", ac3: "DD", dca: "DTS", "dca-ma": "DTS-HD", aac: "AAC", flac: "FLAC", opus: "OPUS" };

type Rect = { x: number; y: number; width: number; height: number };

const H_ALIGNS = ["left", "center", "right"] as const;
const V_ALIGNS = ["top", "center", "bottom"] as const;

function refPoint(box: Rect, h: (typeof H_ALIGNS)[number], v: (typeof V_ALIGNS)[number]) {
  const rx = h === "left" ? box.x : h === "right" ? box.x + box.width : box.x + box.width / 2;
  const ry = v === "top" ? box.y : v === "bottom" ? box.y + box.height : box.y + box.height / 2;
  return { rx, ry };
}

const anchor = (h: (typeof H_ALIGNS)[number], v: (typeof V_ALIGNS)[number]) => ({
  ax: h === "left" ? 0 : h === "right" ? POSTER_WIDTH : POSTER_WIDTH / 2,
  ay: v === "top" ? 0 : v === "bottom" ? POSTER_HEIGHT : POSTER_HEIGHT / 2,
});

/** Nearest nine-cell anchor for a box dropped on the poster; offsets are whole pixels, clamped at 0. */
export function snapToAnchor(box: Rect) {
  let best = { h: "left" as (typeof H_ALIGNS)[number], v: "top" as (typeof V_ALIGNS)[number], d: Infinity };
  for (const h of H_ALIGNS) {
    for (const v of V_ALIGNS) {
      const { rx, ry } = refPoint(box, h, v);
      const { ax, ay } = anchor(h, v);
      const d = (rx - ax) ** 2 + (ry - ay) ** 2;
      if (d < best.d) best = { h, v, d };
    }
  }
  const horizontal_offset =
    best.h === "center" ? 0 : Math.max(0, Math.round(best.h === "left" ? box.x : POSTER_WIDTH - box.width - box.x));
  const vertical_offset =
    best.v === "center" ? 0 : Math.max(0, Math.round(best.v === "top" ? box.y : POSTER_HEIGHT - box.height - box.y));
  return { horizontal_align: best.h, vertical_align: best.v, horizontal_offset, vertical_offset };
}

const H_POSITIONS = ["left", "left2", "center", "center_left", "center_right", "right", "right2"] as const;
const V_POSITIONS = ["top", "top2", "top3", "center", "center_top", "center_bottom", "bottom", "bottom2", "bottom3"] as const;

function groupBounds(boxes: Rect[]): Rect {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.width));
  const y2 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: x2 - x, height: y2 - y };
}

/** Nearest allowed position keys for a position-based overlay (e.g. ratings). */
export function snapToPosition(box: Rect, layout: OverlayLayout | undefined, own: Vars) {
  let best = { horizontal_position: "left" as string, vertical_position: "center" as string, d: Infinity };
  for (const horizontal_position of H_POSITIONS) {
    for (const vertical_position of V_POSITIONS) {
      const placed = layerBoxes("__snap__", "__snap__", layout, { ...own, horizontal_position, vertical_position });
      if (!placed.length) continue;
      const g = groupBounds(placed);
      const dx = box.x + box.width / 2 - (g.x + g.width / 2);
      const dy = box.y + box.height / 2 - (g.y + g.height / 2);
      const d = dx * dx + dy * dy;
      if (d < best.d) best = { horizontal_position, vertical_position, d };
    }
  }
  return { horizontal_position: best.horizontal_position, vertical_position: best.vertical_position };
}

/** The first pair of boxes that overlap with positive area (edge contact alone does not count). */
export function overlapPair<T extends Rect & { label?: string }>(boxes: T[]): [string, string] | null {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const w = Math.min(boxes[i].x + boxes[i].width, boxes[j].x + boxes[j].width) - Math.max(boxes[i].x, boxes[j].x);
      const h = Math.min(boxes[i].y + boxes[i].height, boxes[j].y + boxes[j].height) - Math.max(boxes[i].y, boxes[j].y);
      if (w > 0 && h > 0) return [boxes[i].label ?? "", boxes[j].label ?? ""];
    }
  }
  return null;
}

export const overlaps = (boxes: Rect[]): boolean => overlapPair(boxes) !== null;

/** What a layer says on this title, where Plex's listing can tell. */
export function layerText(name: string, label: string, item: PlexItem | null): string {
  if (name === "resolution") {
    const resolution = item?.video_resolution;
    if (!resolution) return item ? label : "4K";
    return /^\d+$/.test(resolution) ? `${resolution}P` : resolution.toUpperCase();
  }
  if (name === "audio_codec" && item?.audio_codec) return AUDIO[item.audio_codec] ?? item.audio_codec.toUpperCase();
  return label;
}
