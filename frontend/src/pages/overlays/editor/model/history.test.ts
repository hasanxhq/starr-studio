import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useStyleHistory } from "./history";

describe("useStyleHistory", () => {
  it("undoes, redoes, merges runs and sees the latest text mid-event", () => {
    const { result } = renderHook(() => useStyleHistory("a"));
    act(() => result.current.set("b"));
    act(() => {
      result.current.apply((t) => t + "1", "typing");
      result.current.apply((t) => t + "2", "typing"); // builds on "b1" in the same event
    });
    expect(result.current.text).toBe("b12");
    act(() => result.current.undo());
    expect(result.current.text).toBe("b"); // the typing run was one step
    act(() => result.current.redo());
    expect(result.current.text).toBe("b12");
    act(() => result.current.undo());
    act(() => result.current.undo());
    expect(result.current.text).toBe("a");
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.set("c"));
    expect(result.current.canRedo).toBe(false);
    act(() => result.current.reset("z"));
    expect([result.current.text, result.current.canUndo]).toEqual(["z", false]);
  });
});
