import { expect, it } from "vite-plus/test";
import { markdownCodeMedia } from "./markdownCodeMedia";
import { setMarkdownCodeLanguage } from "@t3tools/shared/markdownCode";
it("keeps source offsets for quote controls and leaves unsupported nested lists readable", () => {
  const source =
    "Intro 😀\n\n```text\nfirst\n```\n\n> ```mermaid\n> graph TD; A-->B\n> ```\n\n- Item\n\n  ```text\n  nested\n  ```";
  const result = markdownCodeMedia(source, "blackbird-code://test/");
  expect(result.media.size).toBe(2);
  expect(result.markdown).toContain("> ![Code block](blackbird-code://test/1)");
  expect(result.markdown).toContain("  ```text\n  nested\n  ```");
  const block = result.media.get("blackbird-code://test/1")!;
  expect(
    setMarkdownCodeLanguage(source, {
      blockStart: block.start,
      expectedLanguage: block.language,
      language: "text",
    }),
  ).toContain("> ```text\n> graph TD");
  expect(result.nestedBlocks[0]?.code).toBe("nested");
});
it("keeps an unfinished streamed fence as source with an accurate completion flag", () => {
  const result = markdownCodeMedia("```mermaid\ngraph TD; A-->B", "blackbird-code://test/");
  expect(result.media.get("blackbird-code://test/0")?.closed).toBe(false);
});
