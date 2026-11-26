import { describe, expect, it } from "vitest";

import type { SceneBox } from "../../../../overlayEngineApi";
import { align, distribute, movingPaths, removalOrder, resizeBox } from "./boxes";

const A: SceneBox = [0, 0, 100, 50];
const B: SceneBox = [300, 100, 50, 100];
const C: SceneBox = [100, 400, 100, 20];

describe("align", () => {
  it("left, centre and bottom, to the selection's bounds", () => {
    expect(align([A, B], "left")).toEqual([[0, 0, 100, 50], [0, 100, 50, 100]]);
    expect(align([A, B], "centre")).toEqual([[125, 0, 100, 50], [150, 100, 50, 100]]); // bounds x 0–350, centre 175
    expect(align([A, B], "bottom")).toEqual([[0, 150, 100, 50], [300, 100, 50, 100]]);
  });
});

describe("distribute", () => {
  it("spaces the middle ones so the gaps are equal, whatever the order given", () => {
    expect(distribute([B, A, [120, 0, 20, 10]], "x")).toEqual([[300, 100, 50, 100], [0, 0, 100, 50], [190, 0, 20, 10]]); // gaps of 90
    expect(distribute([A, B, C], "y").map((b) => b[1])).toEqual([0, 175, 400]);
  });
});

describe("resizeBox", () => {
  it("moves the handle's edges, keeps the opposite ones, and never inverts", () => {
    expect(resizeBox([100, 100, 200, 100], "se", 20, 10)).toEqual([100, 100, 220, 110]);
    expect(resizeBox([100, 100, 200, 100], "nw", 20, 10)).toEqual([120, 110, 180, 90]);
    expect(resizeBox([100, 100, 200, 100], "e", -500, 0)).toEqual([100, 100, 1, 100]);
  });
  it("keeps the aspect ratio from a corner", () => {
    expect(resizeBox([100, 100, 200, 100], "se", 100, 0, true)).toEqual([100, 100, 300, 150]);
    expect(resizeBox([100, 100, 200, 100], "nw", -100, 0, true)).toEqual([0, 50, 300, 150]);
  });
});

describe("what a drag moves", () => {
  const text = "studio_style: 1\nelements:\n  - { type: group, box: { left: 0, top: 0 }, children: [{ type: rect }] }\n  - { type: row, children: [{ type: text, text: a }] }\n  - { type: rect, box: { left: 0, top: 0, width: 5, height: 5 } }\n";
  it("each movable element once, never inside another that moves", () => {
    const has = () => true;
    expect(movingPaths(text, ["elements.2", "elements.2"], has)).toEqual(["elements.2"]);
    expect(movingPaths(text, ["elements.0", "elements.0.children.0"], has)).toEqual(["elements.0"]);
    expect(movingPaths(text, ["elements.1.children.0"], has)).toEqual(["elements.1"]); // a row's child moves its row
    expect(movingPaths(text, ["elements.2"], (p) => p !== "elements.2")).toEqual([]);
  });
  it("removes deepest and last first", () => {
    expect(removalOrder(["elements.0", "elements.1.children.0", "elements.1", "elements.2"])).toEqual(["elements.2", "elements.1.children.0", "elements.1", "elements.0"]);
  });
});
