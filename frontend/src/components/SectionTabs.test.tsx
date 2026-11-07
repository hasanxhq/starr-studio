import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import { SectionTabs } from "./SectionTabs";

function renderTabs(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<SectionTabs />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SectionTabs", () => {
  it("shows System tabs with Tasks current on /system/tasks", () => {
    renderTabs("/system/tasks");
    const nav = screen.getByRole("navigation", { name: "System pages" });
    const tabs = ["Status", "Tasks", "Backup", "Logs", "Updates"];
    for (const label of tabs) {
      expect(nav.querySelector(`a[href="/system/${label.toLowerCase()}"]`)).not.toBeNull();
    }
    expect(screen.getByRole("link", { name: "Tasks" })).toHaveAttribute("aria-current", "page");
  });

  it("highlights Queue on a nested run path", () => {
    renderTabs("/activity/queue/12");
    const nav = screen.getByRole("navigation", { name: "Activity pages" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Queue" })).toHaveAttribute("aria-current", "page");
  });

  it("renders nothing outside Activity, System and Settings", () => {
    renderTabs("/collections");
    expect(screen.queryByRole("navigation", { name: /pages$/ })).not.toBeInTheDocument();
  });
});
