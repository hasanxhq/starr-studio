// Studio's overlay style schema (made from the server's models) compiles in the browser's Ajv and accepts the
// shipped style, so the YAML editor checks style files the way the server does (for shape).

import { describe, expect, it } from "vitest";

import styleSchema from "../../../starr_studio/overlay_engine/style.schema.json";
import modernStreaming from "../../../starr_studio/overlay_engine/styles/modern-streaming.yml?raw";
import { checkYaml } from "./check";
import { compile, type JsonSchema } from "./schema";

describe("style schema", () => {
  const validate = compile(styleSchema as JsonSchema);

  it("accepts the shipped Modern streaming style", () => {
    expect(checkYaml(modernStreaming, validate).filter((p) => p.severity === "error")).toEqual([]);
  });

  it("flags an unknown element type and a missing name", () => {
    const problems = checkYaml("studio_style: 1\nelements:\n  - { type: blob, box: { left: 0, top: 0 } }\n", validate);
    expect(problems.length).toBeGreaterThan(0);
  });
});
