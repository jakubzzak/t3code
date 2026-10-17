import { markdownCodeBlocks } from "@t3tools/shared/markdownCode";
import remarkParse from "remark-parse";
import { unified } from "unified";

const parser = unified().use(remarkParse);
/** Native media slots support document and quote children, but not text inside lists. */
export function markdownCodeMedia(markdown: string, prefix: string) {
  const eligible = new Set<number>();
  const pending = [...parser.parse(markdown).children];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.type === "blockquote") pending.push(...node.children);
    else if (node.type === "code" && node.position) eligible.add(node.position.start.offset!);
  }
  const blocks = markdownCodeBlocks(markdown);
  const media = new Map<string, (typeof blocks)[number]>(
    blocks.flatMap((block, index) =>
      eligible.has(block.start) ? [[`${prefix}${index}`, block] as const] : [],
    ),
  );
  let text = markdown;
  const entries = [...media];
  for (let index = entries.length - 1; index >= 0; index--) {
    const [href, block] = entries[index]!;
    text = `${text.slice(0, block.start)}![Code block](${href})${text.slice(block.end)}`;
  }
  return {
    markdown: text,
    media,
    nestedBlocks: blocks.filter((block) => !eligible.has(block.start)),
  };
}
