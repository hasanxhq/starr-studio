import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { mockApi, renderAt } from "../test-utils";

describe("Settings → UI", () => {
  it("switches Show Advanced, the same switch as the header's", async () => {
    mockApi({});
    renderAt("/settings/ui");
    const boxes = await screen.findAllByRole("checkbox", { name: "Show Advanced" });
    expect(boxes).toHaveLength(2);
    fireEvent.click(boxes[1]);
    expect(boxes[0]).toBeChecked();
    expect(localStorage.getItem("studio.showAdvanced")).toBe("true");
  });

  it("shows the stored font choice when the page opens", async () => {
    localStorage.setItem("studio.fonts", "system-text");
    mockApi({});
    renderAt("/settings/ui");
    expect(await screen.findByRole("radio", { name: "System text, Studio headings" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Studio fonts" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "System everywhere" })).not.toBeChecked();
  });

  it("applies each font choice to the page and storage", async () => {
    mockApi({});
    renderAt("/settings/ui");
    await screen.findByRole("radio", { name: "Studio fonts" });

    fireEvent.click(screen.getByRole("radio", { name: "System text, Studio headings" }));
    expect(document.documentElement.dataset.fonts).toBe("system-text");
    expect(localStorage.getItem("studio.fonts")).toBe("system-text");

    fireEvent.click(screen.getByRole("radio", { name: "System everywhere" }));
    expect(document.documentElement.dataset.fonts).toBe("system");
    expect(localStorage.getItem("studio.fonts")).toBe("system");

    fireEvent.click(screen.getByRole("radio", { name: "Studio fonts" }));
    expect(document.documentElement.hasAttribute("data-fonts")).toBe(false);
    expect(localStorage.getItem("studio.fonts")).toBe("studio");
  });
});
