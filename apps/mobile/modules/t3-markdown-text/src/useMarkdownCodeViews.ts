import { markdownCodeBlocks } from "@t3tools/shared/markdownCode";
import { useCallback, useMemo, useState } from "react";

/** Keep view choices above native chunks, whose offset keys move when earlier fences change. */
export function useMarkdownCodeViews(markdown: string) {
  const blocks = useMemo(() => {
    const parsed = markdownCodeBlocks(markdown);
    const result = new Map<number, (typeof parsed)[number] & { viewKey: string }>();
    let previous = 0;
    let byteOffset = 0;
    const encoder = new TextEncoder();
    for (const [index, block] of parsed.entries()) {
      byteOffset += encoder.encode(markdown.slice(previous, block.start)).length;
      previous = block.start;
      result.set(byteOffset, { ...block, viewKey: `${index}:${block.language}` });
    }
    return result;
  }, [markdown]);
  const keySignature = JSON.stringify([...blocks.values()].map((block) => block.viewKey));
  const [views, setViews] = useState(() => ({ keySignature, sourceViews: new Set<string>() }));
  if (views.keySignature !== keySignature) {
    const active = new Set([...blocks.values()].map((block) => block.viewKey));
    setViews({
      keySignature,
      sourceViews: new Set([...views.sourceViews].filter((key) => active.has(key))),
    });
  }
  const toggleSource = useCallback((key: string) => {
    setViews((previous) => {
      const next = new Set(previous.sourceViews);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...previous, sourceViews: next };
    });
  }, []);
  return { blocks, sourceViews: views.sourceViews, toggleSource };
}
