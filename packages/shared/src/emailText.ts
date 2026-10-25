import { unified } from "unified";
import rehypeRaw from "rehype-raw";

type EmailNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: ReadonlyArray<EmailNode>;
};
const processor = unified().use([rehypeRaw]);
const ignored = new Set([
  "head",
  "title",
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "object",
  "embed",
  "svg",
  "img",
]);
const blocks = new Set([
  "address",
  "article",
  "blockquote",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "section",
  "tr",
  "pre",
]);
const htmlMarkup =
  /<!doctype\s+html|<\/(?:html|body|div|p|span|a|b|i|strong|em|table|tr|td|ul|ol|li|blockquote|pre|script|style)\s*>|<(?:html|body|head|div|p|table|ul|ol|blockquote|section|article|br|hr|img)(?:\s[^<>]*|\s*\/?)>/i;

/** Parse email markup as data, without a browser, network requests or executable HTML. */
export function emailText(value: string) {
  if (!htmlMarkup.test(value)) return value;
  const root: EmailNode = { type: "root", children: [{ type: "raw", value }] };
  const tree = processor.runSync(root);
  const pieces: string[] = [];
  const stack: Array<{ node: EmailNode; exit?: boolean; start?: number; pre?: boolean }> = [
    { node: tree },
  ];
  while (stack.length) {
    const { node, exit, start = 0, pre = false } = stack.pop()!;
    const tag = node.tagName ?? "";
    const properties = node.properties ?? {};
    if (exit) {
      if (
        tag === "a" &&
        typeof properties.href === "string" &&
        /^(https?:\/\/|mailto:)/i.test(properties.href)
      ) {
        const label = pieces.slice(start).join("").trim();
        const href = properties.href.replace(/^mailto:/i, "");
        if (label && label !== href) pieces.push(` (${properties.href})`);
      }
      if (tag === "p" || tag === "ul" || tag === "ol") pieces.push("\n\n");
      else if (blocks.has(tag) || tag === "li" || tag === "ul" || tag === "ol") pieces.push("\n");
      else if (tag === "td" || tag === "th") pieces.push("\t");
      continue;
    }
    if (node.type === "text") {
      pieces.push(pre ? (node.value ?? "") : (node.value ?? "").replace(/\s+/g, " "));
      continue;
    }
    if (
      node.type === "comment" ||
      ignored.has(tag) ||
      properties.hidden === true ||
      properties.ariaHidden === "true" ||
      (typeof properties.style === "string" &&
        /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))\b/i.test(
          properties.style,
        ))
    )
      continue;
    if (tag === "br" || tag === "hr") {
      pieces.push("\n");
      continue;
    }
    if (blocks.has(tag) || tag === "p" || tag === "li" || tag === "ul" || tag === "ol") {
      // Formatting whitespace between HTML blocks is not an extra paragraph.
      if (pieces.at(-1)?.trim() === "" && !pieces.at(-1)?.includes("\n")) pieces.pop();
      if (pieces.length && !pieces.at(-1)!.endsWith("\n")) pieces.push("\n");
    }
    if (tag === "li") pieces.push("• ");
    stack.push({ node, exit: true, start: pieces.length });
    const children = node.children ?? [];
    for (let index = children.length - 1; index >= 0; index--)
      stack.push({ node: children[index]!, pre: pre || tag === "pre" });
  }
  return pieces
    .join("")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
