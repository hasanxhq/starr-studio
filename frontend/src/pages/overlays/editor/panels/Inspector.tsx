import { useRef } from "react";

import { Checkbox, Field, inputClass } from "../../../../components/ui";
import { useEditor } from "../EditorContext";
import { elementAt, isMovable } from "../model/styleDoc";
import { ALIGNMENTS, BOX_KEYS, FONTS, LOGOS, PLACEHOLDER_KEYS } from "./constants";
import { ColourInput, ColourOrOption, LengthInput, NumberInput, OptionLinkedField, Section, propEdit } from "./fields";
import { ShowWhenSection } from "./ShowWhenSection";
import { isOptionRef, optionDefaultForWrite } from "./styleHelpers";

export function Inspector() {
  const { text, selection, edit, readOnly } = useEditor();

  if (selection.length > 1) {
    return (
      <section aria-label="Element settings" className="max-h-[min(70vh,40rem)] overflow-y-auto rounded-card border border-border bg-surface p-3 text-sm">
        <h3 className="font-semibold">Settings</h3>
        <p className="mt-2 text-muted">{selection.length} elements selected</p>
      </section>
    );
  }

  if (selection.length === 0) {
    return (
      <section aria-label="Element settings" className="rounded-card border border-border bg-surface p-3 text-sm">
        <h3 className="font-semibold">Settings</h3>
        <p className="mt-2 text-muted">Select an element to change it.</p>
      </section>
    );
  }

  return <InspectorOne text={text} path={selection[0]} edit={edit} readOnly={readOnly} />;
}

function InspectorOne({ text, path, edit, readOnly }: { text: string; path: string; edit: (fn: (t: string) => string, merge?: string) => void; readOnly: boolean }) {
  let el: ReturnType<typeof elementAt>;
  try {
    el = elementAt(text, path);
  } catch {
    el = undefined;
  }
  if (!el) {
    return (
      <section aria-label="Element settings" className="rounded-card border border-border bg-surface p-3 text-sm">
        <h3 className="font-semibold">Settings</h3>
        <p className="mt-2 text-muted">This element isn&apos;t in the file right now.</p>
      </section>
    );
  }

  const set = propEdit(edit, path, readOnly);

  return (
    <section aria-label="Element settings" className="max-h-[min(70vh,40rem)] overflow-y-auto rounded-card border border-border bg-surface p-3 text-sm">
      <h3 className="mb-2 font-semibold">Settings</h3>
      <Field label="Name">
        <input type="text" aria-label="Name" disabled={readOnly} className={`${inputClass} text-xs`} value={typeof el.id === "string" ? el.id : ""} onChange={(e) => set("id", e.target.value || undefined)} />
      </Field>

      {isMovable(text, path) && <PositionSection el={el} text={text} set={set} readOnly={readOnly} />}
      {el.type === "text" && <TextSection el={el} path={path} text={text} set={set} edit={edit} readOnly={readOnly} />}
      {el.type === "logo" && <LogoSection el={el} text={text} set={set} readOnly={readOnly} />}
      {(el.type === "row" || el.type === "column") && <FlowSection el={el} set={set} readOnly={readOnly} />}
      <StyleSection el={el} path={path} text={text} set={set} edit={edit} readOnly={readOnly} />
      <Section title="Show when">
        <ShowWhenSection text={text} path={path} rule={el.show_when} edit={edit} readOnly={readOnly} />
      </Section>
    </section>
  );
}

function PositionSection({ el, text, set, readOnly }: { el: Record<string, unknown>; text: string; set: (key: string, value: unknown) => void; readOnly: boolean }) {
  const box = (el.box ?? {}) as Record<string, unknown>;
  const keys = BOX_KEYS.filter((k) => k in box);
  if (keys.length === 0) return null;
  return (
    <Section title="Position">
      {keys.map((k) => (
        <LengthInput
          key={k}
          label={k}
          value={box[k]}
          disabled={readOnly}
          text={text}
          onUnlink={() => set(`box.${k}`, optionDefaultForWrite(text, box[k] as string))}
          onChange={(v) => set(`box.${k}`, v)}
        />
      ))}
    </Section>
  );
}

