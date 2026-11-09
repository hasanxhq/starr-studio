import { useEffect, useMemo, useState, type ReactNode } from "react";
import { stringify } from "yaml";

import { SettingField } from "../../components/forms/fields";
import { AnchorGrid, OffsetInput } from "../../components/OverlayPreview";
import { ConfirmButton, Field } from "../../components/ui";
import { Checkbox } from "../../components/ui";
import { resolveLayout } from "../../overlayLayout";
import { defaultVariablesSchema, mappingKeys, type JsonSchema } from "../../yaml/schema";
import { MoreVariables, type Values } from "../../components/DefaultVariables";
import { overlayFeatured, PLACEMENT } from "./controls";
import type { Layer } from "./types";

const ACCENT_HEX = "#f2b544";
const SWATCHES = [
  { label: "Black", value: "#000000CC" },
  { label: "Charcoal", value: "#1F1F1FCC" },
  { label: "White", value: "#FFFFFFCC" },
  { label: "Accent", value: `${ACCENT_HEX}CC` },
];

const side = (value: unknown, fallback: string) => String(value ?? fallback).split(/[_0-9]/)[0];

function hexRgb(hex: string): string {
  const h = hex.replace("#", "").slice(0, 6).padEnd(6, "0");
  return `#${h}`.toUpperCase();
}

function readBackColor(values: Values, fallback: string): { rgb: string; alpha: number } {
  const raw = String(values.back_color ?? fallback);
  const match = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(raw.replace("#", "#"));
  if (!match) return { rgb: "#000000", alpha: 204 };
  return { rgb: `#${match[1].toUpperCase()}`, alpha: match[2] ? Number.parseInt(match[2], 16) : 255 };
}

function writeBackColor(rgb: string, alpha: number): string {
  const a = Math.max(0, Math.min(255, alpha)).toString(16).padStart(2, "0").toUpperCase();
  return `${hexRgb(rgb)}${a}`;
}

type Tab = "place" | "style" | "when";

