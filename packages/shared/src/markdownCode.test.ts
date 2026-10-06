import { describe, expect, it } from "vite-plus/test";
import { setMarkdownCodeLanguage } from "./markdownCode.ts";

describe("changing a Markdown fence language", () => {
  it("changes only the selected fence, preserving its title, body, and CRLF", () => {
    const markdown =
      "# Diagram\r\n\r\n```text title=flow\r\nA --> B\r\n```\r\n\r\n```js\r\nfoo()\r\n```";
    expect(
      setMarkdownCodeLanguage(markdown, {
        blockStart: markdown.indexOf("```"),
        expectedLanguage: "text",
        language: "mermaid",
      }),
    ).toBe(markdown.replace("```text", "```mermaid"));
  });

  it("labels an unlabeled fence nested in a quote and can switch it back", () => {
    const markdown = "> ~~~\n> A --> B\n> ~~~\n";
    const changed = setMarkdownCodeLanguage(markdown, {
      blockStart: 2,
      expectedLanguage: "",
      language: "mermaid",
    });
    expect(changed).toBe("> ~~~mermaid\n> A --> B\n> ~~~\n");
    expect(
      setMarkdownCodeLanguage(changed, {
        blockStart: 2,
        expectedLanguage: "mermaid",
        language: "text",
      }),
    ).toBe("> ~~~text\n> A --> B\n> ~~~\n");
  });

  it("rejects stale selections and offsets inside another block's body", () => {
    const markdown = "````text\n```js\nfoo()\n```\n````";
    expect(() =>
      setMarkdownCodeLanguage(markdown, {
        blockStart: 9,
        expectedLanguage: "js",
        language: "mermaid",
      }),
    ).toThrow();
    expect(() =>
      setMarkdownCodeLanguage(markdown, {
        blockStart: 0,
        expectedLanguage: "js",
        language: "mermaid",
      }),
    ).toThrow();
  });

  it("rejects language text that could inject content or a fence", () => {
    for (const language of ["mermaid\nmalicious", "```", "a b", "a".repeat(65)]) {
      expect(() =>
        setMarkdownCodeLanguage("```text\nA\n```", {
          blockStart: 0,
          expectedLanguage: "text",
          language,
        }),
      ).toThrow();
    }
  });
});
