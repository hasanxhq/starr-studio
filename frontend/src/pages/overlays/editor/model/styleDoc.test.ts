import { describe, expect, it } from "vitest";

import { addElement, elementAt, isMovable, movablePath, outline, placeBox, removeElement, reorderElement, setProp } from "./styleDoc";

const FILE = `# my style
studio_style: 1
name: Test
elements:
  - id: band   # the dark band
    type: rect
    box: { left: 0, right: 0, bottom: 0, height: 17% }
  - id: scores
    type: row
    box: { left: 48, bottom: 150 }
    children:
      - { type: text, text: "{imdb}", size: 54 }
      - { type: logo, image: imdb, height: 64 }
  - { id: new, type: text, text: NEW, size: 40, box: { centre_x: 0, top: 40 } }
  - type: group
    box: { left: 100, top: 100, width: 200, height: 200 }
    children:
      - { type: rect, box: { right: 10, top: 10, width: 50, height: 50 } }
`;

describe("styleDoc", () => {
  it("outlines the elements with their paths", () => {
    const tree = outline(FILE);
    expect(tree.map((n) => [n.path, n.label, n.movable])).toEqual([
      ["elements.0", "band", true],
      ["elements.1", "scores", true],
      ["elements.2", "new", true],
      ["elements.3", "group", true],
    ]);
    expect(tree[1].children.map((n) => [n.path, n.label, n.movable])).toEqual([
      ["elements.1.children.0", "{imdb}", false],
      ["elements.1.children.1", "logo", false],
    ]);
    expect(tree[3].children[0].movable).toBe(true);
  });

  it("knows what a drag moves", () => {
    expect(isMovable(FILE, "elements.1.children.0")).toBe(false);
    expect(movablePath(FILE, "elements.1.children.0")).toBe("elements.1");
    expect(movablePath(FILE, "elements.3.children.0")).toBe("elements.3.children.0");
  });

  it("moves keeping pinned edges, units and comments", () => {
    // scores: left/bottom pinned; drawn at x 48, y 1300 (64 tall)
    const moved = placeBox(FILE, "elements.1", [58, 1290, 300, 64], [48, 1286, 300, 64]);
    expect(elementAt(moved, "elements.1")?.box).toEqual({ left: 58, bottom: 146 });
    expect(moved).toContain("# my style");
    expect(moved).toContain("# the dark band");
    expect(moved).toContain("box: { left: 58, bottom: 146 }"); // stays one line
    // band: left and right both pinned, height in %
    const band = placeBox(FILE, "elements.0", [10, 1245, 980, 255], [0, 1245, 1000, 255]);
    expect(elementAt(band, "elements.0")?.box).toEqual({ left: 10, right: 10, bottom: 0, height: "17%" });
    // NEW: centred horizontally
    const centred = placeBox(FILE, "elements.2", [450, 40, 120, 40], [440, 40, 120, 40]);
    expect(elementAt(centred, "elements.2")?.box).toEqual({ centre_x: 10, top: 40 });
  });

  it("moves a group's child inside the group's box, and not a row's child", () => {
    const moved = placeBox(FILE, "elements.3.children.0", [220, 120, 50, 50], [240, 110, 50, 50], [100, 100, 200, 200]);
    expect(elementAt(moved, "elements.3.children.0")?.box).toEqual({ right: 30, top: 20, width: 50, height: 50 });
    expect(placeBox(FILE, "elements.1.children.0", [0, 0, 10, 10], [5, 5, 10, 10])).toBe(FILE);
  });

  it("resizes content-sized elements by scaling them", () => {
    const bigger = placeBox(FILE, "elements.2", [430, 40, 180, 60], [440, 40, 120, 40]);
    expect(elementAt(bigger, "elements.2")?.size).toBe(60);
    const rect = placeBox(FILE, "elements.3.children.0", [240, 110, 80, 60], [240, 110, 50, 50], [100, 100, 200, 200]);
    expect(elementAt(rect, "elements.3.children.0")?.box).toEqual({ right: -20, top: 10, width: 80, height: 60 });
  });

  it("leaves an $option box value alone", () => {
    const file = FILE.replace("box: { centre_x: 0, top: 40 }", "box: { centre_x: $offset, top: 40 }");
    const moved = placeBox(file, "elements.2", [450, 50, 120, 40], [440, 40, 120, 40]);
    expect(elementAt(moved, "elements.2")?.box).toEqual({ centre_x: "$offset", top: 50 });
  });

  it("sets and removes values", () => {
    const red = setProp(FILE, "elements.0", "fill.colour", "#FF0000");
    expect(elementAt(red, "elements.0")?.fill).toEqual({ colour: "#FF0000" });
    expect(elementAt(setProp(red, "elements.0", ["fill"], undefined), "elements.0")?.fill).toBeUndefined();
  });

  it("adds, removes and reorders elements", () => {
    const added = addElement(FILE, null, { type: "text", text: "HI", size: 30, box: { left: 0, top: 0 } });
    expect(added.path).toBe("elements.4");
    expect(elementAt(added.text, "elements.4")?.text).toBe("HI");
    const inRow = addElement(FILE, "elements.1", { type: "text", text: "x", size: 10 }, 0);
    expect(inRow.path).toBe("elements.1.children.0");
    expect(outline(removeElement(FILE, "elements.0")).map((n) => n.label)).toEqual(["scores", "new", "group"]);
    expect(removeElement(FILE, "elements.3.children.0")).toBe(FILE); // a group keeps its last child
    const reordered = reorderElement(FILE, "elements.2", 0);
    expect(reordered.path).toBe("elements.0");
    expect(outline(reordered.text)[0].label).toBe("new");
  });

  it("keeps the file's last element and outlines a half-typed file", () => {
    const one = "studio_style: 1\nname: x\nelements:\n  - { type: rect, box: { left: 0, top: 0, width: 1, height: 1 } }\n";
    expect(removeElement(one, "elements.0")).toBe(one);
    expect(outline("name: x\nelements: 3\n")).toEqual([]);
    expect(outline("name: x\nelements:\n  - \n  - { type: rect }\n").map((n) => n.path)).toEqual(["elements.1"]);
  });

  it("throws on text that isn't YAML", () => {
    expect(() => setProp("a: [", "elements.0", "x", 1)).toThrow();
  });
});
