import { type ReactNode, useEffect, useState } from "react";

import { Button, Checkbox, Field, inputClass } from "../../../../components/ui";
import { useEditor } from "../EditorContext";
import { setProp } from "../model/styleDoc";
import { FACT_NAMES } from "./constants";
import { isOptionRef, optionDefaultForWrite, optionName } from "./styleHelpers";

/** A value that's "$name" shows as "From option name" with Unlink, which writes the option's default (see
 *  optionDefaultForWrite). Every field that can hold a value goes through this, so none forgets it. */
function OptionRef({ label, value, disabled, onChange }: { label: string; value: string; disabled?: boolean; onChange: (value: never) => void }) {
  const { text } = useEditor();
  return (
    <OptionRefField
      label={label}
      value={value}
      disabled={disabled}
      onUnlink={() => {
        const def = optionDefaultForWrite(text, value);
        if (def !== undefined) onChange(def as never); // an unknown option: leave it for the YAML view
      }}
    />
  );
}

export function ColourInput({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  if (isOptionRef(value)) return <OptionRef label={label} value={value} disabled={disabled} onChange={onChange} />;
  const hex = String(value ?? "");
  const picker = /^#[0-9a-f]{6}/i.test(hex) ? hex.slice(0, 7) : "#000000";
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          disabled={disabled}
          className="size-9 shrink-0 cursor-pointer rounded-control border border-border-strong bg-transparent disabled:cursor-not-allowed"
          value={picker}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          type="text"
          aria-label={label}
          disabled={disabled}
          className={`${inputClass} max-w-[8rem] font-mono text-xs`}
          value={hex}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </Field>
  );
}

const PERCENT_RE = /^-?\d+(?:\.\d+)?%$/;
const NUMBER_RE = /^-?\d+(?:\.\d+)?$/;

function lengthValid(raw: string): number | string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (PERCENT_RE.test(trimmed)) return trimmed;
  if (NUMBER_RE.test(trimmed)) return Number(trimmed);
  return null;
}

export function LengthInput({ label, value, onChange, disabled }: { label: string; value: unknown; onChange: (value: number | string) => void; disabled?: boolean }) {
  const ref = isOptionRef(value);
  const display = ref ? "" : value === undefined || value === null ? "" : String(value);
  const [draft, setDraft] = useState(display);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(display);
    setInvalid(false);
  }, [display]);

  if (ref) return <OptionRef label={label} value={value} disabled={disabled} onChange={onChange} />;

  return (
    <Field label={label}>
      <input
        type="text"
        aria-label={label}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        className={`${inputClass} font-mono text-xs`}
        value={draft}
        spellCheck={false}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          const parsed = lengthValid(raw);
          if (parsed !== null) {
            onChange(parsed);
            setInvalid(false);
          }
        }}
        onBlur={() => {
          const parsed = lengthValid(draft);
          if (parsed !== null) {
            onChange(parsed);
            setInvalid(false);
          } else setInvalid(true); // empty or not a length: the file keeps its last good value
        }}
      />
    </Field>
  );
}

export function NumberInput({
  label,
  value,
  onChange,
  disabled,
  min,
  max,
  step,
  optional,
}: {
  label: string;
  value: unknown;
  onChange: (value: number | undefined) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
  optional?: boolean;
}) {
  if (isOptionRef(value)) return <OptionRef label={label} value={value} disabled={disabled} onChange={onChange} />;
  return (
    <Field label={label}>
      <input
        type="number"
        aria-label={label}
        disabled={disabled}
        className={`${inputClass} max-w-[8rem] text-xs`}
        min={min}
        max={max}
        step={step}
        value={value === undefined || value === null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? (optional ? undefined : Number(min ?? 0)) : Number(e.target.value))}
      />
    </Field>
  );
}

/** Padding: one number, or "vertical, horizontal" / "top, right, bottom, left" as the format allows. */
export function PaddingInput({ label, value, onChange, disabled }: { label: string; value: unknown; onChange: (value: number | number[]) => void; disabled?: boolean }) {
  const display = Array.isArray(value) ? value.join(", ") : value === undefined || value === null ? "" : String(value);
  const [draft, setDraft] = useState(display);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(display);
    setInvalid(false);
  }, [display]);
  if (isOptionRef(value)) return <OptionRef label={label} value={value} disabled={disabled} onChange={onChange} />;
  const commit = () => {
    const parts = draft.split(",").map((p) => p.trim());
    const ok = [1, 2, 4].includes(parts.length) && parts.every((p) => NUMBER_RE.test(p));
    setInvalid(!ok);
    if (ok) onChange(parts.length === 1 ? Number(parts[0]) : parts.map(Number));
  };
  return (
    <Field label={label}>
      <input type="text" aria-label={label} aria-invalid={invalid || undefined} disabled={disabled} className={`${inputClass} max-w-[8rem] font-mono text-xs`} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
    </Field>
  );
}

export function OptionRefField({ label, value, onUnlink, disabled }: { label: string; value: string; onUnlink: () => void; disabled?: boolean }) {
  const name = optionName(value);
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="text-muted">{label}</span>
      <p className="text-xs text-muted">From option {name}</p>
      <Button disabled={disabled} aria-label="Unlink" onClick={onUnlink} className="self-start">
        Unlink
      </Button>
    </div>
  );
}

/** Shows "From option …" when value is $name, otherwise children. */
export function OptionLinkedField({ label, value, disabled, onUnlink, children }: { label: string; value: unknown; disabled?: boolean; onUnlink: () => void; children: ReactNode }) {
  if (isOptionRef(value)) {
    return <OptionRefField label={label} value={value} disabled={disabled} onUnlink={onUnlink} />;
  }
  return <>{children}</>;
}

export function propEdit(edit: (fn: (t: string) => string, merge?: string) => void, path: string, readOnly: boolean) {
  return (key: string, value: unknown) => {
    if (readOnly) return;
    edit((t) => setProp(t, path, key, value), `${path}:${key}`);
  };
}

/** Colour or $option: shows unlink when it's an option reference. */
export function ColourOrOption({ label, value, text, path, propKey, edit, readOnly }: { label: string; value: unknown; text: string; path: string; propKey: string; edit: (fn: (t: string) => string, merge?: string) => void; readOnly: boolean }) {
  const set = propEdit(edit, path, readOnly);
  return (
    <OptionLinkedField
      label={label}
      value={value}
      disabled={readOnly}
      onUnlink={() => {
        const def = optionDefaultForWrite(text, value as string);
        if (def !== undefined) set(propKey, def);
      }}
    >
      <ColourInput label={label} value={String(value ?? "#FFFFFF")} disabled={readOnly} onChange={(v) => set(propKey, v)} />
    </OptionLinkedField>
  );
}

export function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="border-t border-border pt-2 first:border-t-0 first:pt-0">
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted">{title}</summary>
      <div className="mt-2 flex flex-col gap-2">{children}</div>
    </details>
  );
}

export function HasMultiSelect({ picked, onChange, disabled }: { picked: string[]; onChange: (names: string[]) => void; disabled?: boolean }) {
  return (
    <fieldset className="text-sm">
      <legend className="mb-1 text-xs text-muted">Only when the title has</legend>
      <div className="max-h-36 overflow-y-auto">
        {FACT_NAMES.map((name) => (
          <Checkbox key={name} disabled={disabled} checked={picked.includes(name)} onChange={(on) => onChange(on ? [...picked, name] : picked.filter((p) => p !== name))}>
            {name}
          </Checkbox>
        ))}
      </div>
    </fieldset>
  );
}