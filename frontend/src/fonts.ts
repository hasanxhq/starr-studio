// Per-browser font stack: Studio bundled fonts vs system UI fonts. Applied via data-fonts on <html>.

export type FontChoice = "studio" | "system-text" | "system";

const STORAGE_KEY = "studio.fonts";

const VALID = new Set<string>(["studio", "system-text", "system"]);

export function readFonts(): FontChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && VALID.has(stored)) return stored as FontChoice;
  } catch {
    // storage blocked (private window, previews)
  }
  return "studio";
}

export function applyFonts(value: FontChoice): void {
  if (value === "studio") document.documentElement.removeAttribute("data-fonts");
  else document.documentElement.dataset.fonts = value;
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // the choice still applies until reload
  }
}
