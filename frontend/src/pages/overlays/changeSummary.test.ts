import { describe, expect, it } from "vitest";

import type { OverlayLayout } from "../../api";
import { layerChangeSentence, studioChangeSentence } from "./changeSummary";

const aligned: OverlayLayout = {
  moved_by: "align",
  variables: { horizontal_align: "right", vertical_align: "top", horizontal_offset: 15, vertical_offset: 15, back_color: "#00000099" },
  conditionals: { back_width: { default: 305, conditions: [] }, back_height: { default: 105, conditions: [] } },
};

const positioned: OverlayLayout = {
  moved_by: "position",
  variables: { horizontal_position: "left", vertical_position: "center", back_color: "#00000099" },
  conditionals: {},
};

describe("layerChangeSentence", () => {
  it("describes alignment moves", () => {
    expect(
      layerChangeSentence("Ratings", positioned, {}, {}, { horizontal_position: "right", vertical_position: "bottom" }),
    ).toBe("Ratings move from the middle left corner to the bottom right corner");
  });

  it("describes offset moves", () => {
    expect(layerChangeSentence("Resolution", aligned, {}, { horizontal_offset: 15, vertical_offset: 15 }, { horizontal_offset: 5, vertical_offset: 5 })).toBe(
      "Resolution move closer to the edge",
    );
  });

  it("describes colour moves", () => {
    expect(layerChangeSentence("Resolution", aligned, {}, {}, { back_color: "#FFFFFFCC" })).toBe("Resolution get a white background");
  });
});

describe("studioChangeSentence", () => {
  it("joins several clauses", () => {
    expect(studioChangeSentence(["Ratings move from the right side to the bottom corner"], [], [])).toBe(
      "Ratings move from the right side to the bottom corner.",
    );
  });
});
