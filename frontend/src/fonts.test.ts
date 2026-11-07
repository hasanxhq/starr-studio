import { afterEach, describe, expect, it, vi } from "vitest";

import { applyFonts, readFonts } from "./fonts";

afterEach(() => {
  document.documentElement.removeAttribute("data-fonts");
});

describe("readFonts", () => {
  it("returns studio when nothing is stored", () => {
    expect(readFonts()).toBe("studio");
  });

  it("returns studio for an unknown stored value", () => {
    localStorage.setItem("studio.fonts", "comic-sans");
    expect(readFonts()).toBe("studio");
  });

  it("reads each valid value", () => {
    for (const value of ["studio", "system-text", "system"] as const) {
      localStorage.setItem("studio.fonts", value);
      expect(readFonts()).toBe(value);
    }
  });

  it("does not throw when storage get throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readFonts()).toBe("studio");
  });
});

describe("applyFonts", () => {
  it("sets data-fonts and storage for system modes", () => {
    applyFonts("system-text");
    expect(document.documentElement.dataset.fonts).toBe("system-text");
    expect(localStorage.getItem("studio.fonts")).toBe("system-text");

    applyFonts("system");
    expect(document.documentElement.dataset.fonts).toBe("system");
    expect(localStorage.getItem("studio.fonts")).toBe("system");
  });

  it("clears data-fonts for studio and stores the value", () => {
    document.documentElement.dataset.fonts = "system";
    applyFonts("studio");
    expect(document.documentElement.hasAttribute("data-fonts")).toBe(false);
    expect(localStorage.getItem("studio.fonts")).toBe("studio");
  });

  it("does not throw when storage set throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => applyFonts("system")).not.toThrow();
    expect(document.documentElement.dataset.fonts).toBe("system");
  });
});
