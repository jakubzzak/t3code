import remarkParse from "remark-parse";
import { unified } from "unified";

const parser = unified().use(remarkParse);

export interface MarkdownCodeLanguageChange {
  readonly blockStart: number;
  readonly expectedLanguage: string;
  readonly language: string;
}

/** Source offsets come from the Markdown parser, so nested and quoted fences remain distinct. */
export function markdownCodeBlocks(markdown: string) {
  const pending = [...parser.parse(markdown).children];
  const blocks = [];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if ("children" in node) pending.push(...node.children);
    if (node.type !== "code") continue;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    const raw = markdown.slice(start, end);
    const opening = /^(?<fence>`{3,}|~{3,})(?<spacing>[\t ]*)(?<language>[^\s]*)/.exec(raw);
    if (!opening?.groups) continue;
    const fence = opening.groups.fence!;
    const closing = /(?:^|\n)[\t >]*(`{3,}|~{3,})[\t ]*\r?$/.exec(raw);
    blocks.push({
      start,
      end,
      language: node.lang ?? "",
      code: node.value,
      languageStart: start + fence.length + opening.groups.spacing!.length,
      languageEnd: start + opening[0].length,
      closed:
        closing !== null &&
        closing.index > 0 &&
        closing[1]![0] === fence[0] &&
        closing[1]!.length >= fence.length,
    });
  }
  return blocks.sort((a, b) => a.start - b.start);
}

/** Changes only a verified fence's language; stale selections must be refreshed before retrying. */
export function setMarkdownCodeLanguage(markdown: string, change: MarkdownCodeLanguageChange) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_+#.-]{0,63}$/.test(change.language)) {
    throw new Error("Invalid code language.");
  }
  const block = markdownCodeBlocks(markdown).find((entry) => entry.start === change.blockStart);
  if (!block || block.language !== change.expectedLanguage) {
    throw new Error("This code block changed. Refresh it and try again.");
  }
  return (
    markdown.slice(0, block.languageStart) + change.language + markdown.slice(block.languageEnd)
  );
}

export const CODE_LANGUAGES = [
  "mermaid",
  "text",
  "bash",
  "typescript",
  "javascript",
  "tsx",
  "jsx",
  "json",
  "yaml",
  "toml",
  "python",
  "sql",
  "html",
  "css",
  "markdown",
  "go",
  "rust",
  "java",
  "kotlin",
  "swift",
  "c",
  "cpp",
  "csharp",
  "ruby",
  "php",
  "diff",
] as const;
