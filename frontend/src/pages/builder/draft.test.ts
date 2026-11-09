import { describe, expect, it } from "vitest";
import { blankDraft, draftsDiffer } from "./draft";

describe("draftsDiffer", () => {
  it("counts a switch from artists to albums as a change", () => {
    const artists = blankDraft("Music", []);
    expect(draftsDiffer({ ...artists, level: "album" }, artists, "filters", "filters")).toBe(true);
    expect(draftsDiffer({ ...artists }, artists, "filters", "filters")).toBe(false);
  });

  it("counts track level and square art as changes", () => {
    const base = blankDraft("Music", []);
    expect(draftsDiffer({ ...base, level: "track" }, base, "filters", "filters")).toBe(true);
    expect(
      draftsDiffer({ ...base, square_art: { kind: "url", url: "https://example.com/a.png" } }, base, "filters", "filters"),
    ).toBe(true);
  });
});