export function LayerSettings({
  layer,
  libraryVariables,
  libraryType,
  root,
  values,
  onChange,
  onRemove,
  removing,
  noToggles,
  whatChanges,
}: {
  layer: Layer;
  libraryVariables: Values;
  libraryType: string | null;
  root: JsonSchema | null;
  values: Values;
  onChange: (values: Values) => void;
  onRemove: () => void;
  removing: boolean;
  noToggles: ReactNode;
  whatChanges: string | null;
}) {
  const [tab, setTab] = useState<Tab>("place");
  const layout = layer.entry?.layout;
  const position = layout?.moved_by === "position";
  const toggles = (layer.entry?.toggles ?? []).filter((toggle) => !libraryType || toggle.types.includes(libraryType));
  const schema = root ? defaultVariablesSchema(root, "overlay", layer.name) : undefined;
  const { keys } = useMemo(() => (root ? mappingKeys(root, schema) : { keys: [], patterns: [] }), [root, schema]);
  const known = new Map(keys.map((k) => [k.name, k]));
  const featured = overlayFeatured(layer.name, layout?.moved_by, libraryType);
  const styleFeatured = featured.filter((f) => !PLACEMENT.includes(f.key) && f.key !== "back_color" && f.key !== "back_radius");
  const starting = useMemo(() => resolveLayout(layout, libraryVariables), [layout, libraryVariables]);
  const unlessStarting = (key: string, value: string) => (value === String(starting[key] ?? "") ? undefined : value);
  const vars = resolveLayout(layout, { ...libraryVariables, ...values });
  const horizontalKey = position ? "horizontal_position" : "horizontal_align";
  const verticalKey = position ? "vertical_position" : "vertical_align";
  const offsets = resolveLayout(layout, { ...libraryVariables, ...values, horizontal_offset: undefined, vertical_offset: undefined });
  const backFallback = String(starting.back_color ?? "#00000099");
  const { rgb, alpha } = readBackColor(values, backFallback);
  const radius = Number(values.back_radius ?? starting.back_radius ?? 30);

  const set = (key: string, value: unknown) => {
    const next = { ...values };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onChange(next);
  };

  const setBothOffsets = (distance: number) => {
    const next = { ...values };
    if (distance === Number(starting.horizontal_offset ?? 0) && distance === Number(starting.vertical_offset ?? 0)) {
      delete next.horizontal_offset;
      delete next.vertical_offset;
    } else {
      next.horizontal_offset = distance;
      next.vertical_offset = distance;
    }
    onChange(next);
  };

  const distance = Number(values.horizontal_offset ?? offsets.horizontal_offset ?? 0);

  const startsOn = (toggle: (typeof toggles)[number]) => toggle.on && values.use_all !== false;
  // Variables the tabs above have controls for; More variables lists the rest.
  const handled = new Set([...PLACEMENT, ...featured.map((f) => f.key), ...toggles.map((t) => `use_${t.key}`)]);

  const preview = stringify([{ default: layer.name, ...(Object.keys(values).length > 0 && { template_variables: values }) }], { lineWidth: 0 }).trimEnd();

  useEffect(() => {
    setTab("place");
  }, [layer.name]);

  return (
    <aside aria-label="Layer settings" className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-surface p-5">
      <div>
        <h2 className="text-[15px] font-semibold">{layer.title}</h2>
        {whatChanges && <p className="mt-1 text-sm text-muted">{whatChanges}</p>}
        {layer.entry?.docs_url && (
          <a className="text-[13px] text-muted underline hover:text-text" href={layer.entry.docs_url} target="_blank" rel="noreferrer">
            Kometa wiki
          </a>
        )}
      </div>
      <div role="tablist" aria-label="Layer settings" className="flex flex-wrap gap-1">
        {(
          [
            ["place", "Place"],
            ["style", "Style"],
            ["when", "Show when"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`min-h-11 rounded-control border px-3 text-sm ${tab === id ? "border-accent bg-surface-2 text-text" : "border-transparent text-muted hover:bg-surface-2"}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "place" && (
        <div role="tabpanel" className="flex flex-col gap-4">
          <AnchorGrid
            horizontal={side(vars[horizontalKey], "left")}
            vertical={side(vars[verticalKey], "top")}
            onChange={(horizontal, vertical) => {
              onChange({
                ...values,
                [horizontalKey]: unlessStarting(horizontalKey, horizontal),
                [verticalKey]: unlessStarting(verticalKey, vertical),
              });
            }}
          />
          {layer.name === "ratings" && known.has("rating_alignment") && (
            <Field label="Run">
              <div className="flex gap-2">
                {[
                  ["horizontal", "Across"],
                  ["vertical", "Down"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={(values.rating_alignment ?? starting.rating_alignment ?? "horizontal") === value}
                    className={`min-h-11 flex-1 rounded-control border text-sm ${(values.rating_alignment ?? starting.rating_alignment ?? "horizontal") === value ? "border-accent bg-surface-2" : "border-border-strong hover:bg-surface-2"}`}
                    onClick={() => {
                      const defaultAlign = String(starting.rating_alignment ?? "horizontal");
                      set("rating_alignment", value === defaultAlign ? undefined : value);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Field>
          )}
          {!position && (
            <Field label="Distance from the edge">
              <input
                type="range"
                min={0}
                max={200}
                value={distance}
                onChange={(e) => setBothOffsets(Number(e.target.value))}
                className="w-full accent-accent"
                aria-valuetext={`${distance} pixels`}
              />
              <span className="text-xs text-muted">{distance} px</span>
            </Field>
          )}
          <details className="text-sm">
            <summary className="min-h-11 cursor-pointer content-center text-muted hover:text-text">Show Advanced</summary>
            <div className="mt-3 flex flex-col gap-3">
              {!position && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Offset X">
                    <OffsetInput label="Offset X" value={values.horizontal_offset} onChange={(next) => set("horizontal_offset", next)} placeholder={String(offsets.horizontal_offset ?? 0)} />
                  </Field>
                  <Field label="Offset Y">
                    <OffsetInput label="Offset Y" value={values.vertical_offset} onChange={(next) => set("vertical_offset", next)} placeholder={String(offsets.vertical_offset ?? 0)} />
                  </Field>
                </div>
              )}
            </div>
          </details>
        </div>
      )}

      {tab === "style" && (
        <div role="tabpanel" className="flex flex-col gap-4">
          <Field label="Background">
            <div className="flex flex-wrap gap-2">
              {SWATCHES.map((swatch) => (
                <button
                  key={swatch.label}
                  type="button"
                  aria-pressed={hexRgb(rgb) === hexRgb(swatch.value)}
                  aria-label={swatch.label}
                  className={`size-11 rounded-control border-2 ${hexRgb(rgb) === hexRgb(swatch.value) ? "border-accent" : "border-border-strong"}`}
                  style={{ background: swatch.value.slice(0, 7) }}
                  onClick={() => set("back_color", writeBackColor(swatch.value, alpha))}
                />
              ))}
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted">
                Custom
                <input
                  type="color"
                  className="size-11 cursor-pointer rounded-control border border-border-strong bg-transparent"
                  value={hexRgb(rgb)}
                  onChange={(e) => set("back_color", writeBackColor(e.target.value, alpha))}
                  aria-label="Custom background colour"
                />
              </label>
            </div>
          </Field>
          <Field label="See-through">
            <input
              type="range"
              min={0}
              max={255}
              value={255 - alpha}
              onChange={(e) => set("back_color", writeBackColor(rgb, 255 - Number(e.target.value)))}
              className="w-full accent-accent"
              aria-valuetext={`${Math.round(((255 - alpha) / 255) * 100)}% see-through`}
            />
          </Field>
          {layout?.moved_by === "align" && (
            <Field label="Rounded corners">
              <input
                type="range"
                min={0}
                max={50}
                value={radius}
                onChange={(e) => set("back_radius", Number(e.target.value) === Number(starting.back_radius ?? 30) ? undefined : Number(e.target.value))}
                className="w-full accent-accent"
                aria-valuetext={`${radius} pixels`}
              />
            </Field>
          )}
          {styleFeatured.map(({ key, label, switchOn, hint, options, unset }) => {
            const info = known.get(key);
            if (!info) return null;
            return switchOn === undefined ? (
              <SettingField
                key={key}
                name={key}
                label={label}
                root={root}
                schema={info.schema}
                value={values[key]}
                onChange={(next) => set(key, next)}
                hint={hint}
                unset={unset ?? "Kometa's default"}
                optionLabels={options}
              />
            ) : (
              <label key={key} className="flex min-h-11 items-center justify-between gap-3 text-sm">
                {label}
                <input type="checkbox" className="size-[18px] accent-accent" checked={(values[key] ?? switchOn) === true} onChange={(e) => set(key, e.target.checked === switchOn ? undefined : e.target.checked)} />
              </label>
            );
          })}
        </div>
      )}

      {tab === "when" && (
        <div role="tabpanel" className="flex flex-col gap-3">
          {toggles.length <= 1 && noToggles}
          {toggles.length > 1 && (
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-sm font-semibold">Show when</legend>
              <div className="grid max-h-72 grid-cols-2 gap-x-3 overflow-y-auto">
                {toggles.map((toggle) => (
                  <Checkbox
                    key={toggle.key}
                    checked={(values[`use_${toggle.key}`] ?? startsOn(toggle)) === true}
                    onChange={(checked) => set(`use_${toggle.key}`, checked === startsOn(toggle) ? undefined : checked)}
                  >
                    {toggle.label}
                  </Checkbox>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      )}

      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer content-center text-muted hover:text-text">Show the config.yml lines</summary>
        <pre className="mt-2 overflow-x-auto rounded-control border border-border bg-bg p-3 font-mono text-xs leading-5 text-muted">{preview}</pre>
      </details>

      <MoreVariables root={root} schema={schema} values={values} set={set} handled={handled} />

      <ConfirmButton
        label="Remove layer"
        confirm={`Turn off ${layer.title}`}
        warning="Kometa stops drawing it. Posters update on the next overlay run."
        onConfirm={onRemove}
        busy={removing}
      />
    </aside>
  );
}
