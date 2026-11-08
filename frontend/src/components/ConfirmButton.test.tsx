import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmButton } from "./ui";

describe("ConfirmButton", () => {
  it("shows progress while busy, disables buttons, and restores them when busy clears", () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <ConfirmButton
        label="Delete"
        confirm="Delete"
        warning="Deletes it from Plex too."
        onConfirm={onConfirm}
        busy={false}
        busyLabel="Deleting…"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Keep" })).toBeEnabled();

    rerender(
      <ConfirmButton
        label="Delete"
        confirm="Delete"
        warning="Deletes it from Plex too."
        onConfirm={onConfirm}
        busy={true}
        busyLabel="Deleting…"
      />,
    );

    const busyButton = screen.getByRole("button", { name: "Deleting…" });
    expect(busyButton).toBeInTheDocument();
    expect(busyButton).toHaveAttribute("aria-busy", "true");
    expect(busyButton).toBeDisabled();

    const keepButton = screen.getByRole("button", { name: "Keep" });
    expect(keepButton).toBeDisabled();

    rerender(
      <ConfirmButton
        label="Delete"
        confirm="Delete"
        warning="Deletes it from Plex too."
        onConfirm={onConfirm}
        busy={false}
        busyLabel="Deleting…"
      />,
    );

    const restoredConfirm = screen.getByRole("button", { name: "Delete" });
    expect(restoredConfirm).toBeInTheDocument();
    expect(restoredConfirm).toBeEnabled();
    expect(restoredConfirm).not.toHaveAttribute("aria-busy");

    expect(screen.getByRole("button", { name: "Keep" })).toBeEnabled();
  });

  it("defaults busyLabel to Working…", () => {
    render(
      <ConfirmButton
        label="Remove"
        confirm="Remove"
        warning="Are you sure?"
        onConfirm={() => {}}
        busy={true}
        open
      />,
    );

    const busyButton = screen.getByRole("button", { name: "Working…" });
    expect(busyButton).toBeInTheDocument();
    expect(busyButton).toHaveAttribute("aria-busy", "true");
    expect(busyButton).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep" })).toBeDisabled();
  });
});
