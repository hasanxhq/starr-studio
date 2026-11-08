import { describe, expect, it } from "vitest";

import type { OverlayLayout, PlexItem } from "./api";
import { layerBoxes, layerText, overlaps, overlapPair, place, resolveLayout, snapToAnchor, whereItIs } from "./overlayLayout";

// Audio Codec's start, as its file has it (Kometa 2.5.3).
const audio: OverlayLayout = {
  moved_by: "align",
  variables: { horizontal_align: "center", vertical_align: "top", back_width: 305 },
  conditionals: {
    vertical_offset: {
      default: 15,
      conditions: [
        { "vertical_align.exists": false, value: 150 },
        { vertical_align: "center", value: 0 },
        { vertical_align: "top", value: 15 },
        { vertical_align: "bottom", value: 30 },
      ],
    },
    horizontal_offset: {
      default: 15,
      conditions: [
        { horizontal_align: "center", value: 0 },
        { horizontal_align: ["left", "right"], value: 15 },
      ],
    },
    back_height: { default: 105, conditions: [{ style: "standard", value: "<<standard_value>>" }] },
  },
};

const ratings: OverlayLayout = { moved_by: "position", variables: { horizontal_position: "left", vertical_position: "center" }, conditionals: {} };

describe("Where an overlay lands", () => {
  it("follows the default's own rules for the alignment it has", () => {
    expect(resolveLayout(audio, {})).toMatchObject({ horizontal_offset: 0, vertical_offset: 15, back_height: 105 });
    expect(resolveLayout(audio, { horizontal_align: "left", vertical_align: "bottom" })).toMatchObject({ horizontal_offset: 15, vertical_offset: 30 });
    expect(resolveLayout(audio, { style: "standard" }).back_height).toBe(105); // a value that's another variable isn't one to place by
  });

  it("lets template variables win over those rules", () => {
    expect(resolveLayout(audio, { vertical_offset: 99 }).vertical_offset).toBe(99);
  });

  it("measures offsets from the aligned edge, or from the centre, as pixels or percentages", () => {
    expect(place({ horizontal_align: "left", vertical_align: "top", horizontal_offset: 15, vertical_offset: 30 }, 305, 105)).toEqual({ x: 15, y: 30 });
    expect(place({ horizontal_align: "right", vertical_align: "bottom", horizontal_offset: 15, vertical_offset: "10%" }, 305, 105)).toEqual({ x: 680, y: 1245 });
    expect(place({ horizontal_align: "center", vertical_align: "center", horizontal_offset: 10 }, 300, 100)).toEqual({ x: 360, y: 700 });
  });

  it("draws a box a default without sizes still shows", () => {
    expect(layerBoxes("ribbon", "Ribbon", undefined, {})[0]).toMatchObject({ key: "ribbon", x: 0, y: 0, width: 305, height: 105, color: "#00000099" });
  });

  it("gives ratings a box per rating set, stacked or side by side", () => {
    expect(layerBoxes("ratings", "Ratings", ratings, {}).map((b) => b.label)).toEqual(["Ratings"]);
    const stacked = layerBoxes("ratings", "Ratings", ratings, { rating1: "imdb", rating2: "audience", rating3: "none" });
    expect(stacked.map((b) => [b.key, b.label, b.x])).toEqual([["ratings-0", "IMDB", 30], ["ratings-1", "Audience", 30]]);
    expect(stacked[1].y - stacked[0].y).toBe(205);
    const across = layerBoxes("ratings", "Ratings", ratings, { rating1: "imdb", rating2: "tmdb", rating_alignment: "horizontal", vertical_position: "bottom2" });
    expect(across[0].y).toBe(across[1].y);
    expect(across[0].y).toBe(1500 - 105 - 30);
  });

  it("names the place for the layer list", () => {
    expect(whereItIs(audio, {})).toBe("top-center");
    expect(whereItIs(audio, { horizontal_align: "center", vertical_align: "center" })).toBe("center");
    expect(whereItIs(ratings, { horizontal_position: "right2" })).toBe("center-right");
  });
});

describe("snapToAnchor", () => {
  const box = (x: number, y: number, width = 305, height = 105) => ({ x, y, width, height });

  it("snaps near the top left corner with edge offsets", () => {
    expect(snapToAnchor(box(12, 18))).toEqual({ horizontal_align: "left", vertical_align: "top", horizontal_offset: 12, vertical_offset: 18 });
  });

  it("snaps near the bottom right corner", () => {
    expect(snapToAnchor(box(680, 1240))).toEqual({ horizontal_align: "right", vertical_align: "bottom", horizontal_offset: 15, vertical_offset: 155 });
  });

  it("snaps near the centre with zero offsets", () => {
    expect(snapToAnchor(box(340, 680))).toEqual({ horizontal_align: "center", vertical_align: "center", horizontal_offset: 0, vertical_offset: 0 });
  });

  it("snaps along the top middle edge", () => {
    expect(snapToAnchor(box(340, 10))).toEqual({ horizontal_align: "center", vertical_align: "top", horizontal_offset: 0, vertical_offset: 10 });
  });

  it("clamps negative offsets to zero", () => {
    expect(snapToAnchor(box(-5, -3))).toEqual({ horizontal_align: "left", vertical_align: "top", horizontal_offset: 0, vertical_offset: 0 });
  });
});

describe("overlaps", () => {
  const r = (x: number, y: number, w: number, h: number) => ({ x, y, width: w, height: h });

  it("returns false when boxes only touch on an edge", () => {
    expect(overlaps([r(0, 0, 100, 100), r(100, 0, 100, 100)])).toBe(false);
    expect(overlaps([r(0, 100, 100, 50), r(0, 0, 100, 100)])).toBe(false);
  });

  it("returns true when rectangles share positive area", () => {
    expect(overlaps([r(0, 0, 100, 100), r(50, 50, 100, 100)])).toBe(true);
  });

  it("names the first overlapping pair", () => {
    expect(overlapPair([{ ...r(0, 0, 100, 100), key: "a", label: "Resolution", color: "", radius: 0 }, { ...r(50, 50, 100, 100), key: "b", label: "Ratings", color: "", radius: 0 }])).toEqual(["Resolution", "Ratings"]);
  });
});

describe("What a layer says", () => {
  const item = (video_resolution: string | null, audio_codec: string | null) => ({ title: "Dune", video_resolution, audio_codec }) as PlexItem;

  it("uses the title's own resolution and audio where Plex lists them", () => {
    expect(layerText("resolution", "Resolution", item("4k", "truehd"))).toBe("4K");
    expect(layerText("resolution", "Resolution", item("1080", null))).toBe("1080P");
    expect(layerText("audio_codec", "Audio Codec", item("4k", "eac3"))).toBe("DD+");
    expect(layerText("audio_codec", "Audio Codec", item("4k", "wma"))).toBe("WMA");
  });

  it("falls back to the layer's name", () => {
    expect(layerText("resolution", "Resolution", item(null, null))).toBe("Resolution");
    expect(layerText("resolution", "Resolution", null)).toBe("4K");
    expect(layerText("ribbon", "Ribbon", item("4k", "aac"))).toBe("Ribbon");
  });
});
