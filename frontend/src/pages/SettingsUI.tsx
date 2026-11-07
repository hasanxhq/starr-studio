// Settings → UI: display options, kept in this browser.

import { useState } from "react";

import { useAdvanced } from "../advanced";
import { Card } from "../components/ui";
import { applyFonts, readFonts, type FontChoice } from "../fonts";

const FONT_OPTIONS: { value: FontChoice; label: string }[] = [
  { value: "studio", label: "Studio fonts" },
  { value: "system-text", label: "System text, Studio headings" },
  { value: "system", label: "System everywhere" },
];

export function SettingsUI() {
  const { showAdvanced, setShowAdvanced } = useAdvanced();
  const [fonts, setFonts] = useState(readFonts);
  const setFontChoice = (value: FontChoice) => {
    setFonts(value);
    applyFonts(value);
  };
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Card title="Forms">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-accent" checked={showAdvanced} onChange={(e) => setShowAdvanced(e.target.checked)} />
          Show Advanced
        </label>
        <p className="text-sm text-muted">
          Shows every option Kometa has in forms, run options and schedules, as the switch in the page header does. Remembered in this
          browser.
        </p>
      </Card>
      <Card title="Text">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm text-muted">Fonts</legend>
          {FONT_OPTIONS.map((option) => (
            <label key={option.value} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="radio"
                className="size-4 accent-accent"
                name="fonts"
                checked={fonts === option.value}
                onChange={() => setFontChoice(option.value)}
              />
              {option.label}
            </label>
          ))}
        </fieldset>
        <p className="text-sm text-muted">
          Studio's fonts look the same on every device. System fonts match your computer or phone, and text wraps a little differently on
          each. Remembered in this browser.
        </p>
      </Card>
    </div>
  );
}
