import { type ReactNode } from "react";

import { Button, Checkbox, Field, inputClass } from "../../../../components/ui";
import { setProp } from "../model/styleDoc";
import { FACT_NAMES } from "./constants";
import { isOptionRef, optionName, optionsFromText } from "./styleHelpers";

export function ColourInput({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
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

export function LengthInput({ label, value, onChange, disabled }: { label: string; value: unknown; onChange: (value: number | string | undefined) => void; disabled?: boolean }) {
  const display = value === undefined || value === null ? "" : String(value);
  return (
    <Field label={label}>
      <input
        type="text"
        aria-label={label}
        disabled={disabled}
        className={`${inputClass} font-mono text-xs`}
        value={display}
        spellCheck={false}
        onChange={(e) => {
          const raw = e.target.value.trim();
          if (raw === "") onChange(undefined);
          else if (raw.endsWith("%")) onChange(raw);
          else {
            const n = Number(raw);
            onChange(Number.isFinite(n) ? n : raw);
          }
        }}
      />
    </Field>
  );
}

export function NumberInput({ label, value, onChange, disabled, min, max, step }: { label: string; value: unknown; onChange: (value: number | undefined) => void; disabled?: boolean; min?: number; max?: number; step?: number }) {
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
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
      />
    </Field>
  );
}

export function OptionRefField({ label, value, onUnlink, disabled }: { label: string; value: string; text?: string; onUnlink: () => void; disabled?: boolean }) {
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

export function usePropEdit(edit: (fn: (t: string) => string, merge?: string) => void, path: string, readOnly: boolean) {
  return (key: string, value: unknown) => {
    if (readOnly) return;
    edit((t) => setProp(t, path, key, value), `${path}:${key}`);
  };
}

/** Colour or $option: shows unlink when it's an option reference. */
export function ColourOrOption({ label, value, text, path, propKey, edit, readOnly }: { label: string; value: unknown; text: string; path: string; propKey: string; edit: (fn: (t: string) => string, merge?: string) => void; readOnly: boolean }) {
  const set = usePropEdit(edit, path, readOnly);
  if (isOptionRef(value)) {
    const opts = optionsFromText(text);
    const def = opts[optionName(value)]?.default;
    return (
      <OptionRefField
        label={label}
        value={value}
        text={text}
        disabled={readOnly}
        onUnlink={() => {
          if (def !== undefined) set(propKey, def);
        }}
      />
    );
  }
  return <ColourInput label={label} value={String(value ?? "#FFFFFF")} disabled={readOnly} onChange={(v) => set(propKey, v)} />;
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