import { describe, expect, it } from "vitest";

import type { SceneBox } from "../../../../overlayEngineApi";
import { snap, snapResize, snapTargets } from "./snap";

const none = snapTargets([]);

describe("snap", () => {
  it("snaps to the poster's edge, centre and safe margin, and reports the guide", () => {
    expect(snap([5, 300, 100, 100], none)).toEqual({ dx: -5, dy: 0, guides: [{ axis: "x", at: 0 }] });
    expect(snap([447, 300, 100, 100], none).dx).toBe(3); // centre 497 → 500
    expect(snap([46, 300, 100, 100], none)).toMatchObject({ dx: -6, guides: [{ axis: "x", at: 40 }] });
    expect(snap([300, 1356, 100, 100], none)).toMatchObject({ dy: 4, guides: [{ axis: "y", at: 1460 }] }); // bottom 1456 → 1460 (margin)
  });
  it("snaps to another element's edge", () => {
    const other: SceneBox = [200, 600, 100, 100];
    expect(snap([305, 300, 50, 50], snapTargets([other]))).toMatchObject({ dx: -5, guides: [{ axis: "x", at: 300 }] });
    expect(snap([150, 603, 50, 50], snapTargets([other])).dy).toBe(-3); // top 603 → 600
  });
  it("doesn't snap past the threshold, and Alt turns it off", () => {
    expect(snap([20, 300, 100, 100], none)).toEqual({ dx: 0, dy: 0, guides: [] });
    expect(snap([5, 300, 100, 100], none, undefined, true)).toEqual({ dx: 0, dy: 0, guides: [] });
  });
  it("snaps a resize by the edges it moves only", () => {
    expect(snapResize([100, 100, 100, 100], "se", 757, 0, false, none)).toEqual({ box: [100, 100, 860, 100], guides: [{ axis: "x", at: 960 }] });
    expect(snapResize([100, 100, 100, 100], "s", 3, 0, false, none).box).toEqual([100, 100, 100, 100]); // an s handle moves no x edge
    expect(snapResize([100, 100, 100, 50], "se", 100, 0, true, none).guides).toEqual([]); // keeping the ratio: no snap
  });
});
