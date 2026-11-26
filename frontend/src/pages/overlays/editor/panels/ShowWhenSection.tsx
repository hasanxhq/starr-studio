import { useEffect, useState } from "react";
import { parse, stringify } from "yaml";

import { Field, inputClass } from "../../../../components/ui";
import type { StyleOption } from "../../../../overlayEngineApi";
import { setProp } from "../model/styleDoc";
import { HasMultiSelect } from "./fields";
import { isOptionRef, isSimpleShowWhen, optionsFromText } from "./styleHelpers";

function AdvancedShowWhen({
  rule,
  readOnly,
  onSave,
}: {
  rule: unknown;
  readOnly: boolean;
  onSave: (next: Record<string, unknown> | undefined) => void;
}) {
  const yamlText = rule === undefined ? "" : stringify(rule).trimEnd();
  const [draft, setDraft] = useState(yamlText);
  const [yamlError, setYamlError] = useState<string | null>(null);
  useEffect(() => setDraft(yamlText), [yamlText]);

  return (
    <div className="flex flex-col gap-1">
      <Field label="Show when (YAML)">
        <textarea
          aria-label="Show when rule"
          disabled={readOnly}
          className={`${inputClass} min-h-[5rem] font-mono text-xs`}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setYamlError(null);
          }}
          onBlur={() => {
            const raw = draft.trim();
            if (!raw) {
              setYamlError(null);
              onSave(undefined);
              return;
            }
            try {
              const parsed = parse(raw);
              if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("needs to be a mapping");
              setYamlError(null);
              onSave(parsed as Record<string, unknown>);
            } catch (error) {
              setYamlError((error as Error).message);
            }
          }}
        />
      </Field>
      {yamlError && (
        <p role="alert" className="text-xs text-err">
          {yamlError}
        </p>
      )}
    </div>
  );
}

export function ShowWhenSection({
  text,
  path,
  rule,
  edit,
  readOnly,
}: {
  text: string;
  path: string;
  rule: unknown;
  edit: (fn: (t: string) => string, merge?: string) => void;
  readOnly: boolean;
}) {
  const options = optionsFromText(text);
  const advanced = rule !== undefined && rule !== null && !isSimpleShowWhen(rule);

  const writeRule = (next: Record<string, unknown> | undefined) => {
    edit((t) => setProp(t, path, "show_when", next === undefined || !Object.keys(next).length ? undefined : next), `${path}:show_when`);
  };

  if (advanced) {
    return <AdvancedShowWhen rule={rule} readOnly={readOnly} onSave={writeRule} />;
  }

  const showWhen = (typeof rule === "object" && rule && !Array.isArray(rule) ? rule : {}) as Record<string, unknown>;
  const has = showWhen.has;
  const hasList = (Array.isArray(has) ? has : has !== undefined ? [has] : []).map(String);
  const days = showWhen.added_within_days;
  const optionRule = (showWhen.option ?? {}) as Record<string, unknown>;

  const patchRule = (patch: Record<string, unknown>) => {
    const next = { ...showWhen, ...patch };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete next[k];
    }
    writeRule(Object.keys(next).length ? next : undefined);
  };

  return (
    <div className="flex flex-col gap-2">
      <HasMultiSelect
        disabled={readOnly}
        picked={hasList}
        onChange={(names) => patchRule({ has: names.length ? (names.length === 1 ? names[0] : names) : undefined })}
      />
      <Field label="Only when added within N days">
        {isOptionRef(days) ? (
          <p className="text-xs text-muted">Uses option {String(days).slice(1)} (edit in YAML view or unlink elsewhere)</p>
        ) : (
          <input
            type="number"
            aria-label="Added within days"
            disabled={readOnly}
            min={0}
            className={`${inputClass} max-w-[8rem] text-xs`}
            value={days === undefined ? "" : String(days)}
            onChange={(e) => patchRule({ added_within_days: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        )}
      </Field>
      {Object.keys(options).length > 0 && (
        <fieldset className="text-sm">
          <legend className="mb-1 text-xs text-muted">Only when option … is …</legend>
          {Object.entries(options).map(([optName, opt]) => (
            <OptionShowWhen
              key={optName}
              name={optName}
              opt={opt}
              value={optionRule[optName]}
              disabled={readOnly}
              onChange={(v) => {
                const nextOpt = { ...optionRule };
                if (v === undefined) delete nextOpt[optName];
                else nextOpt[optName] = v;
                patchRule({ option: Object.keys(nextOpt).length ? nextOpt : undefined });
              }}
            />
          ))}
        </fieldset>
      )}
    </div>
  );
}

function OptionShowWhen({ name, opt, value, onChange, disabled }: { name: string; opt: StyleOption; value: unknown; onChange: (v: unknown) => void; disabled?: boolean }) {
  const label = opt.label || name;
  if (opt.type === "choice" && opt.multiple) {
    const picked = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="mb-2">
        <span className="text-xs text-muted">{label}</span>
        <div className="mt-1">
          {(opt.choices ?? []).map((choice) => (
            <label key={choice} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                disabled={disabled}
                checked={picked.includes(choice)}
                onChange={(e) => {
                  const on = e.target.checked;
                  const next = on ? [...picked, choice] : picked.filter((c) => c !== choice);
                  onChange(next.length ? next : undefined);
                }}
              />
              {opt.choice_labels?.[choice] ?? choice}
            </label>
          ))}
        </div>
      </div>
    );
  }
  if (opt.type === "choice") {
    return (
      <Field label={label}>
        <select
          className={`${inputClass} text-xs`}
          disabled={disabled}
          value={value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
        >
          <option value="">Any</option>
          {(opt.choices ?? []).map((choice) => (
            <option key={choice} value={choice}>
              {opt.choice_labels?.[choice] ?? choice}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  if (opt.type === "toggle") {
    return (
      <label className="mb-2 flex items-center gap-2 text-xs">
        <input type="checkbox" disabled={disabled} checked={value === true} onChange={(e) => onChange(e.target.checked ? true : undefined)} />
        {label}
      </label>
    );
  }
  return null;
}