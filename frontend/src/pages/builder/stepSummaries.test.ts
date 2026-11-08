import { describe, expect, it } from "vitest";

import { stepForSaveProblem } from "./stepSummaries";

describe("stepForSaveProblem", () => {
  it("opens details for sort title problems", () => {
    expect(stepForSaveProblem("sort title is too long")).toBe(4);
  });
});
