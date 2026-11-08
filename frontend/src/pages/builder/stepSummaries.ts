import type { BuilderField } from "../../builderApi";
import { sourceLabel } from "../../builderApi";
import type { Draft, StartMode } from "./draft";
import { toApiSources } from "../../components/builder/SourcesEditor";

const LIST_SORT_LABELS: Record<string, string> = {
  custom: "As the list has it",
  release: "Release date",
  alpha: "Title",
};

function ruleSummary(field: BuilderField | undefined, value: unknown): string {
  if (!field) return "rule";
  if (field.kind === "tag" && Array.isArray(value) && value.length > 0) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === "" || value == null) return "…";
  return String(value);
}

function whatGoesInSummary(draft: Draft, mode: StartMode, fields: BuilderField[]): string {
  if (mode === "list") {
    const ready = toApiSources(draft.sources);
    const labels = ready.map((source) => sourceLabel(source));
    if (labels.length === 0) return "No sources yet";
    const n = labels.length;
    const preview = labels.slice(0, 2).join(", ");
    const more = n > 2 ? `, +${n - 2}` : "";
    return `${n} source${n === 1 ? "" : "s"}: ${preview}${more}`;
  }
  const rules = draft.filters.rules;
  if (rules.length === 0) return "No rules yet";
  const parts = rules.map((rule) => {
    const field = fields.find((f) => f.key === rule.field);
    const name = field?.label ?? rule.field;
    return `${name} ${rule.modifier === "not" ? "is not" : "is"} ${ruleSummary(field, rule.value)}`;
  });
  const n = parts.length;
  const head = parts.slice(0, 2).join(", ");
  return `${n} rule${n === 1 ? "" : "s"}: ${head}${n > 2 ? ", …" : ""}`;
}

function orderSummary(draft: Draft, mode: StartMode, sortLabels: Map<string, string>): string {
  let sortPart: string;
  if (mode === "list") {
    const key = draft.sort_by ?? "custom";
    sortPart = LIST_SORT_LABELS[key] ?? key;
  } else {
    sortPart = draft.sort_by ? (sortLabels.get(draft.sort_by) ?? draft.sort_by) : "Random";
  }
  const limitPart = mode === "list" ? "no limit" : draft.limit == null ? "no limit" : `${draft.limit} titles`;
  const minPart = `at least ${draft.minimum_items} title${draft.minimum_items === 1 ? "" : "s"}`;
  return `${sortPart} · ${limitPart} · ${minPart}`;
}

function visibleSummary(draft: Draft): string {
  const places: string[] = [];
  if (draft.visible.library === true) places.push("Library");
  if (draft.visible.home === true) places.push("Home");
  if (draft.visible.shared === true) places.push("Friends' home");
  const where = places.length > 0 ? places.join(" and ") : "Hidden";
  return where;
}

function posterSummary(draft: Draft): string {
  if (!draft.poster) return "Plex mosaic";
  if (draft.poster.kind === "file") return "Uploaded image";
  return "Custom image";
}

function detailsSummary(draft: Draft): string {
  const text = draft.summary.trim() || draft.sort_title.trim();
  if (!text) return "No details";
  const words = text.split(/\s+/).slice(0, 6).join(" ");
  return words.length < text.length ? `${words}…` : words;
}

export function stepSummary(
  step: number,
  draft: Draft,
  mode: StartMode,
  fields: BuilderField[],
  sorts: { key: string; label: string }[],
): string {
  const sortLabels = new Map(sorts.map((s) => [s.key, s.label]));
  switch (step) {
    case 1:
      return whatGoesInSummary(draft, mode, fields);
    case 2:
      return orderSummary(draft, mode, sortLabels);
    case 3:
      return `${posterSummary(draft)} · ${visibleSummary(draft)}`;
    case 4:
      return detailsSummary(draft);
    default:
      return "";
  }
}

export const BUILDER_STEP_LABELS = ["What goes in", "Order and size", "How it looks in Plex", "Details (optional)"] as const;

export function stepForSaveProblem(problem: string): number {
  const lower = problem.toLowerCase();
  if (lower.includes("poster") || lower.includes("visible") || lower.includes("recommended") || lower.includes("home")) return 3;
  if (lower.includes("limit") || lower.includes("sort") || lower.includes("order") || lower.includes("minimum")) return 2;
  if (lower.includes("summary") || lower.includes("sort title")) return 4;
  return 1;
}
