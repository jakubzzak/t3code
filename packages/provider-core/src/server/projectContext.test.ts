import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { buildProjectContextPrompt } from "./textGenerationPrompts.ts";

describe("project context generation", () => {
  it("bounds supplied context and requires evidence references and concise structured output", () => {
    const { prompt, outputSchema } = buildProjectContextPrompt({
      cwd: "/tmp/project-context",
      modelSelection: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection,
      kind: "briefing",
      instructions: "Focus on releases",
      context: `source:thread-1\n${"a".repeat(80_000)}END`,
    });
    expect(prompt).toContain("Focus on releases");
    expect(prompt).toContain("source:thread-1");
    expect(prompt).toContain("sourceIds");
    expect(prompt).not.toContain("END");
    expect(prompt.length).toBeLessThan(35_000);
    expect(
      Schema.is(outputSchema)({
        title: "Title",
        summary: "Summary",
        nextStep: "Review",
        labels: [],
        sourceIds: ["thread-1"],
      }),
    ).toBe(true);
    expect(
      Schema.is(outputSchema)({
        title: "Title",
        summary: "x".repeat(2000),
        nextStep: "Review",
        labels: [],
        sourceIds: [],
      }),
    ).toBe(false);
  });
});
