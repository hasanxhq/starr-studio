import { FilterRules } from "../../components/builder/FilterRules";
import { SourcesEditor, type DraftSource } from "../../components/builder/SourcesEditor";
import { Field, inputClass } from "../../components/ui";
import type { BuilderField } from "../../builderApi";
import { BUILDER_STEP_LABELS, stepSummary } from "./stepSummaries";
import { PosterSection, VisibleCheck } from "./builderFields";
import type { Draft, StartMode } from "./draft";

const LIST_SORTS = [
  { key: "custom", label: "List order" },
  { key: "release", label: "Release date" },
  { key: "alpha", label: "Title" },
] as const;

export function BuilderSteps({
  library,
  libraryType,
  fields,
  sorts,
  mode,
  draft,
  openStep,
  onOpenStep,
  kometaUrl,
  onDraft,
  onListPicked,
  orderProblem,
}: {
  library: string;
  libraryType: "movie" | "show";
  fields: BuilderField[];
  sorts: { key: string; label: string }[];
  mode: StartMode;
  draft: Draft;
  openStep: number | null;
  onOpenStep: (step: number | null) => void;
  kometaUrl: string | null;
  onDraft: (patch: Partial<Draft> | ((current: Draft) => Draft)) => void;
  onListPicked: (label: string | null) => void;
  orderProblem: string | null;
}) {
  const isList = mode === "list";
  const panelId = (step: number) => `builder-step-${step}-panel`;

  return (
    <ol className="flex flex-col gap-3">
      {BUILDER_STEP_LABELS.map((label, index) => {
        const step = index + 1;
        const open = openStep === step;
        const summary = stepSummary(step, draft, mode, fields, sorts);
        return (
          <li key={step}>
            <section className="rounded-card border border-border bg-surface" aria-labelledby={`builder-step-${step}-heading`}>
              <div className="flex flex-wrap items-start justify-between gap-2 p-4">
                <div className="min-w-0 flex-1">
                  <h3 id={`builder-step-${step}-heading`} className="text-[15px] font-semibold">
                    <span className="text-muted">{step}.</span> {label}
                  </h3>
                  {!open && <p className="mt-1 text-sm text-muted">{summary}</p>}
                </div>
                {!open && (
                  <button
                    type="button"
                    className="min-h-11 shrink-0 rounded-control border border-border px-4 text-sm hover:bg-surface-2"
                    aria-expanded={false}
                    aria-controls={panelId(step)}
                    onClick={() => onOpenStep(step)}
                  >
                    Edit
                  </button>
                )}
              </div>
              {open && (
                <div id={panelId(step)} className="border-t border-border p-4">
                  {step === 1 &&
                    (isList ? (
                      <SourcesEditor
                        library={library}
                        libraryType={libraryType}
                        fields={fields}
                        sources={draft.sources}
                        onChange={(sources: DraftSource[]) => onDraft({ sources })}
                        onListPicked={onListPicked}
                      />
                    ) : (
                      <FilterRules
                        library={library}
                        fields={fields}
                        value={draft.filters}
                        onChange={(filters) => onDraft({ filters })}
                      />
                    ))}
                  {step === 2 && (
                    <div className="flex flex-col gap-3">
                      {isList ? (
                        <Field label="Order" hint={orderProblem ? `${orderProblem} List order isn't available.` : undefined}>
                          <select
                            className={inputClass}
                            value={draft.sort_by ?? (orderProblem ? "release" : "custom")}
                            onChange={(event) => onDraft({ sort_by: event.target.value })}
                            aria-label="Order"
                          >
                            {LIST_SORTS.map((sort) => (
                              <option key={sort.key} value={sort.key} disabled={sort.key === "custom" && orderProblem !== null}>
                                {sort.label}
                              </option>
                            ))}
                          </select>
                        </Field>
                      ) : (
                        <>
                          <Field label="Sort">
                            <select
                              className={inputClass}
                              value={draft.sort_by ?? ""}
                              onChange={(event) => onDraft({ sort_by: event.target.value || null })}
                              aria-label="Sort"
                            >
                              <option value="">Kometa&apos;s default (random)</option>
                              {sorts.map((sort) => (
                                <option key={sort.key} value={sort.key}>
                                  {sort.label}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Limit">
                            <input
                              type="number"
                              min={1}
                              className={inputClass}
                              value={draft.limit ?? ""}
                              onChange={(event) =>
                                onDraft({ limit: event.target.value === "" ? null : Number.parseInt(event.target.value, 10) })
                              }
                              aria-label="Limit"
                            />
                          </Field>
                        </>
                      )}
                      <Field label="Minimum titles" hint="Kometa doesn't make it with fewer">
                        <input
                          type="number"
                          min={1}
                          className={inputClass}
                          value={draft.minimum_items}
                          onChange={(event) => onDraft({ minimum_items: Number.parseInt(event.target.value || "1", 10) })}
                          aria-label="Minimum titles"
                        />
                      </Field>
                    </div>
                  )}
                  {step === 3 && (
                    <div className="flex flex-col gap-4">
                      <PosterSection poster={draft.poster} kometaUrl={kometaUrl} onChange={(poster) => onDraft({ poster })} />
                      <div className="flex flex-col gap-2">
                        <p className="text-sm font-medium">Where it shows</p>
                        <VisibleCheck
                          checked={draft.visible.library}
                          onChange={(checked) => onDraft({ visible: { ...draft.visible, library: checked } })}
                        >
                          Library recommended
                        </VisibleCheck>
                        <VisibleCheck checked={draft.visible.home} onChange={(checked) => onDraft({ visible: { ...draft.visible, home: checked } })}>
                          My home
                        </VisibleCheck>
                        <VisibleCheck
                          checked={draft.visible.shared}
                          onChange={(checked) => onDraft({ visible: { ...draft.visible, shared: checked } })}
                        >
                          Friends&apos; home
                        </VisibleCheck>
                      </div>
                    </div>
                  )}
                  {step === 4 && (
                    <div className="flex flex-col gap-3">
                      <Field label="Summary">
                        <textarea
                          className={`${inputClass} min-h-24 py-2`}
                          value={draft.summary}
                          onChange={(event) => onDraft({ summary: event.target.value })}
                          aria-label="Summary"
                        />
                      </Field>
                      <Field label="Sort title">
                        <input
                          className={inputClass}
                          value={draft.sort_title}
                          onChange={(event) => onDraft({ sort_title: event.target.value })}
                          aria-label="Sort title"
                        />
                      </Field>
                    </div>
                  )}
                </div>
              )}
            </section>
          </li>
        );
      })}
    </ol>
  );
}
