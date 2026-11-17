// One control per option in a style's `options` map (docs/plans/overlay-engine.md section 3.6).

import { Checkbox, Field, inputClass } from "../../../components/ui";
import type { StyleOption } from "../../../overlayEngineApi";

type Values = Record<string, unknown>;

function OptionControl({ opt, value, onChange }: { opt: StyleOption; value: unknown; onChange: (value: unknown) => void }) {
  switch (opt.type) {
    case "colour": {
      const hex = String(value ?? "");
      return (
        <Field label={opt.label}>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label={`${opt.label} picker`}
              className="size-11 shrink-0 cursor-pointer rounded-control border border-border-strong bg-transparent"
              value={/^#[0-9a-f]{6}/i.test(hex) ? hex.slice(0, 7) : "#000000"} // the picker takes #rrggbb only
              onChange={(e) => onChange(e.target.value)}
            />
            <input type="text" aria-label={opt.label} className={`${inputClass} max-w-[9rem] font-mono`} value={hex} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
          </div>
        </Field>
      );
    }
    case "percent": {
      const num = Number(value ?? 0);
      return (
        <Field label={opt.label} hint={`${num}%`}>
          <input type="range" min={0} max={100} value={num} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-accent" aria-valuetext={`${num}%`} />
        </Field>
      );
    }
    case "number":
      return (
        <Field label={opt.label}>
          <input
            type="number"
            className={`${inputClass} max-w-[9rem]`}
            min={opt.min}
            max={opt.max}
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value === "" ? opt.default : Number(e.target.value))}
          />
        </Field>
      );
    case "choice": {
      const choices = opt.choices ?? [];
      if (opt.multiple) {
        const picked = Array.isArray(value) ? (value as string[]) : [];
        return (
          <fieldset className="flex flex-col text-sm">
            <legend className="mb-1.5 text-muted">{opt.label}</legend>
            {choices.map((choice) => (
              // Keep the choices' order, whatever order they were ticked in.
              <Checkbox key={choice} checked={picked.includes(choice)} onChange={(on) => onChange(choices.filter((c) => (c === choice ? on : picked.includes(c))))}>
                {choice}
              </Checkbox>
            ))}
          </fieldset>
        );
      }
      return (
        <Field label={opt.label}>
          <select className={inputClass} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
            {choices.map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </select>
        </Field>
      );
    }
    case "toggle":
      return (
        <Checkbox checked={value === true} onChange={onChange}>
          {opt.label}
        </Checkbox>
      );
    case "text":
      return (
        <Field label={opt.label}>
          <input type="text" className={inputClass} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
        </Field>
      );
  }
}

export function OptionsForm({ options, values, onChange }: { options: Record<string, StyleOption>; values: Values; onChange: (values: Values) => void }) {
  const entries = Object.entries(options);
  if (entries.length === 0) return <p className="text-sm text-muted">This style has no options.</p>;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {entries.map(([key, opt]) => (
        <OptionControl key={key} opt={opt} value={key in values ? values[key] : opt.default} onChange={(value) => onChange({ ...values, [key]: value })} />
      ))}
    </div>
  );
}
