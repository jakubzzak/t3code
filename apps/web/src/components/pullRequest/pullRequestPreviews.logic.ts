import type { PullRequestComment } from "@t3tools/contracts";

const PREVIEW_HOST =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.staging\.jurata\.ch)$/i;

/** Preview destinations from the complete loaded conversation, independent of comment layout. */
export function pullRequestPreviews(comments: ReadonlyArray<Pick<PullRequestComment, "body">>) {
  const destinations = new Map<string, string>();
  const labelCounts = new Map<string, number>();
  for (const comment of comments) {
    // Stop at the Markdown label/destination boundary in [https://…](https://…).
    for (const match of comment.body.matchAll(/https:\/\/(?:(?!\]\()[^\s<>"'`])+/gi)) {
      let url = match[0].replace(/[.,;:!?\]}]+$/, "");
      // A Markdown link or surrounding sentence may close after a URL whose path itself
      // contains balanced parentheses. Keep those path characters, trim only extra closers.
      let excessClosers = (url.match(/\)/g)?.length ?? 0) - (url.match(/\(/g)?.length ?? 0);
      while (excessClosers > 0 && url.endsWith(")")) {
        url = url.slice(0, -1);
        excessClosers -= 1;
      }
      url = url.replace(/[.,;:!?]+$/, "");
      if (destinations.has(url)) continue;
      try {
        const parsed = new URL(url);
        const label = PREVIEW_HOST.exec(parsed.hostname)?.[1]?.toLowerCase();
        if (!label || parsed.username || parsed.password) continue;
        destinations.set(url, label);
        labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
      } catch {
        // A comment can contain an unfinished or malformed link.
      }
    }
  }
  return Array.from(destinations, ([url, label]) => ({
    url,
    label,
    ambiguous: (labelCounts.get(label) ?? 0) > 1,
  }));
}
