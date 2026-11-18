import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("cancels on Escape, but not while busy", () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <ConfirmDialog title="Sure?" confirm="Yes" onConfirm={() => {}} onCancel={onCancel}>
        body
      </ConfirmDialog>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    rerender(
      <ConfirmDialog title="Sure?" confirm="Yes" busy onConfirm={() => {}} onCancel={onCancel}>
        body
      </ConfirmDialog>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