function TextSection({
  el,
  path,
  text,
  set,
  edit,
  readOnly,
}: {
  el: Record<string, unknown>;
  path: string;
  text: string;
  set: (key: string, value: unknown) => void;
  edit: (fn: (t: string) => string, merge?: string) => void;
  readOnly: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const insertPlaceholder = (name: string) => {
    const field = inputRef.current;
    const current = String(el.text ?? "");
    if (!field) {
      set("text", current + `{${name}}`);
      return;
    }
    const start = field.selectionStart ?? current.length;
    const end = field.selectionEnd ?? start;
    const next = current.slice(0, start) + `{${name}}` + current.slice(end);
    set("text", next);
  };

  const bg = el.background as Record<string, unknown> | undefined;
  const bgOn = !!bg;
  const bgFill = bg?.fill as Record<string, unknown> | undefined;

  return (
    <Section title="Text">
      <Field label="Text">
        <input
          ref={inputRef}
          type="text"
          aria-label="Text"
          disabled={readOnly}
          className={`${inputClass} text-xs`}
          value={String(el.text ?? "")}
          onChange={(e) => set("text", e.target.value)}
        />
      </Field>
      <Field label="Insert placeholder">
        <select aria-label="Insert placeholder" disabled={readOnly} className={`${inputClass} text-xs`} defaultValue="" onChange={(e) => {
          if (e.target.value) insertPlaceholder(e.target.value);
          e.target.value = "";
        }}>
          <option value="">Insert…</option>
          {PLACEHOLDER_KEYS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </Field>
      <OptionLinkedField
        label="Font"
        value={el.font}
        disabled={readOnly}
        onUnlink={() => set("font", optionDefaultForWrite(text, el.font as string) ?? "Inter Bold")}
      >
        <Field label="Font">
          <select aria-label="Font" disabled={readOnly} className={`${inputClass} text-xs`} value={String(el.font ?? "Inter Bold")} onChange={(e) => set("font", e.target.value)}>
            {FONTS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </Field>
      </OptionLinkedField>
      <NumberInput label="Size" value={el.size} disabled={readOnly} onChange={(v) => set("size", v)} />
      <ColourOrOption label="Colour" value={el.colour ?? "#FFFFFF"} text={text} path={path} propKey="colour" edit={edit} readOnly={readOnly} />
      <NumberInput label="Letter spacing" value={el.letter_spacing ?? 0} disabled={readOnly} onChange={(v) => set("letter_spacing", v)} />
      <Checkbox
        disabled={readOnly}
        checked={bgOn}
        onChange={(on) => {
          if (on) set("background", { fill: { colour: "#000000", opacity: 0.6 }, radius: 0, padding: 0 });
          else set("background", undefined);
        }}
      >
        Background
      </Checkbox>
      {bgOn && bg && (
        <>
          <ColourInput label="Background colour" value={String(bgFill?.colour ?? "#000000")} disabled={readOnly} onChange={(c) => set("background.fill.colour", c)} />
          <NumberInput
            label="Background opacity"
            value={bgFill?.opacity ?? 1}
            disabled={readOnly}
            min={0}
            max={1}
            step={0.05}
            text={text}
            onUnlink={() => {
              const def = optionDefaultForWrite(text, bgFill?.opacity as string);
              if (def !== undefined) {
                set("background.fill.opacity", def);
                if (!bgFill?.colour) set("background.fill.colour", "#000000");
              }
            }}
            onChange={(v) => {
              set("background.fill.opacity", v);
              if (!bgFill?.colour && !isOptionRef(bgFill?.colour)) set("background.fill.colour", "#000000");
            }}
          />
          <NumberInput label="Background radius" value={bg.radius ?? 0} disabled={readOnly} onChange={(v) => set("background.radius", v)} />
          <NumberInput label="Background padding" value={bg.padding ?? 0} disabled={readOnly} onChange={(v) => set("background.padding", v)} />
        </>
      )}
    </Section>
  );
}

function LogoSection({ el, text, set, readOnly }: { el: Record<string, unknown>; text: string; set: (key: string, value: unknown) => void; readOnly: boolean }) {
  return (
    <Section title="Logo">
      <OptionLinkedField label="Image" value={el.image} disabled={readOnly} onUnlink={() => set("image", optionDefaultForWrite(text, el.image as string) ?? "imdb")}>
        <Field label="Image">
          <select aria-label="Logo image" disabled={readOnly} className={`${inputClass} text-xs`} value={String(el.image ?? "imdb")} onChange={(e) => set("image", e.target.value)}>
            {LOGOS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </Field>
      </OptionLinkedField>
      <NumberInput
        label="Height"
        value={el.height}
        disabled={readOnly}
        text={text}
        onUnlink={() => set("height", optionDefaultForWrite(text, el.height as string))}
        onChange={(v) => set("height", v)}
      />
    </Section>
  );
}

function FlowSection({ el, set, readOnly }: { el: Record<string, unknown>; set: (key: string, value: unknown) => void; readOnly: boolean }) {
  return (
    <Section title={el.type === "row" ? "Row" : "Column"}>
      <NumberInput label="Gap" value={el.gap ?? 0} disabled={readOnly} onChange={(v) => set("gap", v)} />
      <Field label="Align">
        <select aria-label="Align" disabled={readOnly} className={`${inputClass} text-xs`} value={String(el.align ?? (el.type === "row" ? "centre" : "start"))} onChange={(e) => set("align", e.target.value)}>
          {ALIGNMENTS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </Field>
    </Section>
  );
}

function StyleSection({
  el,
  path,
  text,
  set,
  edit,
  readOnly,
}: {
  el: Record<string, unknown>;
  path: string;
  text: string;
  set: (key: string, value: unknown) => void;
  edit: (fn: (t: string) => string, merge?: string) => void;
  readOnly: boolean;
}) {
  const shadow = el.shadow as Record<string, unknown> | undefined;
  const blur = el.blur_behind as Record<string, unknown> | undefined;
  const fill = el.fill as Record<string, unknown> | undefined;
  const stroke = el.stroke as Record<string, unknown> | undefined;
  const hasGradient = fill && fill.gradient !== undefined && fill.gradient !== null;

  return (
    <Section title="Style">
      <NumberInput
        label="Opacity"
        value={el.opacity ?? 1}
        disabled={readOnly}
        min={0}
        max={1}
        step={0.05}
        text={text}
        onUnlink={() => set("opacity", optionDefaultForWrite(text, el.opacity as string))}
        onChange={(v) => set("opacity", v)}
      />
      {el.type === "rect" && (
        <>
          {fill ? (
            <>
              {hasGradient ? (
                <p className="text-xs text-muted">Gradient: edit in the YAML view</p>
              ) : (
                <ColourOrOption label="Fill colour" value={fill.colour ?? "#000000"} text={text} path={path} propKey="fill.colour" edit={edit} readOnly={readOnly} />
              )}
              <NumberInput
                label="Fill opacity"
                value={fill.opacity ?? 1}
                disabled={readOnly}
                min={0}
                max={1}
                step={0.05}
                text={text}
                onUnlink={() => {
                  const def = optionDefaultForWrite(text, fill.opacity as string);
                  if (def !== undefined) {
                    set("fill.opacity", def);
                    if (!hasGradient && !fill.colour) set("fill.colour", "#000000");
                  }
                }}
                onChange={(v) => {
                  set("fill.opacity", v);
                  if (!hasGradient && !fill.colour && !isOptionRef(fill.colour)) set("fill.colour", "#000000");
                }}
              />
            </>
          ) : (
            <Checkbox disabled={readOnly} checked={false} onChange={(on) => on && set("fill", { colour: "#000000", opacity: 0.6 })}>
              Fill
            </Checkbox>
          )}
          {fill && (
            <button type="button" disabled={readOnly} className="text-xs text-muted underline" onClick={() => set("fill", undefined)}>
              Remove fill
            </button>
          )}
          <NumberInput label="Radius" value={el.radius ?? 0} disabled={readOnly} onChange={(v) => set("radius", v)} />
          <Checkbox disabled={readOnly} checked={!!stroke} onChange={(on) => (on ? set("stroke", { colour: "#FFFFFF", width: 2 }) : set("stroke", undefined))}>
            Stroke
          </Checkbox>
          {stroke && (
            <>
              <ColourInput label="Stroke colour" value={String(stroke.colour ?? "#FFFFFF")} disabled={readOnly} onChange={(c) => set("stroke.colour", c)} />
              <NumberInput label="Stroke width" value={stroke.width ?? 2} disabled={readOnly} onChange={(v) => set("stroke.width", v)} />
            </>
          )}
        </>
      )}
      <Checkbox disabled={readOnly} checked={!!shadow} onChange={(on) => (on ? set("shadow", { colour: "#000000", opacity: 0.5, blur: 6, dx: 0, dy: 4 }) : set("shadow", undefined))}>
        Shadow
      </Checkbox>
      {shadow && (
        <>
          <ColourInput label="Shadow colour" value={String(shadow.colour ?? "#000000")} disabled={readOnly} onChange={(c) => set("shadow.colour", c)} />
          <NumberInput label="Shadow opacity" value={shadow.opacity ?? 0.5} disabled={readOnly} min={0} max={1} step={0.05} onChange={(v) => set("shadow.opacity", v)} />
          <NumberInput label="Shadow blur" value={shadow.blur ?? 6} disabled={readOnly} onChange={(v) => set("shadow.blur", v)} />
          <NumberInput label="Shadow dx" value={shadow.dx ?? 0} disabled={readOnly} onChange={(v) => set("shadow.dx", v)} />
          <NumberInput label="Shadow dy" value={shadow.dy ?? 4} disabled={readOnly} onChange={(v) => set("shadow.dy", v)} />
        </>
      )}
      <Checkbox disabled={readOnly} checked={!!blur} onChange={(on) => (on ? set("blur_behind", { radius: 12, tint: "#0E0E12", tint_opacity: 0.4 }) : set("blur_behind", undefined))}>
        Frosted glass (blur behind)
      </Checkbox>
      {blur && (
        <>
          <NumberInput label="Blur radius" value={blur.radius ?? 12} disabled={readOnly} onChange={(v) => set("blur_behind.radius", v ?? 12)} />
          <ColourInput label="Tint" value={String(blur.tint ?? "#0E0E12")} disabled={readOnly} onChange={(c) => set("blur_behind.tint", c)} />
          <NumberInput label="Tint opacity" value={blur.tint_opacity ?? 0.4} disabled={readOnly} min={0} max={1} step={0.05} onChange={(v) => set("blur_behind.tint_opacity", v)} />
        </>
      )}
    </Section>
  );
}